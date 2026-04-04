/**
 * 短剧核心服务 — 从创意到 Shot JSON 的完整生成链路。
 * 创建流程：SeedAnalyzer → SeriesDirector → VisualAssetDesigner → DramaProfiler → DramaStrategy
 * 逐集流程：委托 EpisodeWorkflowService（Phase 3）
 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { z } from 'zod';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { CreateDramaDto } from './dto/create-drama.dto';
import { DramaState, ContentMode, EpisodeStoryboard, Shot, PropAsset, SignatureProp } from './schemas/drama-state.schemas';
import { LlmService } from '../llm/llm.service';
import { LlmTraceLoggerService } from '../llm/llm-trace-logger.service';
import { DramaSeedAnalyzerAgent } from './agents/preparation/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/preparation/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/preparation/visual-asset-designer.agent';
import { DramaProfilerAgent } from './agents/preparation/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/preparation/drama-strategy.agent';
import { EpisodeWorkflowService } from './workflow/episode-workflow.service';
import { MediaOrchestratorService } from './media-pipeline/media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from '../template/genre/drama-genre-template.service';
import { DramaVisualStyleTemplateService } from '../template/visual-style/drama-visual-style-template.service';
import { VideoProviderRouterService } from './media-pipeline/video-provider-router.service';
import { DramaTaskService } from './task/task.service';
import { DramaRunService } from './run/run.service';
import { DramaAgentPipelineService } from './workflow/drama-agent-pipeline.service';

import { DramaPromptBakerService, BakeContext } from './prompting/drama-prompt-baker.service';
import { resolveGenreKey } from './prompting/drama-genre-utils';
import {
  buildArcDirectorSystemPrompt, buildEpisodeDirectorSystemPrompt,
  buildContinuityGuardSystemPrompt, buildScriptwriterSystemPrompt,
  buildDialogueCoachSystemPrompt, buildStoryboardDirectorStaticPrompt,
  buildAudioDirectorStaticPrompt, buildScriptReviewerSystemPrompt,
  buildScriptEditorSystemPrompt, buildPacingAnalyzerSystemPrompt,
  buildHookCrafterStaticPrompt, buildEpisodeRecorderSystemPrompt,
  // 创建阶段 Agent
  buildSeedAnalyzerSystemPrompt, buildSeriesDirectorSystemPrompt,
  buildVisualAssetDesignerSystemPrompt, buildProfilerSystemPrompt, buildStrategySystemPrompt,
} from './prompting/drama-playbook';
import { MediaJobService } from '../media/media-job.service';
import { LocalStorageService } from '../media/local-storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DRAMA_QUEUE } from './task/types';
import { DramaIdeaService } from './drama-idea.service';
import { DramaVisualAssetService } from './drama-visual-asset.service';
import { DramaStateStore } from './drama-state-store.service';

interface CreateDramaOptions { userId?: string; progressDramaId?: string; }
type ProblemFixTarget = 'all' | 'identity' | 'style' | 'camera' | 'motion';
type RefineSyncScope = 'single' | 'group' | 'all';
type RefineStrength = 'light' | 'balanced' | 'strong';

interface ReviewRiskShotSets {
  all: Set<string>;
  consistency: Set<string>;
  camera: Set<string>;
}

const CREATION_CHECKPOINTS = ['seed_analyzed', 'outline_planned', 'visual_designed', 'assets_generated', 'profile_ready', 'creation_done'] as const;

@Injectable()
export class DramaService implements OnModuleInit {
  private readonly logger = new Logger(DramaService.name);

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(VisualAssetEntity) private readonly visualAssetRepo: Repository<VisualAssetEntity>,
    @InjectRepository(DramaWorkflowExecutionEntity) private readonly wfExecRepo: Repository<DramaWorkflowExecutionEntity>,
    private readonly seedAnalyzer: DramaSeedAnalyzerAgent,
    private readonly seriesDirector: SeriesDirectorAgent,
    private readonly visualDesigner: VisualAssetDesignerAgent,
    private readonly profiler: DramaProfilerAgent,
    private readonly strategist: DramaStrategyAgent,
    private readonly episodeWorkflow: EpisodeWorkflowService,
    private readonly mediaOrchestrator: MediaOrchestratorService,
    private readonly progressService: DramaProgressService,
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly visualStyleTemplateService: DramaVisualStyleTemplateService,
    private readonly llm: LlmService,
    private readonly traceLogger: LlmTraceLoggerService,
    private readonly dramaTaskService: DramaTaskService,
    private readonly dramaRunService: DramaRunService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly promptBaker: DramaPromptBakerService,
    private readonly mediaJobService: MediaJobService,
    private readonly localStorage: LocalStorageService,
    private readonly videoRouter: VideoProviderRouterService,
    private readonly ideaService: DramaIdeaService,
    private readonly visualAssetService: DramaVisualAssetService,
    private readonly stateStore: DramaStateStore,
    @InjectQueue(DRAMA_QUEUE.TEXT) private readonly textQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.IMAGE) private readonly imageQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.VIDEO) private readonly videoQueue: Queue,
    @InjectQueue(DRAMA_QUEUE.VOICE) private readonly voiceQueue: Queue,
  ) {}

  async onModuleInit() { // 恢复卡在 creating 状态超过5分钟的创建流程
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stuckExecs = await this.wfExecRepo.find({ where: { status: 'running' as const, episodeNumber: 0, updatedAt: LessThan(cutoff) } });
    for (const exec of stuckExecs) {
      if (exec.stepOutputs?._dto) {
        this.logger.log(`恢复卡住的创建流程 dramaId=${exec.dramaId} checkpoint=${exec.lastCheckpoint}`);
        this.runCreationPipeline(exec.dramaId, exec.stepOutputs._dto as CreateDramaDto).catch(err =>
          this.logger.error(`恢复失败 dramaId=${exec.dramaId}: ${err.message}`),
        );
      } else {
        this.logger.warn(`创建流程超时无法恢复 dramaId=${exec.dramaId}，标记失败`);
        await this.wfExecRepo.update(exec.id, { status: 'failed', errorMessage: '服务重启超时' });
        try {
          const d = await this.dramaRepo.findOne({ where: { id: exec.dramaId } });
          if (d && (d.state as any)?._status === 'creating') {
            d.state = { ...(d.state as Record<string, unknown>), _status: 'failed' };
            await this.dramaRepo.save(d);
          }
        } catch (e) { this.logger.warn(`恢复期间更新状态失败 dramaId=${exec.dramaId}: ${(e as Error).message}`); }
      }
    }
  }

  /** 重试失败的创建流程，从上次 checkpoint 继续（需有 failed 的 execution 且 stepOutputs._dto 或 seed 存在） */
  async retryCreation(dramaId: string): Promise<void> {
    const wfExec = await this.wfExecRepo.findOne({ where: { dramaId, episodeNumber: 0, status: In(['failed', 'interrupted', 'running'] as const) }, order: { createdAt: 'DESC' } });
    let dto: CreateDramaDto;
    if (wfExec?.stepOutputs?._dto) dto = wfExec.stepOutputs._dto as CreateDramaDto;
    else if (wfExec?.stepOutputs?.seed) {
      const seed = wfExec.stepOutputs.seed as { logline?: string; title?: string; genre?: string; targetAudience?: string; coreConflict?: string };
      const mainIdea = (seed.logline?.length ?? 0) >= 10 ? seed.logline! : `${seed.title ?? ''} - ${seed.coreConflict ?? ''}`.slice(0, 200) || '短剧创意';
      dto = { mainIdea: mainIdea.length >= 10 ? mainIdea : mainIdea + '（续写）', genre: seed.genre ?? '霸总', targetAudience: seed.targetAudience ?? '短剧观众' };
    } else throw new Error('无可恢复的创建记录，请重新创建');
    // 重置 _status 为 creating，然后异步启动（与 createDrama 一致，避免 HTTP 超时）
    try {
      const d = await this.dramaRepo.findOne({ where: { id: dramaId } });
      if (d) { d.state = { ...(d.state as Record<string, unknown>), _status: 'creating' }; await this.dramaRepo.save(d); }
    } catch { /* 尽力更新 */ }
    this.runCreationPipeline(dramaId, dto).catch(err =>
      this.logger.error(`重试创建流水线失败 dramaId=${dramaId}: ${err.message}`),
    );
  }

  async createDrama(dto: CreateDramaDto, opts: CreateDramaOptions = {}): Promise<{ dramaId: string }> {
    this.logger.log(`创建短剧 — 题材: ${dto.genre} | 创意: ${dto.mainIdea.slice(0, 50)}...`);
    const entity = this.dramaRepo.create({
      userId: opts.userId ?? 'anonymous',
      title: dto.titleHint || `${dto.genre}短剧`,
      genre: dto.genre,
      state: { _status: 'creating' } as Record<string, unknown>,
      episodesGenerated: 0,
    });
    const saved = await this.dramaRepo.save(entity);
    this.runCreationPipeline(saved.id, dto, opts).catch(err =>
      this.logger.error(`创建流水线失败 dramaId=${saved.id}: ${err.message}`),
    );
    return { dramaId: saved.id };
  }

  async runCreationPipeline(dramaId: string, dto: CreateDramaDto, opts: CreateDramaOptions = {}): Promise<void> {
    const TOTAL_STEPS = 6;
    const emitCreate = (
      stepIndex: number,
      msg: string,
      done = false,
      terminal = false,
      terminalStatus?: 'success' | 'failed' | 'paused',
      error?: string,
    ) => this.progressService.emit({
      dramaId,
      runType: 'create',
      step: `create_${stepIndex}`,
      stepIndex,
      totalSteps: TOTAL_STEPS,
      message: msg,
      done,
      terminal,
      terminalStatus,
      error,
    });
    const logDrama = (step: string, status: 'ok' | 'error', message?: string, meta?: Record<string, unknown>) =>
      this.traceLogger.logDramaWorkflowEvent({ dramaId, phase: 'create', step, status, message, ...meta });

    // 断点续跑: 查找可恢复的 workflow execution（含 failed，支持重试从上次 checkpoint 继续）
    let wfExec = await this.wfExecRepo.findOne({ where: { dramaId, episodeNumber: 0, status: In(['running', 'interrupted', 'failed'] as const) }, order: { createdAt: 'DESC' } });
    let resumeFrom = 0;
    const out: Record<string, any> = {};
    if (wfExec?.lastCheckpoint) {
      resumeFrom = CREATION_CHECKPOINTS.indexOf(wfExec.lastCheckpoint as any) + 1;
      Object.assign(out, wfExec.stepOutputs ?? {});
      this.logger.log(`恢复创建流程 dramaId=${dramaId} from=${wfExec.lastCheckpoint} step=${resumeFrom} (原status=${wfExec.status})`);
      await this.wfExecRepo.update(wfExec.id, { status: 'running', errorMessage: '' });
    } else if (!wfExec) {
      wfExec = await this.wfExecRepo.save(this.wfExecRepo.create({ dramaId, episodeNumber: 0, status: 'running', stepOutputs: { _dto: dto } }));
    }
    const saveCP = async (name: string, data: Record<string, unknown>) => { // 保存 checkpoint
      Object.assign(out, data);
      await this.wfExecRepo.update(wfExec!.id, { lastCheckpoint: name, stepOutputs: { ...out, _dto: dto } });
    };

    const contentMode: ContentMode = 'drama';

    try {
      logDrama('pipeline_start', 'ok', '创建流程开始', { resumeFrom, genre: dto.genre, contentMode, mainIdea: dto.mainIdea?.slice(0, 80) });

      // 提前加载题材模板和生产引导数据（所有步骤共享，支持 resume 场景）
      const genreTemplate = dto.genreTemplateId
        ? await this.genreTemplateService.getById(dto.genreTemplateId).catch(() => null)
        : null;
      // 优先使用模板自带的 genreKey，否则从中文题材名推断（如 '霸总' → 'boss'）
      const effectiveGenreKey = genreTemplate?.genreKey ?? resolveGenreKey(dto.genre);
      const productionGuidance = (genreTemplate?.profileJson as any)?.productionGuidance ?? undefined;

      // Agent system prompts 来自题材模板的 profileJson.agentSystemPrompts
      const getAgentPrompt = (agentType: string): string | undefined =>
        (genreTemplate?.profileJson as any)?.agentSystemPrompts?.[agentType] ?? undefined;

      if (resumeFrom <= 0) {
        const seedHints = genreTemplate?.seedHints ?? this.genreTemplateService.findBestMatch(dto.genre);
        this.logger.log(`[create] 题材模板匹配: ${dto.genreTemplateId ? 'ID指定' : seedHints ? '自动匹配' : '无匹配'}${productionGuidance ? '，生产引导已注入' : ''}`);
        logDrama('seed_analyze_start', 'ok', '种子分析开始');
        emitCreate(0, '种子分析...');
        const { seed } = await this.seedAnalyzer.analyze({
          mainIdea: dto.mainIdea, genre: dto.genre, targetAudience: dto.targetAudience,
          protagonistFocus: dto.protagonistFocus, tonePreference: dto.tonePreference,
          audienceTags: dto.audienceTags, titleHint: dto.titleHint, mainStoryGoal: dto.mainStoryGoal,
          targetEpisodeDurationSec: dto.targetEpisodeDurationSec,
          plannedTotalEpisodes: dto.plannedMinEpisodes || dto.plannedMaxEpisodes
            ? { min: dto.plannedMinEpisodes ?? 60, max: dto.plannedMaxEpisodes ?? 100 } : undefined,
          seedHints: seedHints ?? undefined,
          genreGuidance: productionGuidance,
          dramaId,
          userId: opts.userId,
        }, getAgentPrompt('seed-analyzer') || undefined);
        out.seed = seed;
        out.seedHints = seedHints ?? null;
        logDrama('seed_analyze_done', 'ok', '种子分析完成', { seedTitle: seed?.title });
        emitCreate(0, '种子分析完成', true);
        await saveCP('seed_analyzed', { seed, seedHints: out.seedHints });
      }

      if (resumeFrom <= 1) {
        logDrama('outline_plan_start', 'ok', '总导演规划全剧大纲');
        emitCreate(1, '总导演规划全剧大纲...');
        out.outline = await this.seriesDirector.plan(out.seed, dramaId, opts.userId, productionGuidance, getAgentPrompt('series-director') || undefined);
        logDrama('outline_plan_done', 'ok', '全剧大纲完成', { totalEpisodes: out.outline?.totalPlannedEpisodes });
        emitCreate(1, '全剧大纲完成', true);
        await saveCP('outline_planned', { outline: out.outline });
      }

      if (resumeFrom <= 2) {
        logDrama('visual_design_start', 'ok', '视觉风格设计');
        emitCreate(2, '视觉风格设计...');
        // 若指定了视觉风格模板，读取其 visualGuide 作为种子数据注入 LLM
        let visualStyleTemplateGuide: Record<string, unknown> | undefined;
        let effectiveVisualStyleHint = dto.visualStyleHint || (out.seedHints as any)?.visualStyleHints || undefined;
        let effectiveSuggestedVisualStyle = dto.suggestedVisualStyle;
        if (dto.visualStyleTemplateId) {
          const vsTpl = await this.visualStyleTemplateService.getById(dto.visualStyleTemplateId).catch(() => null);
          if (vsTpl) {
            visualStyleTemplateGuide = vsTpl.visualGuide as Record<string, unknown>;
            if (!effectiveVisualStyleHint && vsTpl.visualGuide?.styleReferencePrompt) {
              effectiveVisualStyleHint = vsTpl.visualGuide.styleReferencePrompt;
            }
            effectiveSuggestedVisualStyle = vsTpl.styleKey;
            if (vsTpl.promptGuidance?.positiveKeywords?.length) {
              const keywords = vsTpl.promptGuidance.positiveKeywords.join(', ');
              effectiveVisualStyleHint = effectiveVisualStyleHint
                ? `${effectiveVisualStyleHint}, ${keywords}`
                : keywords;
            }
            this.logger.log(`[create] 视觉风格模板已注入: ${vsTpl.displayName} (${vsTpl.styleKey})`);
          }
        }
        // 建剧阶段只设计视觉风格，角色/场景全部延迟到逐集生产时设计
        const { visualStyle, signatureProps } = await this.visualDesigner.design(
          out.seed, out.outline, effectiveVisualStyleHint, dramaId, opts.userId, effectiveSuggestedVisualStyle,
          { protagonistFocus: dto.protagonistFocus, platformTarget: dto.platformTarget, audienceTags: dto.audienceTags },
          visualStyleTemplateGuide as any,
          productionGuidance,
          getAgentPrompt('visual-asset-designer') || undefined,
        );
        // ── VisualStyle 合并策略 ──────────────────────────────────────────────────
        const T2I_TEMPLATE_AUTHORITATIVE = ['styleReferencePrompt', 'characterStylePrompt'] as const;
        const mergedVisualStyle = visualStyleTemplateGuide
          ? {
              ...visualStyleTemplateGuide,
              ...Object.fromEntries(Object.entries(visualStyle).filter(([, v]) => v !== undefined && v !== '')),
              ...Object.fromEntries(
                T2I_TEMPLATE_AUTHORITATIVE
                  .filter(f => visualStyleTemplateGuide[f])
                  .map(f => [f, visualStyleTemplateGuide[f]]),
              ),
            }
          : visualStyle;

        this.visualAssetService.sanitizeLiveActionVisualStyle(mergedVisualStyle, effectiveSuggestedVisualStyle, []);
        Object.assign(out, { characters: [], locations: [], visualStyle: mergedVisualStyle, signatureProps });
        logDrama('visual_design_done', 'ok', '视觉风格设计完成');
        emitCreate(2, '视觉风格设计完成', true);
        await saveCP('visual_designed', { characters: [], locations: [], visualStyle: mergedVisualStyle, signatureProps });
      }

      if (resumeFrom <= 3) {
        logDrama('assets_persist_start', 'ok', '保存风格资产');
        emitCreate(3, '保存风格资产...');
        // 建剧阶段不设计角色/场景，只保存 signatureProps 和 style_guide
        const assetEntities = await this.persistVisualAssets(dramaId, [], [], out.visualStyle, out.signatureProps);
        out.visualAssets = assetEntities;
        logDrama('assets_persist_done', 'ok', '风格资产已保存');
        emitCreate(3, '风格资产已保存', true);
        await saveCP('assets_generated', { visualAssets: assetEntities });
      }

      if (resumeFrom <= 4) {
        logDrama('profile_strategy_start', 'ok', '编剧手册+策略生成');
        emitCreate(4, '编剧手册 + 策略...');
        const [promptProfile, strategy] = await Promise.all([
          this.profiler.generate(
            out.seed, out.visualStyle, out.outline, dramaId, opts.userId,
            genreTemplate?.profileJson ?? undefined,
            getAgentPrompt('drama-profiler') || undefined,
            effectiveGenreKey,
          ),
          this.strategist.generate(out.seed, out.outline, dramaId, opts.userId, productionGuidance, getAgentPrompt('drama-strategy') || undefined),
        ]);
        Object.assign(out, { promptProfile, strategy });
        logDrama('profile_strategy_done', 'ok', '编剧手册完成');
        emitCreate(4, '编剧手册完成', true);
        await saveCP('profile_ready', { promptProfile, strategy });

        logDrama('base_prompt_bake_start', 'ok', '烘焙 Agent 提示词快照');
        try {
          let bakeVisualStyleExtras: BakeContext['visualStyleExtras'];
          if (dto.visualStyleTemplateId) {
            const vsTpl = await this.visualStyleTemplateService.getById(dto.visualStyleTemplateId).catch(() => null);
            if (vsTpl?.visualGuide) {
              bakeVisualStyleExtras = {
                shotStyleGuide: vsTpl.visualGuide.shotStyleGuide as string | undefined,
                scriptDialogueGuide: vsTpl.visualGuide.scriptDialogueGuide as string | undefined,
                facePromptRule: vsTpl.visualGuide.facePromptRule as string | undefined,
                scenePromptGuidance: vsTpl.visualGuide.scenePromptGuidance as string | undefined,
              };
            }
          }
          await this.promptBaker.bakeAndPublish({
            dramaId,
            profile: promptProfile,
            strategy: out.strategy,
            visualStyle: out.visualStyle,
            redLines: out.seed?.redLines,
            visualStyleExtras: bakeVisualStyleExtras,
            videoModelProfile: this.videoRouter.getModelProfile(
              this.videoRouter.resolvePrimaryProvider({
                genre: out.seed?.genre,
                styleBucket: out.visualStyle?.styleBucket,
                userChoice: dto.videoProvider,
              }),
            ),
          });
          logDrama('base_prompt_bake_done', 'ok', '所有 Agent 提示词快照烘焙完成');
        } catch (bakeErr: any) {
          logDrama('base_prompt_bake_failed', 'error', `提示词烘焙失败（不影响建剧）: ${bakeErr.message}`);
          this.logger.warn(`[Drama] promptBaker.bakeAndPublish 失败 dramaId=${dramaId}: ${bakeErr.message}`);
        }
      }

      const resolvedVideoProvider = this.videoRouter.resolvePrimaryProvider({
        genre: out.seed?.genre,
        styleBucket: out.visualStyle?.styleBucket,
        userChoice: dto.videoProvider,
      });
      logDrama('state_assembly_start', 'ok', '最终状态组装');
      const now = new Date().toISOString(); // Step 5: 最终状态组装
      const state: Partial<DramaState> = {
        dramaId, createdAt: now, updatedAt: now, version: 1, contentMode, seed: out.seed,
        audienceDirective: {
          audienceTags: dto.audienceTags ?? [], protagonistFocus: dto.protagonistFocus ?? 'female_lead',
          tonePreference: dto.tonePreference ?? '', platformTarget: dto.platformTarget ?? 'generic',
          aspectRatio: dto.aspectRatio ?? '9:16', hardConstraints: [], softPreferences: [],
        },
        visualStyleHint: dto.visualStyleHint ?? '',
        suggestedVisualStyle: dto.suggestedVisualStyle ?? '',
        generationMode: dto.generationMode ?? 'balanced',
        imageResolution: dto.imageResolution ?? '2k',
        videoResolution: dto.videoResolution ?? '1080p',
        videoProvider: resolvedVideoProvider as DramaState['videoProvider'],
        ...(dto.visualStyleTemplateId ? { visualStyleTemplateId: dto.visualStyleTemplateId } : {}),
        promptProfile: out.promptProfile, strategy: out.strategy, visualStyle: out.visualStyle,
        visualBible: this.visualAssetService.buildVisualBible(
          out.characters,
          out.visualStyle,
          out.promptProfile,
          (out.visualAssets as Array<Partial<VisualAssetEntity>> | undefined) ?? [],
        ),
        characters: out.characters, locations: out.locations, signatureProps: out.signatureProps ?? [],
        seriesOutline: out.outline,
        arcSegments: [], episodeCursor: 1, episodeSummaries: [], lastCliffhanger: '',
        recentHookTypes: [], secretLedger: [], flashbackBank: [], kpiHistory: [],
        dopamineSchedule: { history: [], episodesSinceMinor: 0, episodesSinceMajor: 0 },
      };
      const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
      drama.title = out.seed.title;
      drama.genre = out.seed.genre;
      drama.state = state as Record<string, unknown>;
      await this.dramaRepo.save(drama);
      await this.wfExecRepo.update(wfExec!.id, { status: 'completed', lastCheckpoint: 'creation_done' });
      logDrama('creation_done', 'ok', '短剧创建完成', { title: out.seed?.title, totalEpisodes: out.outline?.totalPlannedEpisodes });
      emitCreate(5, '短剧创建完成', true, true, 'success');
      this.logger.log(`短剧创建完成 — dramaId: ${dramaId} | 标题: ${out.seed.title} | ${out.outline.totalPlannedEpisodes}集`);
    } catch (err: any) {
      logDrama('creation_failed', 'error', err.message, { error: err.message });
      await this.wfExecRepo.update(wfExec!.id, { status: 'failed', errorMessage: err.message ?? '' });
      // 立即将 _status 更新为 failed，防止剧集生成接口误判为"仍在创建中"
      try {
        const d = await this.dramaRepo.findOne({ where: { id: dramaId } });
        if (d && (d.state as any)?._status === 'creating') {
          d.state = { ...(d.state as Record<string, unknown>), _status: 'failed' };
          await this.dramaRepo.save(d);
        }
      } catch { /* 尽力更新，不影响主错误抛出 */ }
      this.progressService.emit({
        dramaId,
        runType: 'create',
        step: 'error',
        stepIndex: -1,
        totalSteps: TOTAL_STEPS,
        message: err.message ?? '创建失败',
        done: true,
        terminal: true,
        terminalStatus: 'failed',
        error: err.message,
      });
      throw err;
    }
  }

  private async persistVisualAssets(
    dramaId: string,
    characters: DramaState['characters'],
    locations: DramaState['locations'],
    visualStyle?: DramaState['visualStyle'],
    signatureProps?: SignatureProp[],
  ): Promise<VisualAssetEntity[]> {
    const existing = await this.visualAssetRepo.find({ where: { dramaId } });
    const existingMap = new Map(existing.map((e) => [`${e.assetType}:${e.refId}`, e]));
    const entities: Partial<VisualAssetEntity>[] = [
      ...characters.map((c) => {
        const prev = existingMap.get(`character:${c.characterId}`);
        // 懒加载：只保留已生成的视角，不预分配空槽
        const referenceImages = prev?.referenceImages ?? [];
        const faceFront = referenceImages.find((item) => item.viewAngle === 'face_front')?.imageUrl || '';
        return {
          dramaId,
          assetType: 'character' as const,
          refId: c.characterId,
          name: c.name,
          data: c as unknown as Record<string, unknown>,
          referenceImageUrl: faceFront || prev?.referenceImageUrl || '',
          referenceImages,
        };
      }),
      ...locations.map((l) => {
        const prev = existingMap.get(`location:${l.locationId}`);
        // 懒加载：只保留已生成的视角，不预分配空槽
        const referenceImages = prev?.referenceImages ?? [];
        const establishing = referenceImages.find((item) => item.viewAngle === 'establishing')?.imageUrl || '';
        return {
          dramaId,
          assetType: 'location' as const,
          refId: l.locationId,
          name: l.name,
          data: l as unknown as Record<string, unknown>,
          referenceImageUrl: establishing || prev?.referenceImageUrl || '',
          referenceImages,
        };
      }),
      // Signature props — drama-level props that are truly recurring/narrative-critical.
      // Replaces the old scene-level propAssets (which generated images for every prop in every scene).
      // Backward compat: if signatureProps is empty, fall back to extracting from locations[].propAssets.
      ...(signatureProps?.length
        ? signatureProps.map((p) => {
            const prev = existingMap.get(`prop:${p.propId}`);
            return {
              dramaId,
              assetType: 'prop' as const,
              refId: p.propId,
              name: p.name,
              data: p as unknown as Record<string, unknown>,
              referenceImageUrl: prev?.referenceImageUrl || '',
              referenceImages: prev?.referenceImages ?? [],
            };
          })
        : locations.flatMap((l) => {
            const props = (l as any).propAssets as PropAsset[] | undefined;
            if (!props?.length) return [];
            return props.map((p) => {
              const refId = `${l.locationId}__${p.propId}`;
              const prev = existingMap.get(`prop:${refId}`);
              return {
                dramaId,
                assetType: 'prop' as const,
                refId,
                name: p.name,
                data: { ...p, locationId: l.locationId, locationName: l.name } as unknown as Record<string, unknown>,
                referenceImageUrl: prev?.referenceImageUrl || '',
                referenceImages: prev?.referenceImages ?? [],
              };
            });
          })),
    ];
    if (visualStyle) {
      const prev = existingMap.get('style_guide:global');
      entities.push({
        dramaId,
        assetType: 'style_guide' as const,
        refId: 'global',
        name: 'Visual Style Guide',
        data: visualStyle as unknown as Record<string, unknown>,
        referenceImageUrl: prev?.referenceImageUrl || '',
        referenceImages: prev?.referenceImages ?? [],
      });
    }
    if (!entities.length) return [];
    const toSave = entities.map((e) => {
      const key = `${e.assetType}:${e.refId}`;
      const prev = existingMap.get(key);
      if (prev) return this.visualAssetRepo.merge(prev, e);
      return this.visualAssetRepo.create(e);
    });
    return this.visualAssetRepo.save(toSave);
  }

  private normalizeCharacterRole(role: unknown): 'protagonist' | 'antagonist' | 'supporting' | 'minor' {
    const normalized = String(role ?? '').trim().toLowerCase();
    if (normalized === 'protagonist') return 'protagonist';
    if (normalized === 'antagonist') return 'antagonist';
    if (normalized === 'supporting') return 'supporting';
    if (normalized === 'minor') return 'minor';
    // narrator / historical_figure 按剧情重要性降级为 supporting
    if (normalized === 'narrator' || normalized === 'historical_figure') return 'supporting';
    // 兜底：中文 role 值或未识别值
    if (/主角|主人公|女主|男主/.test(normalized)) return 'protagonist';
    if (/反派|反角|对手|villain/.test(normalized)) return 'antagonist';
    if (/配角|supporting/.test(normalized)) return 'supporting';
    return 'minor';
  }



  async listDramas(userId?: string): Promise<{ dramas: DramaEntity[] }> {
    const dramas = await this.dramaRepo.find({
      where: userId ? { userId } : undefined,
      order: { updatedAt: 'DESC' },
      select: ['id', 'userId', 'title', 'genre', 'episodesGenerated', 'latestOverallScore', 'createdAt', 'updatedAt'],
    });
    return { dramas };
  }

  async getDrama(dramaId: string): Promise<DramaEntity> {
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    if (!drama) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    return drama;
  }

  /** 生成指定 Agent 节点的基础系统提示词预览（用于创作工坊展示） */
  /** 构建指定节点的基础提示词（供预览）— 内部逻辑共用，支持带/不带 drama 上下文 */
  private buildBasePromptForNode(nodeId: string, ctx: {
    ga?: any; guide?: any; reviewerCalibration?: any; visualStyle?: any;
    strategy?: any; seed?: any; profile?: any; videoProvider?: string;
  }): string {
    const { ga, guide, reviewerCalibration, visualStyle, strategy, seed, profile } = ctx;
    switch (nodeId) {
      // 创建阶段 Agent 预览仅用默认值展示结构；实际运行时由 DTO 参数（用户选择）覆盖
      case 'seed-analyzer':
        return buildSeedAnalyzerSystemPrompt({ epMin: 60, epMax: 100, durSec: 180 });
      case 'series-director':
        return buildSeriesDirectorSystemPrompt({ targetEp: 80, epMin: 60, epMax: 100, durSec: 180 });
      case 'visual-asset-designer':
        return buildVisualAssetDesignerSystemPrompt();
      case 'drama-profiler':
        return buildProfilerSystemPrompt(seed?.genreKey ?? undefined);
      case 'drama-strategy':
        return buildStrategySystemPrompt();
      // ── 集内容生成 Agent（创作工坊中按剧配置）──
      case 'arc-director':
        return buildArcDirectorSystemPrompt({ genreRules: guide?.genreRules, arcDirectorGuide: profile?.arcDirectorGuide });
      case 'episode-director':
        return buildEpisodeDirectorSystemPrompt({
          maxPresentPerEpisode: strategy?.characterBudget?.maxPresentPerEpisode,
          genreArchetype: ga,
          visualStyle: visualStyle ?? undefined,
          genreRules: guide?.genreRules,
          episodeDirectorGuide: profile?.episodeDirectorGuide,
        });
      case 'continuity-guard':
        return buildContinuityGuardSystemPrompt({
          genreSpecificChecks: reviewerCalibration?.genreSpecificChecks,
        });
      case 'scriptwriter':
        return buildScriptwriterSystemPrompt({ guide, visualStyle, genreArchetype: ga });
      case 'dialogue-coach':
        return buildDialogueCoachSystemPrompt({
          dialogueGuide: guide?.dialogueGuide,
          adaptationNotes: ga?.adaptationNotes,
        });
      case 'storyboard-director':
        return buildStoryboardDirectorStaticPrompt({
          visualStyle: visualStyle ?? undefined,
          camGuide: profile?.cameraStyleGuide,
          videoModelProfile: this.videoRouter.getModelProfile(ctx.videoProvider ?? 'sora'),
        });
      case 'audio-director':
        return buildAudioDirectorStaticPrompt({ audioGuide: profile?.audioStyleGuide });
      case 'deterministic-checker':
        return '硬规则校验器（非 LLM）— 执行确定性规则：镜头时长合规（每 Shot 不超过目标时长）、必填字段完整性、安全内容过滤。此节点不调用大模型，无系统提示词。';
      case 'script-reviewer':
        return buildScriptReviewerSystemPrompt({ dialogueGuide: guide?.dialogueGuide });
      case 'script-editor':
        return buildScriptEditorSystemPrompt({ dialogueGuide: guide?.dialogueGuide });
      case 'pacing-analyzer':
        return buildPacingAnalyzerSystemPrompt({ genreArchetype: ga, genreRules: guide?.genreRules, pacingAnalyzerGuide: profile?.pacingAnalyzerGuide });
      case 'hook-crafter':
        return buildHookCrafterStaticPrompt({ genreRules: guide?.genreRules, genreArchetype: ga });
      case 'episode-recorder':
        return buildEpisodeRecorderSystemPrompt({ genreArchetype: ga, genreRules: guide?.genreRules });
      default:
        return `节点 "${nodeId}" 的提示词预览不可用。`;
    }
  }

  async buildNodePreview(dramaId: string, nodeId: string): Promise<{ nodeId: string; basePrompt: string }> {
    const drama = await this.getDrama(dramaId);
    const state = drama.state as any;
    const profile = state?.promptProfile;
    const basePrompt = this.buildBasePromptForNode(nodeId, {
      ga: profile?.genreArchetype,
      guide: profile?.scriptwriterGuide,
      reviewerCalibration: profile?.reviewerCalibration,
      visualStyle: state?.visualStyle,
      strategy: state?.strategy,
      seed: state?.seed,
      profile,
      videoProvider: state?.videoProvider,
    });
    return { nodeId, basePrompt };
  }

  /** 全局节点提示词预览 — 不依赖特定短剧，仅展示系统通用基础内容（供全局设置页使用） */
  buildGlobalNodePreview(nodeId: string): { nodeId: string; basePrompt: string } {
    const basePrompt = this.buildBasePromptForNode(nodeId, {});
    return { nodeId, basePrompt };
  }

  /** 校验短剧归属，用于 usage 等需权限的接口 */
  async assertDramaOwnership(dramaId: string, userId: string): Promise<void> {
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId }, select: ['id', 'userId'] });
    if (!drama) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    if (drama.userId !== 'anonymous' && drama.userId !== userId)
      throw new NotFoundException(`短剧 ${dramaId} 不存在`);
  }

  /** 直接更新短剧的 state.visualStyle（用户在工作台手动调整视觉风格） */
  async updateVisualStyle(
    dramaId: string,
    visualStyle: Record<string, unknown>,
    userId?: string,
  ): Promise<{ success: boolean }> {
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    if (!drama) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    if (userId && drama.userId !== userId) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    const state = (drama.state ?? {}) as Record<string, unknown>;
    drama.state = { ...state, visualStyle };
    await this.dramaRepo.save(drama);
    return { success: true };
  }

  async deleteDrama(dramaId: string, userId?: string): Promise<{ success: boolean }> {
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    if (!drama) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    if (userId && drama.userId !== userId) throw new NotFoundException(`短剧 ${dramaId} 不存在`);
    if (await this.stateStore.isGenerating(dramaId)) {
      throw new Error('该短剧正在生成中，请先暂停后再删除');
    }

    // 1. 清除 Redis 状态（进度追踪 / 暂停标记 / 生成锁）
    await this.stateStore.cancel(dramaId);
    await this.stateStore.stopGenerating(dramaId); // 确保 generating SET + TTL key 被清除
    this.progressService.clearGenerating(`${dramaId}:generate`);
    this.progressService.clearGenerating(`${dramaId}:assets`); // 批量参考图生成锁
    const episodes = await this.episodeRepo.find({ where: { dramaId }, select: ['episodeNumber'] });
    for (const ep of episodes) {
      this.progressService.clearGenerating(`${dramaId}:media:${ep.episodeNumber}`);
      this.progressService.clearGenerating(`${dramaId}:images:${ep.episodeNumber}`);
    }

    // 2. 取消并清除 BullMQ 队列中该 drama 的待执行任务
    await this.purgeQueueJobs(dramaId);

    // 3. 取消并删除 drama_tasks
    await this.dramaTaskService.cancelAndDeleteByDrama(dramaId);

    // 4. 删除 graph runs / steps / events
    await this.dramaRunService.deleteByDrama(dramaId);

    // 5. 删除 agent pipeline 配置
    await this.pipelineService.deleteByDrama(dramaId);

    // 6. 删除 media_jobs
    await this.mediaJobService.deleteByDrama(dramaId);

    // 7. 删除本地存储文件 (images/videos/audio)
    this.localStorage.deleteDramaFiles(dramaId);

    // 8. 删除核心表
    await this.episodeRepo.delete({ dramaId });
    await this.visualAssetRepo.delete({ dramaId });
    await this.wfExecRepo.delete({ dramaId });
    await this.dramaRepo.remove(drama);

    // 9. 清理 EventEmitter 监听器（防止 SSE 监听器残留）
    this.progressService.removeAllForDrama(dramaId);

    this.logger.log(`短剧已完整删除 dramaId=${dramaId}`);
    // cancelled TTL 由 Redis 自动管理（5 分钟后过期）
    return { success: true };
  }

  private async purgeQueueJobs(dramaId: string): Promise<void> {
    for (const queue of [this.textQueue, this.imageQueue, this.videoQueue, this.voiceQueue]) {
      try {
        // 清理 waiting/delayed/prioritized 状态的 job（可直接 remove）
        const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
        for (const job of waiting) {
          if (job.data?.dramaId === dramaId) {
            await job.remove().catch(() => {});
          }
        }
        // 标记 active 状态的 job 为 failed（BullMQ 不允许 remove active job）
        const active = await queue.getJobs(['active']);
        for (const job of active) {
          if (job.data?.dramaId === dramaId) {
            await job.moveToFailed(new Error('短剧已删除，任务强制终止'), job.token ?? '0', false).catch(() => {});
          }
        }
      } catch (err) {
        this.logger.warn(`清理队列 ${queue.name} 中 dramaId=${dramaId} 的任务失败: ${(err as Error).message}`);
      }
    }
  }

  /** 异步启动逐集生成（含并发互斥），立即返回任务信息 */
  async generateEpisodes(dramaId: string): Promise<{ message: string; startEp: number; endEp: number }> {
    await this.stateStore.resume(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId);
    this.runEpisodePipeline(dramaId, startEp, endEp).catch(err =>
      this.logger.error(`逐集生成失败 dramaId=${dramaId} E${startEp}-E${endEp}: ${err.message}`),
    ).finally(() => { this.stateStore.stopGenerating(dramaId); });
    return { message: `已启动 ${endEp - startEp + 1} 集生成（E${startEp}-E${endEp}）`, startEp, endEp };
  }

  /** 逐集生成并等待完成（供 SSE 使用，可推送进度） */
  async generateEpisodesAndWait(dramaId: string): Promise<{ message: string; startEp: number; endEp: number; paused: boolean }> {
    await this.stateStore.resume(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId);
    try {
      const wasPaused = await this.runEpisodePipeline(dramaId, startEp, endEp);
      return { message: wasPaused ? '已暂停' : `E${startEp}-E${endEp} 全部完成`, startEp, endEp, paused: wasPaused };
    } finally {
      await this.stateStore.stopGenerating(dramaId);
    }
  }

  private async prepareGenerateEpisodes(dramaId: string): Promise<{ startEp: number; endEp: number }> {
    if (await this.stateStore.isGenerating(dramaId)) throw new Error('该短剧正在生成中，请勿重复提交');
    const drama = await this.getDrama(dramaId);
    const state = drama.state as unknown as DramaState;
    const creationStatus = (state as any)?._status;
    if (creationStatus === 'creating') throw new Error('短剧仍在创建中，请等待创建完成后再生成集数');
    if (creationStatus === 'failed') throw new Error('短剧创建失败，请调用重试接口（retryCreation）后再生成集数');
    const rawCursor = state?.episodeCursor;
    const startEp = Number.isFinite(rawCursor) && rawCursor >= 1 ? rawCursor : Math.max(1, (drama.episodesGenerated ?? 0) + 1);
    const endEp = startEp;
    this.logger.log(`开始生成 E${startEp} — dramaId: ${dramaId}`);
    await this.stateStore.startGenerating(dramaId);
    return { startEp, endEp };
  }

  /** 后台逐集串行执行（确保上下文正确传递），返回 true 表示被暂停 */
  private async runEpisodePipeline(dramaId: string, startEp: number, endEp: number): Promise<boolean> {
    try {
      for (let ep = startEp; ep <= endEp; ep++) {
        if (await this.stateStore.isPaused(dramaId)) {
          this.logger.log(`生成已暂停 dramaId=${dramaId}，停在 E${ep} 之前`);
          this.progressService.emit({
            dramaId,
            runType: 'episode',
            step: 'paused',
            stepIndex: 0,
            totalSteps: 1,
            message: `已暂停，下次将从 E${ep} 继续`,
            done: true,
            terminal: true,
            terminalStatus: 'paused',
          });
          const drama = await this.getDrama(dramaId);
          const st = drama.state as any;
          st.episodeCursor = ep;
          await this.dramaRepo.update(dramaId, { state: st });
          return true;
        }
        await this.episodeWorkflow.generateEpisode(dramaId, ep);
      }
      this.progressService.emit({
        dramaId,
        runType: 'episode',
        step: 'all_done',
        stepIndex: 0,
        totalSteps: 1,
        message: `E${startEp}-E${endEp} 全部完成`,
        done: true,
        terminal: true,
        terminalStatus: 'success',
      });
      return false;
    } catch (err: any) {
      this.progressService.emit({
        dramaId,
        runType: 'episode',
        step: 'failed',
        stepIndex: 0,
        totalSteps: 1,
        message: err?.message ?? `E${startEp}-E${endEp} 生成失败`,
        done: true,
        terminal: true,
        terminalStatus: 'failed',
        error: err?.message ?? '生成失败',
      });
      throw err;
    }
  }

  async pauseGeneration(dramaId: string): Promise<boolean> {
    if (!(await this.stateStore.isGenerating(dramaId))) return false;
    await this.stateStore.pause(dramaId);
    this.logger.log(`暂停请求已标记 dramaId=${dramaId}`);
    return true;
  }

  async resumeGeneration(dramaId: string): Promise<void> {
    await this.stateStore.resume(dramaId);
  }

  async isGenerationPaused(dramaId: string): Promise<boolean> {
    return this.stateStore.isPaused(dramaId);
  }

  async listEpisodes(dramaId: string): Promise<{ episodes: EpisodeEntity[] }> {
    const episodes = await this.episodeRepo.find({
      where: { dramaId },
      order: { episodeNumber: 'ASC' },
      select: ['id', 'dramaId', 'episodeNumber', 'title', 'overallScore', 'totalDurationSec', 'shotCount', 'mediaStatus', 'videoUrl', 'createdAt'],
    });
    return { episodes };
  }

  async getEpisode(dramaId: string, episodeNumber: number): Promise<EpisodeEntity> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new NotFoundException(`短剧 ${dramaId} 第 ${episodeNumber} 集不存在`);
    return episode;
  }

  /**
   * 人工编辑单个 Shot — 支持局部字段更新，自动标记 isHumanEdited=true。
   * AI 重跑时（EpisodeWorkflowService）应检查 isHumanEdited 决定是否跳过该 Shot。
   *
   * 可编辑字段：visualPrompt / camera / characters / dialogue / audio /
   *             specialTechnique / firstFrameImageUrl / lastFrameImageUrl /
   *             estimatedDurationSec / transitionToNext / humanEditNote
   */
  async updateShot(
    dramaId: string,
    episodeNumber: number,
    shotId: string,
    patch: Record<string, unknown>,
  ): Promise<{ shotId: string; isHumanEdited: true }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new NotFoundException(`第 ${episodeNumber} 集不存在`);

    const storyboard = episode.storyboard as { shots?: Record<string, unknown>[] } | null;
    if (!storyboard?.shots?.length) throw new NotFoundException('该集尚无分镜数据');

    const idx = storyboard.shots.findIndex((s: any) => s.shotId === shotId);
    if (idx === -1) throw new NotFoundException(`Shot ${shotId} 不存在`);

    // 只允许更新安全字段，拒绝覆盖系统控制字段
    const ALLOWED_KEYS = new Set([
      'visualPrompt', 'camera', 'characters', 'dialogue', 'audio', 'subtitle',
      'specialTechnique', 'firstFrameImageUrl', 'lastFrameImageUrl',
      'firstFramePrompt', 'lastFramePrompt',
      'estimatedDurationSec', 'transitionToNext', 'humanEditNote',
    ]);
    const safePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (ALLOWED_KEYS.has(k)) safePatch[k] = v;
    }

    storyboard.shots[idx] = {
      ...storyboard.shots[idx],
      ...safePatch,
      isHumanEdited: true,
      humanEditedAt: new Date().toISOString(),
    };

    episode.storyboard = storyboard as Record<string, unknown>;
    await this.episodeRepo.save(episode);

    this.logger.log(`[HumanEdit] drama=${dramaId} ep=${episodeNumber} shot=${shotId} fields=${Object.keys(safePatch).join(',')}`);
    return { shotId, isHumanEdited: true };
  }

  async getVisualAssets(dramaId: string): Promise<{ assets: VisualAssetEntity[] }> {
    const assets = await this.visualAssetRepo.find({ where: { dramaId }, order: { createdAt: 'ASC' } });
    return { assets };
  }

  async generateEpisodeMedia(dramaId: string, episodeNumber: number) {
    return this.mediaOrchestrator.generateEpisodeMedia(dramaId, episodeNumber);
  }

  /**
   * 重置单集中"问题镜头"的媒体状态，供前端一键重生后再触发 generate-media。
   * 问题判定：
   * 1) 质量关卡未通过（qc.passed=false）
   * 2) 视频失败/卡住（status=failed|submitted）
   * 3) 标记完成但缺少 videoUrl
   * 4) 集级媒体失败 + 仅有首帧(image_done)未产出视频
   * 5) 审核器标记的风险镜头（consistencyRiskShots/cameraReadabilityRiskShots）
   */
  async resetProblemShots(
    dramaId: string,
    episodeNumber: number,
    opts?: { includeReviewRisks?: boolean; onlyHighPriority?: boolean; fixTarget?: ProblemFixTarget },
  ): Promise<{ episodeNumber: number; totalShots: number; problemShotIds: string[]; resetCount: number }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new NotFoundException(`短剧 ${dramaId} 第 ${episodeNumber} 集不存在`);
    const includeReviewRisks = opts?.includeReviewRisks ?? true;
    const onlyHighPriority = opts?.onlyHighPriority ?? false;
    const fixTarget = this.normalizeFixTarget(opts?.fixTarget);

    const storyboard = (episode.storyboard as EpisodeStoryboard | null) ?? null;
    const shots = storyboard?.shots ?? [];
    const rawMap = (episode.shotMediaMap ?? {}) as Record<string, {
      status?: string;
      videoUrl?: string;
      qc?: {
        passed?: boolean;
        readabilityScore?: number;
        failReasons?: Array<'identity' | 'style' | 'camera' | 'motion'>;
        recommendedFix?: 'identity' | 'style' | 'camera' | 'motion';
      };
    }>;
    const reviewRiskSets = includeReviewRisks
      ? this.extractReviewRiskShotIds(episode.review)
      : { all: new Set<string>(), consistency: new Set<string>(), camera: new Set<string>() };

    const problemShotIds: string[] = [];
    for (const shot of shots) {
      const entry = rawMap[shot.shotId];
      const mediaProblem = this.isProblemShotMediaEntry(shot, entry, episode.mediaStatus);
      const reviewRisk = reviewRiskSets.all.has(shot.shotId);
      if (!mediaProblem && !reviewRisk) continue;
      if (onlyHighPriority && !this.isHighPriorityShot(shot)) continue;
      if (!this.matchesFixTarget(fixTarget, shot, entry, reviewRiskSets)) continue;
      problemShotIds.push(shot.shotId);
    }

    if (problemShotIds.length === 0) {
      return { episodeNumber, totalShots: shots.length, problemShotIds: [], resetCount: 0 };
    }

    const resetMap: Record<string, Record<string, unknown>> = { ...rawMap };
    for (const sid of problemShotIds) {
      resetMap[sid] = { status: 'not_started' };
    }

    await this.episodeRepo.update(episode.id, {
      shotMediaMap: resetMap,
      mediaStatus: 'not_started',
      mediaError: '',
      videoUrl: '',
    });

    this.logger.log(
      `[MediaReset] drama=${dramaId} ep=${episodeNumber} reset=${problemShotIds.length} includeReviewRisks=${includeReviewRisks} ` +
      `onlyHighPriority=${onlyHighPriority} fixTarget=${fixTarget} shots=${problemShotIds.join(',')}`,
    );
    return {
      episodeNumber,
      totalShots: shots.length,
      problemShotIds,
      resetCount: problemShotIds.length,
    };
  }

  async generateEpisodeImages(dramaId: string, episodeNumber: number): Promise<void> {
    // 校验：角色全局参考图是否已生成
    // 若 drama_visual_assets 中存在角色记录但无一张有 referenceImageUrl，说明用户跳过了工作台出图步骤
    const charAssets = await this.visualAssetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    if (charAssets.length > 0) {
      const assetsWithImages = charAssets.filter(a => !!a.referenceImageUrl);
      if (assetsWithImages.length === 0) {
        throw new Error('全局角色参考图尚未生成，请先在工作台完成参考图生成后再出集图片，否则角色面孔将无法保持一致');
      }
    }
    return this.mediaOrchestrator.generateEpisodeImages(dramaId, episodeNumber);
  }

  async generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
    return this.mediaOrchestrator.generateShotImage(dramaId, episodeNumber, shotId);
  }

  async generateShotVideo(dramaId: string, episodeNumber: number, shotId: string): Promise<{ videoUrl: string; status: string }> {
    return this.mediaOrchestrator.generateShotVideo(dramaId, episodeNumber, shotId);
  }

  async getEpisodeMediaStatus(dramaId: string, episodeNumber: number) {
    return this.mediaOrchestrator.getMediaStatus(dramaId, episodeNumber);
  }

  private isProblemShotMediaEntry(
    shot: Shot,
    entry: {
      status?: string;
      videoUrl?: string;
      qc?: {
        passed?: boolean;
        readabilityScore?: number;
        failReasons?: Array<'identity' | 'style' | 'camera' | 'motion'>;
        recommendedFix?: 'identity' | 'style' | 'camera' | 'motion';
      };
    } | undefined,
    episodeMediaStatus: EpisodeEntity['mediaStatus'],
  ): boolean {
    if (!entry) return false;
    if (shot.isPreview) return false;
    if (entry.qc?.passed === false) return true;
    if (entry.status === 'failed' || entry.status === 'submitted') return true;
    if (entry.status === 'completed' && !entry.videoUrl) return true;
    if (episodeMediaStatus === 'failed' && entry.status === 'image_done' && !entry.videoUrl && !shot.isFlashback) return true;
    return false;
  }

  private isHighPriorityShot(shot: Shot): boolean {
    return !!(shot.isMasterShot || shot.regenPriority === 'high' || shot.qualityTier === 'golden');
  }

  private normalizeFixTarget(target: ProblemFixTarget | undefined): ProblemFixTarget {
    const valid: ProblemFixTarget[] = ['all', 'identity', 'style', 'camera', 'motion'];
    if (!target || !valid.includes(target)) return 'all';
    return target;
  }

  private matchesFixTarget(
    fixTarget: ProblemFixTarget,
    shot: Shot,
    entry: {
      status?: string;
      videoUrl?: string;
      qc?: {
        passed?: boolean;
        readabilityScore?: number;
        failReasons?: Array<'identity' | 'style' | 'camera' | 'motion'>;
        recommendedFix?: 'identity' | 'style' | 'camera' | 'motion';
      };
    } | undefined,
    reviewRiskSets: ReviewRiskShotSets,
  ): boolean {
    if (fixTarget === 'all') return true;
    const failReasons = entry?.qc?.failReasons ?? [];
    const recommendedFix = entry?.qc?.recommendedFix;
    const hasFixTag = (tag: 'identity' | 'style' | 'camera' | 'motion'): boolean =>
      (tag === recommendedFix) || failReasons.includes(tag);

    if (fixTarget === 'identity') {
      return hasFixTag('identity') || reviewRiskSets.consistency.has(shot.shotId);
    }
    if (fixTarget === 'style') {
      return hasFixTag('style') || reviewRiskSets.consistency.has(shot.shotId);
    }
    if (fixTarget === 'camera') {
      const readabilityLow = typeof entry?.qc?.readabilityScore === 'number' && entry.qc.readabilityScore < 6;
      return hasFixTag('camera') || readabilityLow || reviewRiskSets.camera.has(shot.shotId);
    }
    const likelyMotionProblem = entry?.status === 'failed' && !entry.videoUrl && !shot.isPreview;
    return hasFixTag('motion') || likelyMotionProblem;
  }

  private extractReviewRiskShotIds(review: unknown): ReviewRiskShotSets {
    const root = (review && typeof review === 'object') ? (review as Record<string, unknown>) : {};
    const consistency = new Set<string>();
    const camera = new Set<string>();
    const pick = (list: unknown, sink: Set<string>) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const shotId = (item as Record<string, unknown>).shotId;
        if (typeof shotId === 'string' && shotId.trim()) sink.add(shotId);
      }
    };
    pick(root.consistencyRiskShots, consistency);
    pick(root.cameraReadabilityRiskShots, camera);
    return {
      all: new Set<string>([...consistency, ...camera]),
      consistency,
      camera,
    };
  }

  private async runConcurrent(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
    let idx = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }));
  }

  // ── 创意辅助方法：已提取至 DramaIdeaService，此处保留委托接口供内部引用 ──
  async enhanceIdea(rawIdea: string, genre?: string, userId?: string) {
    return this.ideaService.enhanceIdea(rawIdea, genre, userId);
  }

  async recommendGenreAndAudience(mainIdea: string, userId?: string) {
    return this.ideaService.recommendGenreAndAudience(mainIdea, userId);
  }

  async generateStoryGoal(input: { mainIdea: string; genre: string; targetAudience: string }, userId?: string) {
    return this.ideaService.generateStoryGoal(input, userId);
  }
}
