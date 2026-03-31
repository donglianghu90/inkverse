/** ShotProductionOrderService — Shot 生产排序策略（从 MediaOrchestratorService 抽取） */
import { Injectable, Logger } from '@nestjs/common';
import type { Shot } from '../schemas/drama-state.schemas';

@Injectable()
export class ShotProductionOrderService {
  private readonly logger = new Logger('ShotProductionOrder');

  /** 按优先级对 shots 排序（risk → regenPriority → masterShot → qualityTier → shotType → shotIndex） */
  orderShotsForProduction(shots: Shot[], riskShotIds?: Set<string>): Shot[] {
    return [...shots].sort((a, b) => this.compareShotPriority(a, b, riskShotIds));
  }

  /** 从审核结果中提取高风险 shot IDs */
  extractReviewRiskShotIds(review: unknown): Set<string> {
    const root = (review && typeof review === 'object') ? (review as Record<string, unknown>) : {};
    const ids = new Set<string>();
    const pick = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const shotId = (item as Record<string, unknown>).shotId;
        if (typeof shotId === 'string' && shotId.trim()) ids.add(shotId);
      }
    };
    pick(root.consistencyRiskShots);
    pick(root.cameraReadabilityRiskShots);
    return ids;
  }

  /** 日志打印排序后的前 N 个 shots */
  logShotOrder(tag: string, shots: Shot[]): void {
    if (!shots.length) return;
    const top = shots.slice(0, 10).map((s) => {
      const master = s.isMasterShot ? '*' : '';
      return `${s.shotId}[${s.regenPriority || 'medium'}${master}/${s.qualityTier || 'standard'}]`;
    }).join(', ');
    this.logger.log(`[scheduler] ${tag} order(top${Math.min(10, shots.length)}): ${top}`);
  }

  // ── 内部 scoring 方法 ──────────────────────────────────────────

  private compareShotPriority(a: Shot, b: Shot, riskShotIds?: Set<string>): number {
    const riskDiff = Number(riskShotIds?.has(b.shotId)) - Number(riskShotIds?.has(a.shotId));
    if (riskDiff !== 0) return riskDiff;

    const regenDiff = this.priorityScore(b.regenPriority) - this.priorityScore(a.regenPriority);
    if (regenDiff !== 0) return regenDiff;

    const masterDiff = Number(b.isMasterShot) - Number(a.isMasterShot);
    if (masterDiff !== 0) return masterDiff;

    const tierDiff = this.qualityTierScore(b.qualityTier) - this.qualityTierScore(a.qualityTier);
    if (tierDiff !== 0) return tierDiff;

    const typeDiff = this.shotTypeScore(b.shotType) - this.shotTypeScore(a.shotType);
    if (typeDiff !== 0) return typeDiff;

    return a.shotIndex - b.shotIndex;
  }

  private priorityScore(priority?: Shot['regenPriority']): number {
    if (priority === 'high') return 3;
    if (priority === 'low') return 1;
    return 2;
  }

  private qualityTierScore(tier?: Shot['qualityTier']): number {
    if (tier === 'golden') return 3;
    if (tier === 'filler') return 1;
    return 2;
  }

  private shotTypeScore(shotType?: Shot['shotType']): number {
    if (shotType === 'action') return 3;
    if (shotType === 'dialogue') return 3;
    if (shotType === 'wide') return 2;
    if (shotType === 'portrait') return 2;
    if (shotType === 'insert') return 1;
    return 2;
  }
}
