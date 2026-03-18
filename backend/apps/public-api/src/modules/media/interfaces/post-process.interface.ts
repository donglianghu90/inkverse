/** 视频后处理 — 调色/特效/ Ken Burns 契约 */

export type ColorGrade = 'warm' | 'cold' | 'high_contrast' | 'desaturated' | 'golden_hour' | 'noir' | 'neutral';

export interface PostProcessOptions {
  specialTechnique?: string;
  colorGrade?: ColorGrade;
  /** 自定义 LUT 文件路径 (.cube/.3dl)，优先级高于 colorGrade */
  lutPath?: string;
  /** LUT 混合强度 0-1，1=完全应用LUT，0.5=半混合原始画面 */
  lutIntensity?: number;
  stabilize?: boolean;
  kenBurns?: { direction: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'; zoomFactor: number };
  speedFactor?: number;
  durationSec?: number;
}

export interface PostProcessResult {
  outputPath: string;
  durationSec: number;
}
