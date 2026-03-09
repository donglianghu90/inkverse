/** 任务提交服务 — 创建任务记录+入队，统一入口 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DramaTaskService } from './task.service';
import { DramaTaskPayload, DramaTaskType, DRAMA_QUEUE, TASK_TYPE_QUEUE_MAP } from './types';

@Injectable()
export class TaskSubmitterService {
  private readonly logger = new Logger(TaskSubmitterService.name);
  private readonly queues: Record<string, Queue>;

  constructor(
    private readonly taskService: DramaTaskService,
    @InjectQueue(DRAMA_QUEUE.TEXT) private readonly textQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.IMAGE) private readonly imageQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.VIDEO) private readonly videoQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.VOICE) private readonly voiceQueue: Queue,
  ) {
    this.queues = { [DRAMA_QUEUE.TEXT]: textQueue, [DRAMA_QUEUE.IMAGE]: imageQueue, [DRAMA_QUEUE.VIDEO]: videoQueue, [DRAMA_QUEUE.VOICE]: voiceQueue };
  }

  async submit(input: { // 提交任务：创建记录→入队
    userId: string; dramaId: string; episodeNumber?: number; type: DramaTaskType;
    targetType: string; targetId: string; payload?: Record<string, unknown>;
    priority?: number; maxAttempts?: number;
  }): Promise<{ taskId: string; deduped: boolean }> {
    const { task, deduped } = await this.taskService.createTask(input);
    if (deduped) { this.logger.log(`任务去重 taskId=${task.id} type=${input.type}`); return { taskId: task.id, deduped: true }; }

    const queueName = TASK_TYPE_QUEUE_MAP[input.type];
    const queue = this.queues[queueName];
    if (!queue) throw new Error(`队列 ${queueName} 未注册`);

    try {
      const jobData: DramaTaskPayload = { taskId: task.id, type: input.type, dramaId: input.dramaId, userId: input.userId,
        episodeNumber: input.episodeNumber, targetType: input.targetType, targetId: input.targetId,
        payload: input.payload, priority: input.priority, maxAttempts: input.maxAttempts ?? 3 };
      await queue.add(input.type, jobData, {
        priority: input.priority ?? 0, attempts: input.maxAttempts ?? 3,
        backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 200,
      });
      this.logger.log(`任务入队 taskId=${task.id} queue=${queueName} type=${input.type}`);
    } catch (err) {
      await this.taskService.tryMarkFailed(task.id, 'QUEUE_ERROR', (err as Error).message);
      throw err;
    }
    return { taskId: task.id, deduped: false };
  }
}
