import { Injectable } from '@nestjs/common';

export interface LlmCallRecord {
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
  tokenSource: string;
  temperature: number;
  tags: string[];
}

export interface ProviderSummary {
  provider: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ModelSummary {
  model: string;
  tier: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface TaskSummary {
  taskName: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ChapterUsageSummary {
  totalCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  byProvider: ProviderSummary[];
  byModel: ModelSummary[];
  byTask: TaskSummary[];
}

@Injectable()
export class LlmUsageTrackerService {
  private calls: LlmCallRecord[] = [];
  private consumed = false;

  recordCall(record: LlmCallRecord): void {
    this.calls.push(record);
  }

  consumeCurrentSummary(): ChapterUsageSummary | null {
    if (this.consumed || this.calls.length === 0) return null;
    this.consumed = true;

    const summary: ChapterUsageSummary = {
      totalCalls: this.calls.length,
      promptTokens: this.calls.reduce((s, c) => s + c.promptTokens, 0),
      completionTokens: this.calls.reduce((s, c) => s + c.completionTokens, 0),
      totalTokens: this.calls.reduce((s, c) => s + c.totalTokens, 0),
      totalCostUsd: this.calls.reduce((s, c) => s + c.estimatedCostUsd, 0),
      totalDurationMs: this.calls.reduce((s, c) => s + c.durationMs, 0),
      byProvider: this.aggregateByProvider(),
      byModel: this.aggregateByModel(),
      byTask: this.aggregateByTask(),
    };
    return summary;
  }

  async runWithChapterScope<T>(
    _scope: { bookId: string; chapterNumber: number },
    fn: () => Promise<T>,
  ): Promise<T> {
    this.calls = [];
    this.consumed = false;
    return fn();
  }

  private aggregateByProvider(): ProviderSummary[] {
    const map = new Map<string, ProviderSummary>();
    for (const c of this.calls) {
      const existing = map.get(c.provider);
      if (existing) {
        existing.calls++;
        existing.promptTokens += c.promptTokens;
        existing.completionTokens += c.completionTokens;
        existing.totalTokens += c.totalTokens;
        existing.estimatedCostUsd += c.estimatedCostUsd;
      } else {
        map.set(c.provider, {
          provider: c.provider, calls: 1,
          promptTokens: c.promptTokens, completionTokens: c.completionTokens,
          totalTokens: c.totalTokens, estimatedCostUsd: c.estimatedCostUsd,
        });
      }
    }
    return [...map.values()];
  }

  private aggregateByModel(): ModelSummary[] {
    const map = new Map<string, ModelSummary>();
    for (const c of this.calls) {
      const existing = map.get(c.model);
      if (existing) {
        existing.calls++;
        existing.promptTokens += c.promptTokens;
        existing.completionTokens += c.completionTokens;
        existing.totalTokens += c.totalTokens;
        existing.estimatedCostUsd += c.estimatedCostUsd;
      } else {
        map.set(c.model, {
          model: c.model, tier: c.tier, calls: 1,
          promptTokens: c.promptTokens, completionTokens: c.completionTokens,
          totalTokens: c.totalTokens, estimatedCostUsd: c.estimatedCostUsd,
        });
      }
    }
    return [...map.values()];
  }

  private aggregateByTask(): TaskSummary[] {
    const map = new Map<string, TaskSummary>();
    for (const c of this.calls) {
      const existing = map.get(c.taskName);
      if (existing) {
        existing.calls++;
        existing.promptTokens += c.promptTokens;
        existing.completionTokens += c.completionTokens;
        existing.totalTokens += c.totalTokens;
        existing.estimatedCostUsd += c.estimatedCostUsd;
      } else {
        map.set(c.taskName, {
          taskName: c.taskName, calls: 1,
          promptTokens: c.promptTokens, completionTokens: c.completionTokens,
          totalTokens: c.totalTokens, estimatedCostUsd: c.estimatedCostUsd,
        });
      }
    }
    return [...map.values()];
  }
}
