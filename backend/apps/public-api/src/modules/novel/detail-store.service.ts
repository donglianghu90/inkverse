import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArtifactEntity } from './entities/artifact.entity';
import {
  CharacterDetail,
  CharacterDescriptionSnippet,
  CharacterSignatureAction,
  DetailStore,
  DetailStoreChapterUpdates,
  EMPTY_DETAIL_STORE,
  ItemDetail,
  ItemDescriptionSnippet,
  ItemSensorySignature,
  ItemActivationEffect,
  LocationDetail,
  LocationDescriptionSnippet,
  LocationSensoryAnchor,
  LocationVisitMemory,
} from './detail-store.schemas';

/**
 * 细节仓持久化服务：
 * - 基于 ArtifactEntity(bookId, chapter=0, name='detail_store') 存储
 * - 维护角色 + 地点 + 道具细节（感官锚点、访问记忆、描写片段等）
 */
@Injectable()
export class DetailStoreService {
  private static readonly ARTIFACT_NAME = 'detail_store';
  private static readonly ARTIFACT_CHAPTER = 0;

  constructor(
    @InjectRepository(ArtifactEntity)
    private readonly artifactRepo: Repository<ArtifactEntity>,
  ) {}

  /**
   * 加载整本书的 DetailStore。如果不存在则返回空壳。
   */
  async load(bookId: string): Promise<DetailStore> {
    const artifact = await this.artifactRepo.findOne({
      where: {
        bookId,
        chapterNumber: DetailStoreService.ARTIFACT_CHAPTER,
        name: DetailStoreService.ARTIFACT_NAME,
      },
    });

    if (!artifact) {
      return { ...EMPTY_DETAIL_STORE };
    }

    const payload = artifact.payload ?? {};
    const characters = Array.isArray((payload as any).characters)
      ? ((payload as any).characters as CharacterDetail[])
      : [];
    const locations = Array.isArray((payload as any).locations)
      ? ((payload as any).locations as LocationDetail[])
      : [];
    const items = Array.isArray((payload as any).items)
      ? ((payload as any).items as ItemDetail[])
      : [];

    return {
      characters,
      locations,
      items,
    };
  }

  /**
   * 整体保存 DetailStore。
   */
  async save(bookId: string, store: DetailStore): Promise<void> {
    const payload = {
      characters: store.characters ?? [],
      locations: store.locations ?? [],
      items: store.items ?? [],
    };
    await this.artifactRepo.upsert(
      {
        bookId,
        chapterNumber: DetailStoreService.ARTIFACT_CHAPTER,
        name: DetailStoreService.ARTIFACT_NAME,
        payload: payload as any,
      },
      ['bookId', 'chapterNumber', 'name'],
    );
  }

  /**
   * 读取指定角色的细节档案（不存在则返回空数组）。
   */
  async getCharacterDetails(
    bookId: string,
    characterIds: string[],
  ): Promise<CharacterDetail[]> {
    if (characterIds.length === 0) return [];
    const store = await this.load(bookId);
    const idSet = new Set(characterIds);
    return store.characters.filter((c) => idSet.has(c.characterId));
  }

