/** 情绪→媒体参数映射器 — 纯逻辑，将 Shot 情绪/场景数据映射为具体的媒体生产参数 */
import { Injectable } from '@nestjs/common';
import { Shot, ScriptScene } from './schemas/drama-state.schemas';

export type ColorGrade = 'warm' | 'cold' | 'high_contrast' | 'desaturated' | 'golden_hour' | 'noir' | 'neutral';

export interface ShotMediaParams {
  colorGrade: ColorGrade;
  speedFactor: number;         // 1.0=正常, 0.5=慢镜头, 2.0=快进
  stabilize: boolean;
  kenBurns?: { direction: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'; zoomFactor: number };
  ttsSpeedMultiplier: number;  // 1.0=正常
  ttsVolumeMultiplier: number; // 1.0=正常
  bgmVolumeMultiplier: number;
}

export interface EpisodeTimeline {
  bgmVolumeCurve: number[];
  cutFrequency: number[];
  emotionIntensityCurve: number[];
}

const EMOTION_COLOR_MAP: Record<string, ColorGrade> = {
  // 正面情绪
  happy: 'warm', excited: 'warm', joyful: 'warm', loving: 'warm',
  sweet: 'golden_hour', romantic: 'golden_hour', tender: 'golden_hour',
  proud: 'warm', triumphant: 'warm', relieved: 'warm',
  开心: 'warm', 兴奋: 'warm', 喜悦: 'warm', 甜蜜: 'golden_hour',
  // 负面情绪
  angry: 'high_contrast', furious: 'high_contrast', rage: 'high_contrast',
  sad: 'desaturated', grieving: 'desaturated', heartbroken: 'desaturated',
  terrified: 'cold', desperate: 'cold', anxious: 'cold',
  愤怒: 'high_contrast', 悲伤: 'desaturated', 恐惧: 'cold', 绝望: 'cold',
  // 悬疑/紧张
  suspicious: 'noir', mysterious: 'noir', tense: 'cold',
  shocked: 'high_contrast', stunned: 'high_contrast',
  紧张: 'cold', 震惊: 'high_contrast', 怀疑: 'noir',
  // 中性
  calm: 'neutral', composed: 'neutral', thoughtful: 'neutral',
  平静: 'neutral', 沉思: 'neutral',
};

const PURPOSE_COLOR_MAP: Record<string, ColorGrade> = {
  hook_opening: 'high_contrast',
  conflict: 'cold',
  revelation: 'high_contrast',
  emotional: 'warm',
  action: 'high_contrast',
  confrontation: 'cold',
  romantic: 'golden_hour',
  transition: 'neutral',
  climax: 'high_contrast',
  cliffhanger: 'noir',
};

const TECHNIQUE_SPEED_MAP: Record<string, number> = {
  slow_motion: 0.4,
  time_lapse: 4.0,
  fast_push: 1.0,
  fast_pull: 1.0,
  bullet_time: 0.2,
  dolly_zoom: 1.0,
  fpv: 1.0,
  macro: 1.0,
  probe_lens: 1.0,
  dutch_tilt: 1.0,
};

const DIALOGUE_EMOTION_TTS: Record<string, { speed: number; volume: number }> = {
  whisper: { speed: 0.85, volume: 0.6 },
  low: { speed: 0.9, volume: 0.7 },
  normal: { speed: 1.0, volume: 1.0 },
  loud: { speed: 1.1, volume: 1.3 },
  scream: { speed: 1.2, volume: 1.5 },
};

@Injectable()
export class EmotionMediaMapperService {

