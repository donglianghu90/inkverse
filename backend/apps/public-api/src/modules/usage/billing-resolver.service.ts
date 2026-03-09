/**
 * 计费解析服务 — 按 kind/provider/model 等维度解析单价，支持不同模型不同计费规则
 * 配置值为人民币（CNY），无需汇率转换
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@packages/modules';

@Injectable()
export class BillingResolverService {
  private readonly imageCost: Record<string, number | Record<string, unknown>> = {};
  private readonly videoCost: Record<string, number | Record<string, unknown>> = {};
  private readonly ttsCost: Record<string, number | Record<string, unknown>> = {};
  private readonly embeddingCostPer1M: number;

  constructor(private readonly config: ConfigService) {
    const mediaCost = (this.config.get('media.cost') ?? {}) as Record<string, unknown>;
    const image = (mediaCost.image ?? {}) as Record<string, unknown>;
    const video = (mediaCost.video ?? {}) as Record<string, unknown>;
    const tts = (mediaCost.tts ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(image)) this.imageCost[k] = typeof v === 'number' ? v : (v as Record<string, unknown>);
    for (const [k, v] of Object.entries(video)) this.videoCost[k] = typeof v === 'number' ? v : (v as Record<string, unknown>);
    for (const [k, v] of Object.entries(tts)) this.ttsCost[k] = typeof v === 'number' ? v : (v as Record<string, unknown>);
    const emb = (this.config.get('llm.embedding') ?? {}) as Record<string, unknown>;
    this.embeddingCostPer1M = Number(emb.costPer1MTokens) || 1.4;
  }

  /** 图片：按 provider → model 查价，fallback 0.43 CNY/张 */
  resolveImageCostUsd(provider: string, model?: string, _size?: string): number {
    const p = this.imageCost[provider];
    if (p == null) return 0.43;
    if (typeof p === 'number') return p;
    const modelVal = model ? (p[model] as number) : null;
    if (typeof modelVal === 'number') return modelVal;
    return Number((p as Record<string, unknown>).default) || 0.43;
  }

  /** 视频：按 provider → quality/model 查价，fallback 5.4 CNY/条 */
  resolveVideoCostUsd(provider: string, qualityOrModel?: string): number {
    const p = this.videoCost[provider];
    if (p == null) return 5.4;
    if (typeof p === 'number') return p;
    const q = qualityOrModel ? (p[qualityOrModel] as number) : null;
    if (typeof q === 'number') return q;
    return Number((p as Record<string, unknown>).default) || 5.4;
  }

  /** TTS：按 provider → model/voice 查价，fallback 0.11 CNY/条 */
  resolveTtsCostUsd(provider: string, modelOrVoice?: string): number {
    const p = this.ttsCost[provider];
    if (p == null) return 0.11;
    if (typeof p === 'number') return p;
    const m = modelOrVoice ? (p[modelOrVoice] as number) : null;
    if (typeof m === 'number') return m;
    return Number((p as Record<string, unknown>).default) || 0.11;
  }

  /** Embedding：按 tokens 计价（CNY/百万 tokens），当前单 provider */
  resolveEmbeddingCostUsd(tokens: number, _provider?: string): number {
    return tokens > 0 ? (tokens / 1_000_000) * this.embeddingCostPer1M : 0;
  }

  get embeddingCostPer1MTokens(): number {
    return this.embeddingCostPer1M;
  }
}
