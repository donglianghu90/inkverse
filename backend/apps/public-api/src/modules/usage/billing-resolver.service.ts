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
    for (const [k, v] of Object.entries(image)) this.imageCost[k] = BillingResolverService.coerceEntry(v, `media.cost.image.${k}`);
    for (const [k, v] of Object.entries(video)) this.videoCost[k] = BillingResolverService.coerceEntry(v, `media.cost.video.${k}`);
    for (const [k, v] of Object.entries(tts)) this.ttsCost[k] = BillingResolverService.coerceEntry(v, `media.cost.tts.${k}`);
    const emb = (this.config.get('llm.embedding') ?? {}) as Record<string, unknown>;
    this.embeddingCostPer1M = Number(emb.costPer1MTokens) || 1.4;
  }

  /** 将配置值强转为 number 或嵌套 Record，string 数值自动 coerce，无效值 fast-fail */
  private static coerceEntry(v: unknown, path: string): number | Record<string, unknown> {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid billing config: ${path} = "${v}" is not a valid number`);
      return n;
    }
    if (typeof v === 'object' && v !== null) {
      const result: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (typeof v2 === 'object' && v2 !== null) {
          // 深层嵌套（如 model → size 映射）
          const nested: Record<string, unknown> = {};
          for (const [k3, v3] of Object.entries(v2 as Record<string, unknown>)) {
            nested[k3] = BillingResolverService.coerceLeaf(v3, `${path}.${k2}.${k3}`);
          }
          result[k2] = nested;
        } else {
          result[k2] = BillingResolverService.coerceLeaf(v2, `${path}.${k2}`);
        }
      }
      return result;
    }
    throw new Error(`Invalid billing config: ${path} has unexpected type ${typeof v}`);
  }

  private static coerceLeaf(v: unknown, path: string): number | string {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`Invalid billing config: ${path} = "${v}" is not a valid number`);
      return n;
    }
    throw new Error(`Invalid billing config: ${path} has unexpected type ${typeof v}`);
  }

  /** 按完整名或前缀（取第一段 '.' 之前的部分）查找 cost map 条目 */
  private lookupCost(map: Record<string, number | Record<string, unknown>>, provider: string) {
    return map[provider] ?? map[provider.split('.')[0]] ?? null;
  }

  /** 图片：按 provider → model → size 查价，fallback 0.43 CNY/张 */
  resolveImageCostCny(provider: string, model?: string, size?: string): number {
    const p = this.lookupCost(this.imageCost, provider);
    if (p == null) return 0.43;
    if (typeof p === 'number') return p;
    // model 级查找
    const modelVal = model ? (p[model] as number | Record<string, unknown> | undefined) : null;
    if (typeof modelVal === 'number') return modelVal;
    // model 值是嵌套对象（含 per-size 定价）
    if (modelVal != null && typeof modelVal === 'object') {
      const sizeMap = modelVal as Record<string, unknown>;
      if (size) {
        // 精确匹配 → 大小写不敏感匹配
        const exact = sizeMap[size];
        if (typeof exact === 'number') return exact;
        const lower = size.toLowerCase();
        const found = Object.entries(sizeMap).find(([k]) => k.toLowerCase() === lower);
        if (found && typeof found[1] === 'number') return found[1];
      }
      return Number(sizeMap.default) || 0.43;
    }
    return Number((p as Record<string, unknown>).default) || 0.43;
  }

  /** 视频：按 provider → quality/model 查价，fallback 5.4 CNY/条 */
  resolveVideoCostCny(provider: string, qualityOrModel?: string): number {
    const p = this.lookupCost(this.videoCost, provider);
    if (p == null) return 5.4;
    if (typeof p === 'number') return p;
    const q = qualityOrModel ? (p[qualityOrModel] as number | undefined) : null;
    if (typeof q === 'number') return q;
    return Number((p as Record<string, unknown>).default) || 5.4;
  }

  /** TTS：按 provider → model/voice 查价，fallback 0.11 CNY/条 */
  resolveTtsCostCny(provider: string, modelOrVoice?: string): number {
    const p = this.lookupCost(this.ttsCost, provider);
    if (p == null) return 0.11;
    if (typeof p === 'number') return p;
    const m = modelOrVoice ? (p[modelOrVoice] as number | undefined) : null;
    if (typeof m === 'number') return m;
    return Number((p as Record<string, unknown>).default) || 0.11;
  }

  /** Embedding：按 tokens 计价（CNY/百万 tokens），当前单 provider */
  resolveEmbeddingCostCny(tokens: number, _provider?: string): number {
    return tokens > 0 ? (tokens / 1_000_000) * this.embeddingCostPer1M : 0;
  }

  get embeddingCostPer1MTokens(): number {
    return this.embeddingCostPer1M;
  }
}

