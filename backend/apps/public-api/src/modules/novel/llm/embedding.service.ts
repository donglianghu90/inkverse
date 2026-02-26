/** Embedding 服务 — Gemini REST API 语义向量生成，支持 outputDimensionality 降维。 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';

const DEFAULT_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 768;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string | null;
  private readonly embModel: string;
  readonly dimensions = DIMENSIONS;

  constructor(private readonly configService: ConfigService) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const gemini = (llm.gemini ?? {}) as Record<string, unknown>;
    const google = (llm.google ?? {}) as Record<string, unknown>;
    this.apiKey = String(gemini.apiKey || google.apiKey || '') || null;
    this.embModel = String((llm.embedding as Record<string, unknown>)?.model || DEFAULT_MODEL);
    if (!this.apiKey) { this.logger.warn('GEMINI_API_KEY 未配置，Embedding 不可用'); return; }
    this.logger.log(`Embedding 初始化完成 (model=${this.embModel}, dim=${DIMENSIONS})`);
  }

  get available(): boolean { return this.apiKey !== null; }

  async embed(text: string): Promise<number[] | null> {
    if (!this.apiKey) return null;
    try {
      const res = await fetch(`${API_BASE}/models/${this.embModel}:embedContent?key=${this.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `models/${this.embModel}`, content: { parts: [{ text }] }, outputDimensionality: DIMENSIONS }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return ((await res.json()) as { embedding: { values: number[] } }).embedding.values;
    } catch (e) {
      this.logger.error(`Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.apiKey || texts.length === 0) return texts.map(() => null);
    try {
      const requests = texts.map((text) => ({ model: `models/${this.embModel}`, content: { parts: [{ text }] }, outputDimensionality: DIMENSIONS }));
      const res = await fetch(`${API_BASE}/models/${this.embModel}:batchEmbedContents?key=${this.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return ((await res.json()) as { embeddings: { values: number[] }[] }).embeddings.map((e) => e.values);
    } catch (e) {
      this.logger.error(`批量 Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return texts.map(() => null);
    }
  }
}
