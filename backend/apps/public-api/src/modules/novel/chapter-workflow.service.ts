/**
 * 章节工作流编排器 — 多轮质量门控版。
 *
 * 核心流程：
 * ① 卷级导演 → ② 意图 → ③ 连续性预检 → ④ 写作（可配置修复轮数）
 * → ⑤ 审阅+质量门控 → ⑥ 精编（可选）→ ⑦ 钩子优化（可选）→ ⑧ 记录
 *
 * 质量门控策略：
 * - 8.5 分通过 → 直接完成
 * - < 8.5 分 → 带 RewriteGuidance 重写（轮数可配置）
 * - 到达轮数上限后选最优稿
 * - 最优稿 < 7.0 → 触发 Editor 精修
 */
import { Injectable, Logger } from '@nestjs/common';
import { ArcDirectorAgent } from './agents/arc-director.agent';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { CharacterVoiceCoachAgent } from './agents/character-voice-coach.agent';
import { ScenePlannerAgent } from './agents/scene-planner.agent';
import { SceneStitcherAgent } from './agents/scene-stitcher.agent';
import { buildBookStrategyPromptBlock, buildPolicySliceBlock } from './prompting/book-strategy';
import { MemoryRetrieverService, LongRangeContext } from './memory-retriever.service';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';
import { NovelProgressService } from './novel-progress.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
import { RuleCompilerService } from './rule-compiler.service';
import { LlmTraceLoggerService } from './llm/llm-trace-logger.service';
import { CompileContext } from './schemas/rule-engine.schemas';
import { AgentNodeConfig } from './entities/book-agent-pipeline.entity';
import {
  ArcDirectorDirective,
  ChapterIntent,
  ChapterReview,
  ChapterScenePlan,
  DeterministicCheckResult,
  RewriteGuidance,
  SceneDraft,
  StoryState,
} from './schemas/novel-state.schemas';
import { ChapterDraft, LoreRecord } from './schemas/novel.schemas';
import { MEMORY_ACTIVATION_CHAPTER } from './prompting/novel-playbook';
import { mapBeatRoleToArcStage, mapBeatRoleToChapterType } from './prompting/chapter-type.utils';

import { DEFAULT_WORKFLOW_PARAMS } from './entities/book-agent-pipeline.entity';
const DEFAULT_QUALITY_PASS_SCORE = DEFAULT_WORKFLOW_PARAMS.qualityPassScore;
const DEFAULT_MAX_REPAIR_ROUNDS = DEFAULT_WORKFLOW_PARAMS.maxRepairRounds;
const EDITOR_POLISH_THRESHOLD = DEFAULT_WORKFLOW_PARAMS.editorPolishThreshold;
const HEARTBEAT_INTERVAL_MS = 15_000;

interface DraftAttempt {
  draft: ChapterDraft;
  review: ChapterReview;
  weightedScore: number;
  attemptNumber: number;
}

export interface ChapterWorkflowResult {
  arcDirective?: ArcDirectorDirective;
  intent: ChapterIntent;
  finalDraft: ChapterDraft;
  review: ChapterReview;
  deterministicCheck: DeterministicCheckResult;
  loreRecord: LoreRecord;
  voiceEvolution?: import('./agents/character-voice-coach.agent').VoiceEvolutionExtract;
  wasEdited: boolean;
  wasRewritten: boolean;
  overallScore: number;
  attemptCount: number;
  allAttemptScores: number[];
  bestAttemptIndex: number;
  qualityMetrics?: Record<string, unknown>;
}

export interface ChapterWorkflowRuntimeOptions {
  maxRepairRounds?: number;
  qualityPassScore?: number;
}

@Injectable()
export class ChapterWorkflowService {
  private readonly logger = new Logger(ChapterWorkflowService.name);

  constructor(
    private readonly arcDirector: ArcDirectorAgent,
    private readonly intentAgent: IntentAgent,
    private readonly creativeWriter: CreativeWriterAgent,
    private readonly reviewer: ReviewerAgent,
    private readonly editor: EditorAgent,
    private readonly recorder: RecorderAgent,
    private readonly continuityGuard: ContinuityGuardAgent,
    private readonly hookCrafter: HookCrafterAgent,
    private readonly pacingAnalyzer: PacingAnalyzerAgent,
    private readonly voiceCoach: CharacterVoiceCoachAgent,
    private readonly scenePlanner: ScenePlannerAgent,
    private readonly sceneStitcher: SceneStitcherAgent,
    private readonly memoryRetriever: MemoryRetrieverService,
    private readonly deterministicChecker: DeterministicCheckerService,
    private readonly progressService: NovelProgressService,
    private readonly executionService: WorkflowExecutionService,
    private readonly promptTplService: BookPromptTemplateService,
    private readonly ruleCompiler: RuleCompilerService,
    private readonly traceLogger: LlmTraceLoggerService,
  ) {}

  private emitProgress(
    bookId: string,
    chapterNumber: number,
    step: string,
    stepIndex: number,
    message: string,
    done = false,
    error?: string,
    extra?: { nodeId?: string; loopAttempt?: number; score?: number; durationMs?: number; skipped?: boolean; phase?: string },
  ): void {
    this.progressService.emit({
      bookId, chapterNumber, step, stepIndex, totalSteps: 10, message, done, error,
      ...(extra ?? {}),
    });
  }

  private calculateWeightedScore(review: ChapterReview, state: StoryState): number {
    const weights = state.bookPromptProfile.reviewerCalibration.dimensionWeights;
    const d = review.dimensions;
    const origW = weights.originality ?? 0;
    const totalWeight = weights.engagement + weights.pacing + weights.hookStrength +
      weights.consistency + weights.proseQuality + weights.characterDepth + origW;
    const weightedSum =
      d.engagement * weights.engagement +
      d.pacing * weights.pacing +
      d.hookStrength * weights.hookStrength +
      d.consistency * weights.consistency +
      d.proseQuality * weights.proseQuality +
      d.characterDepth * weights.characterDepth +
      (d.originality ?? 5) * origW;
    return Math.round((weightedSum / totalWeight) * 100) / 100;
  }

