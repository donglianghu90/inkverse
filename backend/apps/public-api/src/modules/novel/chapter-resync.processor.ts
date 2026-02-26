import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NovelService } from './novel.service';
import { CHAPTER_RESYNC_QUEUE, ChapterResyncJobPayload } from './chapter-resync.queue';

@Processor(CHAPTER_RESYNC_QUEUE, { concurrency: 1 })
export class ChapterResyncProcessor extends WorkerHost {
  private readonly logger = new Logger(ChapterResyncProcessor.name);

  constructor(private readonly novelService: NovelService) {
    super();
  }

  async process(job: Job<ChapterResyncJobPayload>): Promise<Record<string, unknown>> {
    const { jobId } = job.data;
    this.logger.log(`chapter-resync queued jobId=${jobId}`);
    return this.novelService.processChapterResyncJob(jobId);
  }
}
