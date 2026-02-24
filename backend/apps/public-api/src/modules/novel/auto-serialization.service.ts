import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue, RepeatOptions } from 'bullmq';
import { Repository } from 'typeorm';
import { ConfigService } from '@packages/modules';
import { ConfigureAutoSerializationDto } from './dto/configure-auto-serialization.dto';
import { NovelV2Service } from './novel-v2.service';
import { BookEntity } from './entities/book.entity';
import { AutoSerializationJobEntity } from './entities/auto-serialization-job.entity';
import {
  AUTO_SERIALIZATION_QUEUE,
  AutoSerializationJobPayload,
  AutoSerializationScheduleRecord,
  mapJobEntity,
} from './auto-serialization.processor';

interface AutoSerializationView {
  bookId: string;
  enabled: boolean;
  dailyStartTime: string;
  chaptersPerRun: number;
  qualityPolicy: {
    maxRepairRounds: number;
    strictQuality: boolean;
    stopWhenLowQuality: boolean;
    minQualityScore: number;
    minOverallScore: number;
  };
  scheduler: {
    nextRunAt: string | null;
    lastRunAt: string | null;
    running: boolean;
    runStartedAt: string | null;
    lastError: string | null;
  };
  lastRunSummary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AutoSerializationService implements OnModuleInit {
  private readonly logger = new Logger(AutoSerializationService.name);
  private readonly scheduledJobName = 'auto-serialization-scheduled';

  constructor(
    @InjectRepository(BookEntity)
    private readonly bookRepo: Repository<BookEntity>,
    @InjectRepository(AutoSerializationJobEntity)
    private readonly jobRepo: Repository<AutoSerializationJobEntity>,
    private readonly novelService: NovelV2Service,
    private readonly configService: ConfigService,
    @InjectQueue(AUTO_SERIALIZATION_QUEUE)
    private readonly queue: Queue<AutoSerializationJobPayload>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isSchedulerEnabled()) {
      this.logger.log('auto-serialization scheduler disabled');
      return;
    }
    await this.bootstrapRepeatableJobsFromDatabase();
    this.logger.log('auto-serialization scheduler ready');
  }

  async configure(
    bookId: string,
    dto: ConfigureAutoSerializationDto,
  ): Promise<AutoSerializationView> {
    await this.ensureBookExists(bookId);
    const nextRunAt = this.computeNextRunAt(dto.dailyStartTime, new Date()).toISOString();
    await this.jobRepo.upsert(
      {
        bookId,
        enabled: true,
        dailyStartTime: dto.dailyStartTime,
        chaptersPerRun: dto.chaptersPerRun,
        maxRepairRounds: dto.maxRepairRounds ?? 2,
        strictQuality: dto.strictQuality ?? true,
        stopWhenLowQuality: dto.stopWhenLowQuality ?? true,
        minQualityScore: dto.minQualityScore ?? 7,
        minOverallScore: dto.minOverallScore ?? 7,
        nextRunAt: new Date(nextRunAt),
      },
      ['bookId'],
    );
    const saved = mapJobEntity(await this.jobRepo.findOneByOrFail({ bookId }));
    await this.upsertScheduledJob(saved.bookId, saved.dailyStartTime);
    return this.toView(saved);
  }

  async get(bookId: string): Promise<AutoSerializationView | null> {
    await this.ensureBookExists(bookId);
    const job = await this.jobRepo.findOneBy({ bookId });
    if (!job) return null;
    return this.toView(mapJobEntity(job));
  }

  async disable(bookId: string): Promise<AutoSerializationView> {
    await this.ensureBookExists(bookId);
    const result = await this.jobRepo.update({ bookId }, { enabled: false, nextRunAt: null });
    if (result.affected === 0) {
      throw new NotFoundException(`Auto-serialization schedule not found for book: ${bookId}`);
    }
    const schedule = mapJobEntity(await this.jobRepo.findOneByOrFail({ bookId }));
    await this.removeScheduledJobs(bookId);
    return this.toView(schedule);
  }

