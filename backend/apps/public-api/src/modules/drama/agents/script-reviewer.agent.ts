/**
 * 剧本审核员 — 审核最终分镜板的质量，产出 EpisodeReview（评分+问题列表）。
 * 决定是否 pass / needs_edit / major_issues。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeReviewSchema, EpisodeReview, EpisodeStoryboard, EpisodeScript,
  DramaState, DramaPromptProfile,
} from '../schemas/drama-state.schemas';

const reviewOutputSchema = z.object({ review: episodeReviewSchema });

@Injectable()
export class ScriptReviewerAgent {
  constructor(private readonly llm: LlmService) {}

  async review(
    state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard,
  ): Promise<EpisodeReview> {
    const profile = state.promptProfile;
    const weights = profile?.reviewerCalibration?.dimensionWeights;
    const genreChecks = profile?.reviewerCalibration?.genreSpecificChecks;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-reviewer',
      schema: reviewOutputSchema,
      systemPrompt: `你是短剧质量审核员。你的任务是用严格标准评估本集质量。

=== 评分维度（0-10分） ===
1. visualImpact (权重${weights?.visualImpact ?? 1.2})：画面冲击力 — 镜头语言是否有张力？关键时刻是否用了对的镜头？
2. dialogueNaturalness (权重${weights?.dialogueNaturalness ?? 1.2})：台词自然度 — 是否像真人说的话？是否符合角色性格？
3. pacing (权重${weights?.pacing ?? 1.0})：节奏紧凑度 — 是否有拖沓？高潮是否在对的位置？
4. hookStrength (权重${weights?.hookStrength ?? 1.3})：悬念强度 — 集末钩子是否让人想看下一集？
5. consistency (权重${weights?.consistency ?? 1.0})：连续性 — 与前几集是否连贯？角色行为是否一致？
6. emotionalImpact (权重${weights?.emotionalImpact ?? 1.0})：情感冲击力 — 是否触动观众情绪？

=== overallScore 计算 ===
加权平均：sum(dimension * weight) / sum(weights)

=== overallVerdict ===
- good (≥7.5)：质量合格，可直接使用
- needs_edit (5.5-7.5)：需要精修但结构OK
- major_issues (<5.5)：结构性问题，需要重写

=== issuesFound ===
按 category 分类，severity 标注严重程度（critical = 必修，moderate = 建议修，minor = 小问题）

${genreChecks?.length ? `=== 题材专项检查 ===\n${genreChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

请严格但公正地评估。`,

      userPrompt: `审核第 ${script.episodeNumber} 集：

剧本场景数：${script.scenes.length}
分镜Shot数：${storyboard.shots.length}
总时长：${storyboard.totalEstimatedDurationSec}秒
剧本Hook策略：${script.hookStrategy}
情绪弧：${script.overallEmotionalArc}

最近KPI：${state.kpiHistory.slice(-3).map(k => `E${k.episodeNumber}=${k.overallScore}`).join(', ') || '（无历史）'}

剧本摘要：
${script.scenes.map(s => `[${s.purpose}] ${s.objective}`).join('\n')}

分镜摘要：
${storyboard.shots.slice(0, 5).map(s => `shot${s.shotIndex}: ${s.camera.angle}/${s.camera.movement} — ${s.visualPrompt.slice(0, 40)}...`).join('\n')}
...共${storyboard.shots.length}个镜头

请给出详细审核报告。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const review = typeof root.review === 'object' && root.review ? root.review : root;
    return episodeReviewSchema.parse(review);
  }
}
