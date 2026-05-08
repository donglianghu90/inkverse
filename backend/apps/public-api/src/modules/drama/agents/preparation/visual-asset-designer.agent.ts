/**
 * 视觉资产设计师（Visual Asset Librarian）
 *
 * 职责一：全剧初始资产设计（仅视觉风格）
 * 职责二：逐集临时角色解析 — resolveEpisodeCharacters()
 * 职责三：逐集道具发现 — discoverEpisodeProps()
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
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';
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
  EpisodeScript,
  SignatureProp,
} from "../../schemas/drama-state.schemas";
import { buildVisualAssetDesignerSystemPrompt } from "../../prompting/drama-playbook";
import type { GenreProductionGuidance } from "../../../template/entities/drama-genre-template.entity";
import type { VisualStyleGuide } from "../../../template/entities/drama-visual-style-template.entity";

/** 建剧阶段只输出视觉风格，角色/场景/道具全部延迟到逐集生产 */
const visualStyleOnlySchema = z.object({
  visualStyle: visualStyleGuideSchema,
});

/** 逐集道具发现输出 */
const episodePropsOutputSchema = z.object({
  discoveredProps: z.preprocess((v) => v ?? [], z.array(signaturePropSchema)).default([]),
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

    const sysPrompt = buildVisualAssetDesignerSystemPrompt(
      effectiveVisualStyle,
      styleGuide,
      genreGuidance,
      additionalSystemPrompt?.trim() || undefined,
    );

    const raw = await this.llm.generateStructured({
      taskName: DRAMA_AGENT_REGISTRY.VISUAL_ASSET_DESIGNER.key,
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
角色、场景、道具全部延迟到逐集生产时按需设计，无需在此阶段预设。

要求：
1. visualStyle 定义全剧美学基调（这是唯一输出）
   ⚠️ visualStyle.styleReferencePrompt 是全剧的【全局风格与质感】，将作为风格后缀拼接到所有的画面中！
   必须仅包含：“photorealistic, film grain, cinematic color grading”等纯粹的光影、质感、摄影修饰词。
   绝对禁止：出现任何物理场景结构、天气、人物特征、服饰！否则会导致场景错乱。
2. 不要输出 characters、locations 或 signatureProps`,
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

const VOLCENGINE_VOICE_LIST = `zh_female_vv_uranus_bigtts (Vivi 2.0 - 通用女声), zh_female_xiaohe_uranus_bigtts (小何 2.0 - 通用女声), zh_male_m191_uranus_bigtts (云舟 2.0 - 通用男声), zh_male_taocheng_uranus_bigtts (小天 2.0 - 通用男声), zh_male_liufei_uranus_bigtts (刘飞 2.0 - 通用男声), zh_female_sophie_uranus_bigtts (魅力苏菲 2.0 - 通用女声), zh_female_qingxinnvsheng_uranus_bigtts (清新女声 2.0 - 通用女声), zh_female_cancan_uranus_bigtts (知性灿灿 2.0 - 角色扮演女), zh_female_sajiaoxuemei_uranus_bigtts (撒娇学妹 2.0 - 角色扮演女), zh_female_tianmeixiaoyuan_uranus_bigtts (甜美小源 2.0 - 通用女声), zh_female_tianmeitaozi_uranus_bigtts (甜美桃子 2.0 - 通用女声), zh_female_shuangkuaisisi_uranus_bigtts (爽快思思 2.0 - 通用女声), zh_female_peiqi_uranus_bigtts (佩奇猪 2.0 - 视频配音), zh_female_linjianvhai_uranus_bigtts (邻家女孩 2.0 - 通用女声), zh_male_shaonianzixin_uranus_bigtts (少年梓辛/Brayan 2.0 - 通用男声), zh_male_sunwukong_uranus_bigtts (猴哥 2.0 - 视频配音男), zh_female_yingyujiaoxue_uranus_bigtts (Tina老师 2.0 - 教育女声双语), zh_female_kefunvsheng_uranus_bigtts (暖阳女声 2.0 - 客服女声), zh_female_xiaoxue_uranus_bigtts (儿童绘本 2.0 - 有声阅读女), zh_male_dayi_uranus_bigtts (大壹 2.0 - 视频配音男), zh_female_mizai_uranus_bigtts (黑猫侦探社咪仔 2.0 - 视频配音女), zh_female_jitangnv_uranus_bigtts (鸡汤女 2.0 - 视频配音女), zh_female_meilinvyou_uranus_bigtts (魅力女友 2.0 - 通用女声), zh_female_liuchangnv_uranus_bigtts (流畅女声 2.0 - 视频配音女), zh_male_ruyayichen_uranus_bigtts (儒雅逸辰 2.0 - 视频配音男), zh_female_wenroumama_uranus_bigtts (温柔妈妈 2.0 - 通用女声), zh_male_jieshuoxiaoming_uranus_bigtts (解说小明 2.0 - 通用男声), zh_female_tvbnv_uranus_bigtts (TVB女声 2.0 - 通用女声), zh_male_yizhipiannan_uranus_bigtts (译制片男 2.0 - 通用男声), zh_female_qiaopinv_uranus_bigtts (俏皮女声 2.0 - 通用女声), zh_female_zhishuaiyingzi_uranus_bigtts (直率英子 2.0 - 角色扮演女), zh_male_linjiananhai_uranus_bigtts (邻家男孩 2.0 - 通用男声), zh_male_silang_uranus_bigtts (四郎 2.0 - 角色扮演男), zh_male_ruyaqingnian_uranus_bigtts (儒雅青年 2.0 - 通用男声), zh_male_qingcang_uranus_bigtts (擎苍 2.0 - 角色扮演男), zh_male_xionger_uranus_bigtts (熊二 2.0 - 角色扮演男), zh_female_yingtaowanzi_uranus_bigtts (樱桃丸子 2.0 - 角色扮演女), zh_male_wennuanahu_uranus_bigtts (温暖阿虎/Alvin 2.0 - 通用男声), zh_male_naiqimengwa_uranus_bigtts (奶气萌娃 2.0 - 通用男宝), zh_female_popo_uranus_bigtts (婆婆 2.0 - 通用老妇), zh_female_gaolengyujie_uranus_bigtts (高冷御姐 2.0 - 通用女声), zh_male_aojiaobazong_uranus_bigtts (傲娇霸总 2.0 - 通用男声), zh_male_lanyinmianbao_uranus_bigtts (懒音绵宝 2.0 - 角色扮演男), zh_male_fanjuanqingnian_uranus_bigtts (反卷青年 2.0 - 通用男声), zh_female_wenroushunv_uranus_bigtts (温柔淑女 2.0 - 通用女声), zh_female_gufengshaoyu_uranus_bigtts (古风少御 2.0 - 角色扮演女), zh_male_huolixiaoge_uranus_bigtts (活力小哥 2.0 - 通用男声), zh_male_baqiqingshu_uranus_bigtts (霸气青叔 2.0 - 有声阅读男), zh_male_xuanyijieshuo_uranus_bigtts (悬疑解说 2.0 - 有声阅读男), zh_female_mengyatou_uranus_bigtts (萌丫头/Cutey 2.0 - 通用女声), zh_female_tiexinnvsheng_uranus_bigtts (贴心女声/Candy 2.0 - 通用女声), zh_female_jitangmei_uranus_bigtts (鸡汤妹妹/Hope 2.0 - 通用女声), zh_male_cixingjieshuonan_uranus_bigtts (磁性解说男声/Morgan 2.0 - 通用男声), zh_male_liangsangmengzai_uranus_bigtts (亮嗓萌仔 2.0 - 通用男宝), zh_female_kailangjiejie_uranus_bigtts (开朗姐姐 2.0 - 通用女声), zh_male_gaolengchenwen_uranus_bigtts (高冷沉稳 2.0 - 通用男声), zh_male_shenyeboke_uranus_bigtts (深夜播客 2.0 - 通用男声), zh_male_lubanqihao_uranus_bigtts (鲁班七号 2.0 - 角色扮演男), zh_female_jiaochuannv_uranus_bigtts (娇喘女声 2.0 - 通用女声), zh_female_linxiao_uranus_bigtts (林潇 2.0 - 角色扮演女), zh_female_lingling_uranus_bigtts (玲玲姐姐 2.0 - 角色扮演女), zh_female_chunribu_uranus_bigtts (春日部姐姐 2.0 - 角色扮演女), zh_male_tangseng_uranus_bigtts (唐僧 2.0 - 角色扮演男), zh_male_zhuangzhou_uranus_bigtts (庄周 2.0 - 角色扮演男), zh_male_kailangdidi_uranus_bigtts (开朗弟弟 2.0 - 通用男声), zh_male_zhubajie_uranus_bigtts (猪八戒 2.0 - 角色扮演男), zh_female_ganmaodianyin_uranus_bigtts (感冒电音姐姐 2.0 - 角色扮演女), zh_female_chanmeinv_uranus_bigtts (谄媚女声 2.0 - 通用女声), zh_female_nvleishen_uranus_bigtts (女雷神 2.0 - 角色扮演女), zh_female_qinqienv_uranus_bigtts (亲切女声 2.0 - 通用女声), zh_male_kuailexiaodong_uranus_bigtts (快乐小东 2.0 - 通用男声), zh_male_kailangxuezhang_uranus_bigtts (开朗学长 2.0 - 通用男声), zh_male_youyoujunzi_uranus_bigtts (悠悠君子 2.0 - 通用男声), zh_female_wenjingmaomao_uranus_bigtts (文静毛毛 2.0 - 通用女声), zh_female_zhixingnv_uranus_bigtts (知性女声 2.0 - 通用女声), zh_male_qingshuangnanda_uranus_bigtts (清爽男大 2.0 - 通用男声), zh_male_yuanboxiaoshu_uranus_bigtts (渊博小叔 2.0 - 通用男声), zh_male_yangguangqingnian_uranus_bigtts (阳光青年 2.0 - 通用男声), zh_female_qingchezizi_uranus_bigtts (清澈梓梓 2.0 - 通用女声), zh_female_tianmeiyueyue_uranus_bigtts (甜美悦悦 2.0 - 通用女声), zh_female_xinlingjitang_uranus_bigtts (心灵鸡汤 2.0 - 通用女声), zh_male_wenrouxiaoge_uranus_bigtts (温柔小哥 2.0 - 通用男声), zh_female_roumeinvyou_uranus_bigtts (柔美女友 2.0 - 通用女声), zh_male_dongfanghaoran_uranus_bigtts (东方浩然 2.0 - 通用男声), zh_female_wenrouxiaoya_uranus_bigtts (温柔小雅 2.0 - 通用女声), zh_male_tiancaitongsheng_uranus_bigtts (天才童声 2.0 - 通用男宝), zh_female_wuzetian_uranus_bigtts (武则天 2.0 - 角色扮演女), zh_female_gujie_uranus_bigtts (顾姐 2.0 - 角色扮演女), zh_male_guanggaojieshuo_uranus_bigtts (广告解说 2.0 - 通用男声), zh_female_shaoergushi_uranus_bigtts (少儿故事 2.0 - 有声阅读女), saturn_zh_female_tiaopigongzhu_tob (调皮公主 - 角色扮演), saturn_zh_female_keainvsheng_tob (可爱女生 - 角色扮演), saturn_zh_male_shuanglangshaonian_tob (爽朗少年 - 角色扮演), saturn_zh_male_tiancaitongzhuo_tob (天才同桌 - 角色扮演), saturn_zh_female_cancan_tob (知性灿灿 - 角色扮演), saturn_zh_female_qingyingduoduo_cs_tob (轻盈朵朵 2.0 - 客服), saturn_zh_female_wenwanshanshan_cs_tob (温婉珊珊 2.0 - 客服), saturn_zh_female_reqingaina_cs_tob (热情艾娜 2.0 - 客服), saturn_zh_male_qingxinmumu_cs_tob (清新沐沐 2.0 - 客服), en_male_tim_uranus_bigtts (Tim - 美式英语), en_female_dacey_uranus_bigtts (Dacey - 美式英语), en_female_stokie_uranus_bigtts (Stokie - 美式英语)`;

    const baseCharacterPrompt = state.promptProfile?.agentSystemPrompts?.['character-designer'];
    let systemPrompt: string;
    if (baseCharacterPrompt) {
      systemPrompt = baseCharacterPrompt.replace(
        '{{facePromptRule}}',
        vs?.facePromptRule ?? 'faceReferencePrompt 必须以【渲染风格词 + 角色身份词】开头，先锚定风格，再描述五官。只写纯粹的外观基因词（3-5个），不含镜头/背景词。'
      ) + `\n13. characterId 输出时保持输入值不变，不要自行修改（系统会自动归一化为小写无分隔符格式）\n14. name 字段必须输出中文角色名称（如"李白""高力士"），禁止输出英文ID（如"li_bai"）\n15. 【新增必填字段】referenceImagePrompt（英文）= 角色定妆照最终完整 T2I 提示词。\n    组装公式：[age phrase] + [faceReferencePrompt内容] + [hairStylePrompt] + [defaultCostumePrompt] + [bodyTypePrompt] + "eyes sharply in focus, clear iris detail, realistic skin texture, even studio lighting, front-facing, looking at camera, neutral plain background, character reference sheet" + [全剧风格前缀]\n    ⚠️ 此字段仅用于生成定妆照，不会被分镜流程使用。必须是一句流畅完整的英语。\n16. ⚠️ ttsVoiceId 必须从火山引擎(Volcengine)模型提供的音色库中精确选用，严格根据角色人设匹配ID！\n    可用预设音色 ID 列表如下（必须填入其一）：\n    ${VOLCENGINE_VOICE_LIST}\n    只填ID本身（如 zh_female_vv_uranus_bigtts），不要带括号里的描述。`;
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
7. voiceProfile = 如有台词必须设计配音风格。⚠️ 重点：ttsVoiceId 必须从以下火山引擎(Volcengine)合规列表中精准选用对应角色的人设音色ID！
   可用的所有音色ID映射表：
   ${VOLCENGINE_VOICE_LIST}
   （仅填ID本身，如 zh_female_vv_uranus_bigtts，不要带括号及后面的描述文字）
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
      taskName: DRAMA_AGENT_REGISTRY.CHARACTER_DESIGNER.key,
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
      taskName: DRAMA_AGENT_REGISTRY.LOCATION_DESIGNER.key,
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

  /**
   * Lazy per-episode prop discovery from script text.
   * Follows the same pattern as designNewCharacters / designNewLocations:
   * - Existing props (state.signatureProps) are not re-designed
   * - Only signature-level props are identified (character markers / macguffins / recurring items)
   * - Returns only NEW props not yet in state
   */
  async discoverEpisodeProps(
    state: DramaState,
    script: EpisodeScript,
    episodeNumber: number,
  ): Promise<SignatureProp[]> {
    const sceneDigests = (script.scenes ?? []).map((s, i) => {
      const lines: string[] = [`S${i + 1}: ${s.sceneHeading}`];
      if (s.objective) lines.push(`  goal: ${s.objective}`);
      for (const a of s.actions ?? []) {
        lines.push(`  act: ${a.characterId ? `[${a.characterId}]` : ''} ${a.description}`);
      }
      for (const d of s.dialogues ?? []) {
        lines.push(`  dlg: [${d.characterId}] ${d.text}`);
      }
      return lines.join('\n');
    }).join('\n\n');

    if (!sceneDigests.trim()) return [];

    const existingProps = (state.signatureProps ?? []).map(
      p => `${p.propId}(${p.name}): ${p.visualPrompt?.slice(0, 60) ?? ''}`,
    ).join('\n');

    const vs = state.visualStyle;
    const styleCtx = vs
      ? `aesthetic=${vs.overallAesthetic}, colorGrading=${vs.colorGrading}, lighting=${vs.lightingStyle}`
      : '';
    const styleRefPrompt = vs?.styleReferencePrompt ?? '';

    // 封闭词表：注入角色/场景 ID 白名单，让 LLM 从列表中选择而非自己猜测
    const charWhitelist = (state.characters ?? [])
      .map(c => `${c.characterId}(${c.name})`)
      .join(', ');
    const locWhitelist = (state.locations ?? [])
      .map(l => `${l.locationId}(${l.name})`)
      .join(', ');

    const raw = await this.llm.generateStructured({
      taskName: DRAMA_AGENT_REGISTRY.VISUAL_ASSET_DESIGNER.key,
      schema: episodePropsOutputSchema,
      metadata: { dramaId: state.dramaId, userId: state.userId },
      systemPrompt: `You are a film prop designer. Identify NEW signature props from the script that require visual consistency tracking.

=== Signature Prop Criteria (ONLY these qualify) ===
1. narrativeRole="signature" - Character's iconic personal item (jade pendant, folding fan, sword)
2. narrativeRole="macguffin" - Plot-driving object (secret decree, antidote, inheritance letter)
3. narrativeRole="recurring" - Cross-scene recurring key object (token, weapon, seal)

=== DO NOT include ===
- Furniture, background decorations
- One-off items that appear only briefly
- Food, daily necessities without narrative drive
- Props already in the "existing props" list

=== Output format per prop ===
- propId: english/pinyin (e.g. jade_seal, golden_hairpin)
- name: Chinese name
- description: Chinese, 30-60 chars (material, era, appearance)
- visualPrompt (English, core object gene-words only):
  [Object] + [Form] + [Material] + [Detail] + [Condition]
  NO composition/lighting/background words!
- referenceImagePrompt (English, complete T2I prompt):
  [visualPrompt] + "isolated centered composition, cinematic macro photography, material texture detail, studio spotlight, no people, no hands, product shot" + [style suffix]
- narrativeRole: signature / macguffin / recurring
- appearsInScenes: MUST use locationIds from the available list below (exact match)
- characterOwner: MUST be one of the available characterIds below (exact match, required for signature type)

If no new signature props found, return discoveredProps=[].`,
      userPrompt: `Drama: ${state.seed.title}
Genre: ${state.seed.genre}
Visual style: ${styleCtx}
Style suffix: ${styleRefPrompt}

Available characters (use exact characterId for characterOwner):
[${charWhitelist || 'none'}]

Available locations (use exact locationId for appearsInScenes):
[${locWhitelist || 'none'}]

Existing signature props (DO NOT re-design):
${existingProps || '(none yet)'}

Episode ${episodeNumber} script:
${sceneDigests}

Identify new signature props from this episode (empty array if none).`,
      temperature: 0.3,
    });

    const result = episodePropsOutputSchema.parse(raw);
    const existingIds = new Set((state.signatureProps ?? []).map(p => p.propId));
    const newProps = result.discoveredProps.filter(p => !existingIds.has(p.propId));

    if (newProps.length > 0) {
      this.logger.log(
        `[E${episodeNumber}] prop discovery: ${newProps.map(p => `${p.propId}(${p.name})`).join(', ')}`,
      );
    }
    return newProps;
  }
}
