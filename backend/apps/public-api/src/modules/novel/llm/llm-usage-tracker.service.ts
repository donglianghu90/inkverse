/**
 * In-process LLM usage tracker.
 * - Uses AsyncLocalStorage to isolate one chapter run context.
 * - Aggregates per-call token/cost metrics into one chapter summary payload.
 */
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

// One LLM call usage record captured from LlmService.
export interface LlmUsageCallRecord {
  callIndex: number;
  taskName: string;
  model: string;
  provider: string;
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

// Aggregated chapter-level usage payload persisted as artifact.
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
  byTask: Array<{
    taskName: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    avgDurationMs: number;
  }>;
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

  // Run one chapter generation inside an isolated usage tracking scope.
  async runWithChapterScope<T>(
    input: { bookId: string; chapterNumber: number },
    job: () => Promise<T>,
  ): Promise<T> {
    const scope: UsageScope = {
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      startedAt: new Date().toISOString(),
      callSequence: 0,
      consumed: false,
      calls: [],
    };
    return this.storage.run(scope, job);
  }

  // Record one LLM call usage under current scope; no-op if no scope is active.
  recordCall(input: Omit<LlmUsageCallRecord, 'callIndex'>): void {
    const scope = this.storage.getStore();
    if (!scope) {
      return;
    }
    scope.callSequence += 1;
    scope.calls.push({
      callIndex: scope.callSequence,
      ...input,
    });
  }

  // Build and consume current scope summary; returns null when scope is absent/already consumed.
  consumeCurrentSummary(): LlmChapterUsageSummary | null {
    const scope = this.storage.getStore();
    if (!scope || scope.consumed) {
      return null;
    }
    scope.consumed = true;
    const finishedAt = new Date().toISOString();

    const promptTokens = scope.calls.reduce((sum, call) => sum + call.promptTokens, 0);
    const completionTokens = scope.calls.reduce((sum, call) => sum + call.completionTokens, 0);
    const totalTokens = scope.calls.reduce((sum, call) => sum + call.totalTokens, 0);
    const estimatedCostUsd = Number(
      scope.calls.reduce((sum, call) => sum + call.estimatedCostUsd, 0).toFixed(8),
    );
    const missingUsageCalls = scope.calls.filter((call) => call.tokenSource === 'missing').length;

    const grouped = new Map<
      string,
      {
        calls: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        estimatedCostUsd: number;
        totalDurationMs: number;
      }
    >();
    scope.calls.forEach((call) => {
      const current =
        grouped.get(call.taskName) ?? {
          calls: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          totalDurationMs: 0,
        };
      current.calls += 1;
      current.promptTokens += call.promptTokens;
      current.completionTokens += call.completionTokens;
      current.totalTokens += call.totalTokens;
      current.estimatedCostUsd += call.estimatedCostUsd;
      current.totalDurationMs += call.durationMs;
      grouped.set(call.taskName, current);
    });

    const byTask = [...grouped.entries()]
      .map(([taskName, value]) => ({
        taskName,
        calls: value.calls,
        promptTokens: value.promptTokens,
        completionTokens: value.completionTokens,
        totalTokens: value.totalTokens,
        estimatedCostUsd: Number(value.estimatedCostUsd.toFixed(8)),
        avgDurationMs: Number((value.totalDurationMs / Math.max(1, value.calls)).toFixed(2)),
      }))
      .sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd);

    return {
      bookId: scope.bookId,
      chapterNumber: scope.chapterNumber,
      startedAt: scope.startedAt,
      finishedAt,
      totalCalls: scope.calls.length,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      currency: 'USD',
      missingUsageCalls,
      byTask,
      calls: scope.calls,
    };
  }
}

