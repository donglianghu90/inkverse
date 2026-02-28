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
import { MemoryRetrieverService, LongRangeContext } from './memory-retriever.service';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';
import { NovelProgressService } from './novel-progress.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
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

import { DEFAULT_WORKFLOW_PARAMS } from './entities/book-agent-pipeline.entity';
const DEFAULT_QUALITY_PASS_SCORE = DEFAULT_WORKFLOW_PARAMS.qualityPassScore;
const DEFAULT_MAX_REPAIR_ROUNDS = DEFAULT_WORKFLOW_PARAMS.maxRepairRounds;
const EDITOR_POLISH_THRESHOLD = DEFAULT_WORKFLOW_PARAMS.editorPolishThreshold;

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
      bookId, chapterNumber, step, stepIndex, totalSteps: 8, message, done, error,
      ...(extra ?? {}),
    });
  }

  private calculateWeightedScore(review: ChapterReview, state: StoryState): number {
    const weights = state.bookPromptProfile.reviewerCalibration.dimensionWeights;
    const d = review.dimensions;
    const totalWeight = weights.engagement + weights.pacing + weights.hookStrength +
      weights.consistency + weights.proseQuality + weights.characterDepth;
    const weightedSum =
      d.engagement * weights.engagement +
      d.pacing * weights.pacing +
      d.hookStrength * weights.hookStrength +
      d.consistency * weights.consistency +
      d.proseQuality * weights.proseQuality +
      d.characterDepth * weights.characterDepth;
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
    const qualityPassScore = runtimeOptions?.qualityPassScore ?? DEFAULT_QUALITY_PASS_SCORE;
    const maxRepairRounds = Math.max(
      0,
      Math.floor(runtimeOptions?.maxRepairRounds ?? DEFAULT_MAX_REPAIR_ROUNDS),
    );
    const maxAttempts = 1 + maxRepairRounds;
    const chapterNumber = state.chapterCursor;
    const workflowStart = Date.now();
    const runId = await this.executionService.createRun(state.bookId, chapterNumber);
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== 工作流开始（多轮质量门控） ==========\n` +
      `  bookId: ${state.bookId} | runId: ${runId} | 质量门槛: ${qualityPassScore} | 最大修复轮数: ${maxRepairRounds}`,
    );

    const checkpoint = (step: string) => this.executionService.saveCheckpoint(runId, step);
    const tpl = await this.promptTplService.getTemplates(state.bookId);
    const playbooks: Record<string, string> = { ...tpl.playbooks }; // 加载本书 playbooks + agent sections
    for (const [agentId, config] of Object.entries(tpl.agents)) {
      for (const sec of config.sections) playbooks[`agent:${agentId}:${sec.key}`] = sec.content;
    }

    try {
    // ── Step 1: Arc Director ──
    let t0 = Date.now();
    let arcDirective: ArcDirectorDirective | undefined;
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/8: 卷级导演`);
    this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '卷级导演');
    if (isEnabled('arc-director')) {
      arcDirective = await this.arcDirector.direct(state, getPrompt('arc-director'), playbooks);
      this.logger.log(
        `[Chapter ${chapterNumber}] 卷级指令完成 — ${Date.now() - t0}ms | ` +
        `阶段: ${arcDirective.arcStage} | 使命: ${arcDirective.chapterMission}`,
      );
      this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '卷级指令完成');
    } else {
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/8: 跳过卷级导演`);
      this.emitProgress(state.bookId, chapterNumber, 'arc-director', 0, '跳过卷级导演');
    }
    await checkpoint('arc-director');

    // ── Step 2: Intent ──
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 2/8: 意图设定`);
    this.emitProgress(state.bookId, chapterNumber, 'intent', 1, '意图设定');
    const intent = await this.intentAgent.buildIntent(state, arcDirective, getPrompt('intent'), playbooks);
    if (!intent?.goals?.length) throw new Error(`[Chapter ${chapterNumber}] 意图生成失败：LLM 返回结果为空或缺少 goals`);

    // 硬性矫正 wordCountRange：确保匹配用户设置的 targetChapterWordCount
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

    // ── Step 3: Continuity Pre-check ──
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 3/8: 连续性预检`);
    this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 2, '连续性预检');
    let continuityInjections: string[] = [];
    if (isEnabled('continuity-guard')) {
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
    }
    this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 2, '预检完成');
    await checkpoint('continuity-check');

    // ── Step 3.5: Long-range memory retrieval ──
    let longRangeContext: LongRangeContext = { memories: [], pyramidLayers: [], contextText: '' };
    if (chapterNumber > 10) { // 前10章短程上下文已足够
      try {
        longRangeContext = await this.memoryRetriever.buildLongRangeContext(state.bookId, intent, state);
        if (longRangeContext.contextText) {
          continuityInjections.push(longRangeContext.contextText);
          this.logger.log(
            `[Chapter ${chapterNumber}] 远程记忆召回 — ${longRangeContext.memories.length}条`,
          );
        }
      } catch (err) {
        this.logger.warn(`[Chapter ${chapterNumber}] 远程记忆召回失败: ${err}`);
      }
    }

    // ── Step 4: Scene Pipeline + Multi-attempt Writing Loop ──
    const attempts: DraftAttempt[] = [];
    let bestAttempt: DraftAttempt | null = null;
    let scenePlan: ChapterScenePlan | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      t0 = Date.now();
      const isRewrite = attempt > 1;
      let draft: ChapterDraft;

      if (!isRewrite && isEnabled('scene-planner')) {
        // ── 首轮：场景级写作流水线 ──
        this.logger.log(`[Chapter ${chapterNumber}] 步骤 4/8: 场景规划`);
        this.emitProgress(state.bookId, chapterNumber, 'scene-plan', 3, '场景规划');
        scenePlan = await this.scenePlanner.plan(state, intent, arcDirective, getPrompt('scene-planner'), playbooks);

        // 校验并矫正场景字数分配
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

        // 逐场景写作（顺序执行，富上下文传递：结尾文本 + 感官状态 + 情绪承接）
        const sceneDrafts: SceneDraft[] = [];
        for (let si = 0; si < scenePlan.scenes.length; si++) {
          const scene = scenePlan.scenes[si];
          let prevText: string | undefined;
          const extraInjections = [...(continuityInjections ?? [])];
          if (si === 0) {
            prevText = previousChapterEnding;
          } else {
            const prevDraft = sceneDrafts[si - 1];
            prevText = prevDraft?.content.slice(-800);
            const prevScene = scenePlan.scenes[si - 1];
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
          }
          this.emitProgress(state.bookId, chapterNumber, 'scene-write', 3,
            `场景${si + 1}/${scenePlan.scenes.length}(${scene.purpose})`);
          const sd = await this.creativeWriter.writeScene(
            state, intent, scene, prevText, getPrompt('creative-writer'), extraInjections, playbooks,
          );
          sceneDrafts.push(sd);
          this.logger.log(
            `[Chapter ${chapterNumber}] 场景${si + 1}完成 — 类型=${scene.purpose} | 字数: ${sd.content.length}`,
          );
        }

        // 场景缝合
        t0 = Date.now();
        this.emitProgress(state.bookId, chapterNumber, 'scene-stitch', 3, '场景缝合');
        draft = await this.sceneStitcher.stitch(state, intent, scenePlan, sceneDrafts, getPrompt('scene-stitcher'), playbooks);
        this.logger.log(
          `[Chapter ${chapterNumber}] 场景缝合完成 — ${Date.now() - t0}ms | 标题: ${draft.title} | 字数: ${draft.content.length}`,
        );

        // 字数防护：缝合后内容低于用户目标的50%则降级为章节级写作
        const stitchHardMin = Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.5);
        if (draft.content.replace(/\s+/g, '').length < stitchHardMin) {
          this.logger.warn(
            `[Chapter ${chapterNumber}] 缝合内容仅${draft.content.length}字（硬性阈值${stitchHardMin}），降级为章节级写作`,
          );
          this.emitProgress(state.bookId, chapterNumber, 'writing', 3, '内容过短，章节级重写');
          draft = await this.creativeWriter.write(
            state, intent, previousChapterEnding,
            getPrompt('creative-writer'), undefined, continuityInjections, playbooks,
          );
          this.logger.log(
            `[Chapter ${chapterNumber}] 章节级重写完成 — 字数: ${draft.content.length}`,
          );
        }
      } else {
        // ── 重写轮或场景规划未启用：章节级写作 ──
        const stepLabel = isRewrite ? `重写第${attempt}轮` : '创作写作';
        this.logger.log(`[Chapter ${chapterNumber}] 步骤 4/8: ${stepLabel}`);
        this.emitProgress(state.bookId, chapterNumber, 'writing', 3, stepLabel);

        const rewriteInjections = scenePlan && isRewrite
          ? [...continuityInjections, `本章场景骨架参考：${scenePlan.scenes.map((s, i) => `场景${i + 1}-${s.purpose}(${s.objective})`).join('/')}/情感弧线：${scenePlan.overallEmotionalArc}，重写时保持相同结构`]
          : continuityInjections;

        let rewriteGuidance: RewriteGuidance | undefined;
        if (isRewrite && bestAttempt) {
          rewriteGuidance = {
            attemptNumber: attempt,
            maxAttempts,
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
        draft = await this.creativeWriter.write(
          state, intent, previousChapterEnding,
          getPrompt('creative-writer'), rewriteGuidance, rewriteInjections, playbooks,
        );
        this.logger.log(
          `[Chapter ${chapterNumber}] ${stepLabel}完成 — ${Date.now() - t0}ms | 标题: ${draft.title} | 字数: ${draft.content.length}`,
        );

        // 字数防护：内容低于用户目标的50%则不带guidance重试一次
        const directHardMin = Math.round((state.seed.targetChapterWordCount ?? 3000) * 0.5);
        if (draft.content.replace(/\s+/g, '').length < directHardMin) {
          this.logger.warn(
            `[Chapter ${chapterNumber}] 内容仅${draft.content.length}字（硬性阈值${directHardMin}），无guidance重写`,
          );
          draft = await this.creativeWriter.write(
            state, intent, previousChapterEnding,
            getPrompt('creative-writer'), undefined, continuityInjections, playbooks,
          );
          this.logger.log(
            `[Chapter ${chapterNumber}] 字数补救重写完成 — 字数: ${draft.content.length}`,
          );
        }
      }

      // Deterministic check inside quality loop — 硬规则前置，可在重写中修复
      const loopDetCheck = this.deterministicChecker.check(state, intent, draft);
      if (!loopDetCheck.pass) {
        this.logger.warn(
          `[Chapter ${chapterNumber}] 轮${attempt}确定性检查失败: ${loopDetCheck.failedChecks.map((c) => c.rule).join(', ')}`,
        );
      }

      // Review
      t0 = Date.now();
      this.emitProgress(state.bookId, chapterNumber, 'review', 4, `审阅第${attempt}轮`);
      const review = isEnabled('reviewer')
        ? await this.reviewer.review(state, intent, draft, getPrompt('reviewer'), playbooks)
        : this.buildDefaultReview();
      if (!loopDetCheck.pass) { // 将硬规则失败注入review的issues
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

      if (!bestAttempt || weightedScore > bestAttempt.weightedScore) {
        bestAttempt = attemptResult;
      }

      const hasCriticalIssues = review.issuesFound.some((i) => i.severity === 'critical');
      if (weightedScore >= qualityPassScore && !hasCriticalIssues && loopDetCheck.pass) {
        this.logger.log(
          `[Chapter ${chapterNumber}] 质量门控通过！加权分 ${weightedScore} >= ${qualityPassScore}（第${attempt}轮）`,
        );
        break;
      }

      if (attempt < maxAttempts) {
        this.logger.log(
          `[Chapter ${chapterNumber}] 质量门控未通过（${weightedScore} < ${qualityPassScore}${!loopDetCheck.pass ? ' + 硬规则失败' : ''}），准备第${attempt + 1}轮重写`,
        );
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

    // ── Step 6: Editor polish (only if best draft below polish threshold) ──
    let finalDraft = finalAttempt.draft;
    let finalReview = finalAttempt.review;
    let finalWeightedScore = finalAttempt.weightedScore;
    let wasEdited = false;
    const wasRewritten = attempts.length > 1;

    const needsPolish =
      finalAttempt.weightedScore < EDITOR_POLISH_THRESHOLD ||
      !prePolishDeterministicCheck.pass ||
      finalAttempt.review.issuesFound.some((i) => i.severity === 'critical');

    if (needsPolish && isEnabled('editor')) {
      t0 = Date.now();
      this.logger.log(
        `[Chapter ${chapterNumber}] 步骤 6/8: 编辑精修（加权分 ${finalAttempt.weightedScore} < ${EDITOR_POLISH_THRESHOLD}）`,
      );
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '编辑精修');

      const editReview = { ...finalReview };
      if (prePolishDeterministicCheck.failedChecks.length > 0) {
        editReview.issuesFound = [
          ...editReview.issuesFound,
          ...prePolishDeterministicCheck.failedChecks.map((c) => ({
            category: 'other' as const,
            severity: 'critical' as const,
            description: `硬规则违反: ${c.rule} - ${c.detail}`,
            suggestedFix: `修复 ${c.rule}`,
          })),
        ];
      }

      finalDraft = await this.editor.edit(state, intent, finalDraft, editReview, getPrompt('editor'), playbooks);
      wasEdited = true;
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '精修完成');
      this.logger.log(
        `[Chapter ${chapterNumber}] 精修完成 — ${Date.now() - t0}ms | 修改后字数: ${finalDraft.content.length}`,
      );
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'edit', 5, '跳过编辑');
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 6/8: 跳过编辑（质量足够）`);
    }

    // ── Step 7: Hook enhancement (optional) ──
    if (isEnabled('hook-crafter')) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 7/8: 钩子优化`);
      this.emitProgress(state.bookId, chapterNumber, 'hook', 6, '钩子优化');
      try {
        const enhanced = await this.hookCrafter.enhanceHook(state, intent, finalDraft, playbooks);
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
    }

    const finalDraftChanged =
      finalDraft.title !== finalAttempt.draft.title ||
      finalDraft.content !== finalAttempt.draft.content;
    if (finalDraftChanged) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 终稿复评（编辑/钩子后）`);
      this.emitProgress(state.bookId, chapterNumber, 'review', 4, '终稿复评');
      const postEditReview = isEnabled('reviewer')
        ? await this.reviewer.review(state, intent, finalDraft, getPrompt('reviewer'), playbooks)
        : this.buildDefaultReview();
      const postEditScore = this.calculateWeightedScore(postEditReview, state);
      if (postEditScore >= finalWeightedScore) { // 编辑后分数不低于原分才采纳，防止精修反降质
        finalReview = postEditReview;
        finalWeightedScore = postEditScore;
      } else {
        this.logger.warn(
          `[Chapter ${chapterNumber}] 编辑后分数下降 ${finalWeightedScore} → ${postEditScore}，保留原审阅结果`,
        );
        finalDraft = finalAttempt.draft; // 回退到编辑前的稿件
      }
      this.logger.log(
        `[Chapter ${chapterNumber}] 终稿复评完成 — ${Date.now() - t0}ms | ` +
        `裁决: ${finalReview.overallVerdict} | 加权分: ${finalWeightedScore}`,
      );
    }

    const deterministicCheck = this.deterministicChecker.check(state, intent, finalDraft);
    if (!deterministicCheck.pass) {
      this.logger.warn(
        `[Chapter ${chapterNumber}] 终稿确定性检查失败: ${deterministicCheck.failedChecks.map((c) => c.rule).join(', ')}`,
      );
    }

    await checkpoint('post-process');
    // ── Step 8: Record ──
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 8/8: 知识记录`);
    this.emitProgress(state.bookId, chapterNumber, 'record', 7, '知识记录');
    const loreRecord = await this.recorder.record(state, finalDraft, getPrompt('recorder'));
    this.emitProgress(state.bookId, chapterNumber, 'record', 7, '记录完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 记录完成 — ${Date.now() - t0}ms | ` +
      `伏线变更: ${loreRecord.plotThreadDeltas.length} | 角色变更: ${loreRecord.characterLifecycleDeltas.length}`,
    );

    this.emitProgress(state.bookId, chapterNumber, 'done', 7, '生成完成', true);

    const elapsed = Date.now() - workflowStart;
    await this.executionService.completeRun(runId, {
      totalDurationMs: elapsed, totalLoopAttempts: attempts.length,
      finalScore: finalWeightedScore, finalVerdict: finalReview.overallVerdict,
      nodeCount: 8, failedNodes: [],
    });
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== 工作流完成 ========== ${elapsed}ms\n` +
      `  标题: ${finalDraft.title}\n` +
      `  字数: ${finalDraft.content.length} | 轮次: ${attempts.length} | 已重写: ${wasRewritten} | 已编辑: ${wasEdited}\n` +
      `  审阅: ${finalReview.overallVerdict} (加权${finalWeightedScore}) | 问题数: ${finalReview.issuesFound.length}`,
    );

    return {
      arcDirective,
      intent,
      finalDraft,
      review: finalReview,
      deterministicCheck,
      loreRecord,
      voiceEvolution,
      wasEdited,
      wasRewritten,
      overallScore: finalWeightedScore,
      attemptCount: attempts.length,
      allAttemptScores: allScores,
      bestAttemptIndex: bestIndex,
    };
    } catch (error) {
      await this.executionService.failRun(runId, (error as Error).message?.slice(0, 500));
      throw error;
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
      overallScore: 8,
      overallVerdict: 'good' as const,
      issuesFound: [],
      strengths: [],
      dimensions: {
        engagement: 8, pacing: 8, hookStrength: 8,
        consistency: 8, proseQuality: 8, characterDepth: 8,
      },
    };
  }
}
