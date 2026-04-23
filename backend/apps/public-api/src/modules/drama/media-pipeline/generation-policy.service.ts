import { Injectable } from '@nestjs/common';
import { DramaState } from '../schemas/drama-state.schemas';
import type {
  DramaStyleBucket,
  DramaShotType,
  DramaQualityTier,
  DramaShotRunPolicy,
  DramaMediaRunPolicy,
} from '../interfaces';

@Injectable()
export class GenerationPolicyService {
  resolveMediaPolicy(state: Pick<DramaState, 'visualStyleHint' | 'visualStyle'>): DramaMediaRunPolicy {
    const styleBucket = this.detectStyleBucket(state);

    // 强制执行统一的高质量、高一致性基础设定，不再做妥协
    const policy: DramaMediaRunPolicy = {
      styleBucket: 'generic',
      t2iConcurrency: 3,
      i2vConcurrency: 2,
      /** AI SFX 并发数（Phase 2.5），默认 2 路 */
      sfxConcurrency: 2,
      /** sound-effect-v2 当前暂不可用，设 false 跳过 Phase 2.5；恢复后改为 true */
      enablePipelineSfx: false,
      maxMediaRetries: 3,
      retryBaseDelayMs: 2500,
      enableQualityGate: false,
      enableCoherenceValidation: true,
      enableVlmCoherence: true,
      dbFlushEvery: 4,
    };

    return this.applyStyleAdjustment(policy, styleBucket);
  }

  resolveShotRunPolicy(input: {
    state: Pick<DramaState, 'imageResolution' | 'videoResolution'>;
    styleBucket: DramaStyleBucket;
    shotType?: DramaShotType;
    qualityTier?: DramaQualityTier;
  }): DramaShotRunPolicy {
    const shotType = input.shotType ?? 'dialogue';
    const qualityTier = input.qualityTier ?? 'standard';

    let policy = this.baseShotPolicy(shotType, qualityTier, input.styleBucket);

    // 应用用户选定的最终产物分辨率配置
    policy.videoQuality = (input.state.videoResolution === '4k' ? '1080p' : input.state.videoResolution as '720p' | '1080p') ?? '1080p';
    policy.imageResolution = (input.state.imageResolution as '1k' | '2k' | '4k') ?? '2k';

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
        videoQuality: '720p',
        imageResolution: '1k',
      };
    }

    if (qualityTier === 'golden' && (shotType === 'portrait' || shotType === 'dialogue')) {
      return {
        routeProfile: 'portrait_consistency',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 8.0,
        videoQuality: '1080p',
        imageResolution: '2k',
      };
    }

    if (qualityTier === 'golden' && shotType === 'action' && (styleBucket === 'live_action' || styleBucket === 'three_d')) {
      return {
        routeProfile: 'action_motion',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 7.8,
        videoQuality: '1080p',
        imageResolution: '2k',
      };
    }

    if (qualityTier === 'standard' && shotType === 'wide') {
      return {
        routeProfile: 'wide_atmosphere',
        candidateCount: 2,
        gateMaxAttempts: 2,
        gateMinScore: 7.2,
        videoQuality: '720p',
        imageResolution: '1k',
      };
    }

    if (qualityTier === 'standard' && shotType === 'dialogue' && styleBucket === 'two_d') {
      return {
        routeProfile: 'dialogue_stable',
        candidateCount: 2,
        gateMaxAttempts: 2,
        gateMinScore: 7.4,
        videoQuality: '720p',
        imageResolution: '1k',
      };
    }

    if (qualityTier === 'golden') {
      return {
        routeProfile: shotType === 'action' ? 'action_motion' : 'portrait_consistency',
        candidateCount: 3,
        gateMaxAttempts: 3,
        gateMinScore: 7.8,
        videoQuality: '1080p',
        imageResolution: '2k',
      };
    }

    return {
      routeProfile: shotType === 'action' ? 'action_motion' : shotType === 'wide' ? 'wide_atmosphere' : 'dialogue_stable',
      candidateCount: 2,
      gateMaxAttempts: 2,
      gateMinScore: 6.8,
      videoQuality: '720p',
      imageResolution: '1k',
    };
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
    } else if (styleBucket === 'two_d') {
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
