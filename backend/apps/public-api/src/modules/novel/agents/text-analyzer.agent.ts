/**
 * 文本分析器（Recorder 拆分 1/3）：
 * 从章节中提取基础文本信息：
 * - 章节摘要
 * - 新角色/地点/道具发现
 * - 角色生命周期变更
 * - 角色档案细节（外貌/服饰/能力）
 * - 角色声音样本
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { StoryState } from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import { z } from 'zod';
import {
  newCharacterSchema,
  newLocationSchema,
  newItemSchema,
  characterLifecycleStatusSchema,
  narrativeImportanceSchema,
} from '../schemas/novel.schemas';
import { buildCompactContext } from '../prompting/novel-playbook';

const textAnalysisSchema = z.object({
  chapterNumber: z.number().int().positive(),
  summary: z.string(),
  newCharacters: z.array(newCharacterSchema).default([]),
  newLocations: z.array(newLocationSchema).default([]),
  newItems: z.array(newItemSchema).default([]),
  characterLifecycleDeltas: z.array(z.object({
    characterId: z.string(),
    lifecycleStatus: characterLifecycleStatusSchema.optional(),
    locationId: z.string().nullable().optional(),
    stateText: z.string().optional(),
    level: z.number().int().nonnegative().optional(),
    addInventoryItemIds: z.array(z.string()).default([]),
    removeInventoryItemIds: z.array(z.string()).default([]),
    plannedReturnChapter: z.number().int().positive().nullable().optional(),
    narrativeImportance: narrativeImportanceSchema.optional(),
    dormantReference: z.boolean().optional(),
    evidence: z.string().default(''),
  })).default([]),
  characterProfileDeltas: z.array(z.object({
    characterId: z.string(),
    field: z.enum([
      'appearance', 'outfit', 'hairstyle', 'ability_gain',
      'ability_upgrade', 'injury', 'personality_shift',
      'hobby_discovered', 'backstory_revealed',
    ]),
    description: z.string(),
    isChange: z.boolean().default(false),
  })).optional(),
  characterVoiceDeltas: z.array(z.object({
    characterId: z.string(),
    sampleDialogue: z.string(),
    speechPatternNote: z.string().optional(),
    verbalTic: z.string().optional(),
  })).optional(),
  characterAliasDeltas: z.array(z.object({
    characterId: z.string(),
    alias: z.string(),
    action: z.enum(['add', 'remove']),
    evidence: z.string().default(''),
  })).optional(),
  characterFactDeltas: z.array(z.object({
    characterId: z.string(),
    fact: z.string(),
    category: z.enum([
      'identity', 'motivation', 'ability', 'secret',
      'habit', 'speech_style', 'taboo', 'goal',
      'belief', 'history', 'relationship',
    ]),
    action: z.enum(['add', 'confirm', 'deprecate']).default('add'),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.string().default(''),
  })).optional(),
});

export type TextAnalysis = z.infer<typeof textAnalysisSchema>;

@Injectable()
export class TextAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(
    state: StoryState,
    draft: ChapterDraft,
    additionalSystemPrompt?: string,
  ): Promise<TextAnalysis> {
    const context = buildCompactContext(state, {
      maxCharacters: 10,
      maxChapterSummaries: 3,
      maxOpenThreads: 6,
    });

    const existingCharNames = state.characters.map((c) => c.name);
    const existingLocIds = state.locations.map((l) => l.id);
    const existingItemIds = state.items.map((i) => i.id);

    return this.llm.generateStructured({
      taskName: 'text-analyzer',
      schema: textAnalysisSchema,
      tags: ['workflow', 'chapter', 'record', 'text'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是文本分析专家。从章节正文中提取客观事实。

专注于：
1. 摘要：简洁客观的章节摘要（2-3句话），包含关键事件和情绪转折
2. 新实体发现：正文中出现的新角色/地点/道具
3. 角色状态变更：已有角色的位置、等级、状态变化
4. 角色档案：外貌/服饰/能力的具体描写
5. 角色声音提取（重要！为后续章节的对白一致性服务）：
   - 选择最能体现角色个性的2-3句对白原文
   - speechPatternNote：概括此人说话的风格特征（如"简短果断""慢条斯理带文言腔""粗犷直白"）
   - verbalTic：口头禅/习惯用语（如"老子""阿弥陀佛""有趣"）
6. 角色别名/事实增量

规则：
- 只记录正文中明确描写的，不要推测
- 新角色必须有实际动作或对白，路人不注册
- 摘要禁止赞美性语言
- id 格式：角色 char_xxx、地点 loc_xxx、道具 item_xxx${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `已有角色姓名：${JSON.stringify(existingCharNames)}
已有地点编号：${JSON.stringify(existingLocIds)}
已有道具编号：${JSON.stringify(existingItemIds)}

故事上下文：
${JSON.stringify(context, null, 2)}

本章正文：
章节号：${draft.chapterNumber}
标题：${draft.title}
正文：
${draft.content}`,
      temperature: 0.3,
    });
  }
}
