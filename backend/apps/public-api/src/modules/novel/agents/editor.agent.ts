/**
 * 编辑角色（步骤 4）：
 * 根据审阅意见做精准手术 + 顺带润色。
 * 合并了旧的 PatchRewriter + StyleDirector。
 * 只在审阅发现问题时调用，可跳过。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  ChapterReview,
  StoryState,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  EDITOR_DISCIPLINE_PLAYBOOK,
  CONTINUITY_BASELINE_PLAYBOOK,
  PROSE_CRAFT_PLAYBOOK,
  buildCompactContext,
} from '../prompting/novel-playbook';

@Injectable()
export class EditorAgent {
  constructor(private readonly llm: LlmService) {}

  async edit(
    state: StoryState,
    intent: ChapterIntent,
    draft: ChapterDraft,
    review: ChapterReview,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterDraft> {
    const context = buildCompactContext(state, {
      maxCharacters: 8,
      maxChapterSummaries: 5,
      maxOpenThreads: 8,
    });

    const issuesSummary = review.issuesFound
      .map((issue, i) => `${i + 1}. [${issue.severity}/${issue.category}] ${issue.description}\n   建议修改：${issue.suggestedFix}`)
      .join('\n');

    return this.llm.generateStructured({
      taskName: 'chapter-editor',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'edit'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
        issueCount: review.issuesFound.length,
        reviewVerdict: review.overallVerdict,
      },
      systemPrompt: (() => {
        const profile = state.bookPromptProfile;
        const clicheList = profile.clichePatterns
          .filter((c) => c.maxPerChapter <= 1)
          .map((c) => `"${c.pattern}"`)
          .slice(0, 8)
          .join('、');

        return `你是一位经验丰富的${profile.generatedForGenre}网文编辑，同时也是一位有品位的读者。

你的任务分两部分：

一、外科手术——修复审阅指出的问题
- 优先修复 critical 和 moderate 级别问题。
- 保留原文的好部分（审阅列出的 strengths）。
- 不要为了修改而修改。

二、主动提升——让"正确但平庸"的段落变得有力量
即使审阅没有指出问题，你也应该：
- 找到最平淡的2-3段，用更有画面感/感官更丰富的方式重新表达。
- 检查关键对话是否有"潜台词"层次——太直白的对话加入弦外之音。
- 确保章内有情绪弧线（从A情绪到B情绪），如果情绪平坦，增加微波动。
- 把"讲述"改为"展示"：每个"他感到XX"都改为具体的动作/感官/细节。
- 如果发现自然契合的位置，可以考虑插入一句"金句"——简短有力、有态度。但不要为了金句而强行制造，自然为先。

写作技法参考：
${playbooks?.['PROSE_CRAFT_PLAYBOOK'] ?? PROSE_CRAFT_PLAYBOOK}

套话替换清单：${clicheList}

=== 题材专属规则 ===
${profile.writerGuide.genreRules.slice(0, 4).map((r, i) => `${i + 1}. ${r}`).join('\n')}
${profile.writerGuide.craftExamples.length > 0 ? `\n=== 正反例参考 ===\n${profile.writerGuide.craftExamples.slice(0, 2).map((e) => `坏：${e.bad}\n好：${e.good}\n规则：${e.rule}`).join('\n\n')}` : ''}

${playbooks?.['EDITOR_DISCIPLINE_PLAYBOOK'] ?? EDITOR_DISCIPLINE_PLAYBOOK}
${playbooks?.['CONTINUITY_BASELINE_PLAYBOOK'] ?? CONTINUITY_BASELINE_PLAYBOOK}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`;
      })(),
      userPrompt: `故事上下文（精简）：
${JSON.stringify(context, null, 2)}

本章意图：
- 目标：${intent.goals.join('；')}
- 钩子方向：${intent.hookDirection}
- 字数范围：${intent.wordCountRange.min}-${intent.wordCountRange.max}

审阅评价（总分 ${review.overallScore}，裁决：${review.overallVerdict}）：

优点（请保留）：
${review.strengths.join('\n')}

需要修改的问题：
${issuesSummary}

原始草稿：
标题：${draft.title}
正文：
${draft.content}

请输出修改后的完整章节（标题 + 正文）。
- 章节号必须保持 ${draft.chapterNumber} 不变。
- 字数必须在 ${intent.wordCountRange.min}-${intent.wordCountRange.max} 范围内。
- 不得削弱原文优点。
- 优先修复 critical 和 moderate 级别问题。`,
      temperature: 0.55,
    });
  }
}
