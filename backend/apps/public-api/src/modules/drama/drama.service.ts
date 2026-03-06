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
import { DramaState, ContentMode } from './schemas/drama-state.schemas';
import { LlmService } from '../novel/llm/llm.service';
import { LlmTraceLoggerService } from '../novel/llm/llm-trace-logger.service';
import { DramaSeedAnalyzerAgent } from './agents/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/visual-asset-designer.agent';
import { DramaProfilerAgent } from './agents/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/drama-strategy.agent';
import { EpisodeWorkflowService } from './episode-workflow.service';
import { MediaOrchestratorService } from './media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { MediaService } from '../media/media.service';
import { RenderingProfileService } from '../media/rendering/rendering-profile.service';
import { CharacterViewAngle, buildViewAnglePrompt } from '../media/rendering/rendering-profile';
import { DramaGenreTemplateService } from './drama-genre-template.service';

interface CreateDramaOptions { userId?: string; progressDramaId?: string; }

const CREATION_CHECKPOINTS = ['seed_analyzed', 'outline_planned', 'visual_designed', 'assets_generated', 'profile_ready', 'creation_done'] as const;

@Injectable()
export class DramaService implements OnModuleInit {
  private readonly logger = new Logger(DramaService.name);
  private readonly generatingDramas = new Set<string>();
  private readonly pausedDramas = new Set<string>();

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
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly llm: LlmService,
    private readonly traceLogger: LlmTraceLoggerService,
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
    const wfExec = await this.wfExecRepo.findOne({ where: { dramaId, episodeNumber: 0, status: 'failed' }, order: { createdAt: 'DESC' } });
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
    const emitCreate = (stepIndex: number, msg: string, done = false) =>
      this.progressService.emit({ dramaId, phase: 'create', step: `create_${stepIndex}`, stepIndex, totalSteps: TOTAL_STEPS, message: msg, done });
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

    const KNOWLEDGE_GENRES = ['历史教育', '人物传记', '神话传说', '科普知识'];
    const contentMode: ContentMode = KNOWLEDGE_GENRES.some(g => dto.genre.includes(g)) ? 'knowledge' : 'drama';

