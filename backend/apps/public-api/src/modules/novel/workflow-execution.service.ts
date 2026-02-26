/** 工作流执行记录收集与查询服务 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowExecutionEntity, NodeExecution, ExecutionSummary, NodeStatus } from './entities/workflow-execution.entity';

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name);

  constructor(
    @InjectRepository(WorkflowExecutionEntity)
    private readonly repo: Repository<WorkflowExecutionEntity>,
  ) {}

  async createRun(bookId: string, chapterNumber: number): Promise<string> {
    const entity = this.repo.create({ bookId, chapterNumber, nodes: [], summary: null, status: 'running' });
    const saved = await this.repo.save(entity);
    return saved.id;
  }

  async recordNode(runId: string, node: NodeExecution): Promise<void> {
    const entity = await this.repo.findOneBy({ id: runId });
    if (!entity) return;
    const idx = entity.nodes.findIndex((n) => n.nodeId === node.nodeId && n.loopAttempt === node.loopAttempt);
    if (idx >= 0) entity.nodes[idx] = { ...entity.nodes[idx], ...node };
    else entity.nodes.push(node);
    await this.repo.save(entity);
  }

  async completeRun(runId: string, summary: ExecutionSummary, status: 'completed' | 'failed' = 'completed'): Promise<void> {
    await this.repo.update(runId, { summary, status, completedAt: new Date() });
  }

  async getLatestRun(bookId: string, chapterNumber: number): Promise<WorkflowExecutionEntity | null> {
    return this.repo.findOne({ where: { bookId, chapterNumber }, order: { createdAt: 'DESC' } });
  }

  async listRuns(bookId: string, limit = 20): Promise<WorkflowExecutionEntity[]> {
    return this.repo.find({ where: { bookId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
