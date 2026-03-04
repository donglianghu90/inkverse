/** 章节类型与弧阶段统一映射，避免各 Agent 口径漂移。 */
export function mapBeatRoleToChapterType(beatRole?: string | null): string | undefined {
  if (!beatRole) return undefined;
  const normalized = beatRole.trim();
  const typeMap: Record<string, string> = {
    setup: 'setup',
    escalation: 'rising',
    twist: 'climax',
    climax: 'climax',
    aftermath: 'relief',
    transition: 'relief',
    rising: 'rising',
    relief: 'relief',
    introspective: 'introspective',
    fragmentary: 'fragmentary',
    atmospheric: 'atmospheric',
    general: 'general',
  };
  return typeMap[normalized] ?? normalized;
}

export function mapBeatRoleToArcStage(beatRole?: string | null): string | undefined {
  if (!beatRole) return undefined;
  const normalized = beatRole.trim();
  const stageMap: Record<string, string> = {
    setup: 'entry',
    escalation: 'build',
    rising: 'build',
    twist: 'twist',
    climax: 'climax',
    aftermath: 'aftermath',
    relief: 'aftermath',
    transition: 'transition',
    introspective: 'build',
    fragmentary: 'build',
    atmospheric: 'entry',
  };
  return stageMap[normalized] ?? normalized;
}
