/** 统一错误码注册表 — 所有 drama 模块的错误码集中定义 */
import { ErrorSpec } from './types';

export const ERROR_CODES = {
  INVALID_PARAMS: 'INVALID_PARAMS', NOT_FOUND: 'NOT_FOUND', UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN', CONFLICT: 'CONFLICT', // client 类
  RATE_LIMIT: 'RATE_LIMIT', GENERATION_FAILED: 'GENERATION_FAILED', GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
  SENSITIVE_CONTENT: 'SENSITIVE_CONTENT', EXTERNAL_ERROR: 'EXTERNAL_ERROR', NETWORK_ERROR: 'NETWORK_ERROR', // provider 类
  INTERNAL_ERROR: 'INTERNAL_ERROR', DB_ERROR: 'DB_ERROR', QUEUE_ERROR: 'QUEUE_ERROR',
  TASK_TERMINATED: 'TASK_TERMINATED', OWNERSHIP_LOST: 'OWNERSHIP_LOST', // system 类
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const SPEC: Record<ErrorCode, ErrorSpec> = {
  INVALID_PARAMS:       { httpStatus: 400, retryable: false, category: 'client',   defaultMessage: '参数无效' },
  NOT_FOUND:            { httpStatus: 404, retryable: false, category: 'client',   defaultMessage: '资源不存在' },
  UNAUTHORIZED:         { httpStatus: 401, retryable: false, category: 'client',   defaultMessage: '未授权' },
  FORBIDDEN:            { httpStatus: 403, retryable: false, category: 'client',   defaultMessage: '无权限' },
  CONFLICT:             { httpStatus: 409, retryable: false, category: 'client',   defaultMessage: '资源冲突' },
  RATE_LIMIT:           { httpStatus: 429, retryable: true,  category: 'provider', defaultMessage: '请求频率超限' },
  GENERATION_FAILED:    { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '生成失败' },
  GENERATION_TIMEOUT:   { httpStatus: 504, retryable: true,  category: 'provider', defaultMessage: '生成超时' },
  SENSITIVE_CONTENT:    { httpStatus: 422, retryable: false, category: 'provider', defaultMessage: '内容敏感' },
  EXTERNAL_ERROR:       { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '外部服务异常' },
  NETWORK_ERROR:        { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '网络异常' },
  INTERNAL_ERROR:       { httpStatus: 500, retryable: false, category: 'system',   defaultMessage: '系统内部错误' },
  DB_ERROR:             { httpStatus: 500, retryable: true,  category: 'system',   defaultMessage: '数据库错误' },
  QUEUE_ERROR:          { httpStatus: 500, retryable: true,  category: 'system',   defaultMessage: '队列服务异常' },
  TASK_TERMINATED:      { httpStatus: 409, retryable: false, category: 'system',   defaultMessage: '任务已终止' },
  OWNERSHIP_LOST:       { httpStatus: 409, retryable: false, category: 'system',   defaultMessage: '执行权已转移' },
};

export function getErrorSpec(code: ErrorCode): ErrorSpec { return SPEC[code] ?? SPEC.INTERNAL_ERROR; }
export function isKnownCode(code: string): code is ErrorCode { return code in SPEC; }
