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
  StoryStateV2,
} from '../schemas/novel-v2.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  EDITOR_DISCIPLINE_PLAYBOOK,
  CONTINUITY_BASELINE_PLAYBOOK,
  PROSE_CRAFT_PLAYBOOK,
  buildCompactContextV2,
} from '../prompting/novel-playbook-v2';

@Injectable()
export class EditorAgent {
  constructor(private readonly llm: LlmService) {}

  async edit(
    state: StoryStateV2,
    intent: ChapterIntent,
    draft: ChapterDraft,
    review: ChapterReview,
  ): Promise<ChapterDraft> {
    const context = buildCompactContextV2(state, {
      maxCharacters: 6,
      maxChapterSummaries: 3,
      maxOpenThreads: 6,
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

        return `你是一位经验丰富的${profile.generatedForGenre}网文编辑。

你的任务是对已有草稿进行精准修改。你不是重写，而是做外科手术：
- 只修改审阅指出的问题
- 保留原文的好部分（审阅列出的 strengths）
- 修改时顺带提升文风——特别是把"讲述"改成"展示"
- 不要为了修改而修改

修改时应用以下写作技法：
${PROSE_CRAFT_PLAYBOOK}

本题材需注意的套话（出现超限则替换）：${clicheList}

${EDITOR_DISCIPLINE_PLAYBOOK}

${CONTINUITY_BASELINE_PLAYBOOK}`;
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
      temperature: 0.65,
    });
  }
}