    try {
      logDrama('pipeline_start', 'ok', '创建流程开始', { resumeFrom, genre: dto.genre, contentMode, mainIdea: dto.mainIdea?.slice(0, 80) });
      if (resumeFrom <= 0) {
        const seedHints = dto.genreTemplateId
          ? (await this.genreTemplateService.getById(dto.genreTemplateId)).seedHints
          : this.genreTemplateService.findBestMatch(dto.genre);
        this.logger.log(`[create] 题材模板匹配: ${dto.genreTemplateId ? 'ID指定' : seedHints ? '自动匹配' : '无匹配'}`);
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
          contentMode,
        });
        out.seed = seed;
        out.seedHints = seedHints ?? null;
        logDrama('seed_analyze_done', 'ok', '种子分析完成', { seedTitle: seed?.title });
        emitCreate(0, '种子分析完成', true);
        await saveCP('seed_analyzed', { seed, seedHints: out.seedHints });
      }

      if (resumeFrom <= 1) {
        logDrama('outline_plan_start', 'ok', '总导演规划全剧大纲');
        emitCreate(1, '总导演规划全剧大纲...');
        out.outline = await this.seriesDirector.plan(out.seed, contentMode);
        logDrama('outline_plan_done', 'ok', '全剧大纲完成', { totalEpisodes: out.outline?.totalPlannedEpisodes });
        emitCreate(1, '全剧大纲完成', true);
        await saveCP('outline_planned', { outline: out.outline });
      }

      if (resumeFrom <= 2) {
        logDrama('visual_design_start', 'ok', '视觉资产设计');
        emitCreate(2, '视觉资产设计...');
        const mergedStyleHint = dto.visualStyleHint
          || (out.seedHints as any)?.visualStyleHints
          || undefined;
        const { characters, locations, visualStyle } = await this.visualDesigner.design(out.seed, out.outline, mergedStyleHint, contentMode);
        Object.assign(out, { characters, locations, visualStyle });
        logDrama('visual_design_done', 'ok', '视觉资产设计完成', { charCount: out.characters?.length, locCount: out.locations?.length });
        emitCreate(2, '视觉资产设计完成', true);
        await saveCP('visual_designed', { characters, locations, visualStyle });
      }

      if (resumeFrom <= 3) {
        logDrama('assets_generate_start', 'ok', '生成角色定妆照+场景参考图');
        emitCreate(3, '生成角色定妆照 + 场景参考图...');
        const assetEntities = await this.persistVisualAssets(dramaId, out.characters, out.locations, out.visualStyle);
        await this.generateReferenceImages(dramaId, assetEntities, out.characters, out.locations);
        logDrama('assets_generate_done', 'ok', '参考图生成完成');
        emitCreate(3, '参考图生成完成', true);
        await saveCP('assets_generated', {});
      }

      if (resumeFrom <= 4) {
        logDrama('profile_strategy_start', 'ok', '编剧手册+策略生成');
        emitCreate(4, '编剧手册 + 策略...');
        const [promptProfile, strategy] = await Promise.all([
          this.profiler.generate(out.seed, out.visualStyle, out.outline, contentMode),
          this.strategist.generate(out.seed, out.outline, contentMode),
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
        promptProfile: out.promptProfile, strategy: out.strategy, visualStyle: out.visualStyle,
        characters: out.characters, locations: out.locations, seriesOutline: out.outline,
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
      emitCreate(5, '短剧创建完成', true);
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
      this.progressService.emit({ dramaId, phase: 'create', step: 'error', stepIndex: -1, totalSteps: 5, message: err.message ?? '创建失败', done: true, error: err.message });
      throw err;
    }
  }

  private async persistVisualAssets(
    dramaId: string,
    characters: DramaState['characters'],
    locations: DramaState['locations'],
    visualStyle?: DramaState['visualStyle'],
  ): Promise<VisualAssetEntity[]> {
    const entities: Partial<VisualAssetEntity>[] = [
      ...characters.map(c => ({
        dramaId, assetType: 'character' as const, refId: c.characterId,
        name: c.name, data: c as unknown as Record<string, unknown>,
        referenceImageUrl: '', referenceImages: [],
      })),
      ...locations.map(l => ({
        dramaId, assetType: 'location' as const, refId: l.locationId,
        name: l.name, data: l as unknown as Record<string, unknown>,
        referenceImageUrl: '', referenceImages: [],
      })),
    ];
    if (visualStyle) {
      entities.push({
        dramaId, assetType: 'style_guide' as const, refId: 'global',
        name: 'Visual Style Guide', data: visualStyle as unknown as Record<string, unknown>,
        referenceImageUrl: '', referenceImages: [],
      });
    }
    if (!entities.length) return [];
    return this.visualAssetRepo.save(entities.map(e => this.visualAssetRepo.create(e)));
  }

  /**
   * 为角色（多角度）+场景并发生成参考图，回写 VisualAssetEntity。
   *
   * Phase 1: 为所有角色生成 face_front（正面定妆照）+ 所有场景参考图
   * Phase 2: 按角色重要性链式生成额外视角（以 face_front 为参考图）
   * Phase 3: 角色外观变体参考图
   */
  private async generateReferenceImages(
    dramaId: string, assets: VisualAssetEntity[],
    characters: DramaState['characters'], locations: DramaState['locations'],
  ): Promise<void> {
    const profile = this.renderingProfileService.getImageProfile();
    const charAssets = assets.filter(a => a.assetType === 'character');
    const locAssets = assets.filter(a => a.assetType === 'location');

    // ═══ Phase 1: face_front + 场景参考图（并发） ═══
    const phase1Tasks = [
      ...charAssets.map(asset => async () => {
        const ch = characters.find(c => c.characterId === asset.refId);
        if (!ch?.faceReferencePrompt) return;
        try {
          this.logger.log(`[Phase1] face_front: ${ch.name}(${asset.refId})`);
          const result = await this.mediaService.generateImage({
            prompt: ch.faceReferencePrompt, size: '720x1280', count: 1,
            dramaId, assetType: 'character_image', refId: asset.refId,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            asset.referenceImages = [{ viewAngle: 'face_front', imageUrl: result.images[0].url }];
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`face_front 失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
      ...locAssets.map(asset => async () => {
        const loc = locations.find(l => l.locationId === asset.refId);
        if (!loc?.visualPrompt) return;
        try {
          this.logger.log(`[Phase1] 场景参考图: ${loc.name}`);
          const result = await this.mediaService.generateImage({
            prompt: loc.visualPrompt, size: '1280x720', count: 1,
            dramaId, assetType: 'location_image', refId: asset.refId,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            await this.visualAssetRepo.update(asset.id, { referenceImageUrl: asset.referenceImageUrl });
          }
        } catch (err) { this.logger.warn(`场景参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
    ];
    await this.runConcurrent(phase1Tasks, 3);

    // ═══ Phase 2: 多角度链式生成（以 face_front 为参考图保持同一人脸） ═══
    const chainWeight = profile.characterViews.chainReferenceWeight;
    const phase2Tasks = charAssets.map(asset => async () => {
      if (!asset.referenceImageUrl) return; // Phase 1 失败则跳过
      const ch = characters.find(c => c.characterId === asset.refId);
      if (!ch) return;
      const role = ch.role as 'protagonist' | 'antagonist' | 'supporting' | 'minor';
      const requiredViews = profile.characterViews.viewsByRole[role] ?? ['face_front'];
      const extraViews = (requiredViews as readonly CharacterViewAngle[]).filter(v => v !== 'face_front');
      if (!extraViews.length) return;

      const images = [...(asset.referenceImages ?? [])];
      for (const viewAngle of extraViews) {
        try {
          const prompt = buildViewAnglePrompt(ch, viewAngle);
          const refImages = [{ url: asset.referenceImageUrl, weight: chainWeight }];
          this.logger.log(`[Phase2] ${viewAngle}: ${ch.name}(${asset.refId})`);
          const result = await this.mediaService.generateImage({
            prompt, size: '720x1280', count: 1, referenceImages: refImages,
            dramaId, assetType: `character_${viewAngle}`, refId: asset.refId,
          });
          if (result.images?.[0]?.url) {
            images.push({ viewAngle, imageUrl: result.images[0].url });
          }
        } catch (err) { this.logger.warn(`${viewAngle} 失败: ${asset.refId} — ${(err as Error).message}`); }
      }
      asset.referenceImages = images;
      await this.visualAssetRepo.update(asset.id, { referenceImages: images });
      this.logger.log(`${ch.name} 多角度完成: ${images.map(i => i.viewAngle).join(', ')}`);
    });
    await this.runConcurrent(phase2Tasks, 3);

    // ═══ Phase 3: 角色外观变体参考图 ═══
    await this.generateVariationImages(dramaId, characters);
  }

  /** 为角色外观变体生成参考图（以 face_front 为参考保持面部一致） */
  private async generateVariationImages(dramaId: string, characters: DramaState['characters']): Promise<void> {
    const baseAssets = await this.visualAssetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    const baseMap = new Map(baseAssets.filter(a => a.referenceImageUrl).map(a => [a.refId, a.referenceImageUrl]));
    for (const ch of characters) {
      if (!ch.variations?.length) continue;
      const baseImg = baseMap.get(ch.characterId);
      for (const v of ch.variations) {
        if (v.referenceImageUrl) continue;
        try {
          const refImages = baseImg ? [{ url: baseImg, weight: 0.6 }] : [];
          const result = await this.mediaService.generateImage({
            prompt: `${v.visualPromptOverride}, same person as reference, ${ch.faceReferencePrompt}`,
            size: '720x1280', count: 1, referenceImages: refImages,
            dramaId, assetType: 'character_variation', refId: `${ch.characterId}_${v.variationId}`,
          });
          if (result.images?.[0]?.url) v.referenceImageUrl = result.images[0].url;
          this.logger.log(`变体参考图完成: ${ch.characterId}/${v.variationId}`);
        } catch (err) { this.logger.warn(`变体参考图失败: ${ch.characterId}/${v.variationId} — ${(err as Error).message}`); }
      }
    }
  }

  /** 重新生成单个视觉资产的参考图 */
  async regenerateAssetImage(dramaId: string, assetId: string): Promise<VisualAssetEntity> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    const data = asset.data as Record<string, unknown>;
    const prompt = asset.assetType === 'character'
      ? String(data.faceReferencePrompt || '') : String(data.visualPrompt || '');
    if (!prompt) throw new Error(`资产 ${assetId} 缺少生成提示词`);
    const size = asset.assetType === 'character' ? '720x1280' : '1280x720';
    const result = await this.mediaService.generateImage({
      prompt, size, count: 1, dramaId, assetType: `${asset.assetType}_image`, refId: asset.refId,
    });
    if (result.images?.[0]?.url) {
      asset.referenceImageUrl = result.images[0].url;
      await this.visualAssetRepo.update(asset.id, { referenceImageUrl: asset.referenceImageUrl });
    }
    return asset;
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

  /** 异步启动逐集生成（含并发互斥），立即返回任务信息 */
  async generateEpisodes(dramaId: string, count: number): Promise<{ message: string; startEp: number; endEp: number }> {
    this.pausedDramas.delete(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId, count);
    this.runEpisodePipeline(dramaId, startEp, endEp).catch(err =>
      this.logger.error(`逐集生成失败 dramaId=${dramaId} E${startEp}-E${endEp}: ${err.message}`),
    ).finally(() => { this.generatingDramas.delete(dramaId); });
    return { message: `已启动 ${endEp - startEp + 1} 集生成（E${startEp}-E${endEp}）`, startEp, endEp };
  }

  /** 逐集生成并等待完成（供 SSE 使用，可推送进度） */
  async generateEpisodesAndWait(dramaId: string, count: number): Promise<{ message: string; startEp: number; endEp: number; paused: boolean }> {
    this.pausedDramas.delete(dramaId);
    const { startEp, endEp } = await this.prepareGenerateEpisodes(dramaId, count);
    try {
      const wasPaused = await this.runEpisodePipeline(dramaId, startEp, endEp);
      return { message: wasPaused ? '已暂停' : `E${startEp}-E${endEp} 全部完成`, startEp, endEp, paused: wasPaused };
    } finally {
      this.generatingDramas.delete(dramaId);
    }
  }

  private async prepareGenerateEpisodes(dramaId: string, count: number): Promise<{ startEp: number; endEp: number }> {
    if (this.generatingDramas.has(dramaId)) throw new Error('该短剧正在生成中，请勿重复提交');
    const drama = await this.getDrama(dramaId);
    const state = drama.state as unknown as DramaState;
    const creationStatus = (state as any)?._status;
    if (creationStatus === 'creating') throw new Error('短剧仍在创建中，请等待创建完成后再生成集数');
    if (creationStatus === 'failed') throw new Error('短剧创建失败，请调用重试接口（retryCreation）后再生成集数');
    const rawCursor = state?.episodeCursor;
    const startEp = Number.isFinite(rawCursor) && rawCursor >= 1 ? rawCursor : Math.max(1, (drama.episodesGenerated ?? 0) + 1);
    const totalPlanned = Number.isFinite(state?.seriesOutline?.totalPlannedEpisodes) ? state.seriesOutline!.totalPlannedEpisodes! : 999;
    const endEp = Math.min(startEp + count - 1, totalPlanned);
    this.logger.log(`开始生成 E${startEp}-E${endEp} — dramaId: ${dramaId}`);
    this.generatingDramas.add(dramaId);
    return { startEp, endEp };
  }

  /** 后台逐集串行执行（确保上下文正确传递），返回 true 表示被暂停 */
  private async runEpisodePipeline(dramaId: string, startEp: number, endEp: number): Promise<boolean> {
    for (let ep = startEp; ep <= endEp; ep++) {
      if (this.pausedDramas.has(dramaId)) {
        this.logger.log(`生成已暂停 dramaId=${dramaId}，停在 E${ep} 之前`);
        this.progressService.emit({ dramaId, phase: 'episode', step: 'paused', stepIndex: 0, totalSteps: 1, message: `已暂停，下次将从 E${ep} 继续`, done: true });
        const drama = await this.getDrama(dramaId);
        const st = drama.state as any;
        st.episodeCursor = ep;
        await this.dramaRepo.update(dramaId, { state: st });
        return true;
      }
      await this.episodeWorkflow.generateEpisode(dramaId, ep);
    }
    this.progressService.emit({ dramaId, phase: 'episode', step: 'all_done', stepIndex: 0, totalSteps: 1, message: `E${startEp}-E${endEp} 全部完成`, done: true });
    return false;
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

  async generateEpisodeImages(dramaId: string, episodeNumber: number): Promise<void> {
    return this.mediaOrchestrator.generateEpisodeImages(dramaId, episodeNumber);
  }

  async generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
    return this.mediaOrchestrator.generateShotImage(dramaId, episodeNumber, shotId);
  }

  async getEpisodeMediaStatus(dramaId: string, episodeNumber: number) {
    return this.mediaOrchestrator.getMediaStatus(dramaId, episodeNumber);
  }

  private async runConcurrent(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
    let idx = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }));
  }

  async enhanceIdea(rawIdea: string, genre?: string) {
    return this.llm.generateStructured({
      taskName: 'drama-idea-enhancer',
      schema: z.object({ enhanced: z.string(), highlights: z.array(z.string()).min(2).max(5) }),
      tags: ['setup', 'drama-idea'],
      systemPrompt: `你是一位顶尖短视频内容策划编辑，擅长把粗糙的内容灵感打磨成让观众一眼上头的概念。

你需要先判断创意的内容类型，再按对应策略美化：

【内容类型判断】
A. 商业短剧（霸总/甜宠/战神/复仇/重生/宫斗/穿越/都市/悬疑/古装等虚构剧情）
B. 历史教育（历史人物/事件介绍、历史故事、朝代科普等）
C. 人物传记（真实人物的生平故事、成就介绍等）
D. 神话传说（神话故事、民间传说、文化传承等）
E. 科普知识（知识解说、科学故事、趣味百科等）
F. 其他

【A类-商业短剧美化原则】
1. 忠于原意：保留核心方向和情感基调。
2. 冲突前置：埋入核心矛盾和身份反差，产生"接下来会怎样"的好奇。
3. 爽点明确：突出打脸/逆袭/甜蜜暴击等爽点。
4. 角色立体化：赋予主角有趣的困境或身份反差。

【B/C类-历史/传记美化原则】
1. 忠于史实：保留历史准确性，不编造虚假细节。
2. 叙事生动：用故事化手法呈现历史，有画面感和代入感。
3. 知识亮点：突出让人"涨知识"的历史细节和冷门知识。
4. 人物鲜活：展现历史人物的性格、情感和人性面。
5. 时代感：描述要有时代氛围和文化底蕴。

【D类-神话传说美化原则】
1. 忠于原典：保留经典情节，不过度魔改。
2. 奇幻想象：突出神话的瑰丽想象和视觉震撼。
3. 文化内涵：体现背后的文化寓意和民族精神。
4. 角色魅力：让神话人物的性格鲜明动人。

【E类-科普知识美化原则】
1. 知识准确：确保科学事实的准确性。
2. 趣味叙事：像讲故事一样引人入胜。
3. 视觉化：描述要有画面感，便于转化为漫画/视频。
4. 悬念感：设置"你知道为什么吗？"式的知识悬念。

【通用原则】
- 视觉化：内容是视觉媒介，描述要有画面感——能想象出具体的场景。
- 文案质感：简短有力、节奏紧凑，控制在100-200字。
- 适度原则：如果原始创意已足够精彩，润色即可。
- 严禁把历史/教育/科普内容强行改成商业短剧风格。`,
      userPrompt: `原始创意：\n${rawIdea}${genre ? `\n题材方向：${genre}` : ''}\n\n请先判断内容类型，然后按对应策略美化。输出美化后的创意和核心卖点（highlights 应体现该类型的核心价值：商业短剧→爽点卖点，历史/传记→知识亮点，科普→认知价值）。`,
      temperature: 0.75,
    });
  }

  async recommendGenreAndAudience(mainIdea: string) {
    const COMMERCIAL_GENRES = ['霸总', '甜宠', '战神', '穿越', '宫斗', '复仇', '重生', '悬疑', '都市', '古装'] as const;
    const KNOWLEDGE_GENRES = ['历史教育', '人物传记', '神话传说', '科普知识'] as const;
    const GENRE_OPTS = [...COMMERCIAL_GENRES, ...KNOWLEDGE_GENRES] as const;
    const PLATFORM_OPTS = ['douyin', 'kuaishou', 'reelshort', 'dramabox', 'generic'] as const;
    const AUDIENCE_OPTS = ['18-30 岁女性', '18-30 岁男性', '25-40 岁女性', '全年龄'] as const;
    const FOCUS_OPTS = ['female_lead', 'male_lead', 'dual_lead', 'ensemble'] as const;
    return this.llm.generateStructured({
      taskName: 'drama-genre-audience-recommender',
      schema: z.object({
        genreDisplayName: z.enum(GENRE_OPTS),
        platformTarget: z.enum(PLATFORM_OPTS),
        targetAudience: z.enum(AUDIENCE_OPTS),
        protagonistFocus: z.enum(FOCUS_OPTS),
        reason: z.string().optional(),
      }),
      tags: ['setup', 'drama-recommend'],
      systemPrompt: `你是一位资深内容策划，根据用户的核心创意推荐最匹配的题材、平台、受众和叙事聚焦。

可选题材分两大类：
A. 商业短剧类：${COMMERCIAL_GENRES.join('、')}
B. 知识/教育类：${KNOWLEDGE_GENRES.join('、')}

判断逻辑：
- 虚构故事、爽点反转、情感纠葛 → 选A类中最匹配的（豪门逆袭→都市/霸总，宫斗权谋→宫斗，复仇打脸→复仇/霸总）
- 真实历史人物/事件介绍、历史科普 → 历史教育
- 真实人物的生平/传记故事 → 人物传记
- 神话故事、民间传说、仙侠 → 神话传说
- 知识科普、科学解说 → 科普知识

平台：douyin/快手节奏快，reelshort/dramabox偏海外，generic通用。
受众：女性向偏情感选18-30岁女性或25-40岁女性，男性向偏战力/科技选18-30岁男性，知识/教育类通常选全年龄。
叙事聚焦：女主为主→female_lead，男主为主→male_lead，男女均衡→dual_lead，多角色/知识类→ensemble。
输出必须严格匹配上述枚举值。`,
      userPrompt: `核心创意：\n${mainIdea}\n\n请推荐最匹配的题材、平台、受众和叙事聚焦，输出 JSON。`,
      temperature: 0.3,
    });
  }

  async generateStoryGoal(input: { mainIdea: string; genre: string; targetAudience: string }) {
    const KNOWLEDGE_GENRES = ['历史教育', '人物传记', '神话传说', '科普知识'];
    const isKnowledge = KNOWLEDGE_GENRES.some(g => input.genre.includes(g));

    const commercialSystemPrompt = `你是一位资深短剧策划，擅长从核心创意中提炼出让观众欲罢不能的主线冲突目标。

生成原则：
1. 主线目标必须从核心创意中自然延伸，聚焦核心冲突。
2. 目标要有视觉冲击力——观众能直接"看到"冲突（打脸/揭露/反转）。
3. 目标要有足够的延展性——能支撑 60-100 集的叙事。
4. 语言简洁有力，20-60 字，要有悬念感和爽感。
5. 同时给出 2-3 个备选目标，风格/方向不同。`;

    const knowledgeSystemPrompt = `你是一位资深内容策划，擅长从知识/教育类创意中提炼出引人入胜的叙事主线。

生成原则：
1. 主线必须从核心创意中自然延伸，聚焦叙事脉络（如人物的一生、一个时代的兴衰、一个知识体系的脉络）。
2. 主线要有吸引力——通过知识悬念、人物命运、时代变迁让观众想一集集看下去。
3. 主线要有清晰的结构——按时间线、主题或成长线展开，能支撑多集叙事。
4. 语言简洁有感染力，20-60 字，体现知识价值和情感深度。
5. 同时给出 2-3 个备选主线，用不同的切入角度（如时间线叙事 vs 主题叙事 vs 人物关系线）。`;

    return this.llm.generateStructured({
      taskName: 'drama-goal-generator',
      schema: z.object({ goal: z.string(), alternatives: z.array(z.string()).min(2).max(3) }),
      tags: ['setup', 'drama-goal'],
      systemPrompt: isKnowledge ? knowledgeSystemPrompt : commercialSystemPrompt,
      userPrompt: `核心创意：${input.mainIdea}\n题材：${input.genre}\n目标观众：${input.targetAudience}\n\n请生成一个最佳${isKnowledge ? '叙事主线' : '主线目标'}和 2-3 个备选方案。`,
      temperature: 0.8,
    });
  }
}
