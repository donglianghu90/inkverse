/**
 * 深度维护服务（事件驱动触发）。
 *
 * 触发条件：
 * 1. 首次结晶：第 3 章后强制触发
 * 2. 新元素积累超阈值（角色 3+、伏线 5+、事实 10+）
 * 3. 质量信号下滑（连续 3 章低分、连续 2 章一致性警告）
 * 4. 弧转折点（大事件触发，由外部标记）
 * 5. 兜底上限（15 章未维护）
 *
 * 五项维护任务：
 * - bible_crystallization: 从已写内容提炼 IP 圣经
 * - outline_revision: 根据实际走向修订粗大纲
 * - consistency_audit: 审计角色/地点/时间线一致性
 * - canon_arbitration: 仲裁冲突的角色设定事实
 * - thread_health_check: 伏线健康度检查，标记过期/停滞伏线
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmService } from './llm/llm.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
import { VolumeDirectorAgent } from './agents/volume-director.agent';
import { RetrospectiveLearnerAgent } from './agents/retrospective-learner.agent';
import { MemoryRetrieverService } from './memory-retriever.service';
import { ChapterEntity } from './entities/chapter.entity';
import {
  MaintenanceState,
  MaintenanceTrigger,
  StoryState,
  ArcAcceptanceReport,
  crystallizedBibleSchema,
  roughOutlineSchema,
  miniArcSchema,
  styleAnchorSchema,
  consistencyAuditResultSchema,
  canonArbitrationResultSchema,
  threadHealthResultSchema,
  arcSummaryOutputSchema,
  volumeSummaryOutputSchema,
  WritingLesson,
} from './schemas/novel-state.schemas';
import { buildCompactContext } from './prompting/novel-playbook';

const FIRST_CRYSTALLIZATION_CHAPTER = 3;
const NEW_CHARACTERS_THRESHOLD = 3;
const NEW_THREADS_THRESHOLD = 5;
const NEW_FACTS_THRESHOLD = 10;
const CONSECUTIVE_LOW_SCORE_THRESHOLD = 3;
const CONSECUTIVE_CONSISTENCY_WARNING_THRESHOLD = 2;
const MAX_CHAPTERS_WITHOUT_MAINTENANCE = 15;

/** 根据全书规模动态计算MiniArc章数范围 */
export function getArcChapterRange(state: { roughOutline?: { estimatedTotalChapters?: number; estimatedVolumes?: number } }): { min: number; max: number } {
  const total = state.roughOutline?.estimatedTotalChapters ?? 600;
  const vols = state.roughOutline?.estimatedVolumes ?? Math.max(1, Math.round(Math.sqrt(total / 25)));
  const avg = Math.round(total / vols);
  return { min: Math.max(5, Math.floor(avg * 0.7 / 6)), max: Math.max(8, Math.ceil(avg * 1.3 / 3)) };
}

@Injectable()
export class DeepMaintenanceService {
  private readonly logger = new Logger(DeepMaintenanceService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly promptTplService: BookPromptTemplateService,
    private readonly volumeDirector: VolumeDirectorAgent,
    private readonly retrospectiveLearner: RetrospectiveLearnerAgent,
    private readonly memoryRetriever: MemoryRetrieverService,
    @InjectRepository(ChapterEntity)
    private readonly chapterRepo: Repository<ChapterEntity>,
  ) {}

  private async loadSections(bookId: string): Promise<Record<string, string>> { // 加载 agent sections 打平为 key→content
    const tpl = await this.promptTplService.getTemplates(bookId);
    const map: Record<string, string> = {};
    for (const [agentId, config] of Object.entries(tpl.agents)) {
      for (const sec of config.sections) map[`agent:${agentId}:${sec.key}`] = sec.content;
    }
    return map;
  }

  /**
   * Evaluate whether maintenance should trigger. Pure logic, no LLM.
   */
  evaluateTrigger(state: StoryState): MaintenanceTrigger {
    const m = state.maintenance;
    const chapterNumber = state.chapterCursor - 1;
    const chaptersSinceLast = chapterNumber - m.lastMaintenanceAtChapter;
    const reasons: string[] = [];
    const tasks: MaintenanceTrigger['tasks'] = [];

    if (m.bibleVersion === 0 && chapterNumber >= FIRST_CRYSTALLIZATION_CHAPTER) {
      reasons.push(`首次结晶：已写 ${chapterNumber} 章，需要从已写内容中提炼圣经`);
      tasks.push('bible_crystallization', 'outline_revision');
    }

    if (m.newCharactersSinceLastMaintenance >= NEW_CHARACTERS_THRESHOLD) {
      reasons.push(`新角色积累 ${m.newCharactersSinceLastMaintenance} 个，需要梳理关系`);
      if (!tasks.includes('consistency_audit')) tasks.push('consistency_audit');
      if (!tasks.includes('canon_arbitration')) tasks.push('canon_arbitration');
    }
    if (m.newThreadsSinceLastMaintenance >= NEW_THREADS_THRESHOLD) {
      reasons.push(`新伏线积累 ${m.newThreadsSinceLastMaintenance} 条，需要检查伏线健康`);
      if (!tasks.includes('thread_health_check')) tasks.push('thread_health_check');
    }
    if (m.newFactsSinceLastMaintenance >= NEW_FACTS_THRESHOLD) {
      reasons.push(`新事实积累 ${m.newFactsSinceLastMaintenance} 条，需要仲裁一致性`);
      if (!tasks.includes('canon_arbitration')) tasks.push('canon_arbitration');
    }

    if (m.consecutiveLowScoreChapters >= CONSECUTIVE_LOW_SCORE_THRESHOLD) {
      reasons.push(`连续 ${m.consecutiveLowScoreChapters} 章低分，需要系统性检查`);
      if (!tasks.includes('outline_revision')) tasks.push('outline_revision');
      if (!tasks.includes('consistency_audit')) tasks.push('consistency_audit');
    }
    if (m.consecutiveConsistencyWarnings >= CONSECUTIVE_CONSISTENCY_WARNING_THRESHOLD) {
      reasons.push(`连续 ${m.consecutiveConsistencyWarnings} 章一致性警告`);
      if (!tasks.includes('consistency_audit')) tasks.push('consistency_audit');
    }

    if (chaptersSinceLast >= MAX_CHAPTERS_WITHOUT_MAINTENANCE && tasks.length === 0) {
      reasons.push(`已 ${chaptersSinceLast} 章未做深度维护，触发安全网`);
      tasks.push('bible_crystallization', 'consistency_audit', 'thread_health_check');
    }

    // Trigger: Arc planning — when current arc ends or doesn't exist after chapter 1.
    const arc = state.currentArc;
    if (!arc && chapterNumber >= 1) {
      reasons.push('无当前卷计划，需要规划下一卷');
      if (!tasks.includes('arc_planning')) tasks.push('arc_planning');
    } else if (arc && chapterNumber >= arc.plannedEndChapter) {
      // 仅在当前卷完成后再规划下一卷，确保卷内章节不被提前切换。
      reasons.push(`当前卷「${arc.arcTitle}」已结束（计划结束章${arc.plannedEndChapter}），需要规划下一卷`);
      if (!tasks.includes('arc_planning')) tasks.push('arc_planning');
    }

    // Trigger: Style anchoring — first time after 2 chapters, or every 20 chapters.
    if (!state.styleAnchor && chapterNumber >= 2) {
      reasons.push('尚未建立文风锚点，需要从已写内容中提取风格样本');
      if (!tasks.includes('style_anchoring')) tasks.push('style_anchoring');
    } else if (state.styleAnchor && chapterNumber - state.styleAnchor.anchoredAtChapter >= 20) {
      reasons.push('文风锚点已过期（20章），需要刷新');
      if (!tasks.includes('style_anchoring')) tasks.push('style_anchoring');
    }

    return { shouldTrigger: tasks.length > 0, reasons, tasks };
  }

