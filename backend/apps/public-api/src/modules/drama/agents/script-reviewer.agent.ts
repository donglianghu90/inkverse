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

const reviewOutputSchema = z.object({ review: episodeReviewSchema });

@Injectable()
export class ScriptReviewerAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

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
      userPrompt: `审核第 ${script.episodeNumber} 集：

=== 基本信息 ===
场景数：${script.scenes.length} | Shot数：${storyboard.shots.length} | 总时长：${storyboard.totalEstimatedDurationSec}秒
Hook策略：${script.hookStrategy}
情绪弧：${script.overallEmotionalArc}
最近KPI：${state.kpiHistory.slice(-3).map(k => `E${k.episodeNumber}=${k.overallScore}`).join(', ') || '（无历史）'}
${this.buildCalibrationHint(state)}
=== 剧本实际内容（审核台词自然度/情感冲击力/节奏） ===
${scriptDetail}

=== 分镜关键镜头（审核视觉冲击力/镜头语言） ===
${shotDetail}

请严格审核以上内容，给出详细评分和问题列表。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const review = typeof root.review === 'object' && root.review ? root.review : root;
    const result = episodeReviewSchema.parse(review);
    const hasCritical = result.issuesFound.some(i => i.severity === 'critical');
    if (result.overallScore < 5.5 || hasCritical) result.overallVerdict = 'major_issues';
    else if (result.overallScore >= 7.5 && !hasCritical && !result.issuesFound.some(i => i.severity === 'moderate')) result.overallVerdict = 'good';
    else result.overallVerdict = 'needs_edit';
    return result;
  }

  private buildCalibrationHint(state: DramaState): string {
    const patterns = (state.recentIssuePatterns ?? []).filter(p => p.status === 'active' && p.occurrences >= 2);
    if (!patterns.length) return '';
    const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5);
    const lines = ['=== 自校准警示（近期高频问题，审核时重点关注）==='];
    for (const p of sorted) lines.push(`⚠ [${p.dimension}] ${p.pattern.split(':').slice(1).join(':')}（已出现${p.occurrences}次）`);
    return lines.join('\n');
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
    const shots = storyboard.shots.filter((s: any) => !s.isPreview && !s.isFlashback);
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
}
