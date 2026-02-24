/**
 * 报告归一化工具：
 * 将 LLM 报告中的"主观 pass 字段"收敛到可重复的规则阈值。
 * 支持基于章节阶段和里程碑的动态阈值调整。
 */
import {
  ContinuityReport,
  ReaderJuryReport,
} from '../schemas/novel.schemas';

export interface JuryNormalizationContext {
  chapterNumber?: number;
  isMilestoneChapter?: boolean;
}

function resolveJuryThresholds(ctx?: JuryNormalizationContext): {
  overall: number;
  cliffhanger: number;
} {
  const chapter = ctx?.chapterNumber ?? 0;
  if (ctx?.isMilestoneChapter) return { overall: 8, cliffhanger: 8 };
  if (chapter >= 1 && chapter <= 3) return { overall: 6, cliffhanger: 6 };
  return { overall: 7, cliffhanger: 7 };
}

export function normalizeJuryReport(
  report: ReaderJuryReport,
  ctx?: JuryNormalizationContext,
): ReaderJuryReport {
  const normalizedPatchPlan = dedupe(report.patchPlan.map((x) => x.trim()).filter(Boolean));
  const normalizedToxicPoints = dedupe(report.toxicPoints.map((x) => x.trim()).filter(Boolean));
  const thresholds = resolveJuryThresholds(ctx);
  const passByThreshold =
    report.overallScore >= thresholds.overall &&
    report.dimensions.cliffhanger >= thresholds.cliffhanger;

  if (passByThreshold) {
    return {
      ...report,
      pass: true,
      patchPlan: normalizedPatchPlan,
      toxicPoints: normalizedToxicPoints,
    };
  }

  return {
    ...report,
    pass: false,
    patchPlan:
      normalizedPatchPlan.length > 0
        ? normalizedPatchPlan
        : [`强化尾段悬念与未决冲突，确保悬念分>=${thresholds.cliffhanger}且总分>=${thresholds.overall}`],
    toxicPoints:
      normalizedToxicPoints.length > 0
        ? normalizedToxicPoints
        : [`读者留存风险：评分低于当前阶段通过阈值(overall>=${thresholds.overall},cliffhanger>=${thresholds.cliffhanger})`],
  };
}

/**
 * 归一化连续性报告，保证"有问题就不通过"。
 */
export function normalizeContinuityReport(report: ContinuityReport): ContinuityReport {
  const normalizedIssues = dedupe(report.issues.map((x) => x.trim()).filter(Boolean));
  const normalizedPatchPlan = dedupe(report.patchPlan.map((x) => x.trim()).filter(Boolean));
  const passByIssues = normalizedIssues.length === 0;

  if (passByIssues) {
    return {
      ...report,
      pass: true,
      issues: [],
      patchPlan: normalizedPatchPlan,
    };
  }

  return {
    ...report,
    pass: false,
    issues: normalizedIssues,
    patchPlan:
      normalizedPatchPlan.length > 0
        ? normalizedPatchPlan
        : ['补齐角色/道具/地点状态前后因果，并消除时间线冲突'],
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
