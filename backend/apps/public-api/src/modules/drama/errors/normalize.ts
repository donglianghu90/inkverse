/** 错误归一化 — 将任何来源的错误映射为统一 NormalizedError */
import { ErrorCode, getErrorSpec, isKnownCode } from './error-codes';
import { NormalizedError, ErrorContext } from './types';

const MSG_MAP: Array<[string[], ErrorCode]> = [ // 消息关键词→错误码映射
  [['unauthorized', '401', 'not authenticated'], 'UNAUTHORIZED'],
  [['forbidden', '403', 'permission denied'], 'FORBIDDEN'],
  [['not found', '不存在', '404'], 'NOT_FOUND'],
  [['invalid', 'missing', 'required', 'bad request'], 'INVALID_PARAMS'],
  [['rate limit', 'quota', 'throttle', '429'], 'RATE_LIMIT'],
  [['insufficient balance', '余额不足', '402'], 'INSUFFICIENT_BALANCE'],
  [['sensitive', 'unsafe', 'blocked', '违规', '敏感'], 'SENSITIVE_CONTENT'],
  [['timeout', 'timed out', 'deadline'], 'GENERATION_TIMEOUT'],
  [['503', 'unavailable', 'overloaded'], 'EXTERNAL_ERROR'],
  [['network', 'econnreset', 'econnrefused', 'socket hang up', 'fetch failed'], 'NETWORK_ERROR'],
  [['conflict', 'duplicate', 'already exists'], 'CONFLICT'],
];

function containsAny(s: string, needles: string[]): boolean { return needles.some(n => s.includes(n)); }

function inferCode(msg: string): ErrorCode | null { // 从错误消息推断错误码
  const low = msg.toLowerCase();
  for (const [keywords, code] of MSG_MAP) if (containsAny(low, keywords)) return code;
  return null;
}

function build(code: ErrorCode, message?: string, details?: Record<string, unknown> | null, provider?: string | null): NormalizedError {
  const spec = getErrorSpec(code);
  return { code, message: message?.trim() || spec.defaultMessage, httpStatus: spec.httpStatus, retryable: spec.retryable, category: spec.category, details: details ?? null, provider: provider ?? null };
}

export function normalizeError(input: unknown, opts: { context?: ErrorContext; fallback?: ErrorCode; details?: Record<string, unknown> } = {}): NormalizedError {
  const fallback = opts.fallback ?? 'INTERNAL_ERROR';
  if (!input) return build(fallback);
  const err = input as Record<string, any>;
  const message = typeof err.message === 'string' ? err.message : String(input);
  const provider = typeof err.provider === 'string' ? err.provider : null;

  if (typeof err.code === 'string' && isKnownCode(err.code)) return build(err.code, message, opts.details, provider); // 已有已知错误码
  if (typeof err.status === 'number') { // HTTP 状态码推断
    const statusMap: Record<number, ErrorCode> = { 400: 'INVALID_PARAMS', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 422: 'SENSITIVE_CONTENT', 429: 'RATE_LIMIT', 502: 'EXTERNAL_ERROR', 503: 'EXTERNAL_ERROR', 504: 'GENERATION_TIMEOUT' };
    if (statusMap[err.status]) return build(statusMap[err.status], message, opts.details, provider);
  }
  const inferred = inferCode(message); // 消息推断
  if (inferred) return build(inferred, message, opts.details, provider);
  if (opts.context === 'worker' && message.toLowerCase().includes('generation failed')) return build('GENERATION_FAILED', message, opts.details, provider);
  return build(fallback, message, opts.details, provider);
}

export class DramaError extends Error { // 业务错误基类
  constructor(public readonly code: ErrorCode, message: string, public readonly details?: Record<string, unknown>) { super(message); this.name = 'DramaError'; }
}
