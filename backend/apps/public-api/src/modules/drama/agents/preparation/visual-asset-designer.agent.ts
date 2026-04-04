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
import { Injectable, Logger } from "@nestjs/common";
import { resolveGenreKey } from "../../prompting/drama-genre-utils";
import { LlmService } from "../../../novel/llm/llm.service";
import { z } from "zod";
import {
  characterIdentitySchema,
  characterVariationSchema,
  sceneLocationSchema,
  visualStyleGuideSchema,
  signaturePropSchema,
  DramaSeed,
  SeriesOutline,
  DramaState,
  CharacterIdentity,
  EpisodeIntent,
} from "../../schemas/drama-state.schemas";
import { buildVisualAssetDesignerSystemPrompt } from "../../prompting/drama-playbook";
import type { GenreProductionGuidance } from "../../../template/entities/drama-genre-template.entity";
import type { VisualStyleGuide } from "../../../template/entities/drama-visual-style-template.entity";

/** 建剧阶段只输出视觉风格 + 签名道具，角色/场景延迟到逐集生产 */
const visualStyleOnlySchema = z.object({
  visualStyle: visualStyleGuideSchema,
  signatureProps: z
    .preprocess((v) => v ?? [], z.array(signaturePropSchema))
    .default([]),
});

/** 逐集新场景设计输出 */
const newLocationsOutputSchema = z.object({
  locations: z.array(sceneLocationSchema),
});

/** 逐集新角色设计输出 */
const newCharactersOutputSchema = z.object({
  characters: z.array(characterIdentitySchema),
});

export type VisualAssetDesignOutput = z.infer<typeof visualStyleOnlySchema>;

