/**
 * 卷级导演（步骤 1）：
 * 把卷合同翻译成单章可执行指令，约束意图层不要偏离卷目标。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import {
  ArcDirectorDirective,
  StoryState,
  arcDirectorDirectiveSchema,
} from '../../schemas/novel-state.schemas';
import { buildArcContext, buildCompactContext, UNIFIED_AGENT_MAX_CHARACTERS } from '../../prompting/novel-playbook';
import { buildAudiencePromptBlock } from '../../prompting/audience-directive';

const STAGE_HINT_BY_BEAT_ROLE: Record<string, ArcDirectorDirective['arcStage']> = {
  setup: 'entry',
  escalation: 'build',
  twist: 'twist',
  climax: 'climax',
  aftermath: 'aftermath',
  transition: 'transition',
  introspective: 'build',
  fragmentary: 'build',
  atmospheric: 'entry',
};

const TECHNIQUE_GUIDES: Record<string, (progress: number) => string> = {
  flashback: (p) => p < 0.3 ? '本章可穿插短回忆片段，为当前事件提供情感锚点' : p > 0.7 ? '回忆线和现实线开始交汇，真相浮现' : '回忆片段逐渐揭示关键信息，与当前主线形成对比',
  parallel_pov: (p) => p < 0.5 ? '本章可切换到另一视角，展现同一事件的不同侧面' : '多视角信息开始交汇，读者拼出全貌',
  in_medias_res: (p) => p < 0.15 ? '从高潮/紧张时刻开始叙述，制造强烈悬念' : '逐步回溯事件起因，解释开头的震撼场面',
  countdown: (p) => `时间压力是本卷核心驱动力，本章进度${Math.round(p * 100)}%，紧迫感应随进度递增`,
  mystery_reveal: (p) => p < 0.3 ? '抛出新线索或加深谜团' : p > 0.8 ? '核心谜底揭晓的时机' : '每章揭示一层真相，但制造新疑问',
  unreliable_narrator: () => '视角人物的叙述可能带有偏见或遗漏，暗示真实情况与叙述有偏差',
  time_skip_montage: (p) => p < 0.2 ? '快速蒙太奇推进时间线' : '聚焦关键时间节点',
  epistolary: () => '可穿插书信/日记/告示等文本形式丰富叙事',
  bottle_episode: () => '限定空间叙事——角色被困在有限环境中，通过对话和互动推动剧情',
  slow_burn_reveal: (p) => p < 0.6 ? '缓慢积累异常信号，读者隐约察觉但无法确认' : '异常爆发，之前的蛛丝马迹全部串联',
  dual_timeline: (p) => p < 0.7 ? '两条时间线交替叙述，暗示彼此关联' : '双线交汇，真相大白',
  heist_plan: (p) => p < 0.3 ? '展示计划/策略部署' : p > 0.7 ? '计划执行中遭遇意外变数' : '按计划推进但暗示隐患',
};

@Injectable()
export class ArcDirectorAgent {
  private readonly logger = new Logger(ArcDirectorAgent.name);

  constructor(private readonly llm: LlmService) {}

  async direct(
    state: StoryState,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ArcDirectorDirective> {
    const chapterNumber = state.chapterCursor;
    const arc = state.currentArc;
    if (!arc) return this.buildOffArcDirective(chapterNumber, state.seed.writingMode === 'literary');

    const context = buildCompactContext(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 4,
      maxOpenThreads: 10,
      maxTimelineEvents: 10,
    });
    const currentBeat = arc.chapterBeats.find((b) => b.chapterNumber === chapterNumber);
    const stageHint = currentBeat
      ? (STAGE_HINT_BY_BEAT_ROLE[currentBeat.role] ?? 'build')
      : this.estimateStageFromProgress(
          chapterNumber,
          arc.startChapter,
          arc.plannedEndChapter,
          arc.climaxChapter,
        );

    const openThreadsById = new Map((state.plotThreadLedger ?? []).map((t) => [t.id, t]));
    const mustPayoffThreads = (arc.mustPayoffThreadIds ?? []).map((id) => {
      const thread = openThreadsById.get(id);
      return {
        id,
        label: thread?.label ?? id,
        status: thread?.status ?? 'unknown',
        age: thread ? chapterNumber - thread.setupChapter : null,
        plannedPayoffEndChapter: thread?.plannedPayoffEndChapter ?? null,
      };
    });

    const dueMilestones = (arc.antagonistMilestones ?? [])
      .filter((m) => m.chapterNumber <= chapterNumber + 1)
      .slice(0, 5);

    const bank = state.foreshadowingBank ?? { deposits: [], totalPlanted: 0, totalResolved: 0 };
    const upcomingPayoffs = bank.deposits.filter(
      (d) => d.status === 'planted' && 
             d.payoffWindow.earliestChapter > chapterNumber && 
             d.payoffWindow.earliestChapter <= chapterNumber + 3
    );

    const upcomingBeats = arc.chapterBeats
      .filter((b) => b.chapterNumber >= chapterNumber)
      .slice(0, 4)
      .map((b) => ({
        chapterNumber: b.chapterNumber,
        role: b.role,
        technique: b.technique,
        tensionLevel: b.tensionLevel,
        briefGoal: b.briefGoal,
      }));

    const techniqueHint = this.buildTechniqueHint(arc, chapterNumber);

    const characterGuidance = (state.currentVolume?.characterGoals ?? []).map((g) => ({
      characterId: g.characterId,
      characterName: g.characterName,
      volumeStartState: g.volumeStartState,
      volumeEndState: g.volumeEndState,
      keyMoments: g.keyMoments ?? [],
    }));

    const isLiterary = state.seed.writingMode === 'literary';
    const directive = await this.llm.generateStructured({
      taskName: 'arc-director',
      schema: arcDirectorDirectiveSchema,
      tags: ['workflow', 'chapter', 'arc-director'],
      metadata: {
        userId: state.userId,
        bookId: state.bookId,
        chapterNumber,
        arcId: arc.arcId,
      },
      systemPrompt: `${playbooks?.['agent:arc-director:role'] ?? (isLiterary
        ? '你是小说项目的卷级导演（Arc Director）。\n你的职责：把"卷合同"转成"本章创作方向"，在主题一致性的框架下给予作者充分的创作自由。'
        : '你是网文项目的卷级导演（Arc Director）。\n你的职责：把"卷合同"转成"本章执行指令"，确保章节不会偏离卷级目标。')}
${techniqueHint}
输出要求：
${playbooks?.['agent:arc-director:output_rules'] ?? '- chapterNumber 必须是当前章号。\n- arcId 必须等于当前卷 arcId。\n- arcStage 只能从当前节拍和卷进度推导，禁止随意跳阶段。\n- chapterMission 必须是一个可执行动作句，避免空话。参考当前节拍的technique（叙事技法）来制定具体策略。\n- mustHit: 1-4 条，本章必须达成。\n- shouldAvoid: 1-4 条，本章应规避，尤其是破坏卷节奏的行为。\n- payoffThreadIds: 只能从卷合同 mustPayoffThreadIds 中选择，最多 3 条。\n- antagonistPressure: 描述反派/对手在本章的压力表现（可为心理、资源、行动）。\n- hookDirective: 指明本章结尾如何衔接下一章（对应当前 arcStage）。\n- pacingDirective: 指明节奏目标（快/中/慢 + 张力变化）。\n- riskBudget: entry/aftermath/transition 以 low/medium 为主；build/twist 以 medium 为主；climax 允许 high'}

纪律：
${playbooks?.['agent:arc-director:discipline'] ?? (isLiterary
  ? '- 不重复卷合同原文，要转为"本章创作方向"。\n- 若当前章超出卷区间，使用 transition 或 off_arc 思路收束。\n- 指令必须服务主题深度：可以是冲突推进，也可以是内在探索、氛围构建、关系深化。不强制每章都有显性冲突或悬念钩子。'
  : '- 不重复卷合同原文，要转为"本章执行指令"。\n- 若当前章超出卷区间，使用 transition 或 off_arc 思路收束，不得硬拉高潮。\n- 指令必须服务读者体验：明确冲突、明确推进、明确钩子。')}

${buildAudiencePromptBlock(state)}
${playbooks?.['__bookStrategy'] ?? ''}
${playbooks?.['__policySlice'] ?? ''}
${this.buildNameGrowthArcHint(state, stageHint)}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `当前章：第${chapterNumber}章
阶段提示：${stageHint}
${state.currentVolume ? `\n大卷上下文（第${state.currentVolume.volumeNumber}卷「${state.currentVolume.title}」）：\n- 核心冲突：${state.currentVolume.coreConflict}\n- 成长路线：${state.currentVolume.powerProgression.startLevel} → ${state.currentVolume.powerProgression.endLevel}\n- 主题焦点：${state.currentVolume.thematicFocus}\n- MiniArc槽位：${state.currentVolume.miniArcSlots.length}个\n${state.currentVolume.structuralInnovation ? '- 本卷叙事创新：' + state.currentVolume.structuralInnovation + '\n' : ''}` : ''}
卷合同：
${JSON.stringify(buildArcContext(arc, chapterNumber), null, 2)}

当前节拍：
${JSON.stringify(currentBeat ?? null, null, 2)}

即将到来的节拍（最多4个）：
${JSON.stringify(upcomingBeats, null, 2)}

卷要求回收伏线（含状态）：
${JSON.stringify(mustPayoffThreads, null, 2)}

反派里程碑（本章及下一章到期）：
${JSON.stringify(dueMilestones, null, 2)}

即将回收的伏笔（唤醒期，请在 mustHit 或 shouldAvoid 中安排微弱的视觉/记忆唤醒）：
${JSON.stringify(upcomingPayoffs.map(d => ({ label: d.label, description: d.description })), null, 2)}

故事上下文：
${JSON.stringify(context, null, 2)}`,
      temperature: 0.35,
    });
    const normalized = this.enforceStrategyConstraints(state, directive);
    if (arc.arcId && normalized.arcId !== arc.arcId) { // LLM可能输出卷标题而非arcId格式，强制修正
      this.logger.warn(`[Chapter ${chapterNumber}] arc-director arcId 格式修正：「${normalized.arcId}」→「${arc.arcId}」`);
      normalized.arcId = arc.arcId;
    }
    return { ...normalized, characterGuidance };
  }

  private enforceStrategyConstraints(state: StoryState, directive: ArcDirectorDirective): ArcDirectorDirective {
    const strategy = state.bookStrategy;
    if (!strategy) return directive;
    const next = { ...directive };
    const allowedRisk = this.allowedRiskBudgetByStage(next.arcStage);
    if (!allowedRisk.includes(next.riskBudget)) {
      const original = next.riskBudget;
      next.riskBudget = this.pickNearestRiskBudget(allowedRisk, next.riskBudget);
      this.logger.log(`[Chapter ${next.chapterNumber}] arc-director riskBudget 钳制 ${original} -> ${next.riskBudget}`);
    }
    const threadMax = strategy.threadPolicy?.maxNewThreadsPerChapter;
    if (typeof threadMax === 'number' && threadMax <= 0) {
      const guard = '本章禁止引入新主支线，仅推进/回收现有伏线';
      if (!next.shouldAvoid.some((s) => s.includes('引入新') || s.includes('新支线'))) next.shouldAvoid.push(guard);
    }
    const isLit = state.seed.writingMode === 'literary';
    const endingDirective = strategy.hookCadencePolicy?.chapterEndingDirective?.trim();
    if (endingDirective && !next.hookDirective.includes(endingDirective)) {
      const fallback = isLit ? '结尾留有余韵或思考空间' : '结尾制造可追更入口';
      next.hookDirective = `${next.hookDirective || fallback}；${endingDirective}`;
    }
    return next;
  }

  private allowedRiskBudgetByStage(stage: ArcDirectorDirective['arcStage']): Array<ArcDirectorDirective['riskBudget']> {
    if (stage === 'climax') return ['medium', 'high'];
    if (stage === 'build' || stage === 'twist') return ['medium'];
    return ['low', 'medium'];
  }

  private pickNearestRiskBudget(
    allowed: Array<ArcDirectorDirective['riskBudget']>,
    current: ArcDirectorDirective['riskBudget'],
  ): ArcDirectorDirective['riskBudget'] {
    const rank: Record<ArcDirectorDirective['riskBudget'], number> = { low: 1, medium: 2, high: 3 };
    return [...allowed].sort((a, b) => Math.abs(rank[a] - rank[current]) - Math.abs(rank[b] - rank[current]))[0];
  }

  private buildTechniqueHint(arc: NonNullable<StoryState['currentArc']>, chapterNumber: number): string {
    const tech = arc.narrativeTechnique;
    if (!tech || tech === 'linear') return '';
    const span = Math.max(1, arc.plannedEndChapter - arc.startChapter);
    const progress = Math.max(0, Math.min(1, (chapterNumber - arc.startChapter) / span));
    const guide = TECHNIQUE_GUIDES[tech]?.(progress) ?? `本卷采用${tech}叙事技法`;
    return `\n=== 本卷叙事技法：${tech}（进度${Math.round(progress * 100)}%）===\n${guide}\n${arc.structuralInnovation ? '创新点：' + arc.structuralInnovation : ''}\nchapterMission 必须体现本卷叙事技法的要求。`;
  }

  private estimateStageFromProgress(
    chapterNumber: number,
    startChapter: number,
    endChapter: number,
    climaxChapter: number,
  ): ArcDirectorDirective['arcStage'] {
    if (chapterNumber <= startChapter) return 'entry';
    if (chapterNumber === climaxChapter) return 'climax';
    if (chapterNumber > endChapter) return 'transition';
    if (chapterNumber > climaxChapter) return 'aftermath';

    const span = Math.max(1, endChapter - startChapter);
    const progress = (chapterNumber - startChapter) / span;
    if (progress < 0.25) return 'entry';
    if (progress < 0.7) return 'build';
    return 'twist';
  }

  private buildNameGrowthArcHint(state: StoryState, stageHint: ArcDirectorDirective['arcStage']): string {
    if (stageHint !== 'entry' && stageHint !== 'climax') return '';
    const growthArc = state.seed.protagonistConcept.nameGrowthArc;
    if (!growthArc?.length) return '';
    const protagonist = state.characters.find((c) => c.id === 'char_protagonist');
    if (!protagonist) return '';
    const outlinePoints = state.roughOutline.points;
    const phaseIdx = this.resolveGrowthArcPhaseIndex(state.chapterCursor, outlinePoints.length, growthArc.length, state.roughOutline.estimatedTotalChapters ?? 0, outlinePoints.map((p) => p.tentativeChapterRange ?? ''));
    const idx = Math.max(0, Math.min(phaseIdx, growthArc.length - 1));
    const phase = growthArc[idx];
    return `\n=== 主角名此阶段的重量（可选激活，勿强求） ===\n` +
      `「${protagonist.name}」此阶段外界感受：${phase.interpretation}\n` +
      `主角内心感受：${phase.selfPerception}\n` +
      `若本章是阶段转折，可在 mustHit 中加入"让名字的含义在一个细节里自然升华"——一句话、一个停顿足矣，不必刻意。\n`;
  }

  private resolveGrowthArcPhaseIndex(
    chapter: number,
    outlineCount: number,
    growthCount: number,
    estimatedTotalChapters: number,
    ranges: string[],
  ): number {
    for (let i = 0; i < ranges.length; i++) {
      const parsed = this.parseChapterRange(ranges[i]);
      if (parsed && chapter >= parsed.start && chapter <= parsed.end) {
        return outlineCount === growthCount ? i : Math.floor((i / Math.max(1, outlineCount)) * growthCount);
      }
    }
    const total = Math.max(estimatedTotalChapters, chapter, 1);
    const progress = Math.max(0, Math.min(1, chapter / total));
    return Math.floor(progress * Math.max(1, growthCount));
  }

  private parseChapterRange(raw: string): { start: number; end: number } | null {
    if (!raw) return null;
    const nums = (raw.match(/\d+/g) ?? []).map((s) => parseInt(s, 10)).filter(Number.isFinite);
    if (nums.length < 2) return null;
    const start = Math.min(nums[0], nums[1]);
    const end = Math.max(nums[0], nums[1]);
    return { start, end };
  }

  private buildOffArcDirective(chapterNumber: number, isLiterary = false): ArcDirectorDirective {
    return {
      chapterNumber,
      arcStage: 'off_arc',
      chapterMission: isLiterary ? '推进主线或深化主题，为下一卷铺垫情感/认知基础' : '推进主线并制造下一卷入口，不做无铺垫的硬高潮',
      mustHit: [isLiterary ? '保证主题或人物有可感知深化' : '保证主线冲突有可感知推进'],
      shouldAvoid: ['不要临时引入无法回收的大体量支线'],
      payoffThreadIds: [],
      antagonistPressure: isLiterary ? '维持叙事张力，不必是外部对抗' : '维持背景压力，但不进行终局级摊牌',
      hookDirective: isLiterary ? '结尾留有余韵或引发思考' : '结尾给出下一段冲突入口或关键疑问',
      pacingDirective: isLiterary ? '采用适合当前情感状态的节奏' : '采用中速节奏，完成一次明确推进',
      riskBudget: 'medium',
    };
  }
}
