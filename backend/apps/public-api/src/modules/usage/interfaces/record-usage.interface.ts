/**
 * 用量记录 — 写入契约
 * 供 LlmService、EmbeddingService、MediaService 等调用 usageLedger.record 时使用
 */
export interface RecordUsageInput {
  userId: string;
  module: string;
  resourceId: string;
  scope: string;
  action: string;
  kind: string;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  quantity?: number;
  costCny: number;
  ok: boolean;
  durationMs?: number;
  idempotencyKey?: string;
}
