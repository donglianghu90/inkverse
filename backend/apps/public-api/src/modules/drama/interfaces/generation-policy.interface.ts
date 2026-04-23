/** 媒体生成策略 — 契约 */

export type DramaStyleBucket = 'two_d' | 'three_d' | 'live_action' | 'stop_motion' | 'generic';
export type DramaShotType = 'portrait' | 'dialogue' | 'action' | 'wide' | 'insert';
export type DramaQualityTier = 'golden' | 'standard' | 'filler';
export type DramaRouteProfile =
  | 'portrait_consistency'
  | 'action_motion'
  | 'wide_atmosphere'
  | 'dialogue_stable'
  | 'budget_fast';

export interface DramaShotRunPolicy {
  routeProfile: DramaRouteProfile;
  candidateCount: number;
  gateMaxAttempts: number;
  gateMinScore: number;
  videoQuality: '720p' | '1080p';
  imageResolution: '1k' | '2k' | '4k';
}

export interface DramaMediaRunPolicy {
  styleBucket: DramaStyleBucket;
  t2iConcurrency: number;
  i2vConcurrency: number;
  /** AI SFX 并发数（Phase 2.5），默认 2 */
  sfxConcurrency: number;
  maxMediaRetries: number;
  retryBaseDelayMs: number;
  enableQualityGate: boolean;
  enableCoherenceValidation: boolean;
  /** 启用 VLM 视觉比对增强（quality 模式专用，默认关闭 = 纯元数据检查） */
  enableVlmCoherence?: boolean;
  /** 是否在一键生成时执行 AI SFX（Phase 2.5），默认 false，sound-effect-v2 可用后设为 true */ 
  enablePipelineSfx?: boolean;
  dbFlushEvery: number;
}
