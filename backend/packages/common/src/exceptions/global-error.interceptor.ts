import { Injectable, OnModuleInit } from '@nestjs/common';
import { LogService } from '@packages/modules';

@Injectable()
export class GlobalErrorInterceptor implements OnModuleInit {
  constructor(private readonly logService: LogService) {}

  onModuleInit() {
    this.setupGlobalErrorHandlers();
  }

  /**
   * 设置全局错误处理器
   */
  private setupGlobalErrorHandlers() {
    // 拦截未捕获的异常
    process.on('uncaughtException', (error: Error) => {
      this.handleUncaughtException(error);
    });

    // 拦截未处理的Promise拒绝
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      this.handleUnhandledRejection(reason, promise);
    });

    // 拦截警告
    process.on('warning', (warning: Error) => {
      this.handleWarning(warning);
    });

    // 拦截退出信号
    process.on('SIGTERM', () => {
      this.handleGracefulShutdown('SIGTERM');
    });

    process.on('SIGINT', () => {
      this.handleGracefulShutdown('SIGINT');
    });
  }

  /**
   * 处理未捕获的异常
   */
  private handleUncaughtException(error: Error) {
    const errorInfo = {
      type: 'UncaughtException',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      pid: process.pid,
      memory: process.memoryUsage(),
    };

    this.logService.error('🚨捕获的异常', error, {
      type: 'UncaughtException',
      pid: process.pid,
      memory: JSON.stringify(process.memoryUsage()),
      version: process.version,
      platform: process.platform,
      arch: process.arch
    });

    this.logService.error('错误类型:', undefined, { errorType: error.constructor.name });
    this.logService.error('错误消息:', undefined, { errorMessage: error.message });
    this.logService.error('错误堆栈:', undefined, { errorStack: error.stack });
    this.logService.error('进程信息:', undefined, {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    });
    this.logService.error('内存使用:', undefined, { memory: JSON.stringify(process.memoryUsage()) });
    this.logService.error('生产环境检测到严重错误，系统将继续运行');
    this.logService.error('请检查错误日志并尽快处理');
  }

  /**
   * 处理未处理的Promise拒绝
   */
  private handleUnhandledRejection(reason: any, promise: Promise<any>) {
    const errorInfo = {
      type: 'UnhandledRejection',
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    this.logService.error('⚠️ 未处理的Promise拒绝', reason instanceof Error ? reason : new Error(String(reason)), {
      type: 'UnhandledRejection',
      pid: process.pid,
      reasonString: String(reason)
    });

    // 记录详细错误信息
    console.error('=== 未处理Promise拒绝详情 ===');
    console.error('拒绝原因:', reason);
    console.error('Promise对象:', promise);
    if (reason instanceof Error) {
      console.error('错误堆栈:', reason.stack);
    }
    console.error('===========================');

    // 尝试处理Promise拒绝，避免进程崩溃
    try {
      promise.catch((error) => {
        this.logService.warn('已处理之前未处理的Promise拒绝', { error: String(error) });
      });
    } catch (error) {
      this.logService.error('处理Promise拒绝时发生错误', error);
    }
  }

  /**
   * 处理警告
   */
  private handleWarning(warning: Error) {
    this.logService.warn('⚠️ 系统警告', {
      name: warning.name,
      message: warning.message,
      stack: warning.stack,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 处理优雅关闭
   */
  private handleGracefulShutdown(signal: string) {
    this.logService.info(`🔄 收到 ${signal} 信号，开始优雅关闭...`, { signal });

    // 设置关闭超时
    const shutdownTimeout = setTimeout(() => {
      this.logService.error('⏰ 优雅关闭超时，强制退出');
      process.exit(1);
    }, 30000); // 30秒超时

    // 执行清理操作
    this.performCleanup().then(() => {
      clearTimeout(shutdownTimeout);
      this.logService.info('✅ 清理完成，系统退出');
      process.exit(0);
    }).catch((error) => {
      clearTimeout(shutdownTimeout);
      this.logService.error('❌ 清理过程中发生错误', error);
      process.exit(1);
    });
  }

  /**
   * 执行清理操作
   */
  private async performCleanup() {
    try {
      this.logService.info('🧹 开始执行清理操作...');

      // 这里可以添加数据库连接关闭、Redis连接关闭等清理逻辑
      // 例如：await this.databaseService.close();
      // 例如：await this.redisService.close();

      this.logService.info('✅ 清理操作完成');
    } catch (error) {
      this.logService.error('❌ 清理操作失败', error);
      throw error;
    }
  }
}
