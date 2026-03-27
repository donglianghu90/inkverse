/**
 * 逐集 Pipeline 编排 — 支持断点续跑、连续性阻断回退、审阅精修定向修复。
 * 流程：ArcDirector → EpisodeDirector → ContinuityGuard → Scriptwriter → DialogueCoach
 *       → StoryboardDirector(+intent情绪地图+场景类型摄影语言) → AudioDirector
 *       → DeterministicChecker → ScriptReviewer
 *       → (if verdict非good 且 score<qualityPassScore) [分镜回炉 if visualImpact<6] ScriptEditor → PacingAnalyzer → HookCrafter → EpisodeRecorder
 *
 * 质量优化链：
 * - VisualStyle → Scriptwriter 台词风格（动漫/真人/古装各异）
 * - intent.emotionDirection + scenePurpose → StoryboardDirector（黄金场景密集镜头+专属摄影语言）
 * - 分镜回炉通道：视觉维度低分时跳过ScriptEditor，直接重生成分镜
 * - Shot.qualityTier（golden/standard/filler）驱动媒体生产优先级
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaEntity } from '../entities/drama.entity';
import { EpisodeEntity } from '../entities/episode.entity';
import { VisualAssetEntity } from '../entities/visual-asset.entity';
import { DramaState, CharacterIdentity } from '../schemas/drama-state.schemas';
import {
  ArcDirectorAgent,
  EpisodeDirectorAgent,
  ContinuityGuardAgent,
  ScriptwriterAgent,
  DialogueCoachAgent,
} from '../agents/scripting';
import { StoryboardDirectorAgent, AudioDirectorAgent } from '../agents/production';
import { ScriptReviewerAgent, ScriptEditorAgent, PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent } from '../agents/review';
import { VisualAssetDesignerAgent } from '../agents/preparation/visual-asset-designer.agent';
import { DramaDeterministicCheckerService } from './deterministic-checker.service';
import { DramaProgressService } from '../drama-progress.service';
import { DramaAgentPipelineService } from './drama-agent-pipeline.service';
import { DramaWorkflowExecutionService } from './drama-workflow-execution.service';
import { DramaCalibrationService } from './drama-calibration.service';
import type { DramaAgentNodeConfig, DramaWorkflowParams } from '../interfaces';
import { LlmTraceLoggerService } from '../../llm/llm-trace-logger.service';
import { MediaService } from '../../media/media.service';
import { RenderingProfileService } from '../../media/rendering/rendering-profile.service';
import { PromptOptimizerService } from '../../media/prompt-optimizer.service';
import { ImageProviderRouterService } from '../media-pipeline/image-provider-router.service';
import {
  buildAssetStylePrefix,
  detectStyleBucket,
  upsertReferenceByView,
} from '../utils/asset-prompt.utils';
import { ageToT2IPhrase, assembleT2iPrompt } from '../../media/rendering/rendering-profile';

const STEP_ORDER = [ // 步骤顺序定义（用于断点续跑）
  'arc_planned', 'intent_ready', 'continuity_checked', 'script_drafted',
  'dialogue_polished', 'storyboard_drafted', 'audio_designed',
  'deterministic_checked', 'reviewed', 'edited', 'pacing_analyzed',
  'hook_crafted', 'recorded',
] as const;

type StepName = typeof STEP_ORDER[number];
type NodeEnabledMap = Record<string, boolean>;

@Injectable()
export class EpisodeWorkflowService {
  private readonly logger = new Logger(EpisodeWorkflowService.name);
  private readonly runningEpisodes = new Set<string>(); // 并发互斥锁：dramaId:epNum

  private static readonly CHAR_IMAGE_SIZE = '2:3';

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(VisualAssetEntity) private readonly visualAssetRepo: Repository<VisualAssetEntity>,
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
    private readonly visualAssetDesigner: VisualAssetDesignerAgent,
    private readonly deterministicChecker: DramaDeterministicCheckerService,
    private readonly progressService: DramaProgressService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly calibrationService: DramaCalibrationService,
    private readonly traceLogger: LlmTraceLoggerService,
    private readonly mediaService: MediaService,
    private readonly renderingProfileService: RenderingProfileService,
    private readonly promptOptimizer: PromptOptimizerService,
    private readonly imageRouter: ImageProviderRouterService,
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
    if (!state.userId) state.userId = drama.userId ?? '';
    const wp: DramaWorkflowParams = await this.pipelineService.getWorkflowParams(dramaId);
    const pipelineNodes: DramaAgentNodeConfig[] = await this.pipelineService.getPublishedNodes(dramaId);
    const nodeEnabledMap = this.buildNodeEnabledMap(pipelineNodes);
    let synopsis = state.seriesOutline?.episodes?.[episodeNumber - 1];
    if (!synopsis) throw new Error(`大纲中不存在第 ${episodeNumber} 集`);

    const totalPlanned = state.seriesOutline?.totalPlannedEpisodes ?? 999;
    const isSeriesFinale = episodeNumber >= totalPlanned;
    if (isSeriesFinale) {
      this.logger.log(`[E${episodeNumber}] 检测为全剧大结局集（totalPlanned=${totalPlanned}）`);
      state.isSeriesFinale = true;
    }

    // ── 断点续传：检测可恢复的中断运行 ──
    let runId = ''; // 空字符串表示尚未创建运行，catch 块会检查后再调用 failRun
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
    const skippedStepRecords: Array<{ stepKey: string; nodeId?: string; skipReason?: string; message?: string }> = [];
    const skippedStepKeys = new Set<string>();
    const emitEp = (
      stepIndex: number,
      message: string,
      done = false,
      extra?: { nodeId?: string; skipped?: boolean; skipReason?: string; stepKey?: string; data?: Record<string, unknown> },
    ) => {
      if (extra?.skipped) {
        const stepKey = extra.stepKey ?? STEP_ORDER[stepIndex] ?? `ep_${stepIndex}`;
        const uniq = `${stepKey}:${extra.nodeId ?? ''}:${extra.skipReason ?? ''}`;
        if (!skippedStepKeys.has(uniq)) {
          skippedStepKeys.add(uniq);
          skippedStepRecords.push({ stepKey, nodeId: extra.nodeId, skipReason: extra.skipReason, message });
        }
      }
      this.progressService.emit({
        dramaId,
        runType: 'episode',
        episodeNumber,
        step: `ep_${stepIndex}`,
        stepKey: extra?.stepKey ?? STEP_ORDER[stepIndex],
        nodeId: extra?.nodeId,
        skipped: extra?.skipped,
        skipReason: extra?.skipReason,
        stepIndex,
        totalSteps: 13,
        message,
        done,
        ...(extra?.data ? { data: extra.data } : {}),
      });
    };
    const logDrama = (step: string, status: 'ok' | 'error', message?: string, meta?: Record<string, unknown>) =>
      this.traceLogger.logDramaWorkflowEvent({ dramaId, phase: 'episode', step, status, episodeNumber, message, ...meta });

    const enableContinuityGuard = this.isNodeEnabled(nodeEnabledMap, 'continuity-guard');
    const enableDialogueCoach = wp.enableDialogueCoach && this.isNodeEnabled(nodeEnabledMap, 'dialogue-coach');
    const enableAudioDirector = this.isNodeEnabled(nodeEnabledMap, 'audio-director');
    const enableReviewer = this.isNodeEnabled(nodeEnabledMap, 'script-reviewer');
    const enableScriptEditor = this.isNodeEnabled(nodeEnabledMap, 'script-editor');
    const enablePacingAnalyzer = wp.enablePacingAnalyzer && this.isNodeEnabled(nodeEnabledMap, 'pacing-analyzer');
    const enableHookCrafter = wp.enableHookCrafter && this.isNodeEnabled(nodeEnabledMap, 'hook-crafter');

    logDrama('episode_start', 'ok', `E${episodeNumber} 工作流开始`, { runId, resumeFrom, resumed });
    logDrama('pipeline_resolved', 'ok', 'pipeline 节点启用状态已解析', {
      enableContinuityGuard,
      enableDialogueCoach,
      enableAudioDirector,
      enableReviewer,
      enableScriptEditor,
      enablePacingAnalyzer,
      enableHookCrafter,
      qualityPassScore: wp.qualityPassScore,
      maxEditRounds: wp.maxEditRounds,
    });

    const outputs = (cached ?? {}) as Record<string, Record<string, unknown>>;
    let arcSegment = outputs.arc_planned?.arcSegment as any;
    let intent = outputs.intent_ready?.intent as any;
    let continuity = outputs.continuity_checked?.continuity as any;
    let script = outputs.dialogue_polished?.script as any ?? outputs.script_drafted?.script as any;
    let storyboard = outputs.hook_crafted?.storyboard as any ?? outputs.edited?.storyboard as any ?? outputs.audio_designed?.storyboard as any ?? outputs.storyboard_drafted?.storyboard as any;
    let review = outputs.edited?.review as any ?? outputs.reviewed?.review as any;
    let pacing = outputs.pacing_analyzed?.pacing as any;
    let hookResult = outputs.hook_crafted?.hookResult as any;
    let editRoundsUsed = (outputs.edited?.round as number | undefined) ?? 0;
    let scriptRetried = false;
    let detCheck: import('./deterministic-checker.service').DeterministicCheckResult | undefined =
      outputs.deterministic_checked?.detCheck as any;

    try {
      heartbeatTimer = setInterval(async () => {
        const ok = await this.executionService.touchHeartbeat(runId).catch(() => false);
        if (!ok) { ownershipLost = true; this.logger.warn(`[E${episodeNumber}] 心跳续命失败，标记所有权丢失`); }
      }, 20_000);

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
            // 分批展开，每批最多 8 集，避免单次 LLM 输出 token 超限导致后段概要质量下降
            const EXPANSION_BATCH_SIZE = 8;
            for (let batchStart = 0; batchStart < skeletonRange.length; batchStart += EXPANSION_BATCH_SIZE) {
              const batch = skeletonRange.slice(batchStart, batchStart + EXPANSION_BATCH_SIZE);
              emitEp(0, `展开骨架集 E${batch[0]}-E${batch[batch.length - 1]}（共 ${skeletonRange.length} 集）...`);
              const expanded = await this.arcDirector.expandEpisodeSynopses(state, arcSegment, batch);
              expanded.forEach(es => { if (state.seriesOutline?.episodes?.[es.episodeNumber - 1]) state.seriesOutline!.episodes[es.episodeNumber - 1] = es; });
            }
            synopsis = state.seriesOutline!.episodes[episodeNumber - 1];
          }
        }
        await saveStep('arc_planned', { arcSegment }); await checkpoint('arc_planned');
        drama.state = state as any;
        await this.dramaRepo.save(drama);
        logDrama('arc_plan_done', 'ok', '段落规划完成', { segmentId: arcSegment?.segmentId });
        emitEp(0, '段落规划完成', true);
      }

      if (resumeFrom < 1) { // Step 1: 集导演规划 + 新角色设计
        logDrama('intent_start', 'ok', '集导演规划');
        emitEp(1, '集导演规划...');
        intent = await this.episodeDirector.direct(state, synopsis);

        // Visual Asset Librarian: 解析本集角色（池复用 + 新角色LLM设计）
        const { reused, designed, all, poolUsageUpdates } =
          await this.visualAssetDesigner.resolveEpisodeCharacters(state, intent);

        if (all.length > 0) {
          // 将新角色推入 state.characters
          const knownIds = new Set(state.characters.map(c => c.characterId));
          for (const char of all) {
            if (!knownIds.has(char.characterId)) {
              state.characters.push(char);
              knownIds.add(char.characterId);
            }
          }
          // 更新 minorRolePool 的使用记录
          const poolMap = new Map((state.minorRolePool ?? []).map(p => [p.characterId, p]));
          for (const u of poolUsageUpdates) {
            const entry = poolMap.get(u.characterId);
            if (entry) {
              entry.lastUsedEpisode = episodeNumber;
              entry.usedInEpisodes = [...new Set([...entry.usedInEpisodes, episodeNumber])];
            }
          }
          drama.state = state as any;
          await this.dramaRepo.save(drama);

          if (reused.length > 0) {
            emitEp(1, `从角色池复用 ${reused.length} 个角色: ${reused.map(c => c.name).join('、')}`);
            logDrama('pool_char_reused', 'ok', `池复用: ${reused.map(c => `${c.characterId}(${c.name})`).join(', ')}`);
          }
          if (designed.length > 0) {
            logDrama('new_char_design_done', 'ok', `新角色设计: ${designed.map(c => `${c.characterId}(${c.name})`).join(', ')}`);
            emitEp(1, `引入新角色 ${designed.map(c => c.name).join('、')}`);
          }
        }

        // ── Step 1.5: 场景资产就绪 —— 自动设计本集引用的新场景 ──
        const newLocationIds = (intent.locationIds ?? []).filter(
          (lid: string) => !state.locations.some(l => l.locationId === lid),
        );
        if (newLocationIds.length > 0) {
          emitEp(1, `设计新场景: ${newLocationIds.join('、')}...`);
          const locationHints = newLocationIds.map((lid: string) => ({
            locationId: lid,
            name: lid,
            narrativeContext: `E${episodeNumber} 集导演规划中引用了此场景`,
          }));
          try {
            const newLocs = await this.visualAssetDesigner.designNewLocations(state, locationHints);
            for (const loc of newLocs) {
              state.locations.push(loc);
              // Persist 到 VisualAssetEntity
              const existing = await this.visualAssetRepo.findOne({
                where: { dramaId, assetType: 'location', refId: loc.locationId },
              });
              if (!existing) {
                await this.visualAssetRepo.save(this.visualAssetRepo.create({
                  dramaId,
                  assetType: 'location',
                  refId: loc.locationId,
                  name: loc.name,
                  data: loc as unknown as Record<string, unknown>,
                  referenceImageUrl: '',
                  referenceImages: [],
                }));
              }
            }
            logDrama('new_loc_design_done', 'ok', `新场景设计: ${newLocs.map(l => `${l.locationId}(${l.name})`).join(', ')}`);
            emitEp(1, `新场景设计完成: ${newLocs.map(l => l.name).join('、')}`);
          } catch (locErr) {
            this.logger.warn(`[E${episodeNumber}] 新场景设计失败(不影响继续): ${(locErr as Error).message}`);
          }
        }

        // ── Step 1.5b: 角色定妆照 —— 跳过自动生成，由用户在集制作页面手动触发 ──
        // 角色文本元数据（faceReferencePrompt 等）已在 Step A2 / designNewCharacters 中设计完成
        // 参考图生成延迟到用户在 EpisodeProductionBoard 资产 Tab 中手动一键/逐个生成
        const charsNeedingFace = (intent.activeCharacters ?? []).filter((ac: any) => {
          const ch = state.characters.find(c => c.characterId === ac.characterId);
          return ch?.faceReferencePrompt?.trim();
        }).map((ac: any) => ac.characterId as string);
        if (charsNeedingFace.length > 0) {
          this.logger.log(`[E${episodeNumber}] ${charsNeedingFace.length} 个角色需要定妆照，已跳过自动生成（请在集制作页面手动触发）`);
        }

        drama.state = state as any;
        await this.dramaRepo.save(drama);
        await saveStep('intent_ready', { intent }); await checkpoint('intent_ready');
        logDrama('intent_done', 'ok', '集导演完成');
        emitEp(1, '集导演完成', true);
      }

      if (resumeFrom < 2) { // Step 2: 连续性检查（阻断时回退重试）
        logDrama('continuity_start', 'ok', '连续性检查');
        emitEp(2, '连续性检查...');
        let continuitySkipped = false;
        if (enableContinuityGuard) {
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
            const remaining = continuity.warnings.filter((w: any) => w.severity === 'block');
            if (remaining.length > 0) {
              this.logger.warn(`[E${episodeNumber}] 连续性重试(${wp.maxContinuityRetries}次)耗尽后仍有阻断警告，带警告继续执行: ${remaining.map((b: any) => b.description).join('; ')}`);
              logDrama('continuity_retry_exhausted', 'error', `连续性阻断未解决(${remaining.length}条)，降级继续`, { blocks: remaining.map((b: any) => b.description) });
            }
          }
        } else {
          continuity = { pass: true, warnings: [], contextInjections: [] };
          this.logger.log(`E${episodeNumber} 连续性检查已跳过(pipeline禁用 continuity-guard)`);
          continuitySkipped = true;
        }
        await saveStep('continuity_checked', { continuity }); await checkpoint('continuity_checked');
        logDrama('continuity_done', 'ok', '连续性检查完成');
        emitEp(
          2,
          continuitySkipped ? '连续性检查已跳过（pipeline禁用）' : '连续性检查完成',
          true,
          continuitySkipped ? { nodeId: 'continuity-guard', skipped: true, skipReason: 'pipeline_disabled' } : undefined,
        );
      }

      if (resumeFrom < 3) { // Step 3: 编剧创作
        await assertOwnership();
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
        let dialogueSkipped = false;
        let dialogueDegraded = false;
        if (enableDialogueCoach) {
          try {
            script = await this.dialogueCoach.polish(script, state.characters, state.promptProfile, state.dramaId, state);
          } catch (err) {
            dialogueDegraded = true;
            this.logger.warn(`E${episodeNumber} 台词润色降级: ${(err as Error).message}`);
            logDrama('dialogue_degraded', 'error', `台词润色降级: ${(err as Error).message}`);
          }
        } else {
          dialogueSkipped = true;
          this.logger.log(`E${episodeNumber} 台词润色已跳过(工作流参数或pipeline配置关闭)`);
        }
        await saveStep('dialogue_polished', { script }); await checkpoint('dialogue_polished');
        logDrama('dialogue_done', 'ok', '台词润色完成');
        emitEp(
          4,
          dialogueDegraded ? '台词润色降级，使用原始剧本继续' : dialogueSkipped ? '台词润色已跳过' : '台词润色完成',
          true,
          (dialogueSkipped || dialogueDegraded) ? {
            nodeId: 'dialogue-coach',
            skipped: true,
            skipReason: dialogueDegraded ? 'runtime_error' : wp.enableDialogueCoach ? 'pipeline_disabled' : 'workflow_param_disabled',
          } : undefined,
        );
      }

      if (resumeFrom < 5) { // Step 5: 分镜生成（按场景分步，传入 intent 以注入情绪地图）
        await assertOwnership();
        logDrama('storyboard_start', 'ok', '分镜生成');
        emitEp(5, '分镜生成...');
        storyboard = await this.storyboardDirector.direct(state, script, intent);
        await saveStep('storyboard_drafted', { storyboard }); await checkpoint('storyboard_drafted');
        logDrama('storyboard_done', 'ok', '分镜生成完成', { shotCount: storyboard?.shots?.length });
        emitEp(5, '分镜生成完成', true);
      }

      if (resumeFrom < 6) { // Step 6: 音频设计
        if (!storyboard?.shots?.length) {
          if (!script?.scenes?.length) throw new Error('剧本数据缺失，无法重新生成分镜');
          this.logger.warn(`[E${episodeNumber}] 分镜数据缺失，回退重新生成分镜`);
          emitEp(5, '分镜数据缺失，重新生成分镜...');
          storyboard = await this.storyboardDirector.direct(state, script, intent);
          await saveStep('storyboard_drafted', { storyboard }); await checkpoint('storyboard_drafted');
          emitEp(5, '分镜重新生成完成', true);
        }
        logDrama('audio_start', 'ok', '音频设计');
        emitEp(6, '音频设计...');
        let audioSkipped = false;
        if (enableAudioDirector) storyboard = await this.audioDirector.enhance(state, storyboard, intent);
        else {
          audioSkipped = true;
          this.logger.log(`E${episodeNumber} 音频设计已跳过(pipeline禁用 audio-director)`);
        }
        await saveStep('audio_designed', { storyboard }); await checkpoint('audio_designed');
        logDrama('audio_done', 'ok', '音频设计完成');
        emitEp(
          6,
          audioSkipped ? '音频设计已跳过（pipeline禁用）' : '音频设计完成',
          true,
          audioSkipped ? { nodeId: 'audio-director', skipped: true, skipReason: 'pipeline_disabled' } : undefined,
        );
      }

      if (resumeFrom < 7) { // Step 7: 硬规则校验（含 unknown_character / shot_index_gap 自动修复）
        if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行硬规则校验');
        logDrama('deterministic_start', 'ok', '硬规则校验');
        emitEp(7, '硬规则校验...');
        detCheck = this.deterministicChecker.check(state, script, storyboard);

        if (detCheck.autoFixedRules?.length) {
          this.logger.log(`E${episodeNumber} 自动修复规则: ${detCheck.autoFixedRules.join(', ')}`);
          logDrama('deterministic_auto_fixed', 'ok', `自动修复: ${detCheck.autoFixedRules.join(', ')}`);
        }

        const unknownCharFails = detCheck.hardFails?.filter(f => f.rule === 'unknown_character') ?? [];
        if (unknownCharFails.length > 0) {
          const unknownIds = [...new Set(unknownCharFails.map(f => {
            const m = f.detail.match(/角色\s*(\S+)/);
            return m?.[1] ?? '';
          }).filter(Boolean))];
          this.logger.warn(`E${episodeNumber} 检测到 ${unknownIds.length} 个未定义角色，触发补充设计: ${unknownIds.join(', ')}`);
          emitEp(7, `为 ${unknownIds.length} 个漏网角色补充视觉设计...`);
          logDrama('fallback_char_design_start', 'ok', `补充设计角色: ${unknownIds.join(', ')}`);
          const knownIds = new Set(state.characters.map(c => c.characterId));
          const fallbackProposed = unknownIds.filter(id => !knownIds.has(id)).map(id => ({
            characterId: id,
            name: id.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            role: 'minor' as const,
            narrativePurpose: `剧本/分镜中引用的临时角色`,
            appearanceHint: `符合${state.seed.genre}题材的角色`,
            hasDialogue: storyboard!.shots.some(s => s.dialogue?.characterId === id),
          }));
          if (fallbackProposed.length > 0) {
            const designed = await this.visualAssetDesigner.designNewCharacters(state, fallbackProposed);
            for (const char of designed) {
              if (!knownIds.has(char.characterId)) {
                char.scope = 'episode'; // 兜底补充的临时角色，本集结束后归档
                state.characters.push(char);
                knownIds.add(char.characterId);
              }
            }
            drama.state = state as any;
            await this.dramaRepo.save(drama);
            logDrama('fallback_char_design_done', 'ok', `补充设计完成: ${designed.map(c => `${c.characterId}(${c.name})`).join(', ')}`);
            detCheck = this.deterministicChecker.check(state, script, storyboard);
          }
        }

        // 分镜结构性硬规则（shot_too_long / empty_visual_prompt / missing_first_frame_prompt）：
        // LLM 偶发漏填或写出超出 provider 物理上限的时长时，整体重生成分镜一次，而不是直接阻断
        // too_few_shots 已降为软规则，不再需要 retry
        const STORYBOARD_RETRYABLE = new Set(['shot_too_long', 'empty_visual_prompt', 'missing_first_frame_prompt']);
        const storyboardRetryFails = detCheck.hardFails?.filter(f => STORYBOARD_RETRYABLE.has(f.rule)) ?? [];
        if (storyboardRetryFails.length > 0 && script?.scenes?.length) {
          const retryReasons = storyboardRetryFails.map(f => `${f.rule}(${f.detail})`).join('; ');
          this.logger.warn(`E${episodeNumber} 分镜结构性硬规则触发重生成: ${retryReasons}`);
          logDrama('storyboard_retry_hard_rule', 'ok', `分镜结构性硬规则，重生成分镜`, { reasons: retryReasons });
          emitEp(7, `分镜结构校验失败，重新生成分镜...`);
          storyboard = await this.storyboardDirector.direct(state, script, intent);
          if (enableAudioDirector) {
            try { storyboard = await this.audioDirector.enhance(state, storyboard, intent); }
            catch (audioErr) { this.logger.warn(`E${episodeNumber} 重生成后音频设计降级: ${(audioErr as Error).message}`); }
          }
          await saveStep('storyboard_drafted', { storyboard });
          await saveStep('audio_designed', { storyboard });
          detCheck = this.deterministicChecker.check(state, script, storyboard);
          if (detCheck.autoFixedRules?.length) {
            this.logger.log(`E${episodeNumber} 重生成后自动修复规则: ${detCheck.autoFixedRules.join(', ')}`);
          }
          logDrama('storyboard_retry_hard_rule_done', 'ok', `分镜重生成完成`, { newShotCount: storyboard?.shots?.length });
        }

        const remainingHardFails = detCheck.hardFails?.filter(f => f.rule !== 'unknown_character') ?? [];
        if (remainingHardFails.length) {
          const msg = `E${episodeNumber} 硬规则阻断: ${remainingHardFails.map(f => `${f.rule}(${f.detail})`).join('; ')}`;
          this.logger.error(msg);
          throw new Error(msg);
        }
        const softFails = detCheck.failedChecks.filter(f => f.severity === 'soft');
        if (softFails.length) this.logger.warn(`E${episodeNumber} 软规则警告: ${softFails.map(f => f.rule).join(', ')}`);
        if (detCheck.dialogueFixes?.length) {
          this.logger.warn(`E${episodeNumber} 发现 ${detCheck.dialogueFixes.length} 句超长台词，将在精修阶段定向修复`);
          logDrama('deterministic_dialogue_fixes', 'ok', `${detCheck.dialogueFixes.length} 句台词待精修`, { count: detCheck.dialogueFixes.length });
        }
        await saveStep('deterministic_checked', { detCheck }); await checkpoint('deterministic_checked');
        logDrama('deterministic_done', 'ok', '硬规则校验完成');
        emitEp(7, '硬规则校验完成', true);
      }

      if (resumeFrom < 8) { // Step 8: 质量审核
        await assertOwnership();
        logDrama('review_start', 'ok', '质量审核');
        emitEp(8, '质量审核...');
        let reviewerSkipped = false;
        if (enableReviewer) {
          if (!storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行质量审核');
          review = await this.reviewer.review(state, script, storyboard);
          review = this.normalizeReview(review, wp);
        } else {
          reviewerSkipped = true;
          review = this.makeSkippedReview(wp, 'script-reviewer 已禁用，使用降级评审结果');
          this.logger.log(`E${episodeNumber} 质量审核已跳过(pipeline禁用 script-reviewer)`);
        }
        await saveStep('reviewed', { review }); await checkpoint('reviewed');
        logDrama('review_done', 'ok', '质量审核完成', { verdict: review?.overallVerdict, score: review?.overallScore });
        emitEp(
          8,
          reviewerSkipped ? '质量审核已跳过（pipeline禁用）' : '质量审核完成',
          true,
          reviewerSkipped ? { nodeId: 'script-reviewer', skipped: true, skipReason: 'pipeline_disabled' } : undefined,
        );
      }

      if (resumeFrom < 9) { // Step 9: 精修（定向修复 + 分镜回炉通道 + 节奏分析反馈）
        await assertOwnership();
        logDrama('edit_start', 'ok', '精修');

        // ── 节奏分析前置：在 shouldEdit 判断之前运行，让节奏问题能触发精修 ──
        // 不论质量评分是否达标，只要有明显节奏问题，就应纳入精修目标
        const prePacingIssues: Array<{ category: 'pacing'; severity: 'moderate' | 'minor'; description: string; suggestedFix: string }> = [];
        if (enablePacingAnalyzer && storyboard?.shots?.length) {
          try {
            pacing = await this.pacingAnalyzer.analyze(state, storyboard);
            if (pacing && pacing.score < 7) {
              const issues = (pacing.segments ?? [])
                .filter(seg => seg.verdict !== 'ok')
                .map(seg => ({
                  category: 'pacing' as const,
                  severity: (seg.verdict === 'drag' || seg.verdict === 'rush') ? 'moderate' as const : 'minor' as const,
                  description: `节奏问题(${seg.shotRange}): ${seg.verdict === 'drag' ? '拖沓' : '过快'}`,
                  suggestedFix: seg.suggestion,
                }));
              prePacingIssues.push(...issues);
              if (issues.length) logDrama('pacing_pre_analysis', 'ok', `节奏前置分析: score=${pacing.score.toFixed(1)}, 问题${issues.length}条`, { score: pacing.score });
            }
          } catch (err) {
            this.logger.warn(`E${episodeNumber} 节奏前置分析降级: ${(err as Error).message}`);
          }
        }

        // 将节奏问题注入 review.issuesFound，使 shouldEdit() 能感知节奏问题
        if (prePacingIssues.length && review) {
          review = { ...review, issuesFound: [...(review.issuesFound ?? []), ...prePacingIssues] };
        }

        const shouldEdit = () => this.shouldRunEdit(review, wp);
        let editorSkipped = false;
        let editorSkipReason: string | undefined;
        if (!enableScriptEditor && shouldEdit()) {
          this.logger.warn(`[E${episodeNumber}] 精修需求存在但 script-editor 已禁用，跳过精修。score=${review?.overallScore}, verdict=${review?.overallVerdict}`);
          editorSkipped = true;
          editorSkipReason = 'pipeline_disabled';
        }
        for (let round = 0; enableScriptEditor && round < wp.maxEditRounds && shouldEdit(); round++) {
          emitEp(9, `精修第${round + 1}轮...`);
          const editTargetIssues = review?.issuesFound?.filter((i: any) => i.severity === 'critical' || i.severity === 'moderate') ?? [];

          // 注入台词超长问题：将硬规则校验发现的超长台词作为精修目标（仅第一轮）
          if (round === 0 && detCheck?.dialogueFixes?.length) {
            const dialogueIssues = detCheck.dialogueFixes.map(f => ({
              category: 'dialogue' as const,
              severity: 'moderate' as const,
              description: `台词过长(${f.zhLen}字 > 30字): 场景${f.sceneId} 角色${f.characterId} "${f.text.slice(0, 20)}..."`,
              suggestedFix: `将此台词拆短至30字以内，保留核心信息`,
            }));
            editTargetIssues.push(...dialogueIssues);
            logDrama('dialogue_fix_injected', 'ok', `注入 ${dialogueIssues.length} 条超长台词修复目标`);
          }

          // 节奏问题已在循环外前置分析，此处直接使用 review.issuesFound 中的节奏条目（无需重复分析）

          // 分镜回炉通道：若视觉维度低分（<6），且尚未触发过回炉，重新生成分镜
          const dims = (review?.dimensions ?? {}) as Record<string, number>;
          const visualIssueScore = Math.min(dims.visualImpact ?? 10, dims.pacing ?? 10);
          const storyboardRebakeTriggered = (round === 0) && (visualIssueScore < 6) && !!intent;
          if (storyboardRebakeTriggered) {
            this.logger.warn(`[E${episodeNumber}] 分镜回炉触发：visualImpact=${dims.visualImpact} pacing=${dims.pacing}，重新生成分镜`);
            emitEp(9, `视觉质量低（${visualIssueScore.toFixed(1)}分），重新生成分镜...`);
            storyboard = await this.storyboardDirector.direct(state, script, intent);
            // 回炉后重新校验硬规则（新分镜可能引入新的未知角色或 shotIndex 错误）
            detCheck = this.deterministicChecker.check(state, script, storyboard);
            if (detCheck.hardFails?.some(f => f.rule !== 'unknown_character')) {
              this.logger.warn(`[E${episodeNumber}] 分镜回炉后硬规则校验发现问题: ${detCheck.hardFails.map(f => f.rule).join(', ')}，继续执行`);
            }
            if (enableAudioDirector) {
              try { storyboard = await this.audioDirector.enhance(state, storyboard, intent); } catch (audioErr) {
                this.logger.warn(`[E${episodeNumber}] 分镜回炉后音频设计降级: ${(audioErr as Error).message}`);
              }
            }
            // 回炉后重置 pacing 以便 Step 10 对新分镜重新分析
            pacing = null;
            if (enableReviewer) {
              review = await this.reviewer.review(state, script, storyboard);
              review = this.normalizeReview(review, wp);
            } else {
              review = this.makeSkippedReview(wp, 'script-reviewer 已禁用，精修后跳过复审', review);
            }
            logDrama('storyboard_rebake', 'ok', '分镜回炉完成', { newScore: review?.overallScore });
          } else {
            const editResult = await this.editor.fixWithScript(state, storyboard, review, editTargetIssues, script);
            storyboard = editResult.storyboard;
            if (editResult.script) script = editResult.script;
            if (enableReviewer) {
              review = await this.reviewer.review(state, script, storyboard);
              review = this.normalizeReview(review, wp);
            } else {
              review = this.makeSkippedReview(wp, 'script-reviewer 已禁用，精修后跳过复审', review);
            }
          }
          editRoundsUsed = round + 1;
        }

        // 质量门禁：精修结束后分数仍极低，从剧本阶段重写一次
        const REJECT_THRESHOLD = 5.5;
        const finalScore = this.normalizeScore(review?.overallScore, 0);
        if (enableScriptEditor && enableReviewer && finalScore < REJECT_THRESHOLD && !scriptRetried) {
          scriptRetried = true;
          this.logger.warn(`[E${episodeNumber}] 质量门禁触发(${finalScore}<${REJECT_THRESHOLD})，从剧本阶段重写`);
          logDrama('quality_reject', 'ok', `质量分${finalScore}过低，触发剧本重写`, { score: finalScore, threshold: REJECT_THRESHOLD });
          emitEp(9, `质量分${finalScore}过低，从剧本阶段重写...`);
          try {
            script = await this.scriptwriter.write(state, intent, continuity ?? { contextInjections: [], warnings: [] } as any);
            if (enableDialogueCoach) {
              try { script = await this.dialogueCoach.polish(script, state.characters, state.promptProfile, state.dramaId, state); } catch (dErr) {
                this.logger.warn(`[E${episodeNumber}] 重写后台词润色降级: ${(dErr as Error).message}`);
              }
            }
            storyboard = await this.storyboardDirector.direct(state, script, intent);
            if (enableAudioDirector) {
              try { storyboard = await this.audioDirector.enhance(state, storyboard, intent); } catch (audioErr) {
                this.logger.warn(`[E${episodeNumber}] 重写后音频设计降级: ${(audioErr as Error).message}`);
              }
            }
            review = await this.reviewer.review(state, script, storyboard);
            review = this.normalizeReview(review, wp);
            logDrama('quality_rewrite_done', 'ok', '剧本重写完成', { newScore: review?.overallScore });
            emitEp(9, `剧本重写完成，新评分: ${review?.overallScore}`, false);
            for (let rr = 0; rr < wp.maxEditRounds && this.shouldRunEdit(review, wp); rr++) {
              const rrResult = await this.editor.fixWithScript(state, storyboard, review,
                review?.issuesFound?.filter((i: any) => i.severity === 'critical' || i.severity === 'moderate') ?? [], script);
              storyboard = rrResult.storyboard;
              if (rrResult.script) script = rrResult.script;
              review = await this.reviewer.review(state, script, storyboard);
              review = this.normalizeReview(review, wp);
              editRoundsUsed++;
            }
          } catch (rewriteErr) {
            this.logger.warn(`[E${episodeNumber}] 剧本重写失败，保留原有结果: ${(rewriteErr as Error).message}`);
          }
        }
        // Fix 2 (P0): 精修后重跑确定性校验 — 检测精修引入的新硬规则违规
        if (editRoundsUsed > 0 && storyboard && script) {
          const postEditCheck = this.deterministicChecker.check(state, script, storyboard);
          if (postEditCheck.hardFails?.length) {
            this.logger.warn(`[E${episodeNumber}] 精修后硬规则校验: ${postEditCheck.hardFails.map(f => `${f.rule}(${f.detail})`).join('; ')}`);
            logDrama('post_edit_hard_check', 'error', `精修后${postEditCheck.hardFails.length}条硬错误`, { fails: postEditCheck.hardFails.map(f => f.rule) });
          }
          if (postEditCheck.autoFixedRules?.length) {
            this.logger.log(`[E${episodeNumber}] 精修后自动修复: ${postEditCheck.autoFixedRules.join(', ')}`);
          }
          // 台词一致性检查记录（不阻断）
          const dialogueMismatch = postEditCheck.failedChecks?.find(f => f.rule === 'dialogue_storyboard_mismatch');
          if (dialogueMismatch) {
            this.logger.warn(`[E${episodeNumber}] ${dialogueMismatch.detail}`);
          }
        }
        await saveStep('edited', { storyboard, review, round: editRoundsUsed }); await checkpoint('edited');
        logDrama('edit_done', 'ok', '精修完成');
        emitEp(
          9,
          editorSkipped ? '精修已跳过（pipeline禁用）' : '精修完成',
          true,
          editorSkipped ? { nodeId: 'script-editor', skipped: true, skipReason: editorSkipReason } : undefined,
        );
      }

      if (resumeFrom < 10) { // Step 10: 节奏分析（最终记录）
        logDrama('pacing_start', 'ok', '节奏分析');
        emitEp(10, '节奏分析...');
        let pacingSkipped = false;
        if (enablePacingAnalyzer) {
          // Fix 4 (P1): 始终对最终 storyboard 重新分析节奏（精修/回炉后 pacing 可能已过时）
          if (storyboard?.shots?.length) {
            try { pacing = await this.pacingAnalyzer.analyze(state, storyboard); }
            catch (err) { this.logger.warn(`E${episodeNumber} 节奏分析降级: ${(err as Error).message}`); }
          }
        } else {
          pacingSkipped = true;
          this.logger.log(`E${episodeNumber} 节奏分析已跳过(工作流参数或pipeline配置关闭)`);
        }
        await saveStep('pacing_analyzed', { pacing }); await checkpoint('pacing_analyzed');
        logDrama('pacing_done', 'ok', '节奏分析完成');
        emitEp(
          10,
          pacingSkipped ? '节奏分析已跳过' : '节奏分析完成',
          true,
          pacingSkipped ? {
            nodeId: 'pacing-analyzer',
            skipped: true,
            skipReason: wp.enablePacingAnalyzer ? 'pipeline_disabled' : 'workflow_param_disabled',
          } : undefined,
        );
      }

      if (resumeFrom < 11) { // Step 11: 悬念设计（可配置开关）
        await assertOwnership();
        if (enableHookCrafter && !storyboard?.shots?.length) throw new Error('分镜数据缺失，无法进行悬念设计');
        logDrama('hook_start', 'ok', '悬念设计');
        emitEp(11, '悬念设计...');
        hookResult = { previewShots: [] };
        let hookSkipped = false;
        if (enableHookCrafter) {
          try {
            hookResult = await this.hookCrafter.craft(state, storyboard);
            if (hookResult.previewShots?.length) {
              const previewFails = this.deterministicChecker.checkShots(hookResult.previewShots, state);
              const hardFails = previewFails.filter(f => f.severity === 'hard');
              if (hardFails.length) {
                this.logger.warn(`E${episodeNumber} previewShots 校验失败(${hardFails.length}条硬错误), 丢弃预告Shot`);
                logDrama('hook_preview_invalid', 'error', hardFails.map(f => f.detail).join('; '));
                hookResult.previewShots = [];
              } else {
                const sbShots = storyboard?.shots ?? [];
                const existingIds = new Set(sbShots.map((s: any) => s.shotId));
                const baseIdx = sbShots.length;
                hookResult.previewShots.forEach((ps: any, i: number) => {
                  ps.shotIndex = baseIdx + i;
                  ps.sceneId = ps.sceneId || `ep${episodeNumber}_preview`;
                  ps.isPreview = true;
                  ps.qualityTier = 'golden';
                  if (!ps.shotId || existingIds.has(ps.shotId)) {
                    ps.shotId = `ep${episodeNumber}_preview_${i + 1}`;
                  }
                  existingIds.add(ps.shotId);
                });
                // Fix 7 (P1): previewShots 角色锁脸处理
                try { this.storyboardDirector.enforceFaceLock(hookResult.previewShots, state); } catch (flErr) {
                  this.logger.warn(`E${episodeNumber} previewShots 锁脸降级: ${(flErr as Error).message}`);
                }
                sbShots.push(...hookResult.previewShots);
                storyboard!.shots = sbShots;
                storyboard!.totalEstimatedDurationSec = Math.round(sbShots.reduce((s: number, sh: any) => s + (sh.estimatedDurationSec ?? 0), 0) * 10) / 10;
              }
            }
          } catch (err) { this.logger.warn(`E${episodeNumber} 悬念设计降级: ${(err as Error).message}`); }
        } else {
          hookSkipped = true;
          this.logger.log(`E${episodeNumber} 悬念设计已跳过(工作流参数或pipeline配置关闭)`);
        }
        await saveStep('hook_crafted', { hookResult, storyboard }); await checkpoint('hook_crafted');
        logDrama('hook_done', 'ok', '悬念设计完成');
        emitEp(
          11,
          hookSkipped ? '悬念设计已跳过' : '悬念设计完成',
          true,
          hookSkipped ? {
            nodeId: 'hook-crafter',
            skipped: true,
            skipReason: wp.enableHookCrafter ? 'pipeline_disabled' : 'workflow_param_disabled',
          } : undefined,
        );
      }

      if (!review) {
        review = this.makeSkippedReview(wp, 'review 数据缺失，使用降级评审结果');
        this.logger.warn(`[E${episodeNumber}] review 缺失，已降级填充默认评审结果`);
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

        this.updateDramaState(state, episodeNumber, hookResult ?? {}, loreRecord, review, storyboard?.shots);

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
          duration: storyboard?.totalEstimatedDurationSec ?? 0, totalDurationMs: 0, editRounds: editRoundsUsed,
          skippedSteps: skippedStepRecords,
        });
        logDrama('episode_done', 'ok', `E${episodeNumber} 生成完成`, { score: review.overallScore, shotCount: sbShots.length, durationSec: storyboard?.totalEstimatedDurationSec });
        emitEp(12, `E${episodeNumber} 生成完成`, true);
        this.logger.log(`E${episodeNumber} 完成 — 评分:${review.overallScore} Shot:${sbShots.length} 时长:${storyboard?.totalEstimatedDurationSec}s 精修轮数:${editRoundsUsed}`);
      }
    } catch (err) {
      logDrama('episode_failed', 'error', (err as Error).message, { error: (err as Error).message });
      if (runId) {
        try {
          const failed = await this.executionService.failRun(runId, (err as Error).message?.slice(0, 500) ?? String(err));
          if (!failed) this.logger.warn(`[E${episodeNumber}] failRun被拒绝 runId=${runId}`);
        } catch (failErr) {
          this.logger.error(`[E${episodeNumber}] failRun本身异常: ${(failErr as Error).message}`);
        }
      } else {
        this.logger.error(`[E${episodeNumber}] runId 未初始化，跳过 failRun（原始错误已向上抛出）`);
      }
      throw err;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  /** 根据checkpoint名称计算恢复步骤索引
   *  返回值 = 最后已完成步骤的索引（-1=未开始）
   *  步骤 N 的条件写作 `if (resumeFrom < N)`，因此：
   *    resumeFrom=-1 → 所有步骤都运行（全新流程）
   *    resumeFrom=0  → 跳过步骤0（arc_planned），从步骤1开始
   *    resumeFrom=1  → 跳过步骤0-1，从步骤2开始，以此类推
   */
  private getResumeStep(checkpoint: string): number {
    const idx = STEP_ORDER.indexOf(checkpoint as StepName);
    return idx; // idx 就是最后完成的步骤号，-1 表示未找到/未开始
  }

  private buildNodeEnabledMap(nodes: DramaAgentNodeConfig[]): NodeEnabledMap {
    return nodes.reduce<NodeEnabledMap>((acc, node) => {
      acc[node.id] = node.isEnabled !== false;
      return acc;
    }, {});
  }

  private isNodeEnabled(map: NodeEnabledMap, nodeId: string, defaultValue = true): boolean {
    if (!(nodeId in map)) {
      this.logger.debug(`Pipeline节点 "${nodeId}" 未配置，使用默认值: ${defaultValue}`);
    }
    return map[nodeId] ?? defaultValue;
  }

  private normalizeScore(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return Math.min(10, Math.max(0, fallback));
    return Math.min(10, Math.max(0, Math.round(n * 10) / 10));
  }

  private normalizeReview(review: any, wp: DramaWorkflowParams): any {
    const baseScore = this.normalizeScore(review?.overallScore, wp.qualityPassScore);
    const verdict = (review?.overallVerdict === 'good' || review?.overallVerdict === 'needs_edit' || review?.overallVerdict === 'major_issues')
      ? review.overallVerdict
      : (baseScore >= wp.qualityPassScore ? 'good' : 'needs_edit');
    const dims = review?.dimensions ?? {};

    return {
      ...review,
      overallVerdict: verdict,
      overallScore: baseScore,
      dimensions: {
        visualImpact: this.normalizeScore(dims.visualImpact, baseScore),
        dialogueNaturalness: this.normalizeScore(dims.dialogueNaturalness, baseScore),
        pacing: this.normalizeScore(dims.pacing, baseScore),
        hookStrength: this.normalizeScore(dims.hookStrength, baseScore),
        consistency: this.normalizeScore(dims.consistency, baseScore),
        emotionalImpact: this.normalizeScore(dims.emotionalImpact, baseScore),
      },
      issuesFound: Array.isArray(review?.issuesFound) ? review.issuesFound : [],
      strengths: Array.isArray(review?.strengths) ? review.strengths : [],
    };
  }

  private makeSkippedReview(wp: DramaWorkflowParams, reason: string, baseReview?: any): any {
    const normalized = this.normalizeReview(baseReview ?? {}, wp);
    const strengths = new Set<string>(normalized.strengths ?? []);
    strengths.add(reason);
    return {
      ...normalized,
      overallVerdict: normalized.overallScore >= wp.qualityPassScore ? 'good' : 'needs_edit',
      strengths: Array.from(strengths),
      skipped: true,
      skipReason: reason,
    };
  }

  private inferDopamineIntensity(
    hookResult: { hookType?: string },
    loreRecord: { resolvedSecretIds?: string[]; newSecrets?: Array<unknown>; plotAdvances?: string[] },
    qualityScore: number,
  ): 'climactic' | 'major' | 'medium' | 'minor' {
    let eventScore = 0;
    const hookType = hookResult.hookType ?? '';
    const climacticHooks = new Set(['revelation', 'betrayal', 'death', 'finale_closure', 'twist']);
    const majorHooks = new Set(['cliffhanger', 'confrontation', 'reunion', 'sacrifice']);
    if (climacticHooks.has(hookType)) eventScore += 4;
    else if (majorHooks.has(hookType)) eventScore += 2;
    else eventScore += 1;

    const resolvedCount = loreRecord.resolvedSecretIds?.length ?? 0;
    const newSecretCount = loreRecord.newSecrets?.length ?? 0;
    const plotAdvances = loreRecord.plotAdvances?.length ?? 0;
    eventScore += Math.min(resolvedCount * 2, 4);
    eventScore += Math.min(newSecretCount, 2);
    eventScore += Math.min(plotAdvances, 2);

    // Quality score as secondary signal (30% weight)
    const qualityBoost = qualityScore >= 8 ? 2 : qualityScore >= 6.5 ? 1 : 0;
    const total = eventScore + qualityBoost;

    if (total >= 8) return 'climactic';
    if (total >= 5) return 'major';
    if (total >= 3) return 'medium';
    return 'minor';
  }

  private shouldRunEdit(review: any, wp: DramaWorkflowParams): boolean {
    if (!review) return false;
    const verdict = review.overallVerdict;
    if (verdict === 'major_issues') return true;
    if (verdict !== 'needs_edit') return false;
    const score = this.normalizeScore(review.overallScore, 0);
    return score < wp.qualityPassScore;
  }

  private updateDramaState(
    state: DramaState, epNum: number,
    hookResult: { cliffhangerSummary?: string; hookType?: string },
    loreRecord: { summary?: string; resolvedSecretIds?: string[]; characterStateDeltas?: Array<{ characterId?: string; emotionalShift?: string; relationshipChanges?: string[]; newKnowledge?: string[] }>; flashbackCandidates?: Array<{ shotId?: string; reason?: string; emotionalWeight?: 'low' | 'medium' | 'high' | 'iconic' }>; newSecrets?: Array<{ secret?: string; knownBy?: string[]; hiddenFrom?: string[] }>; plotAdvances?: string[] },
    review: { overallScore?: number; dimensions?: Record<string, number> },
    shots?: Array<{ shotId?: string; visualPrompt?: string }>,
  ): void {
    state.episodeCursor = epNum + 1;
    state.lastCliffhanger = hookResult.cliffhangerSummary ?? '';
    state.recentHookTypes.push({ episodeNumber: epNum, hookType: hookResult.hookType ?? 'cliffhanger' });
    if (state.recentHookTypes.length > 10) state.recentHookTypes = state.recentHookTypes.slice(-10);
    state.episodeSummaries.push({ episodeNumber: epNum, summary: loreRecord.summary ?? '' });

    // 标记已解析的秘密（Fix 6 P1: 增加确定性辅助校验）
    const resolvedIds = new Set(loreRecord.resolvedSecretIds ?? []);
    // 收集本集出场角色ID
    const episodeCharIds = new Set((shots ?? []).flatMap((sh: any) => (sh.characters ?? []).map((c: any) => c.characterId).filter(Boolean)));
    if (resolvedIds.size > 0) {
      for (const entry of state.secretLedger) {
        if (resolvedIds.has(entry.id) && !entry.resolved) {
          // 确定性校验：秘密的 knownBy/hiddenFrom 中是否有角色出场于本集
          const relatedChars = [...(entry.knownBy ?? []), ...(entry.hiddenFrom ?? [])];
          const hasRelatedCharInEp = relatedChars.length === 0 || relatedChars.some(cid => episodeCharIds.has(cid));
          if (!hasRelatedCharInEp) {
            this.logger.warn(`[E${epNum}] 秘密解析被拒绝: ${entry.id} "${entry.secret}" — 相关角色(${relatedChars.join(',')})本集均未出场，可能是LLM幻觉`);
            continue;
          }
          entry.resolved = true;
          this.logger.log(`[E${epNum}] 秘密已解析: ${entry.id} "${entry.secret}"`);
        }
      }
    }

    (loreRecord.newSecrets ?? []).forEach((ns, i) => {
      if (!ns.secret) return;
      state.secretLedger.push({ id: `secret_ep${epNum}_${i}`, secret: ns.secret, knownBy: ns.knownBy ?? [], hiddenFrom: ns.hiddenFrom ?? [], seededAtEpisode: epNum, resolved: false });
    });

    const score = review.overallScore ?? 0;
    state.kpiHistory.push({ episodeNumber: epNum, overallScore: score, dimensions: review.dimensions ?? {}, generatedAt: new Date().toISOString() });
    const shotPromptMap = new Map((shots ?? []).map(s => [s.shotId ?? '', s.visualPrompt ?? '']));
    (loreRecord.flashbackCandidates ?? []).forEach(fc => {
      const snapshot = shotPromptMap.get(fc.shotId ?? '') || '';
      state.flashbackBank.push({ shotId: fc.shotId ?? '', reason: fc.reason ?? '', emotionalWeight: fc.emotionalWeight ?? 'low', episodeNumber: epNum, visualPromptSnapshot: snapshot });
    });
    const intensity = this.inferDopamineIntensity(hookResult, loreRecord, score);
    state.dopamineSchedule.history.push({ type: hookResult.hookType ?? 'cliffhanger', intensity, deliveredAtEpisode: epNum, description: hookResult.cliffhangerSummary ?? '' });
    state.dopamineSchedule.episodesSinceMinor = intensity === 'minor' ? 0 : state.dopamineSchedule.episodesSinceMinor + 1;
    state.dopamineSchedule.episodesSinceMajor = (intensity === 'major' || intensity === 'climactic') ? 0 : state.dopamineSchedule.episodesSinceMajor + 1;

    // 角色状态变化追加到当集摘要（让 storySoFar 包含角色情感/关系变化）
    const deltas = loreRecord.characterStateDeltas ?? [];
    const deltaNote = deltas.length > 0
      ? ' | 角色变化: ' + deltas.map(d => {
          const parts = [d.characterId, d.emotionalShift].filter(Boolean);
          if (d.relationshipChanges?.length) parts.push(`关系:${d.relationshipChanges.slice(0, 2).join(';')}`);
          return parts.join(' ');
        }).join(', ')
      : '';
    const currentSummary = state.episodeSummaries.find(s => s.episodeNumber === epNum);
    if (currentSummary && deltaNote) {
      currentSummary.summary = currentSummary.summary + deltaNote;
    }

    // Fix 9 (P2): 三层分层摘要 — 控制 storySoFar token 长度，同时保留关键上下文
    //   - 最近 5 集：完整摘要
    //   - 6-15 集前：每集截取前 80 字
    //   - 16-30 集前：按 arcSegment 分组，每段落一句概括
    const recentN = state.episodeSummaries.slice(-30);
    if (recentN.length <= 5) {
      state.storySoFar = recentN.map(s => `E${s.episodeNumber}:${s.summary}`).join('\n');
    } else if (recentN.length <= 15) {
      const recent5 = recentN.slice(-5);
      const older = recentN.slice(0, -5);
      state.storySoFar = [
        ...older.map(s => `E${s.episodeNumber}:${s.summary.slice(0, 80)}`),
        ...recent5.map(s => `E${s.episodeNumber}:${s.summary}`),
      ].join('\n');
    } else {
      const recent5 = recentN.slice(-5);
      const mid = recentN.slice(-15, -5);
      const oldest = recentN.slice(0, -15);
      // 最旧层：按段落分组概括（取每组首尾集摘要的前50字）
      const oldLines: string[] = [];
      const arcMap = new Map<string, typeof oldest>();
      oldest.forEach(s => {
        const outline = state.seriesOutline?.episodes?.find(e => e.episodeNumber === s.episodeNumber);
        const segId = outline?.arcSegmentId || 'other';
        const arr = arcMap.get(segId) ?? [];
        arr.push(s);
        arcMap.set(segId, arr);
      });
      arcMap.forEach((eps, segId) => {
        if (eps.length <= 2) {
          oldLines.push(...eps.map(s => `E${s.episodeNumber}:${s.summary.slice(0, 50)}…`));
        } else {
          oldLines.push(`E${eps[0].episodeNumber}-${eps[eps.length - 1].episodeNumber}[${segId}]:${eps[0].summary.slice(0, 40)}…→${eps[eps.length - 1].summary.slice(0, 40)}…`);
        }
      });
      state.storySoFar = [
        ...oldLines,
        ...mid.map(s => `E${s.episodeNumber}:${s.summary.slice(0, 80)}`),
        ...recent5.map(s => `E${s.episodeNumber}:${s.summary}`),
      ].join('\n');
    }

    // 归档 episode 级临时角色（防止角色列表无限膨胀）
    const episodeChars = state.characters.filter(c => c.scope === 'episode');
    if (episodeChars.length > 0) {
      if (!state.episodeCharacterArchive) state.episodeCharacterArchive = {};
      state.episodeCharacterArchive[String(epNum)] = episodeChars;
      state.characters = state.characters.filter(c => c.scope !== 'episode');
      this.logger.log(`[E${epNum}] 归档 ${episodeChars.length} 个临时角色: ${episodeChars.map(c => `${c.characterId}(${c.name})`).join(', ')}`);

      // 有名有姓的临时角色进入可复用池，供后续集导演选角（纯匿名路人跳过）
      if (!state.minorRolePool) state.minorRolePool = [];
      const ANONYMOUS_NAMES = new Set(['路人', '行人', '群众', '士兵', '甲', '乙', '路人甲', '路人乙', '行人甲', '行人乙']);
      for (const char of episodeChars) {
        if (!char.name || ANONYMOUS_NAMES.has(char.name.trim())) continue;
        const existingIdx = state.minorRolePool.findIndex(p => p.characterId === char.characterId);
        if (existingIdx >= 0) {
          const prev = state.minorRolePool[existingIdx];
          state.minorRolePool[existingIdx] = {
            ...prev,
            identity: char,
            lastUsedEpisode: epNum,
            usedInEpisodes: [...new Set([...prev.usedInEpisodes, epNum])],
          };
        } else {
          state.minorRolePool.push({
            characterId: char.characterId,
            name: char.name,
            identity: char,
            referenceImageUrl: '',
            lastUsedEpisode: epNum,
            usedInEpisodes: [epNum],
          });
        }
      }
      // 池上限 50 条，保留最近使用的
      if (state.minorRolePool.length > 50) {
        state.minorRolePool = [...state.minorRolePool]
          .sort((a, b) => b.lastUsedEpisode - a.lastUsedEpisode)
          .slice(0, 50);
      }
    }

    // DramaState 裁剪（防止无限膨胀）
    if (state.episodeSummaries.length > 60) state.episodeSummaries = state.episodeSummaries.slice(-60);
    if (state.flashbackBank.length > 120) state.flashbackBank = state.flashbackBank.slice(-120);
    if (state.kpiHistory.length > 60) state.kpiHistory = state.kpiHistory.slice(-60);
    if (state.dopamineSchedule.history.length > 60) state.dopamineSchedule.history = state.dopamineSchedule.history.slice(-60);
    // secretLedger 上限：保留所有未解决 + 最近 5 集内解决的，超出后归档已解决的旧秘密
    const SECRET_KEEP_RECENT_EPISODES = 5;
    const SECRET_HARD_CAP = 80;
    if (state.secretLedger.length > SECRET_HARD_CAP) {
      // 未解决的全部保留；已解决的按集号倒序，超出 cap 后移除最旧的
      const unresolved = state.secretLedger.filter(s => !s.resolved);
      const resolved = state.secretLedger
        .filter(s => s.resolved)
        .sort((a, b) => (b.seededAtEpisode ?? 0) - (a.seededAtEpisode ?? 0));
      // 已解决秘密：保留最近 5 集内解决的，其余仅保留到总上限
      const recentResolved = resolved.filter(s => epNum - (s.seededAtEpisode ?? 0) <= SECRET_KEEP_RECENT_EPISODES);
      const olderResolved = resolved.filter(s => epNum - (s.seededAtEpisode ?? 0) > SECRET_KEEP_RECENT_EPISODES);
      const remaining = SECRET_HARD_CAP - unresolved.length - recentResolved.length;
      state.secretLedger = [...unresolved, ...recentResolved, ...olderResolved.slice(0, Math.max(0, remaining))];
      this.logger.log(`[E${epNum}] secretLedger 裁剪: ${unresolved.length} 未解决 + ${recentResolved.length} 近期已解决 + ${Math.max(0, remaining)} 旧已解决 = ${state.secretLedger.length}`);
    }
    // episodeCharacterArchive 保留最近 60 集（极小数据无需激进裁剪）
    if (state.episodeCharacterArchive) {
      const archiveKeys = Object.keys(state.episodeCharacterArchive).sort((a, b) => Number(a) - Number(b));
      if (archiveKeys.length > 60) {
        const toDelete = archiveKeys.slice(0, archiveKeys.length - 60);
        for (const k of toDelete) delete state.episodeCharacterArchive![k];
      }
    }

    state.updatedAt = new Date().toISOString();
  }

  /**
   * 确保指定角色有 face_front 定妆照。如没有，自动 persist VisualAssetEntity 并生成。
   * 复用 DramaService.generateReferenceImages Phase 1 的 prompt 构建逻辑。
   */
  private async ensureCharacterFaceRefs(
    dramaId: string,
    state: DramaState,
    characterIds: string[],
  ): Promise<{ generated: number; names: string[] }> {
    const profile = this.renderingProfileService.getImageProfile();
    const charStylePrefix = buildAssetStylePrefix(state.visualStyle, 'character');
    const assetStyleBucket = detectStyleBucket(state.visualStyle);
    let generated = 0;
    const names: string[] = [];

    for (const charId of characterIds) {
      const ch = state.characters.find(c => c.characterId === charId);
      if (!ch?.faceReferencePrompt?.trim()) continue;

      // 查找或创建 VisualAssetEntity
      let asset = await this.visualAssetRepo.findOne({
        where: { dramaId, assetType: 'character', refId: charId },
      });
      if (!asset) {
        asset = await this.visualAssetRepo.save(this.visualAssetRepo.create({
          dramaId,
          assetType: 'character',
          refId: charId,
          name: ch.name,
          data: ch as unknown as Record<string, unknown>,
          referenceImageUrl: '',
          referenceImages: [],
        }));
      }

      // 已有 face_front 则跳过
      const hasFace = asset.referenceImages?.find(r => r.viewAngle === 'face_front')?.imageUrl?.trim();
      if (hasFace) continue;

      try {
        this.logger.log(`[AutoFace] 生成定妆照: ${ch.name}(${charId})`);
        const faceRoute = this.imageRouter.routeCharacterFace(EpisodeWorkflowService.CHAR_IMAGE_SIZE);
        const agePhrase = ageToT2IPhrase((ch as any).age) || (ch as any).agePrompt?.trim() || '';
        const faceParts = [
          ch.faceReferencePrompt,
          agePhrase,
          ch.hairStylePrompt || ch.hairStyle,
          ch.defaultCostumePrompt ? `wearing ${ch.defaultCostumePrompt}` : '',
          (ch as any).bodyTypePrompt || (ch as any).bodyType,
          'front-facing, looking at camera, neutral plain background, character reference sheet portrait',
        ].filter(Boolean).join(', ');
        const optimized = this.promptOptimizer.optimizeForT2I(faceParts, profile.negativePrompt.defaultValue, {
          shotType: 'character',
          qualityTier: 'golden',
          provider: faceRoute.provider,
          styleBucket: assetStyleBucket,
        });
        const prompt = assembleT2iPrompt(optimized.prompt, profile, { stylePrefix: charStylePrefix });
        const result = await this.mediaService.generateImage({
          prompt, negativePrompt: optimized.negativePrompt,
          size: EpisodeWorkflowService.CHAR_IMAGE_SIZE, count: 1,
          dramaId, assetType: 'character_image', refId: charId,
          userId: state.userId,
          ...faceRoute,
        });
        if (result.images?.[0]?.url) {
          const updated = upsertReferenceByView(asset, 'face_front', result.images[0].url);
          await this.visualAssetRepo.update(asset.id, {
            referenceImageUrl: updated.referenceImageUrl,
            referenceImages: updated.referenceImages,
          });
          generated++;
          names.push(ch.name);
          this.logger.log(`[AutoFace] 定妆照生成成功: ${ch.name}(${charId})`);
        }
      } catch (err) {
        this.logger.warn(`[AutoFace] 定妆照生成失败(不影响继续): ${ch.name}(${charId}) — ${(err as Error).message}`);
      }
    }

    return { generated, names };
  }

}
