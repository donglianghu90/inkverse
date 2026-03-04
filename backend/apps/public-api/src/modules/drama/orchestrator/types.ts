/** Orchestrator 类型定义 — 纯函数编排的核心抽象 */
import { DramaState } from '../schemas/drama-state.schemas';

export interface StepMeta { stepKey: string; stepTitle: string; stepIndex: number; stepTotal: number; attempt?: number; }

export interface StepResult<T = unknown> { output: T; durationMs: number; }

export type RunStepFn = (meta: StepMeta, prompt: string, action: string, maxTokens?: number) => Promise<{ text: string; reasoning?: string }>; // LLM 调用注入点

export type OnProgressFn = (meta: StepMeta, message: string, done?: boolean) => void; // 进度回调
export type OnErrorFn = (meta: StepMeta, message: string) => void; // 错误回调

export interface OrchestratorInput { // 编排器输入（纯数据，无 IO 依赖）
  state: DramaState;
  episodeNumber?: number;
  runStep: RunStepFn; // LLM 执行注入
  onProgress?: OnProgressFn;
  onError?: OnErrorFn;
  onLog?: (message: string, details?: Record<string, unknown>) => void;
}

export interface RetryConfig { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; }
export const DEFAULT_RETRY: RetryConfig = { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 30_000 };

export async function runWithRetry<T>( // 带重试的步骤执行器
  fn: () => Promise<T>, config: RetryConfig = DEFAULT_RETRY, onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < config.maxAttempts) {
        const delay = Math.min(config.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500, config.maxDelayMs);
        onRetry?.(attempt, lastErr);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr!;
}
