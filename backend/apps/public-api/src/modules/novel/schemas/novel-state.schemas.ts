/**
 * Schema contracts for the organic novel generation workflow.
 *
 * Design philosophy:
 * - Settings emerge FROM writing, not before it.
 * - The bible is crystallized after chapters are written, not pre-planned.
 * - Per-chapter planning is lightweight; creative freedom goes to the writer.
 * - Heavy validation is periodic, not per-chapter.
 */
import { z } from 'zod';
import {
  characterSchema,
  locationSchema,
  itemSchema,
  relationshipEdgeSchema,
  timelineEventSchema,
  plotThreadSchema,
  characterFactSchema,
  chapterDraftSchema,
  loreRecordSchema,
  generationKpiSchema,
  storyBibleSchema,
  editorialPlanSchema,
  volumePlanSchema,
  factionSchema,
  characterCommitmentSchema,
} from './novel.schemas';

// ---------------------------------------------------------------------------
// Phase 1: Story Seed (lightweight book creation)
// ---------------------------------------------------------------------------

// Reader persona — who is this novel written FOR?
export const readerPersonaSchema = z.object({
  demographics: z.string(),
  dailyFrustrations: z.array(z.string()),
  coreFantasy: z.string(),
  projectionAnchor: z.string(),
  emotionalNeeds: z.array(z.enum([
    'power_fantasy',
    'romantic_fulfillment',
    'intellectual_superiority',
    'justice_served',
    'found_family',
    'escape_mundane',
    'underdog_triumph',
    'mystery_solving',
    'survival_thrill',
    'literary_depth', // 文学探索模式：追求叙事深度与人性洞察
    'existential_reflection', // 文学探索模式：存在主义思考与哲学追问
    'aesthetic_sublime', // 文学探索模式：纯粹的美学体验与意象共鸣
    'moral_ambiguity', // 文学探索模式：道德模糊地带的不安与反思
  ])).min(1),
  triggerScenes: z.array(z.string()).min(1).max(5),
}).optional();

// Golden finger — the protagonist's unique advantage.
export const goldenFingerSchema = z.object({
  name: z.string(),
  concept: z.string(),
  uniqueness: z.string(),
  currentStage: z.string(),
  evolutionPath: z.array(z.object({
    stage: z.string(),
    unlockedAtChapter: z.number().int().min(1).optional(),
    description: z.string(),
    newCapability: z.string(),
  })).default([]),
  limitations: z.array(z.string()).default([]),
  hiddenDepth: z.string().optional(),
}).optional();

// Concept strength evaluation — is this idea compelling enough?
export const conceptEvaluationSchema = z.object({
  hookScore: z.number().min(0).max(10),
  uniquenessScore: z.number().min(0).max(10),
  marketFitScore: z.number().min(0).max(10),
  projectionScore: z.number().min(0).max(10),
  overallViability: z.enum(['weak', 'passable', 'strong', 'exceptional']),
  strengthNotes: z.array(z.string()),
  weaknessNotes: z.array(z.string()),
  suggestions: z.array(z.string()),
}).optional();

export const audienceDirectiveSchema = z.object({
  audienceTags: z.array(z.string()).default([]),
  protagonistFocus: z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble']).default('male_lead'),
  tonePreference: z.string().default(''),
  relationshipDensity: z.enum(['low', 'medium', 'high']).default('medium'),
  hardConstraints: z.array(z.string()).default([]),
  softPreferences: z.array(z.string()).default([]),
});

export const writingModeEnum = z.enum(['commercial', 'literary']); // commercial=畅读模式, literary=文学探索模式
export type WritingMode = z.infer<typeof writingModeEnum>;

export const storySeedSchema = z.object({
  title: z.string(),
  genre: z.string(),
  targetAudience: z.string(),
  writingMode: writingModeEnum.default('commercial'),
  audienceTags: z.array(z.string()).default([]),
  protagonistFocus: z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble']).optional(),
  tonePreference: z.string().optional(),
  logline: z.string(),
  protagonistConcept: z.object({
    name: z.string(),
    nameRationale: z.string().optional(), // 命名出发点（玄幻=汉字意象，言情=普通但真实，历史=名/字/号来源）
    nameGrowthArc: z.array(z.object({
      storyPhase: z.string(), // 对应 roughOutline.points 阶段描述
      interpretation: z.string(), // 外界视角：玄幻=震慑感，言情=称呼亲密度，历史=官职称谓，悬疑=身份认知
      selfPerception: z.string(), // 主角对这个名字/身份的内心感受
    })).optional(),
    situation: z.string(),
    coreDesire: z.string(),
    personality: z.string(),
  }),
  tone: z.string(),
  coreConflictDirection: z.string(),
  mainStoryGoal: z.string().optional(), // 用户设定的长期主线目标原文
  redLines: z.array(z.string()),
  targetChapterWordCount: z.number().int().min(1).default(3000),
  plannedTotalChapters: z.object({
    min: z.number().int().min(1).default(500),
    max: z.number().int().min(1).default(800),
  }).default({ min: 500, max: 800 }),
  readerPersona: readerPersonaSchema,
  goldenFinger: goldenFingerSchema,
  conceptEvaluation: conceptEvaluationSchema,
  thematicCore: z.object({
    centralQuestion: z.string(), // 核心命题（如"权力是否必然腐蚀人性？"）
    thematicProgression: z.array(z.string()), // 主题演变阶段（如["孤独→归属","信任→背叛","牺牲→自由"]）
    recurringMotif: z.string().optional(), // 反复出现的意象/符号（如"雪"代表孤独与纯洁）
  }).optional(),
});

export const roughOutlinePointSchema = z.object({
  phase: z.enum(['opening', 'development', 'climax', 'resolution']),
  description: z.string(),
  tentativeChapterRange: z.string(),
});

export const roughOutlineSchema = z.object({
  points: z.array(roughOutlinePointSchema).min(4),
  endingDirection: z.string(),
  estimatedTotalChapters: z.number().int().min(1).default(600),
  estimatedVolumes: z.number().int().min(1).optional(), // AI 估算的预计卷数，未设定时由 volume-director 用 sqrt 公式兜底
});

// ---------------------------------------------------------------------------
// Phase 1.5: Book Prompt Profile (AI-generated per book, genre-adaptive)
// ---------------------------------------------------------------------------

export const craftExampleSchema = z.object({
  bad: z.string(),
  good: z.string(),
  rule: z.string(),
});

export const satisfactionTypeDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

export const hookTypeDefSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

export const clichePatternDefSchema = z.object({
  pattern: z.string(),
  maxPerChapter: z.number().int().min(0).default(1),
});

