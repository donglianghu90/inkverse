/** Embedding 服务 — Gemini text-embedding 语义向量生成，支持单条/批量。 */
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ConfigService } from '@packages/modules';

const DEFAULT_MODEL = 'text-embedding-004';
const DIMENSIONS = 768;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model: GoogleGenerativeAIEmbeddings | null;
  readonly dimensions = DIMENSIONS;

  constructor(private readonly configService: ConfigService) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const gemini = (llm.gemini ?? {}) as Record<string, unknown>;
    const google = (llm.google ?? {}) as Record<string, unknown>;
    const apiKey = String(gemini.apiKey || google.apiKey || '');
    const embModel = String((llm.embedding as Record<string, unknown>)?.model || DEFAULT_MODEL);
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY 未配置，Embedding 不可用');
      this.model = null;
      return;
    }
    this.model = new GoogleGenerativeAIEmbeddings({ apiKey, model: embModel });
    this.logger.log(`Embedding 初始化完成 (model=${embModel}, dim=${DIMENSIONS})`);
  }

  get available(): boolean { return this.model !== null; }

  async embed(text: string): Promise<number[] | null> {
    if (!this.model) return null;
    try { return await this.model.embedQuery(text); }
    catch (e) {
      this.logger.error(`Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.model || texts.length === 0) return texts.map(() => null);
    try { return await this.model.embedDocuments(texts); }
    catch (e) {
      this.logger.error(`批量 Embedding 失败: ${e instanceof Error ? e.message : String(e)}`);
      return texts.map(() => null);
    }
  }
}
