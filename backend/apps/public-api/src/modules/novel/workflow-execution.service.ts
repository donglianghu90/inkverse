/** 工作流执行记录收集、检查点、故障恢复 + 断点续传服务 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowExecutionEntity, NodeExecution, ExecutionSummary, ExecutionStatus } from './entities/workflow-execution.entity';

const RESUME_STALE_THRESHOLD_MS = 60_000; // running 状态超过1分钟才视为可恢复（避免误抢活跃任务）
const DEFAULT_INSTANCE_ID = `${process.env.HOSTNAME ?? 'local'}-${process.pid}`;
const HEARTBEAT_WINDOW_SQL = `COALESCE(heartbeat_at, created_at)`;

@Injectable()
export class WorkflowExecutionService {
  private readonly logger = new Logger(WorkflowExecutionService.name);
  private readonly instanceId = process.env.WORKFLOW_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;

  constructor(
    @InjectRepository(WorkflowExecutionEntity)
    private readonly repo: Repository<WorkflowExecutionEntity>,
  ) {}

  getInstanceId(): string { return this.instanceId; }

  async assertOwnership(runId: string): Promise<boolean> {
    const count = await this.repo.createQueryBuilder('e')
      .where('e.id = :id', { id: runId })
      .andWhere('e.status = :status', { status: 'running' as ExecutionStatus })
      .andWhere('e.ownerInstanceId = :owner', { owner: this.instanceId })
      .getCount();
    return count > 0;
  }

  private isRunStale(run: WorkflowExecutionEntity, now: number): boolean {
    const anchor = run.heartbeatAt ?? run.createdAt;
    return now - anchor.getTime() >= RESUME_STALE_THRESHOLD_MS;
  }

  async createRun(bookId: string, chapterNumber: number): Promise<string> {
    const existing = await this.repo.findOne({
      where: { bookId, chapterNumber, status: 'running' as ExecutionStatus, ownerInstanceId: this.instanceId },
    });
    if (existing) {
      this.logger.warn(`[createRun] 已存在活跃运行 runId=${existing.id}，复用`);
      return existing.id;
    }
    const entity = this.repo.create({
      bookId,
      chapterNumber,
      nodes: [],
      stepOutputs: {},
      summary: null,
      status: 'running',
      ownerInstanceId: this.instanceId,
      heartbeatAt: new Date(),
      lastCheckpoint: null,
      failureReason: null,
    });
    const saved = await this.repo.save(entity);
    return saved.id;
  }

  async recordNode(runId: string, node: NodeExecution): Promise<boolean> {
    const nodeJson = JSON.stringify(node);
    const result = await this.repo.createQueryBuilder().update()
      .set({
        nodes: () => `(
          SELECT COALESCE(jsonb_agg(
            CASE WHEN elem->>'nodeId' = :nodeId AND (elem->>'loopAttempt')::int = :loopAttempt
                 THEN :nodeJson::jsonb ELSE elem END
          ), '[]'::jsonb)
          || CASE WHEN NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(nodes) AS e WHERE e->>'nodeId' = :nodeId AND (e->>'loopAttempt')::int = :loopAttempt
          ) THEN jsonb_build_array(:nodeJson::jsonb) ELSE '[]'::jsonb END
          FROM jsonb_array_elements(COALESCE(nodes, '[]'::jsonb)) AS elem
        )`,
      })
      .setParameter('nodeId', node.nodeId)
      .setParameter('loopAttempt', node.loopAttempt ?? 0)
      .setParameter('nodeJson', nodeJson)
      .where('id = :id', { id: runId })
      .andWhere('status = :status', { status: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(`节点记录被拒绝（owner/status不匹配）runId=${runId} nodeId=${node.nodeId}`);
    }
    return (result.affected ?? 0) > 0;
  }

  async saveCheckpoint(runId: string, checkpoint: string): Promise<boolean> {
    const result = await this.repo.createQueryBuilder().update()
      .set({ lastCheckpoint: checkpoint })
      .where('id = :id', { id: runId })
      .andWhere('status = :status', { status: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(`检查点保存被拒绝（owner/status不匹配）runId=${runId}`);
    }
    return (result.affected ?? 0) > 0;
  }

  /** 续命心跳（仅当前owner可写） */
  async touchHeartbeat(runId: string): Promise<boolean> {
    const result = await this.repo.createQueryBuilder().update()
      .set({ heartbeatAt: new Date() })
      .where('id = :id', { id: runId })
      .andWhere('status = :status', { status: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(`心跳更新被拒绝（owner/status不匹配）runId=${runId}`);
    }
    return (result.affected ?? 0) > 0;
  }

  /** 原子性合并单步输出到 stepOutputs JSONB，避免全量读写 */
  async saveStepOutput(runId: string, step: string, output: unknown): Promise<boolean> {
    const result = await this.repo.createQueryBuilder().update()
      .set({ stepOutputs: () => `COALESCE(step_outputs, '{}'::jsonb) || :patch::jsonb` })
      .setParameter('patch', JSON.stringify({ [step]: output ?? null }))
      .where('id = :id', { id: runId })
      .andWhere('status = :status', { status: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    if ((result.affected ?? 0) === 0) {
      this.logger.warn(`步骤输出保存被拒绝（owner/status不匹配）runId=${runId} step=${step}`);
    }
    return (result.affected ?? 0) > 0;
  }

  /** 查找可恢复运行（interrupted / stale running / failed，且有缓存步骤） */
  async findResumableRun(bookId: string, chapterNumber: number): Promise<WorkflowExecutionEntity | null> {
    const runs = await this.repo.createQueryBuilder('e')
      .where('e.bookId = :bookId', { bookId })
      .andWhere('e.chapterNumber = :chapterNumber', { chapterNumber })
      .andWhere('e.status IN (:...statuses)', { statuses: ['interrupted', 'running', 'failed'] })
      .orderBy('e.createdAt', 'DESC')
      .take(100) // 扩大窗口，避免多次重试后把更早但有缓存的可恢复运行挤出范围
      .getMany();
    const now = Date.now();
    for (const run of runs) {
      const hasCache = run.stepOutputs && Object.keys(run.stepOutputs).length > 0;
      if (!hasCache) continue;
      if (run.status === 'running' && !this.isRunStale(run, now)) continue; // 活跃任务不抢
      return run;
    }
    return null;
  }

  /** 恢复运行：将 interrupted/failed/stale 重置为 running，返回是否成功 */
  async reopenRun(runId: string): Promise<boolean> {
    const staleCutoff = new Date(Date.now() - RESUME_STALE_THRESHOLD_MS);
    const result = await this.repo.createQueryBuilder().update()
      .set({
        status: 'running' as ExecutionStatus,
        ownerInstanceId: this.instanceId,
        heartbeatAt: new Date(),
        failureReason: null,
        completedAt: null,
      })
      .where('id = :id', { id: runId })
      .andWhere(
        `(status IN (:...recoverable) OR (status = :running AND ${HEARTBEAT_WINDOW_SQL} < :staleCutoff))`,
        { recoverable: ['interrupted', 'failed'], running: 'running', staleCutoff },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async completeRun(runId: string, summary: ExecutionSummary, status: ExecutionStatus = 'completed'): Promise<boolean> {
    const result = await this.repo.createQueryBuilder().update()
      .set({ summary, status, completedAt: new Date(), heartbeatAt: new Date() })
      .where('id = :id', { id: runId })
      .andWhere('status = :running', { running: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async failRun(runId: string, reason: string, summary?: ExecutionSummary): Promise<boolean> {
    const result = await this.repo.createQueryBuilder().update()
      .set({ status: 'failed', failureReason: reason, completedAt: new Date(), heartbeatAt: new Date(), ...(summary ? { summary } : {}) })
      .where('id = :id', { id: runId })
      .andWhere('status = :running', { running: 'running' as ExecutionStatus })
      .andWhere('owner_instance_id = :owner', { owner: this.instanceId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** 原子标记 stale running 为 interrupted，避免先查后改的竞态窗口 */
  async markStaleRunsInterrupted(timeoutMs: number, reason = '服务重启，任务中断', ownerOnly = false): Promise<number> {
    const qb = this.repo.createQueryBuilder().update()
      .set({
        status: 'interrupted' as ExecutionStatus,
        failureReason: reason,
        completedAt: new Date(),
        heartbeatAt: new Date(),
      })
      .where('status = :status', { status: 'running' as ExecutionStatus });
    if (timeoutMs > 0) {
      const cutoff = new Date(Date.now() - timeoutMs);
      qb.andWhere(`${HEARTBEAT_WINDOW_SQL} < :cutoff`, { cutoff });
    }
    if (ownerOnly) qb.andWhere('owner_instance_id = :owner', { owner: this.instanceId });
    const result = await qb.execute();
    return result.affected ?? 0;
  }

  async getLatestRun(bookId: string, chapterNumber: number): Promise<WorkflowExecutionEntity | null> {
    return this.repo.findOne({ where: { bookId, chapterNumber }, order: { createdAt: 'DESC' } });
  }

  async listRuns(bookId: string, limit = 20): Promise<WorkflowExecutionEntity[]> {
    return this.repo.find({ where: { bookId }, order: { createdAt: 'DESC' }, take: limit });
  }

  /** 列出可恢复运行（用于诊断日志） */
  async listResumableRuns(limit = 20): Promise<WorkflowExecutionEntity[]> {
    const runs = await this.repo.find({
      where: [{ status: 'interrupted' as ExecutionStatus }, { status: 'failed' as ExecutionStatus }, { status: 'running' as ExecutionStatus }],
      order: { createdAt: 'DESC' },
      take: Math.max(limit * 3, 60),
    });
    const now = Date.now();
    const resumable = runs.filter((r) => {
      const hasCache = r.stepOutputs && Object.keys(r.stepOutputs).length > 0;
      if (!hasCache) return false;
      if (r.status === 'running' && !this.isRunStale(r, now)) return false;
      return true;
    });
    return resumable.slice(0, limit);
  }
}
