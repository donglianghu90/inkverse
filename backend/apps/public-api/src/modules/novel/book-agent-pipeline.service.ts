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
  DEFAULT_PIPELINE_NODES,
} from './entities/book-agent-pipeline.entity';

export interface PipelineView {
  bookId: string;
  draftNodes: AgentNodeConfig[];
  publishedNodes: AgentNodeConfig[] | null;
  publishedAt: string | null;
  hasDraft: boolean;
}

@Injectable()
export class BookAgentPipelineService {
  private readonly logger = new Logger(BookAgentPipelineService.name);

  constructor(
    @InjectRepository(BookAgentPipelineEntity)
    private readonly pipelineRepo: Repository<BookAgentPipelineEntity>,
  ) {}

  async initDefault(bookId: string): Promise<void> {
    const existing = await this.pipelineRepo.findOneBy({ bookId });
    if (existing) return;
    await this.pipelineRepo.save(
      this.pipelineRepo.create({
        bookId,
        draftNodes: DEFAULT_PIPELINE_NODES,
        publishedNodes: DEFAULT_PIPELINE_NODES,
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
    return this.toView(entity!);
  }

  async saveDraft(bookId: string, nodes: AgentNodeConfig[]): Promise<PipelineView> {
    this.validateNodes(nodes);
    let entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) {
      await this.initDefault(bookId);
      entity = await this.pipelineRepo.findOneBy({ bookId });
    }
    entity!.draftNodes = nodes;
    await this.pipelineRepo.save(entity!);
    this.logger.log(`[Pipeline] 草稿已保存 bookId=${bookId} nodes=${nodes.length}`);
    return this.toView(entity!);
  }

  async publish(bookId: string): Promise<PipelineView> {
    const entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity) throw new NotFoundException(`Pipeline not found: ${bookId}`);
    entity.publishedNodes = entity.draftNodes;
    entity.publishedAt = new Date();
    await this.pipelineRepo.save(entity);
    this.logger.log(`[Pipeline] 已发布 bookId=${bookId}`);
    return this.toView(entity);
  }

  async getPublishedNodes(bookId: string): Promise<AgentNodeConfig[]> {
    const entity = await this.pipelineRepo.findOneBy({ bookId });
    if (!entity?.publishedNodes) return DEFAULT_PIPELINE_NODES;
    return entity.publishedNodes;
  }

  private validateNodes(nodes: AgentNodeConfig[]): void {
    const coreIds = ['intent', 'creative-writer', 'recorder'];
    for (const coreId of coreIds) {
      const node = nodes.find((n) => n.id === coreId);
      if (!node) throw new BadRequestException(`核心节点 ${coreId} 不能删除`);
      if (!node.isEnabled) throw new BadRequestException(`核心节点 ${coreId} 不能禁用`);
    }
    const writerNode = nodes.find((n) => n.id === 'creative-writer');
    if (!writerNode) throw new BadRequestException('creative-writer 节点不能删除');
  }

  private toView(entity: BookAgentPipelineEntity): PipelineView {
    const isDifferent =
      JSON.stringify(entity.draftNodes) !== JSON.stringify(entity.publishedNodes);
    return {
      bookId: entity.bookId,
      draftNodes: entity.draftNodes,
      publishedNodes: entity.publishedNodes,
      publishedAt: entity.publishedAt?.toISOString() ?? null,
      hasDraft: isDifferent,
    };
  }
}
