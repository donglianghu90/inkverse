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
import { ChapterEntity } from './entities/chapter.entity';
import {
  MaintenanceState,
  MaintenanceTrigger,
  StoryStateV2,
  MiniArc,
  StyleAnchor,
  crystallizedBibleSchema,
  roughOutlineSchema,
  miniArcSchema,
  styleAnchorSchema,
  consistencyAuditResultSchema,
  canonArbitrationResultSchema,
  threadHealthResultSchema,
} from './schemas/novel-v2.schemas';
import { buildCompactContextV2 } from './prompting/novel-playbook-v2';

const FIRST_CRYSTALLIZATION_CHAPTER = 3;
const NEW_CHARACTERS_THRESHOLD = 3;
const NEW_THREADS_THRESHOLD = 5;
const NEW_FACTS_THRESHOLD = 10;
const CONSECUTIVE_LOW_SCORE_THRESHOLD = 3;
const CONSECUTIVE_CONSISTENCY_WARNING_THRESHOLD = 2;
const MAX_CHAPTERS_WITHOUT_MAINTENANCE = 15;

@Injectable()
export class DeepMaintenanceService {
  private readonly logger = new Logger(DeepMaintenanceService.name);

  constructor(
    private readonly llm: LlmService,
    @InjectRepository(ChapterEntity)
    private readonly chapterRepo: Repository<ChapterEntity>,
  ) {}

  /**
   * Evaluate whether maintenance should trigger. Pure logic, no LLM.
   */
  evaluateTrigger(state: StoryStateV2): MaintenanceTrigger {
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
      reasons.push(`当前卷「${arc.arcTitle}」已到达计划结束章(${arc.plannedEndChapter})，需要规划下一卷`);
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
    state: StoryStateV2,
    trigger: MaintenanceTrigger,
  ): Promise<StoryStateV2> {
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

  // -------------------------------------------------------------------------
  // Task implementations
  // -------------------------------------------------------------------------

  private async crystallizeBible(state: StoryStateV2): Promise<StoryStateV2> {
    const context = buildCompactContextV2(state, {
      maxCharacters: 15,
      maxChapterSummaries: 20,
      maxOpenThreads: 15,
      maxTimelineEvents: 30,
    });
    const chapterNumber = state.chapterCursor - 1;

    const bible = await this.llm.generateStructured({
      taskName: 'bible-crystallization',
      schema: crystallizedBibleSchema,
      systemPrompt: `你是设定整理专家。
请从已有的故事内容中提炼一份 IP 圣经。
这不是创造新设定，而是把已经在故事中建立的内容整理成参考文件。
只记录已经在正文中确认的事实，不要编造未出现的内容。`,
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

  private async reviseOutline(state: StoryStateV2): Promise<StoryStateV2> {
    const context = buildCompactContextV2(state, {
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
- 保持 4-6 个节点的粗略程度`,
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

  private async runConsistencyAudit(state: StoryStateV2): Promise<StoryStateV2> {
    const context = buildCompactContextV2(state, {
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

  private async runCanonArbitration(state: StoryStateV2): Promise<StoryStateV2> {
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

  private async runThreadHealthCheck(state: StoryStateV2): Promise<StoryStateV2> {
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

  private async planNextArc(state: StoryStateV2): Promise<StoryStateV2> {
    const chapterNumber = state.chapterCursor - 1;
    const context = buildCompactContextV2(state, {
      maxCharacters: 12,
      maxChapterSummaries: 10,
      maxOpenThreads: 12,
      maxTimelineEvents: 15,
    });

    const completedArcs = state.completedArcs ?? [];
    const currentArc = state.currentArc;

    if (currentArc && currentArc.status === 'active') {
      completedArcs.push({ ...currentArc, status: 'completed' });
    }

    const arcHistory = completedArcs.map((a) => ({
      标题: a.arcTitle,
      章节范围: `${a.startChapter}-${a.plannedEndChapter}`,
      核心张力: a.coreTension,
    }));

    const newArc = await this.llm.generateStructured({
      taskName: 'arc-planning',
      schema: miniArcSchema,
      systemPrompt: `你是一位擅长节奏控制的网文策划师。
你的任务是规划接下来 5-10 章的"卷计划"。

网文节奏的核心原理：
1) 爽感循环：被压制/挑战 → 隐忍/准备 → 爆发/碾压 → 新的更大挑战。每卷至少一个完整循环。
2) 张力曲线：不能一直高潮，也不能一直平淡。setup(3-5) → escalation(5-7) → climax(8-9) → aftermath(3-4)。
3) 呼吸节奏：连续 2-3 章紧张后，需要 1 章缓冲（日常/搞笑/感情戏）。
4) 高潮章必须有明确的大爽点（boss战/真相揭露/情感高潮），不能是普通推进。
5) 每卷结束时必须留一个更大的悬念，把读者拉进下一卷。

chapterBeats 中每章的 role 选择：
- setup：铺垫新冲突、引入新角色/势力、建立背景。tensionLevel: 3-5。
- escalation：升级矛盾、加压、制造紧迫感。tensionLevel: 5-7。
- twist：出乎意料的转折。tensionLevel: 7-9。
- climax：本卷最高潮。tensionLevel: 9-10。
- aftermath：高潮后的善后、角色情感处理。tensionLevel: 2-4。
- transition：过渡到下一阶段。tensionLevel: 3-5。

satisfactionType 选择：
- none: 普通推进
- minor_payoff: 小爽点（打脸、小升级、揭露小秘密）
- major_payoff: 大爽点（boss战胜利、重大揭露）
- emotional_peak: 情感高潮（告白/离别/重逢）
- relief: 喘息（日常/搞笑/温馨）`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

已完成的卷：
${arcHistory.length > 0 ? JSON.stringify(arcHistory, null, 2) : '无（这是第一卷）'}

当前位置：第 ${chapterNumber} 章已写完，即将开始第 ${chapterNumber + 1} 章。

请规划下一卷：
- arcId: "arc_" + 序号（如 arc_1, arc_2）
- arcTitle: 本卷标题（有冲突感）
- startChapter: ${chapterNumber + 1}
- plannedEndChapter: startChapter + 4~9（5-10 章一卷）
- coreTension: 本卷的核心张力是什么
- climaxChapter: 哪一章是高潮
- chapterBeats: 每章的节奏角色、张力等级、简要目标、爽感类型
- 至少包含 1 个 major_payoff 和 1 个 relief`,
      temperature: 0.6,
    });

