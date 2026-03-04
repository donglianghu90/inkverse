/**
 * 逐集 Pipeline 编排 — 支持断点续跑、连续性阻断回退、审阅精修定向修复。
 * 流程：ArcDirector → EpisodeDirector → ContinuityGuard → Scriptwriter → DialogueCoach
 *       → StoryboardDirector → AudioDirector → DeterministicChecker → ScriptReviewer
 *       → (if needs_edit) ScriptEditor → PacingAnalyzer → HookCrafter → EpisodeRecorder
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { DramaState } from './schemas/drama-state.schemas';
import { ArcDirectorAgent } from './agents/arc-director.agent';
import { EpisodeDirectorAgent } from './agents/episode-director.agent';
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { ScriptwriterAgent } from './agents/scriptwriter.agent';
import { DialogueCoachAgent } from './agents/dialogue-coach.agent';
import { StoryboardDirectorAgent } from './agents/storyboard-director.agent';
import { AudioDirectorAgent } from './agents/audio-director.agent';
import { ScriptReviewerAgent } from './agents/script-reviewer.agent';
import { ScriptEditorAgent } from './agents/script-editor.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { EpisodeRecorderAgent } from './agents/episode-recorder.agent';
import { DramaDeterministicCheckerService } from './validators/deterministic-checker.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaAgentPipelineService } from './drama-agent-pipeline.service';
import { DramaWorkflowExecutionService } from './drama-workflow-execution.service';
import { DramaCalibrationService } from './drama-calibration.service';
import { DramaWorkflowParams, DEFAULT_DRAMA_WORKFLOW_PARAMS } from './entities/drama-agent-pipeline.entity';
import { LlmTraceLoggerService } from '../novel/llm/llm-trace-logger.service';

const STEP_ORDER = [ // 步骤顺序定义（用于断点续跑）
  'arc_planned', 'intent_ready', 'continuity_checked', 'script_drafted',
  'dialogue_polished', 'storyboard_drafted', 'audio_designed',
  'deterministic_checked', 'reviewed', 'edited', 'pacing_analyzed',
  'hook_crafted', 'recorded',
] as const;

type StepName = typeof STEP_ORDER[number];

@Injectable()
export class EpisodeWorkflowService {
  private readonly logger = new Logger(EpisodeWorkflowService.name);
  private readonly runningEpisodes = new Set<string>(); // 并发互斥锁：dramaId:epNum

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    private readonly executionService: DramaWorkflowExecutionService,
    private readonly arcDirector: ArcDirectorAgent,
    private readonly episodeDirector: EpisodeDirectorAgent,
    private readonly continuityGuard: ContinuityGuardAgent,
    private readonly scriptwriter: ScriptwriterAgent,
    private readonly dialogueCoach: DialogueCoachAgent,
    private readonly storyboardDirector: StoryboardDirectorAgent,
    private readonly audioDirector: AudioDirectorAgent,
    private readonly reviewer: ScriptReviewerAgent,
    private readonly editor: ScriptEditorAgent,
    private readonly pacingAnalyzer: PacingAnalyzerAgent,
    private readonly hookCrafter: HookCrafterAgent,
    private readonly episodeRecorder: EpisodeRecorderAgent,
    private readonly deterministicChecker: DramaDeterministicCheckerService,
    private readonly progressService: DramaProgressService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly calibrationService: DramaCalibrationService,
    private readonly traceLogger: LlmTraceLoggerService,
  ) {}

  async generateEpisode(dramaId: string, episodeNumber: number): Promise<void> {
    const lockKey = `${dramaId}:${episodeNumber}`;
    if (this.runningEpisodes.has(lockKey)) throw new Error(`E${episodeNumber} 正在生成中，请勿重复提交`);
    this.runningEpisodes.add(lockKey);
    try { await this._generateEpisodeImpl(dramaId, episodeNumber); } finally { this.runningEpisodes.delete(lockKey); }
  }

  private async _generateEpisodeImpl(dramaId: string, episodeNumber: number): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const wp: DramaWorkflowParams = await this.pipelineService.getWorkflowParams(dramaId);
    let synopsis = state.seriesOutline?.episodes?.[episodeNumber - 1];
    if (!synopsis) throw new Error(`大纲中不存在第 ${episodeNumber} 集`);

    // ── 断点续传：检测可恢复的中断运行 ──
    let runId: string;
    let cached: Record<string, unknown> = {};
    let resumed = false;
    let resumeCheckpoint = '';
    try {
      const resumable = await this.executionService.findResumableRun(dramaId, episodeNumber);
      if (resumable) {
        const reopened = await this.executionService.reopenRun(resumable.id);
        if (reopened) {
          runId = resumable.id;
          cached = resumable.stepOutputs ?? {};
          resumeCheckpoint = resumable.lastCheckpoint ?? '';
          resumed = true;
          this.logger.log(
            `[E${episodeNumber}] ========== 断点续传 ==========\n` +
            `  runId: ${runId} | 已缓存: [${Object.keys(cached).join(', ')}] | checkpoint: ${resumable.lastCheckpoint}`,
          );
        } else {
          this.logger.warn(`[E${episodeNumber}] 断点续传抢占失败，降级为新建运行`);
        }
      }
    } catch (e) {
      this.logger.warn(`[E${episodeNumber}] 断点续传检测失败，降级为新建: ${(e as Error).message}`);
    }
    if (!resumed) {
      runId = await this.executionService.createRun(dramaId, episodeNumber);
      cached = {};
      this.logger.log(
        `[E${episodeNumber}] ========== 工作流开始 ==========\n` +
        `  dramaId: ${dramaId} | runId: ${runId}`,
      );
    }
    const resumeFrom = resumeCheckpoint ? this.getResumeStep(resumeCheckpoint) : -1;

    // ── 所有权断言 & 检查点闭包 ──
    let ownershipLost = false;
    const assertOwnership = async (): Promise<void> => {
      if (ownershipLost) throw new Error(`[E${episodeNumber}] 运行所有权已丢失，中止执行`);
      const ok = await this.executionService.assertOwnership(runId);
      if (!ok) { ownershipLost = true; throw new Error(`[E${episodeNumber}] 运行所有权已失效，中止执行`); }
    };
    const checkpoint = async (step: string): Promise<void> => {
      const ok = await this.executionService.saveCheckpoint(runId, step);
      if (!ok) throw new Error(`[E${episodeNumber}] checkpoint写入失败 step=${step}`);
    };
    const saveStep = async (step: string, output: unknown): Promise<void> => {
      const ok = await this.executionService.saveStepOutput(runId, step, output);
      if (!ok) throw new Error(`[E${episodeNumber}] stepOutput写入失败 step=${step}`);
    };

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const emitEp = (stepIndex: number, message: string, done = false) =>
      this.progressService.emit({ dramaId, phase: 'episode', episodeNumber, step: `ep_${stepIndex}`, stepIndex, totalSteps: 13, message, done });
    const logDrama = (step: string, status: 'ok' | 'error', message?: string, meta?: Record<string, unknown>) =>
      this.traceLogger.logDramaWorkflowEvent({ dramaId, phase: 'episode', step, status, episodeNumber, message, ...meta });
    logDrama('episode_start', 'ok', `E${episodeNumber} 工作流开始`, { runId, resumeFrom, resumed });

    const outputs = (cached ?? {}) as Record<string, Record<string, unknown>>;
    let arcSegment = outputs.arc_planned?.arcSegment as any;
    let intent = outputs.intent_ready?.intent as any;
    let continuity = outputs.continuity_checked?.continuity as any;
    let script = outputs.script_drafted?.script as any ?? outputs.dialogue_polished?.script as any;
    let storyboard = outputs.storyboard_drafted?.storyboard as any ?? outputs.audio_designed?.storyboard as any;
    let review = outputs.reviewed?.review as any;
    let pacing = outputs.pacing_analyzed?.pacing as any;
    let hookResult = outputs.hook_crafted?.hookResult as any;

    try {
      if (resumeFrom < 0) { // Step 0: 段落规划 + 骨架集展开
        logDrama('arc_plan_start', 'ok', '段落规划');
        emitEp(0, '段落规划...');
        arcSegment = await this.arcDirector.planOrRefresh(state, episodeNumber);
        if (!state.currentArcSegment || state.currentArcSegment.segmentId !== arcSegment.segmentId) {
          state.currentArcSegment = arcSegment;
          if (!state.arcSegments.find(a => a.segmentId === arcSegment.segmentId)) state.arcSegments.push(arcSegment);
        }
        // 骨架集展开：若当前集大纲为占位内容则调用 ArcDirector 补充详细概要
        if (!synopsis.coreConflict || synopsis.coreConflict === '待展开') {
          const segStart = arcSegment.startEpisode;
          const segEnd = Math.min(arcSegment.endEpisode, state.seriesOutline?.totalPlannedEpisodes ?? arcSegment.endEpisode);
          const skeletonRange = Array.from({ length: segEnd - segStart + 1 }, (_, i) => segStart + i)
            .filter(n => { const s = state.seriesOutline?.episodes?.[n - 1]; return !s?.coreConflict || s.coreConflict === '待展开'; });
          if (skeletonRange.length > 0) {
            emitEp(0, `展开骨架集 E${skeletonRange[0]}-E${skeletonRange[skeletonRange.length - 1]}...`);
            const expanded = await this.arcDirector.expandEpisodeSynopses(state, arcSegment, skeletonRange);
            expanded.forEach(es => { if (state.seriesOutline?.episodes?.[es.episodeNumber - 1]) state.seriesOutline!.episodes[es.episodeNumber - 1] = es; });
            synopsis = state.seriesOutline!.episodes[episodeNumber - 1];
          }
        }
        await saveStep('arc_planned', { arcSegment }); await checkpoint('arc_planned');
        logDrama('arc_plan_done', 'ok', '段落规划完成', { segmentId: arcSegment?.segmentId });
        emitEp(0, '段落规划完成', true);
      }

      if (resumeFrom < 1) { // Step 1: 集导演规划
        logDrama('intent_start', 'ok', '集导演规划');
        emitEp(1, '集导演规划...');
        intent = await this.episodeDirector.direct(state, synopsis);
        await saveStep('intent_ready', { intent }); await checkpoint('intent_ready');
        logDrama('intent_done', 'ok', '集导演完成');
        emitEp(1, '集导演完成', true);
      }

      if (resumeFrom < 2) { // Step 2: 连续性检查（阻断时回退重试）
        logDrama('continuity_start', 'ok', '连续性检查');
        emitEp(2, '连续性检查...');
        continuity = await this.continuityGuard.verify(state, intent);
        const blocks = continuity.warnings.filter((w: any) => w.severity === 'block');
        if (blocks.length > 0) {
          this.logger.warn(`E${episodeNumber} 连续性阻断: ${blocks.map((b: any) => b.description).join('; ')}`);
          for (let retry = 0; retry < wp.maxContinuityRetries; retry++) {
            emitEp(2, `连续性阻断，重新规划(${retry + 1})...`);
            intent = await this.episodeDirector.direct(state, synopsis, continuity.contextInjections);
            continuity = await this.continuityGuard.verify(state, intent);
            if (!continuity.warnings.some((w: any) => w.severity === 'block')) break;
          }
        }
        await saveStep('continuity_checked', { continuity }); await checkpoint('continuity_checked');
        logDrama('continuity_done', 'ok', '连续性检查完成');
        emitEp(2, '连续性检查完成', true);
      }

      if (resumeFrom < 3) { // Step 3: 编剧创作
        logDrama('script_start', 'ok', '编剧创作');
        emitEp(3, '编剧创作...');
        script = await this.scriptwriter.write(state, intent, continuity);
        await saveStep('script_drafted', { script }); await checkpoint('script_drafted');
        logDrama('script_done', 'ok', '编剧创作完成');
        emitEp(3, '编剧创作完成', true);
      }

      if (resumeFrom < 4) { // Step 4: 台词润色（可配置开关）
        logDrama('dialogue_start', 'ok', '台词润色');
        emitEp(4, '台词润色...');
        if (wp.enableDialogueCoach) {
          try { script = await this.dialogueCoach.polish(script, state.characters, state.promptProfile, state.dramaId, state); }
          catch (err) { this.logger.warn(`E${episodeNumber} 台词润色降级: ${(err as Error).message}`); }
        } else { this.logger.log(`E${episodeNumber} 台词润色已跳过(配置关闭)`); }
        await saveStep('dialogue_polished', { script }); await checkpoint('dialogue_polished');
        logDrama('dialogue_done', 'ok', '台词润色完成');
        emitEp(4, '台词润色完成', true);
      }

      if (resumeFrom < 5) { // Step 5: 分镜生成（按场景分步）
        logDrama('storyboard_start', 'ok', '分镜生成');
        emitEp(5, '分镜生成...');
        storyboard = await this.storyboardDirector.direct(state, script);
        await saveStep('storyboard_drafted', { storyboard }); await checkpoint('storyboard_drafted');
        logDrama('storyboard_done', 'ok', '分镜生成完成', { shotCount: storyboard?.shots?.length });
        emitEp(5, '分镜生成完成', true);
      }

      if (resumeFrom < 6) { // Step 6: 音频设计
        if (!storyboard?.shots?.length) {
          if (!script?.scenes?.length) throw new Error('剧本数据缺失，无法重新生成分镜');
          this.logger.warn(`[E${episodeNumber}] 分镜数据缺失，回退重新生成分镜`);
          emitEp(5, '分镜数据缺失，重新生成分镜...');
          storyboard = await this.storyboardDirector.direct(state, script);
          await saveStep('storyboard_drafted', { storyboard }); await checkpoint('storyboard_drafted');
          emitEp(5, '分镜重新生成完成', true);
        }
        logDrama('audio_start', 'ok', '音频设计');
        emitEp(6, '音频设计...');
        storyboard = await this.audioDirector.enhance(state, storyboard);
        await saveStep('audio_designed', { storyboard }); await checkpoint('audio_designed');
        logDrama('audio_done', 'ok', '音频设计完成');
        emitEp(6, '音频设计完成', true);
      }

      if (resumeFrom < 7) { // Step 7: 硬规则校验
        if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行硬规则校验');
        logDrama('deterministic_start', 'ok', '硬规则校验');
        emitEp(7, '硬规则校验...');
        const detCheck = this.deterministicChecker.check(state, script, storyboard);
        if (detCheck.hardFails?.length) {
          const msg = `E${episodeNumber} 硬规则阻断: ${detCheck.hardFails.map(f => `${f.rule}(${f.detail})`).join('; ')}`;
          this.logger.error(msg);
          throw new Error(msg);
        }
        if (!detCheck.pass) this.logger.warn(`E${episodeNumber} 软规则警告: ${detCheck.failedChecks.filter(f => !detCheck.hardFails.some(h => h.rule === f.rule)).map(f => f.rule).join(', ')}`);
        await saveStep('deterministic_checked', { detCheck }); await checkpoint('deterministic_checked');
        logDrama('deterministic_done', 'ok', '硬规则校验完成');
        emitEp(7, '硬规则校验完成', true);
      }

      if (resumeFrom < 8) { // Step 8: 质量审核
        if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行质量审核');
        logDrama('review_start', 'ok', '质量审核');
        emitEp(8, '质量审核...');
        review = await this.reviewer.review(state, script, storyboard);
        await saveStep('reviewed', { review }); await checkpoint('reviewed');
        logDrama('review_done', 'ok', '质量审核完成', { verdict: review?.overallVerdict });
        emitEp(8, '质量审核完成', true);
      }

      if (resumeFrom < 9) { // Step 9: 精修（定向修复特定Shot）
        logDrama('edit_start', 'ok', '精修');
        for (let round = 0; round < wp.maxEditRounds && review.overallVerdict === 'needs_edit'; round++) {
          emitEp(9, `精修第${round + 1}轮...`);
          const criticalIssues = review.issuesFound?.filter((i: any) => i.severity === 'critical') ?? [];
          storyboard = await this.editor.fix(state, storyboard, review, criticalIssues);
          review = await this.reviewer.review(state, script, storyboard);
          await saveStep('edited', { storyboard, review, round: round + 1 }); await checkpoint('edited');
        }
        logDrama('edit_done', 'ok', '精修完成');
        emitEp(9, '精修完成', true);
      }

      if (resumeFrom < 10) { // Step 10: 节奏分析（可配置开关）
        if (wp.enablePacingAnalyzer && !storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行节奏分析');
        logDrama('pacing_start', 'ok', '节奏分析');
        emitEp(10, '节奏分析...');
        if (wp.enablePacingAnalyzer) {
          try { pacing = await this.pacingAnalyzer.analyze(state, storyboard); }
          catch (err) { this.logger.warn(`E${episodeNumber} 节奏分析降级: ${(err as Error).message}`); }
        } else { this.logger.log(`E${episodeNumber} 节奏分析已跳过(配置关闭)`); }
        await saveStep('pacing_analyzed', { pacing }); await checkpoint('pacing_analyzed');
        logDrama('pacing_done', 'ok', '节奏分析完成');
        emitEp(10, '节奏分析完成', true);
      }

      if (resumeFrom < 11) { // Step 11: 悬念设计（可配置开关）
        if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行悬念设计');
        logDrama('hook_start', 'ok', '悬念设计');
        emitEp(11, '悬念设计...');
        hookResult = { previewShots: [] };
        if (wp.enableHookCrafter) {
          try {
            hookResult = await this.hookCrafter.craft(state, storyboard);
            if (hookResult.previewShots?.length) {
              const sbShots = storyboard?.shots ?? [];
              const baseIdx = sbShots.length;
              hookResult.previewShots.forEach((ps: any, i: number) => {
                ps.shotIndex = baseIdx + i;
                ps.sceneId = ps.sceneId || `ep${episodeNumber}_preview`;
                ps.isPreview = true;
              });
              sbShots.push(...hookResult.previewShots);
              storyboard!.shots = sbShots;
              storyboard!.totalEstimatedDurationSec = Math.round(sbShots.reduce((s: number, sh: any) => s + (sh.estimatedDurationSec ?? 0), 0) * 10) / 10;
            }
          } catch (err) { this.logger.warn(`E${episodeNumber} 悬念设计降级: ${(err as Error).message}`); }
        } else { this.logger.log(`E${episodeNumber} 悬念设计已跳过(配置关闭)`); }
        await saveStep('hook_crafted', { hookResult }); await checkpoint('hook_crafted');
        logDrama('hook_done', 'ok', '悬念设计完成');
        emitEp(11, '悬念设计完成', true);
      }

      if (resumeFrom < 12) { // Step 12: 知识记录 + 持久化
        if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法完成知识记录');
        logDrama('record_start', 'ok', '知识记录+持久化');
        emitEp(12, '知识记录...');
        const loreRecord = await this.episodeRecorder.record(state, script, storyboard, hookResult?.cliffhangerSummary ?? '');
        await saveStep('recorded', { loreRecord }); await checkpoint('recorded');

        const sbShots = storyboard?.shots ?? [];
        const episode = this.episodeRepo.create({
          dramaId: drama.id, episodeNumber, title: synopsis.title,
          script: script as unknown as Record<string, unknown>,
          storyboard: storyboard as unknown as Record<string, unknown>,
          review: review as unknown as Record<string, unknown>,
          loreRecord: loreRecord as unknown as Record<string, unknown>,
          overallScore: review.overallScore,
          totalDurationSec: Math.round(storyboard?.totalEstimatedDurationSec ?? 0),
          shotCount: sbShots.length,
        });
        await this.episodeRepo.save(episode);

        this.updateDramaState(state, episodeNumber, hookResult ?? {}, loreRecord, review);

        // 集级自校准 — 将审阅发现的问题反哺到配置
        try {
          const cal = this.calibrationService.calibrate(state, review, episodeNumber);
          if (cal.events.length) this.logger.log(`[E${episodeNumber}] 校准完成 | 事件数: ${cal.events.length}`);
        } catch (e) { this.logger.warn(`[E${episodeNumber}] 校准失败: ${(e as Error).message}`); }

        drama.state = state as unknown as Record<string, unknown>;
        drama.episodesGenerated = episodeNumber;
        drama.latestOverallScore = review.overallScore;
        await this.dramaRepo.save(drama);

        await this.executionService.completeRun(runId!, {
          overallScore: review.overallScore, shotCount: sbShots.length,
          duration: storyboard?.totalEstimatedDurationSec ?? 0, totalDurationMs: 0, editRounds: 0,
        });
        logDrama('episode_done', 'ok', `E${episodeNumber} 生成完成`, { score: review.overallScore, shotCount: sbShots.length, durationSec: storyboard?.totalEstimatedDurationSec });
        emitEp(12, `E${episodeNumber} 生成完成`, true);
        this.logger.log(`E${episodeNumber} 完成 — 评分:${review.overallScore} Shot:${sbShots.length} 时长:${storyboard?.totalEstimatedDurationSec}s`);
      }
    } catch (err) {
      logDrama('episode_failed', 'error', (err as Error).message, { error: (err as Error).message });
      const failed = await this.executionService.failRun(runId, (err as Error).message?.slice(0, 500) ?? String(err));
      if (!failed) this.logger.warn(`[E${episodeNumber}] failRun被拒绝 runId=${runId}`);
      throw err;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  /** 根据checkpoint名称计算恢复步骤索引 */
  private getResumeStep(checkpoint: string): number {
    const idx = STEP_ORDER.indexOf(checkpoint as StepName);
    return idx >= 0 ? idx + 1 : -1; // 从下一步开始
  }

  private updateDramaState(
    state: DramaState, epNum: number,
    hookResult: { cliffhangerSummary?: string; hookType?: string },
    loreRecord: { summary?: string; flashbackCandidates?: Array<{ shotId?: string; reason?: string; emotionalWeight?: 'low' | 'medium' | 'high' | 'iconic' }>; newSecrets?: Array<{ secret?: string; knownBy?: string[]; hiddenFrom?: string[] }>; plotAdvances?: string[] },
    review: { overallScore?: number; dimensions?: Record<string, number> },
  ): void {
    state.episodeCursor = epNum + 1;
    state.lastCliffhanger = hookResult.cliffhangerSummary ?? '';
    state.recentHookTypes.push({ episodeNumber: epNum, hookType: hookResult.hookType ?? 'cliffhanger' });
    if (state.recentHookTypes.length > 10) state.recentHookTypes = state.recentHookTypes.slice(-10);
    state.episodeSummaries.push({ episodeNumber: epNum, summary: loreRecord.summary ?? '' });

    // 回写 secretLedger（修复：之前只读不写导致秘密泄露检查失效）
    (loreRecord.newSecrets ?? []).forEach((ns, i) => {
      if (!ns.secret) return;
      state.secretLedger.push({ id: `secret_ep${epNum}_${i}`, secret: ns.secret, knownBy: ns.knownBy ?? [], hiddenFrom: ns.hiddenFrom ?? [], seededAtEpisode: epNum, resolved: false });
    });

    const score = review.overallScore ?? 0;
    state.kpiHistory.push({ episodeNumber: epNum, overallScore: score, dimensions: review.dimensions ?? {}, generatedAt: new Date().toISOString() });
    (loreRecord.flashbackCandidates ?? []).forEach(fc => {
      state.flashbackBank.push({ shotId: fc.shotId ?? '', reason: fc.reason ?? '', emotionalWeight: fc.emotionalWeight ?? 'low', episodeNumber: epNum, visualPromptSnapshot: '' });
    });
    const intensity = score >= 8.5 ? 'climactic' : score >= 7 ? 'major' : score >= 5.5 ? 'medium' : 'minor';
    state.dopamineSchedule.history.push({ type: hookResult.hookType ?? 'cliffhanger', intensity, deliveredAtEpisode: epNum, description: hookResult.cliffhangerSummary ?? '' });
    state.dopamineSchedule.episodesSinceMinor = intensity === 'minor' ? 0 : state.dopamineSchedule.episodesSinceMinor + 1;
    state.dopamineSchedule.episodesSinceMajor = (intensity === 'major' || intensity === 'climactic') ? 0 : state.dopamineSchedule.episodesSinceMajor + 1;

    // 滚动更新 storySoFar（最近 30 集摘要压缩为全局概要）
    const recentN = state.episodeSummaries.slice(-30);
    state.storySoFar = recentN.length <= 10
      ? recentN.map(s => `E${s.episodeNumber}:${s.summary}`).join('\n')
      : [
          ...recentN.slice(0, -10).map(s => `E${s.episodeNumber}:${s.summary.slice(0, 40)}`),
          ...recentN.slice(-10).map(s => `E${s.episodeNumber}:${s.summary}`),
        ].join('\n');

    // DramaState 裁剪（防止无限膨胀）
    if (state.episodeSummaries.length > 60) state.episodeSummaries = state.episodeSummaries.slice(-60);
    if (state.flashbackBank.length > 120) state.flashbackBank = state.flashbackBank.slice(-120);
    if (state.kpiHistory.length > 60) state.kpiHistory = state.kpiHistory.slice(-60);
    if (state.dopamineSchedule.history.length > 60) state.dopamineSchedule.history = state.dopamineSchedule.history.slice(-60);

    state.updatedAt = new Date().toISOString();
  }

  private log(runId: string, step: number, name: string): void {
    this.logger.log(`[${runId.slice(0, 8)}] Step ${step}/13: ${name}`);
  }
}
