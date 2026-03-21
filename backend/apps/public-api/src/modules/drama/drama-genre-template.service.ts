/** 短剧题材模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 + AI 生成 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { z } from 'zod';
import { DramaGenreTemplateEntity, DramaSeedHints } from './entities/drama-genre-template.entity';
import { GENRE_TEMPLATES } from './prompting/drama-genre-data';
import { DramaEntity } from './entities/drama.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';
import { LlmService } from '../novel/llm/llm.service';

export interface GenreAnalytics {
  genre: string;
  totalDramas: number;
  avgScore: number | null;
  avgEpisodesGenerated: number;
  recentCount30d: number;
}


@Injectable()
export class DramaGenreTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaGenreTemplateService.name);

  constructor(
    @InjectRepository(DramaGenreTemplateEntity) private readonly repo: Repository<DramaGenreTemplateEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    private readonly llm: LlmService,
  ) {}

  async onModuleInit(): Promise<void> { await this.seedSystemTemplates(); }

  private async seedSystemTemplates(): Promise<void> {
    const entries = Object.entries(GENRE_TEMPLATES);
    for (const [genreKey, tpl] of entries) {
      const profileJson = tpl.profile as unknown as Record<string, unknown>;
      const existing = await this.repo.findOne({ where: { userId: IsNull(), genreKey, isSystem: true } });
      if (existing) {
        existing.displayName = tpl.displayName;
        existing.description = tpl.description;
        existing.genreKeywords = tpl.genreKeywords;
        existing.seedHints = tpl.seedHints as DramaSeedHints;
        existing.audienceTags = tpl.audienceTags;
        existing.protagonistFocusTags = tpl.protagonistFocusTags as any;
        existing.toneTags = tpl.toneTags;
        existing.platformTags = tpl.platformTags;
        existing.profileJson = profileJson;
        existing.systemVersion = existing.systemVersion + 1;
        await this.repo.save(existing);
      } else {
        await this.repo.save(this.repo.create({
          userId: null, genreKey, displayName: tpl.displayName,
          description: tpl.description, genreKeywords: tpl.genreKeywords,
          profileJson, seedHints: tpl.seedHints as DramaSeedHints,
          audienceTags: tpl.audienceTags, protagonistFocusTags: tpl.protagonistFocusTags as any,
          toneTags: tpl.toneTags, platformTags: tpl.platformTags, isSystem: true,
        }));
      }
    }
    this.logger.log(`短剧系统题材模板同步完成（${entries.length} 个）`);
  }

  async list(userId?: string): Promise<DramaGenreTemplateEntity[]> {
    if (userId) {
      await this.syncSystemTemplates(userId);
      // 已登录时只返回用户模板（含 sync 产生的副本），不叠加系统模板，避免「同一题材出现两次」的问题
      return this.repo.find({ where: { userId }, order: { displayName: 'ASC' } });
    }
    return this.repo.find({ where: { isSystem: true }, order: { displayName: 'ASC' } });
  }

  private async syncSystemTemplates(userId: string): Promise<void> {
    const systemTpls = await this.repo.find({ where: { isSystem: true } });
    const userTpls = await this.repo.find({ where: { userId } });
    const userByGenre = new Map(userTpls.map(t => [t.genreKey, t]));
    for (const sys of systemTpls) {
      const user = userByGenre.get(sys.genreKey);
      if (!user) {
        await this.repo.save(this.repo.create({
          userId, genreKey: sys.genreKey, displayName: sys.displayName,
          description: sys.description, genreKeywords: sys.genreKeywords,
          profileJson: sys.profileJson, seedHints: sys.seedHints,
          audienceTags: sys.audienceTags, protagonistFocusTags: sys.protagonistFocusTags,
          toneTags: sys.toneTags, platformTags: sys.platformTags,
          parentTemplateId: sys.id, syncedSystemVersion: sys.systemVersion,
        }));
      } else if (!user.isUserModified && user.syncedSystemVersion < sys.systemVersion) {
        Object.assign(user, {
          displayName: sys.displayName, description: sys.description,
          genreKeywords: sys.genreKeywords, seedHints: sys.seedHints,
          profileJson: sys.profileJson,
          audienceTags: sys.audienceTags, protagonistFocusTags: sys.protagonistFocusTags,
          toneTags: sys.toneTags, platformTags: sys.platformTags,
          syncedSystemVersion: sys.systemVersion,
        });
        await this.repo.save(user);
      }
    }
  }

  async getById(id: string): Promise<DramaGenreTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`短剧题材模板 ${id} 不存在`);
    return tpl;
  }

  async create(userId: string, dto: CreateDramaGenreTemplateDto): Promise<DramaGenreTemplateEntity> {
    return this.repo.save(this.repo.create({
      userId, genreKey: dto.genreKey, displayName: dto.displayName,
      description: dto.description ?? '', genreKeywords: dto.genreKeywords ?? [],
      profileJson: dto.profileJson ?? {}, seedHints: (dto.seedHints as DramaSeedHints) ?? null,
      audienceTags: dto.audienceTags ?? [], protagonistFocusTags: (dto.protagonistFocusTags ?? []) as any,
      toneTags: dto.toneTags ?? [], platformTags: dto.platformTags ?? [],
      isUserModified: true,
    }));
  }

  async update(id: string, userId: string, dto: UpdateDramaGenreTemplateDto): Promise<DramaGenreTemplateEntity> {
    const tpl = await this.getById(id);
    if (tpl.userId && tpl.userId !== userId) throw new NotFoundException('无权修改该模板');
    const patch: Partial<DramaGenreTemplateEntity> = { isUserModified: true };
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.genreKeywords !== undefined) patch.genreKeywords = dto.genreKeywords;
    if (dto.profileJson !== undefined) patch.profileJson = dto.profileJson;
    if (dto.seedHints !== undefined) patch.seedHints = dto.seedHints as DramaSeedHints;
    if (dto.audienceTags !== undefined) patch.audienceTags = dto.audienceTags;
    if (dto.protagonistFocusTags !== undefined) patch.protagonistFocusTags = dto.protagonistFocusTags as any;
    if (dto.toneTags !== undefined) patch.toneTags = dto.toneTags;
    if (dto.platformTags !== undefined) patch.platformTags = dto.platformTags;
    Object.assign(tpl, patch);
    return this.repo.save(tpl);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const tpl = await this.getById(id);
    if (tpl.isSystem) throw new Error('系统模板不可删除');
    if (tpl.userId && tpl.userId !== userId) throw new NotFoundException('无权删除该模板');
    await this.repo.remove(tpl);
    return { success: true };
  }

  async clone(id: string, userId: string): Promise<DramaGenreTemplateEntity> {
    const src = await this.getById(id);
    return this.repo.save(this.repo.create({
      userId, genreKey: `${src.genreKey}_copy`, displayName: `${src.displayName}（副本）`,
      description: src.description, genreKeywords: src.genreKeywords,
      profileJson: src.profileJson, seedHints: src.seedHints,
      audienceTags: src.audienceTags, protagonistFocusTags: src.protagonistFocusTags,
      toneTags: src.toneTags, platformTags: src.platformTags,
      parentTemplateId: src.id, isUserModified: true,
    }));
  }

  findBestMatch(genre: string): DramaSeedHints | null {
    const entry = Object.values(GENRE_TEMPLATES).find(
      t => t.genreKeywords.some(k => genre.includes(k)) || genre.includes(t.displayName),
    );
    return (entry?.seedHints ?? null) as DramaSeedHints | null;
  }

  async aiGenerate(dto: {
    genreName: string; styleDescription?: string; referenceWorks?: string[];
    targetAudience?: string; platformTarget?: string; userId?: string;
  }): Promise<{
    displayName: string; description: string; genreKeywords: string[];
    audienceTags: string[]; protagonistFocusTags: string[]; toneTags: string[];
    platformTags: string[]; seedHints: DramaSeedHints; profileJson: Record<string, unknown>;
  }> {
    const portraitSchema = z.object({
      coreIdentitySummary: z.string(),
      keyGenreTraits: z.array(z.string()).min(3),
      catharsisKeywords: z.array(z.string()).min(3), // 爽点关键词
      hookKeywords: z.array(z.string()).min(3),
      conflictPatterns: z.array(z.string()).min(3),
      suggestedAudienceTags: z.array(z.string()).min(1),
      suggestedProtagonistFocus: z.array(z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble'])).min(1),
      suggestedToneTags: z.array(z.string()).min(2),
      suggestedPlatforms: z.array(z.string()).min(1),
    });
    const portrait = await this.llm.generateStructured({
      taskName: 'drama-genre-portrait',
      schema: portraitSchema,
      tags: ['setup', 'drama-genre-portrait'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位资深短剧编剧总监，精通各类短剧题材的创作规律和平台特点。请根据用户描述的短剧题材生成一份"题材画像"。`,
      userPrompt: `短剧题材：${dto.genreName}
${dto.styleDescription ? `风格描述：${dto.styleDescription}` : ''}
${dto.referenceWorks?.length ? `参考作品：${dto.referenceWorks.join('、')}` : ''}
${dto.targetAudience ? `目标受众：${dto.targetAudience}` : ''}
${dto.platformTarget ? `目标平台：${dto.platformTarget}` : ''}

请生成题材画像 JSON：
- coreIdentitySummary: 一段话描述理想编剧身份
- keyGenreTraits: 5-8个题材核心特征
- catharsisKeywords: 5-8个观众爽感关键词（如打脸/逆袭/甜蜜暴击）
- hookKeywords: 5-8个集末钩子关键词
- conflictPatterns: 5-8个核心冲突模式
- suggestedAudienceTags: 推荐受众标签（如女性向/男性向/18-35岁）
- suggestedProtagonistFocus: 推荐主角类型（female_lead/male_lead/dual_lead/ensemble）
- suggestedToneTags: 推荐基调标签（如爽快/甜蜜/紧张/虐恋）
- suggestedPlatforms: 推荐平台（douyin/kuaishou/reelshort/dramabox）`,
      temperature: 0.5,
    });

    const seedHintsSchema = z.object({
      catharsisPresets: z.array(z.string()).min(3),
      conflictPatterns: z.array(z.string()).min(3),
      paywallStrategyHints: z.string(),
      visualStyleHints: z.string(),
      dialogueStyleHints: z.string(),
      platformDefaults: z.object({
        platformTarget: z.string().optional().nullable(),
        aspectRatio: z.string().optional().nullable(),
        durationSec: z.number().optional().nullable(),
      }).optional().nullable(),
    });
    const seedHintsRaw = await this.llm.generateStructured({
      taskName: 'drama-genre-seed-hints',
      schema: seedHintsSchema,
      tags: ['setup', 'drama-seed-hints', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位短剧运营专家。根据题材画像，生成短剧创作引导配置。

=== 题材画像 ===
编剧身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.catharsisKeywords.join('、')}
冲突模式：${portrait.conflictPatterns.join('、')}`,
      userPrompt: `短剧题材：${dto.genreName}
${dto.platformTarget ? `目标平台：${dto.platformTarget}` : ''}

请生成 JSON：
- catharsisPresets: 推荐爽点类型列表（5-8个，如"打脸""身份揭露""甜蜜反转"）
- conflictPatterns: 核心冲突模式列表（5-8个）
- paywallStrategyHints: 付费卡点策略建议（一段文字，说明在哪些剧情节点设置付费卡点效果最佳）
- visualStyleHints: 视觉风格提示（滤镜/色调/氛围建议）
- dialogueStyleHints: 台词风格提示（语言风格/节奏/禁忌）
- platformDefaults: 平台默认配置（platformTarget/aspectRatio/durationSec）`,
      temperature: 0.5,
    });

    const profileSchema = z.object({
      description: z.string(),
      genreKeywords: z.array(z.string()).min(3),
      scriptwriterGuide: z.object({
        coreIdentity: z.string(),
        genreRules: z.array(z.string()).min(5),
        dialogueGuide: z.string(),
        pacingGuide: z.string(),
      }),
      hookTypes: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })).min(3),
      reviewerCalibration: z.object({
        dimensionWeights: z.record(z.number()),
        genreSpecificChecks: z.array(z.string()),
      }),
    });
    const profileRaw = await this.llm.generateStructured({
      taskName: 'drama-genre-profile-ai-generate',
      schema: profileSchema,
      tags: ['setup', 'drama-profile', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位短剧编剧培训专家。为「${dto.genreName}」题材生成编剧手册核心配置。

=== 题材画像 ===
编剧身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.catharsisKeywords.join('、')}
钩子关键词：${portrait.hookKeywords.join('、')}`,
      userPrompt: `短剧题材：${dto.genreName}
目标受众：${dto.targetAudience ?? '通用短剧观众'}

请生成 JSON：
- description: 一句话描述该题材（20字内）
- genreKeywords: 题材关键词列表（5-8个）
- scriptwriterGuide: 编剧指南（coreIdentity/genreRules/dialogueGuide/pacingGuide）
- hookTypes: 集末钩子类型列表（5-8种，每种含 id/label/description）
- reviewerCalibration: 审核校准（dimensionWeights 各维度权重/genreSpecificChecks 题材专项检查）`,
      temperature: 0.6,
    });

    this.logger.log(`[aiGenerate] 短剧题材模板 AI 生成完成: ${dto.genreName}`);

    return {
      displayName: dto.genreName,
      description: profileRaw.description,
      genreKeywords: profileRaw.genreKeywords,
      audienceTags: portrait.suggestedAudienceTags,
      protagonistFocusTags: portrait.suggestedProtagonistFocus,
      toneTags: portrait.suggestedToneTags,
      platformTags: portrait.suggestedPlatforms,
      seedHints: seedHintsRaw as DramaSeedHints,
      profileJson: profileRaw as unknown as Record<string, unknown>,
    };
  }

  /** 按题材统计创建量/平均分/近30天趋势，用于数据驱动的选题推荐 */
  async getGenreAnalytics(): Promise<GenreAnalytics[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const raw: Array<{ genre: string; total: string; avg_score: string | null; avg_eps: string }> = await this.dramaRepo
      .createQueryBuilder('d')
      .select('d.genre', 'genre')
      .addSelect('COUNT(*)', 'total')
      .addSelect('AVG(d.latestOverallScore)', 'avg_score')
      .addSelect('AVG(d.episodesGenerated)', 'avg_eps')
      .where('d.genre IS NOT NULL AND d.genre != :empty', { empty: '' })
      .groupBy('d.genre')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const recentRaw: Array<{ genre: string; cnt: string }> = await this.dramaRepo
      .createQueryBuilder('d')
      .select('d.genre', 'genre')
      .addSelect('COUNT(*)', 'cnt')
      .where('d.genre IS NOT NULL AND d.genre != :empty AND d.createdAt >= :since', { empty: '', since: thirtyDaysAgo })
      .groupBy('d.genre')
      .getRawMany();

    const recentMap = new Map(recentRaw.map(r => [r.genre, parseInt(r.cnt, 10)]));

    return raw.map(r => ({
      genre: r.genre,
      totalDramas: parseInt(r.total, 10),
      avgScore: r.avg_score ? parseFloat(parseFloat(r.avg_score).toFixed(2)) : null,
      avgEpisodesGenerated: parseFloat(parseFloat(r.avg_eps).toFixed(1)),
      recentCount30d: recentMap.get(r.genre) ?? 0,
    }));
  }

  /** 获取推荐排序的题材列表（按近30天热度 + 平均分加权排序） */
  async getRecommendedGenres(): Promise<Array<GenreAnalytics & { score: number }>> {
    const analytics = await this.getGenreAnalytics();
    const maxRecent = Math.max(1, ...analytics.map(a => a.recentCount30d));
    const maxTotal = Math.max(1, ...analytics.map(a => a.totalDramas));

    return analytics
      .map(a => {
        const popularityScore = (a.recentCount30d / maxRecent) * 0.5 + (a.totalDramas / maxTotal) * 0.2;
        const qualityScore = a.avgScore ? (a.avgScore / 10) * 0.3 : 0;
        return { ...a, score: parseFloat((popularityScore + qualityScore).toFixed(3)) };
      })
      .sort((a, b) => b.score - a.score);
  }
}
