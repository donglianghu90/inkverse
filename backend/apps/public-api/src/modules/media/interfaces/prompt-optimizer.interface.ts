/** Prompt 优化器 — 方法契约 */

export interface OptimizeResult {
  prompt: string;
  negativePrompt: string;
  metadata: { addedKeywords: string[]; removedKeywords: string[] };
}

export interface T2IOptimizeOptions {
  provider?: string;
  shotType?: string;
  qualityTier?: string;
  cameraAngle?: string;
  emotionColorHint?: string;
  routeProfile?: string;
}

export interface T2VOptimizeOptions {
  provider?: string;
  duration?: number;
  hasFirstFrame?: boolean;
  hasLastFrame?: boolean;
  specialTechnique?: string;
  cameraMovement?: string;
  cameraAngle?: string;
  emotionColorHint?: string;
  routeProfile?: string;
}
