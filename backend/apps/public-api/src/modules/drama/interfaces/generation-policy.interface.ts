/** 媒体生成策略 — 契约 */

export type DramaGenerationMode = 'fast' | 'balanced' | 'quality';
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
  videoQuality: '480p' | '720p' | '1080p';
}

export interface DramaMediaRunPolicy {
  mode: DramaGenerationMode;
  styleBucket: DramaStyleBucket;
  t2iConcurrency: number;
  i2vConcurrency: number;
  maxMediaRetries: number;
  retryBaseDelayMs: number;
  enableQualityGate: boolean;
  enableCoherenceValidation: boolean;
  dbFlushEvery: number;
}
