import { Injectable } from '@nestjs/common';
import { DetailStoreService } from './detail-store.service';
import { StoryState, ChapterIntent } from './schemas/novel-state.schemas';

/**
 * 为 Writer 等 Agent 构建「细节记忆」上下文的服务。
 *
 * 面向 CreativeWriter：
 * - 角色：签名动作 + 典型描写片段
 * - 地点：感官锚点 + 访问记忆 + 首次/典型描写（支持「重返同一地点」描写策略）
 * - 道具：感官签名 + 使用效果 + 描写片段（武器/异火/法宝等出场时保持一致）
 */
@Injectable()
export class DetailContextService {
  constructor(private readonly detailStore: DetailStoreService) {}

  /**
   * 为写作 Agent 构建角色 + 地点 + 道具细节上下文。
   *
   * 返回一段中文提示文本，若无可用细节则返回空字符串。
   */
  async buildWriterDetailContext(
    bookId: string,
    state: StoryState,
    intent: ChapterIntent,
  ): Promise<string> {
    const [characterBlock, locationBlock, itemBlock] = await Promise.all([
      this.buildCharacterDetailBlock(bookId, state, intent),
      this.buildLocationDetailBlock(bookId, state, intent),
      this.buildItemDetailBlock(bookId, state, intent),
    ]);

    const parts: string[] = [];
    if (characterBlock) parts.push(characterBlock);
    if (locationBlock) parts.push(locationBlock);
    if (itemBlock) parts.push(itemBlock);
    return parts.join('\n\n');
  }

