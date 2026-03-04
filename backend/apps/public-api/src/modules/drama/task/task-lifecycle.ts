/** Worker 生命周期包装 — 心跳、状态流转、错误归一化、重试决策 */
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DramaTaskPayload } from './types';
import { DramaTaskService } from './task.service';
import { normalizeError } from '../errors';

export interface TaskLifecycleContext { taskService: DramaTaskService; logger: Logger; }

export async function withTaskLifecycle( // 统一 Worker 执行包装
  ctx: TaskLifecycleContext, job: Job<DramaTaskPayload>,
  handler: (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>,
): Promise<void> {
  const { taskService, logger } = ctx;
  const { taskId, type } = job.data;
  const startedAt = Date.now();
  const heartbeat = setInterval(() => taskService.touchHeartbeat(taskId).catch(() => {}), 10_000); // 每10秒心跳

  try {
    const marked = await taskService.tryMarkProcessing(taskId);
    if (!marked) { logger.warn(`[${taskId}] 任务非 queued 状态，跳过执行`); return; } // 非 queued 状态跳过

    logger.log(`[${taskId}] Worker 开始执行 type=${type}`);
    const result = await handler(job);

    const completed = await taskService.tryMarkCompleted(taskId, (result as Record<string, unknown>) ?? undefined);
    if (!completed) { logger.warn(`[${taskId}] 标记完成失败（已终态）`); return; }
    logger.log(`[${taskId}] 执行完成 duration=${Date.now() - startedAt}ms`);
  } catch (error: unknown) {
    const normalized = normalizeError(error, { context: 'worker' });
    const canRetry = normalized.retryable && (job.attemptsMade + 1) < (job.data.maxAttempts ?? 3);
    logger.error(`[${taskId}] 执行失败 code=${normalized.code} retryable=${canRetry} msg=${normalized.message}`);

    if (canRetry) throw error; // 抛出让 BullMQ 自动重试
    await taskService.tryMarkFailed(taskId, normalized.code, normalized.message); // 终态标记失败
  } finally {
    clearInterval(heartbeat);
  }
}

export function computeBackoff(attempt: number, baseMs = 2000, maxMs = 30_000): number { // 指数退避策略
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 500, maxMs);
}