export const bookPromptProfileSchema = z.object({
  generatedForGenre: z.string(),
  generatedForAudience: z.string(),

  writerGuide: z.object({
    coreIdentity: z.string(),
    genreRules: z.array(z.string()).min(3),
    pacingGuide: z.string(),
    dialogueGuide: z.string(),
    craftExamples: z.array(craftExampleSchema).min(3).max(8),
    toneGuide: z.string(),
  }),

  satisfactionTypes: z.array(satisfactionTypeDefSchema).min(3),

  hookTypes: z.array(hookTypeDefSchema).min(4),

  clichePatterns: z.array(clichePatternDefSchema).min(5),

  reviewerCalibration: z.object({
    dimensionWeights: z.object({
      engagement: z.number().min(0.5).max(2.0).default(1.0),
      pacing: z.number().min(0.5).max(2.0).default(1.0),
      hookStrength: z.number().min(0.5).max(2.0).default(1.0),
      consistency: z.number().min(0.5).max(2.0).default(1.0),
      proseQuality: z.number().min(0.5).max(2.0).default(1.0),
      characterDepth: z.number().min(0.5).max(2.0).default(1.0),
      originality: z.number().min(0).max(2.0).default(0), // 文学探索模式下启用，commercial 模式下为 0 不参与计算
    }),
    genreSpecificChecks: z.array(z.string()).min(2),
    scoringAnchors: z.object({
      high: z.string(),
      mid: z.string(),
      low: z.string(),
    }),
  }),

  worldProfile: z.object({
    organizationTypes: z.array(z.string()).default([]),
    powerSystemApplicable: z.boolean().default(false),
    goldenFingerApplicable: z.boolean().default(false),
    commitmentTypes: z.array(z.string()).default(['promise', 'vow', 'goal', 'debt']),
    characterRelationEmphasis: z.string(),
  }),

  styleReferenceTexts: z.array(z.string()).max(3).default([]), // 2-3段文风参考文本（200字以内/段），用于Writer的"灵魂层"

  chapterTypeTemplates: z.record(z.string(), z.string()).default({}), // 题材定制的章节类型模板（climax/setup/rising/relief）
  firstChaptersStrategy: z.string().default(''), // 题材定制的前3章策略（替代通用的首章约束）
  audienceReactionGuide: z.string().default(''), // 题材定制的"观众反应"写法（替代通用的旁观者升级）
});

// ---------------------------------------------------------------------------
// Phase 2: Per-chapter lightweight intent (replaces heavy contract)
// ---------------------------------------------------------------------------

export const characterArcHintSchema = z.object({
  characterId: z.string(),
  characterName: z.string(),
  hint: z.string(),
  priority: z.enum(['must', 'should', 'could']),
});

export const chapterIntentSchema = z.object({
  chapterNumber: z.number().int().min(1),
  goals: z.array(z.string()).min(1).max(5),
  emotionDirection: z.string(),
  hookDirection: z.string(),
  carryoverFromLastChapter: z.string(),
  threadGuidance: z.object({
    priorityThreadLabels: z.array(z.string()),
    maxNewThreads: z.number().int().min(0).max(3),
    advice: z.string(),
  }),
  characterAvailability: z.object({
    activeCharacterIds: z.array(z.string()),
    blockedCharacterIds: z.array(z.string()),
    foreshadowOnlyCharacterIds: z.array(z.string()),
  }),
  characterArcGuidance: z.object({
    focusCharacterIds: z.array(z.string()),
    arcHints: z.array(characterArcHintSchema),
    emotionalLogicNotes: z.string(),
  }),
  characterVoiceAnchors: z.array(z.object({
    characterId: z.string(),
    signatureQuote: z.string(), // 提取该角色最具代表性的一句台词作为生成参考
  })).optional(),
  wordCountRange: z.object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  }),
});

// ---------------------------------------------------------------------------
// Phase 2.1: Arc Director directive (卷级策略下发到单章)
// ---------------------------------------------------------------------------

export const arcDirectorDirectiveSchema = z.object({
  chapterNumber: z.number().int().min(1),
  arcId: z.string().optional(),
  arcStage: z.enum([
    'entry',
    'build',
    'twist',
    'climax',
    'aftermath',
    'transition',
    'off_arc',
  ]),
  chapterMission: z.string(),
  mustHit: z.array(z.string()).default([]),
  shouldAvoid: z.array(z.string()).default([]),
  payoffThreadIds: z.array(z.string()).default([]),
  antagonistPressure: z.string().default(''),
  hookDirective: z.string().default(''),
  pacingDirective: z.string().default(''),
  riskBudget: z.enum(['low', 'medium', 'high']).default('medium'),
  /** 从 VolumeArc.characterGoals 注入的角色成长弧，供 IntentAgent 直接使用，无需重新推导 */
  characterGuidance: z.array(z.object({
    characterId: z.string(),
    characterName: z.string(),
    volumeStartState: z.string(),
    volumeEndState: z.string(),
    keyMoments: z.array(z.string()).default([]),
  })).default([]),
});

// ---------------------------------------------------------------------------
// Phase 3: Combined self-review (replaces 4 parallel gates)
// ---------------------------------------------------------------------------

