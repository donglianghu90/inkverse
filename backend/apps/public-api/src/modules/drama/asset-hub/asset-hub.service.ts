/** 全局资产服务 — CRUD + 复制到剧集 + 从剧集提取 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GlobalAssetFolderEntity, GlobalCharacterEntity, GlobalLocationEntity, GlobalStyleEntity } from './entities/asset-hub.entity';
import { VisualAssetEntity } from '../entities/visual-asset.entity';

@Injectable()
export class AssetHubService {
  private readonly logger = new Logger(AssetHubService.name);

  constructor(
    @InjectRepository(GlobalAssetFolderEntity) private readonly folderRepo: Repository<GlobalAssetFolderEntity>,
    @InjectRepository(GlobalCharacterEntity) private readonly charRepo: Repository<GlobalCharacterEntity>,
    @InjectRepository(GlobalLocationEntity) private readonly locRepo: Repository<GlobalLocationEntity>,
    @InjectRepository(GlobalStyleEntity) private readonly styleRepo: Repository<GlobalStyleEntity>,
    @InjectRepository(VisualAssetEntity) private readonly visualAssetRepo: Repository<VisualAssetEntity>,
  ) {}

  // ═══ 文件夹 ═══
  async createFolder(userId: string, name: string) { return this.folderRepo.save(this.folderRepo.create({ userId, name })); }
  async listFolders(userId: string) { return this.folderRepo.find({ where: { userId }, order: { createdAt: 'ASC' } }); }
  async deleteFolder(userId: string, folderId: string) { await this.folderRepo.delete({ id: folderId, userId }); }

  // ═══ 角色 CRUD ═══
  async createCharacter(userId: string, data: Partial<GlobalCharacterEntity>) { return this.charRepo.save(this.charRepo.create({ ...data, userId })); }
  async listCharacters(userId: string, folderId?: string) { const w: any = { userId }; if (folderId) w.folderId = folderId; return this.charRepo.find({ where: w, order: { createdAt: 'DESC' } }); }
  async getCharacter(userId: string, id: string) { const c = await this.charRepo.findOne({ where: { id, userId } }); if (!c) throw new NotFoundException('角色不存在'); return c; }
  async updateCharacter(userId: string, id: string, data: Partial<GlobalCharacterEntity>) { await this.charRepo.update({ id, userId }, data); return this.getCharacter(userId, id); }
  async deleteCharacter(userId: string, id: string) { await this.charRepo.delete({ id, userId }); }

  // ═══ 场景 CRUD ═══
  async createLocation(userId: string, data: Partial<GlobalLocationEntity>) { return this.locRepo.save(this.locRepo.create({ ...data, userId })); }
  async listLocations(userId: string, folderId?: string) { const w: any = { userId }; if (folderId) w.folderId = folderId; return this.locRepo.find({ where: w, order: { createdAt: 'DESC' } }); }
  async getLocation(userId: string, id: string) { const l = await this.locRepo.findOne({ where: { id, userId } }); if (!l) throw new NotFoundException('场景不存在'); return l; }
  async deleteLocation(userId: string, id: string) { await this.locRepo.delete({ id, userId }); }

  // ═══ 风格 CRUD ═══
  async createStyle(userId: string, data: Partial<GlobalStyleEntity>) { return this.styleRepo.save(this.styleRepo.create({ ...data, userId })); }
  async listStyles(userId: string) { return this.styleRepo.find({ where: { userId }, order: { createdAt: 'DESC' } }); }
  async deleteStyle(userId: string, id: string) { await this.styleRepo.delete({ id, userId }); }

  // ═══ 复制到剧集（从全局资产创建剧集内资产） ═══
  async copyCharacterToDrama(userId: string, globalCharId: string, dramaId: string): Promise<VisualAssetEntity> {
    const gc = await this.getCharacter(userId, globalCharId);
    return this.visualAssetRepo.save(this.visualAssetRepo.create({
      dramaId, assetType: 'character', refId: gc.id, name: gc.name,
      data: { ...gc.profileData, faceReferencePrompt: gc.faceReferencePrompt, variations: gc.variations, sourceGlobalCharacterId: gc.id },
      referenceImageUrl: gc.referenceImageUrl ?? '',
    }));
  }

  async copyLocationToDrama(userId: string, globalLocId: string, dramaId: string): Promise<VisualAssetEntity> {
    const gl = await this.getLocation(userId, globalLocId);
    return this.visualAssetRepo.save(this.visualAssetRepo.create({
      dramaId, assetType: 'location', refId: gl.id, name: gl.name,
      data: { visualPrompt: gl.visualPrompt, summary: gl.summary, sourceGlobalLocationId: gl.id },
      referenceImageUrl: gl.referenceImageUrl ?? '',
    }));
  }

  // ═══ 从剧集提取到全局（反向同步） ═══
  async extractFromDrama(userId: string, dramaId: string, assetId: string, folderId?: string): Promise<GlobalCharacterEntity | GlobalLocationEntity> {
    const va = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!va) throw new NotFoundException('资产不存在');
    const data = va.data as Record<string, unknown>;
    if (va.assetType === 'character') {
      return this.charRepo.save(this.charRepo.create({ userId, folderId, name: va.name, profileData: data, faceReferencePrompt: String(data.faceReferencePrompt ?? ''), referenceImageUrl: va.referenceImageUrl, variations: (data.variations as any) ?? [] }));
    }
    return this.locRepo.save(this.locRepo.create({ userId, folderId, name: va.name, visualPrompt: String(data.visualPrompt ?? ''), summary: String(data.summary ?? ''), referenceImageUrl: va.referenceImageUrl }));
  }
}
