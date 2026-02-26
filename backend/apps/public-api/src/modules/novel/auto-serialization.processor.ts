import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { NovelService } from './novel.service';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import { AutoSerializationJobEntity } from './entities/auto-serialization-job.entity';

export const AUTO_SERIALIZATION_QUEUE = 'novel-auto-serialization';
export const AUTO_INTERVENTION_THRESHOLD = 3;
const MAX_AUTO_REPAIR_ROUNDS = 8;

export interface AutoSerializationJobPayload {
  bookId: string;
  trigger: 'scheduled' | 'manual';
}

export interface AutoSerializationScheduleRecord {
  bookId: string;
  enabled: boolean;
  dailyStartTime: string;
  chaptersPerRun: number;
  runEveryDays: number;
  maxRepairRounds: number;
  minQualityScore: number;
  minOverallScore: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runStartedAt: string | null;
  running: boolean;
  lastError: string | null;
  lastResult: Record<string, unknown> | null;
  consecutiveLowQualityRuns: number;
  interventionRequired: boolean;
  interventionReason: string | null;
  interventionChapterNumber: number | null;
  interventionMarkerChapters: number[];
  interventionRaisedAt: string | null;
  interventionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapJobEntity(job: AutoSerializationJobEntity): AutoSerializationScheduleRecord {
  return {
    bookId: job.bookId,
    enabled: job.enabled,
    dailyStartTime: job.dailyStartTime,
    chaptersPerRun: job.chaptersPerRun,
    runEveryDays: job.runEveryDays,
    maxRepairRounds: job.maxRepairRounds,
    minQualityScore: Number(job.minQualityScore),
    minOverallScore: Number(job.minOverallScore),
    nextRunAt: job.nextRunAt ? job.nextRunAt.toISOString() : null,
    lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
    runStartedAt: job.runStartedAt ? job.runStartedAt.toISOString() : null,
    running: job.running,
    lastError: job.lastError,
    lastResult: job.lastResult,
    consecutiveLowQualityRuns: job.consecutiveLowQualityRuns,
    interventionRequired: job.interventionRequired,
    interventionReason: job.interventionReason,
    interventionChapterNumber: job.interventionChapterNumber,
    interventionMarkerChapters: Array.isArray(job.interventionMarkerChapters)
      ? job.interventionMarkerChapters
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      : [],
    interventionRaisedAt: job.interventionRaisedAt ? job.interventionRaisedAt.toISOString() : null,
    interventionExpiresAt: job.interventionExpiresAt ? job.interventionExpiresAt.toISOString() : null,
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
      const now = new Date();
      const result = (await this.novelService.generateChaptersBatch(
        schedule.bookId,
        batchInput,
      )) as Record<string, unknown>;
      const { lowQuality, chapterNumber } = this.parseLowQualityFailure(result.stopReason);
      const nextRunAt = this.resolveNextRunAt(schedule, trigger, now);
      const consecutiveLowQualityRuns = lowQuality
        ? schedule.consecutiveLowQualityRuns + 1
        : 0;
      const interventionTriggeredNow = lowQuality && consecutiveLowQualityRuns >= AUTO_INTERVENTION_THRESHOLD;
      const interventionWasActive = this.isInterventionWindowActive(schedule, now);
      const interventionRequired = interventionTriggeredNow || interventionWasActive;
      const nextRepairRounds = lowQuality
        ? Math.min(MAX_AUTO_REPAIR_ROUNDS, schedule.maxRepairRounds + 1)
        : schedule.maxRepairRounds;
      const activeInterventionChapter = interventionTriggeredNow
        ? (chapterNumber ?? schedule.interventionChapterNumber)
        : schedule.interventionChapterNumber;
      const markerChapters = this.mergeInterventionMarkers(
        schedule.interventionMarkerChapters,
        interventionTriggeredNow ? chapterNumber : null,
      );
      const interventionRaisedAt = interventionTriggeredNow
        ? now
        : schedule.interventionRaisedAt
          ? new Date(schedule.interventionRaisedAt)
          : null;
      const interventionExpiresAt = interventionTriggeredNow
        ? this.addDays(now, schedule.runEveryDays)
        : schedule.interventionExpiresAt
          ? new Date(schedule.interventionExpiresAt)
          : null;
      const interventionReason = interventionTriggeredNow
        ? `连续 ${consecutiveLowQualityRuns} 次质量未达标，建议人工介入`
        : schedule.interventionReason;
      const decoratedResult = {
        ...result,
        autoRepair: {
          lowQualityFailure: lowQuality,
          increasedMaxRepairRounds: nextRepairRounds,
          consecutiveLowQualityRuns,
          interventionRequired,
          threshold: AUTO_INTERVENTION_THRESHOLD,
          interventionChapterNumber: activeInterventionChapter,
          interventionMarkerChapters: markerChapters,
          interventionExpiresAt: interventionExpiresAt ? interventionExpiresAt.toISOString() : null,
        },
      };

      await this.completeRun(
        schedule.bookId,
        nextRunAt,
        null,
        decoratedResult,
        {
          maxRepairRounds: nextRepairRounds,
          consecutiveLowQualityRuns,
          interventionRequired,
          interventionReason,
          interventionChapterNumber: activeInterventionChapter,
          interventionMarkerChapters: markerChapters,
          interventionRaisedAt,
          interventionExpiresAt,
        },
      );

      this.logger.log(
        `auto-serialization done book=${schedule.bookId} trigger=${trigger} nextRunAt=${nextRunAt} lowQuality=${lowQuality} consecutive=${consecutiveLowQualityRuns}`,
      );
      return { nextRunAt, result: decoratedResult };
    } catch (error) {
      const now = new Date();
      const nextRunAt = this.resolveNextRunAt(schedule, trigger, now);
      const message = error instanceof Error ? error.message : String(error);
      await this.completeRun(
        schedule.bookId,
        nextRunAt,
        message,
        null,
        {
          maxRepairRounds: schedule.maxRepairRounds,
          consecutiveLowQualityRuns: schedule.consecutiveLowQualityRuns,
          interventionRequired: this.isInterventionWindowActive(schedule, now),
          interventionReason: schedule.interventionReason,
          interventionChapterNumber: schedule.interventionChapterNumber,
          interventionMarkerChapters: schedule.interventionMarkerChapters,
          interventionRaisedAt: schedule.interventionRaisedAt ? new Date(schedule.interventionRaisedAt) : null,
          interventionExpiresAt: schedule.interventionExpiresAt ? new Date(schedule.interventionExpiresAt) : null,
        },
      );
      throw error;
    }
  }

