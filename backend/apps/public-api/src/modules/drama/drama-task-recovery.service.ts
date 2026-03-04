/** 短剧任务恢复服务 — 启动时清理中断运行，关闭时优雅标记进行中运行 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DramaWorkflowExecutionService } from './drama-workflow-execution.service';

const STARTUP_STALE_TIMEOUT_MS = 5 * 60 * 1000; // 启动时5分钟未完成即判定为残留running

@Injectable()
export class DramaTaskRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DramaTaskRecoveryService.name);

  constructor(private readonly executionService: DramaWorkflowExecutionService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('========== 短剧启动恢复检查 ==========');
    const count = await this.executionService.markStaleRunsInterrupted(STARTUP_STALE_TIMEOUT_MS, '服务重启，短剧工作流中断');
    if (count > 0) this.logger.warn(`恢复完成: 短剧工作流执行=${count}`);
    else this.logger.log('无需恢复，所有短剧任务状态正常');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('========== 短剧优雅关闭 — 标记进行中任务 ==========');
    const count = await this.executionService.markStaleRunsInterrupted(0, '服务优雅关闭', true);
    if (count > 0) this.logger.warn(`关闭标记: 短剧工作流执行=${count}`);
  }
}
