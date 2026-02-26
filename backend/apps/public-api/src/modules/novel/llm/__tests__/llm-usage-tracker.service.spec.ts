/** 章节级LLM用量追踪聚合测试 */
import { LlmUsageTrackerService } from '../llm-usage-tracker.service';

describe('LlmUsageTrackerService', () => {
  it('should aggregate per-call usage into chapter summary with byProvider/byModel', async () => {
    const service = new LlmUsageTrackerService();
    const summary = await service.runWithChapterScope({ bookId: 'book_1', chapterNumber: 3 }, async () => {
      service.recordCall({
        taskName: 'creative-writer', model: 'claude-opus-4-20250514', provider: 'claude', tier: 'creative',
        startedAt: '2026-02-23T00:00:00Z', finishedAt: '2026-02-23T00:00:05Z', durationMs: 5000,
        promptTokens: 2000, completionTokens: 3000, totalTokens: 5000, estimatedCostUsd: 0.085,
        inputRateUsdPer1M: 5, outputRateUsdPer1M: 25, tokenSource: 'usage_metadata', temperature: 0.85, tags: ['novel-engine'],
      });
      service.recordCall({
        taskName: 'scene-planner', model: 'claude-sonnet-4-20250514', provider: 'claude', tier: 'standard',
        startedAt: '2026-02-23T00:00:06Z', finishedAt: '2026-02-23T00:00:08Z', durationMs: 2000,
        promptTokens: 800, completionTokens: 400, totalTokens: 1200, estimatedCostUsd: 0.0084,
        inputRateUsdPer1M: 3, outputRateUsdPer1M: 15, tokenSource: 'usage_metadata', temperature: 0.5, tags: ['novel-engine'],
      });
      service.recordCall({
        taskName: 'text-analyzer', model: 'gemini-3-pro-preview', provider: 'gemini', tier: 'lightweight',
        startedAt: '2026-02-23T00:00:09Z', finishedAt: '2026-02-23T00:00:10Z', durationMs: 1000,
        promptTokens: 500, completionTokens: 200, totalTokens: 700, estimatedCostUsd: 0,
        inputRateUsdPer1M: 0, outputRateUsdPer1M: 0, tokenSource: 'usage_metadata', temperature: 0.3, tags: ['novel-engine'],
      });
      return service.consumeCurrentSummary();
    });
    expect(summary).not.toBeNull();
    expect(summary!.totalCalls).toBe(3);
    expect(summary!.promptTokens).toBe(3300);
    expect(summary!.completionTokens).toBe(3600);
    expect(summary!.totalTokens).toBe(6900);
    // byProvider: claude 2 calls, gemini 1 call
    expect(summary!.byProvider).toHaveLength(2);
    expect(summary!.byProvider[0].provider).toBe('claude');
    expect(summary!.byProvider[0].calls).toBe(2);
    // byModel: 3 distinct models
    expect(summary!.byModel).toHaveLength(3);
    expect(summary!.byModel[0].model).toBe('claude-opus-4-20250514');
    expect(summary!.byModel[0].tier).toBe('creative');
    // byTask: 3 tasks
    expect(summary!.byTask).toHaveLength(3);
    expect(summary!.byTask[0].taskName).toBe('creative-writer');
  });

  it('should return null when consumed twice', async () => {
    const service = new LlmUsageTrackerService();
    await service.runWithChapterScope({ bookId: 'b', chapterNumber: 1 }, async () => {
      service.recordCall({
        taskName: 't', model: 'm', provider: 'gemini', tier: 'standard',
        startedAt: '', finishedAt: '', durationMs: 100, promptTokens: 10, completionTokens: 5, totalTokens: 15,
        estimatedCostUsd: 0, inputRateUsdPer1M: 0, outputRateUsdPer1M: 0, tokenSource: 'missing', temperature: 0.5, tags: [],
      });
      expect(service.consumeCurrentSummary()).not.toBeNull();
      expect(service.consumeCurrentSummary()).toBeNull();
    });
  });
});
