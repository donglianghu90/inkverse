/** 短剧题材模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaGenreTemplateEntity, DramaSeedHints } from './entities/drama-genre-template.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';

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
];

@Injectable()
export class DramaGenreTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaGenreTemplateService.name);

  constructor(
    @InjectRepository(DramaGenreTemplateEntity) private readonly repo: Repository<DramaGenreTemplateEntity>,
  ) {}

  async onModuleInit(): Promise<void> { await this.seedSystemTemplates(); }

  private async seedSystemTemplates(): Promise<void> {
    for (const tpl of SYSTEM_TEMPLATES) {
      const existing = await this.repo.findOne({ where: { userId: undefined as any, genreKey: tpl.genreKey, isSystem: true } });
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
    const where = userId ? [{ userId }, { isSystem: true, userId: undefined as any }] : [{ isSystem: true }];
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
}
