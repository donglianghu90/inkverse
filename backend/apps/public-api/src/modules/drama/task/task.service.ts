/** Drama 任务服务 — 创建/状态流转/心跳/查询 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, LessThan } from 'typeorm';
import { DramaTaskEntity } from '../entities/task.entity';
import { DramaTaskPayload, DramaTaskStatus, DRAMA_TASK_STATUS, isTerminal } from './types';

@Injectable()
export class DramaTaskService {
  private readonly logger = new Logger(DramaTaskService.name);

  constructor(@InjectRepository(DramaTaskEntity) private readonly repo: Repository<DramaTaskEntity>) {}

  async createTask(input: Omit<DramaTaskPayload, 'taskId'>): Promise<{ task: DramaTaskEntity; deduped: boolean }> {
    if (input.payload?.dedupeKey) { // 幂等去重：相同 dedupeKey 且未终态的任务直接返回
      const existing = await this.repo.findOne({ where: { dedupeKey: String(input.payload.dedupeKey), status: Not(In(['completed', 'failed', 'cancelled'])) } });
      if (existing) return { task: existing, deduped: true };
    }
    const task = await this.repo.save(this.repo.create({
      userId: input.userId, dramaId: input.dramaId, episodeNumber: input.episodeNumber,
      type: input.type, targetType: input.targetType, targetId: input.targetId,
      payload: input.payload, priority: input.priority ?? 0,
      maxAttempts: input.maxAttempts ?? 3, dedupeKey: input.payload?.dedupeKey ? String(input.payload.dedupeKey) : null,
    }));
    return { task, deduped: false };
  }

  async tryMarkProcessing(taskId: string): Promise<boolean> { // 乐观锁状态流转
    const r = await this.repo.update({ id: taskId, status: DRAMA_TASK_STATUS.QUEUED }, { status: DRAMA_TASK_STATUS.PROCESSING, startedAt: new Date() });
    return (r.affected ?? 0) > 0;
  }

  async tryMarkCompleted(taskId: string, result?: Record<string, unknown>): Promise<boolean> {
    const r = await this.repo.update({ id: taskId, status: DRAMA_TASK_STATUS.PROCESSING }, { status: DRAMA_TASK_STATUS.COMPLETED, result: result ?? null, finishedAt: new Date() });
    return (r.affected ?? 0) > 0;
  }

  async tryMarkFailed(taskId: string, errorCode: string, errorMessage: string): Promise<boolean> {
    const r = await this.repo.update({ id: taskId, status: Not(In(['completed', 'cancelled'])) }, { status: DRAMA_TASK_STATUS.FAILED, errorCode, errorMessage, finishedAt: new Date() });
    return (r.affected ?? 0) > 0;
  }

  async touchHeartbeat(taskId: string): Promise<void> { await this.repo.update(taskId, { heartbeatAt: new Date() }); }

  async updateProgress(taskId: string, progress: number): Promise<void> {
    await this.repo.update({ id: taskId, status: DRAMA_TASK_STATUS.PROCESSING }, { progress: Math.min(99, Math.max(0, progress)) });
  }

  async findById(taskId: string): Promise<DramaTaskEntity | null> { return this.repo.findOne({ where: { id: taskId } }); }

  async findByDrama(dramaId: string): Promise<DramaTaskEntity[]> { return this.repo.find({ where: { dramaId }, order: { createdAt: 'DESC' } }); }

  async findActiveTasks(dramaId: string, type?: string): Promise<DramaTaskEntity[]> { // 查找活跃任务
    const where: any = { dramaId, status: In([DRAMA_TASK_STATUS.QUEUED, DRAMA_TASK_STATUS.PROCESSING]) };
    if (type) where.type = type;
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }

  async findStuckTasks(timeoutMs = 60_000): Promise<DramaTaskEntity[]> { // 检测僵死任务（心跳超时）
    const cutoff = new Date(Date.now() - timeoutMs);
    return this.repo.find({ where: { status: DRAMA_TASK_STATUS.PROCESSING, heartbeatAt: LessThan(cutoff) } });
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const r = await this.repo.update({ id: taskId, status: Not(In(['completed', 'failed', 'cancelled'])) }, { status: DRAMA_TASK_STATUS.CANCELLED, finishedAt: new Date() });
    return (r.affected ?? 0) > 0;
  }

  async cancelAndDeleteByDrama(dramaId: string): Promise<number> {
    await this.repo.update(
      { dramaId, status: In([DRAMA_TASK_STATUS.QUEUED, DRAMA_TASK_STATUS.PROCESSING]) },
      { status: DRAMA_TASK_STATUS.CANCELLED, finishedAt: new Date() },
    );
    const r = await this.repo.delete({ dramaId });
    return r.affected ?? 0;
  }
}
