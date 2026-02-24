import { Injectable, Inject } from '@nestjs/common';
import { getLog4jsLoggerToken } from '@nestx-log4js/core';
import * as log4js from 'log4js';

export interface LogContext {
  userId?: string;
  requestId?: string;
  module?: string;
  action?: string;
  [key: string]: any;
}

@Injectable()
export class LogService {
  private readonly defaultLogger: any;
  private readonly errorLogger: any;
  private readonly warnLogger: any;
  private readonly infoLogger: any;
  private readonly debugLogger: any;

  constructor(
    @Inject(getLog4jsLoggerToken()) private readonly logger: any,
  ) {
    this.defaultLogger = this.logger;
    // 使用log4js直接获取分类logger
    this.errorLogger = log4js.getLogger('error');
    this.warnLogger = log4js.getLogger('warn');
    this.infoLogger = log4js.getLogger('info');
    this.debugLogger = log4js.getLogger('debug');
  }

  /**
   * 记录错误日志
   */
  error(message: string, error?: Error | any, context?: LogContext): void {
    const logMessage = this.formatMessage(message, context);
    if (error) {
      this.errorLogger.error(logMessage, error);
    } else {
      this.errorLogger.error(logMessage);
    }
  }

  /**
   * 记录警告日志
   */
  warn(message: string, context?: LogContext): void {
    const logMessage = this.formatMessage(message, context);
    this.warnLogger.warn(logMessage);
  }

  /**
   * 记录信息日志
   */
  info(message: string, context?: LogContext): void {
    const logMessage = this.formatMessage(message, context);
    this.infoLogger.info(logMessage);
  }

  /**
   * 记录调试日志
   */
  debug(message: string, context?: LogContext): void {
    const logMessage = this.formatMessage(message, context);
    this.debugLogger.debug(logMessage);
  }

  /**
   * 记录到自定义分类的日志文件
   */
  logToCategory(category: string, level: 'error' | 'warn' | 'info' | 'debug', message: string, context?: LogContext): void {
    const categoryLogger = log4js.getLogger(category);
    const logMessage = this.formatMessage(message, context);
    
    switch (level) {
      case 'error':
        categoryLogger.error(logMessage);
        break;
      case 'warn':
        categoryLogger.warn(logMessage);
        break;
      case 'info':
        categoryLogger.info(logMessage);
        break;
      case 'debug':
        categoryLogger.debug(logMessage);
        break;
    }
  }

  /**
   * 记录API请求日志
   */
  logApiRequest(method: string, url: string, statusCode: number, responseTime: number, context?: LogContext): void {
    const message = `${method} ${url} ${statusCode} ${responseTime}ms`;
    const logContext = { ...context, type: 'api_request', method, url, statusCode, responseTime };
    
    if (statusCode >= 500) {
      this.error(message, undefined, logContext);
    } else if (statusCode >= 400) {
      this.warn(message, logContext);
    } else {
      this.info(message, logContext);
    }
  }

  /**
   * 记录数据库操作日志
   */
  logDatabaseOperation(operation: string, table: string, duration: number, context?: LogContext): void {
    const message = `DB ${operation} on ${table} took ${duration}ms`;
    const logContext = { ...context, type: 'database', operation, table, duration };
    
    if (duration > 1000) {
      this.warn(message, logContext);
    } else {
      this.debug(message, logContext);
    }
  }

  /**
   * 记录微信相关日志 - 通用方法
   */
  logWechat(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat', action };
    this.logToCategory('wechat', 'info', message, logContext);
  }

  /**
   * 记录微信错误日志
   */
  logWechatError(action: string, message: string, error?: Error | any, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat-error', action };
    if (error) {
      this.logToCategory('wechat-error', 'error', message, logContext);
      this.error(`[微信错误] ${message}`, error, logContext);
    } else {
      this.logToCategory('wechat-error', 'error', message, logContext);
    }
  }

  /**
   * 记录微信调试日志
   */
  logWechatDebug(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat-debug', action };
    this.logToCategory('wechat-debug', 'debug', message, logContext);
  }

  /**
   * 记录微信消息处理日志
   */
  logWechatMessage(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat-message', action };
    this.logToCategory('wechat-message', 'info', message, logContext);
  }
  /**
   * 记录微信联系人相关日志
   */
  logWechatContact(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat-contact', action };
    this.logToCategory('wechat-contact', 'info', message, logContext);
  }


  /**
   * 记录微信任务队列日志
   */
  logWechatTask(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'wechat-task', action };
    this.logToCategory('wechat-task', 'info', message, logContext);
  }

  /**
   * 记录认证相关日志
   */
  logAuth(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'auth', action };
    this.logToCategory('auth', 'info', message, logContext);
  }

  /**
   * 记录业务逻辑日志
   */
  logBusiness(action: string, message: string, context?: LogContext): void {
    const logContext = { ...context, type: 'business', action };
    this.logToCategory('business', 'info', message, logContext);
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(message: string, context?: LogContext): string {
    if (!context) {
      return message;
    }

    const contextStr = Object.entries(context)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    
    return `${message} [${contextStr}]`;
  }

  /**
   * 获取特定分类的logger
   */
  getLogger(category?: string): any {
    return category ? log4js.getLogger(category) : this.defaultLogger;
  }
}
