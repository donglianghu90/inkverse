/** 火山引擎 Seedream — 图片生成 Provider (T2I / I2I / 多图融合) */
import { Logger } from '@nestjs/common';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineImageConfig {
  model: string;
  defaultSize: string;       // 宽高比如 '1:1'、'16:9'，或传统像素 '1024x1024'
  defaultResolution: string; // '2K' | '3K'，仅 Seedream 5.0+ 有效
  watermark: boolean;
}

interface ArkImageResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string; size?: string }>;
  usage?: { generated_images?: number; output_tokens?: number };
}

const PIXEL_TO_RATIO: Record<string, string> = {
  '1024x1024': '1:1',   '2048x2048': '1:1',
  '1024x1536': '2:3',   '1536x1024': '3:2',
  '1024x1792': '9:16',  '1792x1024': '16:9',
  '1536x1024': '3:2',   '1024x1536': '2:3',
  '1280x720':  '16:9',  '720x1280':  '9:16',
  '1920x1080': '16:9',  '1080x1920': '9:16',
};

export class VolcengineImageProvider implements ImageProvider {
  readonly name = 'volcengine';
  readonly capabilities: ReadonlySet<ImageCapability> = new Set(['t2i', 'i2i', 'multi-ref']);
  private readonly logger = new Logger('VolcengineImage');
  private readonly isSeedream5: boolean;

  constructor(private readonly client: VolcengineClient, private readonly config: VolcengineImageConfig) {
    this.isSeedream5 = /seedream.5/i.test(config.model);
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const t0 = Date.now();
    const rawSize = req.size || this.config.defaultSize;
    const size = this.isSeedream5 ? this.normalizeSize(rawSize) : rawSize;

    const payload: Record<string, unknown> = {
      model: this.config.model,
      prompt: req.prompt,
      size,
      n: req.count ?? 1,
      watermark: this.config.watermark,
      response_format: 'url',
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

    this.logger.log(`生成图片: model=${this.config.model} size=${size} n=${payload.n} refImages=${payload.image_urls ? 'yes' : 'no'}`);
    let res: ArkImageResponse;
    try {
      res = await this.client.post<ArkImageResponse>('/images/generations', payload);
    } catch (err: any) {
      const msg = String(err?.response?.data?.error?.message ?? err?.message ?? '');
      if (payload.image_urls && /image.*not valid|invalid.*image/i.test(msg)) {
        this.logger.warn(`参考图无效，降级为纯 T2I: ${msg.slice(0, 120)}`);
        const fallback = { ...payload }; delete fallback.image_urls;
        res = await this.client.post<ArkImageResponse>('/images/generations', fallback);
      } else throw err;
    }
    const images = (res.data ?? []).map(d => ({ url: d.url ?? '', revisedPrompt: d.revised_prompt }));
    const durationMs = Date.now() - t0;
    this.logger.log(`图片生成完成: ${images.length}张 (${durationMs}ms)`);
    return { images, provider: this.name, model: this.config.model, durationMs, raw: res };
  }

  /** 将传统像素尺寸映射为 Seedream 5.0 的宽高比格式 */
  private normalizeSize(size: string): string {
    if (/^\d+:\d+$/.test(size) || /^\d+[Kk]$/.test(size)) return size;
    return PIXEL_TO_RATIO[size] ?? this.config.defaultSize;
  }
}
