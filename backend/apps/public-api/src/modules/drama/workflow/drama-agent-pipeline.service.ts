/** Drama Agent Pipeline CRUD 服务 — 管理短剧 Pipeline 草稿/发布与工作流参数 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DramaAgentPipelineEntity,
  DEFAULT_DRAMA_PIPELINE_NODES, DEFAULT_DRAMA_WORKFLOW_PARAMS,
} from '../entities/drama-agent-pipeline.entity';
import { DramaWorkflowTopologyService } from './drama-workflow-topology.service';
import type { DramaAgentNodeConfig, DramaWorkflowParams, DramaPipelineView, DramaWorkflowTopology } from '../interfaces';

const CORE_NODE_IDS = ['arc-director', 'episode-director', 'scriptwriter', 'storyboard-director', 'deterministic-checker', 'episode-recorder'];

@Injectable()
export class DramaAgentPipelineService {
  private readonly logger = new Logger(DramaAgentPipelineService.name);

  constructor(
    @InjectRepository(DramaAgentPipelineEntity) private readonly repo: Repository<DramaAgentPipelineEntity>,
    private readonly topologyService: DramaWorkflowTopologyService,
  ) {}

  async initDefault(dramaId: string): Promise<void> {
    if (await this.repo.findOneBy({ dramaId })) return;
    await this.repo.save(this.repo.create({
      dramaId, draftNodes: this.cloneDefaults(), publishedNodes: this.cloneDefaults(), publishedAt: new Date(),
    }));
    this.logger.log(`[DramaPipeline] 默认 pipeline 已初始化 dramaId=${dramaId}`);
  }

  async getPipeline(dramaId: string): Promise<DramaPipelineView> {
    let entity = await this.repo.findOneBy({ dramaId });
    if (!entity) { await this.initDefault(dramaId); entity = await this.repo.findOneBy({ dramaId }); }
    entity = await this.ensureNormalized(entity!);
    return this.toView(entity);
  }

  async saveDraft(dramaId: string, nodes: DramaAgentNodeConfig[]): Promise<DramaPipelineView> {
    const normalized = this.normalize(nodes);
    this.validateCoreNodes(normalized);
    let entity = await this.repo.findOneBy({ dramaId });
    if (!entity) { await this.initDefault(dramaId); entity = await this.repo.findOneBy({ dramaId }); }
    entity!.draftNodes = normalized;
    await this.repo.save(entity!);
    this.logger.log(`[DramaPipeline] 草稿已保存 dramaId=${dramaId} nodes=${normalized.length}`);
    return this.toView(entity!);
  }

  async publish(dramaId: string): Promise<DramaPipelineView> {
    let entity = await this.repo.findOneBy({ dramaId });
    if (!entity) throw new NotFoundException(`Pipeline not found: ${dramaId}`);
    entity = await this.ensureNormalized(entity);
    entity.publishedNodes = this.normalize(entity.draftNodes);
    entity.publishedAt = new Date();
    await this.repo.save(entity);
    this.logger.log(`[DramaPipeline] 已发布 dramaId=${dramaId}`);
    return this.toView(entity);
  }

  async saveWorkflowParams(dramaId: string, params: Partial<DramaWorkflowParams>): Promise<DramaPipelineView> {
    let entity = await this.repo.findOneBy({ dramaId });
    if (!entity) { await this.initDefault(dramaId); entity = await this.repo.findOneBy({ dramaId }); }
    entity!.workflowParams = { ...DEFAULT_DRAMA_WORKFLOW_PARAMS, ...(entity!.workflowParams ?? {}), ...params };
    await this.repo.save(entity!);
    this.logger.log(`[DramaPipeline] workflowParams 已更新 dramaId=${dramaId}`);
    return this.toView(entity!);
  }

  async getPublishedNodes(dramaId: string): Promise<DramaAgentNodeConfig[]> {
    const entity = await this.repo.findOneBy({ dramaId });
    if (!entity?.publishedNodes) return this.cloneDefaults();
    const normalized = this.normalize(entity.publishedNodes);
    if (JSON.stringify(normalized) !== JSON.stringify(entity.publishedNodes)) {
      entity.publishedNodes = normalized;
      await this.repo.save(entity);
    }
    return normalized;
  }

  async getWorkflowParams(dramaId: string): Promise<DramaWorkflowParams> {
    const entity = await this.repo.findOneBy({ dramaId });
    return { ...DEFAULT_DRAMA_WORKFLOW_PARAMS, ...(entity?.workflowParams ?? {}) };
  }

  async getTopology(dramaId: string): Promise<DramaWorkflowTopology> {
    const view = await this.getPipeline(dramaId);
    return this.topologyService.buildTopology(view.draftNodes, view.workflowParams);
  }

  private validateCoreNodes(nodes: DramaAgentNodeConfig[]): void {
    for (const coreId of CORE_NODE_IDS) {
      const node = nodes.find((n) => n.id === coreId);
      if (!node) throw new BadRequestException(`核心节点 ${coreId} 不能删除`);
      if (!node.isEnabled) throw new BadRequestException(`核心节点 ${coreId} 不能禁用`);
    }
  }

  private cloneDefaults(): DramaAgentNodeConfig[] {
    return DEFAULT_DRAMA_PIPELINE_NODES.map((n) => ({ ...n, rfPosition: { ...n.rfPosition }, ...(n.customConfig ? { customConfig: { ...n.customConfig } } : {}) }));
  }

  private normalize(nodes: DramaAgentNodeConfig[] | null | undefined): DramaAgentNodeConfig[] {
    const current = (nodes ?? []).map((n) => ({ ...n, rfPosition: { ...(n.rfPosition ?? { x: 300, y: 0 }) }, ...(n.customConfig ? { customConfig: { ...n.customConfig } } : {}) }));
    const byId = new Map(current.map((n) => [n.id, n]));
    const ordered: DramaAgentNodeConfig[] = [];
    for (const fallback of this.cloneDefaults()) {
      const existing = byId.get(fallback.id);
      if (existing) { ordered.push({ ...fallback, ...existing, rfPosition: existing.rfPosition ?? fallback.rfPosition }); byId.delete(fallback.id); }
      else ordered.push(fallback);
    }
    ordered.push(...current.filter((n) => byId.has(n.id)).sort((a, b) => a.position - b.position));
    return ordered.map((n, idx) => ({ ...n, position: idx, rfPosition: n.rfPosition ?? { x: 300, y: idx * 160 } }));
  }

  private async ensureNormalized(entity: DramaAgentPipelineEntity): Promise<DramaAgentPipelineEntity> {
    const normDraft = this.normalize(entity.draftNodes);
    const normPub = entity.publishedNodes ? this.normalize(entity.publishedNodes) : null;
    const changed = JSON.stringify(normDraft) !== JSON.stringify(entity.draftNodes) || JSON.stringify(normPub) !== JSON.stringify(entity.publishedNodes);
    if (!changed) return entity;
    entity.draftNodes = normDraft;
    entity.publishedNodes = normPub;
    await this.repo.save(entity);
    return entity;
  }

  async deleteByDrama(dramaId: string): Promise<void> {
    await this.repo.delete({ dramaId });
  }

  private toView(entity: DramaAgentPipelineEntity): DramaPipelineView {
    return {
      dramaId: entity.dramaId,
      draftNodes: entity.draftNodes,
      publishedNodes: entity.publishedNodes,
      publishedAt: entity.publishedAt?.toISOString() ?? null,
      hasDraft: JSON.stringify(entity.draftNodes) !== JSON.stringify(entity.publishedNodes),
      workflowParams: { ...DEFAULT_DRAMA_WORKFLOW_PARAMS, ...(entity.workflowParams ?? {}) },
    };
  }
}