export interface ProposedCharacter {
  characterId: string;
  name: string;
  role: "supporting" | "minor";
  scope?: "episode" | "arc"; // 未填则默认按 episode 处理
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
  "live_action",
  "period_live",
  "hk_film",
  "retro_wuxia",
  "western_film",
  // 2D 动漫
  "2d_anime",
  "2d_film",
  "2d_fantasy_anime",
  "2d_retro_anime",
  "2d_british_anime",
  "2d_ghibli",
  "2d_korean_anime",
  "2d_action",
  "2d_cybercity",
  "2d_sports",
  "2d_tezuka",
  "2d_thick_line",
  "2d_death_note",
  "2d_shoujo",
  "2d_horror",
  "2d_chibi",
  // 2D 画风
  "chinese_ink",
  "chinese_style",
  "2d_gongbi",
  "2d_watercolor",
  "2d_pixel",
  "2d_simple",
  "2d_sketch",
  "2d_british_comic",
  "2d_rubber_hose",
  "2d_golden",
  // 3D 动画
  "3d_fantasy",
  "3d_british",
  "3d_chibi",
  "3d_realistic",
  "3d_voxel",
  "3d_mobile_game",
  "3d_toon_render",
  "3d_japanese_npr",
  "3d_cyberpunk",
  "3d_disney",
  // 定格动画
  "stop_motion",
  "clay_stop",
  "lego_stop",
  "felt_stop",
  "paper_stop",
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
function resolveEffectiveVisualStyle(
  visualStyleHint?: string,
  suggestedVisualStyle?: string,
): string | undefined {
  // 规则 1：已有精确的 styleKey（来自模板选择），直接使用，不被 hint 覆盖
  if (suggestedVisualStyle && KNOWN_STYLE_KEYS.has(suggestedVisualStyle)) {
    return suggestedVisualStyle;
  }

  if (!visualStyleHint) return suggestedVisualStyle;

  const h = visualStyleHint.toLowerCase();

  // 真人类（写实摄影）
  if (
    h.includes("真人古装") ||
    h.includes("古装真人") ||
    h.includes("历史真人")
  )
    return "period_live";
  if (h.includes("港片") || h.includes("港式")) return "hk_film";
  if (h.includes("复古武侠") || h.includes("武侠片")) return "retro_wuxia";
  if (h.includes("好莱坞") || h.includes("西方电影") || h.includes("欧美大片"))
    return "western_film";
  if (h.includes("真人") || h.includes("实拍") || h.includes("影视"))
    return "live_action";

  // 2D 中国传统
  if (h.includes("水墨") || h.includes("国画") || h.includes("ink wash"))
    return "chinese_ink";
  if (h.includes("工笔") || h.includes("gongbi")) return "2d_gongbi";
  if (h.includes("水彩") || h.includes("watercolor")) return "2d_watercolor";
  if (h.includes("中国风") || h.includes("古风绘画") || h.includes("国风插画"))
    return "chinese_style";
  if (h.includes("黄金光堂") || h.includes("golden hall")) return "2d_golden";

  // 2D 动漫
  if (h.includes("少女漫") || h.includes("shoujo")) return "2d_shoujo";
  if (h.includes("韩漫") || h.includes("条漫") || h.includes("webtoon"))
    return "2d_korean_anime";
  if (h.includes("吉卜力") || h.includes("宫崎骏") || h.includes("ghibli"))
    return "2d_ghibli";
  if (h.includes("赛博都市") || h.includes("cybercity")) return "2d_cybercity";
  if (h.includes("热血") || h.includes("战斗漫画") || h.includes("少年漫"))
    return "2d_action";
  if (
    h.includes("复古动画") ||
    h.includes("80年代动画") ||
    h.includes("90年代动画")
  )
    return "2d_retro_anime";
  if (h.includes("奇幻动画") || h.includes("fantasy anime"))
    return "2d_fantasy_anime";
  if (h.includes("英式动画") || h.includes("british anime"))
    return "2d_british_anime";
  if (h.includes("运动漫") || h.includes("sports manga") || h.includes("篮球"))
    return "2d_sports";
  if (h.includes("手冢") || h.includes("tezuka")) return "2d_tezuka";
  if (h.includes("粗线条") || h.includes("thick line")) return "2d_thick_line";
  if (h.includes("死神") || h.includes("暗黑") || h.includes("death note"))
    return "2d_death_note";
  if (
    h.includes("恐怖漫") ||
    h.includes("horror manga") ||
    h.includes("伊藤润二")
  )
    return "2d_horror";
  if (h.includes("q版") || h.includes("chibi") || h.includes("萌系可爱"))
    return "2d_chibi";
  if (h.includes("电影动画") || h.includes("新海诚") || h.includes("shinkai"))
    return "2d_film";
  if (h.includes("动漫") || h.includes("二次元") || h.includes("anime"))
    return "2d_anime";

  // 2D 画风
  if (h.includes("像素") || h.includes("pixel") || h.includes("8-bit"))
    return "2d_pixel";
  if (
    h.includes("橡皮管") ||
    h.includes("rubber hose") ||
    h.includes("cuphead")
  )
    return "2d_rubber_hose";
  if (
    h.includes("英式漫画") ||
    h.includes("british comic") ||
    h.includes("波普")
  )
    return "2d_british_comic";
  if (h.includes("简画") || h.includes("极简") || h.includes("minimalist"))
    return "2d_simple";
  if (h.includes("素描") || h.includes("铅笔") || h.includes("sketch"))
    return "2d_sketch";

  // 3D 类 — 细粒度在前，宽泛 "3d" 兜底在最后
  if (h.includes("赛博朋克") || h.includes("cyberpunk")) return "3d_cyberpunk";
  if (
    h.includes("玄幻") ||
    h.includes("仙侠") ||
    h.includes("xianxia") ||
    h.includes("3d奇幻")
  )
    return "3d_fantasy";
  if (
    h.includes("迪士尼") ||
    h.includes("皮克斯") ||
    h.includes("pixar") ||
    h.includes("disney")
  )
    return "3d_disney";
  if (
    h.includes("日式3d") ||
    h.includes("3d漫染") ||
    h.includes("npr") ||
    h.includes("ufotable")
  )
    return "3d_japanese_npr";
  if (
    h.includes("卡通渲染") ||
    h.includes("toon render") ||
    h.includes("cel shading")
  )
    return "3d_toon_render";
  if (
    h.includes("q版3d") ||
    h.includes("3dq版") ||
    h.includes("3d萌") ||
    h.includes("chibi 3d")
  )
    return "3d_chibi";
  if (
    h.includes("方块") ||
    h.includes("体素") ||
    h.includes("voxel") ||
    h.includes("minecraft")
  )
    return "3d_voxel";
  if (
    h.includes("手游") ||
    h.includes("mobile game") ||
    h.includes("原神") ||
    h.includes("genshin")
  )
    return "3d_mobile_game";
  if (
    h.includes("英式3d") ||
    h.includes("维多利亚") ||
    h.includes("victorian 3d")
  )
    return "3d_british";
  if (
    h.includes("写实") ||
    h.includes("photoreal") ||
    h.includes("unreal engine")
  )
    return "3d_realistic";
  if (h.includes("3d") || h.includes("三维") || h.includes("cg"))
    return "3d_realistic";

  // 定格动画
  if (h.includes("乐高") || h.includes("lego")) return "lego_stop";
  if (h.includes("毛毡") || h.includes("felt") || h.includes("羊毛"))
    return "felt_stop";
  if (h.includes("纸艺") || h.includes("剪纸") || h.includes("paper"))
    return "paper_stop";
  if (h.includes("粘土") || h.includes("clay") || h.includes("claymation"))
    return "clay_stop";
  if (h.includes("定格") || h.includes("stop motion")) return "stop_motion";

  // 未匹配到关键词，回退到 AI 推荐值
  return suggestedVisualStyle;
}

@Injectable()
export class VisualAssetDesignerAgent {
  private readonly logger = new Logger(VisualAssetDesignerAgent.name);
  constructor(private readonly llm: LlmService) { }

