/**
 * 图片 Provider 路由服务 — 为不同生产场景选择最优模型
 *
 * 模型矩阵：
 * ┌───────────────────────┬──────────────────────────────┬───────────────────────────────────────┐
 * │ 模型                   │ 优势                          │ 短剧中的最佳用途                         │
 * ├───────────────────────┼──────────────────────────────┼───────────────────────────────────────┤
 * │ nano-banana-2         │ 14张参考图/最强角色一致性/20000字 │ 角色定妆照、分镜关键帧                    │
 * │ seedream-5-lite       │ 中文美学/古装/速度快/价格低      │ 场景概念图、道具特写图                    │
 * │ flux-2-i2i            │ FLUX.2 I2I/最强形变控制         │ 角度变换、服装变体、图片精修              │
 * │ volcengine            │ 中文美学/古装/负提示词           │ 跨 Provider 降级备用                    │
 * └───────────────────────┴──────────────────────────────┴───────────────────────────────────────┘
 *
 * 路由策略（全部可通过 drama.image.router.* 配置覆盖）：
 *   characterFace       → kieai.nano-banana-2     (角色一致性不可妥协，14张参考图锁脸)
 *   characterViewAngle  → kieai.flux-2-i2i        (角度变换 I2I，FLUX.2 形变最稳)
 *   characterVariation  → kieai.flux-2-i2i        (服装变体 I2I)
 *   location            → kieai.seedream-5-lite   (场景图，中文/古装美学天然理解，速度快)
 *   prop                → kieai.seedream-5-lite   (道具特写，轻量任务，产品图风格)
 *   styleGuide          → kieai.nano-banana-2     (风格参考图，长 prompt 描述复杂风格)
 *   shotCloseUp         → kieai.nano-banana-2     (特写/近景，14 张参考图最强一致性)
 *   shotMedium          → kieai.nano-banana-2     (中景，角色+场景均衡)
 *   shotWide            → kieai.nano-banana-2     (全景/远景，长 prompt 保留完整场景描述)
 *   shotGolden          → kieai.nano-banana-2     (golden/preview 关键帧，最高质量)
 *   refinement          → kieai.flux-2-i2i        (精修 I2I)
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';

export interface ProviderRoute {
  /** provider name，undefined = 使用系统默认 */
  provider?: string;
  /**
   * provider-specific 附加参数，将合并到 ImageGenerationRequest.extra。
   * 对 kieai.* 模型：包含 aspect_ratio / resolution / output_format
   */
  extra?: Record<string, unknown>;
  /**
   * 跨 Provider 降级：当主 provider 全链路失败时（如内容审核触发、服务不可用），
   * 自动切换到此备用 provider 重试。
   * 注意：这与 volcengine 内部的 seedream-5→4-5→4 模型降级不同，
   * 是更高层次的 Provider 级别 fallback。
   */
  fallbackProvider?: string;
  fallbackExtra?: Record<string, unknown>;
}

/** 可配置路由键列表 */
const ROUTE_KEYS = [
  'characterFace',
  'characterViewAngle',
  'characterVariation',
  'location',
  'prop',
  'styleGuide',
  'shotCloseUp',
  'shotMedium',
  'shotWide',
  'shotGolden',
  'refinement',
] as const;
type RouteKey = typeof ROUTE_KEYS[number];

/**
 * 默认路由策略：
 *   - 角色定妆/分镜 → nano-banana-2（参考图锁脸，长 prompt 不截断）
 *   - 场景/道具     → seedream-5-lite（中文美学，速度快，成本低）
 *   - 图生图/精修   → flux-2-i2i（形变控制最稳）
 */
const DEFAULT_ROUTES: Record<RouteKey, string> = {
  characterFace:      'kieai.nano-banana-2',
  characterViewAngle: 'kieai.flux-2-i2i',
  characterVariation: 'kieai.flux-2-i2i',
  location:           'kieai.seedream-5-lite',
  prop:               'kieai.seedream-5-lite',
  styleGuide:         'kieai.nano-banana-2',
  shotCloseUp:        'kieai.nano-banana-2',
  shotMedium:         'kieai.nano-banana-2',
  shotWide:           'kieai.nano-banana-2',
  shotGolden:         'kieai.nano-banana-2',
  refinement:         'kieai.flux-2-i2i',
};

/**
 * 默认跨 Provider 降级策略。
 * 主力 kieai.nano-banana-2 服务不可用时，降级到 volcengine（支持负提示词/中文美学）。
 * I2I 路由（flux-2-i2i）无需 fallback — kieai 全局不可用时由上层重试机制处理。
 */
const DEFAULT_FALLBACK_ROUTES: Partial<Record<RouteKey, string>> = {
  characterFace: 'volcengine.doubao-seedream',
  location:      'volcengine.doubao-seedream',
  prop:          'volcengine.doubao-seedream',
  styleGuide:    'volcengine.doubao-seedream',
  shotCloseUp:   'volcengine.doubao-seedream',
  shotMedium:    'volcengine.doubao-seedream',
  shotWide:      'volcengine.doubao-seedream',
  shotGolden:    'volcengine.doubao-seedream',
};

/** kieai 模型的默认出图分辨率 */
const KIEAI_DEFAULT_RESOLUTION = '1K';
const KIEAI_DEFAULT_OUTPUT_FORMAT = 'jpg';

/**
 * 将 Seedream 规格字符串（"9:16", "2:3"）映射到 kie.ai aspect_ratio 参数。
 * kie.ai 支持的宽高比集合：1:1 2:3 3:2 4:3 3:4 4:5 5:4 9:16 16:9 21:9 1:4 1:8 4:1 8:1 auto
 */
