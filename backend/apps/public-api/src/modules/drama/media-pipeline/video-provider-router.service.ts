/**
 * 视频 Provider 路由服务 — 混合路由策略，默认 Kling + 时长匹配 Hailuo。
 *
 * ╔══════════════════════════════════════════════════════════════════════════════════╗
 * ║                          视频模型能力矩阵（选型依据）                              ║
 * ╠══════════════════════════╦═══════════════════════╦══════════════════════════════╣
 * ║ Provider                 ║ 核心能力               ║ 最适合的短剧类型                ║
 * ╠══════════════════════════╬═══════════════════════╬══════════════════════════════╣
 * ║ kling (Kling 3.0)       ║ 运动表现/多镜头叙事     ║ 动作/武侠/科幻/通用           ║
 * ║ hailuo (Hailuo 2.3)     ║ 面部情感/表情细腻       ║ 甜宠/都市/情感/传记           ║
 * ║ veo (Veo 3.1)           ║ 电影级光影/景深/原生音频 ║ 悬疑/古装/宏大叙事            ║
 * ║ volcengine (Seedance)    ║ 中文审美/2D动漫        ║ 2D动漫风格                   ║
 * ║ sora (Sora 2 I2V)       ║ 叙事/运动连贯           ║ 真人实拍·古风实拍·auto 兜底  ║
 * ╚══════════════════════════╩═══════════════════════╩══════════════════════════════╝
 *
 * 路由策略（混合模式）：
 *   · 默认所有镜头使用 Kling（3-15s 灵活时长）
 *   · 当分镜时长恰好为 6s 或 10s 时，自动路由到 Hailuo 2.3 Standard
 *     — Hailuo 支持离散时长 6s / 10s，面部情感细腻度优于 Kling
 *     — Hailuo 统一输出 1080P，不受用户分辨率设置影响
 *   · 其他 Provider（Veo/Sora/Seedance）保留映射表但当前不自动启用
 *
 * 时长约束（Provider 层处理）：
 *   · Kling: 3-15s    · Hailuo: 6 or 10s (离散)
 *   · Veo: 4-8s       · Seedance: 5-10s  · Sora: 10-15s
 *   · 提交时 clamp 到 Provider 范围，合成时 trimOutSec 裁剪到分镜意图时长
 *
 * 分镜生成感知：
 *   选定的模型信息（时长范围、prompt 风格）会注入分镜 system prompt，
 *   让 LLM 在生成分镜时就按照模型的最佳实践设计每个 Shot。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';

export interface VideoProviderRoute {
  /** provider name，undefined = 使用系统默认 */
  provider?: string;
  /** provider-specific 附加参数，透传到 VideoGenerationRequest.extra */
  extra?: Record<string, unknown>;
  /** 跨 Provider 降级：主 provider 失败时自动切换 */
  fallbackProvider?: string;
}

/** 视频模型的能力描述，用于注入分镜 system prompt */
export interface VideoModelProfile {
  provider: string;
  /** 模型显示名（用于 prompt 中描述） */
  displayName: string;
  /** 推荐的单 Shot 时长范围 */
  minDurationSec: number;
  maxDurationSec: number;
  /** 推荐的最佳时长（分镜生成时作为默认目标） */
  sweetSpotSec: number;
  /** Prompt 风格提示（注入分镜 system prompt） */
  promptStyleHint: string;
  /** 模型擅长的能力描述 */
  strengthHint: string;
  /** 模型的限制/注意事项 */
  constraintHint: string;
}

// ─── 模型能力档案 ──────────────────────────────────────────────────────────────

