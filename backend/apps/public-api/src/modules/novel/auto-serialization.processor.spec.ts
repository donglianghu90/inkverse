import {
  AutoSerializationProcessor,
  AutoSerializationScheduleRecord,
} from './auto-serialization.processor';

function buildSchedule(
  overrides: Partial<AutoSerializationScheduleRecord> = {},
): AutoSerializationScheduleRecord {
  const now = new Date().toISOString();
  return {
    bookId: 'book-1',
    enabled: true,
    dailyStartTime: '08:00',
    chaptersPerRun: 3,
    runEveryDays: 2,
    maxRepairRounds: 2,
    minQualityScore: 7,
    minOverallScore: 7,
    nextRunAt: new Date(Date.now() + 86_400_000).toISOString(),
    lastRunAt: null,
    runStartedAt: null,
    running: false,
    lastError: null,
    lastResult: null,
    consecutiveLowQualityRuns: 0,
    interventionRequired: false,
    interventionReason: null,
    interventionChapterNumber: null,
    interventionMarkerChapters: [],
    interventionRaisedAt: null,
    interventionExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AutoSerializationProcessor', () => {
  it('keeps the existing future nextRunAt on manual trigger', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) } as any;
    const novelService = {
      generateChaptersBatch: jest.fn().mockResolvedValue({ stopReason: null }),
    } as any;
    const processor = new AutoSerializationProcessor(repo, novelService);
    const futureNextRunAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const schedule = buildSchedule({ nextRunAt: futureNextRunAt });

    const output = await (processor as any).executeClaimedSchedule(schedule, 'manual');
    const updated = repo.update.mock.calls[0][1];

    expect(output.nextRunAt).toBe(futureNextRunAt);
    expect(updated.nextRunAt?.toISOString()).toBe(futureNextRunAt);
  });

  it('accumulates intervention markers and opens intervention window on threshold breach', async () => {
    const repo = { update: jest.fn().mockResolvedValue({ affected: 1 }) } as any;
    const novelService = {
      generateChaptersBatch: jest.fn().mockResolvedValue({
        stopReason: 'quality_threshold_failed_at_chapter_15',
      }),
    } as any;
    const processor = new AutoSerializationProcessor(repo, novelService);
    const schedule = buildSchedule({
      consecutiveLowQualityRuns: 2,
      interventionMarkerChapters: [12],
      interventionChapterNumber: 12,
      maxRepairRounds: 3,
      runEveryDays: 3,
    });

    const output = await (processor as any).executeClaimedSchedule(schedule, 'scheduled');
    const updated = repo.update.mock.calls[0][1];

    expect(updated.consecutiveLowQualityRuns).toBe(3);
    expect(updated.interventionRequired).toBe(true);
    expect(updated.interventionChapterNumber).toBe(15);
    expect(updated.interventionMarkerChapters).toEqual([12, 15]);
    expect(updated.interventionExpiresAt).toBeInstanceOf(Date);

    expect(output.result.autoRepair.interventionRequired).toBe(true);
    expect(output.result.autoRepair.interventionMarkerChapters).toEqual([12, 15]);
  });
});

