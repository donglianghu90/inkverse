/** 视频合成 — 契约 */
import type { PostProcessOptions } from './post-process.interface';

export interface ComposeShotInput {
  shotId: string;
  videoPath: string;
  ttsAudioPath?: string;
  durationSec: number;
  transition: string;
  /** 自适应转场时长(秒)。未指定时使用全局默认值 */
  transitionDurationSec?: number;
  /** Shot 内精确入点(秒)，用于 in-shot trim */
  trimInSec?: number;
  /** Shot 内精确出点(秒)，用于 in-shot trim */
  trimOutSec?: number;
  subtitle?: {
    text: string;
    style: string;
    karaoke?: boolean;
    characterId?: string;                    // 说话角色 → 颜色区分
    position?: 'bottom' | 'middle';          // 字幕位置
    ttsDurationSec?: number;                 // TTS 实际时长 → 精确字幕时间
  };
  bgmPath?: string;
  bgmIntensity?: number;
  bgmAction?: string;
  sfxPaths?: string[];
  ambiencePath?: string;
  postProcess?: PostProcessOptions;
}

export interface ComposeEpisodeInput {
  episodeId: string;
  shots: ComposeShotInput[];
  outputPath: string;
  aspectRatio?: string;
  fps?: number;
}

export interface ComposeResult {
  outputPath: string;
  durationSec: number;
  fileSizeMb: number;
}
