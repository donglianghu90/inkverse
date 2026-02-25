/**
 * V2 章节工作流编排器。
 *
 * 6 步流程：
 * ① 意图 → ② 写作 → ③ 审阅（确定性 + LLM）→ ④ 修改（可跳过）→ ⑤ 记录 → [触发器判断]
 *
 * 对比 V1 的 9 步 + 修复循环：
 * - LLM 调用从 ~11-13 次降到 ~4-5 次
 * - 写作者有创作自由
 * - 质量校验合并为一次综合评价
 * - 修改只做一次精准手术，不循环
 */
import { Injectable, Logger } from '@nestjs/common';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';
import { NovelProgressService } from './novel-progress.service';
import { AgentNodeConfig } from './entities/book-agent-pipeline.entity';
import {
  ChapterIntent,
  ChapterReview,
  DeterministicCheckResult,
  StoryStateV2,
} from './schemas/novel-v2.schemas';
import { ChapterDraft, LoreRecord } from './schemas/novel.schemas';

export interface ChapterWorkflowV2Result {
  intent: ChapterIntent;
  finalDraft: ChapterDraft;
  review: ChapterReview;
  deterministicCheck: DeterministicCheckResult;
  loreRecord: LoreRecord;
  wasEdited: boolean;
  wasRewritten: boolean;
  overallScore: number;
}

@Injectable()
export class ChapterWorkflowV2Service {
  private readonly logger = new Logger(ChapterWorkflowV2Service.name);

