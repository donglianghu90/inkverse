/**
 * 章节工作流编排器 — 多轮质量门控版。
 *
 * 核心流程：
 * ① 意图 → ② 连续性预检 → ③ 写作（可配置修复轮数）→ ④ 审阅+质量门控 → ⑤ 精编（可选）→ ⑥ 记录
 *
 * 质量门控策略：
 * - 8.5 分通过 → 直接完成
 * - < 8.5 分 → 带 RewriteGuidance 重写（轮数可配置）
 * - 到达轮数上限后选最优稿
 * - 最优稿 < 7.0 → 触发 Editor 精修
 */
import { Injectable, Logger } from '@nestjs/common';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';
import { NovelProgressService } from './novel-progress.service';
import { AgentNodeConfig } from './entities/book-agent-pipeline.entity';
import {
  ChapterIntent,
  ChapterReview,
  DeterministicCheckResult,
  RewriteGuidance,
  StoryState,
} from './schemas/novel-state.schemas';
import { ChapterDraft, LoreRecord } from './schemas/novel.schemas';

const DEFAULT_QUALITY_PASS_SCORE = 8.5;
const DEFAULT_MAX_REPAIR_ROUNDS = 2;
const EDITOR_POLISH_THRESHOLD = 7.0;

interface DraftAttempt {
  draft: ChapterDraft;
  review: ChapterReview;
  weightedScore: number;
  attemptNumber: number;
}

