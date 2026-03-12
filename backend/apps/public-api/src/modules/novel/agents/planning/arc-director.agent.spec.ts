import { ArcDirectorAgent } from './arc-director.agent';

describe('ArcDirectorAgent growth arc phase resolving', () => {
  it('parses non-standard chapter ranges and maps to expected phase', () => {
    const agent = new ArcDirectorAgent({} as any);
    const idx = (agent as any).resolveGrowthArcPhaseIndex(
      42,
      4,
      4,
      200,
      ['第1-50章', '约51-100', '101 至 150', '151-200'],
    );
    expect(idx).toBe(0);
  });

  it('falls back to progress-based index when range is unparseable', () => {
    const agent = new ArcDirectorAgent({} as any);
    const idx = (agent as any).resolveGrowthArcPhaseIndex(
      120,
      4,
      4,
      200,
      ['待定', '待定', '待定', '待定'],
    );
    expect(idx).toBe(2);
  });
});

