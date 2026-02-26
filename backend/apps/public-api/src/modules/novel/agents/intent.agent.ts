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
  FIRST_CHAPTERS_PLAYBOOK,
  buildCompactContext,
  buildCharacterArcContext,
  buildKpiTrendHints,
  buildWritingLessonsHint,
} from '../prompting/novel-playbook';

@Injectable()
export class IntentAgent {
  constructor(private readonly llm: LlmService) {}

  async buildIntent(
    state: StoryState,
    arcDirective?: ArcDirectorDirective,
    additionalSystemPrompt?: string,
  ): Promise<ChapterIntent> {
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

    return this.llm.generateStructured({
      taskName: 'chapter-intent',
      schema: chapterIntentSchema,
      tags: ['workflow', 'chapter', 'intent'],
      metadata: { bookId: state.bookId, chapterNumber },
      systemPrompt: `你是一位经验丰富的网文策划师。为下一章设定灵魂方向——不是施工图纸，而是灵感指引。

=== 你只需要回答三个问题 ===
1. 这一章的核心冲突/张力是什么？（没有冲突感的目标不合格）
2. 读者读完应该是什么感受？（描述情绪变化曲线，如"从不安到震惊再到热血沸腾"）
3. 这一章在整个故事中的使命是什么？（推进什么？铺垫什么？回收什么？）

=== 原则 ===
- goals 2-3个，每个必须有冲突感。"被迫做选择"比"了解信息"好100倍。
- 给方向不给细节——Writer需要创作空间，不要规定具体场景和对话。
- 连续两章不能相同主情绪走向——读者需要变化。
- 预期管理：先让读者期待A，再给B（更好或更糟），比直接给A更有力量。

=== 悬念规则 ===
- overdue悬念（15章+）本章必须推进。chaptersSinceLastPayoff>=5时安排至少一个小揭晓。
- 悬念存量保持3-7个，explosive级信息差至少再憋3-5章。

=== 数据直觉（读状态数据时用） ===
- 爽感：距小爽≥3章安排小爽点，距中爽≥8章必须有中等回报，距大爽≥15章考虑高潮
- 信息差：dramatic_irony型→安排"差点发现真相"场景；explosive级至少再憋3章
- 角色：focusCharacterIds选1-2个深刻刻画（不是"发展角色"而是"展示他对XX的矛盾"），弧线预警角色本章必须有内心戏
- 承诺：imminent制造紧张感，overdue必须推进，不能连续遗忘同一承诺

=== 角色可用性（硬规则） ===
- 死亡/退场角色绝对不出现在activeCharacterIds中。
- return_planned但未到章的角色仅允许伏笔提及。
${state.seed.thematicCore ? `\n=== 主题内核 ===\n核心命题：${state.seed.thematicCore.centralQuestion}\n本章的目标/冲突应该能从某个角度触及这个命题——不需要回答，只需要让读者感受到。` : ''}
${arcDirective ? `\n=== 卷级导演指令（必须满足）===\n- 阶段：${arcDirective.arcStage}，使命：${arcDirective.chapterMission}\n- 必须命中：${arcDirective.mustHit.join('；') || '无'}，应规避：${arcDirective.shouldAvoid.join('；') || '无'}\n- 节奏：${arcDirective.pacingDirective || '无'}，钩子：${arcDirective.hookDirective || '无'}，风险：${arcDirective.riskBudget}` : ''}
${isEarly ? '\n' + FIRST_CHAPTERS_PLAYBOOK : ''}${kpiHints.length > 0 ? '\n动态提示：\n' + kpiHints.join('\n') : ''}
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
${arcDirective ? `\n卷级导演指令：
- 阶段：${arcDirective.arcStage}
- 本章使命：${arcDirective.chapterMission}
- 必须命中：${arcDirective.mustHit.join('；') || '无'}
- 应规避：${arcDirective.shouldAvoid.join('；') || '无'}
- 伏线回收：${arcDirective.payoffThreadIds.join('、') || '无'}
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
wordCountRange范围：${Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.85)}-${Math.round((state.seed.targetChapterWordCount ?? 3000) * 1.15)}字。`,
      temperature: 0.5,
    });
  }
}