export const chapterReviewSchema = z.object({
  overallVerdict: z.enum(['good', 'needs_edit', 'major_issues']),
  overallScore: z.number().min(0).max(10),
  dimensions: z.object({
    engagement: z.number().min(0).max(10),
    pacing: z.number().min(0).max(10),
    hookStrength: z.number().min(0).max(10),
    consistency: z.number().min(0).max(10),
    proseQuality: z.number().min(0).max(10),
    characterDepth: z.number().min(0).max(10),
    originality: z.number().min(0).max(10).default(5), // 情节/表达的新鲜度与独创性
  }),
  issuesFound: z.array(z.object({
    category: z.enum([
      'continuity',
      'pacing',
      'hook',
      'dialogue',
      'prose_quality',
      'ai_smell',
      'character_voice',
      'character_depth',
      'emotional_logic',
      'plot_thread',
      'faction_consistency',
      'commitment_violation',
      'repetition',
      'pov_violation',
      'other',
    ]),
    severity: z.enum(['minor', 'moderate', 'critical']),
    description: z.string(),
    suggestedFix: z.string(),
  })),
  strengths: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 3.5: Mini-arc (卷级规划, meso-level pacing)
// ---------------------------------------------------------------------------

export const miniArcChapterBeatSchema = z.object({
  chapterNumber: z.number().int().min(1),
  role: z.enum([
    'setup',         // 铺垫/引入
    'escalation',    // 升级/加压
    'twist',         // 转折/意外
    'climax',        // 高潮/对决
    'aftermath',     // 善后/缓冲
    'transition',    // 过渡/衔接
  ]),
  technique: z.string().default(''), // AI自由输出的中文叙事技法标签（如"打脸逆转""突破蜕变""暗线揭晓"），用于创作指导和前端展示
  tensionLevel: z.number().int().min(1).max(10),
  briefGoal: z.string(),
  satisfactionType: z.enum([
    'none',
    'minor_payoff',    // 小爽点（打脸、升级）
    'major_payoff',    // 大爽点（boss战、真相揭露）
    'emotional_peak',  // 情感高潮（生离死别、告白）
    'relief',          // 喘息/日常/搞笑
  ]).default('none'),
});

export const arcRewardLossLedgerSchema = z.object({
  expectedGains: z.array(z.string()).default([]),
  expectedCosts: z.array(z.string()).default([]),
  irreversibleChanges: z.array(z.string()).default([]),
});

export const antagonistMilestoneSchema = z.object({
  chapterNumber: z.number().int().min(1),
  objective: z.string(),
  successSignal: z.string(),
  failureSignal: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Phase 3.5: Volume Arc (大卷规划层 — 章数跨度由 estimatedVolumes 动态决定)
// ---------------------------------------------------------------------------

export const volumeArcMiniArcSlotSchema = z.object({
  slotIndex: z.number().int().nonnegative(),
  arcType: z.string(), // dungeon/journey/war/mystery/etc
  estimatedChapters: z.number().int().min(1),
  objective: z.string(), // 这个MiniArc要达成什么
  prerequisitePlotThreads: z.preprocess(v => v ?? [], z.array(z.string())),
});

export const volumeArcCharacterGoalSchema = z.object({
  characterId: z.string(),
  characterName: z.string(),
  volumeStartState: z.string(), // 卷开始时角色状态
  volumeEndState: z.string(), // 卷结束时角色应达到的状态
  keyMoments: z.array(z.string()).default([]), // 卷内关键转折点
  relationshipShifts: z.array(z.string()).default([]),
});

export const volumeArcSchema = z.object({
  volumeId: z.string(),
  volumeNumber: z.number().int().min(1),
  title: z.string(),
  startChapter: z.number().int().min(1),
  estimatedEndChapter: z.number().int().min(1),
  coreConflict: z.string(), // 本卷核心矛盾
  powerProgression: z.object({
    startLevel: z.string(), // 卷初主角实力
    endLevel: z.string(), // 卷末主角实力
    growthPath: z.string(), // 成长路线
    bottleneck: z.string(), // 主要瓶颈
  }),
  subPlots: z.array(z.object({
    plotId: z.string(),
    label: z.string(),
    priority: z.enum(['main', 'secondary', 'background']),
    resolveInThisVolume: z.boolean(),
  })).default([]),
  miniArcSlots: z.array(volumeArcMiniArcSlotSchema).min(2).max(8),
  climaxEstimatedChapter: z.number().int().min(1),
  characterGoals: z.array(volumeArcCharacterGoalSchema).default([]),
  newCharacterPlan: z.array(z.object({
    role: z.enum(['supporting', 'villain', 'npc']),
    label: z.string(),
    introChapterEstimate: z.number().int().min(1),
    purpose: z.string(),
  })).default([]),
  exitCharacterPlan: z.array(z.object({
    characterId: z.string(),
    exitType: z.enum(['fading', 'dormant', 'dead', 'exited']),
    exitChapterEstimate: z.number().int().min(1),
    reason: z.string(),
  })).default([]),
  thematicFocus: z.string(),
  forbiddenElements: z.array(z.string()).default([]), // 本卷禁止使用的元素
  structuralInnovation: z.string().default(''), // 本卷叙事创新（如"双线叙事""悬疑揭露""非线性时间线"）
  narrativeExperiment: z.string().default(''), // 一句话描述本卷在叙事形式上的实验
  status: z.enum(['planning', 'active', 'completed']).default('planning'),
});

export const miniArcSchema = z.object({
  arcId: z.string(),
  arcTitle: z.string(),
  arcType: z.enum([
    'dungeon',
    'sect_politics',
    'journey',
    'war',
    'mystery',
    'tournament',
    'court',
    'slice_of_life',
    'transition',
    'custom',
  ]).default('transition'),
  triggerReason: z.string().default(''),
  entryCondition: z.string().default(''),
  exitCondition: z.string().default(''),
  startChapter: z.number().int().min(1),
  plannedEndChapter: z.number().int().min(1),
  coreTension: z.string(),
  emotionalTheme: z.string().default(''),
  mustPayoffThreadIds: z.array(z.string()).default([]),
  rewardLossLedger: arcRewardLossLedgerSchema.default({
    expectedGains: [],
    expectedCosts: [],
    irreversibleChanges: [],
  }),
  antagonistMilestones: z.array(antagonistMilestoneSchema).default([]),
  cooldownTag: z.string().default(''),
  narrativeTechnique: z.enum([
    'linear', 'flashback', 'parallel_pov', 'in_medias_res', 'countdown',
    'mystery_reveal', 'unreliable_narrator', 'time_skip_montage', 'epistolary',
    'bottle_episode', 'slow_burn_reveal', 'dual_timeline', 'heist_plan',
  ]).default('linear'),
  structuralInnovation: z.string().default(''), // 本卷的叙事创新点（如"倒叙揭露真相""多视角拼图"）
  climaxChapter: z.number().int().min(1),
  climaxPattern: z.string().default(''), // 高潮模式（如"boss战""揭秘""背叛反转""牺牲""大逃离"）
  chapterBeats: z.array(miniArcChapterBeatSchema),
  status: z.enum(['active', 'completed']).default('active'),
}).superRefine((arc, ctx) => {
  if (arc.plannedEndChapter < arc.startChapter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'plannedEndChapter must be >= startChapter',
      path: ['plannedEndChapter'],
    });
  }

  if (arc.climaxChapter < arc.startChapter || arc.climaxChapter > arc.plannedEndChapter) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'climaxChapter must be within [startChapter, plannedEndChapter]',
      path: ['climaxChapter'],
    });
  }

  const seenBeatChapters = new Set<number>();
  arc.chapterBeats.forEach((beat, idx) => {
    if (beat.chapterNumber < arc.startChapter || beat.chapterNumber > arc.plannedEndChapter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'chapterBeat.chapterNumber must be within arc chapter range',
        path: ['chapterBeats', idx, 'chapterNumber'],
      });
    }
    if (seenBeatChapters.has(beat.chapterNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate chapterBeat.chapterNumber is not allowed',
        path: ['chapterBeats', idx, 'chapterNumber'],
      });
    }
    seenBeatChapters.add(beat.chapterNumber);
  });
});

