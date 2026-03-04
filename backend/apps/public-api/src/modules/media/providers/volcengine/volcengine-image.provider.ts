/** 火山引擎 Seedream — 图片生成 Provider (T2I / I2I / 多图融合) */
import { Logger } from '@nestjs/common';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineImageConfig {
  model: string; // 预置接入点模型名，如 doubao-seedream-5-0-lite-t2i-250901
  defaultSize: string;
  watermark: boolean;
}

interface ArkImageResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

export class VolcengineImageProvider implements ImageProvider {
  readonly name = 'volcengine';
  readonly capabilities: ReadonlySet<ImageCapability> = new Set(['t2i', 'i2i', 'multi-ref']);
  private readonly logger = new Logger('VolcengineImage');

  constructor(private readonly client: VolcengineClient, private readonly config: VolcengineImageConfig) {}

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const t0 = Date.now();
    const payload: Record<string, unknown> = {
      model: this.config.model,
      prompt: req.prompt,
      size: req.size || this.config.defaultSize,
      num_images: req.count ?? 1,
      watermark: this.config.watermark,
      response_format: 'url',
    };
    if (req.negativePrompt) payload.negative_prompt = req.negativePrompt;
    if (req.seed !== undefined) payload.seed = req.seed;
    // 火山引擎 image: 单张用字符串，多张用数组；仅 http(s) URL 或 base64，最多2张
    if (req.referenceImages?.length) {
      const valid = req.referenceImages
        .map(img => (img.url && /^https?:\/\//.test(img.url) ? img.url : img.base64 ? (img.base64.startsWith('data:') ? img.base64 : `data:image/png;base64,${img.base64}`) : ''))
        .filter(Boolean)
        .slice(0, 2);
      if (valid.length) payload.image = valid.length === 1 ? valid[0] : valid;
    }
    if (req.extra) Object.assign(payload, req.extra);

    this.logger.log(`生成图片: model=${this.config.model} size=${payload.size} count=${payload.num_images}`);
    let res: ArkImageResponse;
    try {
      res = await this.client.post<ArkImageResponse>('/images/generations', payload);
    } catch (err: any) {
      const msg = String(err?.response?.data?.error?.message ?? err?.message ?? '');
      if (payload.image && /image.*not valid|invalid.*image/i.test(msg)) {
        this.logger.warn(`参考图无效，降级为纯 T2I: ${msg.slice(0, 80)}`);
        const fallback = { ...payload }; delete fallback.image;
        res = await this.client.post<ArkImageResponse>('/images/generations', fallback);
      } else throw err;
    }
    const images = (res.data ?? []).map(d => ({ url: d.url ?? '', revisedPrompt: d.revised_prompt }));
    const durationMs = Date.now() - t0;
    this.logger.log(`图片生成完成: ${images.length}张 (${durationMs}ms)`);
    return { images, provider: this.name, model: this.config.model, durationMs, raw: res };
  }
}