export interface ChapterWorkflowResult {
  intent: ChapterIntent;
  finalDraft: ChapterDraft;
  review: ChapterReview;
  deterministicCheck: DeterministicCheckResult;
  loreRecord: LoreRecord;
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
    private readonly intentAgent: IntentAgent,
    private readonly creativeWriter: CreativeWriterAgent,
    private readonly reviewer: ReviewerAgent,
    private readonly editor: EditorAgent,
    private readonly recorder: RecorderAgent,
    private readonly continuityGuard: ContinuityGuardAgent,
    private readonly hookCrafter: HookCrafterAgent,
    private readonly pacingAnalyzer: PacingAnalyzerAgent,
    private readonly deterministicChecker: DeterministicCheckerService,
    private readonly progressService: NovelProgressService,
  ) {}

  private emitProgress(
    bookId: string,
    chapterNumber: number,
    step: string,
    stepIndex: number,
    message: string,
    done = false,
    error?: string,
  ): void {
    this.progressService.emit({
      bookId,
      chapterNumber,
      step,
      stepIndex,
      totalSteps: 7,
      message,
      done,
      error,
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
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== 工作流开始（多轮质量门控） ==========\n` +
      `  bookId: ${state.bookId} | 质量门槛: ${qualityPassScore} | 最大修复轮数: ${maxRepairRounds}`,
    );

    // ── Step 1: Intent ──
    let t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/7: 意图设定`);
    this.emitProgress(state.bookId, chapterNumber, 'intent', 0, '意图设定');
    const intent = await this.intentAgent.buildIntent(state, getPrompt('intent'));
    this.emitProgress(state.bookId, chapterNumber, 'intent', 0, '意图完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 意图完成 — ${Date.now() - t0}ms | ` +
      `目标: ${intent.goals.length} | 字数: ${intent.wordCountRange.min}-${intent.wordCountRange.max}`,
    );

    // ── Step 2: Continuity Pre-check ──
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 2/7: 连续性预检`);
    this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 1, '连续性预检');
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
    this.emitProgress(state.bookId, chapterNumber, 'continuity-check', 1, '预检完成');

    // ── Step 3: Multi-attempt Writing + Review Loop ──
    const attempts: DraftAttempt[] = [];
    let bestAttempt: DraftAttempt | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      t0 = Date.now();
      const isRewrite = attempt > 1;
      const stepLabel = isRewrite ? `重写第${attempt}轮` : '创作写作';
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 3/7: ${stepLabel}`);
      this.emitProgress(state.bookId, chapterNumber, 'writing', 2, stepLabel);

      let rewriteGuidance: RewriteGuidance | undefined;
      if (isRewrite && bestAttempt) {
        const previousIssues = bestAttempt.review.issuesFound.map((i) => ({
          category: i.category,
          severity: i.severity,
          description: i.description,
          suggestedFix: i.suggestedFix,
        }));
        const repeatedIssues = this.findRepeatedIssues(attempts);
        rewriteGuidance = {
          attemptNumber: attempt,
          maxAttempts,
          previousStrengths: bestAttempt.review.strengths,
          previousIssues,
          repeatedIssues,
          previousScore: bestAttempt.weightedScore,
        };
      }

      const draft = await this.creativeWriter.write(
        state, intent, previousChapterEnding,
        getPrompt('creative-writer'),
        rewriteGuidance,
        continuityInjections,
      );
      this.logger.log(
        `[Chapter ${chapterNumber}] ${stepLabel}完成 — ${Date.now() - t0}ms | ` +
        `标题: ${draft.title} | 字数: ${draft.content.length}`,
      );

      // Review
      t0 = Date.now();
      this.emitProgress(state.bookId, chapterNumber, 'review', 3, `审阅第${attempt}轮`);
      const review = isEnabled('reviewer')
        ? await this.reviewer.review(state, intent, draft, getPrompt('reviewer'))
        : this.buildDefaultReview();
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

      if (weightedScore >= qualityPassScore && !review.issuesFound.some((i) => i.severity === 'critical')) {
        this.logger.log(
          `[Chapter ${chapterNumber}] 质量门控通过！加权分 ${weightedScore} >= ${qualityPassScore}（第${attempt}轮）`,
        );
        break;
      }

      if (attempt < maxAttempts) {
        this.logger.log(
          `[Chapter ${chapterNumber}] 质量门控未通过（${weightedScore} < ${qualityPassScore}），准备第${attempt + 1}轮重写`,
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
    this.emitProgress(state.bookId, chapterNumber, 'writing', 2,
      `写作完成（${attempts.length}轮，最佳${finalAttempt.weightedScore}分）`);

    // ── Step 4: Deterministic checks ──
    const deterministicCheck = this.deterministicChecker.check(state, intent, finalAttempt.draft);
    if (!deterministicCheck.pass) {
      this.logger.warn(
        `[Chapter ${chapterNumber}] 确定性检查失败: ${deterministicCheck.failedChecks.map((c) => c.rule).join(', ')}`,
      );
    }

    // ── Step 5: Editor polish (only if best draft below polish threshold) ──
    let finalDraft = finalAttempt.draft;
    let finalReview = finalAttempt.review;
    let wasEdited = false;
    const wasRewritten = attempts.length > 1;

    const needsPolish =
      finalAttempt.weightedScore < EDITOR_POLISH_THRESHOLD ||
      !deterministicCheck.pass ||
      finalAttempt.review.issuesFound.some((i) => i.severity === 'critical');

    if (needsPolish && isEnabled('editor')) {
      t0 = Date.now();
      this.logger.log(
        `[Chapter ${chapterNumber}] 步骤 5/7: 编辑精修（加权分 ${finalAttempt.weightedScore} < ${EDITOR_POLISH_THRESHOLD}）`,
      );
      this.emitProgress(state.bookId, chapterNumber, 'edit', 4, '编辑精修');

      const editReview = { ...finalReview };
      if (deterministicCheck.failedChecks.length > 0) {
        editReview.issuesFound = [
          ...editReview.issuesFound,
          ...deterministicCheck.failedChecks.map((c) => ({
            category: 'other' as const,
            severity: 'critical' as const,
            description: `硬规则违反: ${c.rule} - ${c.detail}`,
            suggestedFix: `修复 ${c.rule}`,
          })),
        ];
      }

      finalDraft = await this.editor.edit(state, intent, finalDraft, editReview, getPrompt('editor'));
      wasEdited = true;
      this.emitProgress(state.bookId, chapterNumber, 'edit', 4, '精修完成');
      this.logger.log(
        `[Chapter ${chapterNumber}] 精修完成 — ${Date.now() - t0}ms | 修改后字数: ${finalDraft.content.length}`,
      );
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'edit', 4, '跳过编辑');
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 5/7: 跳过编辑（质量足够）`);
    }

    // ── Step 6: Hook enhancement (optional) ──
    if (isEnabled('hook-crafter')) {
      t0 = Date.now();
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 6/7: 钩子优化`);
      this.emitProgress(state.bookId, chapterNumber, 'hook', 5, '钩子优化');
      try {
        const enhanced = await this.hookCrafter.enhanceHook(state, intent, finalDraft);
        if (enhanced.content !== finalDraft.content) {
          finalDraft = enhanced;
          this.logger.log(`[Chapter ${chapterNumber}] 钩子优化完成 — ${Date.now() - t0}ms`);
        }
      } catch (err) {
        this.logger.warn(`[Chapter ${chapterNumber}] 钩子优化失败，使用原稿: ${err}`);
      }
      this.emitProgress(state.bookId, chapterNumber, 'hook', 5, '钩子完成');
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'hook', 5, '跳过钩子优化');
    }

    // ── Step 7: Record ──
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 7/7: 知识记录`);
    this.emitProgress(state.bookId, chapterNumber, 'record', 6, '知识记录');
    const loreRecord = await this.recorder.record(state, finalDraft, getPrompt('recorder'));
    this.emitProgress(state.bookId, chapterNumber, 'record', 6, '记录完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 记录完成 — ${Date.now() - t0}ms | ` +
      `伏线变更: ${loreRecord.plotThreadDeltas.length} | 角色变更: ${loreRecord.characterLifecycleDeltas.length}`,
    );

    this.emitProgress(state.bookId, chapterNumber, 'done', 7, '生成完成', true);

    const elapsed = Date.now() - workflowStart;
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== 工作流完成 ========== ${elapsed}ms\n` +
      `  标题: ${finalDraft.title}\n` +
      `  字数: ${finalDraft.content.length} | 轮次: ${attempts.length} | 已重写: ${wasRewritten} | 已编辑: ${wasEdited}\n` +
      `  审阅: ${finalReview.overallVerdict} (加权${finalAttempt.weightedScore}) | 问题数: ${finalReview.issuesFound.length}`,
    );

    return {
      intent,
      finalDraft,
      review: finalReview,
      deterministicCheck,
      loreRecord,
      wasEdited,
      wasRewritten,
      overallScore: finalAttempt.weightedScore,
      attemptCount: attempts.length,
      allAttemptScores: allScores,
      bestAttemptIndex: bestIndex,
    };
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
