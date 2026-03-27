/** Prompt 优化器 — 针对 T2I/T2V 模型特性优化提示词，提升生成质量 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import type { OptimizeResult, T2IOptimizeOptions, T2VOptimizeOptions } from './interfaces/prompt-optimizer.interface';

export type { OptimizeResult, T2IOptimizeOptions, T2VOptimizeOptions } from './interfaces/prompt-optimizer.interface';

/**
 * 模型族 → 质量 booster 映射。
 * 查找规则：先精确匹配 provider，再逐级截取前缀，最后 fallback 到 default。
 * 示例：'kieai.nano-banana-2' → 'kieai.nano-banana' → 'kieai' → 'default'
 */
const QUALITY_BOOSTERS: Record<string, string[]> = {
  volcengine:          ['cinematic lighting', 'rich color depth'],
  // nano-banana 系列：摄影写实风，emphasis on identity & sharpness
  'kieai.nano-banana': ['highly detailed', 'professional photography', 'sharp focus', 'photorealistic'],
  // flux-2 T2I：FLUX.2 擅长构图与概念艺术
  'kieai.flux-2':      ['professional illustration', 'high quality', 'detailed composition', 'FLUX aesthetic'],
  // flux-2 I2I：最重要的是保留原图身份同时做精准变换
  'kieai.flux-2-i2i':  ['consistent identity', 'high quality transformation', 'maintain facial features'],
  default:             ['high quality', 'detailed', 'sharp focus'],
};

/** 按 provider 全名、逐级前缀、default 的顺序查找 booster */
function resolveBoosters(provider: string): string[] {
  if (QUALITY_BOOSTERS[provider]) return QUALITY_BOOSTERS[provider];
  const parts = provider.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (QUALITY_BOOSTERS[prefix]) return QUALITY_BOOSTERS[prefix];
  }
  return QUALITY_BOOSTERS.default;
}

/** 人物主体图（人物资产 + 人物主导分镜）：dramatic atmosphere 增添电影感 */
const GOLDEN_EXTRA = ['cinematic composition', 'dramatic atmosphere'];
/**
 * 纯场景/地点图专用（location_image）：
 * - 去除 dramatic atmosphere：模型会认为需要人物才能"营造戏剧感"
 * - no human subjects：正向词表达空场景，对不支持 negativePrompt 的模型（如 kieai）也生效
 * - environmental photography：引导模型聚焦空间和环境
 */
const GOLDEN_EXTRA_LOCATION = ['cinematic composition', 'no human subjects', 'environmental photography'];
/**
 * 宏大景别分镜（extreme_wide / bird_eye）或 insert 道具特写：
 * - 人物存在但非主体，或画面以环境/道具为主
 * - 去除 dramatic atmosphere，避免模型强行把人物推到画面中心
 */
const GOLDEN_EXTRA_ATMOSPHERIC = ['cinematic composition', 'atmospheric scene'];
/** 风格参考图/情绪板：概念艺术不强制无人，同样不追加 dramatic atmosphere */
const GOLDEN_EXTRA_STYLE_GUIDE = ['cinematic composition', 'concept art aesthetic'];
const STANDARD_EXTRA: string[] = [];

/**
 * 景别感知正向提示词表（按 camera.shotSize 注入构图/裁切关键词）。
 *
 * 设计原则：
 * - ECU/CU       → 强调面部细节，大光圈虚化背景
 * - MCU/MS       → 面部+上身构图，是短剧最常见景别
 * - MW/WS        → 全身可见，环境开始出现
 * - EWS          → 宏大全景，人物渺小或不可见
 */
const FRAMING_SCALE_HINTS: Record<string, string> = {
  extreme_close_up: 'extreme close-up, sharp facial detail, intense emotional expression, heavy bokeh background',
  close_up:         'close-up portrait, sharp facial expression, shallow depth of field, face fills frame',
  medium_close_up:  'medium close-up, face and shoulders composition, upper body framing',
  medium:           'medium shot, waist-up composition, conversational framing',
  medium_wide:      'medium wide shot, full figure framing, character and environment balanced',
  wide:             'wide shot, full body visible, clear scene environment',
  extreme_wide:     'extreme wide establishing shot, panoramic scale, vast environment, characters appear small',
};

/**
 * 摄影机角度正向提示词表（按 camera.cameraAngle 注入透视关键词）。
 *
 * 设计原则：角度影响透视关系和情绪读感，与景别叠加效果加倍：
 * - low_angle   → 仰拍，产生压迫/强势感（配合人物特写效果最强）
 * - high_angle  → 俯拍，产生脆弱/被压制感
 * - dutch_angle → 斜构图，产生心理扭曲/不安感
 * - bird_eye    → 正俯视，命运视角/宏大格局感
 */