  async enable(bookId: string): Promise<AutoSerializationView> {
    await this.ensureBookExists(bookId);
    const current = await this.jobRepo.findOneBy({ bookId });
    if (!current) {
      throw new NotFoundException(`Auto-serialization schedule not found for book: ${bookId}`);
    }
    const nextRunAt = this.computeNextRunAt(current.dailyStartTime, new Date()).toISOString();
    const updateResult = await this.jobRepo.update(
      { bookId },
      { enabled: true, nextRunAt: new Date(nextRunAt) },
    );
    if (updateResult.affected === 0) {
      throw new NotFoundException(`Auto-serialization schedule not found for book: ${bookId}`);
    }
    const schedule = mapJobEntity(await this.jobRepo.findOneByOrFail({ bookId }));
    await this.upsertScheduledJob(schedule.bookId, schedule.dailyStartTime);
    return this.toView(schedule);
  }

  async runNow(bookId: string): Promise<Record<string, unknown>> {
    await this.ensureBookExists(bookId);
    const jobEntity = await this.jobRepo.findOneBy({ bookId });
    if (!jobEntity) {
      throw new NotFoundException(`Auto-serialization schedule not found for book: ${bookId}`);
    }
    if (!jobEntity.enabled) {
      throw new NotFoundException(`Auto-serialization schedule is disabled for book: ${bookId}`);
    }

    const job = await this.queue.add(
      this.scheduledJobName,
      { bookId, trigger: 'manual' },
      { jobId: `manual:${bookId}:${Date.now()}` },
    );
    return { bookId, trigger: 'manual', accepted: true, jobId: job.id };
  }

  private async ensureBookExists(bookId: string): Promise<void> {
    const count = await this.bookRepo.count({ where: { bookId } });
    if (count === 0) {
      throw new NotFoundException(`Book not found: ${bookId}`);
    }
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

  private toView(record: AutoSerializationScheduleRecord): AutoSerializationView {
    return {
      bookId: record.bookId,
      enabled: record.enabled,
      dailyStartTime: record.dailyStartTime,
      chaptersPerRun: record.chaptersPerRun,
      qualityPolicy: {
        maxRepairRounds: record.maxRepairRounds,
        strictQuality: record.strictQuality,
        stopWhenLowQuality: record.stopWhenLowQuality,
        minQualityScore: record.minQualityScore,
        minOverallScore: record.minOverallScore,
      },
      scheduler: {
        nextRunAt: record.nextRunAt,
        lastRunAt: record.lastRunAt,
        running: record.running,
        runStartedAt: record.runStartedAt,
        lastError: record.lastError,
      },
      lastRunSummary: record.lastResult,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private isSchedulerEnabled(): boolean {
    return (this.configService.get('autoSerialization.enabled') ?? 'true')
      .toString().toLowerCase() === 'true';
  }

  private getSchedulerTimezone(): string {
    return (
      this.configService.get('autoSerialization.timezone') ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC'
    );
  }

  private toDailyCronPattern(dailyStartTime: string): string {
    const [hourText, minuteText] = dailyStartTime.split(':');
    return `${Number(minuteText)} ${Number(hourText)} * * *`;
  }

  private buildScheduleJobId(bookId: string): string {
    return `auto-serialization:${bookId}`;
  }

  private async bootstrapRepeatableJobsFromDatabase(): Promise<void> {
    const jobs = await this.jobRepo.find({
      where: { enabled: true },
      order: { updatedAt: 'DESC' },
      take: 5000,
    });
    for (const job of jobs) {
      await this.upsertScheduledJob(job.bookId, job.dailyStartTime);
    }
  }

  private async removeScheduledJobs(bookId: string): Promise<void> {
    const scheduleJobId = this.buildScheduleJobId(bookId);
    const repeatables = await this.queue.getRepeatableJobs(0, 1000);
    for (const repeatable of repeatables) {
      if (repeatable.id === scheduleJobId) {
        await this.queue.removeRepeatableByKey(repeatable.key);
      }
    }
  }

  private async upsertScheduledJob(bookId: string, dailyStartTime: string): Promise<void> {
    await this.removeScheduledJobs(bookId);
    const repeat: RepeatOptions = {
      pattern: this.toDailyCronPattern(dailyStartTime),
      tz: this.getSchedulerTimezone(),
    };
    await this.queue.add(
      this.scheduledJobName,
      { bookId, trigger: 'scheduled' },
      { jobId: this.buildScheduleJobId(bookId), repeat },
    );
  }
}
