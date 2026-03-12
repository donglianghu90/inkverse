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
  }).optional(),
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
  narrationRatio: z.number().min(0).max(0.5).default(0),
  factConstraint: z.enum(['none', 'inspired_by', 'period_accurate']).default('none'),
  hookMechanism: z.enum(['plot_cliffhanger', 'revelation', 'emotional_peak', 'mystery', 'curiosity']).default('plot_cliffhanger'),
  conflictType: z.enum(['interpersonal', 'fate_vs_will', 'good_vs_evil', 'internal', 'society']).default('interpersonal'),
  characterEvolution: z.enum(['costume_only', 'age_progression', 'power_level', 'relationship', 'status']).default('costume_only'),
  visualTone: z.enum(['glamorous', 'gritty', 'ethereal', 'period', 'dark', 'whimsical', 'epic']).default('glamorous'),
});

export const dramaPromptProfileSchema = z.object({
  generatedForGenre: z.string(),
  generatedForAudience: z.string(),
  genreArchetype: genreArchetypeSchema.optional(),
  scriptwriterGuide: z.object({
    coreIdentity: z.string(),
    genreRules: na(z.string()),
    dialogueGuide: z.string(),
    pacingGuide: z.string(),
    visualNarrativeGuide: z.string(),
    forbiddenPatterns: na(z.string()),
  }),
  cameraStyleGuide: z.object({
    preferredAngles: na(z.string()), // 偏好镜头角度
    signatureTechniques: na(z.string()), // 标志性镜头手法
    transitionStyle: ns(), // 转场风格偏好
    colorPalette: ns(), // 色彩基调
  }),
  audioStyleGuide: z.object({
    bgmMoodPreferences: na(z.string()),
    sfxDensity: z.enum(['sparse', 'moderate', 'rich']).default('moderate'),
    silenceUsage: ns(), // 静默使用策略
    voiceActingStyle: ns(), // 配音风格（夸张/克制/自然）
  }),
  reviewerCalibration: z.object({
    dimensionWeights: z.object({
      visualImpact: z.number().transform(v => weightClamp(v, 1.2)).default(1.2),
      dialogueNaturalness: z.number().transform(v => weightClamp(v, 1.2)).default(1.2),
      pacing: z.number().transform(v => weightClamp(v, 1.0)).default(1.0),
      hookStrength: z.number().transform(v => weightClamp(v, 1.3)).default(1.3),
      consistency: z.number().transform(v => weightClamp(v, 1.0)).default(1.0),
      emotionalImpact: z.number().transform(v => weightClamp(v, 1.0)).default(1.0),
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
});

// ---------------------------------------------------------------------------
// Phase 2: 视觉资产 (Visual Assets)
// ---------------------------------------------------------------------------

export const characterVariationSchema = z.object({ // 角色外观变体（换装/受伤/伪装等）
  variationId: z.string(),
  name: z.string(), // "正式西装" / "受伤状态" / "伪装造型"
  costume: z.string(), // 服饰描述
  visualPromptOverride: z.string(), // 覆盖 defaultCostume 的英文T2I提示词
  referenceImageUrl: z.union([z.string(), z.null()]).transform(v => v ?? ''), // LLM 可能返回 null，统一转为空串
});

export const characterIdentitySchema = z.object({
  characterId: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor', 'narrator', 'historical_figure']),
  scope: z.enum(['series', 'arc', 'episode']).default('series'), // 角色生命周期：series=全剧常驻 arc=段落级 episode=本集临时
  faceDescription: z.string(),
  bodyType: z.string(),
  hairStyle: z.string(),
  skinTone: z.string(),
  distinguishingFeatures: z.string(),
  age: z.string(),
  faceReferencePrompt: z.string(),
  bodyTypePrompt: z.string().optional().default(''),
  hairStylePrompt: z.string().optional().default(''),
  voiceProfile: z.object({
    ttsVoiceId: ns(),
    pitch: z.enum(['low', 'medium', 'high']).default('medium'),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
    timbre: z.string(),
    speakingStyle: z.string(),
    catchphrase: ns(),
  }),
  defaultCostume: z.string(),
  defaultCostumePrompt: z.string().optional().default(''),
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

export const sceneLocationSchema = z.object({
  locationId: z.string(),
  name: z.string(), // 如 "男主总裁办公室"
  description: z.string(), // 详细描述
  visualPrompt: z.string(), // T2I 场景参考提示词（英文）
  lightingDefault: z.string(), // 默认光线
  ambientSoundDefault: z.string(), // 默认环境音
  colorTone: z.string(), // 色调
  keyProps: na(z.string()), // 标志性道具（如"落地窗""红木书桌"）
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
  styleReferencePrompt: ns(), // English-only T2I style prompt for image generation
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

export const episodeIntentSchema = z.object({
  episodeNumber: z.number().int().min(1),
  goals: na(z.string()),
  emotionDirection: z.string(),
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
    characterId: z.string(),
    costumeOverride: z.string().nullish().transform(v => v ?? ''), // AI 可能输出 null
    emotionalState: z.string(), // 本集情绪基调（静态快照，用于兼容）
    emotionalJourney: z.string().optional(), // 本集情绪旅程（三段式，如"从假装平静→内心崩溃→决定反击"）
    role: z.string(), // 本集角色定位（如"被揭穿者""复仇者""旁观者"）
  })),
  proposedNewCharacters: na(z.object({
    characterId: z.string(), // 建议的角色ID（如 guard / old_man）
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
  presentCharacterIds: na(z.string()),
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

export const shotCameraSchema = z.object({
  angle: z.enum([
    'extreme_close_up', 'close_up', 'medium_close_up', 'medium',
    'medium_wide', 'wide', 'extreme_wide',
    'over_shoulder', 'bird_eye', 'low_angle', 'high_angle', 'dutch_angle',
    'pov',
  ]),
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
  characterId: z.string(),
  action: z.string(), // 角色动作（如"缓缓放下文件，嘴角微扬"）
  emotion: z.string(), // 表情/情绪
  position: z.enum(['left', 'center', 'right', 'background', 'foreground']).default('center'),
  costumeOverride: z.string().nullish().transform(v => v ?? ''), // AI 可能输出 null
});

export const shotDialogueSchema = z.object({
  characterId: z.string(),
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
    intensity: z.number().min(0).max(1).default(0.5),
    action: z.enum(['continue', 'fade_in', 'fade_out', 'cut', 'swell', 'drop_to_silence']).default('continue'),
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
  'dolly_zoom',    // 希区柯克变焦
  'time_lapse',    // 延时摄影
  'fast_push',     // 急推镜头
  'fast_pull',     // 急拉镜头
  'bullet_time',   // 子弹时间
  'fpv',           // FPV 穿梭
  'macro',         // 微距特写
  'slow_motion',   // 慢镜头
  'probe_lens',    // 探针镜头
  'dutch_tilt',    // 旋转倾斜
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
  visualPrompt: z.string(), // T2V 视觉提示词（英文，含风格/光影/构图/角色参考）
  subtitle: shotSubtitleSchema.nullish(),
  estimatedDurationSec: z.number().min(0.5).max(30),
  transitionToNext: z.enum(['cut', 'fade_black', 'fade_white', 'dissolve', 'wipe_left', 'wipe_right', 'flash', 'match_cut']).default('cut'),
  isFlashback: z.boolean().default(false), // 是否为闪回镜头
  flashbackSourceEpisode: z.number().int().min(1).nullish(), // AI 可能输出 null
  flashbackSourceShotId: z.string().nullish(),
  isPreview: z.boolean().default(false), // 是否为"下集预告"Shot
  firstFramePrompt: z.string().nullish(),
  lastFramePrompt: z.string().nullish(),
  firstFrameImageUrl: z.string().nullish(), // T2I 生成前为 null
  lastFrameImageUrl: z.string().nullish(),
  characterVariationIds: z.record(z.string(), z.string()).nullish(), // characterId → variationId 映射

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
    firstPaywallEpisode: z.number().int().min(5).default(10),
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
  generationMode: z.enum(['fast', 'balanced', 'quality']).default('balanced'), // 媒体生成策略档位
  visualStyle: visualStyleGuideSchema.optional(),
  visualBible: visualBibleSchema.optional(),
  characters: na(characterIdentitySchema),
  episodeCharacterArchive: z.record(z.string(), z.array(characterIdentitySchema)).optional(), // key = episodeNumber，归档每集 scope='episode' 的临时角色
  minorRolePool: na(minorRolePoolEntrySchema), // 可复用临时角色池，供后续集导演选角
  locations: na(sceneLocationSchema),

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
