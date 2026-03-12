/** 错误归一化 — 将任意错误映射为统一结构，驱动 Worker 重试决策 */

type ErrorCategory = 'client' | 'provider' | 'system';

interface ErrorSpec { httpStatus: number; retryable: boolean; category: ErrorCategory; defaultMessage: string; }

export interface NormalizedError {
  code: string;
  message: string;
  httpStatus: number;
  retryable: boolean;
  category: ErrorCategory;
  details?: Record<string, unknown> | null;
  provider?: string | null;
}

const SPEC: Record<string, ErrorSpec> = {
  INVALID_PARAMS:     { httpStatus: 400, retryable: false, category: 'client',   defaultMessage: '参数无效' },
  NOT_FOUND:          { httpStatus: 404, retryable: false, category: 'client',   defaultMessage: '资源不存在' },
  UNAUTHORIZED:       { httpStatus: 401, retryable: false, category: 'client',   defaultMessage: '未授权' },
  FORBIDDEN:          { httpStatus: 403, retryable: false, category: 'client',   defaultMessage: '无权限' },
  CONFLICT:           { httpStatus: 409, retryable: false, category: 'client',   defaultMessage: '资源冲突' },
  RATE_LIMIT:         { httpStatus: 429, retryable: true,  category: 'provider', defaultMessage: '请求频率超限' },
  GENERATION_FAILED:  { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '生成失败' },
  GENERATION_TIMEOUT: { httpStatus: 504, retryable: true,  category: 'provider', defaultMessage: '生成超时' },
  SENSITIVE_CONTENT:  { httpStatus: 422, retryable: false, category: 'provider', defaultMessage: '内容敏感' },
  EXTERNAL_ERROR:     { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '外部服务异常' },
  NETWORK_ERROR:      { httpStatus: 502, retryable: true,  category: 'provider', defaultMessage: '网络异常' },
  INTERNAL_ERROR:     { httpStatus: 500, retryable: false, category: 'system',   defaultMessage: '系统内部错误' },
  DB_ERROR:           { httpStatus: 500, retryable: true,  category: 'system',   defaultMessage: '数据库错误' },
  QUEUE_ERROR:        { httpStatus: 500, retryable: true,  category: 'system',   defaultMessage: '队列服务异常' },
  TASK_TERMINATED:    { httpStatus: 409, retryable: false, category: 'system',   defaultMessage: '任务已终止' },
  OWNERSHIP_LOST:     { httpStatus: 409, retryable: false, category: 'system',   defaultMessage: '执行权已转移' },
};

const MSG_MAP: Array<[string[], string]> = [
  [['unauthorized', '401', 'not authenticated'], 'UNAUTHORIZED'],
  [['forbidden', '403', 'permission denied'], 'FORBIDDEN'],
  [['not found', '不存在', '404'], 'NOT_FOUND'],
  [['invalid', 'missing', 'required', 'bad request'], 'INVALID_PARAMS'],
  [['rate limit', 'quota', 'throttle', '429'], 'RATE_LIMIT'],
  [['sensitive', 'unsafe', 'blocked', '违规', '敏感'], 'SENSITIVE_CONTENT'],
  [['timeout', 'timed out', 'deadline'], 'GENERATION_TIMEOUT'],
  [['503', 'unavailable', 'overloaded'], 'EXTERNAL_ERROR'],
  [['network', 'econnreset', 'econnrefused', 'socket hang up', 'fetch failed'], 'NETWORK_ERROR'],
  [['conflict', 'duplicate', 'already exists'], 'CONFLICT'],
];

const STATUS_MAP: Record<number, string> = {
  400: 'INVALID_PARAMS', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  409: 'CONFLICT', 422: 'SENSITIVE_CONTENT', 429: 'RATE_LIMIT',
  502: 'EXTERNAL_ERROR', 503: 'EXTERNAL_ERROR', 504: 'GENERATION_TIMEOUT',
};

function build(code: string, message?: string, details?: Record<string, unknown> | null, provider?: string | null): NormalizedError {
  const spec = SPEC[code] ?? SPEC.INTERNAL_ERROR;
  return { code, message: message?.trim() || spec.defaultMessage, httpStatus: spec.httpStatus, retryable: spec.retryable, category: spec.category, details: details ?? null, provider: provider ?? null };
}

function inferCode(msg: string): string | null {
  const low = msg.toLowerCase();
  for (const [keywords, code] of MSG_MAP) if (keywords.some(k => low.includes(k))) return code;
  return null;
}

export function normalizeError(input: unknown, opts: { context?: 'api' | 'worker' | 'pipeline'; fallback?: string; details?: Record<string, unknown> } = {}): NormalizedError {
  const fallback = opts.fallback ?? 'INTERNAL_ERROR';
  if (!input) return build(fallback);
  const err = input as Record<string, any>;
  const message = typeof err.message === 'string' ? err.message : String(input);
  const provider = typeof err.provider === 'string' ? err.provider : null;

  if (typeof err.code === 'string' && err.code in SPEC) return build(err.code, message, opts.details, provider);
  if (typeof err.status === 'number' && STATUS_MAP[err.status]) return build(STATUS_MAP[err.status], message, opts.details, provider);
  const inferred = inferCode(message);
  if (inferred) return build(inferred, message, opts.details, provider);
  if (opts.context === 'worker' && message.toLowerCase().includes('generation failed')) return build('GENERATION_FAILED', message, opts.details, provider);
  return build(fallback, message, opts.details, provider);
}
