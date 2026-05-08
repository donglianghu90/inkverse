/**
 * 短剧引擎核心数据契约 — 从创意到 Shot JSON 的完整类型系统。
 * 设计原则：每个 Shot 包含视频/音频/字幕生成所需的全部元数据，可直接对接 T2V/TTS/FFmpeg。
 */
import { z } from 'zod';

/**
 * null 安全数组工厂 — AI 大模型有时对"空列表"返回 null 而非 []。
 * 所有 LLM 直接输出的数组字段统一用此函数定义，避免 Zod invalid_type 报错。
 */
const na = <T extends z.ZodTypeAny>(schema: T, defaultVal: z.infer<T>[] = []) =>
  z.preprocess((v) => v ?? defaultVal, z.array(schema));

/**
 * null 安全字符串工厂 — AI 大模型有时对可选字符串字段返回 null 而非 "" 或 undefined。
 * 所有 LLM 直接输出的字符串字段统一用此函数定义。
 */
const ns = (def = '') => z.union([z.string(), z.null()]).transform(v => v ?? def).default(def);

// ---------------------------------------------------------------------------
// Phase 0: 短剧题材与受众
// ---------------------------------------------------------------------------

export const dramaAudienceDirectiveSchema = z.object({
  audienceTags: na(z.string()),
  protagonistFocus: z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble']).default('female_lead'),
  tonePreference: ns(),
  platformTarget: z.enum([
    'douyin', 'kuaishou', 'hongguo', 'wechat_mini', 'bilibili',
    'tencent_video', 'mango_tv', 'iqiyi', 'reelshort', 'dramabox', 'generic',
  ]).default('generic'),
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
  hardConstraints: na(z.string()),
  softPreferences: na(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 1: 短剧种子 (Drama Seed)
// ---------------------------------------------------------------------------

export const dramaSeedSchema = z.object({
  title: z.string(),
  genre: z.string(), // 题材类型：霸总/甜宠/战神/穿越/宫斗/复仇/重生/传记剧/历史剧/神话传说/科幻 等
  targetAudience: z.string(),
  logline: z.string(), // 一句话概括
  protagonistConcept: z.object({
    name: z.string(),
    situation: z.string(), // 初始处境
    coreDesire: z.string(), // 核心欲望
    personality: z.string(),
    fatalFlaw: ns(), // 致命弱点（驱动冲突）
  }),
  antagonistConcept: z.object({
    name: z.string(),
    motivation: z.string(),
    relationship: z.string(), // 与主角的关系
  }).optional().nullable(),
  tone: z.string(), // 风格调性
  coreConflict: z.string(), // 核心矛盾
  catharsisType: z.string(), // 核心体验类型：打脸逆袭/真相揭露/身份反转/命运震撼/认知颠覆 等
  redLines: na(z.string()), // 绝对不可触碰的底线
  targetEpisodeDurationSec: z.number().int().min(30).max(600).default(180), // 每集目标时长（秒）
  plannedTotalEpisodes: z.object({
    min: z.number().int().min(20).default(60),
    max: z.number().int().min(20).default(100),
  }).default({ min: 60, max: 100 }),
});

// ---------------------------------------------------------------------------
// Phase 1.5: 编剧手册 (Drama Prompt Profile)
// ---------------------------------------------------------------------------
const weightClamp = (v: number, def: number) => { const n = Number(v); return isNaN(n) ? def : Math.max(0.5, Math.min(2.0, n)); };

export const genreArchetypeSchema = z.object({
  narrativeArc: z.enum(['conflict_resolution', 'life_journey', 'mystery_reveal', 'quest', 'rise_and_fall']).default('conflict_resolution'),
  narrationRatio: z.preprocess((val) => isNaN(Number(val)) ? 0 : (Number(val) > 1 ? Number(val) / 100 : Number(val)), z.number().min(0).max(1).catch(0)),
  factConstraint: z.enum(['none', 'inspired_by', 'period_accurate']).default('none'),
  hookMechanism: z.enum(['plot_cliffhanger', 'revelation', 'emotional_peak', 'mystery', 'curiosity']).default('plot_cliffhanger'),
  conflictType: z.enum(['interpersonal', 'fate_vs_will', 'good_vs_evil', 'internal', 'society']).default('interpersonal'),
  characterEvolution: z.enum(['costume_only', 'age_progression', 'power_level', 'relationship', 'status']).default('costume_only'),
  visualTone: z.enum(['glamorous', 'gritty', 'ethereal', 'period', 'dark', 'whimsical', 'epic']).default('glamorous'),
  /**
   * 题材适配生产规则——由 profiler LLM 根据本剧实际 genre 特征生成，注入所有下游 agent 的 system prompt。
   * 替代原 genreAdaptiveBlock() 的 if-else 硬编码查找表。
   * 涵盖：旁白比例规则、史实约束、叙事弧线特殊要求、集末钩子风格、角色视觉演变、台词风格示例等。
   */
  adaptationNotes: z.string().optional().nullable(),
});

export const dramaPromptProfileSchema = z.object({
  generatedForGenre: z.string(),
  generatedForAudience: z.string(),
  genreArchetype: genreArchetypeSchema.optional().nullable(),
  scriptwriterGuide: z.object({
    coreIdentity: z.string(),
    genreRules: na(z.string()),
    dialogueGuide: z.string(),
    pacingGuide: z.string(),
    visualNarrativeGuide: z.string(),
    forbiddenPatterns: na(z.string()),
  }),
  cameraStyleGuide: z.object({
    preferredAngles: na(z.string()), // 偏好镜头角度列表
    signatureTechniques: na(z.string()), // 标志性镜头手法列表
    transitionStyle: ns(), // 转场风格偏好
    colorPalette: ns(), // 色彩基调
    /** 题材专属摄影语言指令（由 profiler LLM 生成，用户可编辑）。
     *  纯文本，无运行时变量占位符。分镜导演会将其整段注入 system prompt。
     *  示例内容："■ 霸总登场：medium+low_angle 仰拍；■ 权力对话：over_shoulder+high/low_angle 对比..." */
    cinematographyDirective: ns(),
    /**
     * 题材专属动作场景摄影语言（purpose=action 时注入，完全替换通用动作规则）。
     * 仙侠用飞天+法术描述，科幻用赛博+能量武器，战神用写实格斗，古装用刀剑对决——各自有完全不同的 visualPrompt 词汇和运镜公式。
     * 为空时回退到通用动作规则。
     */
    genreActionDirective: ns(),
    /**
     * 题材专属情绪-运镜映射补充说明（注入在通用映射表之后）。
     * 覆盖或扩展通用表中的行：仙侠的"霸者登场"是"仙尊降临"（极广角+crane_down），
     * 科幻的"追逐"是"飞船追击"（tracking+wide+HUD叠加），等等。
     * 无需重复通用规则，只写本题材与通用规则的差异部分。
     */
    genreEmotionNotes: ns(),
    /**
     * 题材专属场景类型覆盖指令（purpose → 专属摄影规则）。
     * 与 genreActionDirective（action 专用）并列，覆盖其余所有 purpose 类型。
     * key = scenePurpose 值（如 "climax"/"confrontation"/"revelation"/"romantic"/"cliffhanger"）。
     * value = 该场景类型的题材专属摄影规则，完全替代通用规则。
     * 示例：
     *   climax: "■ 仙侠高潮=法术大招五镜：蓄力ECU→灵力汇聚wide→大招爆发extreme_wide→震撼wide→胜负定格"
     *   confrontation: "■ 宫斗对峙=反将一军五镜：亮底牌→淡定→出底牌→惊愕→高角度俯拍落败"
     *   revelation: "■ 穿越揭秘=色调骤变三镜：现代末帧→特效帧→古代首帧"
     */
    genrePurposeDirectives: z.record(z.string(), z.string()).nullish(),
    /**
     * 题材专属导演身份（替换通用"你是短剧分镜导演"身份定位）。
     * 定义此导演的专业领域、思维框架和核心美学原则。
     * 示例："你是仙侠短剧分镜导演，精通神力视觉语言与奇幻规模感..."
     */
    genreIdentity: ns(),
    /**
     * 题材专属分镜核心原则（替换通用"分镜核心原则"4条规则）。
     * 必须包含：① 题材反转公式 ② 高潮爽感来源 ③ 情绪-权力视觉化方式 ④ 题材禁忌
     * 通用版的"反转=slow_push_in→fast_push+打脸"是霸总公式，仙侠/战神/宫斗各有不同。
     */
    genreCoreRules: ns(),
    /**
     * 题材专属叙事镜头思维（替换通用"叙事镜头语言"4条规则）。
     * 必须覆盖：① 第一帧设计（题材版） ② 信息差视角（题材版） ③ 沉默比台词更有力（题材版）
     * 通用版的"禁止空镜开场"对仙侠/科幻是错误的；"签字/握拳"是现代都市动作，不适用于古代/奇幻。
     */
    genreNarrativePrinciples: ns(),
  }),
  audioStyleGuide: z.object({
    bgmMoodPreferences: na(z.string()),
    sfxDensity: z.preprocess(v => v ?? 'moderate', z.enum(['sparse', 'moderate', 'rich'])),
    silenceUsage: ns(), // 静默使用策略
    voiceActingStyle: ns(), // 配音风格（夸张/克制/自然）
    /** 题材专属音频品牌指令（由 profiler LLM 生成，用户可编辑）。
     *  纯文本，无运行时变量占位符。音频导演会将其整段注入 system prompt。
     *  示例内容："■ 霸总出场：低沉弦乐，intensity=0.5-0.6；■ 打脸反转：drop_to_silence→swell..." */
    genreBrandingDirective: ns(),
  }),
  reviewerCalibration: z.object({
    dimensionWeights: z.object({
      visualImpact: z.preprocess(v => v ?? 1.2, z.number().transform(v => weightClamp(v, 1.2))),
      dialogueNaturalness: z.preprocess(v => v ?? 1.2, z.number().transform(v => weightClamp(v, 1.2))),
      pacing: z.preprocess(v => v ?? 1.0, z.number().transform(v => weightClamp(v, 1.0))),
      hookStrength: z.preprocess(v => v ?? 1.3, z.number().transform(v => weightClamp(v, 1.3))),
      consistency: z.preprocess(v => v ?? 1.0, z.number().transform(v => weightClamp(v, 1.0))),
      emotionalImpact: z.preprocess(v => v ?? 1.0, z.number().transform(v => weightClamp(v, 1.0))),
    }),
    genreSpecificChecks: na(z.string()),
    calibrationHistory: z.union([
      z.array(z.object({ // 维度权重微调历史
        episode: z.number().int().min(1),
        dimension: z.string(),
        oldWeight: z.number(),
        newWeight: z.number(),
        reason: z.string(),
      })),
      z.null(),
    ]).transform(v => v ?? []).default([]),
  }),

  /**
   * 段落导演题材手册。
   * 覆盖 buildArcDirectorSystemPrompt 里与现代都市绑定的框架示例。
   * 由 DramaProfilerAgent 生成，buildArcDirectorSystemPrompt 优先使用这里的内容，无则回退硬编码。
   */
  arcDirectorGuide: z.object({
    /** 题材专属段落规划原则（替换/补充通用5条），如仙侠"境界突破段"、历史剧"朝代更迭段"、传记"人生阶段段" */
    genreSegmentPrinciples: ns(),
    /** 题材专属角色弧线设计（替换"好人变坏人"都市示例），如宫斗"站队-反目-复合"三步弧 */
    characterArcPrinciples: ns(),
    /** 题材专属冲突密度节奏（传记剧与爽剧与悬疑剧各不同），描述本题材前/中/后段的节奏比例与卡点位置 */
    conflictRhythm: ns(),
  }).optional().nullable(),

  /**
   * 集导演题材手册。
   * 覆盖 buildEpisodeDirectorSystemPrompt 里的现代都市emotionBeat示例和张力曲线描述。
   * 由 DramaProfilerAgent 生成，buildEpisodeDirectorSystemPrompt 优先使用这里的内容，无则回退硬编码。
   */
  episodeDirectorGuide: z.object({
    /** 题材专属 emotionBeats 示例（9行表格，替换通用现代都市办公室场景示例） */
    emotionBeatExample: ns(),
    /** 题材专属单集张力曲线补充说明（如仙侠：开场神迹→铺垫→大招高潮；传记：平铺人生积累→命运转折） */
    tensionCurveNotes: ns(),
    /** 题材专属集末钩子设计模式（如宫斗偏"身份揭穿"、仙侠偏"强者降临"、悬疑偏"证据碎片化"） */
    hookPatterns: ns(),
  }).optional().nullable(),

  /**
   * 节奏分析师题材手册。
   * 覆盖 buildPacingAnalyzerSystemPrompt 里的通用节奏判断标准。
   * 由 DramaProfilerAgent 生成，buildPacingAnalyzerSystemPrompt 优先使用这里的内容，无则回退硬编码。
   */
  pacingAnalyzerGuide: z.object({
    /** 题材专属理想节奏模板（各阶段时间比例 + 对应的情绪密度要求），如传记剧允许铺垫段偏慢 */
    genreRhythmTemplate: ns(),
    /** 题材专属节奏快/慢的视觉指标（现代都市=台词密度，仙侠=法术描述密度，传记=叙事跨度） */
    paceIndicators: ns(),
  }).optional().nullable(),

  /**
   * 各 Agent 的「本剧专属灵魂视图」——Profiler 针对每个 Agent 生成精准的本剧适配内容。
   * 生成一次，创建完成后写入 basePromptSnapshot（不在运行时重算）。
   * 用户在工坊编辑的是已解析好的 basePromptSnapshot，soulViews 是原始变量存档（用于重新解析）。
   */
  soulViews: z.object({
    /** 编剧 + 台词润色：本剧编剧手册核心（等同于原 scriptwriterGuide，更名以明确语义） */
    scriptwriter: z.object({
      coreIdentity: z.string().default(''),
      genreRules: na(z.string()),
      dialogueGuide: z.string().default(''),
      pacingGuide: z.string().default(''),
      visualNarrativeGuide: z.string().default(''),
      forbiddenPatterns: na(z.string()),
    }),
    /**
     * 段落导演：本剧专属的段落规划适配规则（超出题材模板的本剧个性化部分）。
     * 注入 arc-director 的 system prompt，补充题材基线之上的本剧叙事规律。
     */
    arcDirector: z.string().default(''),
    /**
     * 集导演：本剧专属的集级规划适配规则。
     * 注入 episode-director 的 system prompt，补充情绪节拍和张力曲线的本剧特色。
     */
    episodeDirector: z.string().default(''),
    /**
     * 节奏分析师：本剧专属节奏模式说明（基于题材基线+本剧 seed 生成）。
     * 注入 pacing-analyzer 的 system prompt。
     */
    pacingAnalyzer: z.string().optional().nullable(),
    /**
     * 悬念工匠：本剧专属悬念风格扩展（本剧 catharsisType 决定哪类钩子最强）。
     * 注入 hook-crafter 的 system prompt，补充题材通用悬念库之上的本剧特色类型。
     */
    hookCrafter: z.string().optional().nullable(),
    /**
     * 连续性守卫：本剧世界观专项检查条目（超出通用12项的本剧特有约束）。
     * 注入 continuity-guard 的 system prompt。
export const signaturePropSchema = z.object({
  propId: z.string().transform(normalizeId),  // 全剧唯一 ID（英文/拼音简写，如 "jade_seal"、"jiu_zun"）
  name: z.string(),             // 中文名称（如"传国玉玄"）
  description: z.string(),      // 中文详细描述（材质、年代风格、外观特征，30-60字）
  visualPrompt: z.string(),     // 英文 T2I 提示词（核心物体描述：材质、形态、细节）— 分镜用基因词
  /**
   * 道具商品图最终 T2I 提示词（完整咒语，含微距摄影、产品写真风格词、no people）。
   * 由 VisualAssetDesigner 生成，DramaVisualAssetService 生成道具参考图时直接使用，跳过 PromptCompiler。
   */
  referenceImagePrompt: z.string().optional().nullable(),
  narrativeRole: z.enum([
    'signature',   // 角色标志性随身物（如主角的玉佩、反派的折扇）
    'macguffin',   // 剧情核心驱动物（如密令、解药、传位诏书）
    'recurring',   // 跨场景反复出现、需保持视觉一致的道具
  ]),
  appearsInScenes: na(z.string().transform(normalizeId)),  // 出现的 locationId 列表（归一化以匹配 sceneLocationSchema.locationId）
  characterOwner: z.union([z.string(), z.null()]).transform(v => v ? normalizeId(v) : '').default(''),  // 归属角色 characterId（归一化以匹配 characterIdentitySchema.characterId）�大幅变化
   *   disguise: 伪装，可能改变发型/妆容但骨骼结构不变
   */
  variationType: z.enum(['costume', 'age', 'transformation', 'disguise']).default('costume'),
  costume: z.string(), // 服饰描述
  visualPromptOverride: z.string(), // 覆盖 defaultCostume 的英文T2I提示词
  /** 年龄提示词（variationType=age 时必填），如 "elderly, 70 years old, deep wrinkles, grey hair" */
  ageHint: ns(),
  /** 面部覆盖提示词（variationType=age/transformation 时可选），覆盖 faceReferencePrompt 的年龄/变身部分 */
  faceOverridePrompt: ns(),
  referenceImageUrl: z.union([z.string(), z.null()]).transform(v => v ?? ''), // LLM 可能返回 null，统一转为空串
});

/**
 * 通用 ID 归一化 — 全系统所有 LLM 生成的标识符必须使用统一的 ID 格式（小写、去除 _-空格）。
 * 确保 "li_wei" / "LI_WEI" / "liwei" / "li-wei" 全部归一化为 "liwei"。
 * 应用范围：characterId, propId, locationId, characterOwner, appearsInScenes
 */
export const normalizeId = (v: string) => v.toLowerCase().replace(/[\s\-_]+/g, '');
/** @deprecated 请使用 normalizeId，保留别名以免破坏外部引用 */
export const normalizeCharacterId = normalizeId;

export const characterIdentitySchema = z.object({
  characterId: z.string().transform(normalizeCharacterId),
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor', 'narrator', 'historical_figure']),
  scope: z.enum(['series', 'arc', 'episode']).default('series'),
  faceDescription: z.string(),
  bodyType: z.string(),
  hairStyle: z.string(),
  skinTone: z.string(),
  distinguishingFeatures: z.string(),
  age: z.string(),
  agePrompt: z.string().default(''),
  faceReferencePrompt: z.string().min(1, 'faceReferencePrompt 不能为空'),
  bodyTypePrompt: z.string().default(''),
  hairStylePrompt: z.string().default(''),
  /**
   * 角色定妆照最终 T2I 提示词（完整的英文咒语，含摄影术语、背景要求）。
   * 由 VisualAssetDesigner 在设计阶段直接生成，DramaVisualAssetService 生成定妆照时直接使用，
   * 无需再经过 PromptCompiler，节省 LLM 调用。
   * 注意：此字段不可用于分镜合成（含 "neutral plain background"、"looking at camera" 等定妆专用词）。
   */
  referenceImagePrompt: z.string().optional().nullable(),

  // ─── 灵魂层：行为/心理人设 ───
  soulProfile: z.object({
    coreDesire: ns(),
    fatalFlaw: ns(),
    coreFear: ns(),
    decisionStyle: ns(),
    stressResponse: ns(),
    emotionalTriggers: na(z.string()),
    behavioralHabits: na(z.string()),
    internalContradiction: ns(),
  }).optional().nullable(),

  voiceProfile: z.object({
    ttsVoiceId: ns(),
    pitch: z.enum(['low', 'medium', 'high']).default('medium'),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
    timbre: z.string(),
    speakingStyle: z.string(),
    catchphrase: ns(),
  }),
  defaultCostume: z.string(),
  defaultCostumePrompt: z.string().default(''),
  variations: na(characterVariationSchema),
});

/**
 * 可复用临时角色池条目 — 有名有姓的 episode 级角色在归档时加入此池，
 * 集导演可在后续集通过相同 characterId 直接复用，避免重复设计和生图。
 */
export const minorRolePoolEntrySchema = z.object({
  characterId: z.string(),
  name: z.string(),
  identity: characterIdentitySchema, // 完整 CharacterIdentity，含视觉提示词，可直接推入 state.characters
  referenceImageUrl: ns(),           // 最佳已生成图片URL（媒体生成后异步写入）
  lastUsedEpisode: z.number().int().min(1),
  usedInEpisodes: na(z.number().int()),
});

/**
 * @deprecated propAssetSchema 仅供旧数据兼容，新剧请使用 signaturePropSchema。
 * 旧场景级道具结构，保留以避免历史数据解析失败。
 */
export const propAssetSchema = z.object({
  propId: z.string(),
  name: z.string(),
  description: z.string(),
  visualPrompt: z.string(),
});

export type PropAsset = z.infer<typeof propAssetSchema>;

/**
 * 签名道具（Signature Prop）— 全剧维度的关键道具，满足以下任一条件才需列入：
 *   1. 跨场景重复出现（appearsInScenes ≥ 2）
 *   2. 剧情核心驱动物（MacGuffin）
 *   3. 特定角色的标志性随身物件
 *
 * 设计原则：普通场景陈设（桌椅、杯碟、灯具）不需要签名道具资产；
 * 只有观众会在多集内记住、且视觉一致性有实际意义的物件才列入。
 */
export const signaturePropSchema = z.object({
  propId: z.string(),           // 全剧唯一 ID（英文/拼音简写，如 "jade_seal"、"jiu_zun"）
  name: z.string(),             // 中文名称（如"传国玉玺"）
  description: z.string(),      // 中文详细描述（材质、年代风格、外观特征，30-60字）
  visualPrompt: z.string(),     // 英文 T2I 提示词（核心物体描述：材质、形态、细节）— 分镜用基因词
  /**
   * 道具商品图最终 T2I 提示词（完整咒语，含微距摄影、产品写真风格词、no people）。
   * 由 VisualAssetDesigner 生成，DramaVisualAssetService 生成道具参考图时直接使用，跳过 PromptCompiler。
   */
  referenceImagePrompt: z.string().optional().nullable(),
  narrativeRole: z.enum([
    'signature',   // 角色标志性随身物（如主角的玉佩、反派的折扇）
    'macguffin',   // 剧情核心驱动物（如密令、解药、传位诏书）
    'recurring',   // 跨场景反复出现、需保持视觉一致的道具
  ]),
  appearsInScenes: na(z.string()),  // 出现的 locationId 列表（macguffin 可为空，其余至少 2 个）
  characterOwner: ns(),             // 归属角色 characterId（signature 类必填，其余可选）
});

export type SignatureProp = z.infer<typeof signaturePropSchema>;

export const sceneLocationSchema = z.object({
  locationId: z.string().transform(normalizeId),  // 归一化以确保跨 LLM 调用匹配一致
  name: z.string(), // 如 "男主总裁办公室"
  description: z.string(), // 详细描述
  visualPrompt: z.string(), // T2I 场景核心描述（英文，纯空间结构/材质/光照）— 分镜 Compiler 用基因词
  /**
   * 场景概念图最终 T2I 提示词（完整咒语，含透视构图、no people、建筑摄影专业词）。
   * 由 VisualAssetDesigner 生成，DramaVisualAssetService 生成场景定版图时直接使用，跳过 PromptCompiler。
   */
  referenceImagePrompt: z.string().optional().nullable(),
  // lightingDefault 必须为英文（T2I 模型不识别中文），包含中文时自动清空并记录警告
  lightingDefault: z.string().transform((val) =>
    /[\u4e00-\u9fff]/.test(val) ? '' : val
  ), // 默认光线（英文）
  ambientSoundDefault: z.string(), // 默认环境音
  colorTone: z.string(), // 色调
  ambientPopulation: ns(), // 环境人口描述（如"酒馆里的醉汉","接头的路人"），用于注入T2I避免空城
  keyProps: na(z.string()), // 场景内普通道具文字列表（仅用于剧本上下文，不生图）
  propAssets: na(propAssetSchema), // @deprecated 旧数据兼容字段，新剧不再使用
  isRecurring: z.boolean().default(false), // 是否为反复出现的场景
});

export const visualStyleGuideSchema = z.object({
  overallAesthetic: z.string(), // 整体美学风格（如"电影质感""韩剧滤镜""高饱和度"）
  colorGrading: z.string(), // 调色风格
  lightingStyle: z.string(), // 光影风格
  era: ns('contemporary'), // 时代背景
  renderTechnique: ns(), // 渲染技术（如"3D NPR赛璐璐""2D手绘赛璐璐""写实CG""定格动画""粘土模型"）
  textureStyle: ns(), // 材质质感（如"胶片颗粒""黏土质感""水彩晕染""像素块""毛毡纤维"）
  referenceStyle: ns(), // 参考风格/作品（如"吉卜力""新海诚""皮克斯""伊藤润二""港片黄金时代"）
  // 纯英文 T2I 提示词（用于风格参考图生成，避免中英混杂降低图片质量）
  styleReferencePrompt: ns(), // English-only T2I style prompt for scene/location images
  characterStylePrompt: ns(), // 角色定妆参考图专用前缀：仅含时代+渲染技术，不含 colorGrading/lightingStyle
  facePromptRule: ns(), // 该风格的 faceReferencePrompt 写法规范，来自视觉风格模板
  scenePromptGuidance: ns(), // 场景 visualPrompt 写法示例 + 约束，来自视觉风格模板
  scriptDialogueGuide: ns(), // 本风格驱动的台词风格引导，来自视觉风格模板
  shotStyleGuide: ns(), // 本风格驱动的集导演镜头风格提示，来自视觉风格模板
});

export const visualBibleSchema = z.object({
  version: z.string(),
  identityPack: na(z.object({
    characterId: z.string(),
    faceDna: z.string(),
    anchorImages: z.object({
      faceFront: ns(),
      face34: ns(),
      upperOrFull: ns(),
    }),
    variationPolicy: ns(),
  })),
  stylePack: z.object({
    styleTokens: na(z.string()),
    styleRefImages: na(z.string()),
    colorLutHint: ns(),
  }),
  scenePack: na(z.object({
    locationId: z.string(),
    anchorImages: z.object({
      establishing: ns(),
      interiorMedium: ns(),
      detailClose: ns(),
    }),
  })).optional(),
  cameraPack: z.object({
    preferredAngles: na(z.string()),
    movementPolicy: na(z.string()),
    continuityRules: na(z.string()),
  }),
});

// ---------------------------------------------------------------------------
// Phase 3: 全剧大纲 (Series Outline)
// ---------------------------------------------------------------------------

export const episodeSynopsisSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string(),
  coreConflict: z.string(), // 本集核心冲突/核心知识主题
  cliffhanger: z.string(), // 集末悬念/知识衔接点
  emotionalArc: z.string(), // 情绪弧线（如"平静→震惊→愤怒→决意"）
  keyCharacterIds: na(z.string()),
  estimatedDurationSec: z.number().int().min(30).default(180),
  isPaywall: z.boolean().default(false), // 是否为付费卡点集（知识模式下统一为 false）
  paywallReason: ns(), // 卡点原因（知识模式下为空）
  arcSegmentId: ns(), // 所属段落ID
});

export const seriesOutlineSchema = z.object({
  totalPlannedEpisodes: z.number().int().min(20),
  mainStoryGoal: z.string(),
  endingDirection: z.string(),
  episodes: na(episodeSynopsisSchema),
  paywallEpisodes: na(z.number().int()), // 付费卡点集号列表
});

// ---------------------------------------------------------------------------
// Phase 3.5: 段落规划 (Arc Segment)
// ---------------------------------------------------------------------------

export const arcSegmentSchema = z.object({
  segmentId: z.string(),
  segmentTitle: z.string(),
  startEpisode: z.number().int().min(1),
  endEpisode: z.number().int().min(1),
  coreConflict: z.string(), // 本段落核心矛盾/核心知识主题
  emotionalTheme: z.string(),
  climaxEpisode: z.number().int().min(1),
  characterGoals: na(z.object({
    characterId: z.string(),
    startState: z.string(),
    endState: z.string(),
    keyMoments: na(z.string()),
  })),
  status: z.enum(['planning', 'active', 'completed']).default('planning'),
});

// ---------------------------------------------------------------------------
// Phase 4: 集级意图 (Episode Intent)
// ---------------------------------------------------------------------------

export const emotionBeatSchema = z.object({
  beatId: z.string(),
  startPct: z.number().min(0).max(1),
  endPct: z.number().min(0).max(1),
  emotion: z.string(),
  intensity: z.number().min(0).max(1),
  trigger: z.string(),
});

export const episodeIntentSchema = z.object({
  episodeNumber: z.number().int().min(1),
  goals: na(z.string()),
  emotionDirection: z.string(),
  emotionBeats: na(emotionBeatSchema),
  hookDirection: z.string(),
  carryoverFromLastEpisode: z.string(),
  masterShotPlan: na(z.object({
    beatId: z.string(), // 主镜头节拍ID（用于 script/storyboard 对齐）
    visualGoal: z.string(), // 本主镜必须被“看见”的视觉目标
    emotionGoal: z.string(), // 本主镜要传达的情绪目标
    actionVerb: z.string(), // 单动作动词（如 reveal/confront/strike/turn）
    minDurSec: z.number().min(0.5).max(30),
    maxDurSec: z.number().min(0.5).max(60),
  })),
  activeCharacters: na(z.object({
    characterId: z.string().transform(normalizeCharacterId),
    costumeOverride: z.string().nullish().transform(v => v ?? ''), // AI 可能输出 null
    emotionalState: z.string(), // 本集情绪基调（静态快照，用于兼容）
    emotionalJourney: z.string().optional().nullable(), // 本集情绪旅程（三段式，如"从假装平静→内心崩溃→决定反击"）
    role: z.string(), // 本集角色定位（如"被揭穿者""复仇者""旁观者"）
  })),
  proposedNewCharacters: na(z.object({
    characterId: z.string().transform(normalizeCharacterId), // 建议的角色ID（如 guard / old_man）
    name: z.string(), // 角色名称（如 "宫门侍卫" / "街头老者"）
    role: z.enum(['supporting', 'minor']).default('minor'),
    scope: z.enum(['episode', 'arc']).default('episode'), // 复用范围：episode=本集结束归档，arc=弧段内常驻
    narrativePurpose: z.string(), // 叙事作用（如 "阻拦主角进入宫殿" / "提供关键线索"）
    appearanceHint: z.string(), // 外观提示（如 "身穿铠甲的高大士兵" / "佝偻的白发老人"）
    hasDialogue: z.boolean().default(false), // 是否有台词（决定是否需要配音设计）
  })),
  locationIds: na(z.string()), // 本集使用的场景
  durationTargetSec: z.number().int().min(30),
  isPaywallEpisode: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Phase 5: 剧本场景 (Script Scene)
// ---------------------------------------------------------------------------

export const scriptSceneSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  sceneId: z.string(),
  sceneHeading: z.string(), // "内 - 总裁办公室 - 日"
  locationId: ns(),
  purpose: z.enum([
    'hook_opening', 'conflict', 'revelation', 'emotional',
    'action', 'confrontation', 'romantic', 'transition', 'climax', 'cliffhanger',
    'exposition', 'narrative', 'montage', 'closure',
  ]),
  objective: z.string(),
  turningPoint: z.string(),
  presentCharacterIds: na(z.string().transform(normalizeCharacterId)),
  emotionalEntry: z.string(),
  emotionalExit: z.string(),
  dialogues: na(z.object({
    characterId: z.string().nullish().transform(v => v ?? ''),
    text: z.string(),
    parenthetical: z.string().nullish().transform(v => v ?? ''), // 括号注释（如"冷笑""压低声音"）
  })),
  actions: na(z.object({
    description: z.string(), // 动作描写
    characterId: z.string().nullish().transform(v => v ?? ''), // null/undefined → '' 表示环境动作
  })),
  estimatedDurationSec: z.number().int().min(1),
});

export const episodeScriptSchema = z.object({
  episodeNumber: z.number().int().min(1),
  scenes: z.array(scriptSceneSchema).min(1).max(8),
  overallEmotionalArc: z.string(),
  hookStrategy: z.string(),
});

// ---------------------------------------------------------------------------
// Phase 6: 分镜 Shot (Storyboard)
// ---------------------------------------------------------------------------

/**
 * 景别枚举 — 描述画框裁切范围（画面包含主体多少）。
 * 与 cameraAngle 正交：一个镜头同时有景别和角度（如"仰视特写"= close_up + low_angle）。
 *
 * 用途：
 *   shotSize       → firstFramePrompt T2I 构图
 *   shotSizeEnd    → lastFramePrompt  T2I 构图（运动镜头首尾构图不同时填写）
 */
export const SHOT_SIZE_VALUES = [
  'extreme_close_up', // 大特写：眼/嘴/手等局部细节，面部情绪最大化
  'close_up',         // 特写：头部+少量颈肩，人物情绪主导
  'medium_close_up',  // 中近景：胸部以上，对话/情绪两用
  'medium',           // 中景：腰部以上，最常用的对话景别
  'medium_wide',      // 中全景：膝部以上，可见肢体语言
  'wide',             // 全景：全身+部分环境，动作/人物关系
  'extreme_wide',     // 大全景：以环境为主，人物渺小（建立场景/宏大感）
] as const;
export type ShotSize = typeof SHOT_SIZE_VALUES[number];
const shotSizeEnum = z.enum(SHOT_SIZE_VALUES);

/**
 * 镜头角度枚举 — 描述摄影机与被摄主体的空间透视关系。
 * 与 shotSize 正交，可自由组合（如 low_angle + close_up = 仰视特写）。
 *
 * 核心情绪规则（短剧黄金法则）：
 *   low_angle   → 强势/权力/压迫感（拍霸总/反派/反转后的主角）
 *   high_angle  → 脆弱/被压制（拍受害者/崩溃中的角色）
 *   dutch_angle → 心理扭曲/紧张/不安（拍转折/悬疑）
 *   bird_eye    → 命运视角/宏大格局（拍重大转折/场景建立）
 *   pov         → 强代入感（拍主角视角的冲突/惊喜）
 *   over_shoulder → 经典对话切法，双人场景首选
 *   three_quarter → 最自然的人物角度，对话/情绪通用
 */
export const CAMERA_ANGLE_VALUES = [
  'front',          // 正面：角色直视镜头，适合宣告/表白/震惊
  'three_quarter',  // 斜侧45°：最自然的对话/情绪角度（默认）
  'side_profile',   // 90°侧面：展现轮廓/行走/若有所思
  'over_shoulder',  // 过肩：经典对话双人切法，含对方虚化背影
  'pov',            // 主观视角：强代入感，角色所见即观众所见
  'bird_eye',       // 正俯视：命运/宏大/全局感（90°向下）
  'high_angle',     // 斜俯：压制/脆弱（摄影机高于主体向下斜拍）
  'low_angle',      // 斜仰：权力/强势/压迫（摄影机低于主体向上斜拍）
  'worm_eye',       // 正仰视：极端仰视，建筑/神像/极度压迫感
  'dutch_angle',    // 斜构图倾斜：心理扭曲/紧张/悬疑
  'back_of_head',   // 后脑勺：跟随感/神秘感/角色面向未知
] as const;
export type CameraAngle = typeof CAMERA_ANGLE_VALUES[number];
const cameraAngleEnum = z.enum(CAMERA_ANGLE_VALUES);

export const shotCameraSchema = z.object({
  /**
   * 景别：画框裁切范围。
   * firstFramePrompt 用此值生成 T2I 构图关键词。
   */
  shotSize: shotSizeEnum,
  /**
   * 运动结束景别（可选）。
   * 仅在 movement 导致景别变化时填写（如 slow_push_in: shotSize=wide, shotSizeEnd=medium_close_up）。
   * lastFramePrompt 优先使用此值；省略则与 shotSize 相同。
   */
  shotSizeEnd: shotSizeEnum.nullish(),
  /**
   * 摄影机透视角度：与景别正交，可自由组合。
   * 两帧共用同一角度（除非 movement 导致角度变化，该情况用 visualPrompt 描述）。
   */
  cameraAngle: cameraAngleEnum.default('three_quarter'),
  movement: z.enum([
    'static', 'slow_push_in', 'slow_pull_back', 'pan_left', 'pan_right',
    'tilt_up', 'tilt_down', 'tracking', 'crane_up', 'crane_down',
    'handheld', 'whip_pan', 'dolly_zoom', 'orbit',
  ]).default('static'),
  composition: z.enum([
    'center', 'rule_of_thirds_left', 'rule_of_thirds_right',
    'symmetrical', 'leading_space', 'negative_space', 'frame_within_frame',
  ]).default('rule_of_thirds_left'),
  depthOfField: z.enum(['shallow', 'medium', 'deep']).default('medium'),
});

export const shotCharacterSchema = z.object({
  characterId: z.string().transform(normalizeCharacterId),
  action: z.string(), // 角色动作（如"缓缓放下文件，嘴角微扬"）
  emotion: z.string(), // 表情/情绪
  position: z.enum(['left', 'center', 'right', 'background', 'foreground']).default('center'),
  /**
   * 角色朝向 — 直接写入 firstFramePrompt/lastFramePrompt T2I 关键词，
   * T2V 会以第一帧的朝向为锚定，确保整个 clip 内角色朝向一致。
   *
   * 规则：
   *   对话场景：A=left+facing_right, B=right+facing_left（180度法则）
   *   霸总/反转：facing_camera（正视镜头，权威感）
   *   若有所思/独处：facing_away 或 side_left/side_right
   */
  facing: z.enum([
    'facing_camera',  // 正视镜头（宣告/表白/震惊/权威）
    'facing_away',    // 背对镜头（神秘/离开/若有所思）
    'facing_left',    // 面朝画面左侧（对话B侧，或侧身行走）
    'facing_right',   // 面朝画面右侧（对话A侧，或侧身行走）
  ]).default('facing_camera'),
  costumeOverride: z.string().nullish().transform(v => v ?? ''), // AI 可能输出 null
});

export const shotDialogueSchema = z.object({
  characterId: z.string().transform(normalizeCharacterId),
  text: z.string(),
  emotion: z.string(), // TTS 情绪标签
  volume: z.enum(['whisper', 'low', 'normal', 'loud', 'scream']).default('normal'),
  pace: z.enum(['very_slow', 'slow', 'normal', 'fast', 'very_fast']).default('normal'),
  isVoiceover: z.boolean().default(false), // 是否为画外音/旁白
  isInnerThought: z.boolean().default(false), // 是否为内心独白
});

export const shotAudioSchema = z.object({
  // .nullable() 确保兼容 OpenAI structured outputs（不允许纯 .optional()）
  bgm: z.object({
    mood: z.string(), // 情绪标签（如 tension_building / romantic_sweet / epic_reveal）
    intensity: z.number().min(0).max(1).nullish().transform(v => v ?? 0.5),
    action: z.enum(['continue', 'fade_in', 'fade_out', 'cut', 'swell', 'drop_to_silence']).nullish().transform(v => v ?? 'continue'),
  }).nullable().optional(),
  sfx: na(z.object({
    trigger: z.string(), // 触发描述（如"摔门""玻璃碎裂"）
    sound: z.string(), // 音效标识
    timing: z.enum(['on_action', 'before_dialogue', 'after_dialogue', 'ambient']).default('on_action'),
  })),
  ambience: z.union([z.string(), z.null()]).transform(v => v ?? '').default(''), // 环境音（如 office_quiet / rain_heavy / crowd_murmur）
});

const shotSubtitleSchema = z.object({
  text: z.string(),
  style: z.enum(['normal', 'emphasis', 'whisper', 'scream', 'narrator', 'time_skip']).default('normal'),
});
/**
 * 特殊拍摄手法枚举 — AI 生成时注入 T2V prompt，用户可手动覆盖。
 * 与 camera.movement 正交：movement 描述镜头物理运动，specialTechnique 描述光学/时态效果。
 */
export const SPECIAL_TECHNIQUES = [
  'dolly_zoom',          // 希区柯克变焦（推拉同步变焦，营造眩晕/焦虑感）
  'time_lapse',          // 延时摄影（快速展示时间流逝）
  'fast_push',           // 急推镜头（突然向主体推近，制造冲击）
  'fast_pull',           // 急拉镜头（突然后退揭示环境/人物渺小）
  'bullet_time',         // 子弹时间（主体静止，镜头环绕移动）
  'fpv',                 // FPV 穿梭（第一人称高速穿梭）
  'macro',               // 微距特写（极度放大细节：颤抖的手/瞳孔/眼泪）
  'slow_motion',         // 慢镜头（放慢动作，强调情感/打击感）
  'probe_lens',          // 探针镜头（从狭缝/缝隙穿入，窥视感强）
  'dutch_tilt',          // 旋转倾斜（画面倾斜=心理失衡/崩溃/混乱）
  'speed_ramp',          // 升降格（先慢后快或先快后慢，创造节奏冲击）
  'split_screen',        // 分屏（同时展示两个视角/两个时空）
  'fisheye',             // 鱼眼镜头（超广角球形畸变，强调空间扭曲/癫狂）
  'whip_zoom',           // 甩变焦（高速推拉+运动模糊，情绪急转）
] as const;

export type SpecialTechnique = typeof SPECIAL_TECHNIQUES[number];

export const shotSchema = z.object({
  shotIndex: z.number().int().nonnegative(),
  shotId: z.string(),
  sceneId: z.string(), // 关联的剧本场景ID
  isMasterShot: z.boolean().default(false), // 是否主镜头（主镜优先保证叙事可读）
  actionUnitId: z.string().default(''), // 单动作单元ID（用于问题定位和定向重生）
  shotType: z.enum(['portrait', 'dialogue', 'action', 'wide', 'insert']).default('dialogue'),
  regenPriority: z.enum(['high', 'medium', 'low']).default('medium'),
  camera: shotCameraSchema,
  characters: na(shotCharacterSchema),
  characterLockRefs: na(z.string()), // 角色身份锁引用（来自 visualBible.identityPack）
  styleLockRef: ns(), // 风格锁引用（来自 visualBible.stylePack/version）
  dialogue: shotDialogueSchema.nullish(), // AI 可能输出 null
  audio: shotAudioSchema.nullish().transform(v => v ?? {}),
  visualPrompt: z.string().describe(
    'Video motion prompt (English). Describe what HAPPENS during this shot — ' +
    'the action, movement, and changes from the opening frame to the closing frame. ' +
    'Must logically bridge firstFramePrompt → lastFramePrompt as cause → effect. ' +
    'Use motion verbs (walks, turns, reaches, draws). Never describe static poses. ' +
    'Keep to ONE clear action per shot — AI video models cannot handle multi-step action sequences.'
  ),
  sfxPrompt: z.string().nullish(), // 音效提示词
  subtitle: shotSubtitleSchema.nullish(),
  estimatedDurationSec: z.number().min(0.5).max(15), // 硬上限 15s：Kling/Sora 2 物理上限均为 15s
  transitionToNext: z.enum(['cut', 'fade_black', 'fade_white', 'dissolve', 'wipe_left', 'wipe_right', 'flash', 'match_cut', 'occlusion_cut']).default('cut'),
  isFlashback: z.boolean().default(false), // 是否为闪回镜头
  flashbackSourceEpisode: z.number().int().min(1).nullish(), // AI 可能输出 null
  flashbackSourceShotId: z.string().nullish(),
  isPreview: z.boolean().default(false), // 是否为"下集预告"Shot
  firstFramePrompt: z.string().describe(
    'Static pose prompt for the OPENING frame (English, 15-25 words). ' +
    'Write ONLY: body poses, facial expressions, spatial anchors (at the gate, near the window), ' +
    'prop interactions (hand on sword hilt, holding a letter). ' +
    'DO NOT write: character appearance/hair/clothing (auto-injected by identity pipeline), ' +
    'environment/architecture (auto-injected by scene pipeline), ' +
    'lighting/atmosphere (auto-injected by lighting pipeline), ' +
    'camera angles or style words (auto-injected by optimizer). ' +
    'NO motion verbs. Must be spatially consistent with previous shot\'s lastFramePrompt.'
  ).nullish(),
  lastFramePrompt: z.string().describe(
    'Static pose prompt for the CLOSING frame (English, 15-25 words). ' +
    'Write ONLY: the END-STATE body pose, expression, and prop state after visualPrompt action completes. ' +
    'DO NOT write: appearance, environment, lighting, camera, or style (all auto-injected). ' +
    'NO motion verbs. The next shot\'s firstFramePrompt must depict this same state.'
  ).nullish(),
  firstFrameImageUrl: z.string().nullish(), // T2I 生成前为 null
  lastFrameImageUrl: z.string().nullish(),
  propGripStates: z.record(z.string(), z.enum(['hidden', 'at_waist', 'drawing', 'in_hand', 'pointing'])).optional(),
  characterVariationIds: z.record(z.string(), z.string()).nullish(), // characterId → variationId 映射


  // ─── 剪辑切点精度 ──────────────────────────────────────────────────────────
  /** Shot 内的精确入点(秒)，从 Shot 起始处偏移。省略=从头开始 */
  trimInSec: z.number().min(0).nullish(),
  /** Shot 内的精确出点(秒)，从 Shot 起始处偏移。省略=用到结尾 */
  trimOutSec: z.number().min(0).nullish(),
  /** 剪辑切点类型，指导 composer 在哪种时刻执行切换 */
  cutPointHint: z.enum([
    'on_action',       // 在动作最高峰切（拳头落下/门关上的瞬间）
    'on_reaction',     // 在听者反应的第一帧切（表情刚变化时）
    'on_emotion_peak', // 在情绪最强点切（最震撼的那一帧）
    'on_beat',         // 对齐 BGM 节拍切
    'on_silence',      // 在静默开始时切
    'free',            // 无特殊要求
  ]).default('free'),

  // ─── 质量分级（基于场景类型自动标记，影响媒体生产优先级）──────────────────
  qualityTier: z.enum(['golden', 'standard', 'filler']).default('standard'),
  // golden: climax/cliffhanger/revelation/confrontation → 优先生成，可多版本选优
  // standard: conflict/romantic/emotional/action → 正常处理
  // filler: transition/hook_opening → 可使用静帧+缩放代替完整视频

  // ─── 人工干预字段 ───────────────────────────────────────────────────────────
  specialTechnique: z.enum(SPECIAL_TECHNIQUES).nullish(), // 特殊拍摄手法（可选），AI 重跑时如已设定则保留
  isHumanEdited: z.boolean().default(false), // true = 人工已修改，AI 重跑时跳过此 Shot
  humanEditedAt: z.string().nullish(),       // ISO 时间戳，记录最近人工修改时间
  humanEditNote: z.string().nullish(),       // 人工修改备注（可选）

  // ─── 签名道具追踪（结构化，便于质检/验证/参考图注入）─────────────────────
  /**
   * 本 Shot 出场的签名道具列表（可选）。
   * 由分镜导演 LLM 输出或 enforceFaceLock 后处理自动填充。
   * 下游用途：
   *   1. ShotContextBuilder 按 propId 查找 product_shot 参考图注入 T2I
   *   2. CoherenceValidator 检测跨 Shot 道具一致性
   *   3. QualityGate 可针对道具可见性进行专项评估
   */
  props: z.array(z.object({
    propId: z.string(),               // 对应 signaturePropSchema.propId
    visualOverride: z.string().nullish(), // 本 Shot 的道具特殊视觉描述（如打开状态/损坏状态）
  })).nullish(),
});

export const episodeStoryboardSchema = z.object({
  episodeNumber: z.number().int().min(1),
  shots: z.array(shotSchema).min(1),
  totalEstimatedDurationSec: z.number(),
  audioTimeline: z.object({
    bgmSegments: na(z.object({
      mood: z.string(),
      startShotIndex: z.number().int().nonnegative(),
      endShotIndex: z.number().int().nonnegative(),
      intensityCurve: na(z.number()), // 强度曲线采样点
    })),
    silencePoints: na(z.object({
      afterShotIndex: z.number().int().nonnegative(),
      durationSec: z.number().min(0.5).max(5),
      purpose: z.string(), // 静默目的（如"震惊留白""悬念停顿"）
    })),
  }),
});

// ---------------------------------------------------------------------------
// Phase 7: 审阅 (Review)
// ---------------------------------------------------------------------------

export const episodeReviewSchema = z.object({
  overallVerdict: z.enum(['good', 'needs_edit', 'major_issues']),
  overallScore: z.number().min(0).max(10),
  generationReadinessScore: z.number().min(0).max(10).default(7), // 可生成稳定性评分（高=少返工）
  dimensions: z.object({
    visualImpact: z.number().min(0).max(10), // 画面冲击力
    dialogueNaturalness: z.number().min(0).max(10), // 台词自然度
    pacing: z.number().min(0).max(10), // 节奏紧凑度
    hookStrength: z.number().min(0).max(10), // 悬念强度
    consistency: z.number().min(0).max(10), // 连续性
    emotionalImpact: z.number().min(0).max(10), // 情感冲击力
  }),
  issuesFound: na(z.object({
    category: z.enum([
      'visual_continuity', 'dialogue', 'pacing', 'hook',
      'character_consistency', 'emotional_logic', 'duration',
      'camera_language', 'audio_design', 'content_safety', 'other',
    ]),
    severity: z.enum(['minor', 'moderate', 'critical']),
    description: z.string(),
    suggestedFix: z.string(),
  })),
  strengths: na(z.string()),
  consistencyRiskShots: na(z.object({
    shotId: z.string(),
    reason: z.string(),
  })),
  cameraReadabilityRiskShots: na(z.object({
    shotId: z.string(),
    reason: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// Phase 8: 知识记录 (Episode Record)
// ---------------------------------------------------------------------------

export const episodeLoreRecordSchema = z.object({
  episodeNumber: z.number().int().min(1),
  summary: z.string(),
  characterStateDeltas: na(z.object({
    characterId: z.string(),
    emotionalShift: z.string(),
    relationshipChanges: na(z.string()),
    newKnowledge: na(z.string()),
    costumeUsed: ns(),
  })),
  plotAdvances: na(z.string()),
  newSecrets: na(z.object({
    secret: z.string(),
    knownBy: na(z.string()),
    hiddenFrom: na(z.string()),
  })),
  resolvedSecretIds: na(z.string()),
  flashbackCandidates: na(z.object({
    shotId: z.string(),
    reason: z.string(),
    emotionalWeight: z.enum(['low', 'medium', 'high', 'iconic']),
  })),
  cliffhangerResolution: ns(),
  newCliffhanger: ns(),
});

// ---------------------------------------------------------------------------
// Phase 9: 连续性预检 (Continuity)
// ---------------------------------------------------------------------------

export const dramaContinuityCheckSchema = z.object({
  pass: z.boolean(),
  warnings: na(z.object({
    type: z.enum([
      'character_appearance_mismatch', 'location_continuity_break',
      'costume_inconsistency', 'emotion_jump', 'timeline_violation',
      'secret_leak', 'dead_character_active', 'relationship_contradiction',
      'character_name_inconsistency', 'addressing_inconsistency', 'duplicate_name_confusion',
      'prop_continuity_break',
    ]),
    description: z.string(),
    severity: z.enum(['warning', 'block']),
    affectedEntityId: ns(),
  })),
  contextInjections: na(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 10: 策略层 (Drama Strategy)
// ---------------------------------------------------------------------------

export const dramaStrategySchema = z.object({
  coreNarrativeContract: z.string(), // 本剧叙事契约
  toneGuardrails: na(z.string()),
  paywallStrategy: z.object({
    firstPaywallEpisode: z.number().int().min(3).default(10),
    paywallInterval: z.number().int().min(3).default(5),
    paywallHookIntensity: z.enum(['high', 'extreme']).default('extreme'),
    freeEpisodeStrategy: z.string(), // 免费集的策略（如何吸引付费）
  }),
  first3EpisodesStrategy: z.string(), // 前3集生死线策略
  hookCadencePolicy: z.object({
    preferredTypes: na(z.string()),
    avoidRecentRepeatWindow: z.number().int().min(1).default(3),
    urgencyBias: z.enum(['conservative', 'balanced', 'aggressive']).default('aggressive'),
  }),
  characterBudget: z.object({
    maxPresentPerEpisode: z.number().int().min(2).max(8).default(4),
    maxNewPerSegment: z.number().int().min(1).max(5).default(2),
  }),
  lastRefreshedAtEpisode: z.number().int().min(0).default(1), // 0=未刷新，LLM 可能返回 0
});

// ---------------------------------------------------------------------------
// Phase 11: 多巴胺调度 (Dopamine)
// ---------------------------------------------------------------------------

export const dramaDopamineScheduleSchema = z.object({
  history: na(z.object({
    type: z.string(),
    intensity: z.enum(['minor', 'medium', 'major', 'climactic']),
    deliveredAtEpisode: z.number().int().min(1),
    description: z.string(),
  })),
  episodesSinceMinor: z.number().int().nonnegative().default(0),
  episodesSinceMajor: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Phase 12: 确定性检查 (Deterministic Check)
// ---------------------------------------------------------------------------

export const dramaDeterministicCheckSchema = z.object({
  pass: z.boolean(),
  failedChecks: na(z.object({
    rule: z.string(),
    detail: z.string(),
    severity: z.enum(['hard', 'soft']).optional(),
  })),
  hardFails: na(z.object({
    rule: z.string(),
    detail: z.string(),
    severity: z.enum(['hard', 'soft']),
  })),
  /** 自动修复的规则（如 shot_index_gap），断点续传时保留记录 */
  autoFixedRules: z.array(z.string()).default([]),
  /** 超长台词详情，供 ScriptEditor 定向修复；断点续传时保留以避免跳过修复 */
  dialogueFixes: z.array(z.object({
    sceneId: z.string(),
    characterId: z.string(),
    text: z.string(),
    zhLen: z.number(),
  })).default([]),
});

// ---------------------------------------------------------------------------
// Story State (顶层聚合)
// ---------------------------------------------------------------------------

export type ContentMode = 'drama' | 'knowledge';

export const dramaStateSchema = z.object({
  dramaId: z.string(),
  userId: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.literal(1).default(1),
  contentMode: z.enum(['drama', 'knowledge']).default('drama'),

  seed: dramaSeedSchema,
  audienceDirective: dramaAudienceDirectiveSchema.optional(),
  promptProfile: dramaPromptProfileSchema.optional(),
  strategy: dramaStrategySchema.optional(),

  visualStyleHint: ns(), // 用户在前端选择的原始视觉风格提示（如"3D 东方玄幻风格：..."），用于 debug/重试
  suggestedVisualStyle: ns(), // 视觉风格枚举值（如 period_live / live_action / 2d_anime），由前端推荐流程确定后透传
  generationMode: z.enum(['fast', 'balanced', 'quality']).optional(), // @deprecated
  imageResolution: z.enum(['1k', '2k', '4k']).default('2k'),
  videoResolution: z.enum(['720p', '1080p', '4k']).default('1080p'),
  videoProvider: z.enum(['auto', 'volcengine', 'kling', 'hailuo', 'veo', 'sora', 'kling-avatar']).default('auto'),
  visualStyle: visualStyleGuideSchema.optional(),
  visualBible: visualBibleSchema.optional(),
  characters: na(characterIdentitySchema),
  episodeCharacterArchive: z.record(z.string(), z.array(characterIdentitySchema)).optional(), // key = episodeNumber，归档每集 scope='episode' 的临时角色
  minorRolePool: na(minorRolePoolEntrySchema), // 可复用临时角色池，供后续集导演选角
  locations: na(sceneLocationSchema),
  signatureProps: na(signaturePropSchema), // 全剧级签名道具（跨场景/剧情核心/角色标志），3-8 个

  seriesOutline: seriesOutlineSchema.optional(),
  arcSegments: na(arcSegmentSchema),
  currentArcSegment: arcSegmentSchema.optional(),

  dopamineSchedule: dramaDopamineScheduleSchema.default({ history: [], episodesSinceMinor: 0, episodesSinceMajor: 0 }),

  episodeCursor: z.number().int().min(1).default(1),
  episodeSummaries: na(z.object({
    episodeNumber: z.number().int().min(1),
    summary: z.string(),
  })),
  lastCliffhanger: ns(),
  recentHookTypes: na(z.object({
    episodeNumber: z.number().int().min(1),
    hookType: z.string(),
  })),

  secretLedger: na(z.object({
    id: z.string(),
    secret: z.string(),
    knownBy: na(z.string()),
    hiddenFrom: na(z.string()),
    seededAtEpisode: z.number().int().min(1),
    resolved: z.boolean().default(false),
  })),

  flashbackBank: na(z.object({
    shotId: z.string(),
    episodeNumber: z.number().int().min(1),
    reason: z.string(),
    emotionalWeight: z.enum(['low', 'medium', 'high', 'iconic']),
    visualPromptSnapshot: z.string(), // 存储当时的视觉提示词以供复用
  })),

  kpiHistory: na(z.object({
    episodeNumber: z.number().int().min(1),
    overallScore: z.number().min(0).max(10),
    dimensions: z.record(z.string(), z.number()),
    generatedAt: z.string(),
  })),

  storySoFar: ns(), // 滚动压缩的全局剧情摘要，供长程上下文引用

  // 集级校准追踪 — 近期重复问题模式（滑动窗口）
  recentIssuePatterns: na(z.object({
    pattern: z.string(), // 问题模式描述
    dimension: z.string(), // 归属审阅维度
    occurrences: z.number().int().min(1),
    firstSeenEpisode: z.number().int().min(1),
    lastSeenEpisode: z.number().int().min(1),
    status: z.enum(['active', 'resolved', 'expired']).default('active'),
  })),

  isSeriesFinale: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

export type DramaAudienceDirective = z.infer<typeof dramaAudienceDirectiveSchema>;
export type GenreArchetype = z.infer<typeof genreArchetypeSchema>;
export type DramaSeed = z.infer<typeof dramaSeedSchema>;
export type DramaPromptProfile = z.infer<typeof dramaPromptProfileSchema>;
export type CharacterVariation = z.infer<typeof characterVariationSchema>;
export type CharacterIdentity = z.infer<typeof characterIdentitySchema>;
export type SceneLocation = z.infer<typeof sceneLocationSchema>;
export type VisualStyleGuide = z.infer<typeof visualStyleGuideSchema>;
export type VisualBible = z.infer<typeof visualBibleSchema>;
export type EpisodeSynopsis = z.infer<typeof episodeSynopsisSchema>;
export type SeriesOutline = z.infer<typeof seriesOutlineSchema>;
export type ArcSegment = z.infer<typeof arcSegmentSchema>;
export type EmotionBeat = z.infer<typeof emotionBeatSchema>;
export type EpisodeIntent = z.infer<typeof episodeIntentSchema>;
export type ScriptScene = z.infer<typeof scriptSceneSchema>;
export type EpisodeScript = z.infer<typeof episodeScriptSchema>;
export type ShotCamera = z.infer<typeof shotCameraSchema>;
export type ShotCharacter = z.infer<typeof shotCharacterSchema>;
export type ShotDialogue = z.infer<typeof shotDialogueSchema>;
export type ShotAudio = z.infer<typeof shotAudioSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type EpisodeStoryboard = z.infer<typeof episodeStoryboardSchema>;
export type EpisodeReview = z.infer<typeof episodeReviewSchema>;
export type EpisodeLoreRecord = z.infer<typeof episodeLoreRecordSchema>;
export type DramaContinuityCheck = z.infer<typeof dramaContinuityCheckSchema>;
export type DramaStrategy = z.infer<typeof dramaStrategySchema>;
export type DramaDopamineSchedule = z.infer<typeof dramaDopamineScheduleSchema>;
export type DramaDeterministicCheck = z.infer<typeof dramaDeterministicCheckSchema>;
export type MinorRolePoolEntry = z.infer<typeof minorRolePoolEntrySchema>;
export type DramaState = z.infer<typeof dramaStateSchema>;