const ANGLE_PERSPECTIVE_HINTS: Record<string, string> = {
  front:         'front-facing direct view, straight-on composition',
  three_quarter: 'three-quarter view angle, natural conversational perspective',
  side_profile:  'strict side profile view, silhouette emphasis',
  over_shoulder: 'over-the-shoulder shot, foreground character silhouette, conversation perspective',
  pov:           'first person point of view, subjective camera, immersive perspective',
  bird_eye:      'bird eye view, overhead top-down composition, aerial perspective',
  high_angle:    'high angle shot, looking downward, surveying vulnerable perspective',
  low_angle:     'low angle shot, looking upward, imposing powerful perspective',
  worm_eye:      'worm eye view, extreme low angle upward, towering overwhelming perspective',
  dutch_angle:   'dutch tilt angle, diagonal frame distortion, skewed horizon',
  back_of_head:  'back of head view, following shot, mysterious trailing perspective',
};

const BASE_NEGATIVE = [
  'blurry', 'low quality', 'watermark', 'text', 'logo',
];

const CHARACTER_NEGATIVE_EXTRA = [
  'deformed face', 'extra fingers', 'extra limbs',
];

/** 场景/地点图：明确排除人物，避免模型自行添加人物以"营造氛围" */
const LOCATION_NEGATIVE_EXTRA = [
  'people', 'person', 'human', 'figure', 'character', 'man', 'woman',
];

/**
 * 风格防漂移 negative prompt 表。
 * 核心问题：不同视觉风格的短剧，图像生成模型在 prompt 不足时会"向默认风格漂移"：
 *  - 2D 动漫剧 → 模型会往写实摄影/3D 渲染漂移
 *  - 3D CG 剧  → 模型会往动漫手绘/水彩漂移
 *  - 定格动画  → 模型会往数字写实漂移
 *
 * 设计原则：每个桶的 negative 只包含"与本风格矛盾"的词，
 * 不能太宽泛（如直接 negative "realistic" 会伤害 2D 人物质感）。
 *
 * live_action 的 negative 由 media-orchestrator 的 LIVE_ACTION_NEGATIVE_EXTRA 处理（painting/illustration 等），
 * 此处仍列出以便资产生成流程也能复用。
 */
const STYLE_BUCKET_NEGATIVE: Record<string, string[]> = {
  two_d: [
    'photorealistic', 'hyperrealistic', 'photograph', '3d render', 'cgi',
    'realistic face', 'live action', 'cinema photography',
  ],
  three_d: [
    'anime', 'manga', 'hand-drawn', '2d flat', 'sketch',
    'watercolor painting', 'ink painting', 'cel animation', 'cartoon illustration',
  ],
  stop_motion: [
    'photorealistic', 'hyperrealistic', 'smooth digital render', 'anime', 'manga',
    'cinema photography',
  ],
  live_action: [
    'painting', 'illustration', 'watercolor painting', 'ink painting',
    'comic panel', 'anime', 'manga', '2d flat',
  ],
  generic: [],
};

/**
 * 联合 shotType × dramaShotType × shotSize × cameraAngle 选择 GOLDEN_EXTRA 词组。
 *
 * 决策矩阵：
 *
 * ┌─────────────────────┬──────────────────────────────────────────────────────┐
 * │ 条件                │ GOLDEN_EXTRA 选择                                      │
 * ├─────────────────────┼──────────────────────────────────────────────────────┤
 * │ shotType=location   │ GOLDEN_EXTRA_LOCATION（严格无人）                       │
 * │ shotType=style_guide│ GOLDEN_EXTRA_STYLE_GUIDE（概念艺术）                    │
 * │ dramaShotType=wide  │ GOLDEN_EXTRA_ATMOSPHERIC（宏大环境，人物非主体）         │
 * │ dramaShotType=insert│ GOLDEN_EXTRA_ATMOSPHERIC（道具/细节特写，不需要戏剧感）   │
 * │ shotSize=EWS /      │ GOLDEN_EXTRA_ATMOSPHERIC（宏大全景，人物渺小）           │
 * │ cameraAngle=bird_eye│                                                        │
 * │ 其他所有分镜        │ GOLDEN_EXTRA（人物主导，dramatic atmosphere 增电影感）   │
 * └─────────────────────┴──────────────────────────────────────────────────────┘
 */
