/** 运行时服务 — Run 创建/状态流转/事件追加（事务内 seq 递增保证有序） */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThan, In } from 'typeorm';
import type { AppendEventInput } from '../interfaces';
import { DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity } from './entities/run.entity';

export type { RunEventType, AppendEventInput } from '../interfaces';

@Injectable()
export class DramaRunService {
  private readonly logger = new Logger(DramaRunService.name);

  constructor(
    @InjectRepository(DramaGraphRunEntity) private readonly runRepo: Repository<DramaGraphRunEntity>,
    @InjectRepository(DramaGraphStepEntity) private readonly stepRepo: Repository<DramaGraphStepEntity>,
    @InjectRepository(DramaGraphEventEntity) private readonly eventRepo: Repository<DramaGraphEventEntity>,
    private readonly ds: DataSource,
  ) {}

  async createRun(input: { userId: string; dramaId: string; episodeNumber?: number; workflowType: string; taskId?: string; input?: Record<string, unknown> }): Promise<DramaGraphRunEntity> {
    return this.runRepo.save(this.runRepo.create({ ...input, status: 'queued' }));
  }

  async appendEvent(input: AppendEventInput): Promise<{ seq: number }> { // 事务内追加事件 + 递增 seq
    return this.ds.transaction(async (mgr) => {
      const run = await mgr.findOne(DramaGraphRunEntity, { where: { id: input.runId }, lock: { mode: 'pessimistic_write' } });
      if (!run) throw new Error(`Run ${input.runId} 不存在`);
      const seq = run.lastSeq + 1;
      run.lastSeq = seq;
      await mgr.save(DramaGraphRunEntity, run);
      await mgr.save(DramaGraphEventEntity, mgr.create(DramaGraphEventEntity, { runId: input.runId, seq, eventType: input.eventType, stepKey: input.stepKey, attempt: input.attempt, payload: input.payload }));
      await this.updateProjection(mgr, run, input); // 同事务内更新投影
      return { seq };
    });
  }

  private async updateProjection(mgr: any, run: DramaGraphRunEntity, input: AppendEventInput): Promise<void> { // 根据事件类型更新 run/step 投影
    if (input.eventType === 'run.start') { await mgr.update(DramaGraphRunEntity, run.id, { status: 'running', startedAt: new Date() }); }
    if (input.eventType === 'run.complete') { await mgr.update(DramaGraphRunEntity, run.id, { status: 'completed', output: input.payload, finishedAt: new Date() }); }
    if (input.eventType === 'run.error') { await mgr.update(DramaGraphRunEntity, run.id, { status: 'failed', errorCode: input.payload?.code, errorMessage: input.payload?.message, finishedAt: new Date() }); }
    if (input.stepKey && input.eventType === 'step.start') {
      const existing = await mgr.findOne(DramaGraphStepEntity, { where: { runId: run.id, stepKey: input.stepKey } });
      if (existing) { await mgr.update(DramaGraphStepEntity, existing.id, { status: 'running', startedAt: new Date(), currentAttempt: (input.attempt ?? 0) }); }
      else { await mgr.save(DramaGraphStepEntity, mgr.create(DramaGraphStepEntity, { runId: run.id, stepKey: input.stepKey, stepTitle: String(input.payload?.stepTitle ?? input.stepKey), status: 'running', stepIndex: input.payload?.stepIndex ?? 0, stepTotal: input.payload?.stepTotal ?? 1, startedAt: new Date() })); }
    }
    if (input.stepKey && input.eventType === 'step.complete') { await mgr.update(DramaGraphStepEntity, { runId: run.id, stepKey: input.stepKey }, { status: 'completed', finishedAt: new Date() }); }
    if (input.stepKey && input.eventType === 'step.error') { await mgr.update(DramaGraphStepEntity, { runId: run.id, stepKey: input.stepKey }, { status: 'failed', lastErrorMessage: String(input.payload?.message ?? ''), finishedAt: new Date() }); }
  }

  async getEventsSince(runId: string, afterSeq: number): Promise<DramaGraphEventEntity[]> { // 增量拉取事件（SSE 断线恢复）
    return this.eventRepo.find({ where: { runId, seq: MoreThan(afterSeq) }, order: { seq: 'ASC' } });
  }

  async getRun(runId: string): Promise<DramaGraphRunEntity | null> { return this.runRepo.findOne({ where: { id: runId }, relations: ['steps'] }); }

  async getRunByTask(taskId: string): Promise<DramaGraphRunEntity | null> { return this.runRepo.findOne({ where: { taskId }, relations: ['steps'] }); }

  async listRuns(dramaId: string, episodeNumber?: number): Promise<DramaGraphRunEntity[]> {
    const where: any = { dramaId }; if (episodeNumber !== undefined) where.episodeNumber = episodeNumber;
    return this.runRepo.find({ where, order: { createdAt: 'DESC' }, take: 50 });
  }

  async deleteByDrama(dramaId: string): Promise<void> {
    const runs = await this.runRepo.find({ where: { dramaId }, select: ['id'] });
    if (!runs.length) return;
    const runIds = runs.map(r => r.id);
    await this.eventRepo.delete({ runId: In(runIds) });
    await this.stepRepo.delete({ runId: In(runIds) });
    await this.runRepo.delete({ dramaId });
  }
}
