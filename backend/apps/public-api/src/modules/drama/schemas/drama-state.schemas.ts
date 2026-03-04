/**
 * 短剧引擎核心数据契约 — 从创意到 Shot JSON 的完整类型系统。
 * 设计原则：每个 Shot 包含视频/音频/字幕生成所需的全部元数据，可直接对接 T2V/TTS/FFmpeg。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Phase 0: 短剧题材与受众
// ---------------------------------------------------------------------------

export const dramaAudienceDirectiveSchema = z.object({
  audienceTags: z.array(z.string()).default([]),
  protagonistFocus: z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble']).default('female_lead'),
  tonePreference: z.string().default(''),
  platformTarget: z.enum(['douyin', 'kuaishou', 'reelshort', 'dramabox', 'generic']).default('generic'),
  aspectRatio: z.enum(['9:16', '16:9']).default('9:16'),
  hardConstraints: z.array(z.string()).default([]),
  softPreferences: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Phase 1: 短剧种子 (Drama Seed)
// ---------------------------------------------------------------------------

export const dramaSeedSchema = z.object({
  title: z.string(),
  genre: z.string(), // 霸总/甜宠/战神/穿越/宫斗/复仇/重生 等
  targetAudience: z.string(),
  logline: z.string(), // 一句话概括
  protagonistConcept: z.object({
    name: z.string(),
    situation: z.string(), // 初始处境
    coreDesire: z.string(), // 核心欲望
    personality: z.string(),
    fatalFlaw: z.string().default(''), // 致命弱点（驱动冲突）
  }),
  antagonistConcept: z.object({
    name: z.string(),
    motivation: z.string(),
    relationship: z.string(), // 与主角的关系
  }).optional(),
  tone: z.string(), // 风格调性
  coreConflict: z.string(), // 核心矛盾
  catharsisType: z.string(), // 核心爽点类型（打脸/逆袭/真相揭露/甜蜜反转）
  redLines: z.array(z.string()).default([]), // 绝对不可触碰的底线
  targetEpisodeDurationSec: z.number().int().min(30).max(600).default(180), // 每集目标时长（秒）
  plannedTotalEpisodes: z.object({
    min: z.number().int().min(20).default(60),
    max: z.number().int().min(20).default(100),
  }).default({ min: 60, max: 100 }),
});

// ---------------------------------------------------------------------------
// Phase 1.5: 编剧手册 (Drama Prompt Profile)
// ---------------------------------------------------------------------------

export const dramaPromptProfileSchema = z.object({
  generatedForGenre: z.string(),
  generatedForAudience: z.string(),
  scriptwriterGuide: z.object({
    coreIdentity: z.string(), // "你是一位擅长霸总甜宠的编剧..."
    genreRules: z.array(z.string()).min(3),
    dialogueGuide: z.string(), // 台词风格指南
    pacingGuide: z.string(), // 节奏指南
    visualNarrativeGuide: z.string(), // 视觉叙事指南（如何用画面代替文字叙述）
    forbiddenPatterns: z.array(z.string()).default([]), // 禁止的叙事模式
  }),
  cameraStyleGuide: z.object({
    preferredAngles: z.array(z.string()).default([]), // 偏好镜头角度
    signatureTechniques: z.array(z.string()).default([]), // 标志性镜头手法
    transitionStyle: z.string().default(''), // 转场风格偏好
    colorPalette: z.string().default(''), // 色彩基调
  }),
  audioStyleGuide: z.object({
    bgmMoodPreferences: z.array(z.string()).default([]),
    sfxDensity: z.enum(['sparse', 'moderate', 'rich']).default('moderate'),
    silenceUsage: z.string().default(''), // 静默使用策略
    voiceActingStyle: z.string().default(''), // 配音风格（夸张/克制/自然）
  }),
  reviewerCalibration: z.object({
    dimensionWeights: z.object({
      visualImpact: z.number().min(0.5).max(2.0).default(1.2),
      dialogueNaturalness: z.number().min(0.5).max(2.0).default(1.2),
      pacing: z.number().min(0.5).max(2.0).default(1.0),
      hookStrength: z.number().min(0.5).max(2.0).default(1.3),
      consistency: z.number().min(0.5).max(2.0).default(1.0),
      emotionalImpact: z.number().min(0.5).max(2.0).default(1.0),
    }),
    genreSpecificChecks: z.array(z.string()).min(2),
    calibrationHistory: z.array(z.object({ // 维度权重微调历史
      episode: z.number().int().min(1),
      dimension: z.string(),
      oldWeight: z.number(),
      newWeight: z.number(),
      reason: z.string(),
    })).default([]),
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
  referenceImageUrl: z.string().default(''), // 变体参考图URL
});

export const characterIdentitySchema = z.object({
  characterId: z.string(),
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor']),
  faceDescription: z.string(), // 面部描述（锁脸用，全剧恒定）
  bodyType: z.string(),
  hairStyle: z.string(),
  skinTone: z.string(),
  distinguishingFeatures: z.string(), // 标志性特征（如：左眼角痣）
  age: z.string(),
  faceReferencePrompt: z.string(), // T2I 面部参考提示词（英文）
  voiceProfile: z.object({
    ttsVoiceId: z.string().default(''),
    pitch: z.enum(['low', 'medium', 'high']).default('medium'),
    speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
    timbre: z.string(),
    speakingStyle: z.string(),
    catchphrase: z.string().default(''),
  }),
  defaultCostume: z.string(),
  variations: z.array(characterVariationSchema).default([]), // 角色外观变体列表
});

export const sceneLocationSchema = z.object({
  locationId: z.string(),
  name: z.string(), // 如 "男主总裁办公室"
  description: z.string(), // 详细描述
  visualPrompt: z.string(), // T2I 场景参考提示词（英文）
  lightingDefault: z.string(), // 默认光线
  ambientSoundDefault: z.string(), // 默认环境音
  colorTone: z.string(), // 色调
  keyProps: z.array(z.string()).default([]), // 标志性道具（如"落地窗""红木书桌"）
  isRecurring: z.boolean().default(false), // 是否为反复出现的场景
});

export const visualStyleGuideSchema = z.object({
  overallAesthetic: z.string(), // 整体美学风格（如"电影质感""韩剧滤镜""高饱和度"）
  colorGrading: z.string(), // 调色风格
  lightingStyle: z.string(), // 光影风格
  era: z.string().default('contemporary'), // 时代背景
});

// ---------------------------------------------------------------------------
// Phase 3: 全剧大纲 (Series Outline)
// ---------------------------------------------------------------------------

export const episodeSynopsisSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string(),
  coreConflict: z.string(), // 本集核心冲突
  cliffhanger: z.string(), // 集末悬念
  emotionalArc: z.string(), // 情绪弧线（如"平静→震惊→愤怒→决意"）
  keyCharacterIds: z.array(z.string()).default([]),
  estimatedDurationSec: z.number().int().min(30).default(180),
  isPaywall: z.boolean().default(false), // 是否为付费卡点集
  paywallReason: z.string().default(''), // 为什么在这里设卡点
  arcSegmentId: z.string().default(''), // 所属段落ID
});

export const seriesOutlineSchema = z.object({
  totalPlannedEpisodes: z.number().int().min(20),
  mainStoryGoal: z.string(),
  endingDirection: z.string(),
  episodes: z.array(episodeSynopsisSchema),
  paywallEpisodes: z.array(z.number().int()), // 付费卡点集号列表
});

// ---------------------------------------------------------------------------
// Phase 3.5: 段落规划 (Arc Segment)
// ---------------------------------------------------------------------------

export const arcSegmentSchema = z.object({
  segmentId: z.string(),
  segmentTitle: z.string(),
  startEpisode: z.number().int().min(1),
  endEpisode: z.number().int().min(1),
  coreConflict: z.string(), // 本段落核心矛盾
  emotionalTheme: z.string(),
  climaxEpisode: z.number().int().min(1),
  characterGoals: z.array(z.object({
    characterId: z.string(),
    startState: z.string(),
    endState: z.string(),
    keyMoments: z.array(z.string()).default([]),
  })).default([]),
  status: z.enum(['planning', 'active', 'completed']).default('planning'),
});

// ---------------------------------------------------------------------------
// Phase 4: 集级意图 (Episode Intent)
// ---------------------------------------------------------------------------

export const episodeIntentSchema = z.object({
  episodeNumber: z.number().int().min(1),
  goals: z.array(z.string()).min(1).max(5),
  emotionDirection: z.string(),
  hookDirection: z.string(),
  carryoverFromLastEpisode: z.string(),
  activeCharacters: z.array(z.object({
    characterId: z.string(),
    costumeOverride: z.string().default(''), // 本集服饰（空=使用默认）
    emotionalState: z.string(), // 本集情绪基调
    role: z.string(), // 本集角色定位（如"被揭穿者""复仇者""旁观者"）
  })),
  locationIds: z.array(z.string()).default([]), // 本集使用的场景
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
  locationId: z.string().default(''),
  purpose: z.enum([
    'hook_opening', 'conflict', 'revelation', 'emotional',
    'action', 'confrontation', 'romantic', 'transition', 'climax', 'cliffhanger',
  ]),
  objective: z.string(),
  turningPoint: z.string(),
  presentCharacterIds: z.array(z.string()),
  emotionalEntry: z.string(),
  emotionalExit: z.string(),
  dialogues: z.array(z.object({
    characterId: z.string(),
    text: z.string(),
    parenthetical: z.string().default(''), // 括号注释（如"冷笑""压低声音"）
  })),
  actions: z.array(z.object({
    description: z.string(), // 动作描写
    characterId: z.string().default(''), // 空=环境动作
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
  costumeOverride: z.string().default(''), // 本Shot服饰覆盖
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
  bgm: z.object({
    mood: z.string(), // 情绪标签（如 tension_building / romantic_sweet / epic_reveal）
    intensity: z.number().min(0).max(1).default(0.5),
    action: z.enum(['continue', 'fade_in', 'fade_out', 'cut', 'swell', 'drop_to_silence']).default('continue'),
  }).optional(),
  sfx: z.array(z.object({
    trigger: z.string(), // 触发描述（如"摔门""玻璃碎裂"）
    sound: z.string(), // 音效标识
    timing: z.enum(['on_action', 'before_dialogue', 'after_dialogue', 'ambient']).default('on_action'),
  })).default([]),
  ambience: z.string().default(''), // 环境音（如 office_quiet / rain_heavy / crowd_murmur）
});

export const shotSchema = z.object({
  shotIndex: z.number().int().nonnegative(),
  shotId: z.string(),
  sceneId: z.string(), // 关联的剧本场景ID
  camera: shotCameraSchema,
  characters: z.array(shotCharacterSchema).default([]),
  dialogue: shotDialogueSchema.optional(),
  audio: shotAudioSchema.default({}),
  visualPrompt: z.string(), // T2V 视觉提示词（英文，含风格/光影/构图/角色参考）
  subtitle: z.object({
    text: z.string(),
    style: z.enum(['normal', 'emphasis', 'whisper', 'scream', 'narrator', 'time_skip']).default('normal'),
  }).optional(),
  estimatedDurationSec: z.number().min(0.5).max(30),
  transitionToNext: z.enum(['cut', 'fade_black', 'fade_white', 'dissolve', 'wipe_left', 'wipe_right', 'flash', 'match_cut']).default('cut'),
  isFlashback: z.boolean().default(false), // 是否为闪回镜头
  flashbackSourceEpisode: z.number().int().min(1).optional(), // 闪回引用的原始集号
  flashbackSourceShotId: z.string().optional(), // 闪回引用的原始ShotID
  isPreview: z.boolean().default(false), // 是否为"下集预告"Shot
  firstFramePrompt: z.string().optional(), // T2I 首帧提示词（比 visualPrompt 更精确的静帧描述）
  lastFramePrompt: z.string().optional(), // T2I 尾帧提示词（用于关键帧插值模式）
  firstFrameImageUrl: z.string().optional(), // T2I 生成的首帧图 URL
  lastFrameImageUrl: z.string().optional(), // T2I 生成的尾帧图 URL（关键帧插值）
  characterVariationIds: z.record(z.string(), z.string()).optional(), // characterId → variationId 映射
});

export const episodeStoryboardSchema = z.object({
  episodeNumber: z.number().int().min(1),
  shots: z.array(shotSchema).min(1),
  totalEstimatedDurationSec: z.number(),
  audioTimeline: z.object({
    bgmSegments: z.array(z.object({
      mood: z.string(),
      startShotIndex: z.number().int().nonnegative(),
      endShotIndex: z.number().int().nonnegative(),
      intensityCurve: z.array(z.number()).default([]), // 强度曲线采样点
    })).default([]),
    silencePoints: z.array(z.object({
      afterShotIndex: z.number().int().nonnegative(),
      durationSec: z.number().min(0.5).max(5),
      purpose: z.string(), // 静默目的（如"震惊留白""悬念停顿"）
    })).default([]),
  }),
});

// ---------------------------------------------------------------------------
// Phase 7: 审阅 (Review)
// ---------------------------------------------------------------------------

export const episodeReviewSchema = z.object({
  overallVerdict: z.enum(['good', 'needs_edit', 'major_issues']),
  overallScore: z.number().min(0).max(10),
  dimensions: z.object({
    visualImpact: z.number().min(0).max(10), // 画面冲击力
    dialogueNaturalness: z.number().min(0).max(10), // 台词自然度
    pacing: z.number().min(0).max(10), // 节奏紧凑度
    hookStrength: z.number().min(0).max(10), // 悬念强度
    consistency: z.number().min(0).max(10), // 连续性
    emotionalImpact: z.number().min(0).max(10), // 情感冲击力
  }),
  issuesFound: z.array(z.object({
    category: z.enum([
      'visual_continuity', 'dialogue', 'pacing', 'hook',
      'character_consistency', 'emotional_logic', 'duration',
      'camera_language', 'audio_design', 'content_safety', 'other',
    ]),
    severity: z.enum(['minor', 'moderate', 'critical']),
    description: z.string(),
    suggestedFix: z.string(),
  })),
  strengths: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 8: 知识记录 (Episode Record)
// ---------------------------------------------------------------------------

export const episodeLoreRecordSchema = z.object({
  episodeNumber: z.number().int().min(1),
  summary: z.string(),
  characterStateDeltas: z.array(z.object({
    characterId: z.string(),
    emotionalShift: z.string(),
    relationshipChanges: z.array(z.string()).default([]),
    newKnowledge: z.array(z.string()).default([]),
    costumeUsed: z.string().default(''),
  })).default([]),
  plotAdvances: z.array(z.string()).default([]),
  newSecrets: z.array(z.object({
    secret: z.string(),
    knownBy: z.array(z.string()),
    hiddenFrom: z.array(z.string()),
  })).default([]),
  flashbackCandidates: z.array(z.object({
    shotId: z.string(),
    reason: z.string(), // 为什么这个镜头适合被后续引用为闪回
    emotionalWeight: z.enum(['low', 'medium', 'high', 'iconic']),
  })).default([]),
  cliffhangerResolution: z.string().default(''), // 上集悬念的解决方式
  newCliffhanger: z.string().default(''), // 本集留下的新悬念
});

// ---------------------------------------------------------------------------
// Phase 9: 连续性预检 (Continuity)
// ---------------------------------------------------------------------------

export const dramaContinuityCheckSchema = z.object({
  pass: z.boolean(),
  warnings: z.array(z.object({
    type: z.enum([
      'character_appearance_mismatch', 'location_continuity_break',
      'costume_inconsistency', 'emotion_jump', 'timeline_violation',
      'secret_leak', 'dead_character_active', 'relationship_contradiction',
    ]),
    description: z.string(),
    severity: z.enum(['warning', 'block']),
    affectedEntityId: z.string().default(''),
  })),
  contextInjections: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 10: 策略层 (Drama Strategy)
// ---------------------------------------------------------------------------

export const dramaStrategySchema = z.object({
  coreNarrativeContract: z.string(), // 本剧叙事契约
  toneGuardrails: z.array(z.string()).default([]),
  paywallStrategy: z.object({
    firstPaywallEpisode: z.number().int().min(5).default(10),
    paywallInterval: z.number().int().min(3).default(5),
    paywallHookIntensity: z.enum(['high', 'extreme']).default('extreme'),
    freeEpisodeStrategy: z.string(), // 免费集的策略（如何吸引付费）
  }),
  first3EpisodesStrategy: z.string(), // 前3集生死线策略
  hookCadencePolicy: z.object({
    preferredTypes: z.array(z.string()).default([]),
    avoidRecentRepeatWindow: z.number().int().min(1).default(3),
    urgencyBias: z.enum(['conservative', 'balanced', 'aggressive']).default('aggressive'),
  }),
  characterBudget: z.object({
    maxPresentPerEpisode: z.number().int().min(2).max(8).default(4),
    maxNewPerSegment: z.number().int().min(1).max(5).default(2),
  }),
  lastRefreshedAtEpisode: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// Phase 11: 多巴胺调度 (Dopamine)
// ---------------------------------------------------------------------------

export const dramaDopamineScheduleSchema = z.object({
  history: z.array(z.object({
    type: z.string(),
    intensity: z.enum(['minor', 'medium', 'major', 'climactic']),
    deliveredAtEpisode: z.number().int().min(1),
    description: z.string(),
  })).default([]),
  episodesSinceMinor: z.number().int().nonnegative().default(0),
  episodesSinceMajor: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Phase 12: 确定性检查 (Deterministic Check)
// ---------------------------------------------------------------------------

export const dramaDeterministicCheckSchema = z.object({
  pass: z.boolean(),
  failedChecks: z.array(z.object({
    rule: z.string(),
    detail: z.string(),
  })),
  hardFails: z.array(z.object({
    rule: z.string(),
    detail: z.string(),
    severity: z.enum(['hard', 'soft']),
  })).default([]),
});

// ---------------------------------------------------------------------------
// Story State (顶层聚合)
// ---------------------------------------------------------------------------

export const dramaStateSchema = z.object({
  dramaId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.literal(1).default(1),

  seed: dramaSeedSchema,
  audienceDirective: dramaAudienceDirectiveSchema.optional(),
  promptProfile: dramaPromptProfileSchema.optional(),
  strategy: dramaStrategySchema.optional(),

  visualStyle: visualStyleGuideSchema.optional(),
  characters: z.array(characterIdentitySchema).default([]),
  locations: z.array(sceneLocationSchema).default([]),

  seriesOutline: seriesOutlineSchema.optional(),
  arcSegments: z.array(arcSegmentSchema).default([]),
  currentArcSegment: arcSegmentSchema.optional(),

  dopamineSchedule: dramaDopamineScheduleSchema.default({ history: [], episodesSinceMinor: 0, episodesSinceMajor: 0 }),

  episodeCursor: z.number().int().min(1).default(1),
  episodeSummaries: z.array(z.object({
    episodeNumber: z.number().int().min(1),
    summary: z.string(),
  })).default([]),
  lastCliffhanger: z.string().default(''),
  recentHookTypes: z.array(z.object({
    episodeNumber: z.number().int().min(1),
    hookType: z.string(),
  })).default([]),

  secretLedger: z.array(z.object({
    id: z.string(),
    secret: z.string(),
    knownBy: z.array(z.string()),
    hiddenFrom: z.array(z.string()),
    seededAtEpisode: z.number().int().min(1),
    resolved: z.boolean().default(false),
  })).default([]),

  flashbackBank: z.array(z.object({
    shotId: z.string(),
    episodeNumber: z.number().int().min(1),
    reason: z.string(),
    emotionalWeight: z.enum(['low', 'medium', 'high', 'iconic']),
    visualPromptSnapshot: z.string(), // 存储当时的视觉提示词以供复用
  })).default([]),

  kpiHistory: z.array(z.object({
    episodeNumber: z.number().int().min(1),
    overallScore: z.number().min(0).max(10),
    dimensions: z.record(z.string(), z.number()),
    generatedAt: z.string(),
  })).default([]),

  storySoFar: z.string().default(''), // 滚动压缩的全局剧情摘要，供长程上下文引用

  // 集级校准追踪 — 近期重复问题模式（滑动窗口）
  recentIssuePatterns: z.array(z.object({
    pattern: z.string(), // 问题模式描述
    dimension: z.string(), // 归属审阅维度
    occurrences: z.number().int().min(1),
    firstSeenEpisode: z.number().int().min(1),
    lastSeenEpisode: z.number().int().min(1),
    status: z.enum(['active', 'resolved', 'expired']).default('active'),
  })).default([]),
});

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

export type DramaAudienceDirective = z.infer<typeof dramaAudienceDirectiveSchema>;
export type DramaSeed = z.infer<typeof dramaSeedSchema>;
export type DramaPromptProfile = z.infer<typeof dramaPromptProfileSchema>;
export type CharacterVariation = z.infer<typeof characterVariationSchema>;
export type CharacterIdentity = z.infer<typeof characterIdentitySchema>;
export type SceneLocation = z.infer<typeof sceneLocationSchema>;
export type VisualStyleGuide = z.infer<typeof visualStyleGuideSchema>;
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
export type DramaState = z.infer<typeof dramaStateSchema>;
