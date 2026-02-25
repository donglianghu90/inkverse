import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { NovelService } from './novel.service';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import { AutoSerializationJobEntity } from './entities/auto-serialization-job.entity';

export const AUTO_SERIALIZATION_QUEUE = 'novel-auto-serialization';

export interface AutoSerializationJobPayload {
  bookId: string;
  trigger: 'scheduled' | 'manual';
}

export interface AutoSerializationScheduleRecord {
  bookId: string;
  enabled: boolean;
  dailyStartTime: string;
  chaptersPerRun: number;
  maxRepairRounds: number;
  minQualityScore: number;
  minOverallScore: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runStartedAt: string | null;
  running: boolean;
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function mapJobEntity(job: AutoSerializationJobEntity): AutoSerializationScheduleRecord {
  return {
    bookId: job.bookId,
    enabled: job.enabled,
    dailyStartTime: job.dailyStartTime,
    chaptersPerRun: job.chaptersPerRun,
    maxRepairRounds: job.maxRepairRounds,
    minQualityScore: Number(job.minQualityScore),
    minOverallScore: Number(job.minOverallScore),
    nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
    lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
    runStartedAt: job.runStartedAt ? job.runStartedAt.toISOString() : null,
    running: job.running,
    lastError: job.lastError,
    lastResult: job.lastResult,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

@Processor(AUTO_SERIALIZATION_QUEUE, { concurrency: 1 })
export class AutoSerializationProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoSerializationProcessor.name);

  constructor(
    @InjectRepository(AutoSerializationJobEntity)
    private readonly jobRepo: Repository<AutoSerializationJobEntity>,
    private readonly novelService: NovelService,
  ) {
    super();
  }

  async process(job: Job<AutoSerializationJobPayload>): Promise<Record<string, unknown>> {
    const { bookId, trigger } = job.data;
    const scheduleEntity = await this.jobRepo.findOneBy({ bookId });
    if (!scheduleEntity || !scheduleEntity.enabled) {
      return { bookId, skipped: true, reason: 'schedule_missing_or_disabled' };
    }

    const claimed = await this.claimSchedule(bookId, trigger === 'manual');
    if (!claimed) {
      return { bookId, skipped: true, reason: 'already_running_or_not_claimable' };
    }
    return this.executeClaimedSchedule(claimed, trigger);
  }

  private async claimSchedule(
    bookId: string,
    force: boolean,
  ): Promise<AutoSerializationScheduleRecord | null> {
    const updateResult = await this.jobRepo
      .createQueryBuilder()
      .update(AutoSerializationJobEntity)
      .set({
        running: true,
        runStartedAt: () => 'NOW()',
        lastError: null,
        updatedAt: () => 'NOW()',
      })
      .where('bookId = :bookId', { bookId })
      .andWhere('enabled = TRUE')
      .andWhere(
        '(running = FALSE OR (run_started_at IS NOT NULL AND run_started_at < NOW() - INTERVAL \'6 hours\'))',
      )
      .andWhere(
        force
          ? '1=1'
          : '(next_run_at IS NOT NULL AND next_run_at <= NOW())',
      )
      .execute();

    if (updateResult.affected === 0) {
      return null;
    }
    const job = await this.jobRepo.findOneByOrFail({ bookId });
    return mapJobEntity(job);
  }

  private async executeClaimedSchedule(
    schedule: AutoSerializationScheduleRecord,
    trigger: string,
  ): Promise<Record<string, unknown>> {
    const batchInput: GenerateChaptersBatchDto = {
      chapterCount: schedule.chaptersPerRun,
      maxRepairRounds: schedule.maxRepairRounds,
      minQualityScore: schedule.minQualityScore,
      minOverallScore: schedule.minOverallScore,
    };

    try {
      const result = (await this.novelService.generateChaptersBatch(
        schedule.bookId,
        batchInput,
      )) as Record<string, unknown>;

      const nextRunAt = this.computeNextRunAt(schedule.dailyStartTime, new Date()).toISOString();
      await this.completeRun(schedule.bookId, nextRunAt, null, result);

      this.logger.log(
        `auto-serialization done book=${schedule.bookId} trigger=${trigger} nextRunAt=${nextRunAt}`,
      );
      return { nextRunAt, result };
    } catch (error) {
      const nextRunAt = this.computeNextRunAt(schedule.dailyStartTime, new Date()).toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await this.completeRun(schedule.bookId, nextRunAt, message, null);
      throw error;
    }
  }

  private async completeRun(
    bookId: string,
    nextRunAt: string | null,
    lastError: string | null,
    lastResult: Record<string, unknown> | null,
  ): Promise<void> {
    await this.jobRepo.update(
      { bookId },
      {
        running: false,
        runStartedAt: null,
        nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
        lastRunAt: new Date(),
        lastError,
        lastResult,
      },
    );
  }

  private computeNextRunAt(dailyStartTime: string, from: Date): Date {
    const [hourText, minuteText] = dailyStartTime.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const next = new Date(from.getTime());
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }
}