export const arcAcceptanceReportSchema = z.object({
  arcId: z.string(),
  arcTitle: z.string(),
  evaluatedAtChapter: z.number().int().min(1),
  evaluationType: z.enum(['mid_arc', 'end_arc']).default('end_arc'),
  goalCompletionScore: z.number().min(0).max(1),
  mustPayoffCompletionScore: z.number().min(0).max(1),
  readerTensionResolutionScore: z.number().min(0).max(1),
  overallPass: z.boolean(),
  missingPayoffThreadIds: z.array(z.string()).default([]),
  newOpenThreads: z.number().int().min(0),
  summary: z.string(),
  actions: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Phase 3.6: Style anchor (文风锚定)
// ---------------------------------------------------------------------------

export const styleAnchorSchema = z.object({
  sampleParagraphs: z.array(z.string()).max(5),
  narrativeVoice: z.string(),
  pacePreference: z.string(),
  dialogueStyle: z.string(),
  anchoredAtChapter: z.number().int().min(1),
  pov: z.enum([
    'first_person',
    'third_person_limited',
    'third_person_omniscient',
    'multi_pov',
  ]).default('third_person_limited'),
  povCharacterId: z.string().optional(),
  povSwitchRules: z.string().optional(),
  proseTexture: z.object({
    metaphorStyle: z.string().default(''), // 修辞指纹（如"善用通感和具象化比喻，避免直喻"）
    descriptionApproach: z.string().default(''), // 描写手法（如"白描为主，关键时刻工笔细描"）
    emotionTechnique: z.string().default(''), // 情绪技法（如"以景写情，用环境映射内心"）
    transitionStyle: z.string().default(''), // 过渡风格（如"用感官切换做场景过渡"）
  }).default({}),
  signatureTechniques: z.array(z.object({
    name: z.string(), // 技法名（如"阶梯式旁观震惊"）
    description: z.string(), // 描述
    example: z.string(), // 原文示例(100字内)
  })).max(5).default([]),
  rhythmSignature: z.object({
    avgSentenceLength: z.enum(['short', 'medium', 'long', 'mixed']).default('mixed'),
    paragraphDensity: z.enum(['sparse', 'moderate', 'dense']).default('moderate'),
    dialogueRatio: z.enum(['low', 'balanced', 'high']).default('balanced'),
    actionPace: z.string().default(''), // 动作戏节奏签名
    quietPace: z.string().default(''), // 文戏节奏签名
  }).default({}),
  proseDensityMap: z.object({
    action: z.enum(['sparse', 'moderate', 'dense']).default('sparse'),
    dialogue: z.enum(['sparse', 'moderate', 'dense']).default('moderate'),
    emotion: z.enum(['sparse', 'moderate', 'dense']).default('dense'),
    worldbuilding: z.enum(['sparse', 'moderate', 'dense']).default('moderate'),
    transition: z.enum(['sparse', 'moderate', 'dense']).default('sparse'),
  }).default({}),
  antiPatterns: z.array(z.string()).max(10).default([]), // 本书应避免的具体表达模式
});

// ---------------------------------------------------------------------------
// Phase 3.5a: Information asymmetry — who knows what
// ---------------------------------------------------------------------------

export const informationGapSchema = z.object({
  id: z.string(),
  secret: z.string(),
  knownBy: z.array(z.string()),
  unknownTo: z.array(z.string()),
  dramaticPotential: z.enum(['low', 'medium', 'high', 'explosive']),
  seededAtChapter: z.number().int().min(1),
  type: z.enum([
    'dramatic_irony',
    'mystery',
    'betrayal_setup',
    'hidden_identity',
    'secret_plan',
    'misunderstanding',
  ]),
  resolved: z.boolean().default(false),
  resolvedAtChapter: z.number().int().min(1).optional(),
});

export const informationLedgerSchema = z.object({
  activeGaps: z.array(informationGapSchema).default([]),
  resolvedGaps: z.array(informationGapSchema).default([]),
});

// ---------------------------------------------------------------------------
// Phase 3.5b: Dopamine scheduler — satisfaction event tracking
// ---------------------------------------------------------------------------

export const satisfactionEventSchema = z.object({
  type: z.string(),
  intensity: z.enum(['minor', 'medium', 'major', 'climactic']),
  scale: z.enum([
    'personal',
    'group',
    'faction',
    'regional',
    'national',
    'continental',
    'world',
  ]).default('personal'),
  deliveredAtChapter: z.number().int().min(1),
  description: z.string(),
  audienceImpact: z.string().optional(),
});

export const dopamineScheduleSchema = z.object({
  history: z.array(satisfactionEventSchema).default([]),
  chaptersSinceMinor: z.number().int().nonnegative().default(0),
  chaptersSinceMedium: z.number().int().nonnegative().default(0),
  chaptersSinceMajor: z.number().int().nonnegative().default(0),
  currentStageScale: z.enum([
    'personal',
    'group',
    'faction',
    'regional',
    'national',
    'continental',
    'world',
  ]).default('personal'),
  peakScaleReached: z.enum([
    'personal',
    'group',
    'faction',
    'regional',
    'national',
    'continental',
    'world',
  ]).default('personal'),
});

// ---------------------------------------------------------------------------
// Phase 3.5c: Retroactive foreshadowing seeds
// ---------------------------------------------------------------------------

export const foreshadowingSeedSchema = z.object({
  id: z.string(),
  targetChapterNumber: z.number().int().min(1),
  insertionType: z.enum(['sentence', 'paragraph', 'inner_thought', 'background_detail']),
  content: z.string(),
  insertAfterParagraph: z.number().int().nonnegative(),
  reason: z.string(),
  triggeredByChapter: z.number().int().min(1),
  applied: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Phase 3.5c2: Proactive Foreshadowing Bank (前瞻式伏笔银行)
// ---------------------------------------------------------------------------

export const foreshadowingDepositSchema = z.object({
  depositId: z.string(), // 如 fsd_vol1_001
  label: z.string(), // 伏笔名称（如"剑鞘暗纹"）
  category: z.enum([
    'character_secret', // 角色身世/秘密
    'power_seed', // 未来力量/能力的种子
    'world_rule', // 世界规则的暗示
    'relationship_hint', // 关系线索
    'plot_twist', // 反转伏笔
    'prophecy', // 预言/预示
    'chekhov_gun', // 契诃夫之枪（物品/细节必须回收）
    'atmospheric', // 氛围伏笔（不一定要回收，但增加层次）
  ]),
  description: z.string(), // 这条伏笔是什么
  embeddingGuidance: z.string(), // 如何自然嵌入（不能太明显）
  payoffDescription: z.string(), // 回收时应该产生什么效果
  plantWindow: z.object({
    earliestChapter: z.number().int().min(1),
    latestChapter: z.number().int().min(1),
  }),
  payoffWindow: z.object({
    earliestChapter: z.number().int().min(1),
    latestChapter: z.number().int().min(1),
  }),
  relatedCharacterIds: z.array(z.string()).default([]),
  relatedPlotThreadIds: z.array(z.string()).default([]),
  priority: z.enum(['must_plant', 'should_plant', 'nice_to_have']).default('should_plant'),
  status: z.enum(['pending', 'planted', 'payoff_ready', 'resolved', 'expired']).default('pending'),
  plantedAtChapter: z.number().int().min(1).optional(),
  plantedSnippet: z.string().optional(),
  resolvedAtChapter: z.number().int().min(1).optional(),
  pendingCharacterHint: z.object({
    characterLabel: z.string(),
    hintGuidance: z.string(),
    formalIntroChapter: z.number().int().min(1),
  }).nullish(),
});

export const foreshadowingBankSchema = z.object({
  deposits: z.array(foreshadowingDepositSchema).default([]),
  totalPlanted: z.number().int().nonnegative().default(0),
  totalResolved: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Phase 3.5d: Reader tension model — what the reader is currently waiting for
// ---------------------------------------------------------------------------

export const readerCuriositySchema = z.object({
  id: z.string(),
  question: z.string(),
  seededAtChapter: z.number().int().min(1),
  lastTeaseAtChapter: z.number().int().nonnegative().default(0),
  urgency: z.enum(['simmering', 'building', 'boiling', 'overdue']),
  relatedThreadId: z.string().optional(),
  payoffDelivered: z.boolean().default(false),
  payoffAtChapter: z.number().int().min(1).optional(),
});

export const readerTensionModelSchema = z.object({
  activeCuriosities: z.array(readerCuriositySchema).default([]),
  recentPayoffs: z.array(z.object({
    curiosityId: z.string(),
    question: z.string(),
    payoffAtChapter: z.number().int().min(1),
    satisfactionType: z.enum(['full_answer', 'partial_reveal', 'twist', 'subversion']),
  })).default([]),
  chaptersSinceLastPayoff: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Phase 4: Maintenance trigger state
// ---------------------------------------------------------------------------

export const maintenanceStateSchema = z.object({
  lastMaintenanceAtChapter: z.number().int().nonnegative(),
  newCharactersSinceLastMaintenance: z.number().int().nonnegative(),
  newLocationsSinceLastMaintenance: z.number().int().nonnegative(),
  newThreadsSinceLastMaintenance: z.number().int().nonnegative(),
  newFactsSinceLastMaintenance: z.number().int().nonnegative(),
  consecutiveLowScoreChapters: z.number().int().nonnegative(),
  consecutiveConsistencyWarnings: z.number().int().nonnegative(),
  bibleVersion: z.number().int().nonnegative(),
  outlineVersion: z.number().int().nonnegative(),
});

export const maintenanceTriggerSchema = z.object({
  shouldTrigger: z.boolean(),
  reasons: z.array(z.string()),
  tasks: z.array(z.enum([
    'bible_crystallization',
    'outline_revision',
    'consistency_audit',
    'canon_arbitration',
    'thread_health_check',
    'arc_planning',
    'style_anchoring',
  ])),
});

// ---------------------------------------------------------------------------
// Bible crystallization output (extracted FROM written content)
// ---------------------------------------------------------------------------

export const crystallizedBibleSchema = z.object({
  version: z.number().int().min(1),
  crystallizedAtChapter: z.number().int().min(1),
  title: z.string(),
  genre: z.string(),
  targetAudience: z.string(),
  logline: z.string(),
  worldRules: z.array(z.string()),
  powerSystem: z.array(z.object({
    levelName: z.string(),
    levelRank: z.number().int().nonnegative(),
    description: z.string(),
    boundary: z.string(),
  })),
  redLines: z.array(z.string()),
  mainConflict: z.string(),
  narrativeStyle: z.string(),
  establishedFacts: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 5a: Story-internal time tracking
// ---------------------------------------------------------------------------

export const storyClockSchema = z.object({
  currentDay: z.number().int().nonnegative().default(1),
  currentTimeOfDay: z.enum(['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'evening', 'night', 'late_night']).default('morning'),
  season: z.enum(['spring', 'summer', 'autumn', 'winter', 'unknown']).default('unknown'),
  calendarNote: z.string().optional(),
  daysSinceStoryStart: z.number().int().nonnegative().default(0),
  lastUpdatedAtChapter: z.number().int().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Phase 5b: Address matrix — how characters address each other
// ---------------------------------------------------------------------------

export const addressEntrySchema = z.object({
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  address: z.string(),
  context: z.string().optional(),
  firstUsedChapter: z.number().int().min(1),
});

// ---------------------------------------------------------------------------
// Phase 5c: End-of-chapter scene snapshot
// ---------------------------------------------------------------------------

export const sceneSnapshotSchema = z.object({
  chapterNumber: z.number().int().min(1),
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  presentCharacterIds: z.array(z.string()).default([]),
  ongoingAction: z.string().optional(),
  emotionalTone: z.string().optional(),
  protagonistMood: z.string().optional(), // 主角此刻的情绪状态（如"愤怒中夹杂着自责"）
  unresolvedTension: z.string().optional(), // 未解决的张力（如"被背叛的真相尚未揭露"）
});

// ---------------------------------------------------------------------------
// Phase 5d: Naming conventions
// ---------------------------------------------------------------------------

export const namingConventionSchema = z.object({
  personNameStyle: z.string(),
  locationNameStyle: z.string(),
  abilityNameStyle: z.string().optional(),
  factionNameStyle: z.string().optional(),
  itemNameStyle: z.string().optional(),
  examples: z.object({
    personNames: z.array(z.string()).default([]),
    locationNames: z.array(z.string()).default([]),
    abilityNames: z.array(z.string()).default([]),
    factionNames: z.array(z.string()).default([]),
  }).optional(),
  taboos: z.array(z.string()).default([]),
}).optional();

// ---------------------------------------------------------------------------
// Phase 7: Reader Feedback (platform-based) — 三层作用域 + 采纳判定
// ---------------------------------------------------------------------------

export const readerCommentSchema = z.object({
  content: z.string(),
  sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
  aspect: z.enum(['plot', 'character', 'writing', 'pacing', 'worldbuilding', 'hook', 'general']),
  authorId: z.string().optional(),
  platform: z.string().optional(),
});

export const readerFeedbackSchema = z.object({
  chapterNumber: z.number().int().min(1),
  comments: z.array(readerCommentSchema),
  metrics: z.object({
    readCompletionRate: z.number().min(0).max(1).optional(),
    retentionRate: z.number().min(0).max(1).optional(),
    favoriteCount: z.number().int().nonnegative().optional(),
    commentCount: z.number().int().nonnegative().optional(),
    wordCount: z.number().int().nonnegative().optional(),
  }).optional(),
  submittedAt: z.string(),
});

export const feedbackAdoptionSchema = z.object({
  suggestion: z.string(),
  scope: z.enum(['book', 'arc', 'chapter']),
  verdict: z.enum(['adopt', 'conditional', 'observe', 'reject']),
  reasoning: z.string(),
  implementation: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  signalStrength: z.object({
    mentionCount: z.number().int().nonnegative(),
    hasDataBacking: z.boolean(),
    conflictsWithPlan: z.boolean(),
  }),
});

export const readerFeedbackAnalysisSchema = z.object({
  bookLevel: z.object({
    writingStyleFeedback: z.array(feedbackAdoptionSchema).default([]),
    neverAgain: z.array(z.string()).default([]),
    characterPopularity: z.array(z.object({
      characterId: z.string(),
      characterName: z.string(),
      score: z.number().min(-1).max(1),
      trend: z.enum(['rising', 'stable', 'falling']),
      keyFeedback: z.string(),
    })).default([]),
    sceneTypePreferences: z.array(z.object({
      sceneType: z.string(),
      preference: z.enum(['love', 'like', 'neutral', 'dislike', 'hate']),
      mentionCount: z.number().int().nonnegative(),
    })).default([]),
    coreIssues: z.array(feedbackAdoptionSchema).default([]),
  }),
  arcLevel: z.object({
    pacingVerdict: z.enum(['too_slow', 'slightly_slow', 'good', 'slightly_fast', 'too_fast']),
    currentPlotEngagement: z.number().min(0).max(1),
    suggestions: z.array(feedbackAdoptionSchema).default([]),
    supportingCastFeedback: z.array(z.object({
      characterId: z.string(),
      characterName: z.string(),
      verdict: z.enum(['more_screen_time', 'good', 'less_screen_time', 'rework']),
      reason: z.string(),
    })).default([]),
  }),
  chapterLevel: z.object({
    immediateFixes: z.array(feedbackAdoptionSchema).default([]),
    pacingAdjustment: z.enum(['speed_up', 'maintain', 'slow_down']),
    suspenseUrgency: z.array(z.string()).default([]),
    recentTechniqueVerdict: z.array(z.object({
      technique: z.string(),
      reaction: z.enum(['loved', 'effective', 'neutral', 'annoying', 'hated']),
    })).default([]),
    expiresAfterChapter: z.number().int().min(1),
  }),
  overallSentiment: z.enum(['very_positive', 'positive', 'mixed', 'negative', 'very_negative']),
  sentimentTrend: z.enum(['improving', 'stable', 'declining']),
  analyzedChapters: z.array(z.number().int().min(1)),
  analysisTimestamp: z.string(),
});

export const feedbackStateSchema = z.object({
  history: z.array(readerFeedbackSchema).default([]),
  lastAnalysis: readerFeedbackAnalysisSchema.optional(),
  lastAnalyzedAtChapter: z.number().int().nonnegative().default(0),
  gapSinceLastFeedback: z.number().int().nonnegative().default(0),
  pendingCommentCount: z.number().int().nonnegative().default(0),
  sentimentHistory: z.array(z.object({
    chapterRange: z.string(),
    sentiment: z.enum(['very_positive', 'positive', 'mixed', 'negative', 'very_negative']),
    analysisTimestamp: z.string(),
  })).default([]),
  confidence: z.enum(['fresh', 'aging', 'stale', 'none']).default('none'),
});

// ---------------------------------------------------------------------------
// Book Strategy (L2) — 每本书的中层策略，介于题材基线与章节动态之间
// ---------------------------------------------------------------------------
export const hookCadencePolicySchema = z.object({
  preferredTypes: z.array(z.string()).default([]),
  avoidRecentRepeatWindow: z.number().int().min(1).default(3),
  urgencyBias: z.enum(['conservative', 'balanced', 'aggressive']).default('balanced'),
  chapterEndingDirective: z.string().default(''),
});

export const threadPolicySchema = z.object({
  maxNewThreadsPerChapter: z.number().int().min(0).max(5).default(1),
  preferredActions: z.array(z.enum(['touch', 'advance', 'payoff', 'seed'])).default(['touch', 'advance']),
  overduePriority: z.enum(['low', 'medium', 'high']).default('high'),
  payoffDensityBias: z.enum(['low', 'medium', 'high']).default('medium'),
  guidance: z.string().default(''),
});

export const characterFocusPolicySchema = z.object({
  coreCharacterIds: z.array(z.string()).default([]),
  supportCharacterIds: z.array(z.string()).default([]),
  rotationMode: z.enum(['tight', 'balanced', 'wide']).default('balanced'),
  minCharacterMomentPerChapter: z.number().int().min(0).max(3).default(1),
  guidance: z.string().default(''),
});

export const characterBudgetSchema = z.object({
  maxPresentPerChapter: z.number().int().min(2).max(12).default(6),
  maxNewPerArc: z.number().int().min(1).max(8).default(3),
  coreAbsenceAlert: z.number().int().min(1).max(10).default(3),
  majorAbsenceAlert: z.number().int().min(2).max(20).default(8),
  minorCooldown: z.number().int().min(0).max(20).default(5),
  cameoCooldown: z.number().int().min(0).max(50).default(15),
});

export const bookStrategySchema = z.object({
  coreNarrativeContract: z.string().default(''),
  toneGuardrails: z.array(z.string()).default([]),
  audienceDeliveryPolicy: z.string().default(''),
  hookCadencePolicy: hookCadencePolicySchema.default({}),
  threadPolicy: threadPolicySchema.default({}),
  characterFocusPolicy: characterFocusPolicySchema.default({}),
  characterBudget: characterBudgetSchema.default({}),
  lastRefreshedAtChapter: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// Story State
// ---------------------------------------------------------------------------

export const storyStateSchema = z.object({
  bookId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.literal(2).default(2),

  // Seed — always present from creation.
  seed: storySeedSchema,
  roughOutline: roughOutlineSchema,

  // Book prompt profile — AI-generated writing guide, genre-adaptive.
  bookPromptProfile: bookPromptProfileSchema,
  audienceDirective: audienceDirectiveSchema.optional(),
  bookStrategy: bookStrategySchema.optional(),

  // Crystallized assets — grow over time, optional initially.
  bible: storyBibleSchema.optional(),
  editorialPlan: editorialPlanSchema.optional(),
  volumePlan: volumePlanSchema.optional(),

  // Volume arc (大卷规划) — 章数跨度由 roughOutline.estimatedVolumes 动态决定。
  currentVolume: volumeArcSchema.optional(),
  completedVolumes: z.array(volumeArcSchema).default([]),

  // Mini-arc (卷级规划) — planned 5-15 chapters at a time.
  currentArc: miniArcSchema.optional(),
  completedArcs: z.array(miniArcSchema).default([]),
  currentArcAcceptance: arcAcceptanceReportSchema.optional(),
  completedArcAcceptanceReports: z.array(arcAcceptanceReportSchema).default([]),

  // Style anchor — voice consistency across chapters.
  styleAnchor: styleAnchorSchema.optional(),

  // Reader tension model — tracks what the reader is most curious about.
  readerTension: readerTensionModelSchema.optional(),

  // Information asymmetry — who knows what secrets.
  informationLedger: informationLedgerSchema.optional(),

  // Dopamine schedule — tracks satisfaction event delivery cadence.
  dopamineSchedule: dopamineScheduleSchema.optional(),

  // Retroactive foreshadowing — seeds to inject into past chapters.
  pendingForeshadowingSeeds: z.array(foreshadowingSeedSchema).default([]),
  foreshadowingBank: foreshadowingBankSchema.default({ deposits: [], totalPlanted: 0, totalResolved: 0 }),

  // Story-internal time.
  storyClock: storyClockSchema.optional(),

  // How characters address each other.
  addressMatrix: z.array(addressEntrySchema).default([]),

  // End-of-chapter scene snapshot (last chapter's ending state).
  lastSceneSnapshot: sceneSnapshotSchema.optional(),

  // Naming conventions for world consistency.
  namingConvention: namingConventionSchema,

  // Golden finger — protagonist's evolving advantage.
  goldenFinger: goldenFingerSchema,

  // Factions / organizations.
  factions: z.array(factionSchema).default([]),

  // Character commitments / vows / flags.
  activeCommitments: z.array(characterCommitmentSchema).default([]),

  // Structural novelty registry — prevent repetitive arc structures.
  noveltyRegistry: z.object({
    usedArcTypes: z.array(z.object({ arcType: z.string(), arcId: z.string() })).default([]),
    usedNarrativeTechniques: z.array(z.object({ technique: z.string(), arcId: z.string() })).default([]),
    usedCooldownTags: z.array(z.string()).default([]),
    usedClimaxPatterns: z.array(z.string()).default([]), // 如"boss战""揭秘""背叛反转"
    lastArcTypes: z.array(z.string()).max(5).default([]), // 最近5卷的arcType（防连续）
  }).default({ usedArcTypes: [], usedNarrativeTechniques: [], usedCooldownTags: [], usedClimaxPatterns: [], lastArcTypes: [] }),

  // Anti-repetition tracking — recently used distinctive phrases.
  recentDistinctivePhrases: z.array(z.string()).default([]),

  recentEmotionalImprints: z.array(z.object({
    characterId: z.string(),
    emotion: z.string(),
    trigger: z.string(),
    chapterNumber: z.number(),
    intensity: z.enum(['subtle', 'moderate', 'intense', 'overwhelming']),
  })).default([]),

  // Runtime state.
  chapterCursor: z.number().int().min(1),
  characters: z.array(characterSchema).default([]),
  locations: z.array(locationSchema).default([]),
  items: z.array(itemSchema).default([]),
  chapterSummaries: z.array(z.object({
    chapterNumber: z.number().int().nonnegative(),
    summary: z.string(),
  })).default([]),
  openPlotThreads: z.array(z.string()).default([]),
  relationGraph: z.array(relationshipEdgeSchema).default([]),
  timelineEvents: z.array(timelineEventSchema).default([]),
  plotThreadLedger: z.array(plotThreadSchema).default([]),
  characterFactLedger: z.array(characterFactSchema).optional(),
  lastHook: z.string().default(''),
  recentHookTypes: z.array(z.object({
    chapterNumber: z.number().int().min(1),
    hookType: z.string(),
  })).default([]),
  kpiHistory: z.array(generationKpiSchema).default([]),

  qualityMetricsHistory: z.array(z.object({
    chapterNumber: z.number().int().min(1),
    hookRepeatRate: z.number().min(0).max(1).default(0),
    characterArcHitRate: z.number().min(0).max(1).default(1),
    genreMismatchFlags: z.array(z.string()).default([]),
    styleDriftScore: z.number().min(0).max(1).optional(),
    coreAbsenceRate: z.number().min(0).max(1).default(0),
    cameoOveruseRate: z.number().min(0).max(1).default(0),
    fadingCount: z.number().int().nonnegative().default(0),
    presentCharacterCount: z.number().int().nonnegative().default(0),
    newCharactersInArc: z.number().int().nonnegative().default(0),
  })).default([]),

  // Reader feedback — 三层分析 + 采纳判定。
  feedbackState: feedbackStateSchema.default({
    history: [], lastAnalyzedAtChapter: 0, gapSinceLastFeedback: 0,
    pendingCommentCount: 0, sentimentHistory: [], confidence: 'none',
  }),

  // Retrospective writing lessons — accumulated wisdom from past arcs.
  writingLessons: z.array(z.object({
    id: z.string(), // 如 "lesson_arc_1_1"
    sourceArcId: z.string(), // 从哪个弧总结的
    category: z.enum(['pacing', 'dialogue', 'character', 'worldbuilding', 'hook', 'prose', 'structure', 'emotion']),
    insight: z.string(), // 教训（如"群戏场景角色超过4人时声音辨识度下降"）
    actionable: z.string(), // 可执行建议（如"群戏限制同时说话角色≤3人"）
    confidence: z.enum(['tentative', 'confirmed', 'strong']).default('tentative'), // 多次验证后提升
    sourceEvidence: z.string(), // 依据（如"arc_2 第45-50章 characterDepth 平均5.2"）
    createdAtChapter: z.number().int().min(1),
  })).default([]),

  // Agent sections generation status — 'generated' or 'pending' (fallback to defaults, retry on first chapter)
  agentSectionsStatus: z.enum(['generated', 'pending']).default('generated'),

  // Maintenance tracking.
  maintenance: maintenanceStateSchema,
});

// ---------------------------------------------------------------------------
// Maintenance task outputs
// ---------------------------------------------------------------------------

export const consistencyAuditResultSchema = z.object({
  characterConflicts: z.array(z.object({
    characterId: z.string(),
    conflict: z.string(),
    resolution: z.string(),
  })).default([]),
  locationConflicts: z.array(z.object({
    locationId: z.string(),
    conflict: z.string(),
    resolution: z.string(),
  })).default([]),
  timelineInconsistencies: z.array(z.object({
    description: z.string(),
    affectedChapters: z.array(z.number()),
    suggestedFix: z.string(),
  })).default([]),
  cleanedRelationGraph: z.array(z.object({
    fromCharacterId: z.string(),
    toCharacterId: z.string(),
    relationType: z.string(),
    strength: z.number().min(-10).max(10),
    isActive: z.boolean(),
  })).default([]),
  overallHealthScore: z.number().min(0).max(10),
});

export const canonArbitrationResultSchema = z.object({
  resolvedFacts: z.array(z.object({
    characterId: z.string(),
    fact: z.string(),
    category: z.string(),
    status: z.enum(['confirmed', 'deprecated', 'merged']),
    mergedInto: z.string().optional(),
    reason: z.string(),
  })).default([]),
  conflictPairsResolved: z.number().int().nonnegative(),
});

export const threadHealthResultSchema = z.object({
  healthyThreads: z.array(z.string()).default([]),
  staleThreads: z.array(z.object({
    threadId: z.string(),
    label: z.string(),
    lastTouchedChapter: z.number(),
    staleSinceChapters: z.number(),
    recommendation: z.enum(['touch_soon', 'payoff_soon', 'expire']),
    reason: z.string(),
  })).default([]),
  overdueThreads: z.array(z.object({
    threadId: z.string(),
    label: z.string(),
    overdueSinceChapter: z.number(),
    recommendation: z.string(),
  })).default([]),
  suggestedPrioritization: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Deterministic post-write checks (lightweight, no LLM needed)
// ---------------------------------------------------------------------------

export const deterministicCheckResultSchema = z.object({
  pass: z.boolean(),
  failedChecks: z.array(z.object({
    rule: z.string(),
    detail: z.string(),
  })),
});

// ---------------------------------------------------------------------------
// Phase 6: Rewrite Guidance (multi-attempt quality loop)
// ---------------------------------------------------------------------------

export const rewriteGuidanceSchema = z.object({
  attemptNumber: z.number().int().min(1),
  maxAttempts: z.number().int().min(1).default(3),
  previousStrengths: z.array(z.string()),
  previousIssues: z.array(z.object({
    category: z.string(),
    severity: z.string(),
    description: z.string(),
    suggestedFix: z.string(),
  })),
  repeatedIssues: z.array(z.string()),
  previousScore: z.number().min(0).max(10),
  specificInstructions: z.string().optional(),
  preserveParagraphs: z.array(z.object({
    index: z.number().int().nonnegative(), // 段落索引
    reason: z.string(), // 保留理由（如"描写精彩""对话自然"）
  })).default([]),
});

// (Phase 7 Reader Feedback schemas moved before StoryState)

// ---------------------------------------------------------------------------
// Phase 8: Continuity Pre-check
// ---------------------------------------------------------------------------

export const continuityPreCheckSchema = z.object({
  pass: z.boolean(),
  warnings: z.array(z.object({
    type: z.enum([
      'dead_character_active',
      'location_mismatch',
      'timeline_violation',
      'power_level_breach',
      'faction_rule_violation',
      'commitment_forgotten',
      'pov_violation',
    ]),
    description: z.string(),
    severity: z.enum(['warning', 'block']),
    affectedEntityId: z.string().optional(),
  })),
  contextInjections: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Phase 8.5: Scene Pipeline (场景级写作拆分)
// ---------------------------------------------------------------------------

export const sceneContractSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  sceneId: z.string(),
  povCharacterId: z.string(),
  locationId: z.string().optional(),
  purpose: z.enum([
    'hook_opening', 'conflict', 'revelation', 'emotional',
    'action', 'dialogue_driven', 'transition', 'climax', 'cliffhanger',
  ]),
  objective: z.string(),
  conflict: z.string(),
  turningPoint: z.string(),
  presentCharacterIds: z.array(z.string()),
  emotionalEntry: z.string(),
  emotionalExit: z.string(),
  paceDirective: z.enum(['slow_burn', 'steady', 'accelerating', 'breakneck', 'stillness']),
  estimatedWords: z.number().int().min(1),
  transitionHint: z.string(),
  subtext: z.string().optional(), // 潜台词：角色表面在做什么，内心真正在想什么（制造张力）
  sensoryAnchors: z.array(z.string()).max(3).default([]), // 强制描写的具体感官细节（如：生锈的铁腥味），消除AI味
  isParallel: z.boolean().default(false), // 是否与上一场景并发生成（如双线叙事）
  characterMoment: z.object({
    characterId: z.string(),
    type: z.enum(['inner_test', 'relationship_shift', 'revelation', 'choice', 'growth', 'regression']),
    hint: z.string(),
  }).optional(),
  threadActions: z.array(z.object({
    threadLabel: z.string(),
    action: z.enum(['touch', 'advance', 'payoff', 'seed']),
  })).default([]),
  sensoryEndState: z.object({
    timeOfDay: z.string().default(''), // 场景结束时的时间（如"黄昏"）
    weather: z.string().default(''), // 天气/光线
    ambientSound: z.string().default(''), // 环境音（如"远处鸦群归巢"）
    dominantSense: z.string().default(''), // 主导感官（如"空气中的血腥味"）
  }).default({}),
});

export const chapterScenePlanSchema = z.object({
  chapterNumber: z.number().int().min(1),
  scenes: z.array(sceneContractSchema).min(2).max(6),
  overallEmotionalArc: z.string(), // 如"紧张→震惊→决心"
  hookStrategy: z.string(), // 末场景如何制造钩子
});

export const sceneDraftSchema = z.object({
  sceneIndex: z.number().int().nonnegative(),
  sceneId: z.string(),
  content: z.string(),
});

// ---------------------------------------------------------------------------
// Phase 9: Pacing Analysis
// ---------------------------------------------------------------------------

export const pacingAnalysisSchema = z.object({
  overallPacing: z.enum(['too_slow', 'good', 'too_fast']),
  sentenceLengthVariety: z.number().min(0).max(10),
  dialogueToNarrativeRatio: z.number().min(0).max(1),
  actionDensity: z.number().min(0).max(10),
  emotionalArcPresent: z.boolean(),
  suggestions: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type StorySeed = z.infer<typeof storySeedSchema>;
export type RoughOutline = z.infer<typeof roughOutlineSchema>;
export type RoughOutlinePoint = z.infer<typeof roughOutlinePointSchema>;
export type ChapterIntent = z.infer<typeof chapterIntentSchema>;
export type ArcDirectorDirective = z.infer<typeof arcDirectorDirectiveSchema>;
export type ChapterReview = z.infer<typeof chapterReviewSchema>;
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;
export type MaintenanceTrigger = z.infer<typeof maintenanceTriggerSchema>;
export type CrystallizedBible = z.infer<typeof crystallizedBibleSchema>;
export type StoryState = z.infer<typeof storyStateSchema>;
export type DeterministicCheckResult = z.infer<typeof deterministicCheckResultSchema>;
export type BookPromptProfile = z.infer<typeof bookPromptProfileSchema>;
export type VolumeArc = z.infer<typeof volumeArcSchema>;
export type VolumeArcMiniArcSlot = z.infer<typeof volumeArcMiniArcSlotSchema>;
export type VolumeArcCharacterGoal = z.infer<typeof volumeArcCharacterGoalSchema>;
export type MiniArc = z.infer<typeof miniArcSchema>;
export type MiniArcChapterBeat = z.infer<typeof miniArcChapterBeatSchema>;
export type ArcAcceptanceReport = z.infer<typeof arcAcceptanceReportSchema>;
export type StyleAnchor = z.infer<typeof styleAnchorSchema>;
export type ReaderCuriosity = z.infer<typeof readerCuriositySchema>;
export type ReaderTensionModel = z.infer<typeof readerTensionModelSchema>;
export type InformationGap = z.infer<typeof informationGapSchema>;
export type InformationLedger = z.infer<typeof informationLedgerSchema>;
export type SatisfactionEvent = z.infer<typeof satisfactionEventSchema>;
export type DopamineSchedule = z.infer<typeof dopamineScheduleSchema>;
export type ForeshadowingSeed = z.infer<typeof foreshadowingSeedSchema>;
export type ForeshadowingDeposit = z.infer<typeof foreshadowingDepositSchema>;
export type ForeshadowingBank = z.infer<typeof foreshadowingBankSchema>;
export type StoryClock = z.infer<typeof storyClockSchema>;
export type AddressEntry = z.infer<typeof addressEntrySchema>;
export type SceneSnapshot = z.infer<typeof sceneSnapshotSchema>;
export type NamingConvention = z.infer<typeof namingConventionSchema>;
export type ConsistencyAuditResult = z.infer<typeof consistencyAuditResultSchema>;
export type CanonArbitrationResult = z.infer<typeof canonArbitrationResultSchema>;
export type ThreadHealthResult = z.infer<typeof threadHealthResultSchema>;
export type RewriteGuidance = z.infer<typeof rewriteGuidanceSchema>;
export type ReaderComment = z.infer<typeof readerCommentSchema>;
export type ReaderFeedback = z.infer<typeof readerFeedbackSchema>;
export type FeedbackAdoption = z.infer<typeof feedbackAdoptionSchema>;
export type ReaderFeedbackAnalysis = z.infer<typeof readerFeedbackAnalysisSchema>;
export type AudienceDirective = z.infer<typeof audienceDirectiveSchema>;
export type HookCadencePolicy = z.infer<typeof hookCadencePolicySchema>;
export type ThreadPolicy = z.infer<typeof threadPolicySchema>;
export type CharacterFocusPolicy = z.infer<typeof characterFocusPolicySchema>;
export type BookStrategy = z.infer<typeof bookStrategySchema>;
export type FeedbackState = z.infer<typeof feedbackStateSchema>;
export type ContinuityPreCheck = z.infer<typeof continuityPreCheckSchema>;
export type PacingAnalysis = z.infer<typeof pacingAnalysisSchema>;
export type SceneContract = z.infer<typeof sceneContractSchema>;
export type ChapterScenePlan = z.infer<typeof chapterScenePlanSchema>;
export type SceneDraft = z.infer<typeof sceneDraftSchema>;

// ---------------------------------------------------------------------------
// Memory Pyramid — LLM 生成弧/卷摘要的输出格式
// ---------------------------------------------------------------------------

export const arcSummaryOutputSchema = z.object({
  summary: z.string(), // 弧整体摘要(300-500字)
  keyCharacterArcs: z.array(z.object({ characterId: z.string(), name: z.string(), arc: z.string() })).default([]),
  resolvedThreads: z.array(z.string()).default([]),
  newThreadsPlanted: z.array(z.string()).default([]),
  emotionalArc: z.string(), // 情感弧线
  keyTurningPoints: z.array(z.string()).default([]),
  worldStateChanges: z.string().default(''),
  keywords: z.array(z.string()).default([]),
});

export const volumeSummaryOutputSchema = z.object({
  summary: z.string(), // 卷整体摘要(500-800字)
  powerProgression: z.string().default(''),
  majorPlotMovements: z.array(z.string()).default([]),
  characterGrowth: z.array(z.object({ characterId: z.string(), name: z.string(), growth: z.string() })).default([]),
  worldExpansion: z.string().default(''),
  keywords: z.array(z.string()).default([]),
});

export type ArcSummaryOutput = z.infer<typeof arcSummaryOutputSchema>;
export type VolumeSummaryOutput = z.infer<typeof volumeSummaryOutputSchema>;

// ---------------------------------------------------------------------------
// Retrospective Learning — 弧结束后回顾式学习输出格式
// ---------------------------------------------------------------------------

export const retrospectiveLessonsOutputSchema = z.object({
  lessons: z.array(z.object({
    category: z.enum(['pacing', 'dialogue', 'character', 'worldbuilding', 'hook', 'prose', 'structure', 'emotion']),
    insight: z.string(), // 发现（如"连续3章高张力后读者疲劳，节奏得分下降"）
    actionable: z.string(), // 建议（如"高张力章节连续不超过2章，之后插入缓冲章"）
    evidence: z.string(), // 数据依据
    confidence: z.enum(['tentative', 'confirmed', 'strong']).default('tentative'),
  })),
  bestPractices: z.array(z.string()), // 本弧做得好的实践（可复用）
  antiPatterns: z.array(z.string()), // 本弧的反面教材（需避免）
});
export type RetrospectiveLessonsOutput = z.infer<typeof retrospectiveLessonsOutputSchema>;

export type WritingLesson = NonNullable<StoryState['writingLessons']>[number];

// Re-export shared types.
export type {
  ChapterDraft,
  LoreRecord,
  StoryBible,
  EditorialPlan,
  VolumePlan,
  RelationshipEdge,
  TimelineEvent,
  PlotThread,
  CharacterFact,
} from './novel.schemas';