  private async completeRun(
    bookId: string,
    nextRunAt: string | null,
    lastError: string | null,
    lastResult: Record<string, unknown> | null,
    qualityPolicy: {
      maxRepairRounds: number;
      consecutiveLowQualityRuns: number;
      interventionRequired: boolean;
      interventionReason: string | null;
      interventionChapterNumber: number | null;
      interventionMarkerChapters: number[];
      interventionRaisedAt: Date | null;
      interventionExpiresAt: Date | null;
    },
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
        maxRepairRounds: qualityPolicy.maxRepairRounds,
        consecutiveLowQualityRuns: qualityPolicy.consecutiveLowQualityRuns,
        interventionRequired: qualityPolicy.interventionRequired,
        interventionReason: qualityPolicy.interventionReason,
        interventionChapterNumber: qualityPolicy.interventionChapterNumber,
        interventionMarkerChapters: qualityPolicy.interventionMarkerChapters,
        interventionRaisedAt: qualityPolicy.interventionRaisedAt,
        interventionExpiresAt: qualityPolicy.interventionExpiresAt,
      },
    );
  }

  private computeNextRunAt(
    dailyStartTime: string,
    runEveryDays: number,
    from: Date,
  ): Date {
    const [hourText, minuteText] = dailyStartTime.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const next = new Date(from.getTime());
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + Math.max(1, runEveryDays));
    }
    return next;
  }

  private resolveNextRunAt(
    schedule: AutoSerializationScheduleRecord,
    trigger: string,
    now: Date,
  ): string {
    const scheduledAt = schedule.nextRunAt ? new Date(schedule.nextRunAt) : null;
    // Manual runs should not shift the regular schedule window when there is
    // already a future run planned.
    if (trigger === 'manual' && scheduledAt && scheduledAt.getTime() > now.getTime()) {
      return scheduledAt.toISOString();
    }
    return this.computeNextRunAt(
      schedule.dailyStartTime,
      schedule.runEveryDays,
      now,
    ).toISOString();
  }

  private isInterventionWindowActive(
    schedule: AutoSerializationScheduleRecord,
    now: Date,
  ): boolean {
    if (!schedule.interventionExpiresAt) {
      return schedule.interventionRequired;
    }
    return new Date(schedule.interventionExpiresAt).getTime() > now.getTime();
  }

  private mergeInterventionMarkers(
    current: number[],
    chapterNumber: number | null,
  ): number[] {
    const set = new Set<number>(
      (current ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    );
    if (chapterNumber != null && Number.isInteger(chapterNumber) && chapterNumber > 0) {
      set.add(chapterNumber);
    }
    return Array.from(set).sort((a, b) => a - b);
  }

  private parseLowQualityFailure(
    stopReason: unknown,
  ): { lowQuality: boolean; chapterNumber: number | null } {
    if (typeof stopReason !== 'string') {
      return { lowQuality: false, chapterNumber: null };
    }
    const match = stopReason.match(/^quality_threshold_failed_at_chapter_(\d+)$/);
    if (!match) {
      return { lowQuality: false, chapterNumber: null };
    }
    return { lowQuality: true, chapterNumber: Number(match[1]) };
  }

  private addDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + Math.max(1, days));
    return next;
  }
}
