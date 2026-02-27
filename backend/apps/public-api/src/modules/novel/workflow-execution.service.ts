/** 工作流执行记录收集、检查点、故障恢复服务 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { WorkflowExecutionEntity, NodeExecution, ExecutionSummary, ExecutionStatus } from './entities/workflow-execution.entity';

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name);

  constructor(
    @InjectRepository(WorkflowExecutionEntity)
    private readonly repo: Repository<WorkflowExecutionEntity>,
  ) {}

  async createRun(bookId: string, chapterNumber: number): Promise<string> {
    const entity = this.repo.create({ bookId, chapterNumber, nodes: [], summary: null, status: 'running', lastCheckpoint: null, failureReason: null });
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

  async saveCheckpoint(runId: string, checkpoint: string): Promise<void> {
    await this.repo.update(runId, { lastCheckpoint: checkpoint }).catch((e) =>
      this.logger.warn(`检查点保存失败 runId=${runId}: ${e.message}`),
    );
  }

  async completeRun(runId: string, summary: ExecutionSummary, status: ExecutionStatus = 'completed'): Promise<void> {
    await this.repo.update(runId, { summary, status, completedAt: new Date() });
  }

  async failRun(runId: string, reason: string, summary?: ExecutionSummary): Promise<void> {
    await this.repo.update(runId, { status: 'failed', failureReason: reason, completedAt: new Date(), ...(summary ? { summary } : {}) });
  }

  async findStaleRuns(timeoutMs: number): Promise<WorkflowExecutionEntity[]> {
    const cutoff = new Date(Date.now() - timeoutMs);
    return this.repo.find({ where: { status: 'running', createdAt: LessThan(cutoff) } });
  }

  async markInterrupted(ids: string[], reason = '服务重启，任务中断'): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await this.repo.createQueryBuilder().update()
      .set({ status: 'interrupted' as ExecutionStatus, failureReason: reason, completedAt: new Date() })
      .whereInIds(ids).execute();
    return result.affected ?? 0;
  }

  async getLatestRun(bookId: string, chapterNumber: number): Promise<WorkflowExecutionEntity | null> {
    return this.repo.findOne({ where: { bookId, chapterNumber }, order: { createdAt: 'DESC' } });
  }

  async listRuns(bookId: string, limit = 20): Promise<WorkflowExecutionEntity[]> {
    return this.repo.find({ where: { bookId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
