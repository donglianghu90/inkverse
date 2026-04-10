/** ShotContextBuilderService — Shot 级上下文构建（角色锁定、样式锁定、Prompt拼装、参考图） */
import { Injectable } from '@nestjs/common';
import type { Shot, DramaState } from '../schemas/drama-state.schemas';
import type {
  RenderingProfile, RefImageCandidate, CharacterImageSet, CharacterViewAngle,
} from '../../media/rendering/rendering-profile';
import { selectRefImages, selectBestCharacterView } from '../../media/rendering/rendering-profile';

@Injectable()
export class ShotContextBuilderService {

  // ── 角色上下文 ──────────────────────────────────────────────

  /** 从 visualBible.identityPack 构建 characterId → anchorImageURLs 映射 */
  buildCharacterAnchorMap(state: DramaState): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const pack of state.visualBible?.identityPack ?? []) {
      const urls = [pack.anchorImages?.faceFront, pack.anchorImages?.face34, pack.anchorImages?.upperOrFull]
        .filter((u): u is string => typeof u === 'string' && !!u.trim());
      if (!urls.length) continue;
      map.set(pack.characterId, [...new Set(urls)]);
    }
    return map;
  }

  /** 解析 shot 中锁定的角色 ID 列表 */
  resolveLockedCharacterIds(shot: Shot): string[] {
    const ids: string[] = [];
    for (const ref of shot.characterLockRefs ?? []) {
      const id = this.parseCharacterIdFromLockRef(ref);
      if (!id) continue;
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length) return ids;
    for (const c of shot.characters ?? []) {
      if (c?.characterId && !ids.includes(c.characterId)) ids.push(c.characterId);
    }
    return ids;
  }

  /** 解析单个 lockRef 字符串中的 characterId */
  parseCharacterIdFromLockRef(lockRef: string): string | null {
    if (!lockRef) return null;
    if (lockRef.startsWith('character:')) {
      const cid = lockRef.slice('character:'.length).trim();
      return cid || null;
    }
    if (lockRef.startsWith('vb:')) {
      const parts = lockRef.split(':');
      return parts[2]?.trim() || null;
    }
    if (!lockRef.includes(':')) return lockRef.trim() || null;
    return null;
  }

  // ── 样式锁定 ──────────────────────────────────────────────

  /** 将 styleLock token 前置合并到 basePrompt */
  applyStyleLockPrompt(basePrompt: string, shot: Shot, state: DramaState): string {
    const styleTokens = this.resolveStyleLockTokens(shot, state);
    if (!styleTokens.length) return basePrompt;
    return this.mergePromptSegments([...styleTokens, basePrompt]);
  }

  /** 从 shot.styleLockRef + visualBible 中解析样式 token */
  resolveStyleLockTokens(shot: Shot, state: DramaState): string[] {
    const ref = (shot.styleLockRef ?? '').trim();
    const tokens: string[] = [];
    const push = (value: string) => { if (value && !tokens.includes(value)) tokens.push(value); };

    if (ref.startsWith('vb-style:')) {
      for (const t of state.visualBible?.stylePack?.styleTokens ?? []) push(t);
      const lut = state.visualBible?.stylePack?.colorLutHint ?? '';
      if (lut) push(lut);
      return tokens.slice(0, 8);
    }

    if (ref.startsWith('style:')) {
      ref.slice('style:'.length).split('|').map(s => s.trim()).filter(Boolean).forEach(push);
      return tokens.slice(0, 8);
    }

    if (ref) {
      if (ref.includes('|')) ref.split('|').map(s => s.trim()).filter(Boolean).forEach(push);
      else push(ref);
    }
    return tokens.slice(0, 8);
  }

  // ── Prompt 工具 ──────────────────────────────────────────────

  /** 合并多段 prompt，去重comma-separated segment */
  mergePromptSegments(chunks: string[]): string {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (!chunk) continue;
      for (const segment of chunk.split(',').map(s => s.trim()).filter(Boolean)) {
        const key = segment.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(segment);
      }
    }
    return deduped.join(', ');
  }

  // ── 参考图构建 ──────────────────────────────────────────────

  /** 构建参考图候选列表，按镜头角度匹配最佳角色视角 + RenderingProfile 优先级筛选 */
  buildRefImages(
    shot: Shot, charMap: Map<string, CharacterImageSet>, varMap: Map<string, string>,
    anchorMap: Map<string, string[]>,
    styleRefs: string[],
    sceneCache: Map<string, string>, prevFrameCache: Map<number, string>,
    frameType: 'first' | 'last',
    profile: RenderingProfile,
    tempCharCache?: Map<string, string>,
    /** 签名道具参考图：propId → imageUrl。medium+ 景别自动注入，提高道具外观一致性 */
    propImageMap?: Map<string, string>,
    /** 签名道具归属：characterId → propId[]。用于查找当前 shot 角色关联的道具 */
    propOwnerMap?: Map<string, string[]>,
  ): Array<{ url: string; weight: number }> {
    const isCloseUp = ['close_up', 'extreme_close_up', 'medium_close_up'].includes(shot.camera?.shotSize ?? '');
    const charWeight = isCloseUp ? 0.6 : 0.4;
    const lockCharWeight = isCloseUp ? 0.8 : 0.55;
    const sceneWeight = isCloseUp ? 0.2 : 0.4;
    const styleWeight = isCloseUp ? 0.1 : 0.2;

    // insert 道具镜头：prompt 要求 "no people, no hands"，
    // 如果参考图中混入人脸定妆照，T2I 模型会在"画道具"和"画人脸"之间严重困惑。
    // 仅保留 scene/style/prev_frame 参考图，跳过所有 character_face。
    const isInsert = shot.shotType === 'insert';

    const candidates: RefImageCandidate[] = [];
    const seenUrls = new Set<string>();
    const pushCandidate = (url: string | undefined, weight: number, role: RefImageCandidate['role']) => {
      if (!url) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      candidates.push({ url, weight, role });
    };

    if (shot.sceneId && sceneCache.has(shot.sceneId)) {
      pushCandidate(sceneCache.get(shot.sceneId), sceneWeight, 'scene');
    }

    // insert 镜头跳过角色参考图（避免人脸照与 "no people" prompt 冲突）
    if (!isInsert) {
      const lockedIds = this.resolveLockedCharacterIds(shot);
      for (const cid of lockedIds) {
        const varId = shot.characterVariationIds?.[cid];
        const varUrl = varId ? varMap.get(`${cid}_${varId}`) : undefined;
        if (varUrl) {
          pushCandidate(varUrl, lockCharWeight, 'character_face');
        }
        const anchorUrls = anchorMap.get(cid) ?? [];
        for (const anchorUrl of anchorUrls) {
          pushCandidate(anchorUrl, lockCharWeight, 'character_face');
        }
        const imageSet = charMap.get(cid);
        if (imageSet?.primary) {
          pushCandidate(imageSet.primary, lockCharWeight, 'character_face');
        }
      }

      (shot.characters ?? []).forEach(c => {
        const varId = shot.characterVariationIds?.[c.characterId];
        const varUrl = varId ? varMap.get(`${c.characterId}_${varId}`) : undefined;
        if (varUrl) {
          pushCandidate(varUrl, charWeight, 'character_face');
        } else {
          const imageSet = charMap.get(c.characterId);
          if (imageSet) {
            const availableViews = Object.keys(imageSet.views) as CharacterViewAngle[];
            const bestView = selectBestCharacterView(availableViews, shot.camera?.shotSize, c.position, shot.camera?.cameraAngle, c.emotion);
            const url = imageSet.views[bestView] || imageSet.primary;
            pushCandidate(url, charWeight, 'character_face');
          } else if (tempCharCache?.has(c.characterId)) {
            pushCandidate(tempCharCache.get(c.characterId), charWeight * 0.9, 'character_face');
          }
        }
      });
    }
    if (frameType === 'first' && shot.shotIndex > 0 && prevFrameCache.has(shot.shotIndex - 1)) {
      pushCandidate(prevFrameCache.get(shot.shotIndex - 1), 0.15, 'prev_frame');
    }
    if (styleRefs.length) {
      pushCandidate(styleRefs[0], styleWeight, 'style');
    }

    // 签名道具参考图注入：medium+ 景别（wide/extreme_wide 道具不可见，不注入）
    const isWide = ['wide', 'extreme_wide'].includes(shot.camera?.shotSize ?? '');
    if (!isWide && propImageMap && propOwnerMap) {
      const charIds = isInsert ? [] : this.resolveLockedCharacterIds(shot);
      const allCharIds = [...charIds, ...(shot.characters ?? []).map(c => c.characterId)];
      const seenProps = new Set<string>();
      for (const cid of allCharIds) {
        for (const propId of propOwnerMap.get(cid) ?? []) {
          if (seenProps.has(propId)) continue;
          seenProps.add(propId);
          pushCandidate(propImageMap.get(propId), 0.15, 'style'); // role=style（prop无专属role，复用style slot）
        }
      }
    }

    return selectRefImages(candidates, profile, shot.camera?.shotSize, shot.camera?.cameraAngle);
  }

  /** 收集角色参考图URL（支持变体，I2V 视频生成使用）
   * Kling elements 做身份锁定不关心角度 → 直接用 primary (face_front) 即可 */
  collectRefImages(
    shot: Shot,
    charMap: Map<string, CharacterImageSet>,
    varMap: Map<string, string>,
    anchorMap: Map<string, string[]>,
  ): string[] {
    const urls: string[] = [];
    const push = (url: string | undefined) => {
      if (!url) return;
      if (urls.includes(url)) return;
      urls.push(url);
    };

    for (const cid of this.resolveLockedCharacterIds(shot)) {
      const varId = shot.characterVariationIds?.[cid];
      if (varId) push(varMap.get(`${cid}_${varId}`));
      (anchorMap.get(cid) ?? []).forEach(push);
      push(charMap.get(cid)?.primary);
    }

    for (const c of shot.characters ?? []) {
      const varId = shot.characterVariationIds?.[c.characterId];
      if (varId) push(varMap.get(`${c.characterId}_${varId}`));
      push(charMap.get(c.characterId)?.primary);
    }

    return urls.slice(0, 4);
  }
}