    this.logger.log(
      `[Maintenance] arc_planning: 新卷「${newArc.arcTitle}」${newArc.startChapter}-${newArc.plannedEndChapter} ` +
      `高潮章: ${newArc.climaxChapter}`,
    );

    return {
      ...state,
      currentArc: newArc,
      completedArcs,
    };
  }

  private async anchorStyle(state: StoryStateV2): Promise<StoryStateV2> {
    const chapterNumber = state.chapterCursor - 1;

    const bestChapters = await this.chapterRepo
      .createQueryBuilder('ch')
      .where('ch.bookId = :bookId', { bookId: state.bookId })
      .orderBy('ch.chapterNumber', 'DESC')
      .take(5)
      .getMany();

    if (bestChapters.length === 0) return state;

    const sampleParagraphs: string[] = [];
    for (const ch of bestChapters.slice(0, 3)) {
      const paragraphs = ch.content.split(/\n\n+/).filter((p) => p.trim().length > 50);
      if (paragraphs.length > 0) {
        const bestParagraph = paragraphs.reduce((a, b) => a.length > b.length ? a : b);
        sampleParagraphs.push(bestParagraph.slice(0, 300));
      }
    }

    if (sampleParagraphs.length === 0) return state;

    const anchor = await this.llm.generateStructured({
      taskName: 'style-anchoring',
      schema: styleAnchorSchema,
      systemPrompt: `你是一位文风分析专家。
请分析给定的文本样本，提炼出这部小说的稳定文风特征。
输出要精练、可操作——后续写手会参考这些描述来保持风格一致。`,
      userPrompt: `以下是这部小说的几段代表性文字：

${sampleParagraphs.map((p, i) => `段落${i + 1}：\n${p}`).join('\n\n')}

请分析并输出：
- sampleParagraphs: 选取 2-3 段最能代表本书文风的短段落（每段不超过 200 字）
- narrativeVoice: 叙事视角和腔调描述（如"第三人称限制视角，冷峻克制，偶尔插入内心独白"）
- pacePreference: 节奏偏好（如"中短段落为主，对话密度高，动作戏快切"）
- dialogueStyle: 对话风格（如"简洁利落，少用语气词，角色差异通过用词层次体现"）
- anchoredAtChapter: ${chapterNumber}`,
      temperature: 0.3,
    });

    this.logger.log(
      `[Maintenance] style_anchoring: 文风锚定完成 | 叙事: ${anchor.narrativeVoice.slice(0, 50)}...`,
    );

    return { ...state, styleAnchor: anchor };
  }
}
