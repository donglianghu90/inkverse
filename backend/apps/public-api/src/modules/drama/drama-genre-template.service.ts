/** 短剧题材模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 + AI 生成 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { z } from 'zod';
import { DramaGenreTemplateEntity, DramaSeedHints } from './entities/drama-genre-template.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';
import { LlmService } from '../novel/llm/llm.service';

const SYSTEM_TEMPLATES: Array<{
  genreKey: string; displayName: string; description: string;
  genreKeywords: string[]; audienceTags: string[];
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;
  toneTags: string[]; platformTags: string[];
  seedHints: DramaSeedHints;
}> = [
  {
    genreKey: 'boss', displayName: '霸总', description: '霸道总裁+身份反差+打脸逆袭',
    genreKeywords: ['霸总', '总裁', '豪门'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['爽快', '反转'],
    platformTags: ['douyin', 'kuaishou', 'reelshort'],
    seedHints: { catharsisPresets: ['打脸', '身份揭露', '逆袭归来'], conflictPatterns: ['阶级对立', '身份反差', '前任纠葛'], paywallStrategyHints: '第3集男女主误会加深处设卡，第10集身份揭露前设卡' },
  },
  {
    genreKey: 'sweet', displayName: '甜宠', description: '高甜互动+甜蜜暴击+宠溺日常',
    genreKeywords: ['甜宠', '恋爱', '撒糖'], audienceTags: ['女性向', '18-30岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['甜蜜', '治愈'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['甜蜜反转', '宠溺升级', '守护'], conflictPatterns: ['误会消解', '竞争者介入', '家庭阻碍'], paywallStrategyHints: '每次甜蜜高潮前一刻设卡' },
  },
  {
    genreKey: 'warrior', displayName: '战神', description: '归来战神+震撼全场+实力碾压',
    genreKeywords: ['战神', '归来', '兵王'], audienceTags: ['男性向', '18-40岁'],
    protagonistFocusTags: ['male_lead'], toneTags: ['热血', '爽快'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['实力碾压', '身份揭露', '打脸'], conflictPatterns: ['身份隐藏', '被轻视', '势力冲突'], paywallStrategyHints: '第2集主角被羞辱还未反击时设卡' },
  },
  {
    genreKey: 'timetravel', displayName: '穿越', description: '现代知识+古代碾压+改写命运',
    genreKeywords: ['穿越', '重生', '时空'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'male_lead'], toneTags: ['爽快', '智斗'],
    platformTags: ['douyin', 'kuaishou', 'dramabox'],
    seedHints: { catharsisPresets: ['先知碾压', '命运改写', '逆袭'], conflictPatterns: ['蝴蝶效应', '历史纠葛', '身份暴露风险'], paywallStrategyHints: '主角关键先知决策前设卡' },
  },
  {
    genreKey: 'palace', displayName: '宫斗', description: '权谋博弈+后宫争锋+步步为营',
    genreKeywords: ['宫斗', '后宫', '权谋'], audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['紧张', '智斗'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['计中计', '反将一军', '真相大白'], conflictPatterns: ['后宫争宠', '派系斗争', '忠奸难辨'], paywallStrategyHints: '每次反转前夕设卡，真正幕后黑手揭露前设卡' },
  },
  {
    genreKey: 'revenge', displayName: '复仇', description: '真相追查+绝地反击+快意恩仇',
    genreKeywords: ['复仇', '逆袭', '反击'], audienceTags: ['女性向', '男性向'],
    protagonistFocusTags: ['female_lead', 'male_lead'], toneTags: ['爽快', '紧张'],
    platformTags: ['douyin', 'kuaishou', 'reelshort'],
    seedHints: { catharsisPresets: ['真相揭露', '逆袭反杀', '当众打脸'], conflictPatterns: ['冤屈洗白', '身份反差', '势力对抗'], paywallStrategyHints: '主角准备反击但尚未出手时设卡' },
  },
  {
    genreKey: 'rebirth', displayName: '重生', description: '前世记忆+改写命运+步步先机',
    genreKeywords: ['重生', '前世', '逆天改命'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['爽快', '虐中带甜'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['命运改写', '先知碾压', '仇人末路'], conflictPatterns: ['前世悲剧重现', '命运惯性', '新变量介入'], paywallStrategyHints: '关键命运分叉点前设卡' },
  },
  {
    genreKey: 'suspense', displayName: '悬疑', description: '层层谜团+反转不断+烧脑推理',
    genreKeywords: ['悬疑', '推理', '反转'], audienceTags: ['男女通吃', '20-40岁'],
    protagonistFocusTags: ['male_lead', 'dual_lead'], toneTags: ['紧张', '烧脑'],
    platformTags: ['douyin', 'reelshort'],
    seedHints: { catharsisPresets: ['真相反转', '意外揭露', '逻辑闭环'], conflictPatterns: ['多重嫌疑人', '不可靠叙事', '时间线谜题'], paywallStrategyHints: '关键线索发现前、真相即将揭露前设卡' },
  },
  {
    genreKey: 'urban', displayName: '都市', description: '都市生活+情感纠葛+现实冲突',
    genreKeywords: ['都市', '职场', '生活'], audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['现实', '温暖'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['情感共鸣', '逆袭成长', '真爱胜出'], conflictPatterns: ['职场竞争', '家庭矛盾', '价值观冲突'], paywallStrategyHints: '感情升温关键时刻设卡' },
  },
  {
    genreKey: 'ancient', displayName: '古装', description: '古代背景+爱恨情仇+家国天下',
    genreKeywords: ['古装', '古代', '古风'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['唯美', '虐恋'],
    platformTags: ['douyin', 'kuaishou'],
    seedHints: { catharsisPresets: ['虐后团圆', '身世真相', '逆袭封后'], conflictPatterns: ['家族仇恨', '朝堂争斗', '身份错认'], paywallStrategyHints: '男女主情感考验最高潮处设卡' },
  },
  {
    genreKey: 'history_edu', displayName: '历史教育', description: '历史人物/事件+知识传递+故事化叙事',
    genreKeywords: ['历史', '朝代', '历史人物', '历史事件', '历史故事'], audienceTags: ['全年龄', '知识向'],
    protagonistFocusTags: ['ensemble'], toneTags: ['知性', '厚重', '趣味'],
    platformTags: ['douyin', 'kuaishou', 'generic'],
    seedHints: { catharsisPresets: ['知识震撼', '历史感悟', '文化共鸣', '命运唏嘘'], conflictPatterns: ['理想与现实', '时代变迁', '命运抉择', '文化碰撞'], paywallStrategyHints: '在关键历史转折点或人物命运转变前设置悬念衔接，引导观众继续观看' },
  },
  {
    genreKey: 'biography', displayName: '人物传记', description: '真实人物+生平故事+时代画卷',
    genreKeywords: ['传记', '人物', '生平', '名人', '伟人'], audienceTags: ['全年龄', '知识向'],
    protagonistFocusTags: ['male_lead', 'female_lead'], toneTags: ['感人', '励志', '厚重'],
    platformTags: ['douyin', 'kuaishou', 'generic'],
    seedHints: { catharsisPresets: ['人生感悟', '成就震撼', '命运共情', '精神传承'], conflictPatterns: ['逆境成长', '时代洪流', '理想坚守', '人性抉择'], paywallStrategyHints: '在人物命运重大转折前设置悬念，如成名前的最后考验、人生低谷的关键抉择' },
  },
  {
    genreKey: 'mythology', displayName: '神话传说', description: '神话故事+奇幻想象+文化传承',
    genreKeywords: ['神话', '传说', '民间故事', '神仙', '上古'], audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead', 'ensemble'], toneTags: ['奇幻', '壮丽', '感人'],
    platformTags: ['douyin', 'kuaishou', 'generic'],
    seedHints: { catharsisPresets: ['奇幻震撼', '英雄壮举', '情感动人', '文化共鸣'], conflictPatterns: ['善恶对抗', '天命抗争', '人神冲突', '守护牺牲'], paywallStrategyHints: '在重大战斗前、真相揭示前、命运抉择前设置悬念' },
  },
  {
    genreKey: 'science', displayName: '科普知识', description: '知识解说+趣味叙事+视觉化演绎',
    genreKeywords: ['科普', '知识', '科学', '百科', '解说'], audienceTags: ['全年龄', '知识向'],
    protagonistFocusTags: ['ensemble'], toneTags: ['趣味', '烧脑', '震撼'],
    platformTags: ['douyin', 'kuaishou', 'generic'],
    seedHints: { catharsisPresets: ['知识震撼', '认知颠覆', '恍然大悟', '视觉奇观'], conflictPatterns: ['常识挑战', '未解之谜', '科学探索', '思维实验'], paywallStrategyHints: '在关键知识揭示前设置悬念，用"你知道为什么吗？"式的问题引导继续观看' },
  },
];

@Injectable()
export class DramaGenreTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaGenreTemplateService.name);

  constructor(
    @InjectRepository(DramaGenreTemplateEntity) private readonly repo: Repository<DramaGenreTemplateEntity>,
    private readonly llm: LlmService,
  ) {}

  async onModuleInit(): Promise<void> { await this.seedSystemTemplates(); }

  private async seedSystemTemplates(): Promise<void> {
    for (const tpl of SYSTEM_TEMPLATES) {
      const existing = await this.repo.findOne({ where: { userId: IsNull(), genreKey: tpl.genreKey, isSystem: true } });
      if (existing) {
        existing.displayName = tpl.displayName;
        existing.description = tpl.description;
        existing.genreKeywords = tpl.genreKeywords;
        existing.seedHints = tpl.seedHints;
        existing.audienceTags = tpl.audienceTags;
        existing.protagonistFocusTags = tpl.protagonistFocusTags;
        existing.toneTags = tpl.toneTags;
        existing.platformTags = tpl.platformTags;
        existing.systemVersion = existing.systemVersion + 1;
        await this.repo.save(existing);
      } else {
        await this.repo.save(this.repo.create({
          userId: null, genreKey: tpl.genreKey, displayName: tpl.displayName,
          description: tpl.description, genreKeywords: tpl.genreKeywords,
          profileJson: {}, seedHints: tpl.seedHints,
          audienceTags: tpl.audienceTags, protagonistFocusTags: tpl.protagonistFocusTags,
          toneTags: tpl.toneTags, platformTags: tpl.platformTags, isSystem: true,
        }));
      }
    }
    this.logger.log(`短剧系统题材模板同步完成（${SYSTEM_TEMPLATES.length} 个）`);
  }

  async list(userId?: string): Promise<DramaGenreTemplateEntity[]> {
    if (userId) await this.syncSystemTemplates(userId);
    const where = userId ? [{ userId }, { isSystem: true, userId: IsNull() as any }] : [{ isSystem: true }];
    return this.repo.find({ where: where as any, order: { displayName: 'ASC' } });
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
    const tpl = SYSTEM_TEMPLATES.find(t => t.genreKeywords.some(k => genre.includes(k)) || genre.includes(t.displayName));
    return tpl?.seedHints ?? null;
  }

  async aiGenerate(dto: {
    genreName: string; styleDescription?: string; referenceWorks?: string[];
    targetAudience?: string; platformTarget?: string;
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
        platformTarget: z.string().optional(),
        aspectRatio: z.string().optional(),
        durationSec: z.number().optional(),
      }).optional(),
    });
    const seedHintsRaw = await this.llm.generateStructured({
      taskName: 'drama-genre-seed-hints',
      schema: seedHintsSchema,
      tags: ['setup', 'drama-seed-hints', 'ai-generate'],
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
}