  /**
   * 为某个角色追加/合并签名动作与描写片段。
   *
   * - 不会覆盖原有记录，只做去重追加
   * - 适合作为 recorder 之后的轻量写入步骤
   */
  async upsertCharacterDetail(
    bookId: string,
    characterId: string,
    options: {
      signatureActions?: CharacterSignatureAction[];
      descriptionSnippets?: CharacterDescriptionSnippet[];
    },
  ): Promise<void> {
    const store = await this.load(bookId);
    const existingIndex = store.characters.findIndex(
      (c) => c.characterId === characterId,
    );

    let detail: CharacterDetail;
    if (existingIndex >= 0) {
      detail = { ...store.characters[existingIndex] };
    } else {
      detail = {
        characterId,
        signatureActions: [],
        descriptionSnippets: [],
      };
    }

    if (options.signatureActions?.length) {
      const merged: CharacterSignatureAction[] = [...detail.signatureActions];
      for (const act of options.signatureActions) {
        if (!act.action.trim()) continue;
        const key = act.action.trim();
        const exists = merged.some((a) => a.action.trim() === key);
        if (!exists) {
          merged.push({
            action: key,
            trigger: act.trigger,
            confidence: act.confidence ?? 0.8,
          });
        }
      }
      detail.signatureActions = merged;
    }

    if (options.descriptionSnippets?.length) {
      const merged: CharacterDescriptionSnippet[] = [
        ...detail.descriptionSnippets,
      ];
      for (const snip of options.descriptionSnippets) {
        const text = snip.text.trim();
        if (!text) continue;
        const duplicate = merged.some(
          (s) =>
            s.chapterNumber === snip.chapterNumber &&
            s.type === snip.type &&
            s.text.trim() === text,
        );
        if (!duplicate) {
          merged.push({
            chapterNumber: snip.chapterNumber,
            type: snip.type,
            text,
          });
        }
      }
      // 可按章节排序，越新的在后
      merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
      detail.descriptionSnippets = merged;
    }

    if (existingIndex >= 0) {
      store.characters[existingIndex] = detail;
    } else {
      store.characters.push(detail);
    }

    await this.save(bookId, store);
  }

  /**
   * 读取指定地点的细节档案（不存在则返回空数组）。
   */
  async getLocationDetails(
    bookId: string,
    locationIds: string[],
  ): Promise<LocationDetail[]> {
    if (locationIds.length === 0) return [];
    const store = await this.load(bookId);
    const idSet = new Set(locationIds);
    return (store.locations ?? []).filter((l) => idSet.has(l.locationId));
  }

  /**
   * 为某个地点追加/合并感官锚点、访问记忆与描写片段。
   */
  async upsertLocationDetail(
    bookId: string,
    locationId: string,
    options: {
      sensoryAnchors?: LocationSensoryAnchor[];
      visitMemories?: LocationVisitMemory[];
      descriptionSnippets?: LocationDescriptionSnippet[];
    },
  ): Promise<void> {
    const store = await this.load(bookId);
    const locations = store.locations ?? [];
    const existingIndex = locations.findIndex((l) => l.locationId === locationId);

    let detail: LocationDetail;
    if (existingIndex >= 0) {
      detail = { ...locations[existingIndex] };
    } else {
      detail = {
        locationId,
        sensoryAnchors: [],
        visitMemories: [],
        descriptionSnippets: [],
      };
    }

    if (options.sensoryAnchors?.length) {
      const merged = [...(detail.sensoryAnchors ?? [])];
      for (const a of options.sensoryAnchors) {
        if (!a.description?.trim()) continue;
        const key = `${a.sense}:${a.description.trim()}`;
        if (!merged.some((x) => `${x.sense}:${x.description}` === key)) {
          merged.push({
            sense: a.sense,
            description: a.description.trim(),
            isLandmark: a.isLandmark ?? false,
          });
        }
      }
      detail.sensoryAnchors = merged;
    }

    if (options.visitMemories?.length) {
      const merged = [...(detail.visitMemories ?? [])];
      for (const v of options.visitMemories) {
        const duplicate = merged.some(
          (m) =>
            m.chapterNumber === v.chapterNumber &&
            m.characterId === v.characterId &&
            m.event === v.event,
        );
        if (!duplicate) {
          merged.push({
            chapterNumber: v.chapterNumber,
            characterId: v.characterId,
            event: v.event,
            emotionalTone: v.emotionalTone ?? '',
          });
        }
      }
      merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
      detail.visitMemories = merged;
    }

    if (options.descriptionSnippets?.length) {
      const merged = [...(detail.descriptionSnippets ?? [])];
      for (const snip of options.descriptionSnippets) {
        const text = snip.text.trim();
        if (!text) continue;
        const duplicate = merged.some(
          (s) =>
            s.chapterNumber === snip.chapterNumber &&
            s.type === snip.type &&
            s.text.trim() === text,
        );
        if (!duplicate) {
          merged.push({
            chapterNumber: snip.chapterNumber,
            type: snip.type,
            text,
          });
        }
      }
      merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
      detail.descriptionSnippets = merged;
    }

    if (existingIndex >= 0) {
      locations[existingIndex] = detail;
    } else {
      locations.push(detail);
    }
    store.locations = locations;
    await this.save(bookId, store);
  }

