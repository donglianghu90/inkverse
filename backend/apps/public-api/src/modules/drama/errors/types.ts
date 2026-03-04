/** 统一错误类型定义 — 参考 waoowaoo-main/src/lib/errors/ */
export type ErrorCategory = 'client' | 'provider' | 'system' | 'billing'; // 错误分类
export type ErrorContext = 'api' | 'worker' | 'pipeline'; // 错误发生上下文

export interface NormalizedError {
  code: string; // 统一错误码
  message: string;
  httpStatus: number;
  retryable: boolean;
  category: ErrorCategory;
  details?: Record<string, unknown> | null;
  provider?: string | null; // 第三方供应商标识
}

export interface ErrorSpec {
  httpStatus: number;
  retryable: boolean;
  category: ErrorCategory;
  defaultMessage: string;
}
