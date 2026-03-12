import { Injectable } from '@nestjs/common';
import { DramaState } from '../schemas/drama-state.schemas';
import type {
  DramaGenerationMode,
  DramaStyleBucket,
  DramaShotType,
  DramaQualityTier,
  DramaShotRunPolicy,
  DramaMediaRunPolicy,
} from '../interfaces';

@Injectable()
export class GenerationPolicyService {
  resolveMediaPolicy(state: Pick<DramaState, 'generationMode' | 'visualStyleHint' | 'visualStyle'>): DramaMediaRunPolicy {
    const mode: DramaGenerationMode = state.generationMode ?? 'balanced';
    const styleBucket = this.detectStyleBucket(state);
    const policy = this.basePolicyByMode(mode);
    return this.applyStyleAdjustment(policy, styleBucket);
  }

  private basePolicyByMode(mode: DramaGenerationMode): DramaMediaRunPolicy {
    if (mode === 'fast') {
      return {
        mode,
        styleBucket: 'generic',
        t2iConcurrency: 4,
        i2vConcurrency: 3,
        maxMediaRetries: 1,
        retryBaseDelayMs: 1200,
        // fast 降低候选和阈值，但仍保留质量门禁，避免严重翻车
        enableQualityGate: true,
        enableCoherenceValidation: false,
        dbFlushEvery: 8,
      };
    }
    if (mode === 'quality') {
      return {
        mode,
        styleBucket: 'generic',
        t2iConcurrency: 2,
        i2vConcurrency: 1,
        maxMediaRetries: 3,
        retryBaseDelayMs: 2500,
        enableQualityGate: true,
        enableCoherenceValidation: true,
        dbFlushEvery: 2,
      };
    }
    return {
      mode: 'balanced',
      styleBucket: 'generic',
      t2iConcurrency: 3,
      i2vConcurrency: 2,
      maxMediaRetries: 2,
      retryBaseDelayMs: 2000,
      enableQualityGate: true,
      enableCoherenceValidation: true,
      dbFlushEvery: 4,
    };
  }

  resolveShotRunPolicy(input: {
    mode: DramaGenerationMode;
    styleBucket: DramaStyleBucket;
    shotType?: DramaShotType;
    qualityTier?: DramaQualityTier;
  }): DramaShotRunPolicy {
    const shotType = input.shotType ?? 'dialogue';
    const qualityTier = input.qualityTier ?? 'standard';
    let policy = this.baseShotPolicy(shotType, qualityTier, input.styleBucket);
    policy = this.applyModeAdjustment(policy, input.mode);
    return this.clampShotPolicy(policy);
  }

  private baseShotPolicy(
    shotType: DramaShotType,
    qualityTier: DramaQualityTier,
    styleBucket: DramaStyleBucket,
  ): DramaShotRunPolicy {
    if (qualityTier === 'filler' || shotType === 'insert') {
      return {
        routeProfile: 'budget_fast',
        candidateCount: 1,
        gateMaxAttempts: 1,
        gateMinScore: 5.6,
        videoQuality: '480p',
      };
    }

    if (qualityTier === 'golden' && (shotType === 'portrait' || shotType === 'dialogue')) {
      return {
        routeProfile: 'portrait_consistency',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 8.0,
        videoQuality: '1080p',
      };
    }

    if (qualityTier === 'golden' && shotType === 'action' && (styleBucket === 'live_action' || styleBucket === 'three_d')) {
      return {
        routeProfile: 'action_motion',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 7.8,
        videoQuality: '1080p',
      };
    }

    if (qualityTier === 'standard' && shotType === 'wide') {
      return {
        routeProfile: 'wide_atmosphere',
        candidateCount: 2,
        gateMaxAttempts: 2,
        gateMinScore: 7.2,
        videoQuality: '720p',
      };
    }

    if (qualityTier === 'standard' && shotType === 'dialogue' && styleBucket === 'two_d') {
      return {
        routeProfile: 'dialogue_stable',
        candidateCount: 2,
        gateMaxAttempts: 2,
        gateMinScore: 7.4,
        videoQuality: '720p',
      };
    }

    if (qualityTier === 'golden') {
      return {
        routeProfile: shotType === 'action' ? 'action_motion' : 'portrait_consistency',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 7.8,
        videoQuality: '1080p',
      };
    }

    return {
      routeProfile: shotType === 'action' ? 'action_motion' : shotType === 'wide' ? 'wide_atmosphere' : 'dialogue_stable',
      candidateCount: 2,
      gateMaxAttempts: 2,
      gateMinScore: 6.8,
      videoQuality: '720p',
    };
  }

  private applyModeAdjustment(base: DramaShotRunPolicy, mode: DramaGenerationMode): DramaShotRunPolicy {
    if (mode === 'fast') {
      return {
        ...base,
        candidateCount: Math.max(1, base.candidateCount - 1),
        gateMaxAttempts: Math.max(1, base.gateMaxAttempts - 1),
        gateMinScore: base.gateMinScore - 0.8,
        videoQuality: base.videoQuality === '1080p' ? '720p' : base.videoQuality,
      };
    }
    if (mode === 'quality') {
      return {
        ...base,
        candidateCount: base.candidateCount + 1,
        gateMaxAttempts: base.gateMaxAttempts + 1,
        gateMinScore: base.gateMinScore + 0.5,
      };
    }
    return base;
  }

  private clampShotPolicy(policy: DramaShotRunPolicy): DramaShotRunPolicy {
    return {
      ...policy,
      candidateCount: Math.max(1, Math.min(4, policy.candidateCount)),
      gateMaxAttempts: Math.max(1, Math.min(4, policy.gateMaxAttempts)),
      gateMinScore: Math.max(4.5, Math.min(9.2, policy.gateMinScore)),
    };
  }

  private applyStyleAdjustment(base: DramaMediaRunPolicy, styleBucket: DramaStyleBucket): DramaMediaRunPolicy {
    const next: DramaMediaRunPolicy = { ...base, styleBucket };
    if (styleBucket === 'three_d' || styleBucket === 'live_action' || styleBucket === 'stop_motion') {
      next.t2iConcurrency = Math.max(1, next.t2iConcurrency - 1);
      next.i2vConcurrency = Math.max(1, next.i2vConcurrency - 1);
    } else if (styleBucket === 'two_d' && next.mode !== 'quality') {
      next.t2iConcurrency = Math.min(6, next.t2iConcurrency + 1);
    }
    return next;
  }

  private detectStyleBucket(state: Pick<DramaState, 'visualStyleHint' | 'visualStyle'>): DramaStyleBucket {
    const text = [
      state.visualStyleHint ?? '',
      state.visualStyle?.overallAesthetic ?? '',
      state.visualStyle?.renderTechnique ?? '',
      state.visualStyle?.textureStyle ?? '',
      state.visualStyle?.referenceStyle ?? '',
    ].join(' ').toLowerCase();

    if (this.hasAny(text, ['定格', '粘土', '毛毡', '纸艺', 'stop motion', 'clay'])) return 'stop_motion';
    if (this.hasAny(text, ['3d', 'cg', 'npr', 'pixar', '迪士尼', '赛璐璐'])) return 'three_d';
    if (this.hasAny(text, ['真人', '写实', '实拍', 'live action', 'photoreal'])) return 'live_action';
    if (this.hasAny(text, ['2d', '动漫', '漫画', '手绘', '水墨', '像素'])) return 'two_d';
    return 'generic';
  }

  private hasAny(text: string, keys: string[]): boolean {
    return keys.some((k) => text.includes(k.toLowerCase()));
  }
}
