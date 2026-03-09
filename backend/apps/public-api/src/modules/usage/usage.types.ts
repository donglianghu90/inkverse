/**
 * 用量计费 — 可扩展架构类型定义
 *
 * 设计原则：
 * - 小说、短剧及未来模块（漫画、播客等）均可使用 LLM、图片、向量、视频、TTS 等任意资源
 * - kind 可扩展，新增模型类型无需改动核心聚合逻辑
 * - scope 遵循 {granularity}:{id} 约定，支持 episode/chapter/scene/shot 等
 */
export const USAGE_KINDS = ['llm', 'image', 'video', 'embedding', 'tts'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** 已知 kind 的 Token 相关属性（LLM/Embedding 有 tokens） */
export const TOKEN_AWARE_KINDS: UsageKind[] = ['llm', 'embedding'];

/** scope 粒度约定：creation | {granularity}:{id} */
export type ScopeGranularity = 'creation' | 'episode' | 'chapter' | 'scene' | 'shot';

/** 按模块的 scope 主粒度（用于解析 scope 字符串） */
export const MODULE_SCOPE_GRANULARITY: Record<string, ScopeGranularity> = {
  drama: 'episode',
  novel: 'chapter',
  // 未来: comic: 'panel', podcast: 'segment'
};

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
  byKind: Record<string, {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    quantity: number;
    costCny: number;
  }>;
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

/**
 * 解析 scope 提取粒度编号
 * @example parseScopeId('episode:5') => { granularity: 'episode', id: 5 }
 * @example parseScopeId('chapter:12') => { granularity: 'chapter', id: 12 }
 */
export function parseScopeId(scope: string): { granularity: ScopeGranularity; id: number } | null {
  if (scope === 'creation') return { granularity: 'creation', id: 0 };
  const m = scope.match(/^(episode|chapter|scene|shot):(\d+)$/);
  if (!m) return null;
  return { granularity: m[1] as ScopeGranularity, id: +m[2] };
}

/** 构建 scope 字符串 */
export function buildScope(granularity: Exclude<ScopeGranularity, 'creation'>, id: number): string {
  return `${granularity}:${id}`;
}
