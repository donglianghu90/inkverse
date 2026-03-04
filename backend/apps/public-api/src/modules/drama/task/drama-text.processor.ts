/** Drama 文本任务处理器 — BullMQ Processor，分发到各 handler */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DramaTaskPayload, DRAMA_QUEUE } from './types';
import { DramaTaskService } from './task.service';
import { withTaskLifecycle } from './task-lifecycle';

@Injectable()
@Processor(DRAMA_QUEUE.TEXT, { concurrency: 3 })
export class DramaTextProcessor extends WorkerHost {
  private readonly logger = new Logger(DramaTextProcessor.name);
  private handlers = new Map<string, (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>>();

  constructor(private readonly taskService: DramaTaskService) { super(); }

  registerHandler(type: string, handler: (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>): void { // 注册任务处理器
    this.handlers.set(type, handler);
  }

  async process(job: Job<DramaTaskPayload>): Promise<void> {
    await withTaskLifecycle({ taskService: this.taskService, logger: this.logger }, job, async (j) => {
      const handler = this.handlers.get(j.data.type);
      if (!handler) throw new Error(`无匹配 handler: ${j.data.type}`);
      return handler(j);
    });
  }
}
