import { NovelService } from './novel.service';

function createServiceForArtifactTests() {
  const bookRepo = {} as any;
  const chapterRepo = {
    findOneBy: jest.fn(),
  } as any;
  const artifactRepo = {
    find: jest.fn(),
  } as any;

  const service = new NovelService(
    bookRepo,
    chapterRepo,
    artifactRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { service, chapterRepo, artifactRepo };
}

describe('NovelService.getChapterArtifacts', () => {
  it('deduplicates names and returns found/missing artifacts by requested order', async () => {
    const { service, chapterRepo, artifactRepo } = createServiceForArtifactTests();
    chapterRepo.findOneBy.mockResolvedValue({
      bookId: 'book-1',
      chapterNumber: 8,
      content: '本章正文',
    });
    artifactRepo.find.mockResolvedValue([
      { name: 'intent', payload: { goals: ['推进主线'] } },
      { name: 'arc_director', payload: { mustHit: [] } },
    ]);

    const result = (await service.getChapterArtifacts(
      'book-1',
      8,
      ' intent , review,intent ',
    )) as any;

    expect(result.names).toEqual(['intent', 'review']);
    expect(result.artifacts).toEqual([
      { name: 'intent', found: true, payload: { goals: ['推进主线'] } },
      { name: 'review', found: false, payload: null },
    ]);
  });

  it('computes high alignment score when chapter content hits mustHit/goals/hook', async () => {
    const { service, chapterRepo, artifactRepo } = createServiceForArtifactTests();
    chapterRepo.findOneBy.mockResolvedValue({
      bookId: 'book-2',
      chapterNumber: 21,
      content:
        '韩立在石门前先突破阵法，再击退守卫，成功夺取令牌。\n' +
        '众人刚松一口气，章末黑影现身，下一轮危机降临。',
    });
    artifactRepo.find.mockResolvedValue([
      {
        name: 'arc_director',
        payload: {
          mustHit: ['突破阵法', '击退守卫'],
          hookDirective: '黑影现身',
        },
      },
      {
        name: 'intent',
        payload: {
          goals: ['突破阵法', '夺取令牌'],
          hookDirection: '黑影现身',
        },
      },
      { name: 'review', payload: { overallScore: 8.8 } },
      { name: 'deterministic_check', payload: { pass: true, failedChecks: [] } },
    ]);

    const result = (await service.getChapterArtifacts('book-2', 21)) as any;
    const alignment = result.alignment;

    expect(alignment).toBeTruthy();
    expect(alignment.overallAlignmentScore).toBeGreaterThanOrEqual(95);
    expect(alignment.mustHit.matched).toBe(2);
    expect(alignment.intentGoals.matched).toBe(2);
    expect(alignment.hookDirection?.matched).toBe(true);
    expect(alignment.remediation?.shouldRewrite).toBe(false);
  });

  it('triggers remediation when alignment score is below rewrite threshold', async () => {
    const { service, chapterRepo, artifactRepo } = createServiceForArtifactTests();
    chapterRepo.findOneBy.mockResolvedValue({
      bookId: 'book-3',
      chapterNumber: 34,
      content: '众人只是在集市闲逛聊天，没有推进任何冲突。',
    });
    artifactRepo.find.mockResolvedValue([
      {
        name: 'arc_director',
        payload: {
          mustHit: ['血祭开门', '击杀守关人'],
          hookDirective: '古殿崩塌',
        },
      },
      {
        name: 'intent',
        payload: {
          goals: ['血祭开门', '夺取阵眼'],
          hookDirection: '古殿崩塌',
        },
      },
      { name: 'review', payload: { overallScore: 6.2 } },
      { name: 'deterministic_check', payload: { pass: true, failedChecks: [] } },
    ]);

    const result = (await service.getChapterArtifacts('book-3', 34)) as any;
    const alignment = result.alignment;

    expect(alignment.overallAlignmentScore).toBeLessThan(45);
    expect(alignment.remediation?.shouldRewrite).toBe(true);
    expect(alignment.remediation?.severity).toBe('high');
    expect(alignment.remediation?.reasons.join(' | ')).toContain('mustHit');
    expect(alignment.remediation?.rewritePrompt).toContain('必须命中');
  });
});
