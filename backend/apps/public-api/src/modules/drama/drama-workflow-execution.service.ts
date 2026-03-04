/** 短剧工作流执行记录、检查点、故障恢复 + 断点续传服务 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';

type DramaExecStatus = DramaWorkflowExecutionEntity['status'];
export interface DramaExecutionSummary { overallScore?: number; shotCount?: number; duration?: number; totalDurationMs: number; editRounds: number; }

const STALE_THRESHOLD_MS = 60_000; // running超60s视为可恢复
const DEFAULT_INSTANCE_ID = `${process.env.HOSTNAME ?? 'local'}-${process.pid}`;
const HB_SQL = `COALESCE("heartbeat_at", "created_at")`; // 心跳锚点

@Injectable()
export class DramaWorkflowExecutionService {
  private readonly logger = new Logger(DramaWorkflowExecutionService.name);
  private readonly instanceId = process.env.WORKFLOW_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;

  constructor(@InjectRepository(DramaWorkflowExecutionEntity) private readonly repo: Repository<DramaWorkflowExecutionEntity>) {}

  getInstanceId(): string { return this.instanceId; }

  async assertOwnership(runId: string): Promise<boolean> { // 断言当前实例持有执行权
    const count = await this.repo.createQueryBuilder('e')
      .where('e.id = :id', { id: runId })
      .andWhere('e.status = :status', { status: 'running' as DramaExecStatus })
      .andWhere('e.ownerInstanceId = :owner', { owner: this.instanceId })
      .getCount();
    return count > 0;
  }

  async createRun(dramaId: string, episodeNumber: number): Promise<string> { // 创建运行记录（复用已有活跃运行）
    const existing = await this.repo.findOne({
      where: { dramaId, episodeNumber, status: 'running' as DramaExecStatus, ownerInstanceId: this.instanceId },
    });
    if (existing) {
      this.logger.warn(`[createRun] 已存在活跃运行 runId=${existing.id}，复用`);
      return existing.id;
    }
    const saved = await this.repo.save(this.repo.create({
      dramaId, episodeNumber, status: 'running' as DramaExecStatus,
      ownerInstanceId: this.instanceId, heartbeatAt: new Date(),
      lastCheckpoint: '', stepOutputs: {}, summary: null, errorMessage: '',
    }));
    return saved.id;
  }

  async touchHeartbeat(runId: string): Promise<boolean> { // 续命心跳（仅当前owner可写）
    const r = await this.repo.createQueryBuilder().update()
      .set({ heartbeatAt: new Date() })
      .where('id = :id', { id: runId })
      .andWhere('status = :s', { s: 'running' as DramaExecStatus })
      .andWhere('owner_instance_id = :o', { o: this.instanceId })
      .execute();
    if ((r.affected ?? 0) === 0) this.logger.warn(`心跳被拒绝 runId=${runId}`);
    return (r.affected ?? 0) > 0;
  }

  async saveCheckpoint(runId: string, checkpoint: string): Promise<boolean> { // 原子保存检查点
    const r = await this.repo.createQueryBuilder().update()
      .set({ lastCheckpoint: checkpoint })
      .where('id = :id', { id: runId })
      .andWhere('status = :s', { s: 'running' as DramaExecStatus })
      .andWhere('owner_instance_id = :o', { o: this.instanceId })
      .execute();
    if ((r.affected ?? 0) === 0) this.logger.warn(`检查点被拒绝 runId=${runId} cp=${checkpoint}`);
    return (r.affected ?? 0) > 0;
  }

  async saveStepOutput(runId: string, step: string, output: unknown): Promise<boolean> { // 原子合并步骤产物到JSONB
    const r = await this.repo.createQueryBuilder().update()
      .set({ stepOutputs: () => `COALESCE(step_outputs, '{}'::jsonb) || :patch::jsonb` })
      .setParameter('patch', JSON.stringify({ [step]: output ?? null }))
      .where('id = :id', { id: runId })
      .andWhere('status = :s', { s: 'running' as DramaExecStatus })
      .andWhere('owner_instance_id = :o', { o: this.instanceId })
      .execute();
    if ((r.affected ?? 0) === 0) this.logger.warn(`步骤输出被拒绝 runId=${runId} step=${step}`);
    return (r.affected ?? 0) > 0;
  }

  private isStale(run: DramaWorkflowExecutionEntity, now: number): boolean {
    return now - (run.heartbeatAt ?? run.createdAt).getTime() >= STALE_THRESHOLD_MS;
  }

  async findResumableRun(dramaId: string, episodeNumber: number): Promise<DramaWorkflowExecutionEntity | null> { // 查找可恢复运行
    const runs = await this.repo.createQueryBuilder('e')
      .where('e.dramaId = :dramaId', { dramaId })
      .andWhere('e.episodeNumber = :ep', { ep: episodeNumber })
      .andWhere('e.status IN (:...ss)', { ss: ['interrupted', 'running', 'failed'] })
      .orderBy('e.createdAt', 'DESC').take(100).getMany();
    const now = Date.now();
    for (const run of runs) {
      if (!run.stepOutputs || Object.keys(run.stepOutputs).length === 0) continue;
      if (run.status === 'running' && !this.isStale(run, now)) continue;
      return run;
    }
    return null;
  }

  async reopenRun(runId: string): Promise<boolean> { // 原子恢复运行（interrupted/failed/stale→running）
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const r = await this.repo.createQueryBuilder().update()
      .set({ status: 'running' as DramaExecStatus, ownerInstanceId: this.instanceId, heartbeatAt: new Date(), errorMessage: '' })
      .where('id = :id', { id: runId })
      .andWhere(`(status IN (:...rec) OR (status = :run AND ${HB_SQL} < :cut))`, { rec: ['interrupted', 'failed'], run: 'running', cut: cutoff })
      .execute();
    return (r.affected ?? 0) > 0;
  }

  async completeRun(runId: string, summary: DramaExecutionSummary): Promise<boolean> { // 标记完成
    const r = await this.repo.createQueryBuilder().update()
      .set({ summary: summary as unknown as Record<string, unknown>, status: 'completed' as DramaExecStatus, heartbeatAt: new Date() })
      .where('id = :id', { id: runId })
      .andWhere('status = :s', { s: 'running' as DramaExecStatus })
      .andWhere('owner_instance_id = :o', { o: this.instanceId })
      .execute();
    return (r.affected ?? 0) > 0;
  }

  async failRun(runId: string, reason: string): Promise<boolean> { // 标记失败
    const r = await this.repo.createQueryBuilder().update()
      .set({ status: 'failed' as DramaExecStatus, errorMessage: reason.slice(0, 2000), heartbeatAt: new Date() })
      .where('id = :id', { id: runId })
      .andWhere('status = :s', { s: 'running' as DramaExecStatus })
      .andWhere('owner_instance_id = :o', { o: this.instanceId })
      .execute();
    return (r.affected ?? 0) > 0;
  }

  async markStaleRunsInterrupted(timeoutMs: number, reason = '服务重启，任务中断', ownerOnly = false): Promise<number> { // 批量标记超时运行
    const qb = this.repo.createQueryBuilder().update()
      .set({ status: 'interrupted' as DramaExecStatus, errorMessage: reason, heartbeatAt: new Date() })
      .where('status = :s', { s: 'running' as DramaExecStatus });
    if (timeoutMs > 0) qb.andWhere(`${HB_SQL} < :cut`, { cut: new Date(Date.now() - timeoutMs) });
    if (ownerOnly) qb.andWhere('owner_instance_id = :o', { o: this.instanceId });
    return (await qb.execute()).affected ?? 0;
  }

  async getLatestRun(dramaId: string, episodeNumber: number): Promise<DramaWorkflowExecutionEntity | null> {
    return this.repo.findOne({ where: { dramaId, episodeNumber }, order: { createdAt: 'DESC' } });
  }

  async listRuns(dramaId: string, limit = 20): Promise<DramaWorkflowExecutionEntity[]> {
    return this.repo.find({ where: { dramaId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