  /** 将单个 Shot 的情绪/场景数据映射为媒体生产参数 */
  mapShotToMediaParams(shot: Shot, scene?: ScriptScene): ShotMediaParams {
    const emotion = this.extractPrimaryEmotion(shot);
    const purpose = scene?.purpose;

    const colorGrade = this.resolveColorGrade(emotion, purpose);
    const speedFactor = shot.specialTechnique
      ? (TECHNIQUE_SPEED_MAP[shot.specialTechnique] ?? 1.0)
      : 1.0;

    const stabilize = !shot.specialTechnique || !['handheld', 'fpv'].includes(
      shot.camera?.movement ?? '',
    );

    const kenBurns = shot.qualityTier === 'filler'
      ? this.generateKenBurns(shot)
      : undefined;

    const dialogueVolume = shot.dialogue?.volume ?? 'normal';
    const ttsParams = DIALOGUE_EMOTION_TTS[dialogueVolume] ?? DIALOGUE_EMOTION_TTS.normal;

    const bgmVolume = shot.audio?.bgm?.intensity ?? 0.3;
    const hasTts = !!shot.dialogue?.text;
    const bgmVolumeMultiplier = hasTts ? Math.min(bgmVolume, 0.25) / 0.3 : 1.0;

    return {
      colorGrade,
      speedFactor,
      stabilize,
      kenBurns,
      ttsSpeedMultiplier: ttsParams.speed,
      ttsVolumeMultiplier: ttsParams.volume,
      bgmVolumeMultiplier,
    };
  }

  /** 将整集 Shot 序列映射为时间轴曲线 */
  mapEpisodeToTimeline(shots: Shot[]): EpisodeTimeline {
    const bgmVolumeCurve: number[] = [];
    const cutFrequency: number[] = [];
    const emotionIntensityCurve: number[] = [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      bgmVolumeCurve.push(shot.audio?.bgm?.intensity ?? 0.3);

      const dur = shot.estimatedDurationSec;
      cutFrequency.push(dur > 0 ? 1 / dur : 0.5);

      emotionIntensityCurve.push(this.emotionIntensity(shot));
    }

    return { bgmVolumeCurve, cutFrequency, emotionIntensityCurve };
  }

  private resolveColorGrade(emotion: string, purpose?: string): ColorGrade {
    if (emotion) {
      const emotionLower = emotion.toLowerCase();
      for (const [key, grade] of Object.entries(EMOTION_COLOR_MAP)) {
        if (emotionLower.includes(key)) return grade;
      }
    }
    if (purpose) {
      return PURPOSE_COLOR_MAP[purpose] ?? 'neutral';
    }
    return 'neutral';
  }

  private extractPrimaryEmotion(shot: Shot): string {
    if (shot.characters?.length) {
      return shot.characters[0].emotion ?? '';
    }
    if (shot.dialogue?.emotion) {
      return shot.dialogue.emotion;
    }
    return '';
  }

  private generateKenBurns(shot: Shot): { direction: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'; zoomFactor: number } {
    const angle = shot.camera?.angle ?? 'medium';
    if (['close_up', 'extreme_close_up', 'medium_close_up'].includes(angle)) {
      return { direction: 'zoom_out', zoomFactor: 1.08 };
    }
    if (['wide', 'extreme_wide'].includes(angle)) {
      return { direction: 'zoom_in', zoomFactor: 1.12 };
    }
    const directions = ['pan_left', 'pan_right'] as const;
    const idx = shot.shotIndex % 2;
    return { direction: directions[idx], zoomFactor: 1.06 };
  }

  private emotionIntensity(shot: Shot): number {
    const bgmIntensity = shot.audio?.bgm?.intensity ?? 0.3;
    const tier = shot.qualityTier ?? 'standard';
    const tierBoost = tier === 'golden' ? 0.3 : tier === 'filler' ? -0.2 : 0;
    const dialogueBoost = shot.dialogue?.volume === 'scream' ? 0.3
      : shot.dialogue?.volume === 'loud' ? 0.2
      : shot.dialogue?.volume === 'whisper' ? -0.1 : 0;
    return Math.max(0, Math.min(1, bgmIntensity + tierBoost + dialogueBoost));
  }
}
