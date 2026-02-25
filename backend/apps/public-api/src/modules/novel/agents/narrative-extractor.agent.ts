/**
 * 叙事提取器（Recorder 拆分 3/3）：
 * 从章节中提取高层叙事元素：
 * - 读者悬念追踪
 * - 信息差追踪
 * - 爽感事件
 * - 伏笔回溯机会
 * - 钩子分类
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { StoryState } from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import { z } from 'zod';
import { buildCompactContext } from '../prompting/novel-playbook';

const narrativeExtractionSchema = z.object({
  curiosityDeltas: z.array(z.object({
    action: z.enum(['seed', 'tease', 'payoff']),
    curiosityId: z.string(),
    question: z.string().optional(),
    satisfactionType: z.enum(['full_answer', 'partial_reveal', 'twist', 'subversion']).optional(),
  })).optional(),
  informationGapDeltas: z.array(z.object({
    action: z.enum(['create', 'reveal', 'expand']),
    gapId: z.string(),
    secret: z.string().optional(),
    knownBy: z.array(z.string()).optional(),
    unknownTo: z.array(z.string()).optional(),
    type: z.enum([
      'dramatic_irony', 'mystery', 'betrayal_setup',
      'hidden_identity', 'secret_plan', 'misunderstanding',
    ]).optional(),
    dramaticPotential: z.enum(['low', 'medium', 'high', 'explosive']).optional(),
  })).optional(),
  satisfactionEvents: z.array(z.object({
    type: z.string(),
    intensity: z.enum(['minor', 'medium', 'major', 'climactic']),
    scale: z.enum([
      'personal', 'group', 'faction', 'regional',
      'national', 'continental', 'world',
    ]).default('personal'),
    description: z.string(),
    audienceImpact: z.string().optional(),
  })).optional(),
  foreshadowingOpportunities: z.array(z.object({
    targetChapterNumber: z.number().int().positive(),
    insertionType: z.enum(['sentence', 'paragraph', 'inner_thought', 'background_detail']),
    suggestedContent: z.string(),
    insertAfterParagraph: z.number().int().nonnegative(),
    reason: z.string(),
  })).optional(),
  hookClassification: z.object({
    hookType: z.string(),
    hookSummary: z.string(),
  }).optional(),
  openLoops: z.array(z.string()).default([]),
  closedLoops: z.array(z.string()).default([]),
  stateChanges: z.array(z.string()).default([]),
  knowledgeFragments: z.array(z.string()).default([]),
});

export type NarrativeExtraction = z.infer<typeof narrativeExtractionSchema>;

@Injectable()
export class NarrativeExtractorAgent {
  constructor(private readonly llm: LlmService) {}

  async extract(
    state: StoryState,
    draft: ChapterDraft,
    additionalSystemPrompt?: string,
  ): Promise<NarrativeExtraction> {
    const profile = state.bookPromptProfile;
    const satisfactionTypes = profile.satisfactionTypes
      .map((s) => `${s.id}(${s.label}): ${s.description}`).join('\n');
    const hookTypes = profile.hookTypes
      .map((h) => `${h.id}(${h.label}): ${h.description}`).join('\n');

    const context = buildCompactContext(state, {
      maxCharacters: 6,
      maxChapterSummaries: 3,
      maxOpenThreads: 8,
    });

    return this.llm.generateStructured({
      taskName: 'narrative-extractor',
      schema: narrativeExtractionSchema,
      tags: ['workflow', 'chapter', 'record', 'narrative'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是叙事结构分析专家。从章节中提取高层叙事元素——你的工作直接决定后续章节能否利用好悬念和信息差。

1. 读者悬念（curiosityDeltas）：
   - seed: 正文中抛出的新谜团/问题——注意隐含的悬念（"他的来历""那个封印的真正目的"）
   - tease: 对已有悬念的暗示/线索推进
   - payoff: 悬念被回答。satisfactionType很重要：
     * full_answer = 完全揭晓
     * partial_reveal = 部分揭晓，引出更深的问题
     * twist = 答案本身是意外
     * subversion = 问题本身被证明是错误的

2. 信息差（informationGapDeltas）——上瘾的核心武器：
   - create: 新的信息不对称。准确标注谁知道谁不知道。
   - reveal: 信息差消除（角色发现了真相）
   - expand: 信息差扩大（更多人被蒙在鼓里，或秘密更重大了）
   - dramaticPotential 判断标准：这个信息差被揭晓时读者会有多震惊？

3. 爽感事件（satisfactionEvents）：
   ${satisfactionTypes}
   - 不是每章都有，铺垫章可以没有
   - audienceImpact 要写读者的情绪反应，不是事件描述

4. 伏笔回溯机会（foreshadowingOpportunities）：
   如果本章有重大揭晓，检查是否有机会在早期章节补伏笔。每章最多1个。

5. 钩子分类（hookClassification）：
   ${hookTypes}

6. 开环/闭环/状态变化/知识碎片${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

当前读者悬念：
${JSON.stringify(state.readerTension ?? { activeCuriosities: [] }, null, 2)}

当前信息差：
${JSON.stringify((state.informationLedger ?? { activeGaps: [] }).activeGaps, null, 2)}

本章正文：
章节号：${draft.chapterNumber}
标题：${draft.title}
正文：
${draft.content}`,
      temperature: 0.35,
    });
  }
}