function sizeToKieAiAspectRatio(size?: string): string {
  if (!size) return '1:1';
  // size 已经是宽高比格式（如 '9:16'）则直接复用
  if (/^\d+:\d+$/.test(size)) return size;
  // 像素格式 "1024x1024" → 换算
  const m = size.match(/^(\d+)[xX×](\d+)$/);
  if (m) {
    const w = parseInt(m[1]), h = parseInt(m[2]);
    const ratio = w / h;
    if (ratio > 1.7) return '16:9';
    if (ratio > 1.4) return '3:2';
    if (ratio > 1.1) return '4:3';
    if (ratio > 0.9) return '1:1';
    if (ratio > 0.7) return '3:4';
    if (ratio > 0.6) return '2:3';
    return '9:16';
  }
  return '1:1';
}

@Injectable()
export class ImageProviderRouterService {
  private readonly logger = new Logger('ImageProviderRouter');
  private readonly routes: Record<RouteKey, string>;
  private readonly fallbackRoutes: Partial<Record<RouteKey, string>>;

  constructor(private readonly configService: ConfigService) {
    const cfg = (this.configService.get('drama.image.router') ?? {}) as Record<string, string>;
    this.routes = { ...DEFAULT_ROUTES };
    this.fallbackRoutes = { ...DEFAULT_FALLBACK_ROUTES };
    for (const key of ROUTE_KEYS) {
      if (cfg[key]) this.routes[key] = cfg[key];
      // 支持通过 drama.image.router.{key}Fallback 覆盖默认跨 Provider 降级策略
      const fbKey = `${key}Fallback` as string;
      if (cfg[fbKey]) this.fallbackRoutes[key] = cfg[fbKey];
    }
    this.logger.log(
      `路由策略: ${ROUTE_KEYS.map(k => {
        const fb = this.fallbackRoutes[k];
        return `${k}=${this.routes[k]}${fb ? `(fb:${fb})` : ''}`;
      }).join(' | ')}`,
    );
  }

  // ─── 资产级路由 ──────────────────────────────────────────────────────────

  /** 人脸初始图（Phase 1 face_front）*/
  routeCharacterFace(size?: string): ProviderRoute {
    return this.buildRoute('characterFace', size);
  }

  /** 角度变换（Phase 2 view angles，I2I）*/
  routeCharacterViewAngle(size?: string): ProviderRoute {
    return this.buildRoute('characterViewAngle', size);
  }

  /** 服装/外观变体（Phase 3 variations，I2I）*/
  routeCharacterVariation(size?: string): ProviderRoute {
    return this.buildRoute('characterVariation', size);
  }

  /** 场景/背景参考图（seedream-5-lite: 中文美学，速度快）*/
  routeLocation(size?: string): ProviderRoute {
    return this.buildRoute('location', size);
  }

  /** 道具特写图（seedream-5-lite: 轻量任务，产品图风格）*/
  routeProp(size?: string): ProviderRoute {
    return this.buildRoute('prop', size);
  }

  /** 风格参考图（mood board / style guide）*/
  routeStyleGuide(size?: string): ProviderRoute {
    return this.buildRoute('styleGuide', size);
  }

  /** 图片精修（refineAssetImage）*/
  routeRefinement(size?: string): ProviderRoute {
    return this.buildRoute('refinement', size);
  }

  // ─── Shot 级路由 ─────────────────────────────────────────────────────────

  /**
   * 根据镜头属性选择最优 provider：
   * - golden / preview → shotGolden（最高质量）
   * - extreme_close_up / close_up → shotCloseUp（角色一致性最关键）
   * - medium_close_up / medium → shotMedium
   * - wide / extreme_wide 及其他 → shotWide
   */
  routeShot(opts: {
    qualityTier?: string;
    /** 景别（shotSize），决定路由策略（特写/中景/全景） */
    shotSize?: string;
    /** 摄影角度（cameraAngle），当前路由策略暂不区分角度，预留扩展 */
    cameraAngle?: string;
    isGolden?: boolean;
    size?: string;
  }): ProviderRoute {
    const { qualityTier, shotSize, isGolden, size } = opts;

    if (isGolden || qualityTier === 'golden' || qualityTier === 'preview') {
      return this.buildRoute('shotGolden', size);
    }

    const sz = shotSize ?? '';
    if (['extreme_close_up', 'close_up'].includes(sz)) {
      return this.buildRoute('shotCloseUp', size);
    }
    if (['medium_close_up', 'medium'].includes(sz)) {
      return this.buildRoute('shotMedium', size);
    }
    // wide / extreme_wide / 其他
    return this.buildRoute('shotWide', size);
  }

  // ─── 内部工具 ─────────────────────────────────────────────────────────────

  private buildRoute(key: RouteKey, size?: string): ProviderRoute {
    const provider = this.routes[key];
    if (!provider) return {};

    const extra = this.isKieAi(provider)
      ? this.buildKieAiExtra(size)
      : undefined;

    const fallbackProvider = this.fallbackRoutes[key];
    const fallbackExtra = fallbackProvider && this.isKieAi(fallbackProvider)
      ? this.buildKieAiExtra(size)
      : undefined;

    return { provider, extra, fallbackProvider, fallbackExtra };
  }

  private isKieAi(provider: string): boolean {
    return provider.startsWith('kieai.');
  }

  private buildKieAiExtra(size?: string): Record<string, unknown> {
    return {
      aspect_ratio: sizeToKieAiAspectRatio(size),
      resolution: KIEAI_DEFAULT_RESOLUTION,
      output_format: KIEAI_DEFAULT_OUTPUT_FORMAT,
    };
  }
}
