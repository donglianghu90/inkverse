import { BookStrategy } from '../schemas/novel-state.schemas';

export function buildBookStrategyPromptBlock(strategy?: BookStrategy): string {
  if (!strategy) return '';
  const lines: string[] = ['=== 书级策略（L2，铁律和题材规则优先）==='];
  if (strategy.coreNarrativeContract) lines.push(`叙事契约：${strategy.coreNarrativeContract}`);
  if (strategy.audienceDeliveryPolicy) lines.push(`读者交付：${strategy.audienceDeliveryPolicy}`);
  if (strategy.toneGuardrails?.length) lines.push(`调性护栏：${strategy.toneGuardrails.join('；')}`);
  return lines.join('\n');
}

export function buildPolicySliceBlock(strategy?: BookStrategy): string {
  if (!strategy) return '';
  const lines: string[] = ['=== 卷级策略切片（在不违反铁律前提下执行）==='];
  const h = strategy.hookCadencePolicy;
  const t = strategy.threadPolicy;
  const c = strategy.characterFocusPolicy;
  if (h) {
    lines.push(
      `hookCadencePolicy：偏好[${(h.preferredTypes ?? []).join('、') || '无'}]，重复窗口${h.avoidRecentRepeatWindow ?? 3}章，激进度${h.urgencyBias ?? 'balanced'}，结尾指令=${h.chapterEndingDirective || '无'}`,
    );
  }
  if (t) {
    lines.push(
      `threadPolicy：每章新坑≤${t.maxNewThreadsPerChapter ?? 2}，优先动作[${(t.preferredActions ?? []).join('、')}]，逾期优先级${t.overduePriority ?? 'medium'}，回收密度${t.payoffDensityBias ?? 'balanced'}，说明=${t.guidance || '无'}`,
    );
  }
  if (c) {
    lines.push(
      `characterFocusPolicy：核心[${(c.coreCharacterIds ?? []).join('、') || '无'}]，辅助[${(c.supportCharacterIds ?? []).join('、') || '无'}]，轮转${c.rotationMode ?? 'soft'}，每章角色时刻≥${c.minCharacterMomentPerChapter ?? 0}，说明=${c.guidance || '无'}`,
    );
  }
  const b = strategy.characterBudget;
  if (b) {
    lines.push(
      `characterBudget：每章≤${b.maxPresentPerChapter}人，弧内新角色≤${b.maxNewPerArc}，核心缺席${b.coreAbsenceAlert}章告警，重要缺席${b.majorAbsenceAlert}章告警，配角冷却${b.minorCooldown}章，龙套冷却${b.cameoCooldown}章`,
    );
  }
  return lines.join('\n');
}
