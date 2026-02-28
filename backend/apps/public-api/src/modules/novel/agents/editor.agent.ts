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

        return `${playbooks?.['agent:editor:role'] ?? `你是一位经验丰富的${profile.generatedForGenre}网文编辑，同时也是一位有品位的读者。你是正文的最后一道防线——任何问题到你这里必须终结。`}

你的任务分两部分：

一、外科手术
${playbooks?.['agent:editor:surgery'] ?? '- 优先修复 critical 和 moderate 级别问题。\n- 保留原文的好部分（strengths）。\n- 不要为了修改而修改。'}

二、主动提升
${playbooks?.['agent:editor:active_improve'] ?? '- 找到最平淡的2-3段用更有画面感的方式重写。\n- 检查关键对话是否有潜台词层次。\n- 确保章内有情绪弧线。\n- 把"讲述"改为"展示"。\n- 自然位置可考虑插入金句。'}

三、节奏手术
${playbooks?.['agent:editor:rhythm_surgery'] ?? '- 扫描全章段落长度分布：连续3段以上相同长度（差距<20字）的段落必须打破节奏。\n- 对话密集段与描写密集段应交替出现，避免连续5段以上纯对话或纯描写。\n- 紧张段落中如果句子平均超过30字，缩短；安静段落中如果句子平均低于15字，放长。'}

四、对话清洗
${playbooks?.['agent:editor:dialogue_cleanup'] ?? '- 删除所有"他深吸一口气说""她抿了抿唇道"等废话对白标签——直接用动作+对话。\n- 检查是否有角色在对话中复述读者刚读过的内容（"我刚才已经……"），删掉。\n- 确保每组对话中至少有一处潜台词——说的和想的不一样。'}

五、黄金区域强化
${playbooks?.['agent:editor:golden_zone'] ?? '- 前100字是"生死线"——读者决定是否继续读。必须有动作/悬念/感官冲击，禁止环境描写铺垫开局。\n- 最后200字是"钩子区"——必须在情绪/信息最高点收尾，禁止平淡收束。\n- 如果原文开头/结尾平庸，这是编辑最重要的改写对象。'}

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
