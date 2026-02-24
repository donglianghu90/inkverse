/**
 * Unit tests for chapter-level LLM usage tracker aggregation.
 */
import { LlmUsageTrackerService } from '../llm-usage-tracker.service';

describe('LlmUsageTrackerService', () => {
  it('should aggregate per-call usage into chapter summary', async () => {
    const service = new LlmUsageTrackerService();

    const summary = await service.runWithChapterScope(
      { bookId: 'book_1', chapterNumber: 3 },
      async () => {
        service.recordCall({
          taskName: 'draft-writer',
          model: 'gemini-1.5-pro',
          provider: 'gemini',
          startedAt: '2026-02-23T00:00:00.000Z',
          finishedAt: '2026-02-23T00:00:01.000Z',
          durationMs: 1000,
          promptTokens: 100,
          completionTokens: 80,
          totalTokens: 180,
          estimatedCostUsd: 0.001,
          inputRateUsdPer1M: 1,
          outputRateUsdPer1M: 1,
          tokenSource: 'usage_metadata',
          temperature: 0.8,
          tags: ['workflow', 'chapter'],
        });
        service.recordCall({
          taskName: 'reader-jury',
          model: 'gemini-1.5-pro',
          provider: 'gemini',
          startedAt: '2026-02-23T00:00:02.000Z',
          finishedAt: '2026-02-23T00:00:03.000Z',
          durationMs: 1000,
          promptTokens: 40,
          completionTokens: 20,
          totalTokens: 60,
          estimatedCostUsd: 0.0004,
          inputRateUsdPer1M: 1,
          outputRateUsdPer1M: 1,
          tokenSource: 'usage_metadata',
          temperature: 0.2,
          tags: ['workflow', 'chapter'],
        });
        return service.consumeCurrentSummary();
      },
    );

    expect(summary).not.toBeNull();
    expect(summary?.bookId).toBe('book_1');
    expect(summary?.chapterNumber).toBe(3);
    expect(summary?.totalCalls).toBe(2);
    expect(summary?.promptTokens).toBe(140);
    expect(summary?.completionTokens).toBe(100);
    expect(summary?.totalTokens).toBe(240);
    expect(summary?.estimatedCostUsd).toBe(0.0014);
    expect(summary?.byTask).toHaveLength(2);
  });
});

