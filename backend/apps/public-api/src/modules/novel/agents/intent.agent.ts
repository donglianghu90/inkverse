/** 意图角色（步骤 1）：为下一章设定灵魂方向——核心冲突、读者感受、叙事使命。 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ArcDirectorDirective,
  ChapterIntent,
  StoryState,
  chapterIntentSchema,
} from '../schemas/novel-state.schemas';
import {
  buildFirstChaptersPlaybook,
  THREAD_AWARENESS_PLAYBOOK,
  buildCompactContext,
  buildCharacterArcContext,
  buildKpiTrendHints,
  buildWritingLessonsHint,
  buildDopamineDirective,
  UNIFIED_AGENT_MAX_CHARACTERS,
} from '../prompting/novel-playbook';
import { mapBeatRoleToChapterType } from '../prompting/chapter-type.utils';
import { buildAudiencePromptBlock } from '../prompting/audience-directive';

@Injectable()
export class IntentAgent {
  constructor(private readonly llm: LlmService) {}

  async buildIntent(
    state: StoryState,
    arcDirective?: ArcDirectorDirective,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterIntent> {
    const chapterNumber = state.chapterCursor;
    const chapterType = mapBeatRoleToChapterType(
      state.currentArc?.chapterBeats?.find((b) => b.chapterNumber === chapterNumber)?.role,
    ) ?? 'general';
    const context = buildCompactContext(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 5,
      maxOpenThreads: 10,
      maxTimelineEvents: 12,
    });

    const isEarly = chapterNumber <= 3;
    const isLiterary = state.seed.writingMode === 'literary';
    const kpiHints = buildKpiTrendHints(state);
    const characterArcAnalysis = buildCharacterArcContext(state);
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

    const budget = state.bookStrategy?.characterBudget;
    const charMap = new Map(state.characters.map((c) => [c.id, c]));
    const shouldAppear: string[] = [];
    const coolingIds: string[] = [];
    for (const id of activeIds) {
      const c = charMap.get(id);
      if (!c) continue;
      const gap = chapterNumber - (c.status.lastSeenChapter ?? 0);
      const imp = c.status.narrativeImportance ?? 'minor';
      if (imp === 'core' && gap >= (budget?.coreAbsenceAlert ?? 3)) shouldAppear.push(id);
      else if (imp === 'major' && gap >= (budget?.majorAbsenceAlert ?? 8)) shouldAppear.push(id);
      if (imp === 'minor' && gap < (budget?.minorCooldown ?? 5) && gap > 0) coolingIds.push(id);
      if (imp === 'cameo' && gap < (budget?.cameoCooldown ?? 15) && gap > 0) coolingIds.push(id);
    }
    const fadingIds = activeIds.filter((id) => charMap.get(id)?.status.lifecycleStatus === 'fading');
    const groupByImp = (tier: string) => activeIds.filter((id) => (charMap.get(id)?.status.narrativeImportance ?? 'minor') === tier);
    const coreIds = groupByImp('core');
    const majorIds = groupByImp('major');
    const otherIds = activeIds.filter((id) => !coreIds.includes(id) && !majorIds.includes(id));
    const nameOf = (id: string) => charMap.get(id)?.name ?? id;

    const intent = await this.llm.generateStructured({
      taskName: 'chapter-intent',
      schema: chapterIntentSchema,
      tags: ['workflow', 'chapter', 'intent'],
      metadata: { userId: state.userId, bookId: state.bookId, chapterNumber, chapterType },
      systemPrompt: `${playbooks?.['agent:intent:role'] ?? (isLiterary
        ? '你是一位兼具文学素养与叙事直觉的创作顾问。为下一章设定灵魂方向——不是施工图纸，而是创作灵感与主题探索的指引。'
        : '你是一位经验丰富的网文策划师。为下一章设定灵魂方向——不是施工图纸，而是灵感指引。')}

=== 你需要回答${isLiterary ? '四' : '三'}个问题 ===
${playbooks?.['agent:intent:core_questions'] ?? (isLiterary
  ? '1. 这一章的核心张力是什么？（可以是外部冲突，也可以是内在矛盾、情感暗流、认知困境——不强制显性冲突）\n2. 读者读完应该是什么感受？（描述情绪变化曲线，允许"从平静到更深的平静"这样的微妙变化）\n3. 这一章在整个故事中的使命是什么？（推进什么？铺垫什么？深化什么主题？）\n4. 这一章在文学层面有什么独特的表达？（叙事视角、时间结构、意象系统、语言实验？）'
  : '1. 这一章的核心冲突/张力是什么？（没有冲突感的目标不合格）\n2. 读者读完应该是什么感受？（描述情绪变化曲线，如"从不安到震惊再到热血沸腾"）\n3. 这一章在整个故事中的使命是什么？（推进什么？铺垫什么？回收什么？）')}

=== 当前章节类型 ===
${chapterType}
${playbooks?.['CHAPTER_TYPE_INTENT_PLAYBOOK'] ? `\n=== 章型意图专属指令 ===\n${playbooks['CHAPTER_TYPE_INTENT_PLAYBOOK']}` : ''}

=== 原则 ===
${playbooks?.['agent:intent:principles'] ?? (isLiterary
  ? '- goals 2-3个，允许探索型目标（内省、氛围构建、关系微妙变化），不强制每个 goal 有显性冲突。\n- 给方向不给细节——Writer需要极大的创作空间。\n- 允许连续 2-3 章维持同一情绪基调（如压抑、迷茫），只要情感深度持续递进。\n- 主题深化优先于情节推进：如果本章能在某个维度深化核心命题，即使情节进展不大也有价值。'
  : '- goals 2-3个，每个必须有冲突感。"被迫做选择"比"了解信息"好100倍。\n- 给方向不给细节——Writer需要创作空间，不要规定具体场景和对话。\n- 尽量避免连续多章相同主情绪走向——读者需要情绪变化，但如果叙事弧确实需要持续某种情绪基调（如危机高潮连续章），可以在情绪强度或侧重点上做出区分。\n- 预期管理：先让读者期待A，再给B（更好或更糟），比直接给A更有力量。')}

=== 悬念规则 ===
${playbooks?.['agent:intent:suspense_rules'] ?? '- 长期未推进的悬念容易被读者遗忘——overdue悬念应优先推进或至少提及。payoff间隔太长时安排一个小揭晓维持兴趣。\n- 悬念存量不宜太多（读者记不住）也不能太少（失去追更动力），根据当前故事复杂度动态平衡。\n- explosive级信息差是大杀器——揭晓前需要足够铺垫和读者期待积累，不要轻易消耗。'}

${playbooks?.['THREAD_AWARENESS_PLAYBOOK'] ?? THREAD_AWARENESS_PLAYBOOK}

=== 数据直觉（读状态数据时用） ===
${playbooks?.['agent:intent:data_intuition'] ?? '- 爽感：关注dopamineSchedule的chaptersSince数值。数值越大读者越饥渴——小爽间隔过长时优先安排，中爽和大爽的间隔应匹配当前卷节奏和故事总体量（短篇密集、长篇可拉长积蓄势能让爆发更猛）。不要机械地按固定间隔安排，要在叙事自然的位置给出爽感。\n- 信息差：dramatic_irony型→安排"差点发现真相"场景制造焦虑；explosive级需要充分铺垫后揭晓才有最大冲击力\n- 角色：focusCharacterIds选1-2个深刻刻画（不是"发展角色"而是"展示他对XX的矛盾"），弧线预警角色本章必须有内心戏\n- 承诺：imminent制造紧张感，overdue必须推进，不能连续遗忘同一承诺'}

=== 角色可用性（硬规则） ===
${playbooks?.['agent:intent:character_availability'] ?? '- 死亡/退场角色绝对不出现在activeCharacterIds中。\n- return_planned但未到章的角色仅允许伏笔提及。'}
${buildAudiencePromptBlock(state)}
${playbooks?.['__bookStrategy'] ?? ''}
${playbooks?.['__policySlice'] ?? ''}
${state.seed.thematicCore ? `\n=== 主题内核${isLiterary ? '（文学探索模式下为最高优先级）' : ''} ===\n核心命题：${state.seed.thematicCore.centralQuestion}\n${isLiterary ? '本章需在某个角度深化核心命题——可以通过角色选择、意象重复、对话潜台词、甚至沉默来回应。' : '本章的目标/冲突应该能从某个角度触及这个命题——不需要回答，只需要让读者感受到。'}` : ''}
${buildDopamineDirective(state.seed.writingMode)}
${arcDirective ? `\n=== 卷级导演指令（必须满足）===\n- 阶段：${arcDirective.arcStage}，使命：${arcDirective.chapterMission}\n- 必须命中：${arcDirective.mustHit.join('；') || '无'}，应规避：${arcDirective.shouldAvoid.join('；') || '无'}\n- 节奏：${arcDirective.pacingDirective || '无'}，钩子：${arcDirective.hookDirective || '无'}，风险：${arcDirective.riskBudget}${arcDirective.characterGuidance?.length ? `\n=== 本卷角色成长目标（作为 characterArcGuidance 的制定依据）===\n${arcDirective.characterGuidance.map((g) => `- ${g.characterName}：${g.volumeStartState} → ${g.volumeEndState}${g.keyMoments.length ? '，关键时刻：' + g.keyMoments.slice(0, 2).join('；') : ''}`).join('\n')}` : ''}` : ''}
${isEarly ? '\n' + buildFirstChaptersPlaybook(state.bookPromptProfile?.worldProfile?.goldenFingerApplicable) : ''}${kpiHints.length > 0 ? '\n动态提示：\n' + kpiHints.join('\n') : ''}
${buildWritingLessonsHint(state.writingLessons ?? [], ['pacing', 'hook', 'structure', 'emotion'])}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
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
- 角色[核心]：${coreIds.map((id) => `${nameOf(id)}(${id})`).join('、') || '无'}
- 角色[重要]：${majorIds.map((id) => `${nameOf(id)}(${id})`).join('、') || '无'}
- 角色[其他]：${otherIds.map((id) => `${nameOf(id)}(${id})`).join('、') || '无'}${blockedIds.length > 0 ? `\n- 禁止出场：${blockedIds.join(',')}` : ''}${foreshadowOnly.length > 0 ? `\n- 仅可伏笔提及：${foreshadowOnly.join(',')}` : ''}${shouldAppear.length > 0 ? `\n- ⚠️ 建议出场（缺席过久）：${shouldAppear.map((id) => `${nameOf(id)}(缺席${chapterNumber - (charMap.get(id)?.status.lastSeenChapter ?? 0)}章)`).join('、')}` : ''}${coolingIds.length > 0 ? `\n- 冷却中（非必要不出场）：${coolingIds.map((id) => `${nameOf(id)}`).join('、')}` : ''}${fadingIds.length > 0 ? `\n- 淡出中（仅提及或短暂露面）：${fadingIds.map((id) => { const c = charMap.get(id)!; return `${c.name}(${c.status.maxSceneRole ?? 'brief_appearance'})`; }).join('、')}` : ''}
- 本章角色上限：${budget?.maxPresentPerChapter ?? 6}人（去重）
- 伏线：${openThreads.length}条开放${overdueThreads.length > 0 ? `，${overdueThreads.map((t) => t.label).join('、')}逾期` : ''}${(() => { const vol = state.currentVolume; if (!vol?.exitCharacterPlan?.length) return ''; const due = vol.exitCharacterPlan.filter((p) => Math.abs(p.exitChapterEstimate - chapterNumber) <= 2); return due.length ? `\n- 📤 本卷退场计划临近：${due.map((p) => `${p.characterId}→${p.exitType}(约ch${p.exitChapterEstimate}，${p.reason})`).join('；')}` : ''; })()}
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
${arcDirective ? `\n（卷级导演指令已在系统提示中给出，此处不再重复。）
- 节奏：${arcDirective.pacingDirective || '无'}
- 钩子：${arcDirective.hookDirective || '无'}
- 风险预算：${arcDirective.riskBudget}` : ''}

${(() => {
  const bank = state.foreshadowingBank ?? { deposits: [] };
  const dueToPlant = bank.deposits.filter((d) => d.status === 'pending' && d.plantWindow.earliestChapter <= chapterNumber && d.plantWindow.latestChapter >= chapterNumber);
  const urgentPlant = dueToPlant.filter((d) => d.priority === 'must_plant' || (d.plantWindow.latestChapter - chapterNumber) <= 3);
  const duePayoff = bank.deposits.filter((d) => d.status === 'planted' && d.payoffWindow.earliestChapter <= chapterNumber && d.payoffWindow.latestChapter >= chapterNumber);
  const parts: string[] = [];
  if (urgentPlant.length) parts.push(`⚠️ 紧急埋设：${urgentPlant.map((d) => `${d.label}(${d.category})-"${d.embeddingGuidance.slice(0, 30)}"`).join('；')}`);
  if (dueToPlant.length > urgentPlant.length) parts.push(`可选埋设：${dueToPlant.filter((d) => !urgentPlant.includes(d)).map((d) => d.label).join('、')}`);
  if (duePayoff.length) parts.push(`可回收伏笔：${duePayoff.map((d) => `${d.label}-"${d.payoffDescription.slice(0, 30)}"`).join('；')}`);
  const charHints = bank.deposits.filter((d) => d.pendingCharacterHint && d.status !== 'resolved' && d.pendingCharacterHint.formalIntroChapter > chapterNumber);
  if (charHints.length) parts.push(`角色预告（仅暗示，不可正式出场）：${charHints.map((d) => `「${d.pendingCharacterHint!.characterLabel}」-${d.pendingCharacterHint!.hintGuidance.slice(0, 30)}`).join('；')}`);
  return parts.length ? '\n伏笔银行：\n' + parts.join('\n') : '';
})()}
${(() => {
  const fs = state.feedbackState;
  if (!fs?.lastAnalysis || fs.confidence === 'none') return '';
  const a = fs.lastAnalysis;
  const lines: string[] = [`\n读者反馈洞察（${fs.confidence}，仅供参考，创作意图优先）：`];
  const adopted = [...a.bookLevel.writingStyleFeedback, ...a.bookLevel.coreIssues].filter((s) => s.verdict === 'adopt' || s.verdict === 'conditional');
  if (adopted.length) lines.push(`[全书] ${adopted.map((s) => `${s.verdict === 'adopt' ? '✓' : '△'}${s.suggestion}${s.constraints.length ? '(' + s.constraints[0] + ')' : ''}`).join('；')}`);
  if (a.bookLevel.neverAgain.length) lines.push(`[红线] ${a.bookLevel.neverAgain.join('；')}`);
  if (fs.confidence !== 'stale') {
    const arcAdopted = a.arcLevel.suggestions.filter((s) => s.verdict === 'adopt' || s.verdict === 'conditional');
    if (arcAdopted.length) lines.push(`[当前Arc] ${arcAdopted.map((s) => `${s.suggestion}`).join('；')} | 节奏=${a.arcLevel.pacingVerdict}`);
  }
  if (fs.confidence === 'fresh' && a.chapterLevel.expiresAfterChapter > chapterNumber) {
    const chFixes = a.chapterLevel.immediateFixes.filter((s) => s.verdict === 'adopt');
    if (chFixes.length) lines.push(`[下章] ${chFixes.map((s) => s.suggestion).join('；')} | 节奏调整=${a.chapterLevel.pacingAdjustment}`);
    if (a.chapterLevel.suspenseUrgency.length) lines.push(`[读者急切] ${a.chapterLevel.suspenseUrgency.join('；')}`);
  }
  if (a.sentimentTrend === 'declining') lines.push(`⚠ 读者情绪趋势：下滑中，注意调整`);
  return lines.length > 1 ? lines.join('\n') : '';
})()}

为第${chapterNumber}章设定意图。
emotionDirection要描述情绪变化曲线（如"从A到B再到C"），不要只写一个形容词。
wordCountRange范围：${Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.85)}-${Math.round((state.seed.targetChapterWordCount ?? 3000) * 1.15)}字。
请为本章核心出场角色提取 characterVoiceAnchors（标志性台词/口癖），作为后续生成的强锚点。`,
      temperature: isLiterary ? 0.7 : 0.5,
    });
    const policyMax = state.bookStrategy?.threadPolicy?.maxNewThreadsPerChapter;
    if (typeof policyMax === 'number') {
      intent.threadGuidance.maxNewThreads = Math.max(
        0,
        Math.min(intent.threadGuidance.maxNewThreads, Math.min(3, policyMax)),
      );
    }
    const blockedSet = new Set([...blockedIds, ...foreshadowOnly]);
    intent.characterAvailability.activeCharacterIds = intent.characterAvailability.activeCharacterIds.filter((id) => !blockedSet.has(id));
    intent.characterAvailability.blockedCharacterIds = [...new Set([...intent.characterAvailability.blockedCharacterIds, ...blockedIds])];
    intent.characterAvailability.foreshadowOnlyCharacterIds = [...new Set([...intent.characterAvailability.foreshadowOnlyCharacterIds, ...foreshadowOnly])];
    for (const id of shouldAppear) {
      if (!intent.characterAvailability.activeCharacterIds.includes(id)) intent.characterAvailability.activeCharacterIds.push(id);
    }
    return intent;
  }
}