const MODEL_PROFILES: Record<string, VideoModelProfile> = {
  kling: {
    provider: 'kling',
    displayName: 'Kling 3.0',
    minDurationSec: 3,
    maxDurationSec: 15,
    sweetSpotSec: 5,
    promptStyleHint: '自然语言描述，侧重"动作+运动"描述，避免静态风格前缀。',
    strengthHint: '时长灵活(3-15s)，1080P，支持首尾帧控制和 kling_elements 角色一致性锁定。',
    constraintHint: '普通Shot建议3-8秒；高潮动作镜头可到10-12秒。',
  },
  hailuo: {
    provider: 'hailuo',
    displayName: 'Hailuo 2.3',
    minDurationSec: 6,
    maxDurationSec: 10,
    sweetSpotSec: 6,
    promptStyleHint: '自然语言描述，重点描述人物表情、情绪和微妙的面部变化。',
    strengthHint: '面部情感细腻，表情自然，稳定处理复杂动作和光照变化，电影级视觉效果。',
    constraintHint: '每个Shot最短6秒，最长10秒。近景/特写效果最好，适合情感表达。',
  },
  veo: {
    provider: 'veo',
    displayName: 'Veo 3.1',
    minDurationSec: 4,
    maxDurationSec: 8,
    sweetSpotSec: 6,
    promptStyleHint: '自然语言描述，注重光影、氛围和环境描写。支持多图参考控制。',
    strengthHint: '电影级光影和景深，逼真的动作生成，同步原生音频输出，1080P画质。',
    constraintHint: '每个Shot时长4-8秒。适合宏大场景、环境氛围和电影感叙事。',
  },
  volcengine: {
    provider: 'volcengine',
    displayName: 'Seedance 1.5',
    minDurationSec: 5,
    maxDurationSec: 10,
    sweetSpotSec: 5,
    promptStyleHint: '关键词驱动，运镜/景别/情绪色调用专有 token 提升效果。',
    strengthHint: '中文审美好，I2V 稳定，适合2D动漫和古代宫廷场景。',
    constraintHint: '每个Shot建议5-8秒，超过8秒质量可能下降。',
  },
  sora: {
    provider: 'sora',
    displayName: 'Sora 2 (image-to-video)',
    minDurationSec: 10,
    maxDurationSec: 15,
    sweetSpotSec: 10,
    promptStyleHint: '自然语言描述，注重场景连贯性和叙事节奏。支持风格和比例控制。',
    strengthHint: '图生视频（需首帧），叙事与物理一致性较好，适合中长镜头。',
    constraintHint: '必须提供首帧图。' +
      '时长只有 10s 或 15s 两档（离散，非连续）：estimatedDurationSec 必须写 10 或 15，' +
      '写其他值（如 5、7、12）会导致 Sora 按较大档生成后再截断，浪费生成成本且运动被截断。' +
      '判断原则：标准镜头写 10，需要延展连续运动的长镜头写 15。',
  },
};

/** Hailuo 2.3 Standard 支持的离散时长（秒），命中即路由到 Hailuo */
const HAILUO_ELIGIBLE_DURATIONS = new Set([6, 10]);

// ─── 题材 → 最佳主模型 映射 ──────────────────────────────────────────────────

const GENRE_PRIMARY_MODEL: Record<string, string> = {
  warrior: 'kling',     // 武侠/仙侠：大量动作场景，Kling 运动表现最佳
  ancient: 'kling',     // 古装：宫廷场景 + 少量动作，Kling 通用性好
  palace:  'hailuo',    // 宫斗：大量情感博弈和面部特写，Hailuo 表情细腻
  sweet:   'hailuo',    // 甜宠：情感互动为主，Hailuo 表情自然
  urban:   'hailuo',    // 都市：人物对话和情感为主，Hailuo 面部表现好
  boss:    'kling',     // 霸总：混合动作+情感，Kling 通用
  revenge: 'kling',     // 复仇：紧张对峙+动作，Kling 动态好
  rebirth: 'kling',     // 重生：混合题材，Kling 灵活
  scifi:   'kling',     // 科幻：高动态场景，Kling 更强
  suspense:'veo',       // 悬疑：光影氛围非常重要，Veo 电影级光影
  history: 'veo',       // 历史：宏大场景+电影感，Veo 景深好
  biography:'hailuo',   // 传记：人物表情和情感为核心
  mythology:'kling',    // 神话：特效+动作，Kling 运动表现
  timetravel:'kling',   // 穿越：混合题材，Kling 灵活
};

// ─── 视觉风格 → 最佳主模型 映射 ──────────────────────────────────────────────