  /**
   * 读取指定道具的细节档案（不存在则返回空数组）。
   */
  async getItemDetails(
    bookId: string,
    itemIds: string[],
  ): Promise<ItemDetail[]> {
    if (itemIds.length === 0) return [];
    const store = await this.load(bookId);
    const idSet = new Set(itemIds);
    return (store.items ?? []).filter((i) => idSet.has(i.itemId));
  }

  /**
   * 为某个道具追加/合并感官签名、使用效果与描写片段。
   */
  async upsertItemDetail(
    bookId: string,
    itemId: string,
    options: {
      sensorySignature?: Partial<ItemSensorySignature>;
      activationEffects?: ItemActivationEffect[];
      descriptionSnippets?: ItemDescriptionSnippet[];
    },
  ): Promise<void> {
    const store = await this.load(bookId);
    const items = store.items ?? [];
    const existingIndex = items.findIndex((i) => i.itemId === itemId);

    let detail: ItemDetail;
    if (existingIndex >= 0) {
      detail = { ...items[existingIndex] };
    } else {
      detail = {
        itemId,
        activationEffects: [],
        descriptionSnippets: [],
      };
    }

    if (options.sensorySignature && Object.keys(options.sensorySignature).length > 0) {
      const next = { ...(detail.sensorySignature ?? {}) };
      for (const [k, v] of Object.entries(options.sensorySignature)) {
        if (v != null && String(v).trim()) next[k as keyof ItemSensorySignature] = String(v).trim();
      }
      detail.sensorySignature = next;
    }

    if (options.activationEffects?.length) {
      const merged = [...(detail.activationEffects ?? [])];
      for (const e of options.activationEffects) {
        const duplicate = merged.some(
          (m) => m.chapterNumber === e.chapterNumber && m.description === e.description,
        );
        if (!duplicate && e.description?.trim()) {
          merged.push({ chapterNumber: e.chapterNumber, description: e.description.trim() });
        }
      }
      merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
      detail.activationEffects = merged;
    }

    if (options.descriptionSnippets?.length) {
      const merged = [...(detail.descriptionSnippets ?? [])];
      for (const snip of options.descriptionSnippets) {
        const text = snip.text.trim();
        if (!text) continue;
        const duplicate = merged.some(
          (s) =>
            s.chapterNumber === snip.chapterNumber &&
            s.type === snip.type &&
            s.text.trim() === text,
        );
        if (!duplicate) {
          merged.push({
            chapterNumber: snip.chapterNumber,
            type: snip.type,
            text,
          });
        }
      }
      merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
      detail.descriptionSnippets = merged;
    }

    if (existingIndex >= 0) {
      items[existingIndex] = detail;
    } else {
      items.push(detail);
    }
    store.items = items;
    await this.save(bookId, store);
  }

