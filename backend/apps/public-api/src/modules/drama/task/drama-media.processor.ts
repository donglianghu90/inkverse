/** Drama 媒体任务处理器 — 图片/视频/语音队列统一入口 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DramaTaskPayload, DRAMA_QUEUE } from './types';
import { DramaTaskService } from './task.service';
import { withTaskLifecycle } from './task-lifecycle';

@Injectable() @Processor(DRAMA_QUEUE.IMAGE, { concurrency: 5 })
export class DramaImageProcessor extends WorkerHost {
  private readonly logger = new Logger(DramaImageProcessor.name);
  private handlers = new Map<string, (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>>();
  constructor(private readonly taskService: DramaTaskService) { super(); }
  registerHandler(type: string, handler: (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>) { this.handlers.set(type, handler); }
  async process(job: Job<DramaTaskPayload>) {
    await withTaskLifecycle({ taskService: this.taskService, logger: this.logger }, job, async (j) => {
      const h = this.handlers.get(j.data.type); if (!h) throw new Error(`无匹配 handler: ${j.data.type}`); return h(j);
    });
  }
}

@Injectable() @Processor(DRAMA_QUEUE.VIDEO, { concurrency: 2 })
export class DramaVideoProcessor extends WorkerHost {
  private readonly logger = new Logger(DramaVideoProcessor.name);
  private handlers = new Map<string, (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>>();
  constructor(private readonly taskService: DramaTaskService) { super(); }
  registerHandler(type: string, handler: (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>) { this.handlers.set(type, handler); }
  async process(job: Job<DramaTaskPayload>) {
    await withTaskLifecycle({ taskService: this.taskService, logger: this.logger }, job, async (j) => {
      const h = this.handlers.get(j.data.type); if (!h) throw new Error(`无匹配 handler: ${j.data.type}`); return h(j);
    });
  }
}

@Injectable() @Processor(DRAMA_QUEUE.VOICE, { concurrency: 5 })
export class DramaVoiceProcessor extends WorkerHost {
  private readonly logger = new Logger(DramaVoiceProcessor.name);
  private handlers = new Map<string, (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>>();
  constructor(private readonly taskService: DramaTaskService) { super(); }
  registerHandler(type: string, handler: (job: Job<DramaTaskPayload>) => Promise<Record<string, unknown> | void>) { this.handlers.set(type, handler); }
  async process(job: Job<DramaTaskPayload>) {
    await withTaskLifecycle({ taskService: this.taskService, logger: this.logger }, job, async (j) => {
      const h = this.handlers.get(j.data.type); if (!h) throw new Error(`无匹配 handler: ${j.data.type}`); return h(j);
    });
  }
}