  async design(
    seed: DramaSeed,
    outline: SeriesOutline,
    visualStyleHint?: string,
    dramaId?: string,
    userId?: string,
    suggestedVisualStyle?: string,
    audienceContext?: {
      protagonistFocus?: string;
      platformTarget?: string;
      audienceTags?: string[];
    },
    /** 来自视觉风格模板的 visualGuide（含 facePromptRule + scenePromptGuidance） */
    styleGuide?: Pick<
      VisualStyleGuide,
      "facePromptRule" | "scenePromptGuidance"
    >,
    /** 来自题材模板的生产引导（含 maleLeadFormula / femaleLeadFormula） */
    genreGuidance?: Pick<
      GenreProductionGuidance,
      "maleLeadFormula" | "femaleLeadFormula"
    >,
    additionalSystemPrompt?: string,
  ): Promise<VisualAssetDesignOutput> {
    // 建剧阶段只设计视觉风格 + 签名道具，角色/场景全部延迟到逐集生产
    const audienceLine = [
      audienceContext?.platformTarget
        ? `目标平台：${audienceContext.platformTarget}`
        : "",
      audienceContext?.protagonistFocus
        ? `叙事主角焦点：${audienceContext.protagonistFocus}`
        : "",
      audienceContext?.audienceTags?.length
        ? `受众标签：${audienceContext.audienceTags.join("、")}`
        : seed.targetAudience
          ? `受众：${seed.targetAudience}`
          : "",
    ]
      .filter(Boolean)
      .join("\n");

    const effectiveVisualStyle = resolveEffectiveVisualStyle(
      visualStyleHint,
      suggestedVisualStyle,
    );
    const styleOverrideNote =
      visualStyleHint && effectiveVisualStyle !== suggestedVisualStyle
        ? `（用户已明确选择 ${effectiveVisualStyle}，覆盖了系统推荐的 ${suggestedVisualStyle}）`
        : "";
    if (styleOverrideNote) {
      this.logger.log(`[VisualDesigner] 风格覆盖${styleOverrideNote}`);
    }

    let sysPrompt = buildVisualAssetDesignerSystemPrompt(
      effectiveVisualStyle,
      styleGuide,
      genreGuidance,
      seed.genre,
    );
    if (additionalSystemPrompt?.trim())
      sysPrompt += `\n\n=== 补充指令 ===\n${additionalSystemPrompt.trim()}`;

    const raw = await this.llm.generateStructured({
      taskName: "drama-visual-asset-designer",
      schema: visualStyleOnlySchema,
      systemPrompt: sysPrompt,
      metadata: { dramaId, userId },
      userPrompt: `请为以下短剧设计全剧视觉风格：

剧名：${seed.title}
题材：${seed.genre}
调性：${seed.tone}
${audienceLine}
主角：${seed.protagonistConcept.name}（${seed.protagonistConcept.personality}）— ${seed.protagonistConcept.situation}
${seed.antagonistConcept ? `对手：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}` : ""}
总集数：${outline.totalPlannedEpisodes}
${visualStyleHint
          ? `\n【用户指定视觉风格】：${visualStyleHint}
请将用户的美学意图翻译成适合本媒介类型的技术 T2I 词汇，写入 visualStyle。
⚠️ 翻译规则（真人/实拍路径，含古装真人）：
- 「水墨、晕染、国画感、笔触」→ soft cinematic color grading, muted palette, natural film grain
- 「柔和美感」→ soft low-saturation color grading, smooth tonal transitions
- 「古典质感」→ period-accurate costume detail, realistic texture, film grain
- 「真实感」→ photorealistic, realistic skin with natural pores, no airbrushing`
          : ""
        }

=== 重要：建剧阶段只设计视觉风格 ===
角色和场景将在各集生产时按需设计，无需在此阶段预设。

要求：
1. visualStyle 定义全剧美学基调（这是最重要的输出）
   ⚠️ visualStyle.styleReferencePrompt 是全剧的【全局风格与质感】，将作为风格后缀拼接到所有的画面中！
   必须仅包含：“photorealistic, film grain, cinematic color grading”等纯粹的光影、质感、摄影修饰词。
   绝对禁止：出现任何物理场景结构、天气、人物特征、服饰！否则会导致场景错乱。
2. 全剧级签名道具（signatureProps）：只设计 2-5 个核心道具，满足以下任一条件才列入：
   a) 角色标志性随身物（narrativeRole="signature"）
   b) 剧情核心驱动物（narrativeRole="macguffin"）
   ⚠️ 核心：道具的 visualPrompt 只写纯粹的物体核心描述，用纯英文：
   [道具主体 Object] + [结构/形态 Form] + [材质/工艺 Material] + [细节特征 Detail] + [使用状态 Condition]
   例如："Tang dynasty bronze mirror, round symmetrical form, aged bronze with rich patina, intricate engraved patterns, slightly worn edges"
   （不含构图、光影、背景词，这是分镜阶段的基因词！）
   另需为每个道具输出 referenceImagePrompt（英文）= 道具产品图最终完整 T2I 提示词。
   公式：[visualPrompt内容] + "isolated centered composition, cinematic macro photography, material texture detail, studio spotlight, no people, no hands, product shot" + [全剧风格前缀]
   此字段是送给 T2I 引擎的完整定版图咒语。
3. 不要输出 characters 或 locations`,
      temperature: 0.5,
    });

