/** 短剧工作流执行 — 摘要契约 */

export interface DramaSkippedStepSummary {
  stepKey: string;
  nodeId?: string;
  skipReason?: string;
  message?: string;
}

export interface DramaExecutionSummary {
  overallScore?: number;
  shotCount?: number;
  duration?: number;
  totalDurationMs: number;
  editRounds: number;
  skippedSteps?: DramaSkippedStepSummary[];
}
