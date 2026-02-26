/**
 * 世界提取器（Recorder 拆分 2/3）：
 * 从章节中提取世界状态变化：
 * - 关系增量
 * - 时间线事件
 * - 伏线开合
 * - 势力变化
 * - 角色承诺
 * - 地点/道具细节
 * - 时间流逝
 * - 称呼记录
 * - 场景快照
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { StoryState } from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import { z } from 'zod';
import { buildCompactContext } from '../prompting/novel-playbook';

const worldExtractionSchema = z.object({
  relationshipDeltas: z.array(z.object({
    fromCharacterId: z.string(),
    toCharacterId: z.string(),
    relationType: z.string(),
    strength: z.number().min(-10).max(10),
    status: z.enum(['active', 'historical', 'hidden']).default('active'),
    closeAtChapter: z.number().int().min(1).nullable().default(null),
    evidence: z.string().default(''),
  })).default([]),
  timelineEventDeltas: z.array(z.object({
    eventType: z.string(),
    title: z.string(),
    summary: z.string(),
    locationId: z.string().nullable().default(null),
    characterIds: z.array(z.string()).default([]),
    prerequisiteEventIds: z.array(z.string()).default([]),
    consequenceThreadIds: z.array(z.string()).default([]),
  })).default([]),
  plotThreadDeltas: z.array(z.object({
    threadId: z.string(),
    label: z.string(),
    action: z.enum(['open', 'touch', 'payoff', 'expire']),
    plannedPayoffStartChapter: z.number().int().min(1).nullable().default(null),
    plannedPayoffEndChapter: z.number().int().min(1).nullable().default(null),
    relatedCharacterIds: z.array(z.string()).default([]),
    relatedLocationIds: z.array(z.string()).default([]),
    relatedItemIds: z.array(z.string()).default([]),
    notes: z.string().default(''),
  })).default([]),
  factionDeltas: z.array(z.object({
    action: z.enum(['create', 'member_join', 'member_leave', 'rank_change', 'relation_change', 'update']),
    factionId: z.string(),
    factionName: z.string().optional(),
    factionType: z.string().optional(),
    description: z.string().optional(),
    characterId: z.string().optional(),
    rank: z.string().optional(),
    targetFactionId: z.string().optional(),
    relationType: z.enum(['alliance', 'rivalry', 'war', 'subsidiary', 'neutral', 'trade', 'vassal']).optional(),
    relationStrength: z.number().min(-10).max(10).optional(),
  })).optional(),
  commitmentDeltas: z.array(z.object({
    action: z.enum(['create', 'fulfill', 'break', 'progress', 'expire']),
    commitmentId: z.string(),
    characterId: z.string(),
    type: z.enum(['vow', 'promise', 'threat', 'self_restriction', 'goal', 'debt', 'prophecy']).optional(),
    content: z.string().optional(),
    targetCharacterId: z.string().optional(),
    deadline: z.string().optional(),
  })).optional(),
  timeDelta: z.object({
    daysElapsed: z.number().int().nonnegative().default(0),
    endTimeOfDay: z.enum(['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'evening', 'night', 'late_night']).optional(),
    seasonChange: z.enum(['spring', 'summer', 'autumn', 'winter']).optional(),
    calendarNote: z.string().optional(),
  }).optional(),
  addressDeltas: z.array(z.object({
    fromCharacterId: z.string(),
    toCharacterId: z.string(),
    address: z.string(),
    context: z.string().optional(),
  })).optional(),
  sceneSnapshot: z.object({
    locationId: z.string().optional(),
    locationName: z.string().optional(),
    timeOfDay: z.string().optional(),
    weather: z.string().optional(),
    presentCharacterIds: z.array(z.string()).default([]),
    ongoingAction: z.string().optional(),
    emotionalTone: z.string().optional(),
  }).optional(),
  locationProfileDeltas: z.array(z.object({
    locationId: z.string(),
    field: z.enum(['terrain', 'climate', 'sensory', 'architecture', 'culture', 'history', 'connection']),
    description: z.string(),
  })).optional(),
  itemProfileDeltas: z.array(z.object({
    itemId: z.string(),
    field: z.enum(['appearance', 'origin', 'limitation', 'evolution']),
    description: z.string(),
  })).optional(),
});

export type WorldExtraction = z.infer<typeof worldExtractionSchema>;

@Injectable()
export class WorldExtractorAgent {
  constructor(private readonly llm: LlmService) {}

  async extract(
    state: StoryState,
    draft: ChapterDraft,
    additionalSystemPrompt?: string,
  ): Promise<WorldExtraction> {
    const context = buildCompactContext(state, {
      maxCharacters: 8,
      maxChapterSummaries: 3,
      maxOpenThreads: 10,
      maxTimelineEvents: 10,
    });

    const charIds = state.characters.map((c) => c.id);
    const locIds = state.locations.map((l) => l.id);

    return this.llm.generateStructured({
      taskName: 'world-extractor',
      schema: worldExtractionSchema,
      tags: ['workflow', 'chapter', 'record', 'world'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是世界状态提取专家。从章节正文中提取所有世界状态变化。

专注于：
1. 关系增量：角色之间关系的建立/变化/消失（注意隐含的态度变化，不只是显式表白）
2. 时间线事件：本章发生的重要事件
3. 伏线开合：新伏线、伏线推进、伏线回收
4. 势力变化：组织/势力的创建、成员变动、关系变化
5. 角色承诺：誓言/承诺/威胁/自我限制的创建/兑现/打破。特别注意：
   - 角色说"我发誓……""等我……一定……""我欠你一条命"等是承诺
   - "你最好祈祷……""下次见面我会……"等是威胁
   - 这些对后续剧情至关重要，不要遗漏
6. 时间流逝：故事内时间变化
7. 称呼记录：角色间新的或改变的称呼（称呼变化往往标志关系转折）
8. 场景快照（重要——下一章开头要承接）：本章结束时的物理现场+情绪氛围
   - emotionalTone 要具体："紧张的沉默""劫后余生的疲惫和庆幸"，不要只写"紧张"
9. 地点/道具细节：新发现的环境或物品信息

规则：
- 只记录正文中明确出现的，不推测
- 伏线标签必须具体稳定，复用已有 threadId
- 关系增量必须包含双方角色编号${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `已有角色编号：${JSON.stringify(charIds)}
已有地点编号：${JSON.stringify(locIds)}

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
