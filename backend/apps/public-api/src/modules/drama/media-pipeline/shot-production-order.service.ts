/** ShotProductionOrderService — Shot 生产排序策略（从 MediaOrchestratorService 抽取） */
import { Injectable, Logger } from '@nestjs/common';
import type { Shot } from '../schemas/drama-state.schemas';

@Injectable()
export class ShotProductionOrderService {
  private readonly logger = new Logger('ShotProductionOrder');

  /**
   * 按时间线顺序对 shots 排序 — shotIndex 始终是主排序键。
   *
   * 设计决策：之前按 priority/qualityTier/shotType 重排，会导致 insert 镜头被提前到
   * dialogue/wide 之前生成。但 insert 依赖前面已完成的 wide shot 填充 sceneCache 和
   * prevFrameCache，空缓存导致 refs=0 盲生成。现在严格按 shotIndex 保持叙事时间线，
   * 优先级仅用于质量门和重试策略，不影响生成顺序。
   */
  orderShotsForProduction(shots: Shot[], _riskShotIds?: Set<string>): Shot[] {
    return [...shots].sort((a, b) => a.shotIndex - b.shotIndex);
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
      return `${s.shotId}[idx=${s.shotIndex}${master}/${s.qualityTier || 'standard'}]`;
    }).join(', ');
    this.logger.log(`[scheduler] ${tag} order(top${Math.min(10, shots.length)}): ${top}`);
  }

  // ── 内部 scoring 方法（保留供质量门、重试优先级等非排序场景使用）──────

  /** 获取 Shot 的综合优先级分数（用于质量门重试优先级等，不用于生成排序） */
  getShotPriorityScore(shot: Shot, riskShotIds?: Set<string>): number {
    let score = 0;
    if (riskShotIds?.has(shot.shotId)) score += 10;
    score += this.priorityScore(shot.regenPriority);
    if (shot.isMasterShot) score += 3;
    score += this.qualityTierScore(shot.qualityTier);
    score += this.shotTypeScore(shot.shotType);
    return score;
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
