/** 进程内LLM用量追踪 — AsyncLocalStorage隔离章节作用域，按task/provider/model多维聚合 */
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

export interface LlmUsageCallRecord {
  callIndex: number;
  taskName: string;
  model: string;
  provider: string;
  tier: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  inputRateUsdPer1M: number;
  outputRateUsdPer1M: number;
  tokenSource: 'usage_metadata' | 'response_metadata' | 'missing';
  temperature: number | null;
  tags: string[];
}

interface AggBucket { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; totalDurationMs: number; }

export interface LlmChapterUsageSummary {
  bookId: string;
  chapterNumber: number;
  startedAt: string;
  finishedAt: string;
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  currency: 'USD';
  missingUsageCalls: number;
  byTask: Array<{ taskName: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; avgDurationMs: number; }>;
  byProvider: Array<{ provider: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; }>;
  byModel: Array<{ model: string; provider: string; tier: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; avgDurationMs: number; }>;
  calls: LlmUsageCallRecord[];
}

interface UsageScope {
  bookId: string;
  chapterNumber: number;
  startedAt: string;
  callSequence: number;
  consumed: boolean;
  calls: LlmUsageCallRecord[];
}

@Injectable()
export class LlmUsageTrackerService {
  private readonly storage = new AsyncLocalStorage<UsageScope>();

  async runWithChapterScope<T>(input: { bookId: string; chapterNumber: number }, job: () => Promise<T>): Promise<T> {
    return this.storage.run({ bookId: input.bookId, chapterNumber: input.chapterNumber, startedAt: new Date().toISOString(), callSequence: 0, consumed: false, calls: [] }, job);
  }

  recordCall(input: Omit<LlmUsageCallRecord, 'callIndex'>): void {
    const scope = this.storage.getStore();
    if (!scope) return;
    scope.callSequence += 1;
    scope.calls.push({ callIndex: scope.callSequence, ...input });
  }

  consumeCurrentSummary(): LlmChapterUsageSummary | null {
    const scope = this.storage.getStore();
    if (!scope || scope.consumed) return null;
    scope.consumed = true;

    const promptTokens = scope.calls.reduce((s, c) => s + c.promptTokens, 0);
    const completionTokens = scope.calls.reduce((s, c) => s + c.completionTokens, 0);
    const totalTokens = scope.calls.reduce((s, c) => s + c.totalTokens, 0);
    const estimatedCostUsd = Number(scope.calls.reduce((s, c) => s + c.estimatedCostUsd, 0).toFixed(8));
    const missingUsageCalls = scope.calls.filter((c) => c.tokenSource === 'missing').length;

    return {
      bookId: scope.bookId, chapterNumber: scope.chapterNumber,
      startedAt: scope.startedAt, finishedAt: new Date().toISOString(),
      totalCalls: scope.calls.length, promptTokens, completionTokens, totalTokens, estimatedCostUsd,
      currency: 'USD', missingUsageCalls,
      byTask: LlmUsageTrackerService.aggregateByTask(scope.calls),
      byProvider: LlmUsageTrackerService.aggregateByProvider(scope.calls),
      byModel: LlmUsageTrackerService.aggregateByModel(scope.calls),
      calls: scope.calls,
    };
  }

  private static aggregateByTask(calls: LlmUsageCallRecord[]) {
    const m = new Map<string, AggBucket>();
    for (const c of calls) {
      const b = m.get(c.taskName) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, totalDurationMs: 0 };
      b.calls++; b.promptTokens += c.promptTokens; b.completionTokens += c.completionTokens; b.totalTokens += c.totalTokens; b.estimatedCostUsd += c.estimatedCostUsd; b.totalDurationMs += c.durationMs;
      m.set(c.taskName, b);
    }
    return [...m.entries()].map(([taskName, b]) => ({
      taskName, calls: b.calls, promptTokens: b.promptTokens, completionTokens: b.completionTokens,
      totalTokens: b.totalTokens, estimatedCostUsd: Number(b.estimatedCostUsd.toFixed(8)),
      avgDurationMs: Number((b.totalDurationMs / Math.max(1, b.calls)).toFixed(2)),
    })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  }

  private static aggregateByProvider(calls: LlmUsageCallRecord[]) {
    const m = new Map<string, Omit<AggBucket, 'totalDurationMs'>>();
    for (const c of calls) {
      const b = m.get(c.provider) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
      b.calls++; b.promptTokens += c.promptTokens; b.completionTokens += c.completionTokens; b.totalTokens += c.totalTokens; b.estimatedCostUsd += c.estimatedCostUsd;
      m.set(c.provider, b);
    }
    return [...m.entries()].map(([provider, b]) => ({
      provider, calls: b.calls, promptTokens: b.promptTokens, completionTokens: b.completionTokens,
      totalTokens: b.totalTokens, estimatedCostUsd: Number(b.estimatedCostUsd.toFixed(8)),
    })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  }

  private static aggregateByModel(calls: LlmUsageCallRecord[]) {
    const m = new Map<string, AggBucket & { provider: string; tier: string }>();
    for (const c of calls) {
      const b = m.get(c.model) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, totalDurationMs: 0, provider: c.provider, tier: c.tier };
      b.calls++; b.promptTokens += c.promptTokens; b.completionTokens += c.completionTokens; b.totalTokens += c.totalTokens; b.estimatedCostUsd += c.estimatedCostUsd; b.totalDurationMs += c.durationMs;
      m.set(c.model, b);
    }
    return [...m.entries()].map(([model, b]) => ({
      model, provider: b.provider, tier: b.tier, calls: b.calls,
      promptTokens: b.promptTokens, completionTokens: b.completionTokens, totalTokens: b.totalTokens,
      estimatedCostUsd: Number(b.estimatedCostUsd.toFixed(8)),
      avgDurationMs: Number((b.totalDurationMs / Math.max(1, b.calls)).toFixed(2)),
    })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
  }
}
