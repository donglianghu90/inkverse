/** LLM 与 Embedding — Provider 路由、元信息契约 */

export type LlmProvider = 'gemini' | 'claude' | 'openai';
export type ModelTier = 'creative' | 'standard' | 'lightweight';

export interface TaskRoute {
  provider: LlmProvider;
  tier: ModelTier;
}

export interface EmbeddingMeta {
  userId?: string;
  /** 小说模块：书籍 ID */
  bookId?: string;
  /** 小说模块：章节号 */
  chapterNumber?: number;
  /** 短剧模块：剧目 ID */
  dramaId?: string;
  /** 短剧模块：集号 */
  episodeNumber?: number;
}
