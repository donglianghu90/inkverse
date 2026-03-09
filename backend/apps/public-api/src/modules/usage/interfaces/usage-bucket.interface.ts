/**
 * 用量聚合 — 返回契约
 * 供 userDashboard、resourceDetail、resourceDetailForDrama 等 API 返回使用
 */

export interface KindBucket {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  quantity: number;
  costCny: number;
}

/** 统一聚合 bucket 输出 — 支持任意 kind，便于前端按需展示 */
export interface UsageBucketView {
  /** 按 kind 分组的明细（可扩展） */
  byKind: Record<string, KindBucket>;
  /** 总费用（人民币） */
  costCny: number;
  /** 便捷字段：LLM tokens（兼容现有前端） */
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCostCny: number;
  imageCalls: number;
  imageCostCny: number;
  videoCalls: number;
  videoCostCny: number;
  embeddingCalls: number;
  embeddingTokens: number;
  embeddingCostCny: number;
  ttsCalls: number;
  ttsCostCny: number;
  apiSuccessCalls: number;
  apiFailedCalls: number;
}
