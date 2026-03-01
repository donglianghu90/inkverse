/** 任务恢复服务 — 启动时清理中断任务，关闭时优雅标记进行中任务 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutoSerializationJobEntity } from './entities/auto-serialization-job.entity';
import { ChapterResyncJobEntity } from './entities/chapter-resync-job.entity';
import { WorkflowExecutionService } from './workflow-execution.service';

const STALE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 自动连载/回灌任务：2小时未完成视为中断
const EXECUTION_STARTUP_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 章节工作流：启动时5分钟未完成即判定为残留running

@Injectable()
export class TaskRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskRecoveryService.name);

  constructor(
    @InjectRepository(AutoSerializationJobEntity) private readonly autoJobRepo: Repository<AutoSerializationJobEntity>,
    @InjectRepository(ChapterResyncJobEntity) private readonly resyncJobRepo: Repository<ChapterResyncJobEntity>,
    private readonly executionService: WorkflowExecutionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('========== 启动恢复检查 ==========');
    const [autoCount, resyncCount, execCount] = await Promise.all([
      this.recoverStaleAutoSerializationJobs(),
      this.recoverStaleResyncJobs(),
      this.recoverStaleWorkflowExecutions(),
    ]);
    if (autoCount + resyncCount + execCount > 0) {
      this.logger.warn(`恢复完成: 自动连载=${autoCount}, 章节重同步=${resyncCount}, 工作流执行=${execCount}`);
    } else {
      this.logger.log('无需恢复，所有任务状态正常');
    }
    await this.logResumableWorkflows();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('========== 优雅关闭 — 标记进行中任务 ==========');
    const [autoCount, resyncCount, execCount] = await Promise.all([
      this.markAutoJobsInterrupted(),
      this.markResyncJobsInterrupted(),
      this.markExecutionsInterrupted(),
    ]);
    if (autoCount + resyncCount + execCount > 0) {
      this.logger.warn(`关闭标记: 自动连载=${autoCount}, 章节重同步=${resyncCount}, 工作流执行=${execCount}`);
    }
  }

  private async recoverStaleAutoSerializationJobs(): Promise<number> { // 重置卡住的自动连载任务
    const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
    const result = await this.autoJobRepo.createQueryBuilder().update()
      .set({ running: false, runStartedAt: null, lastError: '服务重启，任务被自动恢复' })
      .where('running = TRUE')
      .andWhere('run_started_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  private async recoverStaleResyncJobs(): Promise<number> { // 重置卡住的章节重同步任务
    const cutoff = new Date(Date.now() - STALE_TIMEOUT_MS);
    const result = await this.resyncJobRepo.createQueryBuilder().update()
      .set({ status: 'queued' as const, lastError: '服务重启，任务已重新排队' })
      .where('status = :status', { status: 'running' })
      .andWhere('started_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  private async recoverStaleWorkflowExecutions(): Promise<number> { // 标记中断的工作流执行
    return this.executionService.markStaleRunsInterrupted(
      EXECUTION_STARTUP_STALE_TIMEOUT_MS,
      '服务重启，工作流执行中断',
    );
  }

  private async markAutoJobsInterrupted(): Promise<number> { // 优雅关闭时标记自动连载
    const result = await this.autoJobRepo.createQueryBuilder().update()
      .set({ running: false, runStartedAt: null, lastError: '服务优雅关闭，任务中断' })
      .where('running = TRUE').execute();
    return result.affected ?? 0;
  }

  private async markResyncJobsInterrupted(): Promise<number> { // 优雅关闭时标记章节重同步
    const result = await this.resyncJobRepo.createQueryBuilder().update()
      .set({ status: 'queued' as const, lastError: '服务优雅关闭，任务已重新排队' })
      .where('status = :status', { status: 'running' }).execute();
    return result.affected ?? 0;
  }

  private async markExecutionsInterrupted(): Promise<number> { // 优雅关闭时仅标记本实例的工作流执行
    return this.executionService.markStaleRunsInterrupted(0, '服务优雅关闭', true);
  }

  private async logResumableWorkflows(): Promise<void> {
    const resumable = await this.executionService.listResumableRuns(20);
    if (resumable.length > 0) {
      this.logger.log(
        `可断点续传的工作流: ${resumable.length}个\n` +
        resumable.map((r) =>
          `  status=${r.status} owner=${r.ownerInstanceId ?? '-'} hb=${r.heartbeatAt?.toISOString() ?? '-'} bookId=${r.bookId} ch${r.chapterNumber} 已缓存=[${Object.keys(r.stepOutputs).join(',')}] checkpoint=${r.lastCheckpoint}`,
        ).join('\n'),
      );
    }
  }
}
