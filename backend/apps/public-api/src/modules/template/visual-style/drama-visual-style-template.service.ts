/** 短剧视觉风格模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { DramaVisualStyleTemplateEntity, VisualStyleGuide, VisualPromptGuidance } from '../entities/drama-visual-style-template.entity';
import { CreateDramaVisualStyleTemplateDto, UpdateDramaVisualStyleTemplateDto } from '../dto/drama-visual-style-template.dto';

type StyleCategory = 'live_action' | '2d_animation' | '3d_animation' | 'stop_motion' | 'chinese_traditional' | '2d_art';

interface SystemVisualStyleTemplate {
  styleKey: string;
  displayName: string;
  description: string;
  styleCategory: StyleCategory;
  tags: string[];
  visualGuide: VisualStyleGuide;
  coverUrl?: string;
  promptGuidance: VisualPromptGuidance;
  genreCompatibility: string[];
  audienceTags: string[];
  platformTags: string[];
}


// ── System template data (extracted to JSON for maintainability) ──
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SYSTEM_TEMPLATES: SystemVisualStyleTemplate[] = require('../data/visual-style-system-templates.json') as SystemVisualStyleTemplate[];



@Injectable()
export class DramaVisualStyleTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaVisualStyleTemplateService.name);

  constructor(
    @InjectRepository(DramaVisualStyleTemplateEntity)
    private readonly repo: Repository<DramaVisualStyleTemplateEntity>,
  ) {}

  async onModuleInit() {
    await this.seedSystemTemplates();
  }

  /** 当前系统模板版本号；每次需要更新存量模板时递增 */
  private static readonly SYSTEM_VERSION = 10;

  private async seedSystemTemplates() {
    const VER = DramaVisualStyleTemplateService.SYSTEM_VERSION;
    for (const seed of SYSTEM_TEMPLATES) {
      try {
        const existing = await this.repo.findOne({ where: { userId: IsNull(), styleKey: seed.styleKey } });
        if (!existing) {
          await this.repo.save(this.repo.create({
            userId: null,
            styleKey: seed.styleKey,
            displayName: seed.displayName,
            description: seed.description,
            styleCategory: seed.styleCategory,
            tags: seed.tags,
            visualGuide: seed.visualGuide,
            coverUrl: seed.coverUrl ?? null,
            promptGuidance: seed.promptGuidance,
            genreCompatibility: seed.genreCompatibility,
            audienceTags: seed.audienceTags,
            platformTags: seed.platformTags,
            isSystem: true,
            systemVersion: VER,
            syncedSystemVersion: 0,
          }));
          this.logger.log(`Seeded visual style template: ${seed.styleKey}`);
        } else if (existing.systemVersion < VER) {
          // 版本升级时：对系统字段做全量更新，但保留用户修改过的 visualGuide 字段
          const mergedVisualGuide = existing.isUserModified
            // 用户改过的模板：只补充系统新增字段，不覆盖用户修改过的其他字段
            ? {
                ...existing.visualGuide,
                facePromptRule: existing.visualGuide.facePromptRule ?? seed.visualGuide.facePromptRule,
                scenePromptGuidance: existing.visualGuide.scenePromptGuidance ?? seed.visualGuide.scenePromptGuidance,
                scriptDialogueGuide: existing.visualGuide.scriptDialogueGuide ?? seed.visualGuide.scriptDialogueGuide,
                shotStyleGuide: existing.visualGuide.shotStyleGuide ?? seed.visualGuide.shotStyleGuide,
                characterStylePrompt: existing.visualGuide.characterStylePrompt ?? seed.visualGuide.characterStylePrompt,
              }
            // 系统模板：全量更新
            : seed.visualGuide;
          await this.repo.save({ ...existing, ...seed, visualGuide: mergedVisualGuide, isSystem: true, systemVersion: VER });
          this.logger.log(`Updated visual style template: ${seed.styleKey} → v${VER}`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed visual style template ${seed.styleKey}: ${err}`);
      }
    }
  }

  /** 获取模板列表：如果传入 userId，则返回该用户的全量模板（包含系统模板的用户副本和用户自定义模板） */
  async list(userId?: string): Promise<DramaVisualStyleTemplateEntity[]> {
    if (!userId) {
      // 没有任何 userId，仅返回系统根模板
      return this.repo.find({ where: { userId: IsNull() }, order: { styleCategory: 'ASC', styleKey: 'ASC' } });
    }
    // 1. 获取用户已有的所有模板（自定义模板 + 系统模板的副本）
    // 2. 获取所有的系统根模板
    const [userCopies, systemRoots] = await Promise.all([
      this.repo.find({ where: { userId }, order: { styleCategory: 'ASC', styleKey: 'ASC' } }),
      this.repo.find({ where: { userId: IsNull() }, order: { styleCategory: 'ASC', styleKey: 'ASC' } }),
    ]);
    
    // 同步：为用户创建尚未拥有的系统模板副本，或者更新已有的副本
    await this.syncSystemTemplates(userId, userCopies, systemRoots);
    
    // 重新查询以获取用户最新的私有模板库
    const userTemplates = await this.repo.find({ where: { userId }, order: { styleCategory: 'ASC', styleKey: 'ASC' } });
    
    // BUG FIX补充：由于之前直接用 [{ userId }, { userId: IsNull() }] 会导致系统模板和用户副本同时返回，出现重复。
    // 这里改进为：以用户副本为主，如果有极个别系统模板刚好同步失败（兜底逻辑），则把系统根模板合并进来。
    const userStyleKeys = new Set(userTemplates.map(t => t.styleKey));
    const missingSystemRoots = systemRoots.filter(sys => !userStyleKeys.has(sys.styleKey));
    
    return [...userTemplates, ...missingSystemRoots].sort((a, b) => {
      if (a.styleCategory === b.styleCategory) {
        return a.styleKey.localeCompare(b.styleKey);
      }
      return a.styleCategory.localeCompare(b.styleCategory);
    });
  }

  /** 
   * 核心基础：因为用户可能会自定义某个"系统模板"中的脸部Prompt等，
   * 系统采用「写时复制 / 预分配副本」模式：每个用户都拥有属于自己的系统模板拷贝。
   */
  private async syncSystemTemplates(
    userId: string,
    userCopies: DramaVisualStyleTemplateEntity[],
    systemRoots: DramaVisualStyleTemplateEntity[],
  ) {
    const userCopyMap = new Map(userCopies.map(c => [c.styleKey, c]));
    for (const sys of systemRoots) {
      const existing = userCopyMap.get(sys.styleKey);
      if (!existing) {
        // 用户没有此模板副本：创建
        try {
          await this.repo.save(this.repo.create({
            userId,
            styleKey: sys.styleKey,
            displayName: sys.displayName,
            description: sys.description,
            styleCategory: sys.styleCategory,
            tags: sys.tags,
            visualGuide: sys.visualGuide,
            coverUrl: sys.coverUrl,
            promptGuidance: sys.promptGuidance,
            genreCompatibility: sys.genreCompatibility,
            audienceTags: sys.audienceTags,
            platformTags: sys.platformTags,
            isSystem: true,
            parentTemplateId: sys.id,
            systemVersion: sys.systemVersion,
            syncedSystemVersion: sys.systemVersion,
            isUserModified: false,
          }));
        } catch {
          // 可能并发重复创建，忽略
        }
      } else if (existing.syncedSystemVersion < sys.systemVersion) {
        // 用户已有副本，但系统模板有更新：差量同步
        try {
          const mergedVisualGuide = existing.isUserModified
            // 用户修改过的副本：只补充系统新增字段（null/undefined 才填入），不覆盖用户已有设置
            ? {
                ...existing.visualGuide,
                facePromptRule: existing.visualGuide.facePromptRule ?? sys.visualGuide.facePromptRule,
                scenePromptGuidance: existing.visualGuide.scenePromptGuidance ?? sys.visualGuide.scenePromptGuidance,
                scriptDialogueGuide: existing.visualGuide.scriptDialogueGuide ?? sys.visualGuide.scriptDialogueGuide,
                shotStyleGuide: existing.visualGuide.shotStyleGuide ?? sys.visualGuide.shotStyleGuide,
              }
            // 用户未修改过的副本：全量同步系统最新内容
            : sys.visualGuide;
          await this.repo.save({
            ...existing,
            displayName: existing.isUserModified ? existing.displayName : sys.displayName,
            description: existing.isUserModified ? existing.description : sys.description,
            tags: existing.isUserModified ? existing.tags : sys.tags,
            visualGuide: mergedVisualGuide,
            coverUrl: existing.isUserModified ? existing.coverUrl : sys.coverUrl,
            promptGuidance: existing.isUserModified ? existing.promptGuidance : sys.promptGuidance,
            genreCompatibility: existing.isUserModified ? existing.genreCompatibility : sys.genreCompatibility,
            audienceTags: existing.isUserModified ? existing.audienceTags : sys.audienceTags,
            platformTags: existing.isUserModified ? existing.platformTags : sys.platformTags,
            systemVersion: sys.systemVersion,
            syncedSystemVersion: sys.systemVersion,
          });
          this.logger.log(`Synced visual style template for user ${userId}: ${sys.styleKey} → v${sys.systemVersion}`);
        } catch (err) {
          this.logger.warn(`Failed to sync template ${sys.styleKey} for user ${userId}: ${err}`);
        }
      }
    }
  }

  async getById(id: string): Promise<DramaVisualStyleTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`Visual style template ${id} not found`);
    return tpl;
  }

  async create(userId: string, dto: CreateDramaVisualStyleTemplateDto): Promise<DramaVisualStyleTemplateEntity> {
    return this.repo.save(this.repo.create({
      userId,
      styleKey: dto.styleKey,
      displayName: dto.displayName,
      description: dto.description ?? '',
      styleCategory: (dto.styleCategory as any) ?? 'live_action',
      tags: dto.tags ?? [],
      visualGuide: (dto.visualGuide as any) ?? { overallAesthetic: '', colorGrading: '', lightingStyle: '', era: 'contemporary' },
      promptGuidance: (dto.promptGuidance as any) ?? null,
      genreCompatibility: dto.genreCompatibility ?? [],
      audienceTags: dto.audienceTags ?? [],
      platformTags: dto.platformTags ?? [],
      isSystem: false,
      systemVersion: 1,
      syncedSystemVersion: 0,
      isUserModified: false,
    }));
  }

  async update(id: string, userId: string, dto: UpdateDramaVisualStyleTemplateDto): Promise<DramaVisualStyleTemplateEntity> {
    const tpl = await this.getById(id);
    // 禁止直接修改无 userId 归属的系统根模板
    if (tpl.isSystem && tpl.userId === null) {
      throw new Error('Cannot modify system root template');
    }
    // 当用户修改了这份模板副本后，打上 isUserModified = true，这会导致将来系统模板版本升级时部分字段不再被强行覆盖
    const updated: Partial<DramaVisualStyleTemplateEntity> = { isUserModified: true };
    if (dto.displayName !== undefined) updated.displayName = dto.displayName;
    if (dto.description !== undefined) updated.description = dto.description;
    if (dto.styleCategory !== undefined) updated.styleCategory = dto.styleCategory as any;
    if (dto.tags !== undefined) updated.tags = dto.tags;
    if (dto.visualGuide !== undefined) updated.visualGuide = dto.visualGuide as any;
    if (dto.promptGuidance !== undefined) updated.promptGuidance = dto.promptGuidance as any;
    if (dto.genreCompatibility !== undefined) updated.genreCompatibility = dto.genreCompatibility;
    if (dto.audienceTags !== undefined) updated.audienceTags = dto.audienceTags;
    if (dto.platformTags !== undefined) updated.platformTags = dto.platformTags;
    await this.repo.save({ ...tpl, ...updated });
    return this.getById(id);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const tpl = await this.getById(id);
    // 修改逻辑：不允许删除任何标记为 isSystem 的模板。
    // 如果允许删除用户自己的系统模板副本，那么下次调 list() 时又会被自动补齐回来，没有意义且让人困惑。
    if (tpl.isSystem) {
      throw new Error('Cannot delete system template');
    }
    await this.repo.remove(tpl);
    return { success: true };
  }

  async clone(id: string, userId: string): Promise<DramaVisualStyleTemplateEntity> {
    // 允许用户基于现有模板（可以是他的副本也可以是根系统模板）克隆出一个新的、完全属于他的独立"自定义模板"
    const tpl = await this.getById(id);
    const newKey = `${tpl.styleKey}_copy_${Date.now()}`;
    return this.repo.save(this.repo.create({
      userId,
      styleKey: newKey,
      displayName: `${tpl.displayName} (副本)`,
      description: tpl.description,
      styleCategory: tpl.styleCategory,
      tags: [...tpl.tags],
      visualGuide: { ...tpl.visualGuide },
      promptGuidance: tpl.promptGuidance ? { ...tpl.promptGuidance } : null,
      genreCompatibility: [...tpl.genreCompatibility],
      audienceTags: [...tpl.audienceTags],
      platformTags: [...tpl.platformTags],
      isSystem: false,
      parentTemplateId: tpl.id,
      systemVersion: 1,
      syncedSystemVersion: 0,
      isUserModified: false,
    }));
  }

  /** 根据风格提示文本找到最匹配的模板 */
  async findBestMatch(styleHint: string, userId?: string): Promise<DramaVisualStyleTemplateEntity | null> {
    const templates = await this.list(userId);
    if (!templates.length) return null;
    const hint = styleHint.toLowerCase();
    // 简单关键词匹配
    for (const tpl of templates) {
      const allText = [tpl.styleKey, tpl.displayName, ...tpl.tags].join(' ').toLowerCase();
      if (allText.includes(hint)) return tpl;
    }
    return templates[0];
  }
}
