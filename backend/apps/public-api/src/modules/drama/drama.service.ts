/**
 * 短剧核心服务 — 从创意到 Shot JSON 的完整生成链路。
 * 创建流程：SeedAnalyzer → SeriesDirector → VisualAssetDesigner → DramaProfiler → DramaStrategy
 * 逐集流程：委托 EpisodeWorkflowService（Phase 3）
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { CreateDramaDto } from './dto/create-drama.dto';
import { DramaState } from './schemas/drama-state.schemas';
import { DramaSeedAnalyzerAgent } from './agents/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/visual-asset-designer.agent';
import { DramaProfilerAgent } from './agents/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/drama-strategy.agent';
import { EpisodeWorkflowService } from './episode-workflow.service';
import { DramaProgressService } from './drama-progress.service';

interface CreateDramaOptions { userId?: string; progressDramaId?: string; }

@Injectable()
export class DramaService {
  private readonly logger = new Logger(DramaService.name);

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(VisualAssetEntity) private readonly visualAssetRepo: Repository<VisualAssetEntity>,
    private readonly seedAnalyzer: DramaSeedAnalyzerAgent,
    private readonly seriesDirector: SeriesDirectorAgent,
    private readonly visualDesigner: VisualAssetDesignerAgent,
    private readonly profiler: DramaProfilerAgent,
    private readonly strategist: DramaStrategyAgent,
    private readonly episodeWorkflow: EpisodeWorkflowService,
    private readonly progressService: DramaProgressService,
  ) {}

  async createDrama(dto: CreateDramaDto, opts: CreateDramaOptions = {}): Promise<{ dramaId: string }> {
    this.logger.log(`创建短剧 — 题材: ${dto.genre} | 创意: ${dto.mainIdea.slice(0, 50)}...`);
    const pid = opts.progressDramaId ?? `tmp_${Date.now()}`;
    const emitCreate = (stepIndex: number, message: string, done = false) =>
      this.progressService.emit({ dramaId: pid, phase: 'create', step: `create_${stepIndex}`, stepIndex, totalSteps: 5, message, done });

    emitCreate(0, '种子分析...');
    const { seed } = await this.seedAnalyzer.analyze({
      mainIdea: dto.mainIdea,
      genre: dto.genre,
      targetAudience: dto.targetAudience,
      protagonistFocus: dto.protagonistFocus,
      tonePreference: dto.tonePreference,
      audienceTags: dto.audienceTags,
      titleHint: dto.titleHint,
      mainStoryGoal: dto.mainStoryGoal,
      targetEpisodeDurationSec: dto.targetEpisodeDurationSec,
      plannedTotalEpisodes: dto.plannedMinEpisodes || dto.plannedMaxEpisodes
        ? { min: dto.plannedMinEpisodes ?? 60, max: dto.plannedMaxEpisodes ?? 100 }
        : undefined,
    });
    emitCreate(0, '种子分析完成', true);

    emitCreate(1, '总导演规划全剧大纲...');
    const outline = await this.seriesDirector.plan(seed);
    emitCreate(1, '全剧大纲完成', true);

    emitCreate(2, '视觉资产设计...');
    const { characters, locations, visualStyle } = await this.visualDesigner.design(seed, outline);
    emitCreate(2, '视觉资产设计完成', true);

    emitCreate(3, '编剧手册 + 策略...');
    const [promptProfile, strategy] = await Promise.all([
      this.profiler.generate(seed, visualStyle),
      this.strategist.generate(seed, outline),
    ]);
    emitCreate(3, '编剧手册完成', true);

    // 组装 DramaState
    const now = new Date().toISOString();
    const state: Partial<DramaState> = {
      dramaId: '',
      createdAt: now,
      updatedAt: now,
      version: 1,
      seed,
      audienceDirective: {
        audienceTags: dto.audienceTags ?? [],
        protagonistFocus: dto.protagonistFocus ?? 'female_lead',
        tonePreference: dto.tonePreference ?? '',
        platformTarget: dto.platformTarget ?? 'generic',
        aspectRatio: dto.aspectRatio ?? '9:16',
        hardConstraints: [],
        softPreferences: [],
      },
      promptProfile,
      strategy,
      visualStyle,
      characters,
      locations,
      seriesOutline: outline,
      arcSegments: [],
      episodeCursor: 1,
      episodeSummaries: [],
      lastCliffhanger: '',
      recentHookTypes: [],
      secretLedger: [],
      flashbackBank: [],
      kpiHistory: [],
      dopamineSchedule: { history: [], episodesSinceMinor: 0, episodesSinceMajor: 0 },
    };

    // 持久化
    const entity = this.dramaRepo.create({
      userId: opts.userId ?? 'anonymous',
      title: seed.title,
      genre: seed.genre,
      state: state as Record<string, unknown>,
      episodesGenerated: 0,
    });
    const saved = await this.dramaRepo.save(entity);
    (state as any).dramaId = saved.id;
    saved.state = state as Record<string, unknown>;
    await this.dramaRepo.save(saved);

    // 持久化视觉资产到独立表（方便后续按 dramaId 查询）
    await this.persistVisualAssets(saved.id, characters, locations, visualStyle);

    emitCreate(4, '短剧创建完成', true);
    this.logger.log(`短剧创建完成 — dramaId: ${saved.id} | 标题: ${seed.title} | ${outline.totalPlannedEpisodes}集`);
    return { dramaId: saved.id };
  }

  private async persistVisualAssets(
    dramaId: string,
    characters: DramaState['characters'],
    locations: DramaState['locations'],
    visualStyle?: DramaState['visualStyle'],
  ): Promise<void> {
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
    if (entities.length) await this.visualAssetRepo.save(entities.map(e => this.visualAssetRepo.create(e)));
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

  async generateEpisodes(dramaId: string, count: number): Promise<{ message: string }> {
    const drama = await this.getDrama(dramaId);
    const state = drama.state as unknown as DramaState;
    const startEp = state.episodeCursor;
    const endEp = Math.min(startEp + count - 1, state.seriesOutline?.totalPlannedEpisodes ?? startEp + count - 1);
    this.logger.log(`开始生成 E${startEp}-E${endEp} — dramaId: ${dramaId}`);

    // 逐集串行生成（确保上下文正确传递）
    for (let ep = startEp; ep <= endEp; ep++) {
      await this.episodeWorkflow.generateEpisode(dramaId, ep);
    }

    return { message: `已完成 ${endEp - startEp + 1} 集生成（E${startEp}-E${endEp}）` };
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
}
