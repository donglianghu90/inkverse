/**
 * 统一错误处理工具
 * 提供一致的错误处理和用户提示
 */
import { message, notification } from 'antd';

// 错误类型枚举
export enum ErrorType {
  NETWORK = 'network', // 网络错误
  TIMEOUT = 'timeout', // 超时错误
  SERVER = 'server', // 服务器错误
  AUTH = 'auth', // 认证错误
  PERMISSION = 'permission', // 权限错误
  VALIDATION = 'validation', // 验证错误
  BUSINESS = 'business', // 业务错误
  UNKNOWN = 'unknown', // 未知错误
}

// 错误信息接口
export interface ErrorInfo {
  type: ErrorType;
  code?: string | number;
  message: string;
  details?: any;
  originalError?: any;
}

// 错误提示配置
interface ErrorHandlerOptions {
  /**
   * 提示方式：message - 消息提示，notification - 通知，silent - 静默
   */
  showType?: 'message' | 'notification' | 'silent';

  /**
   * 是否显示详细错误信息
   */
  showDetails?: boolean;

  /**
   * 自定义错误处理回调
   */
  onError?: (error: ErrorInfo) => void;

  /**
   * 是否记录错误日志
   */
  logError?: boolean;
}

// 默认错误消息映射
const DEFAULT_ERROR_MESSAGES: Record<ErrorType, string> = {
  [ErrorType.NETWORK]: '网络连接失败，请检查网络设置',
  [ErrorType.TIMEOUT]: '请求超时，请稍后重试',
  [ErrorType.SERVER]: '服务器错误，请稍后重试',
  [ErrorType.AUTH]: '身份验证失败，请重新登录',
  [ErrorType.PERMISSION]: '没有权限执行此操作',
  [ErrorType.VALIDATION]: '数据验证失败',
  [ErrorType.BUSINESS]: '操作失败',
  [ErrorType.UNKNOWN]: '未知错误，请联系管理员',
};

// HTTP状态码错误映射
const HTTP_ERROR_MAP: Record<number, ErrorType> = {
  400: ErrorType.VALIDATION,
  401: ErrorType.AUTH,
  403: ErrorType.PERMISSION,
  404: ErrorType.BUSINESS,
  408: ErrorType.TIMEOUT,
  500: ErrorType.SERVER,
  502: ErrorType.SERVER,
  503: ErrorType.SERVER,
  504: ErrorType.TIMEOUT,
};

/**
 * 解析错误
 */
export function parseError(error: any): ErrorInfo {
  // Axios错误
  if (error.response) {
    const { status, data } = error.response;
    const errorType = HTTP_ERROR_MAP[status] || ErrorType.SERVER;

    return {
      type: errorType,
      code: status,
      message: data?.message || data?.msg || DEFAULT_ERROR_MESSAGES[errorType],
      details: data,
      originalError: error,
    };
  }

  // 网络错误
  if (error.request) {
    return {
      type: ErrorType.NETWORK,
      message: DEFAULT_ERROR_MESSAGES[ErrorType.NETWORK],
      originalError: error,
    };
  }

  // 业务错误（自定义Error对象）
  if (error instanceof Error) {
    return {
      type: ErrorType.BUSINESS,
      message: error.message || DEFAULT_ERROR_MESSAGES[ErrorType.BUSINESS],
      originalError: error,
    };
  }

  // 其他错误
  return {
    type: ErrorType.UNKNOWN,
    message: String(error) || DEFAULT_ERROR_MESSAGES[ErrorType.UNKNOWN],
    originalError: error,
  };
}

/**
 * 处理错误
 */
export function handleError(error: any, options: ErrorHandlerOptions = {}) {
  const { showType = 'message', showDetails = false, onError, logError = true } = options;

  // 解析错误
  const errorInfo = parseError(error);

  // 记录错误日志
  if (logError) {
    console.error('[Error Handler]', errorInfo);
  }

  // 自定义错误处理
  if (onError) {
    onError(errorInfo);
  }

  // 显示错误提示
  if (showType !== 'silent') {
    const errorMessage = errorInfo.message;

    if (showType === 'message') {
      message.error(errorMessage);
    } else if (showType === 'notification') {
      const errorDescription =
        showDetails && errorInfo.details
          ? `${errorMessage}\n\n${JSON.stringify(errorInfo.details, null, 2)}`
          : errorMessage;

      notification.error({
        message: '操作失败',
        description: errorDescription,
        duration: 5,
        style: { whiteSpace: 'pre-wrap' },
      });
    }
  }

  // 特殊错误处理
  if (errorInfo.type === ErrorType.AUTH) {
    // 认证失败，跳转到登录页
    setTimeout(() => {
      window.location.href = '/login';
    }, 1500);
  }

  return errorInfo;
}

/**
 * 创建错误处理包装器
 */
export function createErrorHandler(defaultOptions: ErrorHandlerOptions = {}) {
  return (error: any, options: ErrorHandlerOptions = {}) => {
    return handleError(error, { ...defaultOptions, ...options });
  };
}

/**
 * Async函数错误处理装饰器
 */
export function withErrorHandler<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: ErrorHandlerOptions = {},
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, options);
      throw error;
    }
  }) as T;
}

/**
 * 批量错误处理
 */
export async function handleMultipleErrors<T>(
  promises: Promise<T>[],
  options: ErrorHandlerOptions = {},
): Promise<{ results: (T | null)[]; errors: ErrorInfo[] }> {
  const results: (T | null)[] = [];
  const errors: ErrorInfo[] = [];

  await Promise.allSettled(promises).then((settled) => {
    settled.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const errorInfo = parseError(result.reason);
        errors.push(errorInfo);
        results.push(null);
        handleError(result.reason, options);
      }
    });
  });

  return { results, errors };
}

/**
 * 重试包装器
 */
export async function retryOnError<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    onRetry?: (attempt: number, error: any) => void;
  } = {},
): Promise<T> {
  const { retries = 3, delay = 1000, onRetry } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        onRetry?.(attempt, error);
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), delay * attempt);
        });
      }
    }
  }

  throw lastError;
}