  constructor(
    private readonly intentAgent: IntentAgent,
    private readonly creativeWriter: CreativeWriterAgent,
    private readonly reviewer: ReviewerAgent,
    private readonly editor: EditorAgent,
    private readonly recorder: RecorderAgent,
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
      totalSteps: 5,
      message,
      done,
      error,
    });
  }

  async run(
    state: StoryStateV2,
    previousChapterEnding?: string,
    pipelineNodes?: AgentNodeConfig[],
  ): Promise<ChapterWorkflowV2Result> {
    const getPrompt = (id: string) =>
      pipelineNodes?.find((n) => n.id === id)?.additionalSystemPrompt || undefined;
    const isEnabled = (id: string) =>
      pipelineNodes ? (pipelineNodes.find((n) => n.id === id)?.isEnabled ?? true) : true;
    const chapterNumber = state.chapterCursor;
    const workflowStart = Date.now();
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== V2 工作流开始 ==========\n` +
      `  bookId: ${state.bookId}`,
    );

    // Step 1: Intent
    let t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 1/5: 意图设定`);
    this.emitProgress(state.bookId, chapterNumber, 'intent', 0, '意图设定');
    const intent = await this.intentAgent.buildIntent(state, getPrompt('intent'));
    this.emitProgress(state.bookId, chapterNumber, 'intent', 0, '意图完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 意图完成 — ${Date.now() - t0}ms | ` +
      `目标: ${intent.goals.length} | 字数: ${intent.wordCountRange.min}-${intent.wordCountRange.max}`,
    );

    // Step 2: Creative Writing
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 2/5: 创作写作`);
    this.emitProgress(state.bookId, chapterNumber, 'writing', 1, '创作写作');
    let draft = await this.creativeWriter.write(state, intent, previousChapterEnding, getPrompt('creative-writer'));
    this.emitProgress(state.bookId, chapterNumber, 'writing', 1, '写作完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 写作完成 — ${Date.now() - t0}ms | ` +
      `标题: ${draft.title} | 字数: ${draft.content.length}`,
    );

    // Step 3a: Deterministic checks (free, always run)
    const deterministicCheck = this.deterministicChecker.check(state, intent, draft);
    if (!deterministicCheck.pass) {
      this.logger.warn(
        `[Chapter ${chapterNumber}] 确定性检查失败: ${deterministicCheck.failedChecks.map((c) => c.rule).join(', ')}`,
      );
    }

    // Step 3b: LLM Review
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 3/5: 综合审阅`);
    this.emitProgress(state.bookId, chapterNumber, 'review', 2, '综合审阅');
    const review = isEnabled('reviewer')
      ? await this.reviewer.review(state, intent, draft, getPrompt('reviewer'))
      : { overallScore: 8, overallVerdict: 'good' as const, issuesFound: [], strengths: [], dimensionScores: { engagement: 8, pacing: 8, hookStrength: 8, consistency: 8, proseQuality: 8, characterDepth: 8 } };
    this.emitProgress(state.bookId, chapterNumber, 'review', 2, '审阅完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 审阅完成 — ${Date.now() - t0}ms | ` +
      `裁决: ${review.overallVerdict} | 总分: ${review.overallScore} | 问题: ${review.issuesFound.length}`,
    );

    // Step 4: Rewrite / Edit / Skip
    let wasEdited = false;
    let wasRewritten = false;
    const hasCritical = review.issuesFound.some((i) => i.severity === 'critical');
    const isMajor = review.overallVerdict === 'major_issues';
    const needsRewrite = isMajor || (hasCritical && review.overallScore < 5);
    const needsEdit =
      !needsRewrite &&
      (review.overallVerdict !== 'good' ||
        !deterministicCheck.pass ||
        hasCritical);

    if (needsRewrite) {
      t0 = Date.now();
      this.logger.log(
        `[Chapter ${chapterNumber}] 步骤 4/5: 整章重写 ` +
        `(verdict=${review.overallVerdict}, score=${review.overallScore}, critical=${hasCritical})`,
      );
      this.emitProgress(state.bookId, chapterNumber, 'rewrite', 3, '整章重写');

      draft = await this.creativeWriter.write(state, intent, previousChapterEnding, getPrompt('creative-writer'));
      wasRewritten = true;

      const reReview = await this.reviewer.review(state, intent, draft, getPrompt('reviewer'));
      const stillBad =
        reReview.overallVerdict !== 'good' ||
        !deterministicCheck.pass ||
        reReview.issuesFound.some((i) => i.severity === 'critical');
      if (stillBad) {
        if (deterministicCheck.failedChecks.length > 0) {
          reReview.issuesFound.push(...deterministicCheck.failedChecks.map((c) => ({
            category: 'other' as const,
            severity: 'critical' as const,
            description: `硬规则违反: ${c.rule} - ${c.detail}`,
            suggestedFix: `修复 ${c.rule}`,
          })));
        }
        draft = await this.editor.edit(state, intent, draft, reReview, getPrompt('editor'));
        wasEdited = true;
      }
      Object.assign(review, reReview);

      this.emitProgress(state.bookId, chapterNumber, 'rewrite', 3, '重写完成');
      this.logger.log(
        `[Chapter ${chapterNumber}] 重写完成 — ${Date.now() - t0}ms | 字数: ${draft.content.length} | 再编辑: ${wasEdited}`,
      );
    } else if (needsEdit) {
      t0 = Date.now();
      this.logger.log(
        `[Chapter ${chapterNumber}] 步骤 4/5: 编辑修改 ` +
        `(${review.issuesFound.length} 个问题, ${deterministicCheck.failedChecks.length} 个硬规则失败)`,
      );
      this.emitProgress(state.bookId, chapterNumber, 'edit', 3, '编辑修改');

      if (deterministicCheck.failedChecks.length > 0) {
        review.issuesFound.push(...deterministicCheck.failedChecks.map((c) => ({
          category: 'other' as const,
          severity: 'critical' as const,
          description: `硬规则违反: ${c.rule} - ${c.detail}`,
          suggestedFix: `修复 ${c.rule}`,
        })));
      }

      draft = await this.editor.edit(state, intent, draft, review, getPrompt('editor'));
      wasEdited = true;
      this.emitProgress(state.bookId, chapterNumber, 'edit', 3, '编辑完成');
      this.logger.log(
        `[Chapter ${chapterNumber}] 编辑完成 — ${Date.now() - t0}ms | 修改后字数: ${draft.content.length}`,
      );
    } else {
      this.emitProgress(state.bookId, chapterNumber, 'edit', 3, '跳过编辑');
      this.logger.log(`[Chapter ${chapterNumber}] 步骤 4/5: 跳过编辑（审阅通过）`);
    }

    // Step 5: Record
    t0 = Date.now();
    this.logger.log(`[Chapter ${chapterNumber}] 步骤 5/5: 知识记录`);
    this.emitProgress(state.bookId, chapterNumber, 'record', 4, '知识记录');
    const loreRecord = await this.recorder.record(state, draft, getPrompt('recorder'));
    this.emitProgress(state.bookId, chapterNumber, 'record', 4, '记录完成');
    this.logger.log(
      `[Chapter ${chapterNumber}] 记录完成 — ${Date.now() - t0}ms | ` +
      `伏线变更: ${loreRecord.plotThreadDeltas.length} | 角色变更: ${loreRecord.characterLifecycleDeltas.length}`,
    );

    this.emitProgress(state.bookId, chapterNumber, 'done', 5, '生成完成', true);

    const elapsed = Date.now() - workflowStart;
    this.logger.log(
      `[Chapter ${chapterNumber}] ========== V2 工作流完成 ========== ${elapsed}ms\n` +
      `  标题: ${draft.title}\n` +
      `  字数: ${draft.content.length} | 已重写: ${wasRewritten} | 已编辑: ${wasEdited}\n` +
      `  审阅: ${review.overallVerdict} (${review.overallScore}) | 问题数: ${review.issuesFound.length}`,
    );

    return {
      intent,
      finalDraft: draft,
      review,
      deterministicCheck,
      loreRecord,
      wasEdited,
      wasRewritten,
      overallScore: review.overallScore,
    };
  }
}
