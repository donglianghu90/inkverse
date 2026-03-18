/** 火山引擎 Seedream — 图片生成 Provider (T2I / I2I / 多图融合) */
import { Logger } from '@nestjs/common';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';
import { volcengineImageRateLimitAcquire } from './volcengine-rate-limiter';

export interface VolcengineImageConfig {
  models: string[];
  defaultSize: string;       // 宽高比如 '1:1'、'16:9'，或传统像素 '1024x1024'
  defaultResolution: string; // '1K' | '2K'，仅 Seedream 5.0+ 有效，代码强制上限 2K
  watermark: boolean;
}

interface ArkImageResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string; size?: string }>;
  usage?: { generated_images?: number; output_tokens?: number };
}

/** Seedream 5.0 lite 官方推荐像素值（2K 档，来源：方舟平台文档） */
const RATIO_TO_PIXEL_HD: Record<string, string> = {
  '1:1':  '2048x2048',
  '2:3':  '1664x2496',  '3:2':  '2496x1664',
  '9:16': '1600x2848',  '16:9': '2848x1600',
  '4:3':  '2304x1728',  '3:4':  '1728x2304',
  '21:9': '3136x1344',
};

/** Seedream 4.x 官方推荐像素值（2K 档，来源：方舟平台文档） */
const RATIO_TO_PIXEL_SD: Record<string, string> = {
  '1:1':  '2048x2048',
  '2:3':  '1664x2496',  '3:2':  '2496x1664',
  '9:16': '1600x2848',  '16:9': '2848x1600',
  '4:3':  '2304x1728',  '3:4':  '1728x2304',
  '21:9': '3136x1344',
};

export class VolcengineImageProvider implements ImageProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ImageCapability> = new Set(['t2i', 'i2i', 'multi-ref']);
  private readonly logger = new Logger('VolcengineImage');

  constructor(private readonly client: VolcengineClient, private readonly config: VolcengineImageConfig) {
    const primary = config.models[0] ?? 'doubao-seedream';
    const modelFamily = primary.replace(/-\d+[\d.-]*$/, '');
    this.name = `volcengine.${modelFamily}`;
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const t0 = Date.now();
    const models = this.config.models;
    let lastErr: unknown;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const isSd5 = /seedream.5/i.test(model);
      const rawSize = req.size || this.config.defaultSize;
      const size = this.normalizeSizeForModel(rawSize, isSd5);

      const payload: Record<string, unknown> = {
        model, prompt: req.prompt, size, n: req.count ?? 1,
        watermark: this.config.watermark, response_format: 'url',
      };
      if (req.negativePrompt) payload.negative_prompt = req.negativePrompt;
      if (req.seed !== undefined) payload.seed = req.seed;

      if (req.referenceImages?.length) {
        const urls = req.referenceImages
          .map(img => (img.url && /^https?:\/\//.test(img.url) ? img.url : ''))
          .filter(Boolean)
          .slice(0, 14);
        if (urls.length) payload.image = urls.length === 1 ? urls[0] : urls;
      }
      if (req.extra) Object.assign(payload, req.extra);

      // Seedream 5.0+ 支持 resolution 参数（不传则 API 默认 8K），始终在 extra 合并后强制 clamp 到 2K 以内
      if (isSd5) {
        const raw = payload.resolution as string | undefined ?? this.config.defaultResolution;
        payload.resolution = this.clampResolution(raw);
      }

      this.logger.log(
        `生成图片: model=${model} size=${size}` +
        (payload.resolution ? ` resolution=${payload.resolution}` : '') +
        ` n=${payload.n} refImages=${payload.image ? (Array.isArray(payload.image) ? (payload.image as string[]).length : 1) : 0}张`,
      );
      try {
        // 限速：20 req / 10s（火山引擎方舟图片 API 官方限制）
        await volcengineImageRateLimitAcquire();
        const res = await this.callWithRefFallback(payload);
        const images = (res.data ?? []).map(d => ({ url: d.url ?? '', revisedPrompt: d.revised_prompt }));
        const durationMs = Date.now() - t0;
        this.logger.log(`图片生成完成: ${images.length}张 model=${model} (${durationMs}ms)`);
        return { images, provider: this.name, model, durationMs, raw: res };
      } catch (err) {
        lastErr = err;
        const msg = String((err as any)?.response?.data?.error?.message ?? (err as Error).message ?? '');
        if (i < models.length - 1) {
          // 内容审核拒绝：doubao 全系列共享同一套审核规则，继续降级无意义。
          // 立即抛出，让上层 MediaService 的跨 Provider fallback（kieai）接管。
          if (this.isModerationError(msg)) {
            this.logger.warn(
              `内容审核触发，跳过剩余模型 [${models.slice(i + 1).join(',')}]，交由跨 Provider fallback 处理: ${msg.slice(0, 120)}`,
            );
            break;
          }
          this.logger.warn(`模型 ${model} 失败，降级至 ${models[i + 1]}: ${msg.slice(0, 150)}`);
        }
      }
    }
    throw lastErr;
  }

  /**
   * 判断是否为内容审核拒绝错误。
   * doubao 全系列（seedream-5/4-5/4）共享同一套审核规则，
   * 任何一个模型被审核拒绝，其余版本也会以同样原因拒绝，继续降级无意义。
   */
  private isModerationError(msg: string): boolean {
    return /violate platform rules|content moderation|sensitive content|unsafe content|text.*may violate/i.test(msg);
  }

  private async callWithRefFallback(payload: Record<string, unknown>): Promise<ArkImageResponse> {
    try {
      return await this.client.post<ArkImageResponse>('/images/generations', payload);
    } catch (err: any) {
      const msg = String(err?.response?.data?.error?.message ?? err?.message ?? '');
      if (payload.image && /image.*not valid|invalid.*image/i.test(msg)) {
        this.logger.warn(`参考图无效，降级为纯 T2I: ${msg.slice(0, 120)}`);
        // fallback 重试也是一次新请求，同样占用配额
        await volcengineImageRateLimitAcquire();
        const fallback = { ...payload }; delete fallback.image;
        return await this.client.post<ArkImageResponse>('/images/generations', fallback);
      }
      throw err;
    }
  }

  private normalizeSizeForModel(size: string, isSeedream5: boolean): string {
    if (/^\d+x\d+$/i.test(size) || /^\d+[Kk]$/.test(size)) return size;
    const map = isSeedream5 ? RATIO_TO_PIXEL_HD : RATIO_TO_PIXEL_SD;
    return map[size] ?? map[this.config.defaultSize] ?? '1024x1024';
  }

  /**
   * 将 resolution 字符串限制在 2K 以内。
   * Seedream 5.0 支持：1K / 2K / 4K / 8K。
   * 短剧最终输出为手机 9:16 视频（720p/1080p），I2V 参考帧无需超过 2K。
   */
  private clampResolution(resolution: string): string {
    const ORDER = ['1K', '2K', '4K', '8K'];
    const MAX = '2K';
    const normalized = resolution.toUpperCase().replace(/^(\d+)[Kk]$/, '$1K');
    const idx = ORDER.indexOf(normalized);
    if (idx < 0) return MAX;
    return ORDER[Math.min(idx, ORDER.indexOf(MAX))];
  }
}
