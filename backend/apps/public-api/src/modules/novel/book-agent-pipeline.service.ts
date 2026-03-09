import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BookAgentPipelineEntity,
  AgentNodeConfig,
  WorkflowParams,
  DEFAULT_PIPELINE_NODES,
  DEFAULT_WORKFLOW_PARAMS,
} from './entities/book-agent-pipeline.entity';
import { WorkflowTopologyService } from './workflow-topology.service';
import type { PipelineView, WorkflowTopology } from './interfaces';

@Injectable()
export class BookAgentPipelineService {
  private readonly logger = new Logger(BookAgentPipelineService.name);

  constructor(
    @InjectRepository(BookAgentPipelineEntity)
    private readonly pipelineRepo: Repository<BookAgentPipelineEntity>,
    private readonly topologyService: WorkflowTopologyService,
  ) {}

  async initDefault(bookId: string): Promise<void> {
    const existing = await this.pipelineRepo.findOneBy({ bookId });
    if (existing) return;
    const defaults = this.cloneDefaultNodes();
    await this.pipelineRepo.save(
      this.pipelineRepo.create({
        bookId,
        draftNodes: defaults,
        publishedNodes: this.cloneDefaultNodes(),
        publishedAt: new Date(),
      }),
    );
    this.logger.log(`[Pipeline] 默认 pipeline 已初始化 bookId=${bookId}`);
  }

  async getPipeline(bookId: string): Promise<PipelineView> {
    let entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) {
      await this.initDefault(bookId);
      entity = await this.pipelineRepo.findOneBy({ bookId });
    }
    entity = await this.ensureEntityNormalized(entity!);
    return this.toView(entity);
  }

  async saveDraft(bookId: string, nodes: AgentNodeConfig[]): Promise<PipelineView> {
    const normalizedDraft = this.normalizeNodes(nodes);
    this.validateNodes(normalizedDraft);
    let entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) {
      await this.initDefault(bookId);
      entity = await this.pipelineRepo.findOneBy({ bookId });
    }
    entity!.draftNodes = normalizedDraft;
    await this.pipelineRepo.save(entity!);
    this.logger.log(`[Pipeline] 草稿已保存 bookId=${bookId} nodes=${normalizedDraft.length}`);
    return this.toView(entity!);
  }

  async publish(bookId: string): Promise<PipelineView> {
    let entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) throw new NotFoundException(`Pipeline not found: ${bookId}`);
    entity = await this.ensureEntityNormalized(entity);
    entity.publishedNodes = this.normalizeNodes(entity.draftNodes);
    entity.publishedAt = new Date();
    await this.pipelineRepo.save(entity);
    this.logger.log(`[Pipeline] 已发布 bookId=${bookId}`);
    return this.toView(entity);
  }

  async getTopology(bookId: string): Promise<WorkflowTopology> {
    const view = await this.getPipeline(bookId);
    return this.topologyService.buildTopology(view.draftNodes, view.workflowParams);
  }

  async saveWorkflowParams(bookId: string, params: Partial<WorkflowParams>): Promise<PipelineView> {
    let entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) { await this.initDefault(bookId); entity = await this.pipelineRepo.findOneBy({ bookId }); }
    entity!.workflowParams = { ...DEFAULT_WORKFLOW_PARAMS, ...(entity!.workflowParams ?? {}), ...params };
    await this.pipelineRepo.save(entity!);
    this.logger.log(`[Pipeline] workflowParams 已更新 bookId=${bookId}`);
    return this.toView(entity!);
  }

  async getPublishedNodes(bookId: string): Promise<AgentNodeConfig[]> {
    const entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity?.publishedNodes) return this.cloneDefaultNodes();
    const normalized = this.normalizeNodes(entity.publishedNodes);
    if (JSON.stringify(normalized) !== JSON.stringify(entity.publishedNodes)) {
      entity.publishedNodes = normalized;
      await this.pipelineRepo.save(entity);
    }
    return normalized;
  }

  private validateNodes(nodes: AgentNodeConfig[]): void {
    const coreIds = ['intent', 'arc-director', 'creative-writer', 'recorder'];
    for (const coreId of coreIds) {
      const node = nodes.find((n) => n.id === coreId);
      if (!node) throw new BadRequestException(`核心节点 ${coreId} 不能删除`);
      if (!node.isEnabled) throw new BadRequestException(`核心节点 ${coreId} 不能禁用`);
    }
  }

  private cloneDefaultNodes(): AgentNodeConfig[] {
    return DEFAULT_PIPELINE_NODES.map((n) => ({
      ...n,
      rfPosition: { ...n.rfPosition },
      ...(n.customConfig ? { customConfig: { ...n.customConfig } } : {}),
    }));
  }

  private normalizeNodes(nodes: AgentNodeConfig[] | null | undefined): AgentNodeConfig[] {
    const current = (nodes ?? []).map((n) => ({
      ...n,
      rfPosition: { ...(n.rfPosition ?? { x: 300, y: 0 }) },
      ...(n.customConfig ? { customConfig: { ...n.customConfig } } : {}),
    }));
    const byId = new Map(current.map((n) => [n.id, n]));
    const ordered: AgentNodeConfig[] = [];

    for (const fallback of this.cloneDefaultNodes()) {
      const existing = byId.get(fallback.id);
      if (existing) {
        ordered.push({
          ...fallback,
          ...existing,
          rfPosition: existing.rfPosition ?? fallback.rfPosition,
        });
        byId.delete(fallback.id);
      } else {
        ordered.push(fallback);
      }
    }

    const customNodes = current
      .filter((n) => byId.has(n.id))
      .sort((a, b) => a.position - b.position);
    ordered.push(...customNodes);

    return ordered.map((n, idx) => ({
      ...n,
      position: idx,
      rfPosition: n.rfPosition ?? { x: 300, y: idx * 160 },
    }));
  }

  private async ensureEntityNormalized(
    entity: BookAgentPipelineEntity,
  ): Promise<BookAgentPipelineEntity> {
    const normalizedDraft = this.normalizeNodes(entity.draftNodes);
    const normalizedPublished = entity.publishedNodes
      ? this.normalizeNodes(entity.publishedNodes)
      : null;
    const changed =
      JSON.stringify(normalizedDraft) !== JSON.stringify(entity.draftNodes) ||
      JSON.stringify(normalizedPublished) !== JSON.stringify(entity.publishedNodes);
    if (!changed) return entity;

    entity.draftNodes = normalizedDraft;
    entity.publishedNodes = normalizedPublished;
    await this.pipelineRepo.save(entity);
    return entity;
  }

  private toView(entity: BookAgentPipelineEntity): PipelineView {
    const isDifferent = JSON.stringify(entity.draftNodes) !== JSON.stringify(entity.publishedNodes);
    return {
      bookId: entity.bookId,
      draftNodes: entity.draftNodes,
      publishedNodes: entity.publishedNodes,
      publishedAt: entity.publishedAt?.toISOString() ?? null,
      hasDraft: isDifferent,
      workflowParams: { ...DEFAULT_WORKFLOW_PARAMS, ...(entity.workflowParams ?? {}) },
    };
  }
}
