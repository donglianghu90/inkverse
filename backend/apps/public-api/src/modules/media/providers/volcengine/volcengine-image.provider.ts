/** 火山引擎 Seedream — 图片生成 Provider (T2I / I2I / 多图融合) */
import { Logger } from '@nestjs/common';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineImageConfig {
  models: string[];
  defaultSize: string;       // 宽高比如 '1:1'、'16:9'，或传统像素 '1024x1024'
  defaultResolution: string; // '2K' | '3K'，仅 Seedream 5.0+ 有效
  watermark: boolean;
}

interface ArkImageResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string; size?: string }>;
  usage?: { generated_images?: number; output_tokens?: number };
}

/** Seedream 5.0 要求至少 3,686,400 像素 */
const RATIO_TO_PIXEL_HD: Record<string, string> = {
  '1:1':  '1920x1920',
  '2:3':  '1600x2400',  '3:2':  '2400x1600',
  '9:16': '1440x2560',  '16:9': '2560x1440',
};

/** Seedream 4.x 使用标准分辨率 */
const RATIO_TO_PIXEL_SD: Record<string, string> = {
  '1:1':  '1024x1024',
  '2:3':  '1024x1536',  '3:2':  '1536x1024',
  '9:16': '1024x1792',  '16:9': '1792x1024',
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
          .slice(0, 10);
        if (urls.length) payload.image_urls = urls;
      }
      if (req.extra) Object.assign(payload, req.extra);

      this.logger.log(`生成图片: model=${model} size=${size} n=${payload.n} refImages=${payload.image_urls ? 'yes' : 'no'}`);
      try {
        const res = await this.callWithRefFallback(payload);
        const images = (res.data ?? []).map(d => ({ url: d.url ?? '', revisedPrompt: d.revised_prompt }));
        const durationMs = Date.now() - t0;
        this.logger.log(`图片生成完成: ${images.length}张 model=${model} (${durationMs}ms)`);
        return { images, provider: this.name, model, durationMs, raw: res };
      } catch (err) {
        lastErr = err;
        if (i < models.length - 1) {
          const msg = String((err as any)?.response?.data?.error?.message ?? (err as Error).message ?? '');
          this.logger.warn(`模型 ${model} 失败，降级至 ${models[i + 1]}: ${msg.slice(0, 150)}`);
        }
      }
    }
    throw lastErr;
  }

  private async callWithRefFallback(payload: Record<string, unknown>): Promise<ArkImageResponse> {
    try {
      return await this.client.post<ArkImageResponse>('/images/generations', payload);
    } catch (err: any) {
      const msg = String(err?.response?.data?.error?.message ?? err?.message ?? '');
      if (payload.image_urls && /image.*not valid|invalid.*image/i.test(msg)) {
        this.logger.warn(`参考图无效，降级为纯 T2I: ${msg.slice(0, 120)}`);
        const fallback = { ...payload }; delete fallback.image_urls;
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
}
