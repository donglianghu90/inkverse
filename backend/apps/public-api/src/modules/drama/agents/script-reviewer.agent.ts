/**
 * 剧本审核员 — 审核剧本+分镜的完整质量，送入实际台词和关键镜头描述而非仅摘要。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeReviewSchema, EpisodeReview, EpisodeStoryboard, EpisodeScript,
  DramaState,
} from '../schemas/drama-state.schemas';
import { buildScriptReviewerSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';
import { DramaCalibrationService } from '../drama-calibration.service';

const reviewOutputSchema = z.object({ review: episodeReviewSchema });

@Injectable()
export class ScriptReviewerAgent {
  constructor(
    private readonly llm: LlmService,
    private readonly promptService: DramaPromptTemplateService,
    private readonly calibration: DramaCalibrationService,
  ) {}

  async review(
    state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard,
  ): Promise<EpisodeReview> {
    const profile = state.promptProfile;
    const weights = profile?.reviewerCalibration?.dimensionWeights;
    const genreChecks = profile?.reviewerCalibration?.genreSpecificChecks;

    // 构建实际内容摘要（而非仅结构摘要）
    const scriptDetail = this.buildScriptDetail(script);
    const shotDetail = this.buildShotDetail(storyboard);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-reviewer',
      schema: reviewOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'script-reviewer', buildScriptReviewerSystemPrompt({ weights, genreChecks })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: script.episodeNumber },
      userPrompt: `审核第 ${script.episodeNumber} 集：

=== 基本信息 ===
场景数：${script.scenes.length} | Shot数：${storyboard?.shots?.length ?? 0} | 总时长：${storyboard?.totalEstimatedDurationSec ?? 0}秒
Hook策略：${script.hookStrategy}
情绪弧：${script.overallEmotionalArc}
最近KPI：${state.kpiHistory.slice(-3).map(k => `E${k.episodeNumber}=${k.overallScore}`).join(', ') || '（无历史）'}
${this.calibration.buildCalibrationHint(state)}
=== 剧本实际内容（审核台词自然度/情感冲击力/节奏） ===
${scriptDetail}

=== 分镜关键镜头（审核视觉冲击力/镜头语言） ===
${shotDetail}

请严格审核以上内容，给出详细评分和问题列表。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const review = typeof root.review === 'object' && root.review ? root.review : root;
    const parsed = episodeReviewSchema.parse(review);
    const result = this.ensureReviewCompleteness(parsed, storyboard);
    const hasCritical = result.issuesFound.some(i => i.severity === 'critical');
    if (result.overallScore < 5.5 || hasCritical) result.overallVerdict = 'major_issues';
    else if (result.overallScore >= 7.5 && !hasCritical && !result.issuesFound.some(i => i.severity === 'moderate')) result.overallVerdict = 'good';
    else result.overallVerdict = 'needs_edit';
    return result;
  }

  /** 构建剧本详情：每场戏的purpose + 完整台词 + 关键动作（限制token量） */
  private buildScriptDetail(script: EpisodeScript): string {
    return script.scenes.map((scene, i) => {
      const header = `场景${i + 1}[${scene.purpose}] ${scene.objective} (${scene.emotionalEntry}→${scene.emotionalExit})`;
      const dialogues = (scene.dialogues ?? []).map(d =>
        `  ${d.characterId}: "${d.text}"${d.parenthetical ? `（${d.parenthetical}）` : ''}`,
      ).join('\n');
      const actions = (scene.actions ?? []).slice(0, 3).map(a =>
        `  [动作] ${a.characterId || '环境'}: ${a.description}`,
      ).join('\n');
      return `${header}\n${dialogues}\n${actions}`;
    }).join('\n---\n');
  }

  /** 构建Shot详情：首场+高潮场+末场的完整描述 + 中间场的关键Shot */
  private buildShotDetail(storyboard: EpisodeStoryboard): string {
    const shots = (storyboard?.shots ?? []).filter((s: any) => !s.isPreview && !s.isFlashback);
    if (shots.length <= 8) {
      return shots.map((s: any) => this.formatShot(s)).join('\n');
    }
    const first3 = shots.slice(0, 3).map((s: any) => this.formatShot(s));
    const mid = shots.slice(3, -3);
    const midDialogue = mid.filter((s: any) => s.dialogue?.text);
    const midSample = midDialogue.slice(0, 4).map((s: any) => this.formatShot(s));
    const last3 = shots.slice(-3).map((s: any) => this.formatShot(s));
    return [
      '【开场镜头】', ...first3,
      `【中段（${mid.length}个shot，抽样${midSample.length}个有台词的）】`, ...midSample,
      '【结尾镜头】', ...last3,
    ].join('\n');
  }

  private formatShot(s: any): string {
    const charInfo = (s.characters ?? []).map((c: any) => `${c.characterId}(${c.emotion})`).join(',');
    return `  shot${s.shotIndex ?? '?'}: ${s.camera?.angle ?? '?'}/${s.camera?.movement ?? 'static'} | ${charInfo} | vis="${(s.visualPrompt ?? '').slice(0, 60)}"${s.dialogue?.text ? ` | 💬"${s.dialogue.text}"` : ''}`;
  }

  private ensureReviewCompleteness(review: EpisodeReview, storyboard: EpisodeStoryboard): EpisodeReview {
    const validShotIds = new Set((storyboard?.shots ?? []).map(s => s.shotId));
    const normalizeRisks = (
      items: Array<{ shotId?: string; reason?: string }> | undefined | null,
    ): Array<{ shotId: string; reason: string }> =>
      (items ?? [])
        .filter(i => i?.shotId && validShotIds.has(i.shotId))
        .map(i => ({ shotId: i.shotId, reason: i.reason || '风险未说明' }));

    const hasConsistencyIssue = review.issuesFound.some(i =>
      i.category === 'visual_continuity' || i.category === 'character_consistency',
    );
    const hasCameraIssue = review.issuesFound.some(i =>
      i.category === 'camera_language' || i.category === 'pacing',
    );

    const consistencyRiskShots = normalizeRisks(review.consistencyRiskShots);
    const cameraReadabilityRiskShots = normalizeRisks(review.cameraReadabilityRiskShots);

    if (hasConsistencyIssue && consistencyRiskShots.length === 0) {
      this.buildFallbackConsistencyRiskShots(storyboard).forEach(item => consistencyRiskShots.push(item));
    }
    if (hasCameraIssue && cameraReadabilityRiskShots.length === 0) {
      this.buildFallbackCameraRiskShots(storyboard).forEach(item => cameraReadabilityRiskShots.push(item));
    }

    const readinessFromIssues = this.clamp(
      review.overallScore
      - review.issuesFound.filter(i => i.severity === 'critical').length * 1.2
      - review.issuesFound.filter(i => i.severity === 'moderate').length * 0.6
      - review.issuesFound.filter(i => i.severity === 'minor').length * 0.2,
      0,
      10,
    );
    const generationReadinessScore = this.clamp(
      typeof review.generationReadinessScore === 'number' ? review.generationReadinessScore : readinessFromIssues,
      0,
      10,
    );

    return {
      ...review,
      generationReadinessScore,
      consistencyRiskShots: consistencyRiskShots.slice(0, 6),
      cameraReadabilityRiskShots: cameraReadabilityRiskShots.slice(0, 6),
    };
  }

  private buildFallbackConsistencyRiskShots(storyboard: EpisodeStoryboard): Array<{ shotId: string; reason: string }> {
    const shots = (storyboard?.shots ?? []).filter(s => s.isMasterShot || (s.characters?.length ?? 0) >= 3);
    return shots.slice(0, 3).map(s => ({
      shotId: s.shotId,
      reason: '主镜/多人同框，角色一致性风险较高',
    }));
  }

  private buildFallbackCameraRiskShots(storyboard: EpisodeStoryboard): Array<{ shotId: string; reason: string }> {
    const riskyMovements = new Set(['whip_pan', 'handheld', 'dolly_zoom', 'orbit', 'tracking']);
    const shots = (storyboard?.shots ?? []).filter(s =>
      riskyMovements.has(s.camera?.movement ?? '') || s.camera?.angle === 'dutch_angle',
    );
    return shots.slice(0, 3).map(s => ({
      shotId: s.shotId,
      reason: '复杂运镜或倾斜构图，镜头可读性风险较高',
    }));
  }

  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }
}
