/**
 * 意图角色（步骤 1）：
 * 为下一章设定轻量方向——目标、情绪、钩子、伏线指引、角色弧线指引。
 * 兼任"人物塑造师"视角：识别扁平化角色、规划成长节点、守护情绪逻辑。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  StoryStateV2,
  chapterIntentSchema,
} from '../schemas/novel-v2.schemas';
import {
  THREAD_AWARENESS_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  FIRST_CHAPTERS_V2_PLAYBOOK,
  buildCompactContextV2,
  buildCharacterArcContext,
  buildKpiTrendHintsV2,
} from '../prompting/novel-playbook-v2';

@Injectable()
export class IntentAgent {
  constructor(private readonly llm: LlmService) {}

  async buildIntent(state: StoryStateV2): Promise<ChapterIntent> {
    const chapterNumber = state.chapterCursor;
    const context = buildCompactContextV2(state, {
      maxCharacters: 10,
      maxChapterSummaries: 5,
      maxOpenThreads: 10,
      maxTimelineEvents: 12,
    });

    const isEarly = chapterNumber <= 3;
    const kpiHints = buildKpiTrendHintsV2(state);
    const characterArcAnalysis = buildCharacterArcContext(state);
    const dynamicParts: string[] = [];
    if (isEarly) dynamicParts.push(FIRST_CHAPTERS_V2_PLAYBOOK);
    if (kpiHints.length > 0) dynamicParts.push('动态提示：\n' + kpiHints.join('\n'));

    const plotThreadLedger = state.plotThreadLedger ?? [];
    const openThreads = plotThreadLedger.filter((t) => t.status === 'open');
    const overdueThreads = openThreads.filter(
      (t) => t.plannedPayoffEndChapter !== null && chapterNumber > t.plannedPayoffEndChapter,
    );

    const blockedIds = state.characters
      .filter((c) => {
        const lc = c.status.lifecycleStatus ?? 'active';
        const canRef = c.status.dormantReference ?? false;
        return ((lc === 'dead' || lc === 'exited') && !canRef) || (lc === 'dormant' && !canRef);
      })
      .map((c) => c.id);

    const foreshadowOnly = state.characters
      .filter((c) => {
        const lc = c.status.lifecycleStatus ?? 'active';
        const planned = c.status.plannedReturnChapter ?? null;
        return lc === 'return_planned' && planned !== null && planned > chapterNumber;
      })
      .map((c) => c.id);

    const activeIds = state.characters
      .filter((c) => !blockedIds.includes(c.id) && !foreshadowOnly.includes(c.id))
      .map((c) => c.id);

    const charsWithWarnings = characterArcAnalysis.filter(
      (c) => c['弧线预警'] !== undefined,
    );

    return this.llm.generateStructured({
      taskName: 'chapter-intent',
      schema: chapterIntentSchema,
      tags: ['workflow', 'chapter', 'intent'],
      metadata: { bookId: state.bookId, chapterNumber },
      systemPrompt: `你是一位经验丰富的网文大纲师，同时兼任"人物塑造师"的视角。
你的任务是为下一章设定一个轻量的方向指引，同时关注角色的成长弧线和情绪逻辑。

关键原则：
- 不要过度规划。给 2-3 个明确目标就够了，具体怎么写留给写手决定。
- 目标要有冲突感和推进感，不能是平铺直叙的描述。
- 钩子方向是"大致方向"，不是精确的钩子短语。
- 关注伏线平衡：逾期伏线要优先处理。
- characterAvailability 必须准确：死亡/退场角色绝对不能出现在 activeCharacterIds 中。

卷节奏职责（如果有当前卷计划）：
- 上下文中有"当前卷计划"时，本章目标必须服从卷节拍的角色定位和张力等级。
- 如果节拍是 setup，目标应侧重铺垫和引入，不要提前进入高潮。
- 如果节拍是 climax，目标必须有一个明确的大爽点。
- 如果节拍是 relief/aftermath，允许节奏放缓，安排日常/感情/搞笑内容。
- emotionDirection 要和节拍的张力等级匹配。

角色弧线职责（重要）：
- 检查哪些角色需要"深度时刻"——不是每个角色每章都需要，但不能连续太多章只是功能性出场。
- focusCharacterIds: 本章需要重点刻画内心的角色（1-2 个就够，不是全部角色）。
- arcHints: 给每个聚焦角色一个具体的弧线提示（例如："展示他对父亲的矛盾情感"、"在压力下暴露真实性格"）。
- priority: must = 本章必须有这个角色的深度时刻；should = 最好有；could = 如果自然出现就好。
- emotionalLogicNotes: 检查上章结尾的情绪状态，标注本章需要注意的情绪逻辑（例如："主角上章目睹师父被杀，本章开头不可能平静"）。

读者悬念管理职责（重要）：
- 上下文中有"读者悬念"列表时，你必须据此决策：
- "overdue" 悬念（15章以上未回答）：本章 goals 中必须包含一个揭晓/推进目标，读者等太久会流失。
- "boiling" 悬念（8-15章）：本章至少要 tease 一下，让读者知道作者没忘。
- chaptersSinceLastPayoff >= 5：必须在本章安排至少一个小揭晓，连续 5 章没有爽点读者会弃书。
- 不要一次揭晓太多悬念（每章最多回答 1-2 个），保持悬念存量在 3-7 个之间。
- hookDirection 应该考虑种下新的读者好奇点，让悬念总量不会清零。
- 揭晓时机应配合卷节拍：climax 章适合 full_answer/twist，setup 章适合 seed/tease。

信息差利用职责（上瘾核心）：
- 上下文中有"信息差"列表时，你必须利用它制造戏剧张力：
- dramatic_irony 型（读者知道角色不知道）：安排"角色差点发现真相"的场景——越接近越刺激。
- mystery 型（读者也不知道）：安排线索碎片让读者拼图，每次给一小块。
- betrayal_setup 型：创造表面信任的温馨场景——越甜蜜，将来的背刺越痛。
- explosive 级信息差：不要急着揭晓，至少再憋 3-5 章，让张力充分积累。
- 每章最多利用 1-2 个信息差，不要贪多。
- 信息差的利用不需要写在 goals 里，而是影响你对场景安排的判断。

角色承诺管理职责（防止角色"健忘"——极其重要）：
- 上下文中有"角色承诺/Flag"列表时，你必须据此决策：
- "overdue" 承诺（超过期限还没兑现）：本章 goals 中必须包含推进或兑现的目标——读者会注意角色立过的 flag。
- "imminent" 承诺（快到期限）：本章应制造承诺相关的紧张感或推进。
- 长期承诺（10章+未推进）：至少应安排一个场景提及或暗示这个承诺还在。
- 承诺兑现或打破是重要的戏剧时刻——应配合卷节拍的 climax 或 twist。
- 不要一次性清算太多承诺，每章最多推进 1-2 个。

势力冲突意识（如果有势力数据）：
- 上下文中有"势力表"时，角色互动要考虑势力关系和等级差异。
- 敌对势力的角色碰面是天然的冲突源。
- 同一势力内的等级差异影响称呼和互动方式。

爽感调度职责（多巴胺管理——极其重要）：
- 上下文中有"爽感调度"数据时，你必须据此保证爽点频率：
- chaptersSinceMinor >= 3：本章必须安排至少一个小爽点（打脸、小升级、获认可）。
- chaptersSinceMedium >= 8：本章必须安排一个中等爽点（亮底牌、关键揭秘、复仇得手）。
- chaptersSinceMajor >= 25：必须尽快规划一个大爽点（可以放在下一个 climax 章）。
- 铺垫章（setup）可以没有爽点，但连续 3 章 setup 之后必须有 payoff。
- 爽感类型要多样化：不能连续 3 次都是"打脸"，要交替使用不同类型。
- 爽点不是生硬插入的——它必须是故事推进的自然结果。

爽感升级曲线（极其重要——让读者觉得"越来越精彩"）：
- 爽感不只看频率，还看规模。currentStageScale 表示当前故事阶段的爽感规模：
  - personal(个人)→group(小团体)→faction(势力级)→regional(区域级)→national(国级)→continental(大陆级)→world(世界级)
- 规模升级的节奏：每 20-30 章，爽感规模应该上一个台阶。
  - 第 1-20 章：打脸同龄人（personal）
  - 第 21-50 章：在势力内崭露头角（group/faction）
  - 第 51-100 章：在更大的舞台上证明自己（regional/national）
- 降级是允许的（大战后回到个人层面休整），但趋势必须向上。
- 如果 peakScaleReached 已经是 faction 级，下一个大爽点的规模至少要达到 faction 级。
- 每次规模升级本身就是一个大爽点——读者会感受到"世界在变大"。

${THREAD_AWARENESS_PLAYBOOK}

${CHARACTER_ARC_PLAYBOOK}
${dynamicParts.length > 0 ? '\n' + dynamicParts.join('\n\n') : ''}`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

角色弧线分析：
${JSON.stringify(characterArcAnalysis, null, 2)}
${charsWithWarnings.length > 0 ? '\n⚠️ 以下角色有弧线预警：\n' + JSON.stringify(charsWithWarnings, null, 2) : ''}

读者悬念状态：
${JSON.stringify(state.readerTension ?? { activeCuriosities: [], recentPayoffs: [], chaptersSinceLastPayoff: 0 }, null, 2)}

信息差状态：
${JSON.stringify((state.informationLedger ?? { activeGaps: [] }).activeGaps.map((g) => ({ id: g.id, secret: g.secret, type: g.type, knownBy: g.knownBy, unknownTo: g.unknownTo, dramaticPotential: g.dramaticPotential, age: chapterNumber - g.seededAtChapter })), null, 2)}

爽感调度：
${JSON.stringify(state.dopamineSchedule ?? { chaptersSinceMinor: 0, chaptersSinceMedium: 0, chaptersSinceMajor: 0, history: [] }, null, 2)}

角色承诺/Flag 状态：
${JSON.stringify(
  (state.activeCommitments ?? [])
    .filter((c) => c.status === 'active')
    .map((c) => ({
      id: c.id,
      角色: c.characterId,
      类型: c.type,
      内容: c.content,
      紧迫度: c.urgency,
      立下章节: c.seededAtChapter,
      存在章数: chapterNumber - c.seededAtChapter,
      ...(c.deadline ? { 期限: c.deadline } : {}),
    })),
  null, 2,
)}

已知约束：
- 当前章号：${chapterNumber}（计划总章数 ${state.seed.plannedTotalChapters?.min ?? 500}-${state.seed.plannedTotalChapters?.max ?? 800} 章，当前进度 ${((chapterNumber / (state.roughOutline.estimatedTotalChapters ?? 600)) * 100).toFixed(1)}%）
- 每章目标字数：${state.seed.targetChapterWordCount ?? 3000} 字
- 可用角色编号：${JSON.stringify(activeIds)}
- 禁止出场角色编号：${JSON.stringify(blockedIds)}
- 仅可伏笔提及角色编号：${JSON.stringify(foreshadowOnly)}
- 开放伏线数量：${openThreads.length}
- 逾期伏线：${overdueThreads.map((t) => t.label).join('、') || '无'}
- 上一章钩子：${state.lastHook || '（首章，无上一章钩子）'}
${(() => {
  const hookHistory = state.recentHookTypes ?? [];
  if (hookHistory.length < 2) return '';
  const recent3 = hookHistory.slice(-3).map((h) => h.hookType);
  const repeated = recent3.length >= 2 && new Set(recent3).size === 1;
  const profileHooks = state.bookPromptProfile.hookTypes ?? [];
  const hookLabelMap: Record<string, string> = {};
  for (const h of profileHooks) hookLabelMap[h.id] = h.label;
  const recentStr = recent3.map((h) => hookLabelMap[h] ?? h).join('→');
  const availableTypes = profileHooks.map((h) => h.label).join('/');
  return `- 近期钩子类型：${recentStr}${repeated ? ` ⚠️连续相同类型！请在hookDirection中建议不同类型的钩子。可选：${availableTypes}` : ''}`;
})()}

请为第 ${chapterNumber} 章设定意图：
- goals: 2-3 个本章目标，每个目标用一句话描述具体要推进什么。
- emotionDirection: 本章的整体情绪走向。
- hookDirection: 结尾钩子的大致方向（不是精确短语）。
- carryoverFromLastChapter: 如何承接上章（若首章则描述开局策略）。
- threadGuidance: 伏线管控建议。
- characterArcGuidance: 角色弧线指引：
  - focusCharacterIds: 本章重点刻画的角色编号（1-2个）
  - arcHints: 每个聚焦角色的弧线提示
  - emotionalLogicNotes: 情绪逻辑注意事项
- wordCountRange: 本书每章目标 ${state.seed.targetChapterWordCount ?? 3000} 字。min 和 max 应在目标字数的 ±15% 范围内（即 ${Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.85)}-${Math.round((state.seed.targetChapterWordCount ?? 3000) * 1.15)}）。高潮章可以略超上限，过渡章可以略低于下限。`,
      temperature: 0.5,
    });
  }
}
