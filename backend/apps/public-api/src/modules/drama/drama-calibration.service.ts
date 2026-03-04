/** 短剧集级自校准引擎 — 将审阅发现的问题反哺到 DramaState 配置 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import type { DramaState, EpisodeReview, DramaPromptProfile } from './schemas/drama-state.schemas';

export interface DramaCalibrationEvent {
  type: 'pattern_tracked' | 'weight_adjusted';
  episode: number;
  detail: string;
}

const DRAMA_DIMENSION_KEYS = ['visualImpact', 'dialogueNaturalness', 'pacing', 'hookStrength', 'consistency', 'emotionalImpact'] as const;
const ISSUE_TO_DIMENSION: Record<string, string> = {
  visual_continuity: 'visualImpact', dialogue: 'dialogueNaturalness', pacing: 'pacing',
  hook: 'hookStrength', character_consistency: 'consistency', emotional_logic: 'emotionalImpact',
  camera_language: 'visualImpact', audio_design: 'emotionalImpact', duration: 'pacing',
};

@Injectable()
export class DramaCalibrationService {
  private readonly logger = new Logger(DramaCalibrationService.name);
  private readonly issueRepeatThreshold: number;
  private readonly maxActivePatterns: number;
  private readonly dimensionShiftWindow: number;
  private readonly dimensionShiftThreshold: number;
  private readonly weightAdjustStep: number;

  constructor(private readonly config: ConfigService) {
    const raw = (this.config.get('calibration') ?? {}) as Record<string, unknown>;
    this.issueRepeatThreshold = Number(raw.issueRepeatThreshold) || 2;
    this.maxActivePatterns = Number(raw.maxActivePatterns) || 20;
    this.dimensionShiftWindow = Number(raw.dimensionShiftWindow) || 5;
    this.dimensionShiftThreshold = Number(raw.dimensionShiftThreshold) || 1.5;
    this.weightAdjustStep = Number(raw.weightAdjustStep) || 0.1;
  }

  /** 每集完成后调用 — 追踪问题模式 + 维度权重微调 */
  calibrate(state: DramaState, review: EpisodeReview, episodeNumber: number): { state: DramaState; events: DramaCalibrationEvent[] } {
    const events: DramaCalibrationEvent[] = [];
    this.trackIssuePatterns(state, review, episodeNumber, events);
    this.adjustDimensionWeights(state, review, episodeNumber, events);
    this.compactPatterns(state);
    return { state, events };
  }

  /** 构建校准提示 — 供 scriptwriter/episode-director/script-reviewer 注入 */
  buildCalibrationHint(state: DramaState): string {
    const patterns = (state.recentIssuePatterns ?? []).filter(p => p.status === 'active' && p.occurrences >= this.issueRepeatThreshold);
    if (!patterns.length) return '';
    const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5);
    const lines = ['=== 自校准警示（近期高频问题）==='];
    for (const p of sorted) lines.push(`⚠ [${p.dimension}] ${p.pattern.split(':').slice(1).join(':')}（已出现${p.occurrences}次）`);
    return lines.join('\n');
  }

  private trackIssuePatterns(state: DramaState, review: EpisodeReview, ep: number, events: DramaCalibrationEvent[]): void {
    if (!state.recentIssuePatterns) state.recentIssuePatterns = [];
    for (const issue of review.issuesFound) {
      if (issue.severity === 'minor') continue;
      const dim = ISSUE_TO_DIMENSION[issue.category] ?? 'emotionalImpact';
      const sig = `${issue.category}:${issue.description.slice(0, 60)}`;
      const existing = state.recentIssuePatterns.find(p => p.pattern === sig && p.status === 'active');
      if (existing) { existing.occurrences++; existing.lastSeenEpisode = ep; }
      else state.recentIssuePatterns.push({ pattern: sig, dimension: dim, occurrences: 1, firstSeenEpisode: ep, lastSeenEpisode: ep, status: 'active' });
      events.push({ type: 'pattern_tracked', episode: ep, detail: sig });
    }
  }

  private adjustDimensionWeights(state: DramaState, review: EpisodeReview, ep: number, events: DramaCalibrationEvent[]): void {
    const profile = state.promptProfile as DramaPromptProfile | undefined;
    if (!profile?.reviewerCalibration) return;
    const kpi = state.kpiHistory ?? [];
    if (kpi.length < this.dimensionShiftWindow) return;
    const history = profile.reviewerCalibration.calibrationHistory ?? [];
    for (const dim of DRAMA_DIMENSION_KEYS) {
      const score = review.dimensions[dim] ?? 0;
      if (score >= this.dimensionShiftThreshold) continue;
      const recentAdj = history.filter(h => h.dimension === dim && ep - h.episode < this.dimensionShiftWindow);
      if (recentAdj.length > 0) continue;
      const weights = profile.reviewerCalibration.dimensionWeights as Record<string, number>;
      const oldW = weights[dim] ?? 1.0;
      const newW = Math.min(2.0, oldW + this.weightAdjustStep);
      if (newW === oldW) continue;
      weights[dim] = Number(newW.toFixed(2));
      if (!profile.reviewerCalibration.calibrationHistory) (profile.reviewerCalibration as any).calibrationHistory = [];
      profile.reviewerCalibration.calibrationHistory.push({ episode: ep, dimension: dim, oldWeight: oldW, newWeight: newW, reason: `E${ep} ${dim}=${score.toFixed(1)}，低于阈值${this.dimensionShiftThreshold}` });
      events.push({ type: 'weight_adjusted', episode: ep, detail: `${dim}: ${oldW}→${newW}` });
      this.logger.log(`[DramaCalibration] 维度权重微调 ${dim}: ${oldW}→${newW}`);
    }
  }

  private compactPatterns(state: DramaState): void {
    if (!state.recentIssuePatterns) return;
    state.recentIssuePatterns = state.recentIssuePatterns
      .filter(p => p.status === 'active')
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, this.maxActivePatterns);
  }
}