function resolveGoldenExtra(shotType?: string, dramaShotType?: string, shotSize?: string, cameraAngle?: string): string[] {
  if (shotType === 'location') return GOLDEN_EXTRA_LOCATION;
  if (shotType === 'style_guide') return GOLDEN_EXTRA_STYLE_GUIDE;

  if (dramaShotType === 'wide' || dramaShotType === 'insert') return GOLDEN_EXTRA_ATMOSPHERIC;
  if (shotSize === 'extreme_wide' || cameraAngle === 'bird_eye') return GOLDEN_EXTRA_ATMOSPHERIC;

  return GOLDEN_EXTRA;
}

const CONFLICTING_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bday\b/i, /\bnight\b/i],
  [/\bindoor\b/i, /\boutdoor\b/i],
  [/\bsunlight\b/i, /\bmoonlight\b/i],
  [/\bsnow\b/i, /\bdesert\b/i],
  [/\brain\b/i, /\bsunny\b/i],
];

const T2V_MOTION_HINTS: Record<string, string> = {
  slow_motion: 'slow motion cinematic',
  time_lapse: 'time lapse photography',
  dolly_zoom: 'dolly zoom vertigo effect',
  fast_push: 'fast push in camera movement',
  fast_pull: 'fast pull back camera movement',
  bullet_time: 'bullet time frozen moment',
  fpv: 'FPV drone shot smooth movement',
  macro: 'macro close-up detailed shot',
  probe_lens: 'probe lens perspective',
  dutch_tilt: 'dutch angle tilted perspective',
};

const T2V_CAMERA_MOVEMENT: Record<string, string> = {
  static: '',
  slow_push_in: 'slowly pushing in toward subject',
  slow_pull_back: 'slowly pulling back from subject',
  pan_left: 'smooth camera panning left',
  pan_right: 'smooth camera panning right',
  tilt_up: 'camera tilting upward',
  tilt_down: 'camera tilting downward',
  tracking: 'camera tracking alongside subject movement',
  crane_up: 'crane shot rising upward',
  crane_down: 'crane shot descending',
  handheld: 'handheld camera with natural subtle shake',
  whip_pan: 'fast whip pan with motion blur',
  dolly_zoom: 'dolly zoom vertigo effect',
  orbit: 'camera orbiting around subject',
};

/** T2V 景别上下文（按 shotSize 注入视频描述词） */
const T2V_SHOT_SIZE_CONTEXT: Record<string, string> = {
  extreme_close_up: 'extreme close-up detail shot',
  close_up: 'close-up shot',
  medium_close_up: 'medium close-up shot',
  medium: 'medium shot',
  medium_wide: 'medium wide shot',
  wide: 'wide establishing shot',
  extreme_wide: 'extreme wide panoramic shot',
};

/** T2V 角度上下文（按 cameraAngle 注入视频描述词） */
const T2V_CAMERA_ANGLE_CONTEXT: Record<string, string> = {
  front: 'straight-on frontal perspective',
  three_quarter: 'three-quarter angle view',
  side_profile: 'side profile view',
  over_shoulder: 'over the shoulder perspective',
  pov: 'first person point of view',
  bird_eye: 'bird eye view from above',
  high_angle: 'high angle looking down',
  low_angle: 'low angle looking up',
  worm_eye: 'extreme low angle worm eye view',
  dutch_angle: 'dutch tilted angle',
  back_of_head: 'trailing back-of-head following shot',
};

/** 特写景别集合 — T2V 时注入 face stability hint（近景面部稳定性更关键） */
const CLOSE_UP_SIZES = new Set(['close_up', 'extreme_close_up', 'medium_close_up']);

const COLOR_HINT_MAP: Record<string, string> = {
  warm: 'warm tones, golden warm lighting',
  cold: 'cool blue tones, cold blue-grey lighting',
  high_contrast: 'high contrast dramatic lighting',
  desaturated: 'muted desaturated colors, flat low-contrast lighting',
  golden_hour: 'golden hour warm sunlight, amber glow',
  noir: 'film noir style, deep shadows, strong chiaroscuro contrast',
  neutral: '',
};

const T2I_ROUTE_HINTS: Record<string, string> = {
  portrait_consistency: 'same character identity, consistent face structure, stable costume details',
  action_motion: 'dynamic pose, clear motion intention, directional composition',
  wide_atmosphere: 'strong environmental storytelling, layered depth, atmospheric perspective',
  dialogue_stable: 'clean shot-reverse-shot readability, balanced framing, natural eyeline',
  budget_fast: 'simple composition, clean subject-background separation',
};

const T2V_ROUTE_HINTS: Record<string, string> = {
  portrait_consistency: 'stable face identity over time, subtle micro-expression changes',
  action_motion: 'dynamic camera rhythm, clear trajectory, coherent motion blur',
  wide_atmosphere: 'establishing camera language, environmental depth and parallax',
  dialogue_stable: 'steady conversational blocking, readable eyeline continuity',
  budget_fast: 'stable camera, minimal complex motion, efficient visual storytelling',
};

