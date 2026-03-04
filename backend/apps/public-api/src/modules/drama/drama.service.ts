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
import { DramaState } from './schemas/drama-state.schemas';
import { LlmService } from '../novel/llm/llm.service';
import { DramaSeedAnalyzerAgent } from './agents/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/visual-asset-designer.agent';
import { DramaProfilerAgent } from './agents/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/drama-strategy.agent';
import { EpisodeWorkflowService } from './episode-workflow.service';
import { MediaOrchestratorService } from './media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { MediaService } from '../media/media.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';

interface CreateDramaOptions { userId?: string; progressDramaId?: string; }

const CREATION_CHECKPOINTS = ['seed_analyzed', 'outline_planned', 'visual_designed', 'assets_generated', 'profile_ready', 'creation_done'] as const;

@Injectable()
export class DramaService implements OnModuleInit {
  private readonly logger = new Logger(DramaService.name);
  private readonly generatingDramas = new Set<string>(); // 并发锁：正在生成集数的 dramaId

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
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly llm: LlmService,
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

    // 断点续跑: 查找可恢复的 workflow execution
    let wfExec = await this.wfExecRepo.findOne({ where: { dramaId, episodeNumber: 0, status: In(['running', 'interrupted'] as const) }, order: { createdAt: 'DESC' } });
    let resumeFrom = 0;
    const out: Record<string, any> = {};
    if (wfExec?.lastCheckpoint) {
      resumeFrom = CREATION_CHECKPOINTS.indexOf(wfExec.lastCheckpoint as any) + 1;
      Object.assign(out, wfExec.stepOutputs ?? {});
      this.logger.log(`恢复创建流程 dramaId=${dramaId} from=${wfExec.lastCheckpoint} step=${resumeFrom}`);
      await this.wfExecRepo.update(wfExec.id, { status: 'running' });
    } else if (!wfExec) {
      wfExec = await this.wfExecRepo.save(this.wfExecRepo.create({ dramaId, episodeNumber: 0, status: 'running', stepOutputs: { _dto: dto } }));
    }
    const saveCP = async (name: string, data: Record<string, unknown>) => { // 保存 checkpoint
      Object.assign(out, data);
      await this.wfExecRepo.update(wfExec!.id, { lastCheckpoint: name, stepOutputs: { ...out, _dto: dto } });
    };