  /**
   * Execute maintenance tasks. Returns updated state.
   */
  async execute(
    state: StoryState,
    trigger: MaintenanceTrigger,
  ): Promise<StoryState> {
    const chapterNumber = state.chapterCursor - 1;
    this.logger.log(
      `[Maintenance] ========== 深度维护开始 ==========\n` +
      `  章节: ${chapterNumber} | 任务: ${trigger.tasks.join(', ')}\n` +
      `  原因: ${trigger.reasons.join('；')}`,
    );
    const t0 = Date.now();
    let updatedState = { ...state };

    for (const task of trigger.tasks) {
      const taskStart = Date.now();
      this.logger.log(`[Maintenance] 执行: ${task}`);
      try {
        switch (task) {
          case 'bible_crystallization':
            updatedState = await this.crystallizeBible(updatedState);
            break;
          case 'outline_revision':
            updatedState = await this.reviseOutline(updatedState);
            break;
          case 'consistency_audit':
            updatedState = await this.runConsistencyAudit(updatedState);
            break;
          case 'canon_arbitration':
            updatedState = await this.runCanonArbitration(updatedState);
            break;
          case 'thread_health_check':
            updatedState = await this.runThreadHealthCheck(updatedState);
            break;
          case 'arc_planning':
            updatedState = await this.planNextArc(updatedState);
            break;
          case 'style_anchoring':
            updatedState = await this.anchorStyle(updatedState);
            break;
        }
        this.logger.log(`[Maintenance] ${task} 完成 — ${Date.now() - taskStart}ms`);
      } catch (error) {
        this.logger.error(
          `[Maintenance] ${task} 失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    updatedState = {
      ...updatedState,
      maintenance: {
        ...updatedState.maintenance,
        lastMaintenanceAtChapter: chapterNumber,
        newCharactersSinceLastMaintenance: 0,
        newLocationsSinceLastMaintenance: 0,
        newThreadsSinceLastMaintenance: 0,
        newFactsSinceLastMaintenance: 0,
        consecutiveLowScoreChapters: 0,
        consecutiveConsistencyWarnings: 0,
      },
      updatedAt: new Date().toISOString(),
    };

    this.logger.log(
      `[Maintenance] ========== 深度维护完成 ========== ${Date.now() - t0}ms`,
    );
    return updatedState;
  }

  /**
   * Bootstrap the first arc before chapter generation starts.
   * Falls back to original state if planning fails.
   */
  async bootstrapInitialArc(state: StoryState): Promise<StoryState> {
    if (state.currentArc) return state;
    try {
      return await this.planNextArc(state);
    } catch (error) {
      this.logger.warn(
        `[Maintenance] initial arc planning skipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return state;
    }
  }

  /** 确保有活跃的大卷规划。无卷或当前卷已超估计结束章时触发新卷规划。 */
  private async ensureVolumeArc(state: StoryState): Promise<StoryState> {
    const ch = state.chapterCursor;
    const vol = state.currentVolume;
    const needsNewVolume = !vol || (vol.status === 'active' && ch > vol.estimatedEndChapter);
    if (!needsNewVolume) return state;

    if (vol && vol.status === 'active') {
      this.logger.log(`[Volume] 卷「${vol.title}」已超过预估结束章${vol.estimatedEndChapter}，规划新卷`);
      await this.generateVolumeSummary(state, vol, ch).catch((e) =>
        this.logger.warn(`[Volume] 卷摘要生成失败: ${e instanceof Error ? e.message : String(e)}`),
      );
      state = {
        ...state,
        completedVolumes: [...(state.completedVolumes ?? []), { ...vol, status: 'completed' as const }],
      };
    }

    try {
      const { volume: newVolume, deposits } = await this.volumeDirector.planVolumeWithForeshadowing(state);
      this.logger.log(
        `[Volume] 新卷规划完成：「${newVolume.title}」ch${newVolume.startChapter}-${newVolume.estimatedEndChapter} | ` +
        `MiniArc槽位: ${newVolume.miniArcSlots.length} | 伏笔种子: ${deposits.length} | 创新: ${newVolume.structuralInnovation || '无'}`,
      );
      const bank = state.foreshadowingBank ?? { deposits: [], totalPlanted: 0, totalResolved: 0 };
      return {
        ...state,
        currentVolume: { ...newVolume, status: 'active' as const },
        foreshadowingBank: {
          ...bank,
          deposits: [...bank.deposits, ...deposits],
        },
      };
    } catch (err) {
      this.logger.warn(`[Volume] 大卷规划失败，继续使用现有状态: ${err}`);
      return state;
    }
  }

  // -------------------------------------------------------------------------
  // Task implementations
  // -------------------------------------------------------------------------

  private async crystallizeBible(state: StoryState): Promise<StoryState> {
    const context = buildCompactContext(state, {
      maxCharacters: 15,
      maxChapterSummaries: 20,
      maxOpenThreads: 15,
      maxTimelineEvents: 30,
    });
    const chapterNumber = state.chapterCursor - 1;

    const bible = await this.llm.generateStructured({
      taskName: 'bible-crystallization',
      schema: crystallizedBibleSchema,
      systemPrompt: `你是设定整理专家。从已写内容中提炼IP圣经——这不是创造新设定，而是把已经建立的内容整理成权威参考文件。

关键原则：
- 只记录正文中确认的事实，不编造未出现的内容。
- worldRules 要具体到"可验证"的程度（"筑基期修士飞行高度不超过百丈"比"筑基期可以飞"更有用）。
- powerSystem 要清晰标注已出现的等级和已知的升级条件。
- establishedFacts 要区分"明确的"和"暗示的"——后者标注 confidence。
- narrativeStyle 要包含已形成的叙事特点：视角、语感、段落密度偏好。`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

请从已写的 ${chapterNumber} 章内容中提炼圣经：
- title, genre, targetAudience, logline: 从种子信息和已写内容确认
- worldRules: 已经在正文中建立的世界规则
- powerSystem: 已经出现的力量体系（如果有的话）
- redLines: 不可违反的底线
- mainConflict: 已经建立的核心冲突
- narrativeStyle: 已经形成的叙事风格
- establishedFacts: 已经确认的重要设定事实
- version: ${(state.maintenance.bibleVersion ?? 0) + 1}
- crystallizedAtChapter: ${chapterNumber}`,
      temperature: 0.3,
    });

    return {
      ...state,
      bible: {
        title: bible.title,
        genre: bible.genre,
        targetAudience: bible.targetAudience,
        logline: bible.logline,
        worldRules: bible.worldRules,
        powerSystem: bible.powerSystem,
        redLines: bible.redLines,
        mainConflict: bible.mainConflict,
        finalGoal: state.seed.coreConflictDirection,
      },
      maintenance: {
        ...state.maintenance,
        bibleVersion: bible.version,
      },
    };
  }

  private async reviseOutline(state: StoryState): Promise<StoryState> {
    const context = buildCompactContext(state, {
      maxChapterSummaries: 15,
      maxOpenThreads: 10,
    });
    const chapterNumber = state.chapterCursor - 1;

    const revisedOutline = await this.llm.generateStructured({
      taskName: 'outline-revision',
      schema: roughOutlineSchema,
      systemPrompt: `你是大纲修订师。
根据实际已写的故事内容，修订后续的粗大纲。
已经写过的部分不要改动，只调整尚未写到的未来方向。
保持大纲粗略——只是方向指引，不是详细规划。`,
      userPrompt: `当前粗大纲：
${JSON.stringify(state.roughOutline, null, 2)}

已写 ${chapterNumber} 章的故事状态：
${JSON.stringify(context, null, 2)}

请修订大纲：
- 已经写过的节点保留或标记为已完成
- 未来的节点根据实际故事走向调整
- 如果故事偏离了原大纲，跟着故事实际方向走
- 保持 4-6 个节点的粗略程度
- 根据实际进展重新评估 estimatedVolumes（预计卷数）是否合理，必要时调整`,
      temperature: 0.5,
    });

    return {
      ...state,
      roughOutline: revisedOutline,
      maintenance: {
        ...state.maintenance,
        outlineVersion: state.maintenance.outlineVersion + 1,
      },
    };
  }

  private async runConsistencyAudit(state: StoryState): Promise<StoryState> {
    const context = buildCompactContext(state, {
      maxCharacters: 20,
      maxChapterSummaries: 15,
      maxOpenThreads: 15,
      maxTimelineEvents: 30,
    });
    const chapterNumber = state.chapterCursor - 1;

    const result = await this.llm.generateStructured({
      taskName: 'consistency-audit',
      schema: consistencyAuditResultSchema,
      systemPrompt: `你是一位严谨的故事一致性审计员。
你的任务是检查已写故事中的所有角色、地点、时间线是否存在矛盾或不一致。

审计范围：
1. 角色矛盾：同一角色在不同章节中的属性/能力/性格是否冲突
2. 地点矛盾：同一地点的描述/特性/距离关系是否冲突
3. 时间线不一致：事件的先后顺序是否矛盾
4. 关系图清理：已失效或错误的关系边是否需要标记

你不是创造性角色，不要编造新内容。只基于已有数据审计。
对于每个发现的冲突，给出具体的修复建议。`,
      userPrompt: `当前故事状态（已写 ${chapterNumber} 章）：
${JSON.stringify(context, null, 2)}

角色详情：
${JSON.stringify(state.characters, null, 2)}

地点详情：
${JSON.stringify(state.locations, null, 2)}

关系图：
${JSON.stringify(state.relationGraph ?? [], null, 2)}

时间线事件：
${JSON.stringify((state.timelineEvents ?? []).slice(-30), null, 2)}

角色事实档案：
${JSON.stringify((state.characterFactLedger ?? []).slice(-50), null, 2)}

请审计并输出：
- characterConflicts: 角色内部矛盾
- locationConflicts: 地点矛盾
- timelineInconsistencies: 时间线不一致
- cleanedRelationGraph: 清理后的关系图（只包含需要更新的边）
- overallHealthScore: 0-10 整体一致性健康分`,
      temperature: 0.2,
    });

    this.logger.log(
      `[Maintenance] consistency_audit: 健康分 ${result.overallHealthScore} | ` +
      `角色冲突 ${result.characterConflicts.length} | 地点冲突 ${result.locationConflicts.length} | ` +
      `时间线问题 ${result.timelineInconsistencies.length}`,
    );

    if (result.characterConflicts.length > 0) {
      const factLedger = [...(state.characterFactLedger ?? [])];
      for (const conflict of result.characterConflicts) {
        factLedger.push({
          id: `fact_audit_${chapterNumber}_${conflict.characterId}`,
          characterId: conflict.characterId,
          fact: `[审计修正] ${conflict.resolution}`,
          category: 'ability',
          status: 'active',
          confidence: 1.0,
          firstSeenChapter: chapterNumber,
          lastConfirmedChapter: chapterNumber,
          sourceChapter: chapterNumber,
          sourceEventId: null,
          notes: conflict.conflict,
        });
      }
      return { ...state, characterFactLedger: factLedger };
    }

    return state;
  }

  private async runCanonArbitration(state: StoryState): Promise<StoryState> {
    const facts = state.characterFactLedger ?? [];
    if (facts.length === 0) return state;

    const chapterNumber = state.chapterCursor - 1;

    const characterFactsByChar = new Map<string, typeof facts>();
    for (const f of facts) {
      const arr = characterFactsByChar.get(f.characterId) ?? [];
      arr.push(f);
      characterFactsByChar.set(f.characterId, arr);
    }

    const charsWithMultiple = [...characterFactsByChar.entries()]
      .filter(([, v]) => v.length >= 3)
      .map(([id, v]) => ({ characterId: id, facts: v }));

    if (charsWithMultiple.length === 0) return state;

    const result = await this.llm.generateStructured({
      taskName: 'canon-arbitration',
      schema: canonArbitrationResultSchema,
      systemPrompt: `你是人设档案仲裁员。
你的任务是检查角色的事实档案，找出互相矛盾的条目，并仲裁取舍。

仲裁原则：
1. 后出的事实优先于先出的（角色可以成长变化）
2. 高 confidence 事实优先于低 confidence 事实
3. 矛盾事实中，选择更符合角色弧线的那个
4. 被弃用的事实标记为 deprecated，说明原因
5. 语义重复的事实合并为一条`,
      userPrompt: `需要仲裁的角色事实：
${JSON.stringify(charsWithMultiple, null, 2)}

角色基本信息：
${JSON.stringify(state.characters.filter((c) => charsWithMultiple.some((x) => x.characterId === c.id)), null, 2)}

请对每个角色的事实进行仲裁：
- confirmed: 保留的事实
- deprecated: 弃用的事实（说明原因）
- merged: 合并到另一条的事实（指明 mergedInto）`,
      temperature: 0.2,
    });

    this.logger.log(
      `[Maintenance] canon_arbitration: 处理了 ${result.conflictPairsResolved} 对冲突`,
    );

    if (result.resolvedFacts.length === 0) return state;

    const updatedFacts = [...facts];
    for (const resolved of result.resolvedFacts) {
      const idx = updatedFacts.findIndex(
        (f) => f.characterId === resolved.characterId && f.fact === resolved.fact,
      );
      if (idx >= 0 && resolved.status === 'deprecated') {
        updatedFacts[idx] = { ...updatedFacts[idx], status: 'deprecated' };
      }
    }

    return { ...state, characterFactLedger: updatedFacts };
  }

  private async runThreadHealthCheck(state: StoryState): Promise<StoryState> {
    const threads = state.plotThreadLedger ?? [];
    const openThreads = threads.filter((t) => t.status === 'open');
    if (openThreads.length === 0) return state;

    const chapterNumber = state.chapterCursor - 1;

    const result = await this.llm.generateStructured({
      taskName: 'thread-health-check',
      schema: threadHealthResultSchema,
      systemPrompt: `你是伏线管理专家。
你的任务是检查所有开放伏线的健康度，并给出处理建议。

评估标准：
1. 新鲜度：伏线上次被触碰是多少章前？超过 5 章未触碰视为停滞。
2. 逾期度：如果伏线有计划的回收章节范围，是否已过期？
3. 密度：当前开放伏线总数是否过多？通常 5-8 条为健康范围，超过 12 条需要清理。
4. 优先级：哪些伏线应优先在接下来几章处理？`,
      userPrompt: `当前章节：${chapterNumber}

开放伏线（${openThreads.length} 条）：
${JSON.stringify(openThreads, null, 2)}

章节摘要（最近 10 章）：
${JSON.stringify(state.chapterSummaries.slice(-10), null, 2)}

请分析：
- healthyThreads: 健康伏线的 threadId 列表
- staleThreads: 停滞伏线，每条说明停滞时间和建议（touch_soon/payoff_soon/expire）
- overdueThreads: 逾期伏线，说明逾期情况和建议
- suggestedPrioritization: 接下来 3 章应优先处理的伏线 threadId 列表（按优先级排序）`,
      temperature: 0.3,
    });

    this.logger.log(
      `[Maintenance] thread_health_check: 健康 ${result.healthyThreads.length} | ` +
      `停滞 ${result.staleThreads.length} | 逾期 ${result.overdueThreads.length}`,
    );

    // Auto-expire threads recommended for expiration.
    const expireIds = new Set(
      result.staleThreads
        .filter((t) => t.recommendation === 'expire')
        .map((t) => t.threadId),
    );

    if (expireIds.size > 0) {
      const updatedLedger = threads.map((t) => {
        if (expireIds.has(t.id)) {
          return { ...t, status: 'expired' as const, lastTouchedChapter: chapterNumber };
        }
        return t;
      });

      const updatedOpenThreads = state.openPlotThreads.filter(
        (label) => !threads.some((t) => expireIds.has(t.id) && t.label === label),
      );

      return {
        ...state,
        plotThreadLedger: updatedLedger,
        openPlotThreads: updatedOpenThreads,
      };
    }

    return state;
  }

  private async planNextArc(state: StoryState): Promise<StoryState> {
    const chapterNumber = state.chapterCursor - 1;
    const arcRange = getArcChapterRange(state);

    // ── Volume boundary check: plan new volume if needed ──
    state = await this.ensureVolumeArc(state);

    const context = buildCompactContext(state, {
      maxCharacters: 12,
      maxChapterSummaries: 10,
      maxOpenThreads: 12,
      maxTimelineEvents: 15,
    });

    const completedArcs = state.completedArcs ?? [];
    const completedArcAcceptanceReports = state.completedArcAcceptanceReports ?? [];
    const currentArc = state.currentArc;
    let currentArcAcceptance = state.currentArcAcceptance;

    if (currentArc && currentArc.status === 'active') {
      completedArcs.push({ ...currentArc, status: 'completed' });
      const acceptance = this.evaluateArcAcceptance(state, currentArc, chapterNumber);
      completedArcAcceptanceReports.push(acceptance);
      currentArcAcceptance = acceptance;
      await Promise.all([
        this.generateArcSummary(state, currentArc, chapterNumber).catch((e) =>
          this.logger.warn(`[Maintenance] 弧摘要生成失败: ${e instanceof Error ? e.message : String(e)}`)),
        this.runRetrospectiveLearning(state, currentArc).then((lessons) => {
          if (lessons.length > 0) {
            state = { ...state, writingLessons: [...(state.writingLessons ?? []), ...lessons] };
            this.logger.log(`[Maintenance] 回顾学习：提炼${lessons.length}条写作教训`);
          }
        }).catch((e) => this.logger.warn(`[Maintenance] 回顾学习失败: ${e instanceof Error ? e.message : String(e)}`)),
      ]);
    }

    const arcHistory = completedArcs.map((a) => ({
      标题: a.arcTitle,
      章节范围: `${a.startChapter}-${a.plannedEndChapter}`,
      核心张力: a.coreTension,
      类型: a.arcType,
      叙事技法: a.narrativeTechnique ?? 'linear',
      高潮模式: a.climaxPattern ?? '',
    }));

    const nr = state.noveltyRegistry ?? { usedArcTypes: [], usedNarrativeTechniques: [], usedCooldownTags: [], usedClimaxPatterns: [], lastArcTypes: [] };
    const usedTechniques = nr.usedNarrativeTechniques.map((t) => t.technique);
    const freshTechniques = ['linear', 'flashback', 'parallel_pov', 'in_medias_res', 'countdown',
      'mystery_reveal', 'unreliable_narrator', 'time_skip_montage', 'epistolary',
      'bottle_episode', 'slow_burn_reveal', 'dual_timeline', 'heist_plan',
    ].filter((t) => !usedTechniques.includes(t));

    const sec = await this.loadSections(state.bookId);
    const newArc = await this.llm.generateStructured({
      taskName: 'arc-planning',
      schema: miniArcSchema,
      systemPrompt: `你是一位擅长节奏控制的网文策划师。规划接下来${arcRange.min}-${arcRange.max}章的"卷计划"。

=== 新鲜感要求（重要）===
${nr.lastArcTypes.length > 0 ? `最近卷类型序列：${nr.lastArcTypes.join('→')}——本卷arcType禁止和最近一个相同。` : ''}
${usedTechniques.length > 0 ? `已用叙事技法：${usedTechniques.join('、')}——优先使用未用过的技法。` : ''}
${freshTechniques.length > 0 ? `推荐优先尝试：${freshTechniques.slice(0, 5).join('、')}` : ''}
${nr.usedClimaxPatterns.length > 0 ? `已用高潮模式：${nr.usedClimaxPatterns.join('、')}——本卷climaxPattern必须不同。` : ''}
narrativeTechnique 字段必须从枚举中选择一个最适合本卷的叙事技法。
structuralInnovation 字段用一句话描述本卷的叙事创新点。
climaxPattern 字段描述本卷高潮的模式（如"boss战""揭秘""背叛反转""牺牲""大逃离""禁术觉醒"）。

=== 四幕结构（适配${arcRange.min}-${arcRange.max}章长卷） ===
${sec['agent:arc-planner:structure'] ?? '1) 第一幕-铺垫（~25%）：建立本卷冲突、引入新角色/势力、埋下本卷核心悬念。\n2) 第二幕-升温（~35%）：多条支线交织推进，角色内外压力递增，至少包含1-2个小爽点。\n3) 第三幕-高潮（~25%）：核心冲突爆发、角色面临最艰难选择、大爽点、情感高潮。\n4) 第四幕-余韵（~15%）：善后+伏笔下卷+角色内心消化，留更大悬念拉入下一卷。'}
${sec['agent:arc-planner:pacing'] ?? '- 爽感循环：每卷至少2个完整"压制→准备→爆发"循环（长卷容纳更多层次）。\n- 呼吸节奏：连续2-3章紧张后需1章缓冲，但缓冲章也要暗推支线。\n- 角色深度：长卷有足够空间展开角色弧线——日常互动和内心挣扎比密集剧情更能塑造立体角色。'}

=== 情感主题规划 ===
${sec['agent:arc-planner:emotion_theme'] ?? '每卷必须有一个情感主题——角色内心成长的维度，和剧情主线平行但更深入：\n- 例：第一卷剧情是"在宗门站稳脚跟"，情感主题是"孤独者找到归属"\n- 例：第二卷剧情是"应对势力阴谋"，情感主题是"信任被背叛后如何重建"\n- 卷的高潮不只是战力高潮，也应该是情感高潮。'}

=== chapterBeats ===
role（结构分类）：setup/escalation/twist/climax/aftermath/transition
technique（叙事技法，中文自由填写）：描述本章的具体叙事手法，如"打脸逆转""突破蜕变""暗线揭晓""奇遇机缘""权谋布局""日常温馨""悬崖勾引""连锁爆发"等，不受固定枚举约束。
tensionLevel 参考：setup 3-5, escalation 5-7, twist 7-9, climax 9-10, aftermath 2-4, transition 3-5

=== satisfactionType ===
${sec['agent:arc-planner:satisfaction'] ?? '- none: 普通推进\n- minor_payoff: 小爽点（打脸、小升级）\n- major_payoff: 大爽点（boss战、重大揭露）\n- emotional_peak: 情感高潮（告白/离别/重逢/醒悟）\n- relief: 喘息（日常/搞笑/温馨）\n至少包含 1 个 major_payoff 和 1 个 relief。'}

=== 卷合同字段（必须输出） ===
${sec['agent:arc-planner:output_contract'] ?? '- arcType/triggerReason/entryCondition/exitCondition 必须填写\n- narrativeTechnique: 必须从枚举中选择（优先未用过的技法）\n- climaxPattern: 不能与已用模式重复\n- mustPayoffThreadIds 优先从当前 open thread 中选 1-3 条\n- rewardLossLedger 三个列表都要填写\n- antagonistMilestones 至少 1 条\n- chapterBeats 每个节拍必须填写 technique 字段'}`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

已完成的卷（含类型和技法，避免重复）：
${arcHistory.length > 0 ? JSON.stringify(arcHistory, null, 2) : '无（这是第一卷）'}

当前位置：第 ${chapterNumber} 章已写完，即将开始第 ${chapterNumber + 1} 章。
${state.seed.mainStoryGoal ? `\n全书主线目标：${state.seed.mainStoryGoal}\n本卷的核心张力和剧情推进在宏观上应服务于主线目标——不需要每卷都直接推进，但不能偏离或遗忘。\n` : ''}
请规划下一卷：
- arcId: "arc_" + 序号（如 arc_1, arc_2）
- arcTitle: 本卷标题（有冲突感）
- startChapter: ${chapterNumber + 1}
- plannedEndChapter: startChapter + ${arcRange.min - 1}~${arcRange.max - 1}（本系统配置为 ${arcRange.min}-${arcRange.max} 章一卷）
- coreTension: 本卷的核心张力是什么
- climaxChapter: 哪一章是高潮
- arcType/triggerReason/entryCondition/exitCondition 必须填写
- narrativeTechnique: 必须从枚举中选择（优先未用过的技法）
- structuralInnovation: 一句话描述本卷叙事创新（不能为空）
- climaxPattern: 本卷高潮模式（不能与已用模式重复）
- mustPayoffThreadIds 优先从当前 open thread 中选 1-3 条
- rewardLossLedger 三个列表都要填写（即使是短语）
- antagonistMilestones 至少 1 条
- chapterBeats: 每章的节奏角色、张力等级、简要目标、爽感类型
- 至少包含 1 个 major_payoff 和 1 个 relief`,
      temperature: 0.6,
    });

    this.logger.log(
      `[Maintenance] arc_planning: 新卷「${newArc.arcTitle}」${newArc.startChapter}-${newArc.plannedEndChapter} ` +
      `高潮章: ${newArc.climaxChapter} | 技法: ${newArc.narrativeTechnique} | 高潮模式: ${newArc.climaxPattern}`,
    );

    const updatedRegistry = { ...nr };
    updatedRegistry.usedArcTypes = [...nr.usedArcTypes, { arcType: newArc.arcType, arcId: newArc.arcId }];
    updatedRegistry.usedNarrativeTechniques = [...nr.usedNarrativeTechniques, { technique: newArc.narrativeTechnique, arcId: newArc.arcId }];
    if (newArc.cooldownTag) updatedRegistry.usedCooldownTags = [...new Set([...nr.usedCooldownTags, newArc.cooldownTag])];
    if (newArc.climaxPattern) updatedRegistry.usedClimaxPatterns = [...new Set([...nr.usedClimaxPatterns, newArc.climaxPattern])];
    updatedRegistry.lastArcTypes = [...nr.lastArcTypes.slice(-4), newArc.arcType];

    return {
      ...state,
      currentArc: newArc,
      completedArcs,
      currentArcAcceptance,
      completedArcAcceptanceReports,
      noveltyRegistry: updatedRegistry,
    };
  }

  private evaluateArcAcceptance(
    state: StoryState,
    arc: StoryState['currentArc'],
    chapterNumber: number,
  ): ArcAcceptanceReport {
    const safeArc = arc!;
    const expectedRange = Math.max(1, safeArc.plannedEndChapter - safeArc.startChapter + 1);
    const coveredRange = Math.max(
      0,
      Math.min(chapterNumber, safeArc.plannedEndChapter) - safeArc.startChapter + 1,
    );
    const goalCompletionScore = Math.max(0, Math.min(1, coveredRange / expectedRange));

    const mustPayoff = safeArc.mustPayoffThreadIds ?? [];
    const threadById = new Map((state.plotThreadLedger ?? []).map((t) => [t.id, t] as const));
    const missingPayoffThreadIds = mustPayoff.filter((id) => {
      const thread = threadById.get(id);
      return !thread || thread.status === 'open';
    });
    const mustPayoffCompletionScore =
      mustPayoff.length === 0
        ? 1
        : (mustPayoff.length - missingPayoffThreadIds.length) / mustPayoff.length;

    const activeCuriosities = state.readerTension?.activeCuriosities ?? [];
    const overdueCuriosities = activeCuriosities.filter(
      (c) => chapterNumber - (c.seededAtChapter ?? chapterNumber) >= 15,
    ).length;
    const chaptersSinceLastPayoff = state.readerTension?.chaptersSinceLastPayoff ?? 0;
    let readerTensionResolutionScore = 1 - Math.min(1, overdueCuriosities / 3);
    if (chaptersSinceLastPayoff >= 8) readerTensionResolutionScore -= 0.2;
    if (chaptersSinceLastPayoff >= 12) readerTensionResolutionScore -= 0.2;
    readerTensionResolutionScore = Math.max(0, Math.min(1, readerTensionResolutionScore));

    const newOpenThreads = (state.plotThreadLedger ?? []).filter(
      (t) =>
        t.status === 'open' &&
        t.setupChapter >= safeArc.startChapter &&
        t.setupChapter <= chapterNumber,
    ).length;

    const overallPass =
      goalCompletionScore >= 0.9 &&
      mustPayoffCompletionScore >= 0.8 &&
      readerTensionResolutionScore >= 0.55;

    const actions: string[] = [];
    if (missingPayoffThreadIds.length > 0) {
      actions.push(`优先回收伏线：${missingPayoffThreadIds.slice(0, 3).join('、')}`);
    }
    if (readerTensionResolutionScore < 0.55) {
      actions.push('下一卷前2章安排至少1次明确揭晓，降低读者疑问积压');
    }
    if (newOpenThreads > 3) {
      actions.push('减少新开坑，优先消化现有冲突线');
    }
    if (actions.length === 0) {
      actions.push('卷目标达成，按计划切换到下一卷');
    }

    const summary =
      `卷验收：目标达成 ${(goalCompletionScore * 100).toFixed(0)}%，` +
      `伏线回收 ${(mustPayoffCompletionScore * 100).toFixed(0)}%，` +
      `张力清偿 ${(readerTensionResolutionScore * 100).toFixed(0)}%。` +
      (overallPass ? '通过。' : '未完全通过，建议补偿。');

    return {
      arcId: safeArc.arcId,
      arcTitle: safeArc.arcTitle,
      evaluatedAtChapter: chapterNumber,
      evaluationType: 'end_arc',
      goalCompletionScore,
      mustPayoffCompletionScore,
      readerTensionResolutionScore,
      overallPass,
      missingPayoffThreadIds,
      newOpenThreads,
      summary,
      actions,
    };
  }

  private async anchorStyle(state: StoryState): Promise<StoryState> {
    const chapterNumber = state.chapterCursor - 1;

    const bestChapters = await this.chapterRepo
      .createQueryBuilder('ch')
      .where('ch.bookId = :bookId', { bookId: state.bookId })
      .orderBy('ch.chapterNumber', 'DESC')
      .take(5)
      .getMany();

    if (bestChapters.length === 0) return state;

    const sampleParagraphs: string[] = [];
    const dialogueSamples: string[] = [];
    const actionSamples: string[] = [];
    const emotionSamples: string[] = [];
    for (const ch of bestChapters.slice(0, 4)) {
      const paragraphs = ch.content.split(/\n\n+/).filter((p) => p.trim().length > 50);
      for (const p of paragraphs.slice(0, 15)) {
        const hasDialogue = /["「].+?["」]/.test(p);
        const hasAction = p.length > 80 && /[打斩冲跃挥劈撞闪扑逃追]|[剑刀拳掌枪]|碰撞|爆炸|冲刺|闪避|猛地|一把|飞速/.test(p);
        const hasEmotion = /[心胸眼眸]|[怒哀喜惧]|沉默|颤抖|咬/.test(p) && !hasDialogue;
        if (hasDialogue && dialogueSamples.length < 2) dialogueSamples.push(p.slice(0, 300));
        else if (hasAction && actionSamples.length < 2) actionSamples.push(p.slice(0, 300));
        else if (hasEmotion && emotionSamples.length < 2) emotionSamples.push(p.slice(0, 300));
        else if (sampleParagraphs.length < 3 && p.length > 80) sampleParagraphs.push(p.slice(0, 300));
      }
    }

    const allSamples = [...sampleParagraphs, ...dialogueSamples, ...actionSamples, ...emotionSamples];
    if (allSamples.length === 0) return state;

    const styleSec = await this.loadSections(state.bookId);
    const anchor = await this.llm.generateStructured({
      taskName: 'style-anchoring',
      schema: styleAnchorSchema,
      systemPrompt: `你是一位顶级文风分析专家，专门研究中文网文的"文风DNA"。你需要从文本样本中提取深层风格特征——不是笼统的描述，而是具体到可以指导写作的"配方"。

分析维度：
${styleSec['agent:style-anchoring:analysis_dimensions'] ?? '1. 修辞指纹（metaphorStyle）：偏爱什么类型的比喻？通感、具象化、古诗化、口语化？\n2. 描写手法（descriptionApproach）：白描还是工笔？多用短句还是长句堆叠？\n3. 情绪技法（emotionTechnique）：直接写"他感到悲伤"还是用环境/动作/感官间接表达？\n4. 节奏签名（rhythmSignature）：紧张时句式怎么变？平静时段落密度如何？\n5. 招牌技法（signatureTechniques）：最独特的2-3个写作技巧+原文示例。\n6. 场景密度（proseDensityMap）：动作戏、对话戏、情感戏各用什么密度？\n7. 反模式（antiPatterns）：应避免什么具体表达？'}

${styleSec['agent:style-anchoring:output_guide'] ?? '输出要精练、可操作——后续AI写手会以此为"文风宪法"保持风格一致。'}`,
      userPrompt: `以下是这部小说的代表性文字样本：

通用段落：
${sampleParagraphs.map((p, i) => `[样本${i + 1}]\n${p}`).join('\n\n')}
${dialogueSamples.length > 0 ? `\n对话段落：\n${dialogueSamples.map((p, i) => `[对话${i + 1}]\n${p}`).join('\n\n')}` : ''}
${actionSamples.length > 0 ? `\n动作段落：\n${actionSamples.map((p, i) => `[动作${i + 1}]\n${p}`).join('\n\n')}` : ''}
${emotionSamples.length > 0 ? `\n情感段落：\n${emotionSamples.map((p, i) => `[情感${i + 1}]\n${p}`).join('\n\n')}` : ''}

题材：${state.seed.genre}，目标读者：${state.seed.targetAudience}

请深度分析文风DNA并输出所有字段：
- sampleParagraphs: 选取 2-3 段最能代表文风的短段落
- narrativeVoice: 叙事腔调
- pacePreference: 节奏偏好
- dialogueStyle: 对话风格
- proseTexture: { metaphorStyle, descriptionApproach, emotionTechnique, transitionStyle }
- signatureTechniques: 2-3个招牌技法[{ name, description, example }]
- rhythmSignature: { avgSentenceLength, paragraphDensity, dialogueRatio, actionPace, quietPace }
- proseDensityMap: { action, dialogue, emotion, worldbuilding, transition }
- antiPatterns: 5-8个本书应避免的具体表达
- anchoredAtChapter: ${chapterNumber}`,
      temperature: 0.3,
    });

    this.logger.log(
      `[Maintenance] style_anchoring: 文风DNA锚定完成 | 叙事:${anchor.narrativeVoice.slice(0, 40)} | 招牌技法:${anchor.signatureTechniques?.length ?? 0}个 | 反模式:${anchor.antiPatterns?.length ?? 0}个`,
    );

    return { ...state, styleAnchor: anchor };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 记忆金字塔：弧级摘要生成
  // ═══════════════════════════════════════════════════════════════════════════

  private async generateArcSummary(state: StoryState, arc: StoryState['currentArc'], chapterNumber: number): Promise<void> {
    const safeArc = arc!;
    const chapters = await this.chapterRepo.createQueryBuilder('ch')
      .where('ch.bookId = :bookId AND ch.chapterNumber BETWEEN :start AND :end', { bookId: state.bookId, start: safeArc.startChapter, end: chapterNumber })
      .orderBy('ch.chapterNumber', 'ASC').getMany();
    if (chapters.length === 0) return;

    const chapterBriefs = chapters.map((ch) => `[第${ch.chapterNumber}章·${ch.title}] ${ch.content.slice(0, 200)}...`).join('\n');
    const resolvedThreads = (state.plotThreadLedger ?? []).filter((t) =>
      t.status !== 'open' && t.lastTouchedChapter >= safeArc.startChapter && t.lastTouchedChapter <= chapterNumber,
    ).map((t) => t.label);
    const newThreads = (state.plotThreadLedger ?? []).filter((t) =>
      t.setupChapter >= safeArc.startChapter && t.setupChapter <= chapterNumber,
    ).map((t) => t.label);

    const output = await this.llm.generateStructured({
      taskName: 'arc-summary-pyramid',
      schema: arcSummaryOutputSchema,
      systemPrompt: `你是故事摘要专家。为刚结束的「卷/弧」生成结构化摘要，供后续章节远程记忆召回使用。
要求：summary 300-500字，概括本弧核心剧情发展、角色成长、情感主线；emotionalArc 一句话描述情感走向；keywords 用于语义检索。`,
      userPrompt: `弧信息：
- 标题：${safeArc.arcTitle}（${safeArc.startChapter}-${chapterNumber}章）
- 核心张力：${safeArc.coreTension}
- 情感主题：${safeArc.emotionalTheme || '未定义'}

章节概要：
${chapterBriefs}

已回收伏线：${resolvedThreads.join('、') || '无'}
新开伏线：${newThreads.join('、') || '无'}

角色（本弧出场）：
${state.characters.slice(0, 12).map((c) => `${c.name}(${c.role}): ${c.archetype} | ${c.status?.state ?? ''}`).join('\n')}

请生成弧摘要。`,
      temperature: 0.3,
    });

    await this.memoryRetriever.persistArcSummary(state.bookId, {
      bookId: state.bookId, arcId: safeArc.arcId, arcTitle: safeArc.arcTitle,
      startChapter: safeArc.startChapter, endChapter: chapterNumber,
      summary: output.summary, keyCharacterArcs: output.keyCharacterArcs,
      resolvedThreads: output.resolvedThreads, newThreadsPlanted: output.newThreadsPlanted,
      emotionalArc: output.emotionalArc, keyTurningPoints: output.keyTurningPoints,
      worldStateChanges: output.worldStateChanges, keywords: output.keywords,
    } as any);
    this.logger.log(`[Maintenance] 弧摘要生成完成：「${safeArc.arcTitle}」${safeArc.startChapter}-${chapterNumber}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 记忆金字塔：卷级摘要生成
  // ═══════════════════════════════════════════════════════════════════════════

  private async generateVolumeSummary(state: StoryState, vol: StoryState['currentVolume'], chapterNumber: number): Promise<void> {
    const safeVol = vol!;
    const arcsInVol = (state.completedArcs ?? []).filter((a) =>
      a.startChapter >= safeVol.startChapter && a.startChapter <= chapterNumber,
    );
    const arcBriefs = arcsInVol.map((a) => `「${a.arcTitle}」(${a.startChapter}-${a.plannedEndChapter}章): ${a.coreTension}`).join('\n');

    const output = await this.llm.generateStructured({
      taskName: 'volume-summary-pyramid',
      schema: volumeSummaryOutputSchema,
      systemPrompt: `你是故事摘要专家。为刚结束的「大卷」生成宏观摘要，供后续卷的远程记忆召回使用。
要求：summary 500-800字，宏观概括本卷剧情、主角成长、世界观展开；powerProgression 描述实力变化；keywords 用于语义检索。`,
      userPrompt: `卷信息：
- 标题：${safeVol.title}（第${safeVol.volumeNumber}卷，${safeVol.startChapter}-${chapterNumber}章）
- 核心矛盾：${safeVol.coreConflict}
- 实力成长路线：${safeVol.powerProgression.startLevel} → ${safeVol.powerProgression.endLevel}（${safeVol.powerProgression.growthPath}）
- 主题焦点：${safeVol.thematicFocus}

包含弧：
${arcBriefs || '无独立弧记录'}

角色概况（核心角色）：
${state.characters.filter((c) => c.role === 'protagonist').map((c) => `${c.name}(${c.role}): ${c.archetype} | ${c.status?.state ?? ''}`).join('\n')}

请生成卷级摘要。`,
      temperature: 0.3,
    });

    await this.memoryRetriever.persistVolumeSummary(state.bookId, {
      bookId: state.bookId, volumeId: safeVol.volumeId, volumeNumber: safeVol.volumeNumber,
      title: safeVol.title, startChapter: safeVol.startChapter, endChapter: chapterNumber,
      summary: output.summary, powerProgression: output.powerProgression,
      majorPlotMovements: output.majorPlotMovements, characterGrowth: output.characterGrowth,
      worldExpansion: output.worldExpansion, arcIds: arcsInVol.map((a) => a.arcId),
      keywords: output.keywords,
    } as any);
    this.logger.log(`[Volume] 卷摘要生成完成：「${safeVol.title}」${safeVol.startChapter}-${chapterNumber}`);
  }

  private async runRetrospectiveLearning(state: StoryState, arc: NonNullable<StoryState['currentArc']>): Promise<WritingLesson[]> {
    return this.retrospectiveLearner.analyze(state, arc.arcId, [arc.startChapter, arc.plannedEndChapter]);
  }
}
