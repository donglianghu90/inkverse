/** Prompt 优化器 — 针对 T2I/T2V 模型特性优化提示词，提升生成质量 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import type { OptimizeResult, T2IOptimizeOptions, T2VOptimizeOptions } from './interfaces/prompt-optimizer.interface';

export type { OptimizeResult, T2IOptimizeOptions, T2VOptimizeOptions } from './interfaces/prompt-optimizer.interface';

const QUALITY_BOOSTERS: Record<string, string[]> = {
  volcengine: ['cinematic lighting', 'rich color depth'],
  default: ['high quality', 'detailed', 'sharp focus'],
};

const GOLDEN_EXTRA = ['cinematic composition', 'dramatic atmosphere'];
const STANDARD_EXTRA: string[] = [];

const BASE_NEGATIVE = [
  'blurry', 'low quality', 'watermark', 'text', 'logo',
];

const CHARACTER_NEGATIVE_EXTRA = [
  'deformed face', 'extra fingers', 'extra limbs',
];

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

const T2V_ANGLE_CONTEXT: Record<string, string> = {
  extreme_close_up: 'extreme close-up detail shot',
  close_up: 'close-up shot',
  medium_close_up: 'medium close-up shot',
  medium: 'medium shot',
  medium_wide: 'medium wide shot',
  wide: 'wide establishing shot',
  extreme_wide: 'extreme wide panoramic shot',
  over_shoulder: 'over the shoulder perspective',
  bird_eye: 'bird eye view from above',
  low_angle: 'low angle looking up',
  high_angle: 'high angle looking down',
  dutch_angle: 'dutch tilted angle',
  pov: 'first person point of view',
};

const CLOSE_UP_ANGLES = new Set(['close_up', 'extreme_close_up', 'medium_close_up']);

const COLOR_HINT_MAP: Record<string, string> = {
  warm: 'warm tones, golden warm lighting',
  cold: 'cool blue tones, cold atmosphere',
  high_contrast: 'high contrast dramatic lighting',
  desaturated: 'muted desaturated colors, somber mood',
  golden_hour: 'golden hour warm sunlight, amber glow',
  noir: 'film noir style, deep shadows, moody',
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
  private maxT2VTokens = 100;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    this.defaultProvider = String(media.defaultImageProvider || 'volcengine');
    const promptCfg = (media.promptOptimizer ?? {}) as Record<string, unknown>;
    this.maxT2ITokens = Number(promptCfg.maxT2ITokens) || 150;
    this.maxT2VTokens = Number(promptCfg.maxT2VTokens) || 100;
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

    const boosters = QUALITY_BOOSTERS[provider] ?? QUALITY_BOOSTERS.default;
    const tierExtra = tier === 'golden' ? GOLDEN_EXTRA : tier === 'standard' ? STANDARD_EXTRA : [];
    const allBoosters = [...boosters, ...tierExtra];

    const toAdd = allBoosters.filter(b => !prompt.toLowerCase().includes(b.toLowerCase()));
    if (toAdd.length) {
      prompt = `${prompt}, ${toAdd.join(', ')}`;
      added.push(...toAdd);
    }

    prompt = this.deduplicateKeywords(prompt);
    prompt = this.smartTruncate(prompt, this.maxT2ITokens);

    let neg = rawNegative?.trim() || '';
    const negTokens = new Set(neg.toLowerCase().split(/,\s*/).map(s => s.trim()).filter(Boolean));
    const baseNeg = [...BASE_NEGATIVE];
    if (opts.shotType === 'character' || opts.shotType === 'first_frame') {
      baseNeg.push(...CHARACTER_NEGATIVE_EXTRA);
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

    let prompt = rawPrompt.trim();

    // Strip face-lock fragments injected by LLM: "[Name: face desc, hair, body, wearing ...]"
    const faceStripped = prompt.replace(/\[[^\]]{5,}\]/g, '').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').trim();
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

    if (opts.cameraAngle) {
      const angleCtx = T2V_ANGLE_CONTEXT[opts.cameraAngle];
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
    const isCloseUp = CLOSE_UP_ANGLES.has(opts.cameraAngle ?? '');
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

    prompt = this.deduplicateKeywords(prompt);
    prompt = this.smartTruncate(prompt, this.maxT2VTokens);

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
   * Smart truncation: split prompt into semantic segments, trim from the end
   * but protect core content (character descriptions) at the front.
   * Quality boosters are appended last so they get trimmed first.
   */
  private smartTruncate(prompt: string, maxTokens: number): string {
    const estimatedTokens = Math.ceil(prompt.split(/\s+/).length * 1.3);
    if (estimatedTokens <= maxTokens) return prompt;

    const segments = prompt.split(',').map(s => s.trim()).filter(Boolean);
    const BOOSTER_SET = new Set([
      ...Object.values(QUALITY_BOOSTERS).flat(),
      ...GOLDEN_EXTRA, ...STANDARD_EXTRA,
    ].map(b => b.toLowerCase()));

    const core: string[] = [];
    const boosters: string[] = [];
    for (const seg of segments) {
      if (BOOSTER_SET.has(seg.toLowerCase())) boosters.push(seg);
      else core.push(seg);
    }

    const estTokens = (s: string) => Math.ceil(s.split(/\s+/).length * 1.3);

    let result = [...core, ...boosters].join(', ');
    if (estTokens(result) <= maxTokens) return result;

    result = core.join(', ');
    const coreTokens = estTokens(result);
    if (coreTokens > maxTokens) {
      const coreWords = result.split(/\s+/);
      const cutAt = Math.floor(maxTokens / 1.3);
      this.logger.debug(`Prompt core truncated from ${coreWords.length} to ~${cutAt} words`);
      return coreWords.slice(0, cutAt).join(' ');
    }

    const remaining = maxTokens - coreTokens;
    if (remaining > 0 && boosters.length) {
      const boosterStr = boosters.join(', ');
      const boosterWords = boosterStr.split(/\s+/).slice(0, remaining);
      result = `${result}, ${boosterWords.join(' ')}`;
    }
    return result;
  }
}
