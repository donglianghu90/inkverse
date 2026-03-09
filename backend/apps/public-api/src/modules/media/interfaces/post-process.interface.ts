/** 视频后处理 — 调色/特效/ Ken Burns 契约 */

export type ColorGrade = 'warm' | 'cold' | 'high_contrast' | 'desaturated' | 'golden_hour' | 'noir' | 'neutral';

export interface PostProcessOptions {
  specialTechnique?: string;
  colorGrade?: ColorGrade;
  stabilize?: boolean;
  kenBurns?: { direction: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'; zoomFactor: number };
  speedFactor?: number;
  durationSec?: number;
}

export interface PostProcessResult {
  outputPath: string;
  durationSec: number;
}
