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
import { MediaService } from '../media/media.service';
import { RenderingProfileService } from '../media/rendering/rendering-profile.service';
import {
  CHARACTER_VIEW_ANGLES, CharacterViewAngle, buildViewAnglePrompt, assembleT2iPrompt, ageToT2IPhrase,
  LOCATION_VIEW_ANGLES, LocationViewAngle, buildLocationViewPrompt,
} from '../media/rendering/rendering-profile';
import { PromptOptimizerService } from '../media/prompt-optimizer.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaVisualStyleTemplateService } from './drama-visual-style-template.service';
import { ImageProviderRouterService } from './media-pipeline/image-provider-router.service';
import { DramaTaskService } from './task/task.service';
import { DramaRunService } from './run/run.service';
import { DramaAgentPipelineService } from './workflow/drama-agent-pipeline.service';
import { DramaGlobalPromptSettingService } from './drama-global-prompt-setting.service';
import {
  buildArcDirectorSystemPrompt, buildEpisodeDirectorSystemPrompt,
  buildContinuityGuardSystemPrompt, buildScriptwriterSystemPrompt,
  buildDialogueCoachSystemPrompt, buildStoryboardDirectorSystemPrompt,
  buildAudioDirectorSystemPrompt, buildScriptReviewerSystemPrompt,
  buildScriptEditorSystemPrompt, buildPacingAnalyzerSystemPrompt,
  buildHookCrafterSystemPrompt, buildEpisodeRecorderSystemPrompt,
  // 创建阶段 Agent
  buildSeedAnalyzerSystemPrompt, buildSeriesDirectorSystemPrompt,
  buildVisualAssetDesignerSystemPrompt, buildProfilerSystemPrompt, buildStrategySystemPrompt,
} from './prompting/drama-playbook';
import { MediaJobService } from '../media/media-job.service';
import { LocalStorageService } from '../media/local-storage.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DRAMA_QUEUE } from './task/types';

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
  private readonly generatingDramas = new Set<string>();
  private readonly pausedDramas = new Set<string>();
  private readonly cancelledDramas = new Set<string>();

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
    private readonly mediaService: MediaService,
    private readonly renderingProfileService: RenderingProfileService,
    private readonly promptOptimizer: PromptOptimizerService,
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly visualStyleTemplateService: DramaVisualStyleTemplateService,
    private readonly llm: LlmService,
    private readonly traceLogger: LlmTraceLoggerService,
    private readonly dramaTaskService: DramaTaskService,
    private readonly dramaRunService: DramaRunService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly globalPromptSettingService: DramaGlobalPromptSettingService,
    private readonly mediaJobService: MediaJobService,
    private readonly localStorage: LocalStorageService,
    private readonly imageRouter: ImageProviderRouterService,
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
        } catch {}
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
      const productionGuidance = (genreTemplate?.profileJson as any)?.productionGuidance ?? undefined;

      // 加载用户的全局 AI 补充指令（仅创建阶段 5 个准备 Agent 使用）
      const creationUserId = opts.userId ?? 'system';
      await this.globalPromptSettingService.ensureUserRows(creationUserId);
      const getGlobalPrompt = (agentType: string) =>
        this.globalPromptSettingService.getGlobalAdditional(creationUserId, agentType);

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
        }, getGlobalPrompt('seed-analyzer') || undefined);
        out.seed = seed;
        out.seedHints = seedHints ?? null;
        logDrama('seed_analyze_done', 'ok', '种子分析完成', { seedTitle: seed?.title });
        emitCreate(0, '种子分析完成', true);
        await saveCP('seed_analyzed', { seed, seedHints: out.seedHints });
      }

      if (resumeFrom <= 1) {
        logDrama('outline_plan_start', 'ok', '总导演规划全剧大纲');
        emitCreate(1, '总导演规划全剧大纲...');
        out.outline = await this.seriesDirector.plan(out.seed, dramaId, opts.userId, productionGuidance, getGlobalPrompt('series-director') || undefined);
        logDrama('outline_plan_done', 'ok', '全剧大纲完成', { totalEpisodes: out.outline?.totalPlannedEpisodes });
        emitCreate(1, '全剧大纲完成', true);
        await saveCP('outline_planned', { outline: out.outline });
      }

      if (resumeFrom <= 2) {
        logDrama('visual_design_start', 'ok', '视觉资产设计');
        emitCreate(2, '视觉资产设计...');
        // 若指定了视觉风格模板，读取其 visualGuide 作为种子数据注入 LLM
        let visualStyleTemplateGuide: Record<string, unknown> | undefined;
        let effectiveVisualStyleHint = dto.visualStyleHint || (out.seedHints as any)?.visualStyleHints || undefined;
        let effectiveSuggestedVisualStyle = dto.suggestedVisualStyle;
        if (dto.visualStyleTemplateId) {
          const vsTpl = await this.visualStyleTemplateService.getById(dto.visualStyleTemplateId).catch(() => null);
          if (vsTpl) {
            visualStyleTemplateGuide = vsTpl.visualGuide as Record<string, unknown>;
            // 用模板的 styleReferencePrompt 作为最高优先级 hint（英文 T2I 提示词），仅在用户未手动指定时注入
            if (!effectiveVisualStyleHint && vsTpl.visualGuide?.styleReferencePrompt) {
              effectiveVisualStyleHint = vsTpl.visualGuide.styleReferencePrompt;
            }
            // 模板的 styleKey 始终是权威 styleKey，覆盖 LLM 推荐或前端传入的模糊值
            effectiveSuggestedVisualStyle = vsTpl.styleKey;
            // 将模板正向关键词追加到 hint 中，强化风格引导
            if (vsTpl.promptGuidance?.positiveKeywords?.length) {
              const keywords = vsTpl.promptGuidance.positiveKeywords.join(', ');
              effectiveVisualStyleHint = effectiveVisualStyleHint
                ? `${effectiveVisualStyleHint}, ${keywords}`
                : keywords;
            }
            this.logger.log(`[create] 视觉风格模板已注入: ${vsTpl.displayName} (${vsTpl.styleKey})`);
          }
        }
        const { characters, locations, visualStyle, signatureProps } = await this.visualDesigner.design(
          out.seed, out.outline, effectiveVisualStyleHint, dramaId, opts.userId, effectiveSuggestedVisualStyle,
          { protagonistFocus: dto.protagonistFocus, platformTarget: dto.platformTarget, audienceTags: dto.audienceTags },
          // 模板数据注入：facePromptRule 来自视觉风格模板，主角颜值公式来自题材模板
          visualStyleTemplateGuide as any,
          productionGuidance,
          getGlobalPrompt('visual-asset-designer') || undefined,
        );
        // 若有模板数据，用模板 visualGuide 中 LLM 未填充的字段进行补充（模板数据优先级次于 LLM 输出）
        const mergedVisualStyle = visualStyleTemplateGuide
          ? { ...visualStyleTemplateGuide, ...Object.fromEntries(Object.entries(visualStyle).filter(([, v]) => v !== undefined && v !== '')) }
          : visualStyle;
        Object.assign(out, { characters, locations, visualStyle: mergedVisualStyle, signatureProps });
        logDrama('visual_design_done', 'ok', '视觉资产设计完成', { charCount: out.characters?.length, locCount: out.locations?.length });
        emitCreate(2, '视觉资产设计完成', true);
        await saveCP('visual_designed', { characters, locations, visualStyle: mergedVisualStyle, signatureProps });
      }

      if (resumeFrom <= 3) {
        logDrama('assets_persist_start', 'ok', '保存角色与场景资产');
        emitCreate(3, '保存角色与场景资产...');
        const assetEntities = await this.persistVisualAssets(dramaId, out.characters, out.locations, out.visualStyle, out.signatureProps);
        out.visualAssets = assetEntities;
        logDrama('assets_persist_done', 'ok', '角色与场景资产已保存（参考图可在工作台手动生成）');
        emitCreate(3, '角色与场景资产已保存', true);
        await saveCP('assets_generated', { visualAssets: assetEntities });
      }

      if (resumeFrom <= 4) {
        logDrama('profile_strategy_start', 'ok', '编剧手册+策略生成');
        emitCreate(4, '编剧手册 + 策略...');
        const [promptProfile, strategy] = await Promise.all([
          this.profiler.generate(
            out.seed, out.visualStyle, out.outline, dramaId, opts.userId,
            genreTemplate?.profileJson ?? undefined,
            getGlobalPrompt('drama-profiler') || undefined,
          ),
          this.strategist.generate(out.seed, out.outline, dramaId, opts.userId, productionGuidance, getGlobalPrompt('drama-strategy') || undefined),
        ]);
        Object.assign(out, { promptProfile, strategy });
        logDrama('profile_strategy_done', 'ok', '编剧手册完成');
        emitCreate(4, '编剧手册完成', true);
        await saveCP('profile_ready', { promptProfile, strategy });
      }

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
        ...(dto.visualStyleTemplateId ? { visualStyleTemplateId: dto.visualStyleTemplateId } : {}),
        promptProfile: out.promptProfile, strategy: out.strategy, visualStyle: out.visualStyle,
        visualBible: this.buildVisualBible(
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
        const referenceImages = this.buildCharacterReferenceSlots(c, prev);
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
        const referenceImages = this.buildLocationReferenceSlots(l, prev);
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
    const normalized = String(role ?? '').trim();
    if (normalized === 'protagonist' || normalized === 'antagonist' || normalized === 'supporting' || normalized === 'minor') {
      return normalized;
    }
    return 'minor';
  }

  private buildCharacterReferenceSlots(
    character: DramaState['characters'][number],
    prev?: VisualAssetEntity,
  ): Array<{ viewAngle: string; imageUrl: string }> {
    const profile = this.renderingProfileService.getImageProfile();
    const required = profile.characterViews.viewsByRole[this.normalizeCharacterRole(character.role)] ?? ['face_front'];
    const slotMap = new Map<string, string>();
    for (const item of prev?.referenceImages ?? []) {
      if (!item?.viewAngle) continue;
      slotMap.set(item.viewAngle, item.imageUrl || '');
    }
    if (prev?.referenceImageUrl && !slotMap.has('face_front')) {
      slotMap.set('face_front', prev.referenceImageUrl);
    }
    for (const view of required) {
      if (!slotMap.has(view)) slotMap.set(view, '');
    }
    if (!slotMap.has('face_front')) slotMap.set('face_front', '');
    const order = new Map<string, number>(CHARACTER_VIEW_ANGLES.map((view, idx) => [view, idx]));
    return Array.from(slotMap.entries())
      .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
      .map(([viewAngle, imageUrl]) => ({ viewAngle, imageUrl: imageUrl || '' }));
  }

  private buildLocationReferenceSlots(
    loc: DramaState['locations'][number],
    prev?: VisualAssetEntity,
  ): Array<{ viewAngle: string; imageUrl: string }> {
    const profile = this.renderingProfileService.getImageProfile();
    const required = loc.isRecurring ? profile.locationViews.recurring : profile.locationViews.normal;
    const slotMap = new Map<string, string>();
    for (const item of prev?.referenceImages ?? []) {
      if (!item?.viewAngle) continue;
      slotMap.set(item.viewAngle, item.imageUrl || '');
    }
    if (prev?.referenceImageUrl && !slotMap.has('establishing')) {
      slotMap.set('establishing', prev.referenceImageUrl);
    }
    for (const view of required) {
      if (!slotMap.has(view)) slotMap.set(view, '');
    }
    if (!slotMap.has('establishing')) slotMap.set('establishing', '');
    const order = new Map<string, number>(LOCATION_VIEW_ANGLES.map((view, idx) => [view, idx]));
    return Array.from(slotMap.entries())
      .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
      .map(([viewAngle, imageUrl]) => ({ viewAngle, imageUrl: imageUrl || '' }));
  }

  /**
   * 为角色（多角度）+场景并发生成参考图，回写 VisualAssetEntity。
   *
   * Phase 1: 为所有角色生成 face_front（正面定妆照）+ 所有场景 establishing（全景）
   * Phase 2: 按角色重要性链式生成额外视角（以 face_front 为参考图）
   * Phase 2b: 按场景复用频率链式生成额外视角（以 establishing 为参考图）
   * Phase 3: 角色外观变体参考图
   */
  private static readonly CHAR_IMAGE_SIZE = '2:3';
  private static readonly SCENE_IMAGE_SIZE = '3:2';
  private static readonly PROP_IMAGE_SIZE = '1:1';

  private optimizeAssetPrompt(
    rawPrompt: string,
    shotType: 'character' | 'location' | 'style_guide',
    stylePrefix?: string,
    provider?: string,
    styleBucket?: string,
  ): { prompt: string; negativePrompt: string } {
    const profile = this.renderingProfileService.getImageProfile();
    const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, profile.negativePrompt.defaultValue, {
      shotType,
      qualityTier: 'golden',
      provider,
      styleBucket,
    });
    return { prompt: assembleT2iPrompt(optimized.prompt, profile, { stylePrefix }), negativePrompt: optimized.negativePrompt };
  }

  /**
   * 从 visualStyle 推断视觉风格桶（与 GenerationPolicyService.detectStyleBucket 保持一致）。
   * 避免注入额外依赖，简单字符串匹配即可。
   */
  private detectStyleBucket(vs?: DramaState['visualStyle']): string {
    const text = [
      vs?.overallAesthetic ?? '',
      vs?.renderTechnique ?? '',
      vs?.textureStyle ?? '',
      vs?.referenceStyle ?? '',
    ].join(' ').toLowerCase();
    if (/定格|粘土|毛毡|纸艺|stop.?motion|clay/.test(text)) return 'stop_motion';
    if (/\b3d\b|cg\b|npr|pixar|迪士尼|赛璐璐/.test(text)) return 'three_d';
    if (/真人|写实|实拍|live.?action|photoreal/.test(text)) return 'live_action';
    if (/\b2d\b|动漫|漫画|手绘|水墨|像素|anime/.test(text)) return 'two_d';
    return 'generic';
  }

  /**
   * 为 flux-2/pro-image-to-image 构建变换帧式（transformation-focused）角度提示词。
   * 该模型接受参考图作为身份锚点，因此提示词聚焦"变换到什么角度/姿态"而非重复描述人脸。
   */
  private buildI2IViewAnglePrompt(
    ch: { defaultCostume?: string; defaultCostumePrompt?: string; bodyType?: string; bodyTypePrompt?: string },
    viewAngle: string,
  ): string {
    const costume = ch.defaultCostumePrompt || ch.defaultCostume || '';
    const body = ch.bodyTypePrompt || ch.bodyType || '';
    const costumeClause = costume ? `, wearing ${costume}` : '';
    const bodyClause = body ? `, ${body} build` : '';
    switch (viewAngle) {
      case 'face_three_quarter':
        return `Same person as reference photo, three quarter view portrait, slightly turned face${costumeClause}, consistent face and hair identity, neutral background`;
      case 'upper_body_front':
        return `Same person as reference photo, upper body portrait, facing forward${costumeClause}${bodyClause}, consistent identity, neutral background`;
      case 'full_body_front':
        return `Same person as reference photo, full body standing portrait, facing forward${costumeClause}${bodyClause}, neutral studio background, consistent identity`;
      case 'side_profile':
        return `Same person as reference photo, strict side profile, facing left${costumeClause}, consistent hair and facial features, neutral background`;
      case 'back_view':
        return `Same person as reference photo, back view${costumeClause}${bodyClause}, neutral background`;
      case 'face_happy':
        return `Same person as reference photo, front-facing portrait, happy expression, genuine slight smile, pleased and warm, subtle not exaggerated${costumeClause}, consistent facial bone structure, same face identity, no face drift, neutral background`;
      case 'face_angry':
        return `Same person as reference photo, front-facing portrait, angry expression, furrowed brows, sharp stern gaze, controlled tension in eyes, not distorted${costumeClause}, consistent facial bone structure, same face identity, no face drift, neutral background`;
      default:
        return `Same person as reference photo, ${viewAngle} view${costumeClause}, consistent identity`;
    }
  }

  /**
   * 构建 T2I 风格前缀。
   *
   * Character portrait 优先级：
   *   1. characterStylePrompt（角色专用前缀，仅含时代+渲染，无场景条件词）
   *   2. styleReferencePrompt（全局风格，通常无条件词）
   *   3. Fallback：overallAesthetic + renderTechnique + referenceStyle
   *      （排除 colorGrading / lightingStyle，避免"for X scenes / for interiors"等
   *       多条件描述同时出现互相矛盾，且不适用于中性背景的角色定妆参考图）
   *
   * Scene / location 路径：
   *   1. styleReferencePrompt
   *   2. Fallback：全量 6 字段拼接
   */
  private buildAssetStylePrefix(vs?: DramaState['visualStyle'], shotType: 'character' | 'location' | 'style_guide' = 'location'): string | undefined {
    if (!vs) return undefined;

    if (shotType === 'character') {
      const charRef = (vs.characterStylePrompt ?? '').trim();
      if (charRef) return charRef + ', ';
      const styleRef = (vs.styleReferencePrompt ?? '').trim();
      if (styleRef) return styleRef + ', ';
      // 最小化 fallback：只保留时代/美学 + 渲染技术 + 风格参考
      const parts = [vs.overallAesthetic, vs.renderTechnique, vs.referenceStyle]
        .filter(Boolean).map((p) => (p ?? '').trim()).filter(Boolean);
      return parts.length ? parts.join(', ') + ', ' : undefined;
    }

    // location / style_guide：优先 styleReferencePrompt，回退全量字段
    const styleRef = (vs.styleReferencePrompt ?? '').trim();
    if (styleRef) return styleRef + ', ';
    const parts = [vs.overallAesthetic, vs.renderTechnique, vs.textureStyle, vs.colorGrading, vs.lightingStyle, vs.referenceStyle]
      .filter(Boolean).map((p) => (p ?? '').trim()).filter(Boolean);
    return parts.length ? parts.join(', ') + ', ' : undefined;
  }

  private async generateReferenceImages(
    dramaId: string, assets: VisualAssetEntity[],
    characters: DramaState['characters'], locations: DramaState['locations'],
    visualStyle?: DramaState['visualStyle'],
    userId?: string,
  ): Promise<void> {
    const profile = this.renderingProfileService.getImageProfile();
    const charAssets = assets.filter(a => a.assetType === 'character');
    const locAssets = assets.filter(a => a.assetType === 'location');
    const styleAssets = assets.filter(a => a.assetType === 'style_guide');
    const propAssets = assets.filter(a => a.assetType === 'prop');

    // ═══ Phase 1: face_front + 场景参考图（并发） ═══
    // 角色 portrait 前缀不含 colorGrading/lightingStyle（避免场景条件词污染中性背景）
    const charStylePrefix = this.buildAssetStylePrefix(visualStyle, 'character');
    const sceneStylePrefix = this.buildAssetStylePrefix(visualStyle, 'location');
    const assetStyleBucket = this.detectStyleBucket(visualStyle);
    const phase1Tasks = [
      ...charAssets.map(asset => async () => {
        if (this.cancelledDramas.has(dramaId)) return;
        const ch = characters.find(c => c.characterId === asset.refId);
        if (!ch?.faceReferencePrompt) return;
        try {
          this.logger.log(`[Phase1] face_front: ${ch.name}(${asset.refId})`);
          const faceRoute = this.imageRouter.routeCharacterFace(DramaService.CHAR_IMAGE_SIZE);
          // Phase 1 面部定妆照：补充年龄、发型、服饰、体型、背景和朝向 prompt
          // 始终从 age 字段推导（ageToT2IPhrase 取范围最小值），agePrompt 仅作兜底
          const agePhrase = ageToT2IPhrase((ch as any).age) || (ch as any).agePrompt?.trim() || '';
          const faceParts = [
            ch.faceReferencePrompt,
            agePhrase,
            ch.hairStylePrompt || ch.hairStyle,
            ch.defaultCostumePrompt ? `wearing ${ch.defaultCostumePrompt}` : '',
            (ch as any).bodyTypePrompt || (ch as any).bodyType,
            'front-facing, looking at camera, neutral plain background, character reference sheet portrait',
          ].filter(Boolean).join(', ');
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(faceParts, 'character', charStylePrefix, faceRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaService.CHAR_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'character_image', refId: asset.refId, userId,
            ...faceRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(asset, 'face_front', result.images[0].url);
            asset.referenceImageUrl = updated.referenceImageUrl;
            asset.referenceImages = updated.referenceImages;
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`face_front 失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
      ...locAssets.map(asset => async () => {
        if (this.cancelledDramas.has(dramaId)) return;
        const loc = locations.find(l => l.locationId === asset.refId);
        if (!loc?.visualPrompt) return;
        try {
          this.logger.log(`[Phase1] establishing: ${loc.name}(${asset.refId})`);
          const rawPrompt = buildLocationViewPrompt(loc, 'establishing');
          const locRoute = this.imageRouter.routeLocation(DramaService.SCENE_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt || loc.visualPrompt, 'location', sceneStylePrefix, locRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaService.SCENE_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'location_image', refId: asset.refId, userId,
            ...locRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(asset, 'establishing', result.images[0].url);
            asset.referenceImageUrl = updated.referenceImageUrl;
            asset.referenceImages = updated.referenceImages;
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`场景参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
      ...styleAssets.map(asset => async () => {
        if (this.cancelledDramas.has(dramaId)) return;
        const style = asset.data as Record<string, unknown>;
        // 优先使用视觉设计师生成的纯英文 styleReferencePrompt，避免中英混杂降低 T2I 质量
        const styleRefPrompt = String(style.styleReferencePrompt ?? '').trim();
        let rawPrompt: string;
        if (styleRefPrompt && !/[\u4e00-\u9fff]/.test(styleRefPrompt)) {
          // 使用纯英文的 styleReferencePrompt
          rawPrompt = `${styleRefPrompt}, concept art mood board, consistent style sheet`;
        } else {
          // 回退：从各字段中过滤出英文部分（移除中文）
          const parts = [
            String(style.overallAesthetic ?? ''),
            String(style.renderTechnique ?? ''),
            String(style.textureStyle ?? ''),
            String(style.colorGrading ?? ''),
            String(style.lightingStyle ?? ''),
            String(style.referenceStyle ?? ''),
          ].map(p => p.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufa2f]+/g, ' ').replace(/[，。！？、：；""''（）【】《》]/g, ' ').trim())
           .filter(Boolean);
          if (!parts.length) return;
          rawPrompt = `${parts.join(', ')}, concept art mood board, consistent style sheet`;
        }
        try {
          this.logger.log(`[Phase1] 风格参考图: ${asset.refId}`);
          const styleRoute = this.imageRouter.routeStyleGuide(DramaService.SCENE_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'style_guide', undefined, styleRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt,
            size: DramaService.SCENE_IMAGE_SIZE,
            count: 1,
            dramaId,
            assetType: 'style_guide_image',
            refId: asset.refId,
            userId,
            ...styleRoute,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            asset.referenceImages = [{ viewAngle: 'style_master', imageUrl: result.images[0].url }];
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`风格参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
      // Prop reference images (product-shot style, 1:1 square)
      // Note: NO style prefix — prop visualPrompt already specifies "white background, studio lighting"
      // which conflicts with drama's cinematic style prefix.
      ...propAssets.map(asset => async () => {
        if (this.cancelledDramas.has(dramaId)) return;
        const propData = asset.data as Record<string, unknown>;
        const rawPrompt = String(propData.visualPrompt ?? '').trim();
        if (!rawPrompt) return;
        try {
          this.logger.log(`[Phase1] prop: ${asset.name}(${asset.refId})`);
          const propRoute = this.imageRouter.routeLocation(DramaService.PROP_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'location', undefined, propRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaService.PROP_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'prop_image', refId: asset.refId, userId,
            ...propRoute,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            asset.referenceImages = [{ viewAngle: 'product_shot', imageUrl: result.images[0].url }];
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`道具参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
    ];
    await this.runConcurrent(phase1Tasks, 3);

    // ═══ Phase 2: 多角度链式生成（以 face_front 为参考图保持同一人脸） ═══
    const chainWeight = profile.characterViews.chainReferenceWeight;
    const phase2Tasks = charAssets.map(asset => async () => {
      if (this.cancelledDramas.has(dramaId)) return;
      if (!asset.referenceImageUrl) return;
      const ch = characters.find(c => c.characterId === asset.refId);
      if (!ch) return;
      const role = this.normalizeCharacterRole(ch.role);
      const requiredViews = profile.characterViews.viewsByRole[role] ?? ['face_front'];
      const extraViews = (requiredViews as readonly CharacterViewAngle[]).filter(v => v !== 'face_front');
      if (!extraViews.length) return;

      let images = [...(asset.referenceImages ?? [])];
      for (const viewAngle of extraViews) {
        if (this.cancelledDramas.has(dramaId)) break;
        try {
          const viewRoute = this.imageRouter.routeCharacterViewAngle(DramaService.CHAR_IMAGE_SIZE);
          const isI2IModel = viewRoute.provider?.startsWith('kieai.flux-2-i2i');
          // flux-2-i2i 使用变换帧式提示词：聚焦角度/姿态变换，不重复描述参考图已有的人脸信息
          // 其他模型使用标准描述帧式提示词，让模型自行处理参考图融合
          const rawViewPrompt = isI2IModel
            ? this.buildI2IViewAnglePrompt(ch, viewAngle)
            : buildViewAnglePrompt(ch, viewAngle);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawViewPrompt, 'character', charStylePrefix, viewRoute.provider, assetStyleBucket);
          const refImages = [{ url: asset.referenceImageUrl, weight: chainWeight }];
          this.logger.log(`[Phase2] ${viewAngle}: ${ch.name}(${asset.refId}) provider=${viewRoute.provider ?? 'default'}`);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaService.CHAR_IMAGE_SIZE, count: 1, referenceImages: refImages,
            dramaId, assetType: `character_${viewAngle}`, refId: asset.refId, userId,
            ...viewRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(
              { referenceImageUrl: asset.referenceImageUrl, referenceImages: images },
              viewAngle,
              result.images[0].url,
            );
            asset.referenceImageUrl = updated.referenceImageUrl;
            images = updated.referenceImages;
          }
        } catch (err) { this.logger.warn(`${viewAngle} 失败: ${asset.refId} — ${(err as Error).message}`); }
      }
      asset.referenceImages = images;
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: asset.referenceImageUrl,
        referenceImages: images,
      });
      this.logger.log(`${ch.name} 多角度完成: ${images.filter(i => !!i.imageUrl).map(i => i.viewAngle).join(', ')}`);
    });
    await this.runConcurrent(phase2Tasks, 3);

    // ═══ Phase 2b: 场景多角度链式生成（以 establishing 为参考图保持空间一致） ═══
    const locChainWeight = profile.locationViews.chainReferenceWeight;
    const phase2bTasks = locAssets.map(asset => async () => {
      if (this.cancelledDramas.has(dramaId)) return;
      if (!asset.referenceImageUrl) return;
      const loc = locations.find(l => l.locationId === asset.refId);
      if (!loc) return;
      const requiredViews = loc.isRecurring
        ? profile.locationViews.recurring
        : profile.locationViews.normal;
      const extraViews = (requiredViews as readonly LocationViewAngle[]).filter(v => v !== 'establishing');
      if (!extraViews.length) return;

      let images = [...(asset.referenceImages ?? [])];
      for (const viewAngle of extraViews) {
        if (this.cancelledDramas.has(dramaId)) break;
        try {
          const rawPrompt = buildLocationViewPrompt(loc, viewAngle);
          if (!rawPrompt) continue;
          const locRoute = this.imageRouter.routeLocation(DramaService.SCENE_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'location', sceneStylePrefix, locRoute.provider, assetStyleBucket);
          const refImages = [{ url: asset.referenceImageUrl, weight: locChainWeight }];
          this.logger.log(`[Phase2b] ${viewAngle}: ${loc.name}(${asset.refId})`);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaService.SCENE_IMAGE_SIZE, count: 1, referenceImages: refImages,
            dramaId, assetType: `location_${viewAngle}`, refId: asset.refId, userId,
            ...locRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(
              { referenceImageUrl: asset.referenceImageUrl, referenceImages: images },
              viewAngle,
              result.images[0].url,
            );
            asset.referenceImageUrl = updated.referenceImageUrl;
            images = updated.referenceImages;
          }
        } catch (err) { this.logger.warn(`场景 ${viewAngle} 失败: ${asset.refId} — ${(err as Error).message}`); }
      }
      asset.referenceImages = images;
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: asset.referenceImageUrl,
        referenceImages: images,
      });
      this.logger.log(`${loc.name} 多角度完成: ${images.filter(i => !!i.imageUrl).map(i => i.viewAngle).join(', ')}`);
    });
    await this.runConcurrent(phase2bTasks, 3);

    // ═══ Phase 3: 角色外观变体参考图 ═══
    await this.generateVariationImages(dramaId, characters, charStylePrefix, assetStyleBucket, userId);
  }

  /** 为角色外观变体生成参考图（以 face_front 为参考保持面部一致） */
  private async generateVariationImages(dramaId: string, characters: DramaState['characters'], stylePrefix?: string, styleBucket?: string, userId?: string): Promise<void> {
    const baseAssets = await this.visualAssetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    const baseMap = new Map(baseAssets.filter(a => a.referenceImageUrl).map(a => [a.refId, a.referenceImageUrl]));
    const assetByRefId = new Map(baseAssets.map(a => [a.refId, a]));
    for (const ch of characters) {
      if (this.cancelledDramas.has(dramaId)) break;
      if (!ch.variations?.length) continue;
      const asset = assetByRefId.get(ch.characterId);
      const baseImg = baseMap.get(ch.characterId);

      // 从 asset.data.variations 同步已持久化的 URL 回 in-memory，确保跳过逻辑正确
      // （drama.state.characters 不含变体图 URL，只有 asset.data 才是持久化的 source of truth）
      const persistedVariations = ((asset?.data as any)?.variations ?? []) as Array<{ variationId: string; referenceImageUrl?: string }>;
      const persistedUrlMap = new Map(persistedVariations.filter(v => v.referenceImageUrl).map(v => [v.variationId, v.referenceImageUrl!]));
      for (const v of ch.variations) {
        if (!v.referenceImageUrl && persistedUrlMap.has(v.variationId)) {
          v.referenceImageUrl = persistedUrlMap.get(v.variationId);
        }
      }

      let anyUpdated = false;
      for (const v of ch.variations) {
        if (this.cancelledDramas.has(dramaId)) break;
        if (v.referenceImageUrl) continue;
        try {
          const refImages = baseImg ? [{ url: baseImg, weight: 0.6 }] : [];
          // 变体 prompt：面部 + 发型 + 体型作为身份锚点，visualPromptOverride 只描述变化点（服饰/状态）
          const rawPrompt = [
            ch.faceReferencePrompt,
            ch.hairStylePrompt || ch.hairStyle,
            ch.bodyTypePrompt || ch.bodyType,
            v.visualPromptOverride,
            'same person as reference',
          ].filter(Boolean).join(', ');
          // flux-2-i2i: 最擅长受控的服装/外观变换（maintain identity, change outfit）
          const varRoute = this.imageRouter.routeCharacterVariation(DramaService.CHAR_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'character', stylePrefix, varRoute.provider, styleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt,
            size: DramaService.CHAR_IMAGE_SIZE, count: 1, referenceImages: refImages,
            dramaId, assetType: 'character_variation', refId: `${ch.characterId}_${v.variationId}`, userId,
            ...varRoute,
          });
          if (result.images?.[0]?.url) {
            v.referenceImageUrl = result.images[0].url;
            anyUpdated = true;
          }
          this.logger.log(`变体参考图完成: ${ch.characterId}/${v.variationId}`);
        } catch (err) { this.logger.warn(`变体参考图失败: ${ch.characterId}/${v.variationId} — ${(err as Error).message}`); }
      }
      // 持久化：将含最新 referenceImageUrl 的 variations 写回 asset.data
      if (anyUpdated && asset) {
        const updatedData = { ...(asset.data as Record<string, unknown>), variations: ch.variations };
        await this.visualAssetRepo.update(asset.id, { data: updatedData });
      }
    }
  }

  /** 重新生成单个角色外观变体参考图 */
  async regenerateVariationImage(
    dramaId: string,
    assetId: string,
    variationId: string,
    userId?: string,
  ): Promise<VisualAssetEntity> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    if (asset.assetType !== 'character') throw new Error('仅角色资产支持变体重生');

    const charData = asset.data as Record<string, unknown>;
    const variations = (charData.variations ?? []) as Array<Record<string, unknown>>;
    const variation = variations.find((v) => v.variationId === variationId);
    if (!variation) throw new NotFoundException(`变体 ${variationId} 不存在`);

    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    const vs = (drama?.state as any)?.visualStyle as DramaState['visualStyle'] | undefined;
    const stylePrefix = this.buildAssetStylePrefix(vs, 'character');
    const styleBucket = this.detectStyleBucket(vs);

    const baseImg = asset.referenceImageUrl;
    const refImages = baseImg ? [{ url: baseImg, weight: 0.6 }] : [];

    const rawPrompt = [
      String(charData.faceReferencePrompt ?? ''),
      String(charData.hairStylePrompt ?? charData.hairStyle ?? ''),
      String(charData.bodyTypePrompt ?? charData.bodyType ?? ''),
      String(variation.visualPromptOverride ?? ''),
      'same person as reference',
    ].filter(Boolean).join(', ');

    const varRoute = this.imageRouter.routeCharacterVariation(DramaService.CHAR_IMAGE_SIZE);
    const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'character', stylePrefix, varRoute.provider, styleBucket);

    const result = await this.mediaService.generateImage({
      prompt, negativePrompt,
      size: DramaService.CHAR_IMAGE_SIZE, count: 1, referenceImages: refImages,
      dramaId, assetType: 'character_variation', refId: `${charData.characterId}_${variationId}`, userId,
      ...varRoute,
    });

    const imageUrl = result.images?.[0]?.url ?? '';
    if (!imageUrl) throw new Error('变体图片生成结果为空');

    variation.referenceImageUrl = imageUrl;
    const updatedData = { ...charData, variations };
    await this.visualAssetRepo.update(asset.id, { data: updatedData });
    this.logger.log(`变体参考图重生完成: ${charData.characterId}/${variationId}`);

    return (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
  }

  private normalizeCharacterViewAngle(viewAngle?: string): CharacterViewAngle {
    const v = String(viewAngle ?? '').trim();
    return (CHARACTER_VIEW_ANGLES as readonly string[]).includes(v) ? (v as CharacterViewAngle) : 'face_front';
  }

  private normalizeLocationViewAngle(viewAngle?: string): LocationViewAngle {
    const v = String(viewAngle ?? '').trim();
    return (LOCATION_VIEW_ANGLES as readonly string[]).includes(v) ? (v as LocationViewAngle) : 'establishing';
  }

  private normalizeRefineScope(scope?: string): RefineSyncScope {
    if (scope === 'single' || scope === 'group' || scope === 'all') return scope;
    return 'group';
  }

  private normalizeRefineStrength(strength?: string): RefineStrength {
    if (strength === 'light' || strength === 'balanced' || strength === 'strong') return strength;
    return 'balanced';
  }

  private resolveRefineStrengthHint(strength: RefineStrength): string {
    if (strength === 'light') return 'small conservative adjustment, keep identity and composition stable';
    if (strength === 'strong') return 'large visual change allowed, still keep core identity';
    return 'balanced adjustment on target elements, keep key identity consistent';
  }

  private resolveCharacterSizeByView(viewAngle: CharacterViewAngle): string {
    if (viewAngle === 'full_body_front' || viewAngle === 'back_view') return '9:16';
    return DramaService.CHAR_IMAGE_SIZE;
  }

  private resolveAssetPrompt(asset: VisualAssetEntity, viewAngle?: string): string {
    const data = (asset.data ?? {}) as Record<string, unknown>;
    if (asset.assetType === 'character') {
      const fallback = String(data.faceReferencePrompt || '').trim();
      try {
        return buildViewAnglePrompt(data as any, (viewAngle ?? 'face_front') as CharacterViewAngle) || fallback;
      } catch {
        return fallback;
      }
    }
    if (asset.assetType === 'location') {
      const locView = this.normalizeLocationViewAngle(viewAngle);
      const locPrompt = buildLocationViewPrompt(data as any, locView);
      return locPrompt || String(data.visualPrompt || '').trim();
    }
    if (asset.assetType === 'prop') {
      return String(data.visualPrompt || '').trim();
    }
    return [
      String(data.overallAesthetic ?? ''),
      String(data.renderTechnique ?? ''),
      String(data.textureStyle ?? ''),
      String(data.colorGrading ?? ''),
      String(data.lightingStyle ?? ''),
      String(data.referenceStyle ?? ''),
    ].map((p) => p.trim()).filter(Boolean).join(', ');
  }

  private collectAssetRefs(asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages'>): Array<{ url: string; weight: number }> {
    const refs: Array<{ url: string; weight: number }> = [];
    if (asset.referenceImageUrl) refs.push({ url: asset.referenceImageUrl, weight: 0.6 });
    for (const ref of asset.referenceImages ?? []) {
      if (!ref?.imageUrl) continue;
      if (refs.some((item) => item.url === ref.imageUrl)) continue;
      refs.push({ url: ref.imageUrl, weight: 0.5 });
      if (refs.length >= 3) break;
    }
    return refs;
  }

  private upsertReferenceByView(
    asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages'>,
    viewAngle: string,
    imageUrl: string,
  ): { referenceImageUrl: string; referenceImages: Array<{ viewAngle: string; imageUrl: string }> } {
    const nextRefImages = [...(asset.referenceImages ?? [])];
    const idx = nextRefImages.findIndex((item) => item.viewAngle === viewAngle);
    if (idx >= 0) nextRefImages[idx] = { viewAngle, imageUrl };
    else nextRefImages.push({ viewAngle, imageUrl });
    // 主 URL 取 face_front（角色）或 establishing（场景），不存在则保留原值
    const primaryView = nextRefImages.find((item) => item.viewAngle === 'face_front')?.imageUrl
      || nextRefImages.find((item) => item.viewAngle === 'establishing')?.imageUrl;
    const isPrimaryView = viewAngle === 'face_front' || viewAngle === 'establishing';
    const nextPrimary = isPrimaryView ? imageUrl : (primaryView || asset.referenceImageUrl || imageUrl);
    return { referenceImageUrl: nextPrimary, referenceImages: nextRefImages };
  }

  private resolveAffectedCharacterViews(targetView: CharacterViewAngle, scope: RefineSyncScope): CharacterViewAngle[] {
    if (scope === 'single') return [targetView];
    if (scope === 'all' || targetView === 'face_front') {
      return [...CHARACTER_VIEW_ANGLES];
    }
    const faceGroup: CharacterViewAngle[] = ['face_three_quarter', 'side_profile', 'back_view'];
    const framingGroup: CharacterViewAngle[] = ['upper_body_front', 'full_body_front'];
    if (faceGroup.includes(targetView)) {
      return faceGroup;
    }
    if (framingGroup.includes(targetView)) {
      return framingGroup;
    }
    return [targetView];
  }

  /**
   * 批量生成一个短剧的所有参考图（角色定妆照 + 场景图 + 风格图）。
   * 供创建完成后、工作台手动触发，不阻塞创建流程。
   */
  async generateAllVisualAssets(dramaId: string, userId?: string): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    if (!state?.characters?.length) throw new Error(`短剧 ${dramaId} 尚未完成创建，无法生成参考图`);
    const assets = await this.visualAssetRepo.find({ where: { dramaId } });
    await this.generateReferenceImages(dramaId, assets, state.characters, state.locations ?? [], state.visualStyle, userId);
    await this.refreshVisualBible(dramaId);
  }

  /** 从 DB 重新加载最新资产图片 URL，刷新 drama.state.visualBible */
  private async refreshVisualBible(dramaId: string): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const assets = await this.visualAssetRepo.find({ where: { dramaId } });
    state.visualBible = this.buildVisualBible(state.characters, state.visualStyle, state.promptProfile, assets);
    drama.state = state as unknown as Record<string, unknown>;
    await this.dramaRepo.save(drama);
  }

  /** 重新生成单个视觉资产的参考图（角色/场景均支持按视角重生） */
  async regenerateAssetImage(
    dramaId: string,
    assetId: string,
    userId?: string,
    opts?: { viewAngle?: string },
  ): Promise<VisualAssetEntity> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    const isChar = asset.assetType === 'character';
    const isLoc = asset.assetType === 'location';
    const isProp = asset.assetType === 'prop';
    const targetView = isChar
      ? this.normalizeCharacterViewAngle(opts?.viewAngle)
      : isLoc
        ? this.normalizeLocationViewAngle(opts?.viewAngle)
        : isProp
          ? 'product_shot'
          : 'establishing';
    const prompt = this.resolveAssetPrompt(asset, targetView);
    if (!prompt) throw new Error(`资产 ${assetId} 缺少生成提示词`);
    const size = isChar
      ? this.resolveCharacterSizeByView(targetView as CharacterViewAngle)
      : isProp
        ? DramaService.PROP_IMAGE_SIZE
        : DramaService.SCENE_IMAGE_SIZE;
    const nonCharShotType = asset.assetType === 'style_guide' ? 'style_guide' : 'location';
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    const regenStyleBucket = this.detectStyleBucket((drama?.state as any)?.visualStyle);
    // 按资产类型选择最优模型路由
    const route = isChar
      ? (targetView === 'face_front'
        ? this.imageRouter.routeCharacterFace(size)
        : this.imageRouter.routeCharacterViewAngle(size))
      : (isLoc || isProp)
        ? this.imageRouter.routeLocation(size)
        : {};
    const optimized = this.optimizeAssetPrompt(prompt, isChar ? 'character' : nonCharShotType, undefined, route.provider, regenStyleBucket);
    // 主视角/道具：从零生成，不传参考图
    const isPrimaryView = (isChar && targetView === 'face_front') || (isLoc && targetView === 'establishing') || isProp;
    const refs = isPrimaryView ? [] : this.collectAssetRefs(asset);
    const result = await this.mediaService.generateImage({
      prompt: optimized.prompt,
      negativePrompt: optimized.negativePrompt,
      size,
      count: 1,
      referenceImages: refs,
      dramaId,
      assetType: `${asset.assetType}_image`,
      refId: asset.refId,
      userId,
      ...route,
    });
    const imageUrl = result.images?.[0]?.url ?? '';
    if (!imageUrl) throw new Error('重新生成结果为空');
    if (isChar) {
      const baseRefs = this.buildCharacterReferenceSlots(
        asset.data as DramaState['characters'][number],
        asset,
      );
      const updated = this.upsertReferenceByView(
        { referenceImageUrl: asset.referenceImageUrl, referenceImages: baseRefs },
        targetView,
        imageUrl,
      );
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: updated.referenceImageUrl,
        referenceImages: updated.referenceImages,
      });
    } else if (isLoc) {
      const locData = asset.data as DramaState['locations'][number];
      const baseRefs = this.buildLocationReferenceSlots(locData, asset);
      const updated = this.upsertReferenceByView(
        { referenceImageUrl: asset.referenceImageUrl, referenceImages: baseRefs },
        targetView,
        imageUrl,
      );
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: updated.referenceImageUrl,
        referenceImages: updated.referenceImages,
      });
    } else if (isProp) {
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: imageUrl,
        referenceImages: [{ viewAngle: 'product_shot', imageUrl }],
      });
    } else {
      await this.visualAssetRepo.update(asset.id, { referenceImageUrl: imageUrl });
    }
    const refreshed = (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
    // 后台异步刷新 visualBible，确保集数生成时能引用最新角色参考图（不阻塞响应）
    setImmediate(() => this.refreshVisualBible(dramaId).catch((e) => this.logger.warn(`refreshVisualBible failed: ${e?.message}`)));
    return refreshed;
  }

  /** 图生图精修：支持按视角与同步范围进行角色联动 */
  async refineAssetImage(
    dramaId: string,
    assetId: string,
    input: {
      instruction: string;
      viewAngle?: string;
      syncScope?: RefineSyncScope;
      strength?: RefineStrength;
      preserveIdentity?: boolean;
      userId?: string;
    },
  ): Promise<{ asset: VisualAssetEntity; affectedViews: string[] }> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    const instruction = String(input.instruction || '').trim();
    if (!instruction) throw new Error('请输入修改要求');
    const regenStyleBucket = this.detectStyleBucket(
      ((await this.dramaRepo.findOne({ where: { id: dramaId } }))?.state as any)?.visualStyle,
    );
    const isChar = asset.assetType === 'character';
    const isLoc = asset.assetType === 'location';
    const isProp = asset.assetType === 'prop';
    const targetView = isChar
      ? this.normalizeCharacterViewAngle(input.viewAngle)
      : isLoc
        ? this.normalizeLocationViewAngle(input.viewAngle)
        : isProp
          ? 'product_shot'
          : 'establishing';
    const syncScope = this.normalizeRefineScope(input.syncScope);
    const strength = this.normalizeRefineStrength(input.strength);
    const preserveIdentity = input.preserveIdentity ?? true;
    const strengthHint = this.resolveRefineStrengthHint(strength);
    // Props have only one view (product_shot), no multi-view sync needed
    const affectedViews = isChar
      ? this.resolveAffectedCharacterViews(targetView as CharacterViewAngle, syncScope)
      : [targetView];
    const targetViews = affectedViews;
    let nextPrimary = asset.referenceImageUrl;
    let nextRefs = [...(asset.referenceImages ?? [])];
    let successCount = 0;

    for (const view of targetViews) {
      const basePrompt = this.resolveAssetPrompt({
        ...asset,
        referenceImageUrl: nextPrimary,
        referenceImages: nextRefs,
      } as VisualAssetEntity, view);
      if (!basePrompt) continue;
      const identityHint = isChar && preserveIdentity ? 'keep same identity, face structure, hairstyle and body profile' : '';
      const locationHint = isLoc ? 'keep same location, maintain spatial layout and architectural details' : '';
      const propHint = isProp ? 'keep same object, maintain shape and material details' : '';
      const prompt = [
        basePrompt,
        instruction,
        strengthHint,
        identityHint,
        locationHint,
        propHint,
      ].filter(Boolean).join(', ');
      const refineSize = isChar
        ? this.resolveCharacterSizeByView(view as CharacterViewAngle)
        : isProp
          ? DramaService.PROP_IMAGE_SIZE
          : DramaService.SCENE_IMAGE_SIZE;
      const refineRoute = this.imageRouter.routeRefinement(refineSize);
      const refineShotType = isChar ? 'character' : (asset.assetType === 'style_guide' ? 'style_guide' : 'location');
      const optimized = this.optimizeAssetPrompt(prompt, refineShotType, undefined, refineRoute.provider, regenStyleBucket);
      const refs = this.collectAssetRefs({ referenceImageUrl: nextPrimary, referenceImages: nextRefs });
      const result = await this.mediaService.generateImage({
        prompt: optimized.prompt,
        negativePrompt: optimized.negativePrompt,
        size: refineSize,
        count: 1,
        referenceImages: refs,
        dramaId,
        assetType: `${asset.assetType}_refine`,
        refId: asset.refId,
        userId: input.userId,
        ...refineRoute,
      });
      const imageUrl = result.images?.[0]?.url ?? '';
      if (!imageUrl) continue;
      successCount += 1;
      if (isChar || isLoc) {
        const viewUpdated = this.upsertReferenceByView({ referenceImageUrl: nextPrimary, referenceImages: nextRefs }, view, imageUrl);
        nextPrimary = viewUpdated.referenceImageUrl;
        nextRefs = viewUpdated.referenceImages;
      } else if (isProp) {
        nextPrimary = imageUrl;
        nextRefs = [{ viewAngle: 'product_shot', imageUrl }];
      } else {
        nextPrimary = imageUrl;
      }
    }

    if (!successCount) throw new Error('精修失败，未产出图片');
    await this.visualAssetRepo.update(asset.id, {
      referenceImageUrl: nextPrimary,
      ...((isChar || isLoc || isProp) ? { referenceImages: nextRefs } : {}),
    });
    const updated = (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
    // 后台异步刷新 visualBible，确保集数生成时能引用最新角色参考图（不阻塞响应）
    setImmediate(() => this.refreshVisualBible(dramaId).catch((e) => this.logger.warn(`refreshVisualBible failed: ${e?.message}`)));
    return { asset: updated, affectedViews };
  }

  private buildVisualBible(
    characters: DramaState['characters'],
    visualStyle: DramaState['visualStyle'] | undefined,
    promptProfile: DramaState['promptProfile'] | undefined,
    visualAssets: Array<Partial<VisualAssetEntity>>,
  ): NonNullable<DramaState['visualBible']> {
    const charAssetMap = new Map(
      visualAssets
        .filter((a) => a.assetType === 'character' && a.refId)
        .map((a) => [a.refId!, a]),
    );
    const locAssetMap = new Map(
      visualAssets
        .filter((a) => a.assetType === 'location' && a.refId)
        .map((a) => [a.refId!, a]),
    );
    const styleAsset = visualAssets.find((a) => a.assetType === 'style_guide');

    const identityPack = (characters ?? []).map((c) => {
      const asset = charAssetMap.get(c.characterId);
      const refs = Array.isArray(asset?.referenceImages) ? asset!.referenceImages! : [];
      const faceFront = refs.find((r) => r.viewAngle === 'face_front')?.imageUrl || asset?.referenceImageUrl || '';
      const face34 = refs.find((r) => r.viewAngle === 'face_three_quarter')?.imageUrl || '';
      const upperOrFull = refs.find((r) => r.viewAngle === 'upper_body_front')?.imageUrl
        || refs.find((r) => r.viewAngle === 'full_body_front')?.imageUrl
        || '';
      return {
        characterId: c.characterId,
        faceDna: c.faceDescription,
        anchorImages: { faceFront, face34, upperOrFull },
        variationPolicy: c.variations?.length
          ? `allow:${c.variations.map(v => v.variationId).join(',')}`
          : 'allow:default_only',
      };
    });

    const styleTokens = [
      visualStyle?.overallAesthetic,
      visualStyle?.renderTechnique,
      visualStyle?.textureStyle,
      visualStyle?.colorGrading,
      visualStyle?.lightingStyle,
      visualStyle?.referenceStyle,
    ].filter(Boolean) as string[];

    const styleRefImages = [
      styleAsset?.referenceImageUrl ?? '',
      ...(Array.isArray(styleAsset?.referenceImages) ? styleAsset!.referenceImages!.map((r) => r.imageUrl) : []),
    ].filter(Boolean);

    const preferredAngles = promptProfile?.cameraStyleGuide?.preferredAngles ?? [];
    const movementPolicy = promptProfile?.cameraStyleGuide?.signatureTechniques ?? [];
    const transitionStyle = promptProfile?.cameraStyleGuide?.transitionStyle
      ? [promptProfile.cameraStyleGuide.transitionStyle]
      : [];

    const scenePack = Array.from(locAssetMap.entries()).map(([locationId, asset]) => {
      const refs = Array.isArray(asset?.referenceImages) ? asset!.referenceImages! : [];
      return {
        locationId,
        anchorImages: {
          establishing: refs.find((r) => r.viewAngle === 'establishing')?.imageUrl || asset?.referenceImageUrl || '',
          interiorMedium: refs.find((r) => r.viewAngle === 'interior_medium')?.imageUrl || '',
          detailClose: refs.find((r) => r.viewAngle === 'detail_close')?.imageUrl || '',
        },
      };
    });

    return {
      version: `vb_${Date.now()}`,
      identityPack,
      scenePack,
      stylePack: {
        styleTokens,
        styleRefImages,
        colorLutHint: visualStyle?.colorGrading ?? '',
      },
      cameraPack: {
        preferredAngles,
        movementPolicy: [...movementPolicy, ...transitionStyle],
        continuityRules: [
          'same_scene_keep_axis',
          'avoid_abrupt_scale_jump',
          'emotion_peak_allow_fast_motion_only',
        ],
      },
    };
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
    strategy?: any; seed?: any; profile?: any;
  }): string {
    const { ga, guide, reviewerCalibration, visualStyle, strategy, seed, profile } = ctx;
    switch (nodeId) {
      // ── 创建阶段 Agent（全局 AI 指令页面使用）──
      case 'seed-analyzer':
        return buildSeedAnalyzerSystemPrompt({ epMin: 60, epMax: 100, durSec: 180 });
      case 'series-director':
        return buildSeriesDirectorSystemPrompt({ targetEp: 80, epMin: 60, epMax: 100, durSec: 180 });
      case 'visual-asset-designer':
        return buildVisualAssetDesignerSystemPrompt();
      case 'drama-profiler':
        return buildProfilerSystemPrompt();
      case 'drama-strategy':
        return buildStrategySystemPrompt();
      // ── 集内容生成 Agent（创作工坊中按剧配置）──
      case 'arc-director':
        return buildArcDirectorSystemPrompt({ genreRules: guide?.genreRules });
      case 'episode-director':
        return buildEpisodeDirectorSystemPrompt({
          maxPresentPerEpisode: strategy?.characterBudget?.maxPresentPerEpisode,
          genreArchetype: ga,
          visualStyle: visualStyle ?? undefined,
          genreRules: guide?.genreRules,
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
        return buildStoryboardDirectorSystemPrompt({
          maxShots: 15,
          targetDur: seed?.targetEpisodeDurationSec ?? 180,
          visualStyle: visualStyle ?? undefined,
          camGuide: profile?.cameraStyleGuide,
        });
      case 'audio-director':
        return buildAudioDirectorSystemPrompt({ audioGuide: profile?.audioGuide });
      case 'deterministic-checker':
        return '硬规则校验器（非 LLM）— 执行确定性规则：镜头时长合规（每 Shot 不超过目标时长）、必填字段完整性、安全内容过滤。此节点不调用大模型，无系统提示词。';
      case 'script-reviewer':
        return buildScriptReviewerSystemPrompt({ dialogueGuide: guide?.dialogueGuide });
      case 'script-editor':
        return buildScriptEditorSystemPrompt({ dialogueGuide: guide?.dialogueGuide });
      case 'pacing-analyzer':
        return buildPacingAnalyzerSystemPrompt({ genreArchetype: ga, genreRules: guide?.genreRules });
      case 'hook-crafter':
        return buildHookCrafterSystemPrompt({ genreRules: guide?.genreRules, genreArchetype: ga });
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
    if (this.generatingDramas.has(dramaId)) {
      throw new Error('该短剧正在生成中，请先暂停后再删除');
    }

    // 1. 清除内存状态（进度追踪 / 暂停标记）
    this.cancelledDramas.add(dramaId);
    this.pausedDramas.delete(dramaId);
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

    this.logger.log(`短剧已完整删除 dramaId=${dramaId}`);
    setTimeout(() => this.cancelledDramas.delete(dramaId), 5 * 60 * 1000);
    return { success: true };
  }

  private async purgeQueueJobs(dramaId: string): Promise<void> {
    for (const queue of [this.textQueue, this.imageQueue, this.videoQueue, this.voiceQueue]) {
      try {
        const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
        for (const job of waiting) {
          if (job.data?.dramaId === dramaId) {
            await job.remove().catch(() => {});
          }
        }
      } catch (err) {
        this.logger.warn(`清理队列 ${queue.name} 中 dramaId=${dramaId} 的任务失败: ${(err as Error).message}`);
      }
    }
  }

  /** 异步启动逐集生成（含并发互斥），立即返回任务信息 */
  async generateEpisodes(dramaId: string): Promise<{ message: string; startEp: number; endEp: number }> {
    this.pausedDramas.delete(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId);
    this.runEpisodePipeline(dramaId, startEp, endEp).catch(err =>
      this.logger.error(`逐集生成失败 dramaId=${dramaId} E${startEp}-E${endEp}: ${err.message}`),
    ).finally(() => { this.generatingDramas.delete(dramaId); });
    return { message: `已启动 ${endEp - startEp + 1} 集生成（E${startEp}-E${endEp}）`, startEp, endEp };
  }

  /** 逐集生成并等待完成（供 SSE 使用，可推送进度） */
  async generateEpisodesAndWait(dramaId: string): Promise<{ message: string; startEp: number; endEp: number; paused: boolean }> {
    this.pausedDramas.delete(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId);
    try {
      const wasPaused = await this.runEpisodePipeline(dramaId, startEp, endEp);
      return { message: wasPaused ? '已暂停' : `E${startEp}-E${endEp} 全部完成`, startEp, endEp, paused: wasPaused };
    } finally {
      this.generatingDramas.delete(dramaId);
    }
  }

  private async prepareGenerateEpisodes(dramaId: string): Promise<{ startEp: number; endEp: number }> {
    if (this.generatingDramas.has(dramaId)) throw new Error('该短剧正在生成中，请勿重复提交');
    const drama = await this.getDrama(dramaId);
    const state = drama.state as unknown as DramaState;
    const creationStatus = (state as any)?._status;
    if (creationStatus === 'creating') throw new Error('短剧仍在创建中，请等待创建完成后再生成集数');
    if (creationStatus === 'failed') throw new Error('短剧创建失败，请调用重试接口（retryCreation）后再生成集数');
    const rawCursor = state?.episodeCursor;
    const startEp = Number.isFinite(rawCursor) && rawCursor >= 1 ? rawCursor : Math.max(1, (drama.episodesGenerated ?? 0) + 1);
    const endEp = startEp;
    this.logger.log(`开始生成 E${startEp} — dramaId: ${dramaId}`);
    this.generatingDramas.add(dramaId);
    return { startEp, endEp };
  }

  /** 后台逐集串行执行（确保上下文正确传递），返回 true 表示被暂停 */
  private async runEpisodePipeline(dramaId: string, startEp: number, endEp: number): Promise<boolean> {
    try {
      for (let ep = startEp; ep <= endEp; ep++) {
        if (this.pausedDramas.has(dramaId)) {
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

  pauseGeneration(dramaId: string): boolean {
    if (!this.generatingDramas.has(dramaId)) return false;
    this.pausedDramas.add(dramaId);
    this.logger.log(`暂停请求已标记 dramaId=${dramaId}`);
    return true;
  }

  resumeGeneration(dramaId: string): void {
    this.pausedDramas.delete(dramaId);
  }

  isGenerationPaused(dramaId: string): boolean {
    return this.pausedDramas.has(dramaId);
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
    return this.mediaOrchestrator.generateEpisodeImages(dramaId, episodeNumber);
  }

  async generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
    return this.mediaOrchestrator.generateShotImage(dramaId, episodeNumber, shotId);
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

  async enhanceIdea(rawIdea: string, genre?: string, userId?: string) {
    return this.llm.generateStructured({
      taskName: 'drama-idea-enhancer',
      schema: z.object({ enhanced: z.string(), highlights: z.array(z.string()).min(2).max(5) }),
      tags: ['setup', 'drama-idea'],
      metadata: { userId },
      systemPrompt: `你是一位顶尖短剧策划编辑，擅长把粗糙的创意打磨成让观众一眼上头的短剧概念。

=== 核心理念 ===
所有创意最终都将制作成"短剧"——有角色、有对白、有戏剧冲突的竖屏微剧集。
无论素材是虚构故事、历史人物、神话传说还是科幻设定，美化方向都是"如何让它成为一部好看的剧"。

=== 美化原则 ===
1. 冲突前置：埋入核心矛盾和身份反差，产生"接下来会怎样"的好奇。
2. 角色驱动：赋予主角有趣的困境或身份反差，让观众代入。
3. 爽点/情感钩子明确：突出让观众上头的核心体验（打脸逆袭/命运震撼/身份反转/甜蜜暴击/认知颠覆等）。
4. 视觉化：描述要有画面感——观众能想象出具体的场景和冲突。

=== 题材适配 ===
- 霸总/甜宠/复仇/重生等：聚焦爽点反转、冲突升级、身份反差。
- 传记剧（真实人物）：以人物视角演绎传奇一生，聚焦命运转折和人性抉择。保留历史框架，但以戏剧手法呈现（如李白醉酒对峙杨国忠，而非旁白介绍李白生平）。
- 历史剧：以特定历史事件/时代为背景的权谋/战争/命运剧，聚焦人物在历史洪流中的抗争。
- 神话传说：就是奇幻短剧，突出瑰丽想象和角色魅力（哪吒闹海、孙悟空大闹天宫本身就是好剧本）。
- 科幻：聚焦未来世界的人性困境和高概念冲突。

=== 通用约束 ===
- 文案质感：简短有力、节奏紧凑，控制在100-200字。
- 忠于原意：保留核心方向和情感基调，润色而非改写。
- 适度原则：如果原始创意已足够精彩，微调即可。`,
      userPrompt: `原始创意：\n${rawIdea}${genre ? `\n题材方向：${genre}` : ''}\n\n请将这个创意美化为一个有吸引力的短剧概念。输出美化后的创意和 2-5 个核心卖点（highlights 应体现让观众追看的核心驱动力）。`,
      temperature: 0.75,
    });
  }

  async recommendGenreAndAudience(mainIdea: string, userId?: string) {
    const GENRE_OPTS = ['霸总', '甜宠', '战神', '穿越', '宫斗', '复仇', '重生', '悬疑', '都市', '古装', '传记剧', '神话传说', '历史剧', '科幻'] as const;
    const PLATFORM_OPTS = ['douyin', 'kuaishou', 'hongguo', 'wechat_mini', 'bilibili', 'tencent_video', 'mango_tv', 'iqiyi', 'reelshort', 'dramabox', 'generic'] as const;
    const AUDIENCE_OPTS = ['18-30 岁女性', '18-30 岁男性', '25-40 岁女性', '全年龄'] as const;
    const FOCUS_OPTS = ['female_lead', 'male_lead', 'dual_lead', 'ensemble'] as const;
    const VISUAL_STYLE_OPTS = [
      '3d_fantasy', '3d_british', '3d_chibi', '3d_realistic', '3d_voxel', '3d_mobile_game', '3d_toon_render', '3d_japanese_npr', '3d_cyberpunk', '3d_disney',
      '2d_anime', '2d_film', '2d_fantasy_anime', '2d_retro_anime', '2d_british_anime', '2d_ghibli', '2d_korean_anime', '2d_action', '2d_cybercity', '2d_sports', '2d_tezuka', '2d_thick_line', '2d_death_note', '2d_shoujo', '2d_horror', '2d_chibi',
      'chinese_ink', 'chinese_style', '2d_gongbi', '2d_watercolor', '2d_pixel', '2d_simple', '2d_sketch', '2d_british_comic', '2d_rubber_hose', '2d_golden',
      'live_action', 'period_live', 'hk_film', 'retro_wuxia', 'western_film',
      'stop_motion', 'clay_stop', 'lego_stop', 'felt_stop', 'paper_stop',
    ] as const;
    const ASPECT_RATIO_OPTS = ['9:16', '16:9'] as const;
    const DURATION_OPTS = [120, 180, 300] as const;
    const SCALE_OPTS = [
      { min: 40, max: 60 },
      { min: 60, max: 100 },
      { min: 100, max: 150 },
    ];
    return this.llm.generateStructured({
      taskName: 'drama-genre-audience-recommender',
      metadata: { userId },
      schema: z.object({
        genreDisplayName: z.enum(GENRE_OPTS),
        platformTarget: z.enum(PLATFORM_OPTS),
        targetAudience: z.enum(AUDIENCE_OPTS),
        protagonistFocus: z.enum(FOCUS_OPTS),
        suggestedVisualStyle: z.enum(VISUAL_STYLE_OPTS),
        aspectRatio: z.enum(ASPECT_RATIO_OPTS),
        targetEpisodeDurationSec: z.number().int(),
        plannedEpisodes: z.object({ min: z.number().int(), max: z.number().int() }),
        reason: z.string().optional(),
      }),
      tags: ['setup', 'drama-recommend'],
      systemPrompt: `你是一位资深短剧策划，根据用户的核心创意推荐最匹配的题材、平台、受众、叙事聚焦、视觉风格和规模配置。

=== 题材判断 ===
可选题材：${GENRE_OPTS.join('、')}
- 豪门逆袭/霸道总裁 → 霸总；甜蜜恋爱 → 甜宠；战力碾压 → 战神；穿越时空 → 穿越
- 宫廷权谋 → 宫斗；复仇打脸 → 复仇；重活一世 → 重生；推理悬疑 → 悬疑
- 都市生活/职场 → 都市；古装爱情/武侠 → 古装
- 真实人物传奇（李白/武则天/爱因斯坦） → 传记剧
- 神话故事/民间传说/仙侠 → 神话传说
- 历史事件/朝代兴亡/战争 → 历史剧
- 科幻/未来/太空 → 科幻

=== 平台判断（按题材×受众×内容调性综合决定）===
| 平台 | 用户画像 | 适合题材 | 内容偏好 | 画幅 |
|------|---------|---------|---------|------|
| douyin | 国内年轻用户(18-35)，女性略多 | 霸总/甜宠/复仇/重生/都市 | 快节奏、强情绪、前3秒必须抓人 | 9:16竖屏 |
| kuaishou | 国内下沉市场(25-45)，男性占比高 | 战神/复仇/古装/历史剧/传记剧 | 接地气、热血、家国情怀、朴实共情 | 9:16竖屏 |
| hongguo | 国内全年龄，日活过亿，免费+广告分账 | 全题材覆盖，强情感向/反转 | 强留存hook、完播率优先 | 9:16竖屏 |
| wechat_mini | 微信生态用户，付费+免费混合 | 霸总/甜宠/复仇/重生/悬疑 | 分销生态，悬念卡点驱动 | 9:16竖屏 |
| bilibili | 年轻用户(16-30)，二次元+精品向 | 悬疑/科幻/古装/都市/校园 | 精品化、有深度、弹幕友好、可动漫化 | 16:9横屏 |
| tencent_video | 全年龄偏女性，精品长视频用户 | 甜宠/都市/古装/宫斗/悬疑 | 精品化、制作感强、故事完整 | 16:9横屏 |
| mango_tv | 年轻女性(18-35)，湖南卫视生态 | 甜宠/都市/古装/青春 | 甜蜜、青春、年轻态 | 16:9横屏 |
| iqiyi | 全年龄偏女性，影视品质用户 | 悬疑/都市/古装/科幻 | 精品化、悬疑向表现好 | 16:9横屏 |
| reelshort | 海外英语用户，年轻女性 | 霸总/复仇/甜宠/穿越 | 强反转、灰姑娘叙事、英文内容 | 9:16竖屏 |
| dramabox | 海外多语种用户，年龄范围广 | 悬疑/科幻/古装/神话传说 | 高概念、视觉奇观、多语种 | 9:16竖屏 |
| generic | 通用/不确定 | 所有题材 | 当创意无法明确归属某平台时使用 | 9:16竖屏 |

决策权重：题材匹配(40%) > 受众画像(30%) > 内容调性(30%)
- 传记剧/历史剧：偏正能量和家国叙事 → kuaishou；偏年轻化戏剧改编 → douyin
- 神话传说：偏视觉奇观 → dramabox；偏国内热血 → kuaishou
- 霸总/甜宠：国内向 → douyin/hongguo；海外向 → reelshort
- 悬疑/科幻：高概念叙事 → dramabox/bilibili；快节奏反转 → douyin
- 精品深度向：bilibili/tencent_video/iqiyi
- 免费流量向：hongguo > douyin > kuaishou
- 甜宠青春向：mango_tv/douyin

=== 受众判断 ===
- 女性向偏情感（霸总/甜宠/宫斗/重生/少女漫画风）→ 18-30 岁女性
- 女性向偏成熟（都市/职场/复仇/宫斗权谋）→ 25-40 岁女性
- 男性向偏战力/热血（战神/军事/体育）→ 18-30 岁男性
- 传记剧/历史剧/神话传说/科普教育 → 全年龄

=== 叙事聚焦 ===
女主为主 → female_lead，男主为主 → male_lead，男女均衡 → dual_lead，多角色群像 → ensemble

=== 视觉风格推荐（从可选值中选一个最匹配的）===
可选值：${VISUAL_STYLE_OPTS.join(', ')}

视觉风格映射参考：
- 霸总/都市/职场/现代题材 → live_action / 2d_korean_anime / 3d_realistic
- 甜宠/少女向 → 2d_shoujo / 2d_korean_anime / 2d_ghibli / 3d_disney
- 战神/热血/格斗 → 2d_action / 3d_realistic / 2d_thick_line
- 古装/宫斗 → period_live / chinese_style / 2d_gongbi / chinese_ink
- 传记剧（中国历史人物）→ chinese_style / period_live / 2d_gongbi / chinese_ink
- 传记剧（西方人物）→ live_action / 3d_realistic / western_film
- 历史剧（中国）→ period_live / chinese_style / 2d_gongbi
- 历史剧（非中国）→ live_action / western_film / 3d_realistic
- 神话传说（东方）→ 3d_fantasy / chinese_style / chinese_ink / 2d_fantasy_anime
- 神话传说（西方/通用）→ 3d_fantasy / 2d_fantasy_anime / 3d_toon_render
- 穿越 → 根据穿越目标时代选择（穿越古代 → chinese_style；穿越未来 → 2d_cybercity）
- 复仇 → live_action / 2d_film / hk_film
- 重生 → 与原题材风格一致
- 悬疑/惊悚 → 2d_death_note / live_action / 2d_film
- 科幻 → 2d_cybercity / 3d_cyberpunk / 3d_realistic / western_film
- 武侠/江湖 → retro_wuxia / chinese_ink / 2d_action
- 轻松/搞笑/全年龄 → 3d_chibi / 2d_chibi / clay_stop / 3d_disney
核心原则：视觉风格应与题材调性、目标受众审美偏好、平台内容生态三者一致。

=== 画面比例 ===
可选值：${ASPECT_RATIO_OPTS.join('、')}
- 竖屏短剧平台（douyin/kuaishou/reelshort）→ 9:16
- 横屏平台或电影感内容 → 16:9
- 绝大多数短剧选 9:16；仅当创意明确指向电影/横屏体验时才选 16:9

=== 每集时长（秒）===
可选值：${DURATION_OPTS.join('、')}
- 120秒(2分钟)：极快节奏，适合 douyin/reelshort 上的纯爽剧（霸总/战神/甜宠等高密度情绪输出题材）
- 180秒(3分钟)：标准时长，适合大多数题材的最佳平衡点
- 300秒(5分钟)：深度叙事，适合传记剧/历史剧/悬疑等需要铺陈背景和角色深度的题材，或 dramabox 等偏长内容平台
决策逻辑：平台节奏偏好(40%) + 题材叙事密度(40%) + 受众耐心阈值(20%)

=== 总集数规模 ===
可选规模档位：${SCALE_OPTS.map(s => `${s.min}-${s.max}集`).join('、')}
- 40-60集（紧凑型）：适合单线冲突、高密度反转（霸总/甜宠/战神/短线复仇）或海外平台(reelshort)
- 60-100集（标准型）：适合多线交织、冲突层层递进（穿越/宫斗/都市/重生/科幻）
- 100-150集（长线型）：适合史诗级叙事、人物一生跨度（传记剧/历史剧/长篇神话传说/大型宫斗权谋）
决策逻辑：创意体量(50%) + 题材叙事容量(30%) + 平台用户追剧习惯(20%)
- 创意描述涉及"一生""多个时代""多条线"等大体量关键词 → 倾向长线型
- 创意聚焦单一事件/单一冲突 → 倾向紧凑型

输出必须严格匹配上述各字段的枚举值。plannedEpisodes 的 min/max 必须匹配以上三个档位之一。targetEpisodeDurationSec 必须为 ${DURATION_OPTS.join('/')} 之一。`,
      userPrompt: `核心创意：\n${mainIdea}\n\n请推荐最匹配的题材、平台、受众、叙事聚焦、视觉风格和规模配置，输出 JSON。`,
      temperature: 0.3,
    });
  }

  async generateStoryGoal(input: { mainIdea: string; genre: string; targetAudience: string }, userId?: string) {
    return this.llm.generateStructured({
      taskName: 'drama-goal-generator',
      schema: z.object({ goal: z.string(), alternatives: z.array(z.string()).min(2).max(3) }),
      tags: ['setup', 'drama-goal'],
      metadata: { userId },
      systemPrompt: `你是一位资深短剧策划，擅长从核心创意中提炼出让观众欲罢不能的主线目标。

生成原则：
1. 主线目标必须从核心创意中自然延伸，聚焦核心冲突或叙事脉络。
2. 目标要有视觉冲击力和悬念感——观众能直接"看到"冲突/命运转折。
3. 目标要有足够的延展性——能支撑多集的叙事。
4. 语言简洁有力，20-60 字。
5. 同时给出 2-3 个备选目标，风格/方向不同。
6. 针对不同题材调整策略：
   - 商业短剧（霸总/甜宠/复仇等）→ 聚焦爽点反转、冲突升级
   - 传记剧/历史剧 → 聚焦人物命运弧线、时代碰撞
   - 神话传说 → 聚焦使命/考验/成长`,
      userPrompt: `核心创意：${input.mainIdea}\n题材：${input.genre}\n目标观众：${input.targetAudience}\n\n请生成一个最佳主线目标和 2-3 个备选方案。`,
      temperature: 0.8,
    });
  }
}