    try {
      if (resumeFrom <= 0) {
        const seedHints = dto.genreTemplateId
          ? (await this.genreTemplateService.getById(dto.genreTemplateId)).seedHints
          : this.genreTemplateService.findBestMatch(dto.genre);
        this.logger.log(`[create] 题材模板匹配: ${dto.genreTemplateId ? 'ID指定' : seedHints ? '自动匹配' : '无匹配'}`);
        emitCreate(0, '种子分析...');
        const { seed } = await this.seedAnalyzer.analyze({
          mainIdea: dto.mainIdea, genre: dto.genre, targetAudience: dto.targetAudience,
          protagonistFocus: dto.protagonistFocus, tonePreference: dto.tonePreference,
          audienceTags: dto.audienceTags, titleHint: dto.titleHint, mainStoryGoal: dto.mainStoryGoal,
          targetEpisodeDurationSec: dto.targetEpisodeDurationSec,
          plannedTotalEpisodes: dto.plannedMinEpisodes || dto.plannedMaxEpisodes
            ? { min: dto.plannedMinEpisodes ?? 60, max: dto.plannedMaxEpisodes ?? 100 } : undefined,
          seedHints: seedHints ?? undefined,
        });
        out.seed = seed;
        emitCreate(0, '种子分析完成', true);
        await saveCP('seed_analyzed', { seed });
      }

      if (resumeFrom <= 1) {
        emitCreate(1, '总导演规划全剧大纲...');
        out.outline = await this.seriesDirector.plan(out.seed);
        emitCreate(1, '全剧大纲完成', true);
        await saveCP('outline_planned', { outline: out.outline });
      }

      if (resumeFrom <= 2) {
        emitCreate(2, '视觉资产设计...');
        const { characters, locations, visualStyle } = await this.visualDesigner.design(out.seed, out.outline);
        Object.assign(out, { characters, locations, visualStyle });
        emitCreate(2, '视觉资产设计完成', true);
        await saveCP('visual_designed', { characters, locations, visualStyle });
      }

      if (resumeFrom <= 3) {
        emitCreate(3, '生成角色定妆照 + 场景参考图...');
        const assetEntities = await this.persistVisualAssets(dramaId, out.characters, out.locations, out.visualStyle);
        await this.generateReferenceImages(dramaId, assetEntities, out.characters, out.locations);
        emitCreate(3, '参考图生成完成', true);
        await saveCP('assets_generated', {});
      }

      if (resumeFrom <= 4) {
        emitCreate(4, '编剧手册 + 策略...');
        const [promptProfile, strategy] = await Promise.all([
          this.profiler.generate(out.seed, out.visualStyle),
          this.strategist.generate(out.seed, out.outline),
        ]);
        Object.assign(out, { promptProfile, strategy });
        emitCreate(4, '编剧手册完成', true);
        await saveCP('profile_ready', { promptProfile, strategy });
      }

      const now = new Date().toISOString(); // Step 5: 最终状态组装
      const state: Partial<DramaState> = {
        dramaId, createdAt: now, updatedAt: now, version: 1, seed: out.seed,
        audienceDirective: {
          audienceTags: dto.audienceTags ?? [], protagonistFocus: dto.protagonistFocus ?? 'female_lead',
          tonePreference: dto.tonePreference ?? '', platformTarget: dto.platformTarget ?? 'generic',
          aspectRatio: dto.aspectRatio ?? '9:16', hardConstraints: [], softPreferences: [],
        },
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

      emitCreate(5, '短剧创建完成', true);
      this.logger.log(`短剧创建完成 — dramaId: ${dramaId} | 标题: ${out.seed.title} | ${out.outline.totalPlannedEpisodes}集`);
    } catch (err: any) {
      await this.wfExecRepo.update(wfExec!.id, { status: 'failed', errorMessage: err.message ?? '' });
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
        referenceImageUrl: '',
      })),
      ...locations.map(l => ({
        dramaId, assetType: 'location' as const, refId: l.locationId,
        name: l.name, data: l as unknown as Record<string, unknown>,
        referenceImageUrl: '',
      })),
    ];
    if (visualStyle) {
      entities.push({
        dramaId, assetType: 'style_guide' as const, refId: 'global',
        name: 'Visual Style Guide', data: visualStyle as unknown as Record<string, unknown>,
        referenceImageUrl: '',
      });
    }
    if (!entities.length) return [];
    return this.visualAssetRepo.save(entities.map(e => this.visualAssetRepo.create(e)));
  }

  /** 为角色(含变体)+场景并发生成参考图（T2I），回写 VisualAssetEntity.referenceImageUrl */
  private async generateReferenceImages(
    dramaId: string, assets: VisualAssetEntity[],
    characters: DramaState['characters'], locations: DramaState['locations'],
  ): Promise<void> {
    const tasks = assets.map(asset => async () => {
      try {
        let prompt = '', size = '1024x1024';
        if (asset.assetType === 'character') {
          const ch = characters.find(c => c.characterId === asset.refId);
          if (!ch?.faceReferencePrompt) return;
          prompt = ch.faceReferencePrompt; size = '768x1024';
        } else if (asset.assetType === 'location') {
          const loc = locations.find(l => l.locationId === asset.refId);
          if (!loc?.visualPrompt) return;
          prompt = loc.visualPrompt; size = '1280x720';
        } else return;
        this.logger.log(`生成参考图: ${asset.assetType}/${asset.refId}`);
        const result = await this.mediaService.generateImage({ prompt, size, count: 1, dramaId, assetType: `${asset.assetType}_image`, refId: asset.refId });
        if (result.images?.[0]?.url) {
          asset.referenceImageUrl = result.images[0].url;
          await this.visualAssetRepo.update(asset.id, { referenceImageUrl: asset.referenceImageUrl });
        }
      } catch (err) { this.logger.warn(`参考图失败: ${asset.assetType}/${asset.refId} — ${(err as Error).message}`); }
    });
    await this.runConcurrent(tasks, 3);
    await this.generateVariationImages(dramaId, characters);
  }

  /** 为角色外观变体生成参考图（以base定妆照为参考保持面部一致） */
  private async generateVariationImages(dramaId: string, characters: DramaState['characters']): Promise<void> {
    const baseAssets = await this.visualAssetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    const baseMap = new Map(baseAssets.filter(a => a.referenceImageUrl).map(a => [a.refId, a.referenceImageUrl]));
    for (const ch of characters) {
      if (!ch.variations?.length) continue;
      const baseImg = baseMap.get(ch.characterId);
      for (const v of ch.variations) {
        if (v.referenceImageUrl) continue; // 已有参考图则跳过
        try {
          const refImages = baseImg ? [{ url: baseImg, weight: 0.6 }] : [];
          const result = await this.mediaService.generateImage({
            prompt: `${v.visualPromptOverride}, same person as reference, ${ch.faceReferencePrompt.slice(0, 80)}`,
            size: '768x1024', count: 1, referenceImages: refImages,
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
    const size = asset.assetType === 'character' ? '768x1024' : '1280x720';
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
    if (this.generatingDramas.has(dramaId)) throw new Error('该短剧正在生成中，请勿重复提交');
    const drama = await this.getDrama(dramaId);
    const state = drama.state as unknown as DramaState;
    const startEp = state.episodeCursor;
    const endEp = Math.min(startEp + count - 1, state.seriesOutline?.totalPlannedEpisodes ?? startEp + count - 1);
    this.logger.log(`开始生成 E${startEp}-E${endEp} — dramaId: ${dramaId}`);
    this.generatingDramas.add(dramaId);
    this.runEpisodePipeline(dramaId, startEp, endEp).catch(err =>
      this.logger.error(`逐集生成失败 dramaId=${dramaId} E${startEp}-E${endEp}: ${err.message}`),
    ).finally(() => this.generatingDramas.delete(dramaId));
    return { message: `已启动 ${endEp - startEp + 1} 集生成（E${startEp}-E${endEp}）`, startEp, endEp };
  }

  /** 后台逐集串行执行（确保上下文正确传递） */
  private async runEpisodePipeline(dramaId: string, startEp: number, endEp: number): Promise<void> {
    for (let ep = startEp; ep <= endEp; ep++) {
      await this.episodeWorkflow.generateEpisode(dramaId, ep);
    }
    this.progressService.emit({ dramaId, phase: 'episode', step: 'all_done', stepIndex: 0, totalSteps: 1, message: `E${startEp}-E${endEp} 全部完成`, done: true });
  }

  async listEpisodes(dramaId: string): Promise<{ episodes: EpisodeEntity[] }> {
    const episodes = await this.episodeRepo.find({
      where: { dramaId },
      order: { episodeNumber: 'ASC' },
      select: ['id', 'dramaId', 'episodeNumber', 'title', 'overallScore', 'totalDurationSec', 'shotCount', 'createdAt'],
    });
    return { episodes };
  }

  async getEpisode(dramaId: string, episodeNumber: number): Promise<EpisodeEntity> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new NotFoundException(`短剧 ${dramaId} 第 ${episodeNumber} 集不存在`);
    return episode;
  }

  async getVisualAssets(dramaId: string): Promise<{ assets: VisualAssetEntity[] }> {
    const assets = await this.visualAssetRepo.find({ where: { dramaId }, order: { createdAt: 'ASC' } });
    return { assets };
  }

  async generateEpisodeMedia(dramaId: string, episodeNumber: number) {
    return this.mediaOrchestrator.generateEpisodeMedia(dramaId, episodeNumber);
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
      systemPrompt: `你是一位顶尖短剧策划编辑，擅长把粗糙的短剧灵感打磨成让观众一眼上头的故事概念。

美化原则：
1. 忠于原意：保留用户创意的核心方向和情感基调。
2. 冲突前置：在描述中自然埋入核心矛盾和身份反差，让人产生"接下来会怎样"的好奇。
3. 视觉化：短剧是视觉媒介，描述要有画面感——能想象出具体的场景和表情。
4. 爽点明确：突出打脸/逆袭/甜蜜暴击等爽点，让人想追看。
5. 角色立体化：赋予主角一个有趣的困境或身份反差。
6. 文案质感：像短剧宣传片的旁白——简短有力、节奏紧凑，控制在100-200字。
7. 适度原则：如果原始创意已足够精彩，润色即可。`,
      userPrompt: `原始创意：\n${rawIdea}${genre ? `\n题材方向：${genre}` : ''}\n\n请输出美化后的创意和核心卖点。`,
      temperature: 0.75,
    });
  }

  async generateStoryGoal(input: { mainIdea: string; genre: string; targetAudience: string }) {
    return this.llm.generateStructured({
      taskName: 'drama-goal-generator',
      schema: z.object({ goal: z.string(), alternatives: z.array(z.string()).min(2).max(3) }),
      tags: ['setup', 'drama-goal'],
      systemPrompt: `你是一位资深短剧策划，擅长从核心创意中提炼出让观众欲罢不能的主线冲突目标。

生成原则：
1. 主线目标必须从核心创意中自然延伸，聚焦核心冲突。
2. 目标要有视觉冲击力——观众能直接"看到"冲突（打脸/揭露/反转）。
3. 目标要有足够的延展性——能支撑 60-100 集的叙事。
4. 语言简洁有力，20-60 字，要有悬念感和爽感。
5. 同时给出 2-3 个备选目标，风格/方向不同。`,
      userPrompt: `核心创意：${input.mainIdea}\n题材：${input.genre}\n目标观众：${input.targetAudience}\n\n请生成一个最佳主线目标和 2-3 个备选方案。`,
      temperature: 0.8,
    });
  }
}