const STYLE_PRIMARY_MODEL: Record<string, string> = {
  '2d_anime':     'volcengine',   // 2D 动漫：Seedance
  'anime_hybrid': 'volcengine',   // 动漫混合：Seedance
  'live_action':  'kling',        // 真人实拍：Kling（3-15s 灵活时长，连续组用 Sora 合并）
  'period_live':  'kling',        // 古装/年代实拍：Kling（同上）
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class VideoProviderRouterService {
  private readonly logger = new Logger('VideoProviderRouter');
  private readonly defaultProvider: string;
  private readonly fallbackProvider: string;

  constructor(private readonly configService: ConfigService) {
    const cfg = (this.configService.get('drama.video.router') ?? {}) as Record<string, string>;
    this.defaultProvider = cfg['default'] ?? 'kling';
    this.fallbackProvider = cfg['fallback'] ?? 'volcengine';
    this.logger.log(`视频路由策略: default=${this.defaultProvider} fallback=${this.fallbackProvider}`);
  }

  /**
   * 为整部短剧选定主视频模型。
   * 在创建短剧时调用一次，结果存入 DramaState.videoProvider。
   */
  resolvePrimaryProvider(opts: {
    genre?: string;
    styleBucket?: string;
    userChoice?: string;
  }): string {
    const { userChoice } = opts;

    if (userChoice && userChoice !== 'auto') {
      this.logger.debug(`用户指定 Provider→${userChoice}`);
      return userChoice;
    }

    this.logger.debug(`强制使用 Provider→kling`);
    return 'kling';
  }

  /**
   * 获取指定 Provider 的模型能力档案。
   * 用于注入分镜 system prompt，让 LLM 按模型能力设计镜头。
   */
  getModelProfile(provider: string): VideoModelProfile {
    return MODEL_PROFILES[provider] ?? MODEL_PROFILES['sora'];
  }

  /**
   * 为单个镜头返回路由结果。
   * 混合路由：默认 Kling，当分镜时长命中 Hailuo 离散时长（6s/10s）时自动切换到 Hailuo。
   *
   * Hailuo 2.3 Standard 固定输出 1080P（不受用户分辨率设置影响），
   * 调用方需根据 isHailuo 标识跳过用户分辨率覆盖。
   */
  route(opts: {
    /** 已确定的主 Provider（来自 DramaState.videoProvider） */
    overrideProvider?: string;
    /** 分镜设计的时长（秒），用于判断是否命中 Hailuo 离散时长 */
    estimatedDurationSec?: number;
  }): VideoProviderRoute & { isHailuo: boolean; hailuoResolution?: '720p' | '1080p' } {
    // 先确定基础 Provider（将历史存量统一到 kling）
    let baseProvider = opts.overrideProvider || 'kling';
    if (['auto', 'hailuo', 'veo', 'volcengine'].includes(baseProvider)) {
      baseProvider = 'kling';
    }

    // 时长匹配 Hailuo：当分镜设计时长四舍五入后恰好为 6s 或 10s 时，切换到 Hailuo
    const roundedDuration = Math.round(opts.estimatedDurationSec ?? 0);
    if (HAILUO_ELIGIBLE_DURATIONS.has(roundedDuration)) {
      // Hailuo API 限制：1080P 仅支持 6s，10s 必须用 768P（传 '720p' 让 Provider 降级到默认 768P）
      const hailuoResolution: '720p' | '1080p' = roundedDuration === 6 ? '1080p' : '720p';
      this.logger.debug(
        `Shot 时长 ${opts.estimatedDurationSec}s (≈${roundedDuration}s) 命中 Hailuo 离散时长，` +
        `路由到 hailuo (resolution=${hailuoResolution})`,
      );
      return {
        provider: 'hailuo',
        fallbackProvider: baseProvider, // Hailuo 失败时降级回 Kling
        isHailuo: true,
        hailuoResolution,
      };
    }

    return {
      provider: baseProvider,
      fallbackProvider: this.fallbackProvider,
      isHailuo: false,
      hailuoResolution: undefined,
    };
  }

  /**
   * 判断指定时长是否会被路由到 Hailuo。
   * 供外部（如 GenerationPolicy）判断是否需要强制 1080P。
   */
  isHailuoEligible(estimatedDurationSec: number): boolean {
    return HAILUO_ELIGIBLE_DURATIONS.has(Math.round(estimatedDurationSec));
  }
}
