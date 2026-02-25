/**
 * 意图角色（步骤 1）：
 * 为下一章设定轻量方向——目标、情绪、钩子、伏线指引、角色弧线指引。
 * 兼任"人物塑造师"视角：识别扁平化角色、规划成长节点、守护情绪逻辑。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  StoryState,
  chapterIntentSchema,
} from '../schemas/novel-state.schemas';
import {
  THREAD_AWARENESS_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  FIRST_CHAPTERS_PLAYBOOK,
  buildCompactContext,
  buildCharacterArcContext,
  buildKpiTrendHints,
} from '../prompting/novel-playbook';

@Injectable()
export class IntentAgent {
  constructor(private readonly llm: LlmService) {}

  async buildIntent(state: StoryState, additionalSystemPrompt?: string): Promise<ChapterIntent> {
    const chapterNumber = state.chapterCursor;
    const context = buildCompactContext(state, {
      maxCharacters: 10,
      maxChapterSummaries: 5,
      maxOpenThreads: 10,
      maxTimelineEvents: 12,
    });

    const isEarly = chapterNumber <= 3;
    const kpiHints = buildKpiTrendHints(state);
    const characterArcAnalysis = buildCharacterArcContext(state);
    const dynamicParts: string[] = [];
    if (isEarly) dynamicParts.push(FIRST_CHAPTERS_PLAYBOOK);
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
      systemPrompt: `你是一位经验丰富的网文大纲师+人物塑造师+读者心理操控师。
为下一章设定轻量方向指引。不要过度规划——2-3个目标+情绪走向+钩子方向就够了。

=== 核心原则 ===
- 目标必须有冲突感："主角被迫在两个选择中做出决定"比"主角了解新信息"好100倍。
- 每个目标要回答"读者为什么想看这一章"——如果你自己说不出来，目标就不合格。
- 预期管理：先让读者期待A，再给B（更好或更糟），比直接给A更有力量。

=== 卷节奏（有当前卷计划时） ===
- setup 章：侧重铺垫和引入，不提前高潮。
- climax 章：必须有明确大爽点。
- relief/aftermath 章：可放缓，安排日常/感情内容。
- emotionDirection 必须匹配节拍张力等级。

=== 读者情绪曲线规划（最重要的新增职责） ===
- emotionDirection 不只是"情绪标签"，而是"读者读完这章应该有什么感受"。
- 好的情绪走向示例："从不安到震惊再到热血沸腾""从温馨到突然的寒意""从紧张到释然到新的担忧"。
- 避免情绪平坦：即使是过渡章，也要有"微波动"——先轻松后暗示危机，或先严肃后一个温暖的小细节。
- 连续两章不能有相同的主要情绪走向——读者需要变化。

=== 悬念与信息差管理 ===
- overdue悬念（15章+）：本章必须推进。boiling悬念（8-15章）：至少tease。
- chaptersSinceLastPayoff >= 5：必须安排至少一个小揭晓。
- 悬念存量保持3-7个，每章最多揭晓1-2个。
- dramatic_irony型信息差：安排"角色差点发现真相"的场景。mystery型：给线索碎片。
- explosive级信息差：至少再憋3-5章。

=== 爽感调度（因果链驱动，而非机械计数） ===
- 核心逻辑：爽感不是随机插入的——它是"铺垫→压力→爆发"因果链的高潮。
- chaptersSinceMinor >= 3 或 chaptersSinceMedium >= 8 时：检查当前有没有"已经铺垫好但还没爆发"的因果链。有就让它爆发。没有就快速启动一条新的短线。
- 爽点类型交替：查看最近3次爽感的类型，避免重复。
- 规模升级趋势：大爽点的规模要随故事进度逐渐升级（personal→group→faction→regional...）。

=== 角色弧线 ===
- focusCharacterIds: 本章重点刻画1-2个角色的内心。
- arcHints: 给聚焦角色具体提示（"展示他对父亲的矛盾""在压力下暴露真实性格"）。
- emotionalLogicNotes: 检查上章结尾情绪，标注本章必须注意的情绪逻辑。
- 承诺：overdue的必须推进，imminent的制造紧张感。

=== 角色可用性（硬规则） ===
- 死亡/退场角色绝对不出现在activeCharacterIds中。
- return_planned但未到章的角色仅允许伏笔提及。

${THREAD_AWARENESS_PLAYBOOK}
${CHARACTER_ARC_PLAYBOOK}
${dynamicParts.length > 0 ? '\n' + dynamicParts.join('\n\n') : ''}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

角色弧线分析：
${characterArcAnalysis.map((c) => `${c['角色']}：${c['近期表现'] ?? '正常'}${c['弧线预警'] ? ' ⚠️' + c['弧线预警'] : ''}`).join('\n')}

读者状态：
- 悬念存量：${(state.readerTension?.activeCuriosities ?? []).length}个（${(state.readerTension?.activeCuriosities ?? []).filter((c: any) => (chapterNumber - (c.seededAtChapter ?? 0)) > 15).length}个overdue）
- 上次揭晓距今：${state.readerTension?.chaptersSinceLastPayoff ?? 0}章
- 信息差：${((state.informationLedger ?? { activeGaps: [] }).activeGaps).map((g) => `[${g.type}]${g.secret.slice(0, 20)}（${chapterNumber - g.seededAtChapter}章龄，${g.dramaticPotential}级）`).join('；') || '无'}
- 爽感：距上次小爽${state.dopamineSchedule?.chaptersSinceMinor ?? 0}章/中爽${state.dopamineSchedule?.chaptersSinceMedium ?? 0}章/大爽${state.dopamineSchedule?.chaptersSinceMajor ?? 0}章
- 活跃承诺：${(state.activeCommitments ?? []).filter((c) => c.status === 'active').map((c) => `${c.characterId}:${c.content.slice(0, 15)}（${chapterNumber - c.seededAtChapter}章，${c.urgency}）`).join('；') || '无'}

约束：
- 章号${chapterNumber}（进度${((chapterNumber / (state.roughOutline.estimatedTotalChapters ?? 600)) * 100).toFixed(1)}%），目标字数${state.seed.targetChapterWordCount ?? 3000}字
- 可用角色：${activeIds.join(',')}${blockedIds.length > 0 ? `\n- 禁止出场：${blockedIds.join(',')}` : ''}${foreshadowOnly.length > 0 ? `\n- 仅可伏笔提及：${foreshadowOnly.join(',')}` : ''}
- 伏线：${openThreads.length}条开放${overdueThreads.length > 0 ? `，${overdueThreads.map((t) => t.label).join('、')}逾期` : ''}
- 上一章钩子：${state.lastHook || '（首章）'}
${(() => {
  const hookHistory = state.recentHookTypes ?? [];
  if (hookHistory.length < 2) return '';
  const recent3 = hookHistory.slice(-3).map((h) => h.hookType);
  const repeated = recent3.length >= 2 && new Set(recent3).size === 1;
  const profileHooks = state.bookPromptProfile.hookTypes ?? [];
  const hookLabelMap: Record<string, string> = {};
  for (const h of profileHooks) hookLabelMap[h.id] = h.label;
  const recentStr = recent3.map((h) => hookLabelMap[h] ?? h).join('→');
  return `- 钩子趋势：${recentStr}${repeated ? ' ⚠️连续相同，需换类型' : ''}`;
})()}

为第${chapterNumber}章设定意图。
emotionDirection要描述情绪变化曲线（如"从A到B再到C"），不要只写一个形容词。
wordCountRange范围：${Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.85)}-${Math.round((state.seed.targetChapterWordCount ?? 3000) * 1.15)}字。`,
      temperature: 0.5,
    });
  }
}
