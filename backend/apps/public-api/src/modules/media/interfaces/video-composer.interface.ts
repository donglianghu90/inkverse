/** 视频合成 — 契约 */
import type { PostProcessOptions } from './post-process.interface';

export interface ComposeShotInput {
  shotId: string;
  videoPath: string;
  ttsAudioPath?: string;
  durationSec: number;
  transition: string;
  subtitle?: { text: string; style: string };
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
