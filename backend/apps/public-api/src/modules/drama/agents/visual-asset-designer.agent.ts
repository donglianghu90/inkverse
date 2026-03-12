/**
 * 视觉资产设计师（Visual Asset Librarian）
 *
 * 职责一：全剧初始资产设计（角色/场景/风格）
 * 职责二：逐集临时角色解析 — resolveEpisodeCharacters()
 *   - 从 minorRolePool 匹配可复用的历史临时角色
 *   - 对真正的新角色调用 LLM 设计完整视觉身份
 *   - 确保所有角色与全剧美学体系一致
 *
 * 设计原则：EpisodeDirector 关心"需要什么角色"（叙事），
 *           VisualAssetDesignerAgent 关心"从哪里来 / 长什么样"（视觉资产）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  characterIdentitySchema, characterVariationSchema, sceneLocationSchema, visualStyleGuideSchema,
  DramaSeed, SeriesOutline, DramaState, CharacterIdentity, EpisodeIntent,
} from '../schemas/drama-state.schemas';
import { buildVisualAssetDesignerSystemPrompt } from '../prompting/drama-playbook';

const designerOutputSchema = z.object({
  characters: z.array(characterIdentitySchema),
  locations: z.array(sceneLocationSchema),
  visualStyle: visualStyleGuideSchema,
});

const newCharactersOutputSchema = z.object({
  characters: z.array(characterIdentitySchema),
});

export type VisualAssetDesignOutput = z.infer<typeof designerOutputSchema>;

export interface ProposedCharacter {
  characterId: string;
  name: string;
  role: 'supporting' | 'minor';
  scope?: 'episode' | 'arc'; // 未填则默认按 episode 处理
  narrativePurpose: string;
  appearanceHint: string;
  hasDialogue: boolean;
}

@Injectable()
export class VisualAssetDesignerAgent {
  private readonly logger = new Logger(VisualAssetDesignerAgent.name);
  constructor(private readonly llm: LlmService) {}

  async design(seed: DramaSeed, outline: SeriesOutline, visualStyleHint?: string, dramaId?: string, userId?: string): Promise<VisualAssetDesignOutput> {
    const allCharNames = new Set<string>();
    outline.episodes.forEach(ep => ep.keyCharacterIds.forEach(c => allCharNames.add(c)));
    allCharNames.add(seed.protagonistConcept.name);
    if (seed.antagonistConcept?.name) allCharNames.add(seed.antagonistConcept.name);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-visual-asset-designer',
      schema: designerOutputSchema,
      systemPrompt: buildVisualAssetDesignerSystemPrompt(),
      metadata: { dramaId, userId },
      userPrompt: `请为以下短剧设计全套视觉资产：

剧名：${seed.title}
题材：${seed.genre}
调性：${seed.tone}
主角：${seed.protagonistConcept.name}（${seed.protagonistConcept.personality}）— ${seed.protagonistConcept.situation}
${seed.antagonistConcept ? `对手：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}` : ''}
涉及角色名单：${[...allCharNames].join('、')}
总集数：${outline.totalPlannedEpisodes}
${visualStyleHint ? `\n【用户指定视觉风格】：${visualStyleHint}
请确保 visualStyle 完全体现此风格——overallAesthetic/colorGrading/lightingStyle/renderTechnique/textureStyle/referenceStyle 均需贴合，角色 faceReferencePrompt 也须用符合该风格的英文描述。` : ''}

要求：
1. characters 数组包含所有主要角色（按主角→对手→配角排序）
2. 每个角色必须有完整的 faceDescription + faceReferencePrompt + voiceProfile + variations
3. 每个角色必须提供英文的 T2I 字段：defaultCostumePrompt（服饰英文描述）、bodyTypePrompt（体型英文描述）、hairStylePrompt（发型英文描述）
4. 主角至少2个variations（根据题材选择合适的变体，如日常/正式、少年/壮年），配角至少1个
5. locations 至少包含5个核心场景，高频场景标记 isRecurring=true
6. visualStyle 定义全剧美学基调
7. characterId 使用角色名的拼音缩写（如"李白"→"lb"，"杜甫"→"df"）
8. locationId 使用场景的简写（如"tavern""palace""study_room"）`,
      temperature: 0.5,
    });

    return designerOutputSchema.parse(raw);
  }

  /**
   * 为逐集生产中导演提出的新角色生成完整视觉身份。
   * 复用全剧视觉风格（visualStyle）+ 已有角色作为参考锚点，确保新角色与全剧美学一致。
   */
  async designNewCharacters(
    state: DramaState,
    proposed: ProposedCharacter[],
  ): Promise<CharacterIdentity[]> {
    if (!proposed.length) return [];
    const existing = state.characters.slice(0, 3).map(c =>
      `${c.characterId}(${c.name}): face="${c.faceReferencePrompt?.slice(0, 80)}" costume="${c.defaultCostumePrompt?.slice(0, 60)}"`,
    ).join('\n');
    const vs = state.visualStyle;
    const styleCtx = vs
      ? `美学=${vs.overallAesthetic}, 调色=${vs.colorGrading}, 光影=${vs.lightingStyle}, 渲染=${vs.renderTechnique ?? ''}, 材质=${vs.textureStyle ?? ''}, 参考=${vs.referenceStyle ?? ''}, 时代=${vs.era}`
      : '';

    const charRequests = proposed.map((p, i) =>
      `${i + 1}. characterId="${p.characterId}", name="${p.name}", role=${p.role}\n` +
      `   叙事作用：${p.narrativePurpose}\n` +
      `   外观提示：${p.appearanceHint}\n` +
      `   有无台词：${p.hasDialogue ? '有' : '无'}`,
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-new-character-designer',
      schema: newCharactersOutputSchema,
      metadata: { dramaId: state.dramaId, userId: state.userId },
      systemPrompt: `你是一位短剧视觉总监，现在需要为已开拍的短剧补充新角色的视觉身份。
新角色必须与已有角色在同一美学体系下——面部描述精度、服饰风格、T2I提示词规范都要对齐。

=== 设计要求 ===
1. faceDescription（中文）= 面型+眼型+鼻型+唇型+肤色+标志特征，足够让 T2I 在多次生成中保持面部一致
2. faceReferencePrompt（英文）= 精确对应 faceDescription 的 T2I 提示词，仅描述面部五官，禁止写服饰
3. bodyTypePrompt（英文）= 体型描述
4. hairStylePrompt（英文）= 发型描述
5. defaultCostumePrompt（英文）= 服饰 T2I 提示词，必须匹配剧的时代和风格
6. defaultCostume（中文）= 服饰中文描述
7. voiceProfile = 如有台词必须设计配音风格；无台词可用默认值
8. variations = minor 角色可以没有变体（空数组），supporting 角色至少1个
9. 所有英文 T2I 字段的画面风格关键词必须与全剧 visualStyle 一致`,
      userPrompt: `剧名：${state.seed.title}
题材：${state.seed.genre}
调性：${state.seed.tone}
全剧视觉风格：${styleCtx}

已有角色参考（注意保持美学一致性）：
${existing}

需要设计的新角色：
${charRequests}

请输出 characters 数组，每个角色包含完整的 CharacterIdentity 数据。characterId 使用上面指定的值。`,
      temperature: 0.4,
    });

    const result = newCharactersOutputSchema.parse(raw);
    this.logger.log(`新角色设计完成：${result.characters.map(c => `${c.characterId}(${c.name})`).join(', ')}`);
    return result.characters;
  }

  /**
   * 视觉资产库管理 — 根据集导演意图解析本集所需角色。
   *
   * 决策顺序：
   *   1. activeCharacters 中已在 state.characters 的角色 → 直接忽略（无需处理）
   *   2. activeCharacters 中命中 minorRolePool 的角色 → 直接从池复用（零 LLM 成本）
   *   3. proposedNewCharacters 中排除已复用/已知角色后 → 调用 LLM 设计
   *
   * 返回的 `all` 数组（reused + designed）供调用方直接 push 进 state.characters。
   * 返回的 `poolUsageUpdates` 记录池条目需要更新的信息（lastUsedEpisode / usedInEpisodes）。
   */
  async resolveEpisodeCharacters(
    state: DramaState,
    intent: EpisodeIntent,
  ): Promise<{
    reused: CharacterIdentity[];
    designed: CharacterIdentity[];
    all: CharacterIdentity[];
    poolUsageUpdates: Array<{ characterId: string }>;
  }> {
    const poolMap = new Map((state.minorRolePool ?? []).map(p => [p.characterId, p]));
    const currentIds = new Set(state.characters.map(c => c.characterId));

    // Step A: activeCharacters 中命中池的角色直接复用
    const reused: CharacterIdentity[] = [];
    const poolUsageUpdates: Array<{ characterId: string }> = [];
    for (const ac of intent.activeCharacters ?? []) {
      if (currentIds.has(ac.characterId) || !poolMap.has(ac.characterId)) continue;
      const poolEntry = poolMap.get(ac.characterId)!;
      reused.push({ ...poolEntry.identity, scope: 'episode' });
      currentIds.add(ac.characterId);
      poolUsageUpdates.push({ characterId: ac.characterId });
    }

    if (reused.length > 0) {
      this.logger.log(`[AssetLibrary] 池复用 ${reused.length} 个角色: ${reused.map(c => `${c.characterId}(${c.name})`).join(', ')}`);
    }

    // Step B: proposedNewCharacters 中排除已复用/已知的，剩余提交 LLM 设计
    const reuseIds = new Set(reused.map(c => c.characterId));
    const genuinelyNew = (intent.proposedNewCharacters ?? []).filter(
      (p): p is ProposedCharacter =>
        !!p.characterId && !!p.name && !currentIds.has(p.characterId) && !reuseIds.has(p.characterId),
    );

    let designed: CharacterIdentity[] = [];
    if (genuinelyNew.length > 0) {
      // 建立 characterId → proposed scope 的映射，让设计结果的生命周期与导演意图对齐
      const proposedScopeMap = new Map(genuinelyNew.map(p => [p.characterId, p.scope ?? 'episode']));
      const rawDesigned = await this.designNewCharacters(state, genuinelyNew);
      designed = rawDesigned.map(c => ({ ...c, scope: proposedScopeMap.get(c.characterId) ?? 'episode' }));
    }

    const all = [...reused, ...designed];
    return { reused, designed, all, poolUsageUpdates };
  }
}
