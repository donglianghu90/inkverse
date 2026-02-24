/**
 * 审阅角色（步骤 3）：
 * 以"第一读者"视角综合评价章节——连续性、可读性、吸引力、角色深度。
 * 新增 characterDepth 维度 + emotional_logic / character_depth 问题类别。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  ChapterReview,
  StoryStateV2,
  chapterReviewSchema,
} from '../schemas/novel-v2.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import {
  REVIEWER_RUBRIC_PLAYBOOK,
  CONTINUITY_BASELINE_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  buildCompactContextV2,
} from '../prompting/novel-playbook-v2';

@Injectable()
export class ReviewerAgent {
  constructor(private readonly llm: LlmService) {}

  async review(
    state: StoryStateV2,
    intent: ChapterIntent,
    draft: ChapterDraft,
  ): Promise<ChapterReview> {
    const context = buildCompactContextV2(state, {
      maxCharacters: 8,
      maxChapterSummaries: 4,
      maxOpenThreads: 8,
    });

    const arcGuidance = intent.characterArcGuidance;
    const mustHints = arcGuidance.arcHints.filter((h) => h.priority === 'must');

    return this.llm.generateStructured({
      taskName: 'chapter-reviewer',
      schema: chapterReviewSchema,
      tags: ['workflow', 'chapter', 'review'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
      },
      systemPrompt: (() => {
        const profile = state.bookPromptProfile;
        const cal = profile.reviewerCalibration;
        const clicheExamples = profile.clichePatterns
          .filter((c) => c.maxPerChapter <= 1)
          .slice(0, 5)
          .map((c) => `"${c.pattern}"`)
          .join('、');

        return `你是一位严格但公正的${profile.generatedForGenre}网文第一读者（目标读者：${profile.generatedForAudience}）。

你的任务是读完这章后，给出综合评价。
不是技术审计，是阅读体验评价。
核心问题：作为付费读者，我想不想看下一章？

评价维度（每项 0-10 分）：
（注意：本题材各维度权重不同，加权后的分数更重要）
- engagement（吸引力）权重${cal.dimensionWeights.engagement}
- pacing（节奏）权重${cal.dimensionWeights.pacing}
- hookStrength（钩子强度）权重${cal.dimensionWeights.hookStrength}
- consistency（一致性）权重${cal.dimensionWeights.consistency}
- proseQuality（文笔质量）权重${cal.dimensionWeights.proseQuality}
- characterDepth（角色深度）权重${cal.dimensionWeights.characterDepth}

本题材打分标准：
高分（9-10）：${cal.scoringAnchors.high}
中等（5-6）：${cal.scoringAnchors.mid}
低分（0-4）：${cal.scoringAnchors.low}

proseQuality 特别说明：
- AI味检测——以下套话频繁出现则扣分：${clicheExamples}
- "讲述多于展示"是最常见的扣分项

本题材专属检查项：
${cal.genreSpecificChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}

总体裁决标准（硬规则）：
- overallScore >= 7.5 且无 critical 问题 → "good"
- overallScore >= 5.5 或有 moderate 问题 → "needs_edit"
- overallScore < 5.5 或有 critical 问题 → "major_issues"

${CONTINUITY_BASELINE_PLAYBOOK}

${CHARACTER_ARC_PLAYBOOK}`;
      })(),
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

本章意图：
- 目标：${intent.goals.join('；')}
- 情绪方向：${intent.emotionDirection}
- 钩子方向：${intent.hookDirection}
- 字数范围：${intent.wordCountRange.min}-${intent.wordCountRange.max}
${mustHints.length > 0 ? `- 必须实现的角色时刻：${mustHints.map((h) => `${h.characterName}——${h.hint}`).join('；')}` : ''}
${arcGuidance.emotionalLogicNotes ? `- 情绪逻辑提醒：${arcGuidance.emotionalLogicNotes}` : ''}

章节草稿：
标题：${draft.title}
正文：
${draft.content}

评审清单（逐项检查）：

硬性检查（违反即 critical）：
□ 禁止出场的角色是否出现了？
□ 字数是否在意图范围内？
□ 角色是否做了超出其能力等级的事？

一致性检查：
□ 角色称呼、外貌描写与角色表是否一致？
□ 场景时间/天气/地点与上章结束场景是否衔接？
□ 势力规矩和等级是否被正确反映？
□ 角色承诺/Flag 是否被无故遗忘？
□ 叙事视角是否一致？

质量检查（最影响得分）：
□ 统计"讲述而非展示"的次数——"他感到XX"式的直述超过3次，proseQuality 扣分。
□ 统计套话出现次数——上下文中"套话黑名单"里的表达，每个超过允许次数则扣分。
□ 对话标签：连续3句以上使用"说"/"道"且无动作标签，proseQuality 扣分。
□ 句式重复：连续3段以"他/她"开头，扣分。
□ 意图要求的 must 级角色时刻是否实现？

strengths 要求：
- 必须列出 1-2 个具体的优点（哪段写得好，为什么好）。
- 禁止空泛鼓励（"整体不错""文笔流畅"不算数）。

suggestedFix 要求：
- 每个 issue 必须给出具体可执行的修改建议。
- 示例："第5段的'他心中一惊'改为具体反应，如手中物品跌落或动作停顿"。`,
      temperature: 0.4,
    });
  }
}