    return visualStyleOnlySchema.parse(raw);
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
    const existing = state.characters
      .slice(0, 3)
      .map(
        (c) =>
          `${c.characterId}(${c.name}): face="${c.faceReferencePrompt?.slice(0, 80)}" costume="${c.defaultCostumePrompt?.slice(0, 60)}"`,
      )
      .join("\n");
    const vs = state.visualStyle;
    const styleCtx = vs
      ? `美学=${vs.overallAesthetic}, 调色=${vs.colorGrading}, 光影=${vs.lightingStyle}, 渲染=${vs.renderTechnique ?? ""}, 材质=${vs.textureStyle ?? ""}, 参考=${vs.referenceStyle ?? ""}, 时代=${vs.era}`
      : "";

    const charRequests = proposed
      .map(
        (p, i) =>
          `${i + 1}. characterId="${p.characterId}", name="${p.name}", role=${p.role}\n` +
          `   叙事作用：${p.narrativePurpose}\n` +
          `   外观提示：${p.appearanceHint}\n` +
          `   有无台词：${p.hasDialogue ? "有" : "无"}`,
      )
      .join("\n");

    const baseCharacterPrompt = state.promptProfile?.agentSystemPrompts?.['character-designer'];
    let systemPrompt: string;
    if (baseCharacterPrompt) {
      systemPrompt = baseCharacterPrompt.replace(
        '{{facePromptRule}}',
        vs?.facePromptRule ?? 'faceReferencePrompt 必须以【渲染风格词 + 角色身份词】开头，先锚定风格，再描述五官。只写纯粹的外观基因词（3-5个），不含镜头/背景词。'
      ) + `\n13. characterId 输出时保持输入值不变，不要自行修改（系统会自动归一化为小写无分隔符格式）\n14. name 字段必须输出中文角色名称（如"李白""高力士"），禁止输出英文ID（如"li_bai"）\n15. 【新增必填字段】referenceImagePrompt（英文）= 角色定妆照最终完整 T2I 提示词。\n    组装公式：[age phrase] + [faceReferencePrompt内容] + [hairStylePrompt] + [defaultCostumePrompt] + [bodyTypePrompt] + "eyes sharply in focus, clear iris detail, realistic skin texture, even studio lighting, front-facing, looking at camera, neutral plain background, character reference sheet" + [全剧风格前缀]\n    ⚠️ 此字段仅用于生成定妆照，不会被分镜流程使用。必须是一句流畅完整的英语。`;
    } else {
      systemPrompt = `你是一位短剧视觉总监，现在需要为已开拍的短剧补充新角色的视觉身份。
新角色必须与已有角色在同一美学体系下——面部描述精度、服饰风格、T2I提示词规范都要对齐。

=== 角色生成工程公式 ===
角色组装公式为：[Identity] + [Face/Hair] + [Pose/Action] + [Costume] + [Camera] + [Light] + [Style]。
你在这一阶段，专门负责设计并返回前序的物理特征组件（需用纯英文描述）：

1. faceReferencePrompt（英文）= 纯粹角色基因词，仅含 [Identity] + [Face/Hair]。
   包含：年龄层、性别、身份角色 + 脸型/肤色/标志性五官。3-5个核心特征，不含任何镜头/背景/动作词。
   本剧补充规则：${vs?.facePromptRule ?? '必须以角色身份词开头，先锚定年龄与身份，再描述五官。'}
2. hairStylePrompt（英文）= 发型描述（单独提取，以备特殊镜头调用）
3. defaultCostumePrompt（英文）= 服装描述，写明款式/材质/局部纹理。绝对不含动作和背景。
4. bodyTypePrompt（英文）= 体态特征
5. referenceImagePrompt（英文）= 角色定妆照最终完整 T2I 提示词（这是一次性的定妆图生成咒语）。
   组装公式：[age phrase] + [faceReferencePrompt内容] + [hairStylePrompt] + [defaultCostumePrompt] + [bodyTypePrompt] + "eyes sharply in focus, clear iris detail, realistic skin texture with visible pores, even studio lighting, front-facing, looking at camera, neutral plain background, character reference sheet" + [全剧风格前缀]
   ⚠️ 此字段仅用于生成定妆照，不会被分镜流程使用。必须是一句流畅完整的英语。
6. faceDescription / defaultCostume（中文）= 对应上述英文的美学设计中文文案。
7. voiceProfile = 如有台词必须设计配音风格；无台词可用默认值
8. variations = minor 角色可以没有变体（空数组），supporting 角色至少1个
   变体类型（variationType）规则：
   - costume（默认）：换装，面部不变
   - age：年龄跨度，需填写 ageHint（英文年龄外貌词）和 faceOverridePrompt（年龄化面部提示词）
   - transformation：变身/化形/修炼突破，需填写 faceOverridePrompt
   - disguise：伪装，发型/妆容变化
9. 所有英文 T2I 字段的画面风格关键词必须与全剧 visualStyle 一致
10. T2I 内容审核兼容：英文 T2I 字段禁用以下词汇（括号内为替代词）：
    sinister/evil→sharp/cold, hypocritical→composed/enigmatic, drunken→heavy-lidded,
    rebellious→proud/unyielding, tragic→solemn/dramatic, menacing→commanding,
    weathered face with dirt→weathered and rugged face
    始终用视觉属性描述外观，不用道德评判词
11. soulProfile（灵魂画像）所有字段必须使用【简体中文】输出，禁止英文。
12. scope 规则：protagonist/antagonist → 'series'，supporting → 'arc'，minor → 'episode'
13. characterId 输出时保持输入值不变，不要自行修改（系统会自动归一化为小写无分隔符格式）
14. name 字段必须输出中文角色名称（如"李白""高力士"），禁止输出英文ID（如"li_bai"）`;
    }