  async run(
    state: StoryState,
    previousChapterEnding?: string,
    pipelineNodes?: AgentNodeConfig[],
    runtimeOptions?: ChapterWorkflowRuntimeOptions,
  ): Promise<ChapterWorkflowResult> {
    const getPrompt = (id: string) =>
      pipelineNodes?.find((n) => n.id === id)?.additionalSystemPrompt || undefined;
    const isEnabled = (id: string) =>
      pipelineNodes ? (pipelineNodes.find((n) => n.id === id)?.isEnabled ?? true) : true;
    const isLiterary = state.seed.writingMode === 'literary';
    const qualityPassScore = runtimeOptions?.qualityPassScore ?? (isLiterary ? Math.max(DEFAULT_QUALITY_PASS_SCORE - 1, 7) : DEFAULT_QUALITY_PASS_SCORE);
    const maxRepairRounds = Math.max(
      0,
      Math.floor(runtimeOptions?.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS),
    );
    const maxAttempts = 1 + maxRepairRounds;
    const chapterNumber = state.chapterCursor;
    const workflowStart = Date.now();

    // ── 断点续传：检测可恢复的中断运行（失败时降级为新建） ──
    let runId: string;
    let cached: Record<string, unknown> = {};
    let resumed = false;
    try {
      const resumableRun = await this.executionService.findResumableRun(state.bookId, chapterNumber);
      if (resumableRun) {
        const reopened = await this.executionService.reopenRun(resumableRun.id);
        if (reopened) {
          runId = resumableRun.id;
          cached = resumableRun.stepOutputs ?? {};
          resumed = true;
          this.logger.log(
            `[Chapter ${chapterNumber}] ========== 断点续传 ==========\n` +
            `  runId: ${runId} | 已缓存: [${Object.keys(cached).join(', ')}] | checkpoint: ${resumableRun.lastCheckpoint}`,
          );
        } else {
          this.logger.warn(`[Chapter ${chapterNumber}] 断点续传抢占失败(run已变更)，降级为新建运行`);
        }
      }
    } catch (e) {
      this.logger.warn(`[Chapter ${chapterNumber}] 断点续传检测失败，降级为新建: ${(e as Error).message}`);
    }
    if (!resumed) {
      runId = await this.executionService.createRun(state.bookId, chapterNumber);
      cached = {};
      this.logger.log(
        `[Chapter ${chapterNumber}] ========== 工作流开始（多轮质量门控） ==========\n` +
        `  bookId: ${state.bookId} | runId: ${runId} | 质量门槛: ${qualityPassScore} | 最大修复轮数: ${maxRepairRounds}`,
      );
    }

    let ownershipLost = false;
    const assertOwnership = async (): Promise<void> => {
      if (ownershipLost) throw new Error(`[Chapter ${chapterNumber}] 运行所有权已丢失，中止执行以避免重复消耗`);
      const ok = await this.executionService.assertOwnership(runId);
      if (!ok) {
        ownershipLost = true;
        throw new Error(`[Chapter ${chapterNumber}] 运行所有权已失效，中止执行以避免重复消耗`);
      }
    };
    const checkpoint = async (step: string): Promise<void> => {
      const ok = await this.executionService.saveCheckpoint(runId, step);
      if (!ok) throw new Error(`[Chapter ${chapterNumber}] checkpoint 写入失败（owner/status不匹配）step=${step}`);
    };
    const saveStep = async (step: string, output: unknown): Promise<void> => {
      const ok = await this.executionService.saveStepOutput(runId, step, output);
      if (!ok) throw new Error(`[Chapter ${chapterNumber}] stepOutput 写入失败（owner/status不匹配）step=${step}`);
    };
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    try {
    heartbeatTimer = setInterval(() => {
      void this.executionService.touchHeartbeat(runId).then((ok) => {
        if (!ok && !ownershipLost) {
          ownershipLost = true;
          this.logger.warn(`[Chapter ${chapterNumber}] 心跳续命被拒绝，标记 owner 丢失并准备中止`);
        }
      }).catch((e) =>
        this.logger.warn(`[Chapter ${chapterNumber}] 心跳更新失败 runId=${runId}: ${(e as Error).message}`),
      );
    }, HEARTBEAT_INTERVAL_MS);
    const tpl = await this.promptTplService.getTemplates(state.bookId);
    const agentSectionDict: Record<string, string> = {};
    for (const [agentId, config] of Object.entries(tpl.agents)) {
      for (const sec of config.sections) agentSectionDict[`agent:${agentId}:${sec.key}`] = sec.content;
    }
    const beatRole = state.currentArc?.chapterBeats?.find((b) => b.chapterNumber === chapterNumber)?.role
      ?? state.currentArc?.chapterBeats?.[chapterNumber - (state.currentArc?.startChapter ?? 1)]?.role;
    const chapterType = mapBeatRoleToChapterType(beatRole) ?? 'general';
    const arcStage = mapBeatRoleToArcStage(beatRole);
    const baseCtx: Omit<CompileContext, 'agentId'> = {
      chapterNumber, chapterType, arcStage, isFirstThreeChapters: chapterNumber <= 3,
    };
    const compiledRuleLogged = new Set<string>();
    const compileForAgent = (agentId: string, extra?: Partial<CompileContext>): Record<string, string> => ({
      ...(() => {
        const ctx = { agentId, ...baseCtx, ...extra };
        const compiled = this.ruleCompiler.compileWithMeta(tpl.ruleAtoms, ctx);
        const logKey = `${agentId}|${ctx.chapterType ?? 'na'}|${ctx.arcStage ?? 'na'}|${ctx.scenePurpose ?? 'na'}`;
        if (!compiledRuleLogged.has(logKey)) {
          this.traceLogger.logWorkflowEvent({
            bookId: state.bookId,
            chapterNumber,
            step: `rule-compile:${agentId}`,
            status: 'ok',
            meta: {
              context: ctx,
              outputKeys: Object.keys(compiled.compiled),
              matchedRuleAtomIds: compiled.matchedAtoms.map((a) => a.id),
              matchedRuleAtomTitles: compiled.matchedAtoms.slice(0, 30).map((a) => a.title),
            },
          });
          compiledRuleLogged.add(logKey);
        }
        return compiled.compiled;
      })(),
      ...agentSectionDict,
      __bookStrategy: buildBookStrategyPromptBlock(state.bookStrategy),
      __policySlice: buildPolicySliceBlock(state.bookStrategy),
    });

    // ── Step 1: Arc Director ──
    await assertOwnership();
    let t0 = Date.now();
    let arcDirective: ArcDirectorDirective | undefined;
    if ('arc-director' in cached) {
      arcDirective = (cached['arc-director'] ?? undefined) as ArcDirectorDirective | undefined; // JSONB存null，恢复为undefined
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/8: 卷级导演（缓存恢复）`);
      this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '卷级指令（缓存恢复）');
    } else {
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/8: 卷级导演`);
      this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '卷级导演');
      if (isEnabled('arc-director')) {
        await assertOwnership();
        arcDirective = await this.arcDirector.direct(state, getPrompt('arc-director'), compileForAgent('arc-director'));
        this.logger.log(
          `[Chapter ${chapterNumber}] 卷级指令完成 — ${Date.now() - t0}ms | ` +
          `阶段: ${arcDirective.arcStage} | 使命: ${arcDirective.chapterMission}`,
        );
        this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '卷级指令完成');
      } else {
        this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/8: 跳过卷级导演`);
        this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '跳过卷级导演');
        this.traceLogger.logSkipped('arc-director', 'pipeline配置禁用', { bookId: state.bookId, chapterNumber });
      }
      await saveStep('arc-director', arcDirective ?? null);
    }
    await checkpoint('arc-director');

    // ── Step 2: Intent ──
    await assertOwnership();
    let intent: ChapterIntent;
    if ('intent' in cached && (cached['intent'] as ChapterIntent)?.goals?.length) {
      intent = cached['intent'] as ChapterIntent;
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 2/8: 意图（缓存恢复）`);
      this.emitProgress(state.bookId, chapterNumber, 'intent', 1, '意图（缓存恢复）');
    } else {
      if ('intent' in cached) this.logger.warn(`[Chapter ${chapterNumber}] intent 缓存无效，改为重算`);
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 2/8: 意图设定`);
      this.emitProgress(state.bookId, chapterNumber, 'intent', 1, '意图设定');
      await assertOwnership();
      intent = await this.intentAgent.buildIntent(state, arcDirective, getPrompt('intent'), compileForAgent('intent'));
      if (!intent?.goals?.length) throw new Error(`[Chapter ${chapterNumber}] 意图生成失败：LLM 返回结果为空或缺少 goals`);
      const policyMaxThreads = state.bookStrategy?.threadPolicy?.maxNewThreadsPerChapter;
      if (typeof policyMaxThreads === 'number') {
        const clamped = Math.max(0, Math.min(intent.threadGuidance.maxNewThreads, Math.min(3, policyMaxThreads)));
        if (clamped !== intent.threadGuidance.maxNewThreads) {
          this.logger.log(
            `[Chapter ${chapterNumber}] threadGuidance.maxNewThreads 策略钳制 ${intent.threadGuidance.maxNewThreads} -> ${clamped}`,
          );
          intent.threadGuidance.maxNewThreads = clamped;
        }
      }
      const targetWords = state.seed.targetChapterWordCount ?? 3000;
      const expectedMin = Math.round(targetWords * 0.85);
      const expectedMax = Math.round(targetWords * 1.15);
      if (intent.wordCountRange.min < expectedMin * 0.5 || intent.wordCountRange.max < expectedMin * 0.5) {
        this.logger.warn(
          `[Chapter ${chapterNumber}] wordCountRange 偏离过大 (${intent.wordCountRange.min}-${intent.wordCountRange.max})，矫正为 ${expectedMin}-${expectedMax}`,
        );
        intent.wordCountRange = { min: expectedMin, max: expectedMax };
      }
      this.emitProgress(state.bookId, chapterNumber, 'intent', 1, '意图完成');
      this.logger.log(
        `[Chapter ${chapterNumber}] 意图完成 — ${Date.now() - t0}ms | ` +
        `目标: ${intent.goals.length} | 字数: ${intent.wordCountRange.min}-${intent.wordCountRange.max}`,
      );
      await saveStep('intent', intent);
    }
    await checkpoint('intent');

    // ── Step 3: Continuity Pre-check + Long-range memory ──
    await assertOwnership();
    let continuityInjections: string[];
    if ('continuity' in cached) {
      const cc = cached['continuity'] as { injections?: string[] };
      continuityInjections = Array.isArray(cc?.injections) ? cc.injections : [];
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 3/8: 连续性预检（缓存恢复，${continuityInjections.length}条注入）`);
      this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 2, '预检（缓存恢复）');
    } else {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 3/8: 连续性预检`);
      this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 2, '连续性预检');
      continuityInjections = [];
      if (isEnabled('continuity-guard')) {
        await assertOwnership();
        const preCheck = await this.continuityGuard.preCheck(state, intent);
        continuityInjections = preCheck.contextInjections;
        if (!preCheck.pass) {
          const blockWarnings = preCheck.warnings.filter((w) => w.severity === 'block');
          if (blockWarnings.length > 0) {
            this.logger.warn(
              `[Chapter ${chapterNumber}] 连续性阻断: ${blockWarnings.map((w) => w.description).join('; ')}`,
            );
          }
        }
        this.logger.log(
          `[Chapter ${chapterNumber}] 连续性预检完成 — ${Date.now() - t0}ms | ` +
          `通过: ${preCheck.pass} | 注入: ${continuityInjections.length}条`,
        );
      } else {
        this.traceLogger.logSkipped('continuity-guard', 'pipeline配置禁用', { bookId: state.bookId, chapterNumber });
      }
      // 远程记忆（窗口外才激活，避免与 buildCompactContext 滚动摘要重叠）
      if (chapterNumber > MEMORY_ACTIVATION_CHAPTER) {
        await assertOwnership();
        try {
          const longRangeContext = await this.memoryRetriever.buildLongRangeContext(state.bookId, intent, state);
          if (longRangeContext.contextText) {
            continuityInjections.push(longRangeContext.contextText);
            this.logger.log(`[Chapter ${chapterNumber}] 远程记忆召回 — ${longRangeContext.memories.length}条`);
          }
        } catch (err) {
          this.logger.warn(`[Chapter ${chapterNumber}] 远程记忆召回失败: ${err}`);
        }
      }
      await saveStep('continuity', { injections: continuityInjections });
    }
    this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 2, '预检完成');
    await checkpoint('continuity-check');

    // ── Step 3.5: 伏笔银行注入 — 将到期伏笔传递给写作层 ──
    const bank = state.foreshadowingBank ?? { deposits: [] };
    const dueToPlant = bank.deposits.filter((d) => d.status === 'pending' && d.plantWindow.earliestChapter <= chapterNumber && d.plantWindow.latestChapter >= chapterNumber);
    const urgentPlant = dueToPlant.filter((d) => d.priority === 'must_plant' || (d.plantWindow.latestChapter - chapterNumber) <= 3);
    const duePayoff = bank.deposits.filter((d) => d.status === 'planted' && d.payoffWindow.earliestChapter <= chapterNumber && d.payoffWindow.latestChapter >= chapterNumber);
    if (urgentPlant.length > 0) {
      continuityInjections.push(`【伏笔埋设指令】本章必须自然嵌入以下伏笔：\n${urgentPlant.map((d) => `- ${d.label}(${d.category})：${d.embeddingGuidance}`).join('\n')}`);
      this.logger.log(`[Chapter ${chapterNumber}] 伏笔注入：${urgentPlant.length}条紧急埋设`);
    } else if (dueToPlant.length > 0) {
      continuityInjections.push(`【伏笔埋设建议】可在本章自然嵌入：${dueToPlant.map((d) => `${d.label}-"${d.embeddingGuidance.slice(0, 40)}"`).join('；')}`);
    }
    if (duePayoff.length > 0) {
      continuityInjections.push(`【伏笔回收窗口】以下伏笔可在本章回收：${duePayoff.map((d) => `${d.label}-"${d.payoffDescription.slice(0, 40)}"`).join('；')}`);
      this.logger.log(`[Chapter ${chapterNumber}] 伏笔注入：${duePayoff.length}条可回收`);
    }

    // ── Step 4: Scene Pipeline + Multi-attempt Writing Loop ──
    await assertOwnership();
    const attempts: DraftAttempt[] = [];
    let bestAttempt: DraftAttempt | null = null;
    let scenePlan: ChapterScenePlan | undefined;

    const cachedQualityLoop = cached['quality-loop'] as {
      attempts?: DraftAttempt[];
      bestIndex?: number;
      bestAttempt?: DraftAttempt; // 兼容旧缓存格式
      scenePlan?: ChapterScenePlan;
      completed?: boolean;
    } | undefined;
    const hasValidQualityLoopCache = Array.isArray(cachedQualityLoop?.attempts) && cachedQualityLoop.attempts.length > 0;
    let qualityLoopDone = false;
    if (hasValidQualityLoopCache) {
      // 整个质量循环已缓存（JSONB反序列化后引用不等，需用 bestIndex 定位）
      const qlc = cachedQualityLoop as {
        attempts: DraftAttempt[];
        bestIndex?: number;
        bestAttempt?: DraftAttempt;
        scenePlan?: ChapterScenePlan;
        completed?: boolean;
      };
      attempts.push(...qlc.attempts);
      const bi =
        typeof qlc.bestIndex === 'number' && qlc.bestIndex >= 0 && qlc.bestIndex < qlc.attempts.length
          ? qlc.bestIndex
          : typeof qlc.bestAttempt?.attemptNumber === 'number' && qlc.bestAttempt.attemptNumber > 0 && qlc.bestAttempt.attemptNumber <= qlc.attempts.length
            ? qlc.bestAttempt.attemptNumber - 1
            : qlc.attempts.reduce((best, cur, idx, arr) => (arr[best].weightedScore >= cur.weightedScore ? best : idx), 0);
      bestAttempt = attempts[bi];
      scenePlan = qlc.scenePlan;
      qualityLoopDone = qlc.completed ?? true; // 兼容旧缓存：未记录 completed 时默认已完成
      if (qualityLoopDone) {
        this.logger.log(
          `[Chapter ${chapterNumber}] 步骤 4/8: 质量循环（缓存恢复）— ${attempts.length}轮，最佳${bestAttempt.weightedScore}分`,
        );
        this.emitProgress(state.bookId, chapterNumber, 'writing', 3, `写作（缓存恢复，${attempts.length}轮）`);
      } else {
        this.logger.log(
          `[Chapter ${chapterNumber}] 步骤 4/8: 质量循环（缓存恢复后继续）— 已完成${attempts.length}轮，继续第${attempts.length + 1}轮`,
        );
        this.emitProgress(state.bookId, chapterNumber, 'writing', 3, `写作（恢复后继续，第${attempts.length + 1}轮）`);
      }
    } else if ('quality-loop' in cached) {
      this.logger.warn(`[Chapter ${chapterNumber}] quality-loop 缓存无效，改为重算`);
    }

    if (!qualityLoopDone) {
      if (attempts.length >= maxAttempts) {
        qualityLoopDone = true;
        this.logger.warn(
          `[Chapter ${chapterNumber}] quality-loop 缓存标记未完成但轮次已达上限(${attempts.length}/${maxAttempts})，按已完成收敛`,
        );
        const bestIdx = bestAttempt ? attempts.indexOf(bestAttempt) : 0;
        await saveStep('quality-loop', {
          attempts,
          bestIndex: bestIdx,
          scenePlan: scenePlan ?? null,
          completed: true,
        });
      }
    }

    if (!qualityLoopDone) {
      // 部分缓存：场景规划 + 场景草稿
      const cachedScenePlan = scenePlan ?? (('scene-plan' in cached) ? cached['scene-plan'] as ChapterScenePlan | null : null);
      const rawCachedSceneDrafts = Array.isArray(cached['scene-drafts']) ? cached['scene-drafts'] as SceneDraft[] : [];
      const cachedSceneDrafts = cachedScenePlan ? rawCachedSceneDrafts : [];
      if (!cachedScenePlan && rawCachedSceneDrafts.length > 0) {
        this.logger.warn(`[Chapter ${chapterNumber}] scene-plan 缓存缺失，忽略 ${rawCachedSceneDrafts.length} 条 scene-drafts 缓存`);
      }

      const loopStartAttempt = Math.max(1, attempts.length + 1);
      for (let attempt = loopStartAttempt; attempt <= maxAttempts; attempt++) {
        await assertOwnership();
        t0 = Date.now();
        const isRewrite = attempt > 1;
        let draft: ChapterDraft;

        if (!isRewrite && isEnabled('scene-planner')) {
          // ── 首轮：场景级写作流水线 ──
          if (cachedScenePlan) {
            scenePlan = cachedScenePlan;
            this.logger.log(`[Chapter ${chapterNumber}] 场景规划（缓存恢复）— ${scenePlan.scenes.length}场景`);
          } else {
            this.logger.log(`[Chapter ${chapterNumber}] 步骤 4/8: 场景规划`);
            this.emitProgress(state.bookId, chapterNumber, 'scene-plan', 3, '场景规划');
            await assertOwnership();
            scenePlan = await this.scenePlanner.plan(state, intent, arcDirective, getPrompt('scene-planner'), compileForAgent('scene-planner'));
            const totalPlanned = scenePlan.scenes.reduce((s, sc) => s + sc.estimatedWords, 0);
            if (totalPlanned < intent.wordCountRange.min * 0.6) {
              const ratio = intent.wordCountRange.min / Math.max(1, totalPlanned);
              this.logger.warn(
                `[Chapter ${chapterNumber}] 场景字数总和${totalPlanned}过低（目标${intent.wordCountRange.min}），按比例${ratio.toFixed(1)}x矫正`,
              );
              for (const sc of scenePlan.scenes) sc.estimatedWords = Math.round(sc.estimatedWords * ratio);
            }
            this.logger.log(
              `[Chapter ${chapterNumber}] 场景规划完成 — ${Date.now() - t0}ms | 场景数: ${scenePlan.scenes.length} | ` +
              `字数分配: ${scenePlan.scenes.map((s) => s.estimatedWords).join('+')}=${scenePlan.scenes.reduce((a, s) => a + s.estimatedWords, 0)} | ` +
              `弧线: ${scenePlan.overallEmotionalArc}`,
            );
            await saveStep('scene-plan', scenePlan);
          }

          // 逐场景写作（支持增量恢复与并发生成）
          const sceneDrafts: SceneDraft[] = [...cachedSceneDrafts];
          let si = sceneDrafts.length;
          while (si < scenePlan.scenes.length) {
            // 构建并发批次
            const batchScenes = [scenePlan.scenes[si]];
            let nextSi = si + 1;
            while (nextSi < scenePlan.scenes.length && scenePlan.scenes[nextSi].isParallel) {
              batchScenes.push(scenePlan.scenes[nextSi]);
              nextSi++;
            }

            const batchPromises = batchScenes.map(async (scene, idx) => {
              const globalSi = si + idx;
              let prevText: string | undefined;
              const extraInjections = [...(continuityInjections ?? [])];
              
              if (globalSi === 0) {
                prevText = previousChapterEnding;
              } else if (!scene.isParallel) {
                // 非并发场景：扩展至 1200 字并附加场景目标摘要，避免跨场景断链
                const prevDraft = sceneDrafts[globalSi - 1];
                const prevScene = scenePlan.scenes[globalSi - 1];
                const prevTail = prevDraft?.content.slice(-1200) ?? '';
                const prevSceneSummary = prevScene ? `[上一场景目标：${prevScene.objective}，情绪出口：${prevScene.emotionalExit}]` : '';
                prevText = prevSceneSummary ? `${prevSceneSummary}\n${prevTail}` : prevTail;
                const sensory = prevScene?.sensoryEndState;
                if (sensory) {
                  const parts: string[] = [];
                  if (sensory.timeOfDay) parts.push(`时间：${sensory.timeOfDay}`);
                  if (sensory.weather) parts.push(`天气/光线：${sensory.weather}`);
                  if (sensory.ambientSound) parts.push(`环境音：${sensory.ambientSound}`);
                  if (sensory.dominantSense) parts.push(`主导感官：${sensory.dominantSense}`);
                  if (parts.length > 0) extraInjections.push(`感官延续（从上一场景）：${parts.join('，')}`);
                }
                if (prevScene?.emotionalExit && prevScene.emotionalExit !== scene.emotionalEntry) {
                  extraInjections.push(`情绪桥接：上一场景结束情绪「${prevScene.emotionalExit}」→本场景入口「${scene.emotionalEntry}」，过渡要自然`);
                }
              } else {
                // 并发场景，不强依赖上一场景的末尾文本
                prevText = undefined;
              }

              // 增加潜台词和感官锚定提示
              if (scene.subtext) {
                extraInjections.push(`潜台词约束：${scene.subtext}（请通过角色的微表情、动作或矛盾的话语来暗示，不要直接点明）`);
              }
              if (scene.sensoryAnchors && scene.sensoryAnchors.length > 0) {
                extraInjections.push(`强制感官锚定：请在描写中自然融入以下感官细节：${scene.sensoryAnchors.join('、')}`);
              }

              this.emitProgress(state.bookId, chapterNumber, 'scene-write', 3,
                `场景${globalSi + 1}/${scenePlan.scenes.length}(${scene.purpose})`);
              await assertOwnership();
              const sd = await this.creativeWriter.writeScene(
                state, intent, scene, prevText, getPrompt('creative-writer'), extraInjections, compileForAgent('creative-writer', { scenePurpose: scene.purpose }),
              );
              this.logger.log(
                `[Chapter ${chapterNumber}] 场景${globalSi + 1}完成 — 类型=${scene.purpose} | 字数: ${sd.content.length}`,
              );
              return sd;
            });

            const batchSettled = await Promise.allSettled(batchPromises);
            for (const r of batchSettled) {
              if (r.status === 'fulfilled') sceneDrafts.push(r.value);
              else { this.logger.error(`[Chapter ${chapterNumber}] 场景写作失败: ${r.reason}`); throw r.reason; }
            }
            await saveStep('scene-drafts', sceneDrafts);
            si = nextSi;
          }

          t0 = Date.now();
          this.emitProgress(state.bookId, chapterNumber, 'scene-stitch', 3, '场景缝合');
          await assertOwnership();
          draft = await this.sceneStitcher.stitch(state, intent, scenePlan, sceneDrafts, getPrompt('scene-stitcher'), compileForAgent('scene-stitcher'));
          this.logger.log(
            `[Chapter ${chapterNumber}] 场景缝合完成 — ${Date.now() - t0}ms | 标题: ${draft.title} | 字数: ${draft.content.length}`,
          );

          const stitchHardMin = Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.5);
          if (draft.content.replace(/\s+/g, '').length < stitchHardMin) {
            this.logger.warn(
              `[Chapter ${chapterNumber}] 缝合内容仅${draft.content.length}字（硬性阈值${stitchHardMin}），降级为章节级写作`,
            );
            this.emitProgress(state.bookId, chapterNumber, 'writing', 3, '内容过短，章节级重写');
            await assertOwnership();
            draft = await this.creativeWriter.write(
              state, intent, previousChapterEnding,
              getPrompt('creative-writer'), undefined, continuityInjections, compileForAgent('creative-writer'),
            );
            this.logger.log(`[Chapter ${chapterNumber}] 章节级重写完成 — 字数: ${draft.content.length}`);
          }
        } else {
          const stepLabel = isRewrite ? `重写第${attempt}轮` : '创作写作';
          this.logger.log(`[Chapter ${chapterNumber}] 步骤 4/8: ${stepLabel}`);
          this.emitProgress(state.bookId, chapterNumber, 'writing', 3, stepLabel);
          const rewriteInjections = scenePlan && isRewrite
            ? [...continuityInjections, `本章场景骨架参考：${scenePlan.scenes.map((s, i) => `场景${i + 1}-${s.purpose}(${s.objective})`).join('/')}/情感弧线：${scenePlan.overallEmotionalArc}，重写时保持相同结构`]
            : continuityInjections;
          let rewriteGuidance: RewriteGuidance | undefined;
          if (isRewrite && bestAttempt) {
            rewriteGuidance = {
              attemptNumber: attempt, maxAttempts,
              previousStrengths: bestAttempt.review.strengths,
              previousIssues: bestAttempt.review.issuesFound.map((i) => ({
                category: i.category, severity: i.severity,
                description: i.description, suggestedFix: i.suggestedFix,
              })),
              repeatedIssues: this.findRepeatedIssues(attempts),
              previousScore: bestAttempt.weightedScore,
              preserveParagraphs: this.identifyPreserveParagraphs(bestAttempt),
            };
          }
          await assertOwnership();
          draft = await this.creativeWriter.write(
            state, intent, previousChapterEnding,
            getPrompt('creative-writer'), rewriteGuidance, rewriteInjections, compileForAgent('creative-writer'),
          );
          this.logger.log(
            `[Chapter ${chapterNumber}] ${stepLabel}完成 — ${Date.now() - t0}ms | 标题: ${draft.title} | 字数: ${draft.content.length}`,
          );
          const directHardMin = Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.5);
          if (draft.content.replace(/\s+/g, '').length < directHardMin) {
            this.logger.warn(`[Chapter ${chapterNumber}] 内容仅${draft.content.length}字（硬性阈值${directHardMin}），无guidance重写`);
            await assertOwnership();
            draft = await this.creativeWriter.write(
              state, intent, previousChapterEnding,
              getPrompt('creative-writer'), undefined, continuityInjections, compileForAgent('creative-writer'),
            );
            this.logger.log(`[Chapter ${chapterNumber}] 字数补救重写完成 — 字数: ${draft.content.length}`);
          }
        }

        const loopDetCheck = this.deterministicChecker.check(state, intent, draft);
        if (!loopDetCheck.pass) {
          this.logger.warn(
            `[Chapter ${chapterNumber}] 轮${attempt}确定性检查失败: ${loopDetCheck.failedChecks.map((c) => c.rule).join(', ')}`,
          );
        }

        t0 = Date.now();
        this.emitProgress(state.bookId, chapterNumber, 'review', 4, `审阅第${attempt}轮`);
        await assertOwnership();
        const review = isEnabled('reviewer')
          ? await this.reviewer.review(state, intent, draft, getPrompt('reviewer'), compileForAgent('reviewer'))
          : this.buildDefaultReview();
        if (!loopDetCheck.pass) {
          for (const c of loopDetCheck.failedChecks) {
            review.issuesFound.push({ category: 'other' as const, severity: 'critical' as const, description: `硬规则: ${c.rule} - ${c.detail}`, suggestedFix: `修复 ${c.rule}` });
          }
        }
        const weightedScore = this.calculateWeightedScore(review, state);
        this.logger.log(
          `[Chapter ${chapterNumber}] 审阅完成 — ${Date.now() - t0}ms | ` +
          `裁决: ${review.overallVerdict} | LLM分: ${review.overallScore} | 加权分: ${weightedScore}`,
        );

        const attemptResult: DraftAttempt = { draft, review, weightedScore, attemptNumber: attempt };
        attempts.push(attemptResult);
        if (!bestAttempt || weightedScore > bestAttempt.weightedScore) bestAttempt = attemptResult;

        const hasCriticalIssues = review.issuesFound.some((i) => i.severity === 'critical');
        const hasModerateIssues = review.issuesFound.filter((i) => i.severity === 'moderate').length >= 3;
        const verdictBlocks = review.overallVerdict === 'major_issues';
        const passed = weightedScore >= qualityPassScore && !hasCriticalIssues && !verdictBlocks && !hasModerateIssues && loopDetCheck.pass;
        const isLastAttempt = attempt >= maxAttempts;
        const bestIdx = bestAttempt ? attempts.indexOf(bestAttempt) : 0;
        await saveStep('quality-loop', {
          attempts,
          bestIndex: bestIdx,
          scenePlan: scenePlan ?? null,
          completed: passed || isLastAttempt,
        });

        if (passed) {
          this.logger.log(`[Chapter ${chapterNumber}] 质量门控通过！加权分 ${weightedScore} >= ${qualityPassScore}（第${attempt}轮）`);
          qualityLoopDone = true;
          break;
        }
        if (isLastAttempt) {
          qualityLoopDone = true;
          break;
        }
        if (attempt < maxAttempts) {
          const reasons = [
            weightedScore < qualityPassScore ? `分数${weightedScore}<${qualityPassScore}` : '',
            hasCriticalIssues ? 'critical问题' : '',
            verdictBlocks ? `裁决=${review.overallVerdict}` : '',
            hasModerateIssues ? `moderate问题≥3` : '',
            !loopDetCheck.pass ? '硬规则失败' : '',
          ].filter(Boolean).join('+');
          this.logger.log(`[Chapter ${chapterNumber}] 质量门控未通过（${reasons}），准备第${attempt + 1}轮重写`);
        }
      }
    }

    const finalAttempt = bestAttempt!;
    const allScores = attempts.map((a) => a.weightedScore);
    const bestIndex = attempts.indexOf(finalAttempt);
    this.logger.log(
      `[Chapter ${chapterNumber}] 多轮写作结束 | 尝试: ${attempts.length} | ` +
      `分数: [${allScores.join(', ')}] | 选中第${bestIndex + 1}轮`,
    );
    this.emitProgress(state.bookId, chapterNumber, 'writing', 3,
      `写作完成（${attempts.length}轮，最佳${finalAttempt.weightedScore}分）`);
    await checkpoint('quality-loop');

    // ── Step 4.5: Voice + Pacing Analysis (parallel) ──
    await assertOwnership();
    t0 = Date.now();
    const [voiceAudit, pacingResult] = await Promise.all([
      isEnabled('character-voice-coach')
        ? this.voiceCoach.audit(state, finalAttempt.draft).catch(() => null)
        : Promise.resolve(null),
      isEnabled('pacing-analyzer')
        ? this.pacingAnalyzer.analyze(state, finalAttempt.draft).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (voiceAudit && !voiceAudit.pass) {
      voiceAudit.characterAudits
        .filter((a) => a.voiceConsistency < 7)
        .forEach((a) => a.issues.forEach((issue) =>
          finalAttempt.review.issuesFound.push({
            category: 'character_voice' as const,
            severity: a.voiceConsistency < 5 ? 'critical' as const : 'moderate' as const,
            description: `角色声音偏离：${a.characterName} - ${issue}`,
            suggestedFix: a.suggestions[0] || '调整对话符合声音档案',
          }),
        ));
    }
    let voiceEvolution: import('./agents/character-voice-coach.agent').VoiceEvolutionExtract | undefined;
    if (isEnabled('character-voice-coach')) {
      await assertOwnership();
      voiceEvolution = await this.voiceCoach.extractVoiceEvolution(state, finalAttempt.draft, intent).catch(() => undefined);
    }
    if (pacingResult) {
      if (pacingResult.sentenceLengthVariety < 5)
        finalAttempt.review.issuesFound.push({
          category: 'pacing' as const, severity: 'moderate' as const,
          description: `句式变化不足（${pacingResult.sentenceLengthVariety}/10）`,
          suggestedFix: '紧张时短句，平静时长句，交替使用',
        });
      if (pacingResult.overallPacing !== 'good')
        finalAttempt.review.issuesFound.push({
          category: 'pacing' as const, severity: 'moderate' as const,
          description: `整体节奏${pacingResult.overallPacing === 'too_slow' ? '过慢' : '过快'}`,
          suggestedFix: pacingResult.suggestions?.[0] || '调整节奏',
        });
    }
    this.logger.log(
      `[Chapter ${chapterNumber}] 质量分析完成 — ${Date.now() - t0}ms | ` +
      `声音：${voiceAudit?.pass !== false ? '通过' : '需修正'} | 节奏：${pacingResult?.overallPacing ?? '跳过'}`,
    );

    // ── Step 5: Deterministic checks (pre-polish baseline) ──
    const prePolishDeterministicCheck = this.deterministicChecker.check(state, intent, finalAttempt.draft);
    if (!prePolishDeterministicCheck.pass) {
      this.logger.warn(
        `[Chapter ${chapterNumber}] 确定性检查失败: ${prePolishDeterministicCheck.failedChecks.map((c) => c.rule).join(', ')}`,
      );
    }

    // ── Step 6: Editor polish ──
    await assertOwnership();
    let finalDraft = finalAttempt.draft;
    let finalReview = finalAttempt.review;
    let finalWeightedScore = finalAttempt.weightedScore;
    let wasEdited = false;
    const wasRewritten = attempts.length > 1;
    const effectivePolishThreshold = isLiterary ? Math.max(EDITOR_POLISH_THRESHOLD - 0.5, 6) : EDITOR_POLISH_THRESHOLD;
    const needsPolish =
      finalAttempt.weightedScore < effectivePolishThreshold ||
      !prePolishDeterministicCheck.pass ||
      finalAttempt.review.issuesFound.some((i) => i.severity === 'critical');
    if (needsPolish && isEnabled('editor')) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 6/8: 编辑精修（加权分 ${finalAttempt.weightedScore} < ${effectivePolishThreshold}）`);
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '编辑精修');
      const editReview = { ...finalReview };
      if (prePolishDeterministicCheck.failedChecks.length > 0) {
        editReview.issuesFound = [
          ...editReview.issuesFound,
          ...prePolishDeterministicCheck.failedChecks.map((c) => ({
            category: 'other' as const, severity: 'critical' as const,
            description: `硬规则违反: ${c.rule} - ${c.detail}`, suggestedFix: `修复 ${c.rule}`,
          })),
        ];
      }
      await assertOwnership();
      finalDraft = await this.editor.edit(state, intent, finalDraft, editReview, getPrompt('editor'), compileForAgent('editor'));
      wasEdited = true;
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '精修完成');
      this.logger.log(`[Chapter ${chapterNumber}] 精修完成 — ${Date.now() - t0}ms | 修改后字数: ${finalDraft.content.length}`);
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '跳过编辑');
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 6/8: 跳过编辑（质量足够）`);
      this.traceLogger.logSkipped('chapter-editor', needsPolish ? 'pipeline配置禁用' : `质量足够(${finalAttempt.weightedScore})`, { bookId: state.bookId, chapterNumber });
    }

    // ── Step 7: Hook enhancement ──
    await assertOwnership();
    if (isEnabled('hook-crafter')) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 7/8: 钩子优化`);
      this.emitProgress(state.bookId, chapterNumber, 'hook', 6, '钩子优化');
      await assertOwnership();
      try {
        const enhanced = await this.hookCrafter.enhanceHook(state, intent, finalDraft, compileForAgent('hook-crafter'));
        if (enhanced.content !== finalDraft.content) {
          finalDraft = enhanced;
          this.logger.log(`[Chapter ${chapterNumber}] 钩子优化完成 — ${Date.now() - t0}ms`);
        }
      } catch (err) {
        this.logger.warn(`[Chapter ${chapterNumber}] 钩子优化失败，使用原稿: ${err}`);
      }
      this.emitProgress(state.bookId, chapterNumber, 'hook', 6, '钩子完成');
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'hook', 6, '跳过钩子优化');
      this.traceLogger.logSkipped('hook-crafter', 'pipeline配置禁用', { bookId: state.bookId, chapterNumber });
    }

    const finalDraftChanged =
      finalDraft.title !== finalAttempt.draft.title ||
      finalDraft.content !== finalAttempt.draft.content;
    if (finalDraftChanged) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 终稿复评（编辑/钩子后）`);
      this.emitProgress(state.bookId, chapterNumber, 'review', 4, '终稿复评');
      await assertOwnership();
      const postEditReview = isEnabled('reviewer')
        ? await this.reviewer.review(state, intent, finalDraft, getPrompt('reviewer'), compileForAgent('reviewer'))
        : this.buildDefaultReview();
      const postEditScore = this.calculateWeightedScore(postEditReview, state);
      if (postEditScore >= finalWeightedScore) {
        finalReview = postEditReview;
        finalWeightedScore = postEditScore;
      } else {
        this.logger.warn(`[Chapter ${chapterNumber}] 编辑后分数下降 ${finalWeightedScore} → ${postEditScore}，保留原审阅结果`);
        finalDraft = finalAttempt.draft;
        wasEdited = false;
      }
      this.logger.log(
        `[Chapter ${chapterNumber}] 终稿复评完成 — ${Date.now() - t0}ms | ` +
        `裁决: ${finalReview.overallVerdict} | 加权分: ${finalWeightedScore}`,
      );
    }

    const deterministicCheck = this.deterministicChecker.check(state, intent, finalDraft);
    if (!deterministicCheck.pass) {
      this.logger.warn(`[Chapter ${chapterNumber}] 终稿确定性检查失败: ${deterministicCheck.failedChecks.map((c) => c.rule).join(', ')}`);
    }

    await checkpoint('post-process');

    // ── Step 8: Record ──
    await assertOwnership();
    await saveStep('final-draft', { draft: finalDraft, review: finalReview, score: finalWeightedScore, wasEdited });
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 8/8: 知识记录`);
    this.emitProgress(state.bookId, chapterNumber, 'record', 9, '知识记录');
    let loreRecord: LoreRecord;
    try {
      loreRecord = await this.recorder.record(state, finalDraft, getPrompt('recorder'));
    } catch (recErr) {
      this.logger.error(`[Chapter ${chapterNumber}] Recorder 失败，使用空记录降级: ${recErr}`);
      loreRecord = { chapterNumber, summary: `第${chapterNumber}章（记录失败降级）`, plotThreadDeltas: [], characterLifecycleDeltas: [], newCharacters: [], newLocations: [], newItems: [] } as unknown as LoreRecord;
    }
    this.emitProgress(state.bookId, chapterNumber, 'record', 9, '记录完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 记录完成 — ${Date.now() - t0}ms | ` +
      `伏线变更: ${loreRecord.plotThreadDeltas.length} | 角色变更: ${loreRecord.characterLifecycleDeltas.length}`,
    );

    let qualityMetrics: Record<string, unknown> | undefined;
    try {
      const hookHistory = state.recentHookTypes ?? [];
      const recent5 = hookHistory.slice(-5).map((h) => h.hookType);
      const hookRepeatRate = recent5.length >= 2 ? 1 - new Set(recent5).size / recent5.length : 0;
      const mustHints = arcDirective?.mustHit ?? [];
      const arcHitRate = mustHints.length > 0 ? mustHints.filter((h) => finalDraft.content.includes(h.slice(0, 8))).length / mustHints.length : 1;
      const genreMismatchFlags: string[] = [];
      if (state.bookStrategy?.toneGuardrails?.length) {
        for (const g of state.bookStrategy.toneGuardrails) if (finalDraft.content.includes(g.replace(/禁止|避免|不要/g, '').slice(0, 4))) genreMismatchFlags.push(g);
      }
      const coreChars = state.characters.filter((c) => c.status.narrativeImportance === 'core');
      const coreAbsenceRate = coreChars.length > 0 ? coreChars.reduce((s, c) => s + (chapterNumber - (c.status.lastSeenChapter ?? 0)), 0) / (coreChars.length * chapterNumber) : 0;
      const cameoChars = state.characters.filter((c) => c.status.narrativeImportance === 'cameo');
      const cameoOveruseRate = cameoChars.length > 0 && chapterNumber > 1 ? cameoChars.filter((c) => (c.status.lastSeenChapter ?? 0) >= chapterNumber - 3).length / cameoChars.length : 0;
      const fadingCount = state.characters.filter((c) => c.status.lifecycleStatus === 'fading').length;
      const arcStart = state.currentArc?.startChapter ?? 1;
      const newInArc = state.characters.filter((c) => (c.status.firstSeenChapter ?? 0) >= arcStart && c.role !== 'protagonist').length;
      const presentCount = new Set(intent.characterAvailability?.activeCharacterIds ?? []).size;
      qualityMetrics = {
        chapterNumber, hookRepeatRate, characterArcHitRate: arcHitRate,
        genreMismatchFlags, coreAbsenceRate, cameoOveruseRate,
        fadingCount, presentCharacterCount: presentCount, newCharactersInArc: newInArc,
      };
    } catch (metricErr) {
      this.logger.warn(`[Chapter ${chapterNumber}] 质量指标采集异常: ${metricErr}`);
    }

    this.emitProgress(state.bookId, chapterNumber, 'done', 7, '生成完成', true);
    const elapsed = Date.now() - workflowStart;
    const completed = await this.executionService.completeRun(runId, {
      totalDurationMs: elapsed, totalLoopAttempts: attempts.length,
      finalScore: finalWeightedScore, finalVerdict: finalReview.overallVerdict,
      nodeCount: 8, failedNodes: [],
    });
    if (!completed) {
      throw new Error(`[Chapter ${chapterNumber}] 运行所有权已失效，终止提交流程`);
    }
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== 工作流完成${resumed ? '（断点续传）' : ''} ========== ${elapsed}ms\n` +
      `  标题: ${finalDraft.title}\n` +
      `  字数: ${finalDraft.content.length} | 轮次: ${attempts.length} | 已重写: ${wasRewritten} | 已编辑: ${wasEdited}\n` +
      `  审阅: ${finalReview.overallVerdict} (加权${finalWeightedScore}) | 问题数: ${finalReview.issuesFound.length}`,
    );

    return {
      arcDirective, intent, finalDraft,
      review: finalReview, deterministicCheck, loreRecord, voiceEvolution,
      wasEdited, wasRewritten, overallScore: finalWeightedScore,
      attemptCount: attempts.length, allAttemptScores: allScores, bestAttemptIndex: bestIndex,
      qualityMetrics,
    };
    } catch (error) {
      const failed = await this.executionService.failRun(runId, (error as Error).message?.slice(0, 500));
      if (!failed) {
        this.logger.warn(`[Chapter ${chapterNumber}] failRun 被拒绝（owner/status不匹配）runId=${runId}`);
      }
      throw error;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  private identifyPreserveParagraphs(attempt: DraftAttempt): { index: number; reason: string }[] {
    const paragraphs = attempt.draft.content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return [];
    const issueCategories = new Set(attempt.review.issuesFound.map((i) => i.category));
    const preserve: { index: number; reason: string }[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const hasDialogue = /["「].+?["」]/.test(p);
      const hasAction = p.length > 50 && !/[他她](?:感到|觉得|心想|意识到)/.test(p);
      const isStrengthMentioned = attempt.review.strengths.some((s) => p.includes(s.slice(0, 10)));
      if (isStrengthMentioned || (hasDialogue && !issueCategories.has('character_voice')) || (hasAction && p.length > 100 && !issueCategories.has('pacing'))) {
        preserve.push({ index: i, reason: isStrengthMentioned ? '审阅提及优点' : hasDialogue ? '对话自然' : '描写精彩' });
      }
    }
    return preserve.slice(0, Math.ceil(paragraphs.length * 0.4)); // 最多保留40%段落
  }

  private findRepeatedIssues(attempts: DraftAttempt[]): string[] {
    if (attempts.length < 2) return [];
    const issueCounts = new Map<string, number>();
    for (const attempt of attempts) {
      const seen = new Set<string>();
      for (const issue of attempt.review.issuesFound) {
        const key = `${issue.category}:${issue.description.slice(0, 50)}`;
        if (!seen.has(key)) {
          seen.add(key);
          issueCounts.set(key, (issueCounts.get(key) ?? 0) + 1);
        }
      }
    }
    return [...issueCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key]) => key.split(':').slice(1).join(':'));
  }

  private buildDefaultReview(): ChapterReview {
    return {
      overallScore: 8.5,
      overallVerdict: 'good' as const,
      issuesFound: [],
      strengths: [],
      dimensions: {
        engagement: 8.5, pacing: 8.5, hookStrength: 8.5,
        consistency: 8.5, proseQuality: 8.5, characterDepth: 8.5, originality: 5,
      },
    };
  }
}
