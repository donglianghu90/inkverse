/** Embedding 服务 — Azure OpenAI text-embedding-3-large 语义向量生成 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import { UsageLedgerService } from '../../usage/usage-ledger.service';
import type { EmbeddingMeta } from '../interfaces';

export type { EmbeddingMeta } from '../interfaces';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly model: string;
  readonly dimensions: number;
  private readonly costPer1MTokens: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly usageLedger: UsageLedgerService,
  ) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const emb = (llm.embedding ?? {}) as Record<string, unknown>;
    this.apiKey = String(emb.apiKey || '') || null;
    this.baseUrl = String(emb.baseUrl || '').replace(/\/+$/, '');
    this.model = String(emb.model || 'text-embedding-3-large');
    this.dimensions = Number(emb.dimensions) || 1536;
    this.costPer1MTokens = Number(emb.costPer1MTokens) || 1.4;
    if (!this.apiKey || !this.baseUrl) { this.logger.warn('Embedding API Key 或 BaseUrl 未配置，Embedding 不可用'); return; }
    this.logger.log(`Embedding 初始化完成 (model=${this.model}, dim=${this.dimensions})`);
  }

  get available(): boolean { return !!this.apiKey && !!this.baseUrl; }

  async embed(text: string, meta?: EmbeddingMeta): Promise<number[] | null> {
    if (!this.available) return null;
    const t0 = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: text, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const parsed = await res.json() as { data?: { embedding: number[] }[]; usage?: { total_tokens?: number } };
      if (!parsed?.data?.[0]?.embedding) throw new Error(`Invalid embedding response: ${JSON.stringify(parsed).slice(0, 200)}`);
      const tokens = parsed.usage?.total_tokens ?? 0;
      this.recordUsage(tokens, true, Date.now() - t0, meta);
      return parsed.data[0].embedding;
    } catch (e) {
      this.logger.error(`Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      this.recordUsage(0, false, Date.now() - t0, meta);
      return null;
    }
  }

  async embedBatch(texts: string[], meta?: EmbeddingMeta): Promise<(number[] | null)[]> {
    if (!this.available || texts.length === 0) return texts.map(() => null);
    const t0 = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const parsed = await res.json() as { data?: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
      if (!Array.isArray(parsed?.data)) throw new Error(`Invalid batch embedding response: ${JSON.stringify(parsed).slice(0, 200)}`);
      const data = parsed.data;
      data.sort((a, b) => a.index - b.index);
      const tokens = parsed.usage?.total_tokens ?? 0;
      this.recordUsage(tokens, true, Date.now() - t0, meta);
      return data.map((d) => d?.embedding ?? null);
    } catch (e) {
      this.logger.error(`批量 Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      this.recordUsage(0, false, Date.now() - t0, meta);
      return texts.map(() => null);
    }
  }

  private recordUsage(tokens: number, ok: boolean, durationMs: number, meta?: EmbeddingMeta) {
    const costCny = ok && tokens > 0 ? (tokens / 1_000_000) * this.costPer1MTokens : 0;
    const module = meta?.dramaId ? 'drama' : meta?.bookId ? 'novel' : 'unknown';
    const resourceId = meta?.dramaId ?? meta?.bookId ?? '';
    let scope = 'creation';
    if (meta?.episodeNumber != null) scope = `episode:${meta.episodeNumber}`;
    else if (meta?.chapterNumber != null) scope = `chapter:${meta.chapterNumber}`;
    this.usageLedger.record({
      userId: meta?.userId ?? '',
      module,
      resourceId,
      scope,
      action: 'embedding',
      kind: 'embedding',
      provider: 'openai',
      model: this.model,
      tokensIn: tokens,
      costCny,
      ok,
      durationMs,
    }).catch(() => {});
  }
}