    const raw = await this.llm.generateStructured({
      taskName: "drama-new-character-designer",
      schema: newCharactersOutputSchema,
      metadata: { dramaId: state.dramaId, userId: state.userId },
      systemPrompt,
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
    this.logger.log(
      `新角色设计完成：${result.characters.map((c) => `${c.characterId}(${c.name})`).join(", ")}`,
    );
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
    const poolMap = new Map(
      (state.minorRolePool ?? []).map((p) => [p.characterId, p]),
    );
    const currentIds = new Set(state.characters.map((c) => c.characterId));

    // Step A: activeCharacters 中命中池的角色直接复用
    const reused: CharacterIdentity[] = [];
    const poolUsageUpdates: Array<{ characterId: string }> = [];
    for (const ac of intent.activeCharacters ?? []) {
      if (currentIds.has(ac.characterId) || !poolMap.has(ac.characterId))
        continue;
      const poolEntry = poolMap.get(ac.characterId)!;
      reused.push({ ...poolEntry.identity, scope: "episode" });
      currentIds.add(ac.characterId);
      poolUsageUpdates.push({ characterId: ac.characterId });
    }

    if (reused.length > 0) {
      this.logger.log(
        `[AssetLibrary] 池复用 ${reused.length} 个角色: ${reused.map((c) => `${c.characterId}(${c.name})`).join(", ")}`,
      );
    }

    // Step A2: activeCharacters 中既不在 state.characters 也不在池中的角色 → 自动提升为 proposedNewCharacters
    // 典型场景：第1集，state.characters=[]，主角/反派在 activeCharacters 中但无人设计
    const reuseIds = new Set(reused.map((c) => c.characterId));
    const orphanActive = (intent.activeCharacters ?? []).filter(
      (ac) =>
        ac.characterId &&
        !currentIds.has(ac.characterId) &&
        !reuseIds.has(ac.characterId),
    );

    // ── 角色名称推断辅助函数 ──
    // 将 characterId（如 "li_bai"）与 seed concept 名称（如 "李白"）做模糊匹配
    const normalizeCid = (s: string) =>
      s.toLowerCase().replace(/[\s\-_]+/g, "");
    const protagonistName = state.seed?.protagonistConcept?.name ?? "";
    const antagonistName = state.seed?.antagonistConcept?.name ?? "";
    // 构建 characterId → seed outline 中已知角色信息的查找表
    const outlineCharMap = new Map<string, { name: string; role: string }>();
    for (const ep of state.seriesOutline?.episodes ?? []) {
      for (const kid of ep.keyCharacterIds ?? []) {
        // outline 中 keyCharacterIds 是 characterId 格式，不含中文名
        if (!outlineCharMap.has(kid))
          outlineCharMap.set(kid, { name: kid, role: "supporting" });
      }
    }
    // 从 intent.proposedNewCharacters 中预取中文角色名（这些通常有正确的中文 name）
    const proposedNameMap = new Map<string, string>();
    for (const p of intent.proposedNewCharacters ?? []) {
      if (p.characterId && p.name && p.name !== p.characterId) {
        proposedNameMap.set(p.characterId, p.name);
      }
    }

    const autoProposed: ProposedCharacter[] = orphanActive.map((ac) => {
      const cid = ac.characterId;
      const cidNorm = normalizeCid(cid);
      // 匹配主角：对比 characterId 与主角名称的拼音形式
      const isProtag =
        protagonistName &&
        (cid === protagonistName ||
          cidNorm === normalizeCid(protagonistName) ||
          // 宽松匹配：seed 中角色名为中文时，检查 outline 中第一集的 keyCharacterIds
          (state.seriesOutline?.episodes?.[0]?.keyCharacterIds?.includes(cid) &&
            ac.role === "protagonist"));
      const isAntag =
        !isProtag &&
        antagonistName &&
        (cid === antagonistName ||
          cidNorm === normalizeCid(antagonistName) ||
          ac.role === "antagonist");
      const concept = isProtag
        ? state.seed?.protagonistConcept
        : isAntag
          ? state.seed?.antagonistConcept
          : undefined;
      // 名称优先级：seed concept 中文名 > proposedNewCharacters 中文名 > activeCharacters.name > characterId
      const name =
        concept?.name ??
        proposedNameMap.get(cid) ??
        ((ac as any).name && (ac as any).name !== cid
          ? (ac as any).name
          : undefined) ??
        cid;
      const personality = (concept as any)?.personality ?? "";
      const situation =
        (concept as any)?.situation ?? (concept as any)?.motivation ?? "";
      return {
        characterId: cid,
        name,
        role: (isProtag
          ? "protagonist"
          : isAntag
            ? "antagonist"
            : (ac.role ?? "supporting")) as "supporting" | "minor",
        scope: "arc" as const,
        narrativePurpose: personality
          ? `${personality}; ${situation}`
          : "本集核心角色",
        appearanceHint: concept
          ? `来自种子：${JSON.stringify(concept).slice(0, 200)}`
          : "",
        hasDialogue: true,
      };
    });
    if (autoProposed.length > 0) {
      this.logger.log(
        `[AssetLibrary] 自动提升 ${autoProposed.length} 个 activeCharacters 为新角色设计: ${autoProposed.map((p) => `${p.characterId}(${p.name})`).join(", ")}`,
      );
    }

    // Step B: proposedNewCharacters + autoProposed，排除已复用/已知的，剩余提交 LLM 设计
    // ⚠️ 去重：autoProposed 与 proposedNewCharacters 可能包含相同 characterId，
    //    优先保留 proposedNewCharacters（有更丰富的 appearanceHint/narrativePurpose）
    const proposedIds = new Set(
      (intent.proposedNewCharacters ?? []).map((p) => p.characterId),
    );
    const deduped = [
      ...autoProposed.filter((p) => !proposedIds.has(p.characterId)), // auto 的只有不在 proposed 中的才保留
      ...(intent.proposedNewCharacters ?? []),
    ];
    const genuinelyNew = deduped.filter(
      (p): p is ProposedCharacter =>
        !!p.characterId &&
        !!p.name &&
        !currentIds.has(p.characterId) &&
        !reuseIds.has(p.characterId),
    );

    let designed: CharacterIdentity[] = [];
    if (genuinelyNew.length > 0) {
      // 建立 characterId → proposed scope 的映射，让设计结果的生命周期与导演意图对齐
      const proposedScopeMap = new Map(
        genuinelyNew.map((p) => [p.characterId, p.scope ?? "episode"]),
      );
      const rawDesigned = await this.designNewCharacters(state, genuinelyNew);
      designed = rawDesigned.map((c) => ({
        ...c,
        scope: proposedScopeMap.get(c.characterId) ?? "episode",
      }));
    }

    const all = [...reused, ...designed];
    return { reused, designed, all, poolUsageUpdates };
  }

  /**
   * 为逐集生产中出现的新场景生成完整视觉描述。
   * 复用全剧视觉风格（visualStyle）+ 已有场景作为参考锚点，确保新场景与全剧美学一致。
   */
  async designNewLocations(
    state: DramaState,
    locationHints: Array<{
      locationId: string;
      name?: string;
      narrativeContext?: string;
    }>,
  ): Promise<z.infer<typeof newLocationsOutputSchema>["locations"]> {
    if (!locationHints.length) return [];
    const existing = state.locations
      .slice(0, 5)
      .map(
        (l) =>
          `${l.locationId}(${l.name}): visualPrompt="${l.visualPrompt?.slice(0, 80)}"`,
      )
      .join("\n");
    const vs = state.visualStyle;
    const styleCtx = vs
      ? `美学=${vs.overallAesthetic}, 调色=${vs.colorGrading}, 光影=${vs.lightingStyle}, 渲染=${vs.renderTechnique ?? ""}, 材质=${vs.textureStyle ?? ""}`
      : "";

    const locRequests = locationHints
      .map(
        (h, i) =>
          `${i + 1}. locationId="${h.locationId}", name="${h.name ?? h.locationId}"\n` +
          `   叙事语境：${h.narrativeContext ?? "本集剧情需要此场景"}`,
      )
      .join("\n");

    const baseLocationPrompt = state.promptProfile?.agentSystemPrompts?.['location-designer'];
    const systemPromptTextLocation = baseLocationPrompt
      ? baseLocationPrompt + `\n10. locationId 输出时保持输入值不变。\n11. 【新增必填字段】referenceImagePrompt（英文，50-80词）= 场景概念图最终完整 T2I 提示词。\n    组装公式：[establishing wide angle perspective, deep vanishing point] + [visualPrompt内容] + "symmetrical architectural composition, leading lines, absolutely no people, empty environment, uninhabited space" + [色调] + [全剧风格前缀]\n    visualPrompt 只写核心结构/材质（不含构图/风格词），referenceImagePrompt 是含全套摄影词的完整咒语。`
      : `你是一位短剧视觉总监，现在需要为已开拍的短剧设计新场景的视觉描述。
新场景必须与已有场景在同一美学体系下——T2I提示词规范、光影风格、色调都要对齐。

=== 设计要求 ===
每个场景必须包含以下字段：
1. locationId / name / description（中文）
2. visualPrompt（英文，50-80词）= 场景核心基因词（仅含空间结构/材质/光照，不含构图/镜头/风格词）。
   公式：[主体场景 Scene] + [空间结构 Structure] + [材质微观 Material] + [环境光照 Light] + [氛围介质 Atmosphere]
   ⚠️ 铁律：绝对不要写任何构图/镜头词（wide shot等）或风格词（photorealistic等）！
   🚫 必须是【无人区域（no people）】的纯环境描述！
3. referenceImagePrompt（英文，50-80词）= 场景概念图最终完整 T2I 提示词（一次性定版图生成咒语）。
   组装公式：[establishing wide angle perspective, deep vanishing point] + [visualPrompt内容] + "symmetrical architectural composition, leading lines, absolutely no people, empty environment, uninhabited space" + [色调] + [全剧风格前缀]
   此字段是最终送给 T2I 引擎的完整句子，含透视构图、无人声明、建筑摄影专业词。
4. lightingDefault（英文）：该场景默认光线条件
5. colorTone（英文短语）：如 "warm_amber_and_brown"
6. ambientSoundDefault：默认环境音
7. keyProps：场景内普通道具中文文字列表
8. isRecurring：是否高频复用场景
9. 所有英文 T2I 字段的画面风格关键词必须与全剧 visualStyle 一致
10. locationId 输出时保持输入值不变。`;

    const raw = await this.llm.generateStructured({
      taskName: "drama-new-location-designer",
      schema: newLocationsOutputSchema,
      metadata: { dramaId: state.dramaId, userId: state.userId },
      systemPrompt: systemPromptTextLocation,
      userPrompt: `剧名：${state.seed.title}
题材：${state.seed.genre}
全剧视觉风格：${styleCtx}

已有场景参考（注意保持美学一致性）：
${existing}

需要设计的新场景：
${locRequests}

请输出 locations 数组，每个场景包含完整的 SceneLocation 数据。locationId 使用上面指定的值。`,
      temperature: 0.4,
    });

    const result = newLocationsOutputSchema.parse(raw);
    this.logger.log(
      `新场景设计完成：${result.locations.map((l) => `${l.locationId}(${l.name})`).join(", ")}`,
    );
    return result.locations;
  }
}
