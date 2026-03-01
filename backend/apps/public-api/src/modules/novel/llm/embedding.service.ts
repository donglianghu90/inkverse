/** Embedding 服务 — Azure OpenAI text-embedding-3-large 语义向量生成 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly model: string;
  readonly dimensions: number;

  constructor(private readonly configService: ConfigService) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const emb = (llm.embedding ?? {}) as Record<string, unknown>;
    this.apiKey = String(emb.apiKey || '') || null;
    this.baseUrl = String(emb.baseUrl || '').replace(/\/+$/, '');
    this.model = String(emb.model || 'text-embedding-3-large');
    this.dimensions = Number(emb.dimensions) || 1536;
    if (!this.apiKey || !this.baseUrl) { this.logger.warn('Embedding API Key 或 BaseUrl 未配置，Embedding 不可用'); return; }
    this.logger.log(`Embedding 初始化完成 (model=${this.model}, dim=${this.dimensions})`);
  }

  get available(): boolean { return !!this.apiKey && !!this.baseUrl; }

  async embed(text: string): Promise<number[] | null> {
    if (!this.available) return null;
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: text, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const parsed = await res.json() as { data?: { embedding: number[] }[] };
      if (!parsed?.data?.[0]?.embedding) throw new Error(`Invalid embedding response: ${JSON.stringify(parsed).slice(0, 200)}`);
      return parsed.data[0].embedding;
    } catch (e) {
      this.logger.error(`Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.available || texts.length === 0) return texts.map(() => null);
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const parsed = await res.json() as { data?: { embedding: number[]; index: number }[] };
      if (!Array.isArray(parsed?.data)) throw new Error(`Invalid batch embedding response: ${JSON.stringify(parsed).slice(0, 200)}`);
      const data = parsed.data;
      data.sort((a, b) => a.index - b.index);
      return data.map((d) => d?.embedding ?? null);
    } catch (e) {
      this.logger.error(`批量 Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return texts.map(() => null);
    }
  }
}
