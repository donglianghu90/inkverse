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
import { LlmService } from '../../../novel/llm/llm.service';
import { z } from 'zod';
import {
  characterIdentitySchema, characterVariationSchema, sceneLocationSchema, visualStyleGuideSchema,
  signaturePropSchema,
  DramaSeed, SeriesOutline, DramaState, CharacterIdentity, EpisodeIntent,
} from '../../schemas/drama-state.schemas';
import { buildVisualAssetDesignerSystemPrompt } from '../../prompting/drama-playbook';
import type { GenreProductionGuidance } from '../../entities/drama-genre-template.entity';
import type { VisualStyleGuide } from '../../entities/drama-visual-style-template.entity';

const designerOutputSchema = z.object({
  characters: z.array(characterIdentitySchema),
  locations: z.array(sceneLocationSchema),
  visualStyle: visualStyleGuideSchema,
  signatureProps: z.preprocess(
    v => v ?? [],
    z.array(signaturePropSchema),
  ).default([]),
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

/**
 * 从用户的自由文本风格描述中提取最匹配的视觉风格枚举值。
 * 优先级：用户 hint 中的关键词 > AI 推荐的 suggestedVisualStyle（fallback）
 *
 * 这是保证 system prompt 与用户意图一致的关键——buildVisualAssetDesignerSystemPrompt
 * 接受的是风格枚举，会据此决定角色 prompt 前缀规则，必须与用户真实选择对齐。
 */
/** 所有合法 styleKey 的白名单 — 必须与 drama-visual-style-template.service.ts 的模板 key 保持同步 */
const KNOWN_STYLE_KEYS = new Set([
  // 真人影视
  'live_action', 'period_live', 'hk_film', 'retro_wuxia', 'western_film',
  // 2D 动漫
  '2d_anime', '2d_film', '2d_fantasy_anime', '2d_retro_anime', '2d_british_anime',
  '2d_ghibli', '2d_korean_anime', '2d_action', '2d_cybercity', '2d_sports',
  '2d_tezuka', '2d_thick_line', '2d_death_note', '2d_shoujo', '2d_horror', '2d_chibi',
  // 2D 画风
  'chinese_ink', 'chinese_style', '2d_gongbi', '2d_watercolor', '2d_pixel',
  '2d_simple', '2d_sketch', '2d_british_comic', '2d_rubber_hose', '2d_golden',
  // 3D 动画
  '3d_fantasy', '3d_british', '3d_chibi', '3d_realistic', '3d_voxel',
  '3d_mobile_game', '3d_toon_render', '3d_japanese_npr', '3d_cyberpunk', '3d_disney',
  // 定格动画
  'stop_motion', 'clay_stop', 'lego_stop', 'felt_stop', 'paper_stop',
]);

/**
 * 将用户自由文本 hint 解析为 canonical styleKey。
 *
 * 优先级：
 *  1. 若 suggestedVisualStyle 是一个精确的 styleKey（来自视觉风格模板），直接返回，不做 hint 解析。
 *     这避免了模板的英文 T2I styleReferencePrompt 被误当成关键词而猜出错误 key（如 "3d"→"3d_realistic"）。
 *  2. 若无 hint，返回 suggestedVisualStyle（可能是 LLM 推荐的近似值）。
 *  3. 对中文自由文本 hint 做关键词匹配，返回最接近的 styleKey。
 *  4. 未匹配，回退到 suggestedVisualStyle。
 */
function resolveEffectiveVisualStyle(visualStyleHint?: string, suggestedVisualStyle?: string): string | undefined {
  // 规则 1：已有精确的 styleKey（来自模板选择），直接使用，不被 hint 覆盖
  if (suggestedVisualStyle && KNOWN_STYLE_KEYS.has(suggestedVisualStyle)) {
    return suggestedVisualStyle;
  }

  if (!visualStyleHint) return suggestedVisualStyle;

  const h = visualStyleHint.toLowerCase();

  // 真人类（写实摄影）
  if (h.includes('真人古装') || h.includes('古装真人') || h.includes('历史真人')) return 'period_live';
  if (h.includes('港片') || h.includes('港式')) return 'hk_film';
  if (h.includes('复古武侠') || h.includes('武侠片')) return 'retro_wuxia';
  if (h.includes('好莱坞') || h.includes('西方电影') || h.includes('欧美大片')) return 'western_film';
  if (h.includes('真人') || h.includes('实拍') || h.includes('影视')) return 'live_action';

  // 2D 中国传统
  if (h.includes('水墨') || h.includes('国画') || h.includes('ink wash')) return 'chinese_ink';
  if (h.includes('工笔') || h.includes('gongbi')) return '2d_gongbi';
  if (h.includes('水彩') || h.includes('watercolor')) return '2d_watercolor';
  if (h.includes('中国风') || h.includes('古风绘画') || h.includes('国风插画')) return 'chinese_style';
  if (h.includes('黄金光堂') || h.includes('golden hall')) return '2d_golden';

  // 2D 动漫
  if (h.includes('少女漫') || h.includes('shoujo')) return '2d_shoujo';
  if (h.includes('韩漫') || h.includes('条漫') || h.includes('webtoon')) return '2d_korean_anime';
  if (h.includes('吉卜力') || h.includes('宫崎骏') || h.includes('ghibli')) return '2d_ghibli';
  if (h.includes('赛博都市') || h.includes('cybercity')) return '2d_cybercity';
  if (h.includes('热血') || h.includes('战斗漫画') || h.includes('少年漫')) return '2d_action';
  if (h.includes('复古动画') || h.includes('80年代动画') || h.includes('90年代动画')) return '2d_retro_anime';
  if (h.includes('奇幻动画') || h.includes('fantasy anime')) return '2d_fantasy_anime';
  if (h.includes('英式动画') || h.includes('british anime')) return '2d_british_anime';
  if (h.includes('运动漫') || h.includes('sports manga') || h.includes('篮球')) return '2d_sports';
  if (h.includes('手冢') || h.includes('tezuka')) return '2d_tezuka';
  if (h.includes('粗线条') || h.includes('thick line')) return '2d_thick_line';
  if (h.includes('死神') || h.includes('暗黑') || h.includes('death note')) return '2d_death_note';
  if (h.includes('恐怖漫') || h.includes('horror manga') || h.includes('伊藤润二')) return '2d_horror';
  if (h.includes('q版') || h.includes('chibi') || h.includes('萌系可爱')) return '2d_chibi';
  if (h.includes('电影动画') || h.includes('新海诚') || h.includes('shinkai')) return '2d_film';
  if (h.includes('动漫') || h.includes('二次元') || h.includes('anime')) return '2d_anime';

  // 2D 画风
  if (h.includes('像素') || h.includes('pixel') || h.includes('8-bit')) return '2d_pixel';
  if (h.includes('橡皮管') || h.includes('rubber hose') || h.includes('cuphead')) return '2d_rubber_hose';
  if (h.includes('英式漫画') || h.includes('british comic') || h.includes('波普')) return '2d_british_comic';
  if (h.includes('简画') || h.includes('极简') || h.includes('minimalist')) return '2d_simple';
  if (h.includes('素描') || h.includes('铅笔') || h.includes('sketch')) return '2d_sketch';

  // 3D 类 — 细粒度在前，宽泛 "3d" 兜底在最后
  if (h.includes('赛博朋克') || h.includes('cyberpunk')) return '3d_cyberpunk';
  if (h.includes('玄幻') || h.includes('仙侠') || h.includes('xianxia') || h.includes('3d奇幻')) return '3d_fantasy';
  if (h.includes('迪士尼') || h.includes('皮克斯') || h.includes('pixar') || h.includes('disney')) return '3d_disney';
  if (h.includes('日式3d') || h.includes('3d漫染') || h.includes('npr') || h.includes('ufotable')) return '3d_japanese_npr';
  if (h.includes('卡通渲染') || h.includes('toon render') || h.includes('cel shading')) return '3d_toon_render';
  if (h.includes('q版3d') || h.includes('3dq版') || h.includes('3d萌') || h.includes('chibi 3d')) return '3d_chibi';
  if (h.includes('方块') || h.includes('体素') || h.includes('voxel') || h.includes('minecraft')) return '3d_voxel';
  if (h.includes('手游') || h.includes('mobile game') || h.includes('原神') || h.includes('genshin')) return '3d_mobile_game';
  if (h.includes('英式3d') || h.includes('维多利亚') || h.includes('victorian 3d')) return '3d_british';
  if (h.includes('写实') || h.includes('photoreal') || h.includes('unreal engine')) return '3d_realistic';
  if (h.includes('3d') || h.includes('三维') || h.includes('cg')) return '3d_realistic';

  // 定格动画
  if (h.includes('乐高') || h.includes('lego')) return 'lego_stop';
  if (h.includes('毛毡') || h.includes('felt') || h.includes('羊毛')) return 'felt_stop';
  if (h.includes('纸艺') || h.includes('剪纸') || h.includes('paper')) return 'paper_stop';
  if (h.includes('粘土') || h.includes('clay') || h.includes('claymation')) return 'clay_stop';
  if (h.includes('定格') || h.includes('stop motion')) return 'stop_motion';

  // 未匹配到关键词，回退到 AI 推荐值
  return suggestedVisualStyle;
}

@Injectable()
export class VisualAssetDesignerAgent {
  private readonly logger = new Logger(VisualAssetDesignerAgent.name);
  constructor(private readonly llm: LlmService) {}

  async design(
    seed: DramaSeed,
    outline: SeriesOutline,
    visualStyleHint?: string,
    dramaId?: string,
    userId?: string,
    suggestedVisualStyle?: string,
    audienceContext?: { protagonistFocus?: string; platformTarget?: string; audienceTags?: string[] },
    /** 来自视觉风格模板的 visualGuide（含 facePromptRule + scenePromptGuidance） */
    styleGuide?: Pick<VisualStyleGuide, 'facePromptRule' | 'scenePromptGuidance'>,
    /** 来自题材模板的生产引导（含 maleLeadFormula / femaleLeadFormula） */
    genreGuidance?: Pick<GenreProductionGuidance, 'maleLeadFormula' | 'femaleLeadFormula'>,
    additionalSystemPrompt?: string,
  ): Promise<VisualAssetDesignOutput> {
    const allCharNames = new Set<string>();
    outline.episodes.forEach(ep => ep.keyCharacterIds.forEach(c => allCharNames.add(c)));
    allCharNames.add(seed.protagonistConcept.name);
    if (seed.antagonistConcept?.name) allCharNames.add(seed.antagonistConcept.name);

    const audienceLine = [
      audienceContext?.platformTarget ? `目标平台：${audienceContext.platformTarget}` : '',
      audienceContext?.protagonistFocus ? `叙事主角焦点：${audienceContext.protagonistFocus}` : '',
      audienceContext?.audienceTags?.length ? `受众标签：${audienceContext.audienceTags.join('、')}` : (seed.targetAudience ? `受众：${seed.targetAudience}` : ''),
    ].filter(Boolean).join('\n');

    // 用户 hint 优先：从 hint 文本提取有效风格枚举，确保 system prompt 与用户意图一致
    // AI 推荐的 suggestedVisualStyle 仅在用户未提供 hint 或 hint 无法识别时作为 fallback
    const effectiveVisualStyle = resolveEffectiveVisualStyle(visualStyleHint, suggestedVisualStyle);
    const styleOverrideNote = visualStyleHint && effectiveVisualStyle !== suggestedVisualStyle
      ? `（用户已明确选择 ${effectiveVisualStyle}，覆盖了系统推荐的 ${suggestedVisualStyle}）`
      : '';
    if (styleOverrideNote) {
      this.logger.log(`[VisualDesigner] 风格覆盖${styleOverrideNote}`);
    }

    let sysPrompt = buildVisualAssetDesignerSystemPrompt(effectiveVisualStyle, styleGuide, genreGuidance);
    if (additionalSystemPrompt?.trim()) sysPrompt += `\n\n=== 补充指令 ===\n${additionalSystemPrompt.trim()}`;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-visual-asset-designer',
      schema: designerOutputSchema,
      systemPrompt: sysPrompt,
      metadata: { dramaId, userId },
      userPrompt: `请为以下短剧设计全套视觉资产：

剧名：${seed.title}
题材：${seed.genre}
调性：${seed.tone}
${audienceLine}
主角：${seed.protagonistConcept.name}（${seed.protagonistConcept.personality}）— ${seed.protagonistConcept.situation}
${seed.antagonistConcept ? `对手：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}` : ''}
涉及角色名单：${[...allCharNames].join('、')}
总集数：${outline.totalPlannedEpisodes}
${visualStyleHint ? `\n【用户指定视觉风格】：${visualStyleHint}
请确保 visualStyle 完全体现此风格——overallAesthetic/colorGrading/lightingStyle/renderTechnique/textureStyle/referenceStyle 均需贴合，角色 faceReferencePrompt 也须用符合该风格的英文描述。` : ''}

要求：
1. characters 数组包含所有主要角色（按主角→对手→配角排序）
2. 每个角色必须有完整的 faceDescription + faceReferencePrompt + soulProfile + voiceProfile + variations
3. 每个角色必须提供英文的 T2I 字段：defaultCostumePrompt（服饰英文描述）、bodyTypePrompt（体型英文描述）、hairStylePrompt（发型英文描述）
4. 主角至少2个variations（根据题材选择合适的变体，如日常/正式、少年/壮年），配角至少1个
5. locations 至少包含5个核心场景，高频场景标记 isRecurring=true
6. visualStyle 定义全剧美学基调
7. characterId 使用角色名的全拼小写（如"李白"→"libai"，"杜甫"→"dufu"，"杨玉环"→"yangyuhuan"）。若全拼冲突（如两个角色同音），在后者末尾加数字（如"libai""libai2"）。禁止使用声母缩写（"lb"），因为中文姓名声母碰撞率极高
8. locationId 使用场景的简写（如"tavern""palace""study_room"）
9. soulProfile 灵魂层人设（主角和对手必填，配角尽量填）：从种子中的personality/coreDesire/fatalFlaw出发，展开为完整的心理画像——压力下怎么反应、害怕什么、习惯性小动作、内在矛盾是什么
10. 全剧级签名道具（signatureProps）：只设计 3-8 个，满足以下任一条件才列入：
    a) 角色标志性随身物（narrativeRole="signature"）：与主角/反派强绑定，多集反复出现，是该角色的视觉符号
       → characterOwner 填对应 characterId，appearsInScenes 列出出现的 locationId（≥2个）
    b) 剧情核心驱动物（narrativeRole="macguffin"）：整个故事围绕它流转，如密令/传位诏书/解药/宝物
       → appearsInScenes 可为空或填关键场景
    c) 跨场景反复出现道具（narrativeRole="recurring"）：在 3 个以上不同场景/集数出现，观众会记住
       → appearsInScenes 必须 ≥3 个 locationId
    ⚠️ 不要列入：普通场景陈设（桌椅、灯具、窗帘）、一次性出现的道具、通用餐具
    每个道具字段：
    - propId：英文/拼音简写，全局唯一（如"jade_seal"、"jiu_zun"、"poison_vial"）
    - name：中文名称
    - description：中文详细描述（材质、年代风格、外观特征，30-60字）
    - visualPrompt：英文 T2I 提示词（产品图风格，白底，单独展示，无人物）
      格式示例："Song dynasty imperial jade seal, green nephrite, carved dragon relief, product shot, centered, white background, studio lighting, highly detailed"
    scenes 的 keyProps 字段：用中文文字列出该场景的普通陈设道具即可（如"红木书桌、茶盏、折叠屏风"），无需详细设计，不生图`,
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
2. faceReferencePrompt（英文）= 精确对应 faceDescription 的 T2I 提示词。
   ⚠️ 【本剧 faceReferencePrompt 规则】：${vs?.facePromptRule ?? 'faceReferencePrompt 必须以【渲染风格词 + 角色身份词】开头，先锚定风格，再描述五官，最后必须加上 "front-facing, looking at camera"。'}
3. bodyTypePrompt（英文）= 体型描述
4. hairStylePrompt（英文）= 发型描述
5. defaultCostumePrompt（英文）= 服饰 T2I 提示词，必须匹配剧的时代和风格
6. defaultCostume（中文）= 服饰中文描述
7. voiceProfile = 如有台词必须设计配音风格；无台词可用默认值
8. variations = minor 角色可以没有变体（空数组），supporting 角色至少1个
9. 所有英文 T2I 字段的画面风格关键词必须与全剧 visualStyle 一致
10. T2I 内容审核兼容：英文 T2I 字段禁用以下词汇（括号内为替代词）：
    sinister/evil→sharp/cold, hypocritical→composed/enigmatic, drunken→heavy-lidded,
    rebellious→proud/unyielding, tragic→solemn/dramatic, menacing→commanding,
    weathered face with dirt→weathered and rugged face
    始终用视觉属性描述外观，不用道德评判词`,
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
