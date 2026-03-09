/**
 * 渲染配置服务 — 根据当前图片模型自动解析对应的渲染配置。
 * 扩展新模型只需在 PROFILE_REGISTRY 中追加匹配规则 + 对应 Profile 常量。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import { RenderingProfile } from './rendering-profile';

// ─── Seedream (火山引擎方舟) ────────────────────────────────────────────────────
//
// Seedream 参考图机制：image 参数最多 2 张，当作 I2I 参考，不区分角色/场景/风格，不支持权重。
// Negative prompt 支持但最佳实践比 SD 社区版精简（Seedream 内部已做质量过滤）。

const SEEDREAM_PROFILE: RenderingProfile = {
  modelFamily: 'seedream',
  displayName: 'Volcengine Seedream 5.0',
  refImage: {
    maxCount: 10,
    supportsWeight: false,
    priorityByScenario: {
      closeUp: ['character_face', 'prev_frame', 'scene', 'style'],
      wideShot: ['scene', 'character_face', 'prev_frame', 'style'],
      default: ['character_face', 'scene', 'prev_frame', 'style'],
    },
    faceConsistencyMethod: 'both',
  },
  negativePrompt: {
    supported: true,
    defaultValue: 'blurry, low quality, watermark, text, logo',
  },
  prompt: {
    maxLength: 2000,
    styleInjection: 'prefix',
    qualityPrefix: '',
    qualitySuffix: '',
  },
  characterViews: {
    viewsByRole: {
      protagonist: ['face_front', 'face_three_quarter', 'upper_body_front', 'full_body_front', 'side_profile'],
      antagonist: ['face_front', 'face_three_quarter', 'upper_body_front', 'full_body_front'],
      supporting: ['face_front', 'face_three_quarter', 'upper_body_front'],
      minor: ['face_front'],
    },
    chainReferenceWeight: 0.65,
  },
};

// ─── 兜底配置（未匹配到特定模型时使用，保守策略） ─────────────────────────────────

const GENERIC_PROFILE: RenderingProfile = {
  modelFamily: 'generic',
  displayName: 'Generic (Fallback)',
  refImage: {
    maxCount: 1,
    supportsWeight: false,
    priorityByScenario: {
      closeUp: ['character_face', 'scene', 'prev_frame', 'style'],
      wideShot: ['scene', 'character_face', 'prev_frame', 'style'],
      default: ['character_face', 'scene', 'prev_frame', 'style'],
    },
    faceConsistencyMethod: 'text_only',
  },
  negativePrompt: { supported: false, defaultValue: '' },
  prompt: { maxLength: 1000, styleInjection: 'prefix' },
  characterViews: {
    viewsByRole: {
      protagonist: ['face_front'],
      antagonist: ['face_front'],
      supporting: ['face_front'],
      minor: ['face_front'],
    },
    chainReferenceWeight: 0.5,
  },
};

// ─── 模型匹配注册表 ─────────────────────────────────────────────────────────────
//
// 扩展示例（取消注释并填写 Profile 即可）：
//   { match: (m, p) => /kling|keling/i.test(m) || p === 'kling', profile: KLING_PROFILE },
//   { match: (m) => /flux/i.test(m), profile: FLUX_PROFILE },
//   { match: (m) => /dall-?e/i.test(m), profile: DALLE_PROFILE },

const PROFILE_REGISTRY: Array<{
  match: (model: string, provider: string) => boolean;
  profile: RenderingProfile;
}> = [
  { match: (_m, p) => p === 'volcengine', profile: SEEDREAM_PROFILE },
];

@Injectable()
export class RenderingProfileService implements OnModuleInit {
  private readonly logger = new Logger('RenderingProfile');
  private imageProfile: RenderingProfile = GENERIC_PROFILE;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const defaultProvider = String(media.defaultImageProvider || 'volcengine');
    const providerCfg = (media[defaultProvider] ?? {}) as Record<string, unknown>;
    const imageCfg = (providerCfg.image ?? {}) as Record<string, unknown>;
    const model = String(imageCfg.model || '');

    const found = PROFILE_REGISTRY.find(r => r.match(model, defaultProvider));
    this.imageProfile = found?.profile ?? GENERIC_PROFILE;

    this.logger.log(
      `图片渲染配置: ${this.imageProfile.displayName} | ` +
      `refMax=${this.imageProfile.refImage.maxCount} ` +
      `negPrompt=${this.imageProfile.negativePrompt.supported} ` +
      `face=${this.imageProfile.refImage.faceConsistencyMethod} ` +
      `styleInject=${this.imageProfile.prompt.styleInjection}`,
    );
  }

  /** 获取当前图片模型的渲染配置 */
  getImageProfile(): RenderingProfile { return this.imageProfile; }
}