@Injectable()
export class PromptOptimizerService implements OnModuleInit {
  private readonly logger = new Logger('PromptOptimizer');
  private defaultProvider = 'volcengine';
  private maxT2ITokens = 300;
  private maxT2VTokens = 150;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    this.defaultProvider = String(media.defaultImageProvider || 'volcengine');
    const promptCfg = (media.promptOptimizer ?? {}) as Record<string, unknown>;
    this.maxT2ITokens = Number(promptCfg.maxT2ITokens) || 150;
    this.maxT2VTokens = Number(promptCfg.maxT2VTokens) || 150;
  }

  optimizeForT2I(rawPrompt: string, rawNegative: string, opts: T2IOptimizeOptions = {}): OptimizeResult {
    const provider = opts.provider || this.defaultProvider;
    const tier = opts.qualityTier || 'standard';
    const added: string[] = [];
    const removed: string[] = [];

    let prompt = rawPrompt.trim();
    const resolved = this.resolveConflicts(prompt);
    prompt = resolved.prompt;
    removed.push(...resolved.removed);

    if (opts.emotionColorHint) {
      const hint = COLOR_HINT_MAP[opts.emotionColorHint];
      if (hint && !prompt.toLowerCase().includes(hint.split(',')[0].toLowerCase())) {
        prompt = `${prompt}, ${hint}`;
        added.push(hint);
      }
    }

    if (opts.routeProfile) {
      const routeHint = T2I_ROUTE_HINTS[opts.routeProfile];
      if (routeHint && !prompt.toLowerCase().includes(routeHint.split(',')[0].toLowerCase())) {
        prompt = `${prompt}, ${routeHint}`;
        added.push(routeHint);
      }
    }

    // 注入景别提示词（按 shotSize 注入构图/裁切关键词）
    if (opts.shotSize) {
      const framingHint = FRAMING_SCALE_HINTS[opts.shotSize];
      if (framingHint && !prompt.toLowerCase().includes(framingHint.split(',')[0].toLowerCase())) {
        prompt = `${prompt}, ${framingHint}`;
        added.push(framingHint);
      }
    }

    // 注入角度透视提示词（按 cameraAngle 注入透视关键词，与景别叠加）
    if (opts.cameraAngle) {
      const anglePerspective = ANGLE_PERSPECTIVE_HINTS[opts.cameraAngle];
      if (anglePerspective && !prompt.toLowerCase().includes(anglePerspective.split(',')[0].toLowerCase())) {
        prompt = `${prompt}, ${anglePerspective}`;
        added.push(anglePerspective);
      }
    }

    const boosters = resolveBoosters(provider);
    const tierExtra = tier === 'golden'
      ? resolveGoldenExtra(opts.shotType, opts.dramaShotType, opts.shotSize, opts.cameraAngle)
      : tier === 'standard' ? STANDARD_EXTRA : [];
    const allBoosters = [...boosters, ...tierExtra];

    const toAdd = allBoosters.filter(b => !prompt.toLowerCase().includes(b.toLowerCase()));
    if (toAdd.length) {
      prompt = `${prompt}, ${toAdd.join(', ')}`;
      added.push(...toAdd);
    }

    const isKieAi = provider.startsWith('kieai.');

    // KIE.AI (FLUX等模型) 本质上不支持 negativePrompt，因此执行【反向词正向化】(Negative Inversion)
    // 将防漂移、防乱入的反向意图，转化为强烈的正向英语主张，塞入 Prompt 中。
    if (isKieAi) {
      const inversionHints: string[] = [];
      
      // 1. 防止空境乱入人物
      if (opts.shotType === 'location' && !prompt.toLowerCase().includes('no humans')) {
        inversionHints.push('absolutely no humans', 'empty scenery only', 'zero characters');
      }
      
      // 2. 防止视觉风格漂移 (Style Drift)
      const styleBucket = opts.styleBucket;
      if (styleBucket === 'two_d') {
        inversionHints.push('strict 2D flat illustration', 'zero 3D elements', 'definitely not a photograph');
      } else if (styleBucket === 'three_d') {
        inversionHints.push('strict 3D CG render', 'not 2D anime', 'not an illustration');
      } else if (styleBucket === 'live_action') {
        inversionHints.push('strict live action photography', 'not a painting', 'not an illustration');
      } else if (styleBucket === 'stop_motion') {
        inversionHints.push('strict physical stop motion miniature', 'not a digital render', 'not an anime');
      }

      if (inversionHints.length > 0) {
        const hintStr = inversionHints.join(', ');
        prompt = `${prompt}, ${hintStr}`;
        added.push('kieai_negative_inversion');
      }
    }

    prompt = this.deduplicateKeywords(prompt);
    // 按 provider 区分截断上限：kieai 支持 20000 字符无需截断，volcengine 对齐 2000 char maxLength
    const effectiveMaxTokens = isKieAi ? Infinity
      : provider.startsWith('volcengine') ? 500
      : 300;
    prompt = this.smartTruncate(prompt, effectiveMaxTokens);

    // KIE.AI 最终返回空 negativePrompt
    if (isKieAi) {
      return { prompt, negativePrompt: '', metadata: { addedKeywords: added, removedKeywords: removed } };
    }

    let neg = rawNegative?.trim() || '';
    const negTokens = new Set(neg.toLowerCase().split(/,\s*/).map(s => s.trim()).filter(Boolean));
    const baseNeg = [...BASE_NEGATIVE];
    if (opts.shotType === 'character' || opts.shotType === 'first_frame' || opts.shotType === 'last_frame') {
      // first_frame / last_frame 均为人物主导镜头，需要同样的人物畸形防护
      baseNeg.push(...CHARACTER_NEGATIVE_EXTRA);
    } else if (opts.shotType === 'location') {
      // 场景图：强制排除人物（volcengine 支持 negativePrompt，kieai 已通过 GOLDEN_EXTRA_LOCATION 正向处理）
      baseNeg.push(...LOCATION_NEGATIVE_EXTRA);
    }
    // style_guide 不加人物排除词：概念艺术情绪板可以有人物剪影/局部

    // 风格防漂移 negative：按 styleBucket 添加与本风格矛盾的词，防止模型向默认风格漂移
    if (opts.styleBucket && opts.styleBucket !== 'generic') {
      const styleDriftNeg = STYLE_BUCKET_NEGATIVE[opts.styleBucket] ?? [];
      const styleDriftToAdd = styleDriftNeg.filter(n => !negTokens.has(n.toLowerCase()));
      if (styleDriftToAdd.length) baseNeg.push(...styleDriftToAdd);
    }
    const negToAdd = baseNeg.filter(n => !negTokens.has(n.toLowerCase()));
    if (negToAdd.length) {
      neg = neg ? `${neg}, ${negToAdd.join(', ')}` : negToAdd.join(', ');
    }

    return { prompt, negativePrompt: neg, metadata: { addedKeywords: added, removedKeywords: removed } };
  }

  optimizeForT2V(rawPrompt: string, opts: T2VOptimizeOptions = {}): OptimizeResult {
    const added: string[] = [];
    const removed: string[] = [];

    const targetProvider = opts.provider ?? 'volcengine';
    /**
     * Provider 能力分类：
     *  · keyword-driven：Seedance / Wan Animate — 关键词 token 提升显著
     *  · natural-language：Kling / Hailuo / Veo / Sora — 自然语言描述即可，
     *    Seedance 专有 token 可能无效或降质，但运镜/景别/情绪色自然语言描述有效
     *  · avatar：Kling Avatar — prompt 仅作辅助描述，核心靠人脸图+音频
     */
    const isKlingOrHailuo = targetProvider === 'kling' || targetProvider === 'hailuo';
    const isVeoOrSora = targetProvider === 'veo' || targetProvider === 'sora';
    const isAvatar = targetProvider === 'kling-avatar';
    const isWanAnimate = targetProvider === 'wan-animate';
    const isNaturalLanguage = isKlingOrHailuo || isVeoOrSora;
    const isKeywordDriven = !isNaturalLanguage && !isAvatar && !isWanAnimate;

    let prompt = rawPrompt.trim();

    // Strip face-lock fragments injected by LLM: "[Name: face desc, hair, body, wearing ...]"
    // 精确匹配 LLM 注入的角色描述块（含冒号分隔符），避免误删有意义的方括号内容
    const faceStripped = prompt.replace(/\[[^\]]*?:\s*[^\]]{10,}\]/g, '').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
    if (faceStripped !== prompt) {
      this.logger.debug(`T2V face-lock stripped: ${prompt.length} → ${faceStripped.length} chars`);
      removed.push('face_lock_fragments');
      prompt = faceStripped;
    }

    // Strip static-image style prefixes that harm video generation
    prompt = prompt.replace(/^(cinematic\s+film\s+still|film\s+still|photograph|photo),?\s*/i, '');

    const resolved = this.resolveConflicts(prompt);
    prompt = resolved.prompt;
    removed.push(...resolved.removed);

    // ── Avatar：构建情绪/表情/语速提示词 ──────────────────────────────────────
    if (isAvatar) {
      const avatarParts: string[] = [];

      if (opts.dialogueEmotion) {
        avatarParts.push(this.mapAvatarEmotion(opts.dialogueEmotion));
      }
      if (opts.dialoguePace && opts.dialoguePace !== 'normal') {
        const paceMap: Record<string, string> = {
          very_slow: 'speaking very slowly and deliberately',
          slow: 'speaking slowly',
          fast: 'speaking quickly',
          very_fast: 'speaking rapidly with urgency',
        };
        avatarParts.push(paceMap[opts.dialoguePace] ?? '');
      }
      if (opts.dialogueVolume && opts.dialogueVolume !== 'normal') {
        const volMap: Record<string, string> = {
          whisper: 'whispering softly',
          low: 'speaking in a low quiet voice',
          loud: 'speaking loudly',
          scream: 'shouting intensely',
        };
        avatarParts.push(volMap[opts.dialogueVolume] ?? '');
      }

      const avatarPrompt = avatarParts.filter(Boolean).join(', ');
      if (avatarPrompt) added.push('avatar_emotion_hints');
      return { prompt: avatarPrompt, negativePrompt: '', metadata: { addedKeywords: added, removedKeywords: removed } };
    }

    // Wan Animate 是 V2V 模型（无 prompt），直接跳过
    if (isWanAnimate) return { prompt: prompt.trim(), negativePrompt: '', metadata: { addedKeywords: added, removedKeywords: removed } };

    // ── 以下注入逻辑对 keyword-driven 模型（Seedance 等）有效 ─────
    if (isKeywordDriven) {
      if (opts.specialTechnique && T2V_MOTION_HINTS[opts.specialTechnique]) {
        const hint = T2V_MOTION_HINTS[opts.specialTechnique];
        if (!prompt.toLowerCase().includes(hint.split(' ')[0].toLowerCase())) {
          prompt = `${hint}, ${prompt}`;
          added.push(hint);
        }
      }

      if (opts.cameraMovement && opts.cameraMovement !== 'static') {
        const movHint = T2V_CAMERA_MOVEMENT[opts.cameraMovement];
        if (movHint && !prompt.toLowerCase().includes(movHint.split(' ')[0].toLowerCase())) {
          prompt = `${movHint}, ${prompt}`;
          added.push(movHint);
        }
      }

      // 注入景别上下文（T2V 视频理解景别帮助其维持构图范围）
      if (opts.shotSize) {
        const sizeCtx = T2V_SHOT_SIZE_CONTEXT[opts.shotSize];
        if (sizeCtx && !prompt.toLowerCase().includes(sizeCtx.split(' ')[0].toLowerCase())) {
          prompt = `${sizeCtx}, ${prompt}`;
          added.push(sizeCtx);
        }
      }

      // 注入角度上下文（T2V 视频理解摄影机透视角度）
      if (opts.cameraAngle) {
        const angleCtx = T2V_CAMERA_ANGLE_CONTEXT[opts.cameraAngle];
        if (angleCtx && !prompt.toLowerCase().includes(angleCtx.split(' ')[0].toLowerCase())) {
          prompt = `${angleCtx}, ${prompt}`;
          added.push(angleCtx);
        }
      }

      if (opts.routeProfile) {
        const routeHint = T2V_ROUTE_HINTS[opts.routeProfile];
        if (routeHint && !prompt.toLowerCase().includes(routeHint.split(',')[0].toLowerCase())) {
          prompt = `${prompt}, ${routeHint}`;
          added.push(routeHint);
        }
      }

      // Face stability hint for close-up shots — reduces face deformation in I2V
      const isCloseUp = CLOSE_UP_SIZES.has(opts.shotSize ?? '');
      if (isCloseUp) {
        const faceHint = 'stable face, subtle expression changes, consistent facial features';
        if (!prompt.toLowerCase().includes('stable face')) {
          prompt = `${prompt}, ${faceHint}`;
          added.push(faceHint);
        }
      }

      if (opts.emotionColorHint) {
        const colorHint = COLOR_HINT_MAP[opts.emotionColorHint];
        if (colorHint && !prompt.toLowerCase().includes(colorHint.split(',')[0].toLowerCase())) {
          prompt = `${prompt}, ${colorHint}`;
          added.push(colorHint);
        }
      }

      if (typeof opts.duration === 'number' && opts.duration <= 3) {
        const shortHint = 'single action, minimal complexity';
        if (!prompt.toLowerCase().includes('single action')) {
          prompt = `${prompt}, ${shortHint}`;
          added.push(shortHint);
        }
      }

      if (!opts.hasFirstFrame) {
        const videoBoost = 'cinematic video, smooth motion';
        if (!prompt.toLowerCase().includes('cinematic')) {
          prompt = `${videoBoost}, ${prompt}`;
          added.push(videoBoost);
        }
      }
    }
    // ── 自然语言模型增强（Kling / Hailuo / Veo / Sora） ──────────────────────
    // 这些模型语义理解能力强，直接接受自然语言描述。
    // 注入运镜、景别、面部稳定、情绪色调等自然语言提示词（非 Seedance 专有 token）。
    if (isNaturalLanguage) {
      // 摄影机运动（自然语言描述，两个模型均能理解）
      if (opts.cameraMovement && opts.cameraMovement !== 'static') {
        const movHint = T2V_CAMERA_MOVEMENT[opts.cameraMovement];
        if (movHint && !prompt.toLowerCase().includes(movHint.split(' ')[0].toLowerCase())) {
          prompt = `${movHint}, ${prompt}`;
          added.push(movHint);
        }
      }

      // 景别上下文：帮助模型维持正确构图范围（自然语言，对 Kling 效果显著）
      if (opts.shotSize) {
        const sizeCtx = T2V_SHOT_SIZE_CONTEXT[opts.shotSize];
        if (sizeCtx && !prompt.toLowerCase().includes(sizeCtx.split(' ')[0].toLowerCase())) {
          prompt = `${sizeCtx}, ${prompt}`;
          added.push(sizeCtx);
        }
      }

      // 双关键帧模式（Kling I2V + lastFrame）：提示模型在首尾帧之间做平滑动作插值
      if (opts.hasLastFrame) {
        const transHint = 'smooth motion transition between start and end keyframe poses';
        if (!prompt.toLowerCase().includes('smooth motion')) {
          prompt = `${prompt}, ${transHint}`;
          added.push(transHint);
        }
      }

      // 近景面部稳定：特写/超特写时面部变形是最高频问题，对 Hailuo 情感镜头尤为关键
      const isCloseUp = CLOSE_UP_SIZES.has(opts.shotSize ?? '');
      if (isCloseUp) {
        const faceHint = 'natural facial expression, stable face identity, no face distortion';
        if (!prompt.toLowerCase().includes('natural facial')) {
          prompt = `${prompt}, ${faceHint}`;
          added.push(faceHint);
        }
      }

      // 情绪色调：Kling/Hailuo 对颜色描述有明显响应
      if (opts.emotionColorHint) {
        const colorHint = COLOR_HINT_MAP[opts.emotionColorHint];
        if (colorHint && !prompt.toLowerCase().includes(colorHint.split(',')[0].toLowerCase())) {
          prompt = `${prompt}, ${colorHint}`;
          added.push(colorHint);
        }
      }
    }

    // 色调一致性：有首帧且有情绪色调时，提示视频模型保持与首帧一致的色彩基调
    if (opts.hasFirstFrame && opts.emotionColorHint && opts.emotionColorHint !== 'neutral') {
      const toneHint = 'maintain consistent color tone and lighting from the first frame';
      if (!prompt.toLowerCase().includes('maintain consistent')) {
        prompt = `${prompt}, ${toneHint}`;
        added.push(toneHint);
      }
    }

    prompt = this.deduplicateKeywords(prompt);
    // 自然语言模型（Kling/Hailuo/Veo/Sora）支持更长 prompt，放宽截断限制
    const maxTokens = isNaturalLanguage ? Math.max(this.maxT2VTokens * 2, 300) : this.maxT2VTokens;
    prompt = this.smartTruncate(prompt, maxTokens);

    return { prompt, negativePrompt: '', metadata: { addedKeywords: added, removedKeywords: removed } };
  }

  private resolveConflicts(prompt: string): { prompt: string; removed: string[] } {
    const removed: string[] = [];
    let result = prompt;
    for (const [a, b] of CONFLICTING_PAIRS) {
      const mA = a.exec(result);
      const mB = b.exec(result);
      if (mA && mB) {
        const drop = mA.index <= mB.index ? b : a;
        result = result.replace(drop, '').replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();
        removed.push(drop.source.replace(/\\b/g, ''));
      }
    }
    return { prompt: result, removed };
  }

  /** 将对话情绪标签映射为 Avatar 可理解的自然语言表情/情绪描述 */
  private mapAvatarEmotion(emotion: string): string {
    const lower = emotion.toLowerCase();
    const MAP: Record<string, string> = {
      angry: 'angry expression, furrowed brows, intense eyes',
      sad: 'sad expression, tearful eyes, downturned mouth',
      happy: 'happy expression, warm smile, bright eyes',
      joyful: 'joyful expression, beaming smile, radiant face',
      surprised: 'surprised expression, wide eyes, raised eyebrows',
      shocked: 'shocked expression, open mouth, wide eyes',
      fearful: 'fearful expression, wide frightened eyes, tense face',
      disgusted: 'disgusted expression, wrinkled nose, narrowed eyes',
      contempt: 'contemptuous expression, slight sneer, cold eyes',
      calm: 'calm and composed expression, relaxed face',
      determined: 'determined expression, set jaw, focused eyes',
      worried: 'worried expression, furrowed brows, anxious eyes',
      tender: 'tender expression, soft gentle smile, warm loving gaze',
      cold: 'cold expression, emotionless face, sharp distant eyes',
      sarcastic: 'sarcastic expression, slight smirk, raised eyebrow',
      desperate: 'desperate expression, pleading eyes, strained face',
    };
    return MAP[lower] ?? `${emotion} expression`;
  }

  private deduplicateKeywords(prompt: string): string {
    const segments = prompt.split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const seg of segments) {
      const key = seg.toLowerCase().replace(/\s+/g, ' ');
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(seg);
      }
    }
    return unique.join(', ');
  }

  /**
   * Semantic-aware truncation: splits prompt into comma-delimited segments,
   * categorizes them (identity > scene > camera > boosters), and trims from
   * lowest priority. Never splits a segment mid-word.
   */
  private smartTruncate(prompt: string, maxTokens: number): string {
    const estimatedTokens = Math.ceil(prompt.split(/\s+/).length * 1.3);
    if (estimatedTokens <= maxTokens) return prompt;

    const segments = prompt.split(',').map(s => s.trim()).filter(Boolean);
    const BOOSTER_SET = new Set([
      ...Object.values(QUALITY_BOOSTERS).flat(),
      ...GOLDEN_EXTRA, ...GOLDEN_EXTRA_LOCATION, ...GOLDEN_EXTRA_ATMOSPHERIC,
      ...GOLDEN_EXTRA_STYLE_GUIDE, ...STANDARD_EXTRA,
      ...Object.values(FRAMING_SCALE_HINTS),
      ...Object.values(ANGLE_PERSPECTIVE_HINTS),
      ...Object.values(T2I_ROUTE_HINTS),
      // T2V 专属 hint（运镜/路由/面部稳定/颜色）—— 截断时低优先级，不影响核心内容
      ...Object.values(T2V_ROUTE_HINTS),
      ...Object.values(T2V_SHOT_SIZE_CONTEXT),
      ...Object.values(T2V_CAMERA_ANGLE_CONTEXT),
      ...Object.values(COLOR_HINT_MAP).filter(Boolean),
    ].map(b => b.toLowerCase()));

    const IDENTITY_PATTERNS = /\[.*?:.*?\]|face|hair|body|costume|wearing|dressed/i;

    const identity: string[] = [];
    const core: string[] = [];
    const boosters: string[] = [];
    for (const seg of segments) {
      if (IDENTITY_PATTERNS.test(seg)) identity.push(seg);
      else if (BOOSTER_SET.has(seg.toLowerCase())) boosters.push(seg);
      else core.push(seg);
    }

    const estTokens = (s: string) => Math.ceil(s.split(/\s+/).length * 1.3);

    // Priority: identity > core > boosters; trim boosters first, then core from end
    let result = [...identity, ...core, ...boosters].join(', ');
    if (estTokens(result) <= maxTokens) return result;

    result = [...identity, ...core].join(', ');
    if (estTokens(result) <= maxTokens) {
      const remaining = maxTokens - estTokens(result);
      if (remaining > 0 && boosters.length) {
        // Add as many complete booster segments as fit
        const addable: string[] = [];
        let addedTokens = 0;
        for (const b of boosters) {
          const bTokens = estTokens(b);
          if (addedTokens + bTokens <= remaining) { addable.push(b); addedTokens += bTokens; }
        }
        if (addable.length) result = `${result}, ${addable.join(', ')}`;
      }
      return result;
    }

    // Core exceeds budget: keep identity, trim core from end by complete segments
    const budget = maxTokens - estTokens(identity.join(', '));
    const kept: string[] = [];
    let usedTokens = 0;
    for (const seg of core) {
      const segTokens = estTokens(seg);
      if (usedTokens + segTokens > budget) break;
      kept.push(seg);
      usedTokens += segTokens;
    }
    result = [...identity, ...kept].join(', ');
    this.logger.debug(`Prompt truncated: ${segments.length} segments → ${identity.length + kept.length} (identity=${identity.length}, core=${kept.length}/${core.length})`);
    return result;
  }
}
