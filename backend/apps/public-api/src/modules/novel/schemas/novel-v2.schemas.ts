/**
 * V2 Schema contracts for the organic novel generation workflow.
 *
 * Design philosophy shift:
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
    unlockedAtChapter: z.number().int().positive().optional(),
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

export const storySeedSchema = z.object({
  title: z.string(),
  genre: z.string(),
  targetAudience: z.string(),
  logline: z.string(),
  protagonistConcept: z.object({
    name: z.string(),
    situation: z.string(),
    coreDesire: z.string(),
    personality: z.string(),
  }),
  tone: z.string(),
  coreConflictDirection: z.string(),
  redLines: z.array(z.string()),
  targetChapterWordCount: z.number().int().positive().default(3000),
  plannedTotalChapters: z.object({
    min: z.number().int().positive().default(500),
    max: z.number().int().positive().default(800),
  }).default({ min: 500, max: 800 }),
  readerPersona: readerPersonaSchema,
  goldenFinger: goldenFingerSchema,
  conceptEvaluation: conceptEvaluationSchema,
});

export const roughOutlinePointSchema = z.object({
  phase: z.enum(['opening', 'development', 'climax', 'resolution']),
  description: z.string(),
  tentativeChapterRange: z.string(),
});

export const roughOutlineSchema = z.object({
  points: z.array(roughOutlinePointSchema).min(4),
  endingDirection: z.string(),
  estimatedTotalChapters: z.number().int().positive().default(600),
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
  chapterNumber: z.number().int().positive(),
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
  wordCountRange: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
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
  chapterNumber: z.number().int().positive(),
  role: z.enum([
    'setup',         // 铺垫/引入
    'escalation',    // 升级/加压
    'twist',         // 转折/意外
    'climax',        // 高潮/对决
    'aftermath',     // 善后/缓冲
    'transition',    // 过渡/衔接
  ]),
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

export const miniArcSchema = z.object({
  arcId: z.string(),
  arcTitle: z.string(),
  startChapter: z.number().int().positive(),
  plannedEndChapter: z.number().int().positive(),
  coreTension: z.string(),
  climaxChapter: z.number().int().positive(),
  chapterBeats: z.array(miniArcChapterBeatSchema),
  status: z.enum(['active', 'completed']).default('active'),
});

// ---------------------------------------------------------------------------
// Phase 3.6: Style anchor (文风锚定)
// ---------------------------------------------------------------------------

export const styleAnchorSchema = z.object({
  sampleParagraphs: z.array(z.string()).max(5),
  narrativeVoice: z.string(),
  pacePreference: z.string(),
  dialogueStyle: z.string(),
  anchoredAtChapter: z.number().int().positive(),
  pov: z.enum([
    'first_person',
    'third_person_limited',
    'third_person_omniscient',
    'multi_pov',
  ]).default('third_person_limited'),
  povCharacterId: z.string().optional(),
  povSwitchRules: z.string().optional(),
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
  seededAtChapter: z.number().int().positive(),
  type: z.enum([
    'dramatic_irony',
    'mystery',
    'betrayal_setup',
    'hidden_identity',
    'secret_plan',
    'misunderstanding',
  ]),
  resolved: z.boolean().default(false),
  resolvedAtChapter: z.number().int().positive().optional(),
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
  deliveredAtChapter: z.number().int().positive(),
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
  targetChapterNumber: z.number().int().positive(),
  insertionType: z.enum(['sentence', 'paragraph', 'inner_thought', 'background_detail']),
  content: z.string(),
  insertAfterParagraph: z.number().int().nonnegative(),
  reason: z.string(),
  triggeredByChapter: z.number().int().positive(),
  applied: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Phase 3.5d: Reader tension model — what the reader is currently waiting for
// ---------------------------------------------------------------------------

export const readerCuriositySchema = z.object({
  id: z.string(),
  question: z.string(),
  seededAtChapter: z.number().int().positive(),
  lastTeaseAtChapter: z.number().int().nonnegative().default(0),
  urgency: z.enum(['simmering', 'building', 'boiling', 'overdue']),
  relatedThreadId: z.string().optional(),
  payoffDelivered: z.boolean().default(false),
  payoffAtChapter: z.number().int().positive().optional(),
});

export const readerTensionModelSchema = z.object({
  activeCuriosities: z.array(readerCuriositySchema).default([]),
  recentPayoffs: z.array(z.object({
    curiosityId: z.string(),
    question: z.string(),
    payoffAtChapter: z.number().int().positive(),
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
  version: z.number().int().positive(),
  crystallizedAtChapter: z.number().int().positive(),
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
  lastUpdatedAtChapter: z.number().int().positive().optional(),
});

// ---------------------------------------------------------------------------
// Phase 5b: Address matrix — how characters address each other
// ---------------------------------------------------------------------------

export const addressEntrySchema = z.object({
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  address: z.string(),
  context: z.string().optional(),
  firstUsedChapter: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// Phase 5c: End-of-chapter scene snapshot
// ---------------------------------------------------------------------------

export const sceneSnapshotSchema = z.object({
  chapterNumber: z.number().int().positive(),
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  presentCharacterIds: z.array(z.string()).default([]),
  ongoingAction: z.string().optional(),
  emotionalTone: z.string().optional(),
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
// V2 Story State (evolves from V1, backward compatible)
// ---------------------------------------------------------------------------

export const storyStateV2Schema = z.object({
  bookId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.literal(2).default(2),

  // Seed — always present from creation.
  seed: storySeedSchema,
  roughOutline: roughOutlineSchema,

  // Book prompt profile — AI-generated writing guide, genre-adaptive.
  bookPromptProfile: bookPromptProfileSchema,

  // Crystallized assets — grow over time, optional initially.
  bible: storyBibleSchema.optional(),
  editorialPlan: editorialPlanSchema.optional(),
  volumePlan: volumePlanSchema.optional(),

  // Mini-arc (卷级规划) — planned 5-15 chapters at a time.
  currentArc: miniArcSchema.optional(),
  completedArcs: z.array(miniArcSchema).default([]),

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

  // Anti-repetition tracking — recently used distinctive phrases.
  recentDistinctivePhrases: z.array(z.string()).default([]),

  // Runtime state.
  chapterCursor: z.number().int().positive(),
  characters: z.array(characterSchema),
  locations: z.array(locationSchema),
  items: z.array(itemSchema),
  chapterSummaries: z.array(z.object({
    chapterNumber: z.number().int().nonnegative(),
    summary: z.string(),
  })),
  openPlotThreads: z.array(z.string()),
  relationGraph: z.array(relationshipEdgeSchema).default([]),
  timelineEvents: z.array(timelineEventSchema).default([]),
  plotThreadLedger: z.array(plotThreadSchema).default([]),
  characterFactLedger: z.array(characterFactSchema).optional(),
  lastHook: z.string(),
  recentHookTypes: z.array(z.object({
    chapterNumber: z.number().int().positive(),
    hookType: z.string(),
  })).default([]),
  kpiHistory: z.array(generationKpiSchema),

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
// Exported types
// ---------------------------------------------------------------------------

export type StorySeed = z.infer<typeof storySeedSchema>;
export type RoughOutline = z.infer<typeof roughOutlineSchema>;
export type RoughOutlinePoint = z.infer<typeof roughOutlinePointSchema>;
export type ChapterIntent = z.infer<typeof chapterIntentSchema>;
export type ChapterReview = z.infer<typeof chapterReviewSchema>;
export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;
export type MaintenanceTrigger = z.infer<typeof maintenanceTriggerSchema>;
export type CrystallizedBible = z.infer<typeof crystallizedBibleSchema>;
export type StoryStateV2 = z.infer<typeof storyStateV2Schema>;
export type DeterministicCheckResult = z.infer<typeof deterministicCheckResultSchema>;
export type BookPromptProfile = z.infer<typeof bookPromptProfileSchema>;
export type MiniArc = z.infer<typeof miniArcSchema>;
export type MiniArcChapterBeat = z.infer<typeof miniArcChapterBeatSchema>;
export type StyleAnchor = z.infer<typeof styleAnchorSchema>;
export type ReaderCuriosity = z.infer<typeof readerCuriositySchema>;
export type ReaderTensionModel = z.infer<typeof readerTensionModelSchema>;
export type InformationGap = z.infer<typeof informationGapSchema>;
export type InformationLedger = z.infer<typeof informationLedgerSchema>;
export type SatisfactionEvent = z.infer<typeof satisfactionEventSchema>;
export type DopamineSchedule = z.infer<typeof dopamineScheduleSchema>;
export type ForeshadowingSeed = z.infer<typeof foreshadowingSeedSchema>;
export type StoryClock = z.infer<typeof storyClockSchema>;
export type AddressEntry = z.infer<typeof addressEntrySchema>;
export type SceneSnapshot = z.infer<typeof sceneSnapshotSchema>;
export type NamingConvention = z.infer<typeof namingConventionSchema>;
export type ConsistencyAuditResult = z.infer<typeof consistencyAuditResultSchema>;
export type CanonArbitrationResult = z.infer<typeof canonArbitrationResultSchema>;
export type ThreadHealthResult = z.infer<typeof threadHealthResultSchema>;

// Re-export types still used from V1.
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
