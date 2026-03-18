/** 短剧任务恢复服务 — 启动时清理中断运行，关闭时优雅标记进行中运行 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DramaWorkflowExecutionService } from './workflow/drama-workflow-execution.service';

/**
 * 启动恢复阈值：服务重启时，超过此时间仍处于 running 状态的执行记录视为残留，标记为 interrupted。
 * 设置为 5 分钟（保守值），因为重启时无法确认上一个实例是否正常完成了最后步骤。
 *
 * 与 DramaWorkflowExecutionService.STALE_THRESHOLD_MS(60s) 的区别：
 *  - 此阈值：服务重启后批量清理用，只在 onModuleInit 执行一次
 *  - STALE_THRESHOLD_MS：运行中实例抢占检测，用于判断某个 running 记录的心跳是否过期（多实例场景）
 */
const STARTUP_STALE_TIMEOUT_MS = 5 * 60 * 1000;

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