  private async buildCharacterDetailBlock(
    bookId: string,
    state: StoryState,
    intent: ChapterIntent,
  ): Promise<string> {
    const focusIds = this.resolveFocusCharacterIds(intent, state);
    if (focusIds.length === 0) return '';

    const [details, idToName] = await Promise.all([
      this.detailStore.getCharacterDetails(bookId, focusIds),
      Promise.resolve(
        new Map(state.characters.map((c) => [c.id, c.name] as const)),
      ),
    ]);

    if (details.length === 0) return '';

    const lines: string[] = [];
    lines.push('【角色习惯动作与典型描写】');
    lines.push(
      '以下信息用于保持人物质感一致：写动作/神态时优先参考这些习惯，而不是重新发明。',
    );

    for (const d of details) {
      const name = idToName.get(d.characterId) ?? d.characterId;

      const sigActs = (d.signatureActions ?? []).slice(0, 3);
      const snippets = (d.descriptionSnippets ?? [])
        .filter((s) => s.type === 'first_appearance' || s.type === 'face')
        .slice(-2);

      if (sigActs.length === 0 && snippets.length === 0) continue;

      lines.push(`\n── 角色：${name}`);

      if (sigActs.length > 0) {
        lines.push('  · 标志性小动作：');
        for (const act of sigActs) {
          const trigger = act.trigger ? `（多见于：${act.trigger}）` : '';
          lines.push(`    - ${act.action}${trigger}`);
        }
      }

      if (snippets.length > 0) {
        lines.push('  · 典型外貌/神态描写摘录（不要照抄，用来保持风格一致）：');
        for (const s of snippets) {
          lines.push(`    - [第${s.chapterNumber}章] ${s.text}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 本章可能涉及的道具：焦点角色持有的 + 状态中前若干件，最多 4 个。
   */
  private resolveFocusItemIds(state: StoryState, intent: ChapterIntent): string[] {
    const focusCharIds = new Set(this.resolveFocusCharacterIds(intent, state));
    const items = state.items ?? [];
    const fromOwner = items
      .filter((i) => i.ownerId && focusCharIds.has(i.ownerId))
      .map((i) => i.id);
    const fromState = items.slice(0, 3).map((i) => i.id);
    const merged: string[] = [];
    for (const id of [...fromOwner, ...fromState]) {
      if (id && !merged.includes(id)) merged.push(id);
    }
    return merged.slice(0, 4);
  }

  private async buildItemDetailBlock(
    bookId: string,
    state: StoryState,
    intent: ChapterIntent,
  ): Promise<string> {
    const focusItemIds = this.resolveFocusItemIds(state, intent);
    if (focusItemIds.length === 0) return '';

    const itemDetails = await this.detailStore.getItemDetails(bookId, focusItemIds);
    const idToName = new Map((state.items ?? []).map((i) => [i.id, i.name] as const));

    if (itemDetails.length === 0) return '';

    const lines: string[] = [];
    lines.push('【道具感官签名与使用效果】');
    lines.push(
      '写到该道具出场或使用时：复现感官签名中的 1～2 个维度，使用效果可参考下列摘录，保持与既往描写一致。',
    );

    for (const item of itemDetails) {
      const name = idToName.get(item.itemId) ?? item.itemId;
      const sig = item.sensorySignature;
      const effects = (item.activationEffects ?? []).slice(-2);
      const snippets = (item.descriptionSnippets ?? [])
        .filter((s) => s.type === 'appearance' || s.type === 'activation')
        .slice(0, 2);

      if (!sig && effects.length === 0 && snippets.length === 0) continue;

      lines.push(`\n── 道具：${name}`);

      if (sig && Object.keys(sig).length > 0) {
        const parts: string[] = [];
        if (sig.visual) parts.push(`视觉：${sig.visual}`);
        if (sig.tactile) parts.push(`触感：${sig.tactile}`);
        if (sig.auditory) parts.push(`听觉：${sig.auditory}`);
        if (sig.olfactory) parts.push(`气味：${sig.olfactory}`);
        if (sig.weight) parts.push(`重量：${sig.weight}`);
        if (parts.length > 0) {
          lines.push('  · 感官签名：');
          parts.forEach((p) => lines.push(`    - ${p}`));
        }
      }

      if (effects.length > 0) {
        lines.push('  · 使用效果参考：');
        for (const e of effects) {
          lines.push(`    - [第${e.chapterNumber}章] ${e.description}`);
        }
      }

      if (snippets.length > 0) {
        lines.push('  · 外观/激活描写参考（勿照抄）：');
        for (const s of snippets) {
          lines.push(`    - [第${s.chapterNumber}章] ${s.text}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 本章可能发生场景的地点：以上章结束场景为主，辅以状态中的地点列表（取前 2 个）。
   */
  private resolveFocusLocationIds(state: StoryState): string[] {
    const ids: string[] = [];
    const last = state.lastSceneSnapshot;
    if (last?.locationId) ids.push(last.locationId);
    const fromState = (state.locations ?? []).slice(0, 2).map((l) => l.id);
    for (const id of fromState) {
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, 3);
  }

  private async buildLocationDetailBlock(
    bookId: string,
    state: StoryState,
    intent: ChapterIntent,
  ): Promise<string> {
    const focusLocationIds = this.resolveFocusLocationIds(state);
    if (focusLocationIds.length === 0) return '';

    const locationDetails = await this.detailStore.getLocationDetails(
      bookId,
      focusLocationIds,
    );
    const idToName = new Map(
      (state.locations ?? []).map((l) => [l.id, l.name] as const),
    );
    const charIdToName = new Map(
      state.characters.map((c) => [c.id, c.name] as const),
    );
    const focusCharIds = new Set(
      this.resolveFocusCharacterIds(intent, state),
    );

    if (locationDetails.length === 0) return '';

    const lines: string[] = [];
    lines.push('【地点感官锚点与重访记忆】');
    lines.push(
      '同一地点再次出现时：复现 1～2 个锚点，其余写「变化」（天气、人、氛围）。若该地点对视角角色有重要往事，可带出情绪投射，不要整段照抄首次描写。',
    );

    for (const loc of locationDetails) {
      const name = idToName.get(loc.locationId) ?? loc.locationId;
      const anchors = (loc.sensoryAnchors ?? []).slice(0, 4);
      const visitMemories = (loc.visitMemories ?? [])
        .filter((m) => focusCharIds.has(m.characterId))
        .slice(-3);
      const snippets = (loc.descriptionSnippets ?? [])
        .filter(
          (s) =>
            s.type === 'panorama' ||
            s.type === 'entrance' ||
            s.type === 'interior',
        )
        .slice(0, 2);

      if (anchors.length === 0 && visitMemories.length === 0 && snippets.length === 0) {
        continue;
      }

      lines.push(`\n── 地点：${name}`);

      if (anchors.length > 0) {
        lines.push('  · 感官锚点（再次写到此处时至少复现 1～2 个）：');
        for (const a of anchors) {
          const label =
            a.sense === 'sight'
              ? '视觉'
              : a.sense === 'sound'
                ? '听觉'
                : a.sense === 'smell'
                  ? '气味'
                  : a.sense === 'touch'
                    ? '触感'
                    : a.sense === 'temperature'
                      ? '体感'
                      : a.sense;
          const land = a.isLandmark ? ' [地标]' : '';
          lines.push(`    - ${label}${land}：${a.description}`);
        }
      }

      if (visitMemories.length > 0) {
        lines.push('  · 角色在此地的过往（可作情绪投射）：');
        for (const v of visitMemories) {
          const charName = charIdToName.get(v.characterId) ?? v.characterId;
          lines.push(
            `    - ${charName} [第${v.chapterNumber}章] ${v.event}，情绪：${v.emotionalTone}`,
          );
        }
      }

      if (snippets.length > 0) {
        lines.push('  · 首次/典型环境描写参考（勿照抄）：');
        for (const s of snippets) {
          lines.push(`    - [第${s.chapterNumber}章] ${s.text}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 选择本章需要重点关注的角色：
   * - 先用意图里的 focusCharacterIds
   * - 不足时再补充 activeCharacterIds
   */
  private resolveFocusCharacterIds(
    intent: ChapterIntent,
    state: StoryState,
  ): string[] {
    const focus = [...(intent.characterArcGuidance.focusCharacterIds ?? [])];
    const active = intent.characterAvailability.activeCharacterIds ?? [];

    const merged: string[] = [];
    const pushUnique = (id: string) => {
      if (!id) return;
      if (merged.includes(id)) return;
      merged.push(id);
    };

    for (const id of focus) pushUnique(id);
    for (const id of active) pushUnique(id);

    // 限制上限，避免上下文过大
    const MAX = 5;
    const selected = merged.slice(0, MAX);

    // 兜底：如果都为空，尝试用主角
    if (selected.length === 0 && state.characters.length > 0) {
      const protagonist =
        state.characters.find((c) => c.role === 'protagonist') ??
        state.characters[0];
      return [protagonist.id];
    }

    return selected;
  }
}

