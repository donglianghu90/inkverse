/**
 * 计费规则 — 不同模型/粒度对应不同费率
 *
 * 设计原则：
 * - LLM: provider + tier，输入/输出分别计价 (USD/1M tokens)
 * - Embedding: provider + model，按 tokens 计价
 * - Image: provider + model(可选) + size(可选)，按张计价
 * - Video: provider + model(可选) + duration/quality(可选)，按条或按时长计价
 * - TTS: provider + model(可选)，按字符/条计价
 */
export type BillingKind = 'llm' | 'embedding' | 'image' | 'video' | 'tts';

/** LLM 按 tier 分输入/输出费率 */
export interface LlmBillingConfig {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
}

/** Embedding 按 tokens 计价 */
export interface EmbeddingBillingConfig {
  costPer1MTokens: number;
}

/** Image 按张计价，可细化到 model/size */
export interface ImageBillingConfig {
  /** provider 级别默认价/张 */
  [provider: string]: number | Record<string, number | Record<string, number>>;
  // 示例: volcengine: 0.04 或 volcengine: { 'doubao-seedream': 0.05, default: 0.04 }
}

/** Video 按条计价，可按时长/清晰度 */
export interface VideoBillingConfig {
  [provider: string]: number | Record<string, number | Record<string, number>>;
}

/** TTS 按条/按字符计价 */
export interface TtsBillingConfig {
  [provider: string]: number | Record<string, number>;
}

export interface MediaBillingConfig {
  image?: ImageBillingConfig;
  video?: VideoBillingConfig;
  tts?: TtsBillingConfig;
}