  /**
   * 单章批量更新：一次 load → 合并所有角色/地点/道具更新 → 一次 save。
   * 避免并行多次 upsert 导致后写入覆盖前写入（丢失更新）。
   */
  async applyChapterUpdates(
    bookId: string,
    updates: DetailStoreChapterUpdates,
  ): Promise<void> {
    const store = await this.load(bookId);
    const characters = [...(store.characters ?? [])];
    const locations = [...(store.locations ?? [])];
    const items = [...(store.items ?? [])];

    for (const u of updates.characterUpdates ?? []) {
      const idx = characters.findIndex((c) => c.characterId === u.characterId);
      let d: CharacterDetail =
        idx >= 0 ? { ...characters[idx] } : { characterId: u.characterId, signatureActions: [], descriptionSnippets: [] };
      if (u.signatureActions?.length) {
        const merged = [...d.signatureActions];
        for (const a of u.signatureActions) {
          if (!a.action.trim()) continue;
          if (!merged.some((x) => x.action.trim() === a.action.trim())) {
            merged.push({ action: a.action.trim(), trigger: a.trigger, confidence: a.confidence ?? 0.8 });
          }
        }
        d.signatureActions = merged;
      }
      if (u.descriptionSnippets?.length) {
        const merged = [...d.descriptionSnippets];
        for (const s of u.descriptionSnippets) {
          const text = s.text.trim();
          if (!text || merged.some((x) => x.chapterNumber === s.chapterNumber && x.type === s.type && x.text.trim() === text)) continue;
          merged.push({ chapterNumber: s.chapterNumber, type: s.type, text });
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        d.descriptionSnippets = merged;
      }
      if (idx >= 0) characters[idx] = d;
      else characters.push(d);
    }

    for (const u of updates.locationUpdates ?? []) {
      const idx = locations.findIndex((l) => l.locationId === u.locationId);
      let d: LocationDetail =
        idx >= 0 ? { ...locations[idx] } : { locationId: u.locationId, sensoryAnchors: [], visitMemories: [], descriptionSnippets: [] };
      if (u.sensoryAnchors?.length) {
        const merged = [...(d.sensoryAnchors ?? [])];
        for (const a of u.sensoryAnchors) {
          if (!a.description?.trim()) continue;
          const key = `${a.sense}:${a.description.trim()}`;
          if (!merged.some((x) => `${x.sense}:${x.description}` === key)) {
            merged.push({ sense: a.sense, description: a.description.trim(), isLandmark: a.isLandmark ?? false });
          }
        }
        d.sensoryAnchors = merged;
      }
      if (u.visitMemories?.length) {
        const merged = [...(d.visitMemories ?? [])];
        for (const v of u.visitMemories) {
          if (!merged.some((m) => m.chapterNumber === v.chapterNumber && m.characterId === v.characterId && m.event === v.event)) {
            merged.push({ chapterNumber: v.chapterNumber, characterId: v.characterId, event: v.event, emotionalTone: v.emotionalTone ?? '' });
          }
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        d.visitMemories = merged;
      }
      if (u.descriptionSnippets?.length) {
        const merged = [...(d.descriptionSnippets ?? [])];
        for (const s of u.descriptionSnippets) {
          const text = s.text.trim();
          if (!text || merged.some((x) => x.chapterNumber === s.chapterNumber && x.type === s.type && x.text.trim() === text)) continue;
          merged.push({ chapterNumber: s.chapterNumber, type: s.type, text });
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        d.descriptionSnippets = merged;
      }
      if (idx >= 0) locations[idx] = d;
      else locations.push(d);
    }

    for (const u of updates.itemUpdates ?? []) {
      const idx = items.findIndex((i) => i.itemId === u.itemId);
      let d: ItemDetail =
        idx >= 0 ? { ...items[idx] } : { itemId: u.itemId, activationEffects: [], descriptionSnippets: [] };
      if (u.sensorySignature && Object.keys(u.sensorySignature).length > 0) {
        const next = { ...(d.sensorySignature ?? {}) };
        for (const [k, v] of Object.entries(u.sensorySignature)) {
          if (v != null && String(v).trim()) next[k as keyof ItemSensorySignature] = String(v).trim();
        }
        d.sensorySignature = next;
      }
      if (u.activationEffects?.length) {
        const merged = [...(d.activationEffects ?? [])];
        for (const e of u.activationEffects) {
          if (e.description?.trim() && !merged.some((m) => m.chapterNumber === e.chapterNumber && m.description === e.description)) {
            merged.push({ chapterNumber: e.chapterNumber, description: e.description.trim() });
          }
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        d.activationEffects = merged;
      }
      if (u.descriptionSnippets?.length) {
        const merged = [...(d.descriptionSnippets ?? [])];
        for (const s of u.descriptionSnippets) {
          const text = s.text.trim();
          if (!text || merged.some((x) => x.chapterNumber === s.chapterNumber && x.type === s.type && x.text.trim() === text)) continue;
          merged.push({ chapterNumber: s.chapterNumber, type: s.type, text });
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        d.descriptionSnippets = merged;
      }
      if (idx >= 0) items[idx] = d;
      else items.push(d);
    }

    store.characters = characters;
    store.locations = locations;
    store.items = items;
    await this.save(bookId, store);
  }
}

