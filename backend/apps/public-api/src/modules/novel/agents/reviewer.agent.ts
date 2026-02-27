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
  StoryState,
  chapterReviewSchema,
} from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import {
  CONTINUITY_BASELINE_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  PROSE_CRAFT_PLAYBOOK,
  buildChapterRhythmPlaybook,
  buildCompactContext,
} from '../prompting/novel-playbook';

@Injectable()
export class ReviewerAgent {
  constructor(private readonly llm: LlmService) {}

  async review(
    state: StoryState,
    intent: ChapterIntent,
    draft: ChapterDraft,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterReview> {
    const context = buildCompactContext(state, {
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

核心问题只有一个：作为付费读者，我想不想看下一章？

=== 评价维度（0-10分，加权计算） ===
- engagement（吸引力×${cal.dimensionWeights.engagement}）
- pacing（节奏×${cal.dimensionWeights.pacing}）
- hookStrength（钩子×${cal.dimensionWeights.hookStrength}）
- consistency（一致性×${cal.dimensionWeights.consistency}）
- proseQuality（文笔×${cal.dimensionWeights.proseQuality}）
- characterDepth（角色深度×${cal.dimensionWeights.characterDepth}）

=== 体验级评分锚点（用感受校准分数） ===

翻页欲（engagement最核心的标尺）：
- 9-10: 读到一半忘了呼吸，读完最后一行立刻想看下一章
- 7-8: 一口气读完没走神，但不会为了看下一章熬夜
- 5-6: 中途想看手机，读完可以心安理得放下
- 4以下: 跳着读或直接弃

可记忆性（是否有让你想截图/分享的段落）：
- 有"金句"或名场面（加分）
- 有让人会心一笑的幽默（加分）
- 有让人胸口一紧的瞬间（加分）
- 读完脑子里一片空白，说不出印象最深的情节（扣分）

沉浸度（多久让你忘记这是AI写的）：
- 第一段就入戏 vs 读了几段才进入状态 vs 始终有"被安排"的感觉

proseQuality 文笔质量（重点）：
- 10: 句句有画面，零AI味，展示而非讲述，有金句
- 8: 文笔很好，偶有可优化处
- 6: 过得去但3+处"讲述而非展示"或AI套话
- 4以下: AI味浓重

AI味检测——以下套话频繁出现则扣分：${clicheExamples}
深层AI味更致命：角色对自己情绪过于自知、事件发展过于顺滑、所有角色内心独白像论文、结构过于工整对称。

=== 题材评分锚点 ===
高分（9-10）：${cal.scoringAnchors.high}
中等（5-6）：${cal.scoringAnchors.mid}
低分（0-4）：${cal.scoringAnchors.low}

题材专属检查：
${cal.genreSpecificChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}

=== 反虚高铁律 ===
- overallScore（总分）不超过8.5，除非章节真的接近出版水准。各维度分数同理。
- 锚定标准："还可以"=6，"不错"=7，"很好"=8，"优秀"=8.5，"惊艳"=9，"完美"=10
- 不给安慰分。任何8+的分数都必须在 strengths 中给出具体优秀表现作为依据。

=== 裁决（三档互斥，从上到下匹配第一条即停） ===
- overallScore < 6.0 或有critical级问题 → "major_issues"
- overallScore >= 8.5 且无critical且无moderate → "good"
- 其余情况（6.0-8.4 或存在moderate） → "needs_edit"

${playbooks?.['CONTINUITY_BASELINE_PLAYBOOK'] ?? CONTINUITY_BASELINE_PLAYBOOK}
${playbooks?.['CHARACTER_ARC_PLAYBOOK'] ?? CHARACTER_ARC_PLAYBOOK}
${playbooks?.['PROSE_CRAFT_PLAYBOOK'] ?? PROSE_CRAFT_PLAYBOOK}
${buildChapterRhythmPlaybook(state.seed.targetChapterWordCount ?? 3000)}
${state.bookPromptProfile?.writerGuide ? `\n=== 主题检查 ===\n${state.seed.thematicCore ? `核心命题：${state.seed.thematicCore.centralQuestion}\n本章是否在某个层面触及了核心命题？不需要每章直接讨论，但读者应该能隐约感受到。完全脱离主题的纯过渡章——engagement扣分。` : '（无主题内核，跳过）'}` : ''}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`;
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
- 示例："第5段的'他心中一惊'改为具体反应，如手中物品跌落或动作停顿"。
${(() => {
  const fs = state.feedbackState;
  if (!fs?.lastAnalysis || fs.confidence === 'none') return '';
  const a = fs.lastAnalysis;
  const lines: string[] = ['\n读者反馈审查（额外检查项）：'];
  if (a.bookLevel.neverAgain.length) lines.push(`□ 永久红线（触发即critical）：${a.bookLevel.neverAgain.join('；')}`);
  const painPoints = [...a.bookLevel.coreIssues, ...a.arcLevel.suggestions].filter((s) => s.verdict === 'adopt').map((s) => s.suggestion);
  if (painPoints.length) lines.push(`□ 已确认的读者痛点（出现则moderate）：${painPoints.join('；')}`);
  return lines.length > 1 ? lines.join('\n') : '';
})()}`,
      temperature: 0.4,
    });
  }
}
