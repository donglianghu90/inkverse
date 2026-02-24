/**
 * Central Zod schema contracts for all agents/services.
 * These contracts are shared for:
 * - LLM structured output parsing
 * - runtime validation
 * - type inference across workflow
 */
import { z } from 'zod';

// Character lifecycle state for long-running serialization consistency.
export const characterLifecycleStatusSchema = z.enum([
  'active',
  'dormant',
  'dead',
  'exited',
  'return_planned',
]);

// Narrative importance tier to guide context compression and recall priority.
export const narrativeImportanceSchema = z.enum(['core', 'major', 'minor', 'cameo']);

// Character state snapshot inside world simulation.
export const characterStateSchema = z.object({
  locationId: z.string(),
  state: z.string(),
  level: z.number().int().nonnegative(),
  inventory: z.array(z.string()),
  lifecycleStatus: characterLifecycleStatusSchema.optional(),
  firstSeenChapter: z.number().int().positive().optional(),
  lastSeenChapter: z.number().int().positive().optional(),
  plannedReturnChapter: z.number().int().positive().nullable().optional(),
  narrativeImportance: narrativeImportanceSchema.optional(),
  dormantReference: z.boolean().optional(),
});

// Character voice profile — how this character SOUNDS in dialogue.
export const characterVoiceSchema = z.object({
  speechPattern: z.string(),
  verbalTics: z.array(z.string()).default([]),
  vocabularyLevel: z.enum(['crude', 'casual', 'neutral', 'formal', 'archaic']).default('neutral'),
  sampleDialogues: z.array(z.string()).default([]),
  innerMonologueStyle: z.string().optional(),
}).optional();

// Character ability entry.
export const characterAbilitySchema = z.object({
  name: z.string(),
  level: z.string(),
  description: z.string(),
  acquiredAtChapter: z.number().int().positive().optional(),
});

// Timestamped change record — tracks how a character evolves over the story.
export const characterChangeRecordSchema = z.object({
  chapterNumber: z.number().int().positive(),
  change: z.string(),
});

// Rich character profile — the full "character sheet".
export const characterProfileSchema = z.object({
  // Naming
  nameOrigin: z.string().optional(),
  nameMeaning: z.string().optional(),

  // Demographics
  age: z.string().optional(),
  gender: z.string().optional(),

  // Physical appearance (persistent baseline)
  height: z.string().optional(),
  build: z.string().optional(),
  skinTone: z.string().optional(),
  hairStyle: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  facialFeatures: z.string().optional(),
  distinguishingMarks: z.array(z.string()).default([]),

  // Fashion / style
  typicalOutfit: z.string().optional(),
  stylePreference: z.string().optional(),
  signatureAccessory: z.string().optional(),

  // Personality depth (beyond tags)
  hobbies: z.array(z.string()).default([]),
  fears: z.array(z.string()).default([]),
  desires: z.array(z.string()).default([]),
  habits: z.array(z.string()).default([]),
  coreContradiction: z.string().optional(),

  // Background
  backstory: z.string().optional(),
  education: z.string().optional(),
  occupation: z.string().optional(),
  socialClass: z.string().optional(),

  // Abilities / skills
  abilities: z.array(characterAbilitySchema).default([]),

  // Growth tracking — all changes over time
  appearanceChanges: z.array(characterChangeRecordSchema).default([]),
  abilityChanges: z.array(characterChangeRecordSchema).default([]),
  personalityShifts: z.array(characterChangeRecordSchema).default([]),
  outfitChanges: z.array(characterChangeRecordSchema).default([]),
}).optional();

// Faction/organization member entry.
export const factionMemberSchema = z.object({
  characterId: z.string(),
  rank: z.string(),
  title: z.string().optional(),
  joinedAtChapter: z.number().int().positive().optional(),
});

// Faction/organization schema.
export const factionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  hierarchy: z.array(z.string()).default([]),
  leaderId: z.string().nullable().default(null),
  headquartersLocationId: z.string().nullable().default(null),
  territory: z.array(z.string()).default([]),
  members: z.array(factionMemberSchema).default([]),
  relations: z.array(z.object({
    targetFactionId: z.string(),
    relationType: z.enum(['alliance', 'rivalry', 'war', 'subsidiary', 'neutral', 'trade', 'vassal']),
    strength: z.number().min(-10).max(10),
    notes: z.string().optional(),
  })).default([]),
  culture: z.string().optional(),
  rules: z.array(z.string()).default([]),
  firstSeenChapter: z.number().int().positive().optional(),
});

// Character commitment / vow / flag.
export const characterCommitmentSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  type: z.enum([
    'vow',
    'promise',
    'threat',
    'self_restriction',
    'goal',
    'debt',
    'prophecy',
  ]),
  content: z.string(),
  targetCharacterId: z.string().optional(),
  deadline: z.string().optional(),
  deadlineChapter: z.number().int().positive().optional(),
  status: z.enum(['active', 'fulfilled', 'broken', 'expired', 'forgotten']).default('active'),
  seededAtChapter: z.number().int().positive(),
  resolvedAtChapter: z.number().int().positive().optional(),
  urgency: z.enum(['background', 'active', 'imminent', 'overdue']).default('background'),
});

// Story actor profile.
export const characterSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  role: z.enum(['protagonist', 'supporting', 'villain', 'npc']),
  archetype: z.string(),
  personalityTags: z.array(z.string()),
  factionId: z.string().nullable().optional(),
  factionRank: z.string().optional(),
  profile: characterProfileSchema,
  voice: characterVoiceSchema,
  status: characterStateSchema,
});

// Location profile — rich environmental details for consistency.
export const locationProfileSchema = z.object({
  terrain: z.string().optional(),
  climate: z.string().optional(),
  season: z.string().optional(),
  sensoryDetails: z.object({
    sights: z.string().optional(),
    sounds: z.string().optional(),
    smells: z.string().optional(),
    atmosphere: z.string().optional(),
  }).optional(),
  architecture: z.string().optional(),
  culture: z.string().optional(),
  resources: z.array(z.string()).default([]),
  inhabitants: z.string().optional(),
  history: z.string().optional(),
  connectedLocations: z.array(z.object({
    locationId: z.string(),
    direction: z.string(),
    distance: z.string(),
  })).default([]),
}).optional();

// Runtime location model.
export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  dangerLevel: z.enum(['low', 'mid', 'high', 'extreme']),
  controllingFactionId: z.string().nullable().optional(),
  profile: locationProfileSchema,
});

// Item profile — rich object details.
export const itemProfileSchema = z.object({
  appearance: z.string().optional(),
  origin: z.string().optional(),
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary', 'unique']).optional(),
  limitations: z.string().optional(),
  cost: z.string().optional(),
  history: z.string().optional(),
  evolutionStages: z.array(z.object({
    stage: z.string(),
    description: z.string(),
    unlockedAtChapter: z.number().int().positive().optional(),
  })).default([]),
}).optional();

// Runtime item model.
export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  effect: z.string(),
  ownerId: z.string().nullable(),
  locationId: z.string().nullable(),
  profile: itemProfileSchema,
});

// Character relationship edge with validity window for temporal consistency.
export const relationshipEdgeSchema = z.object({
  id: z.string(),
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  relationType: z.string(),
  strength: z.number().min(-10).max(10),
  status: z.enum(['active', 'historical', 'hidden']),
  validFromChapter: z.number().int().positive(),
  validToChapter: z.number().int().positive().nullable(),
  evidenceEventId: z.string().nullable(),
  notes: z.string(),
});

// Timeline event ledger item for chapter-level cause/effect chain tracking.
export const timelineEventSchema = z.object({
  id: z.string(),
  chapterNumber: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  title: z.string(),
  summary: z.string(),
  locationId: z.string().nullable(),
  characterIds: z.array(z.string()),
  prerequisiteEventIds: z.array(z.string()),
  consequenceThreadIds: z.array(z.string()),
});

// Plot thread ledger item: setup/payoff lifecycle.
export const plotThreadSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['open', 'payoff', 'expired']),
  setupChapter: z.number().int().positive(),
  lastTouchedChapter: z.number().int().positive(),
  plannedPayoffStartChapter: z.number().int().positive().nullable(),
  plannedPayoffEndChapter: z.number().int().positive().nullable(),
  relatedCharacterIds: z.array(z.string()),
  relatedLocationIds: z.array(z.string()),
  relatedItemIds: z.array(z.string()),
  notes: z.string(),
});

// Stable character fact item persisted across chapters.
export const characterFactSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  fact: z.string(),
  category: z.enum([
    'identity',
    'motivation',
    'ability',
    'secret',
    'habit',
    'speech_style',
    'taboo',
    'goal',
    'belief',
    'history',
    'relationship',
  ]),
  status: z.enum(['active', 'deprecated', 'rumor']),
  confidence: z.number().min(0).max(1),
  firstSeenChapter: z.number().int().positive(),
  lastConfirmedChapter: z.number().int().positive(),
  sourceChapter: z.number().int().positive(),
  sourceEventId: z.string().nullable(),
  notes: z.string(),
});

// Lightweight relation seed used during bootstrap generation.
export const bootstrapRelationSeedSchema = z.object({
  fromCharacterId: z.string(),
  toCharacterId: z.string(),
  relationType: z.string(),
  strength: z.number().min(-10).max(10),
  notes: z.string().optional(),
});

// Bootstrap assets that must exist before first chapter generation.
export const bootstrapWorldSchema = z.object({
  characters: z.array(characterSchema).min(3),
  locations: z.array(locationSchema).min(2),
  items: z.array(itemSchema).min(2),
  characterRelations: z.array(bootstrapRelationSeedSchema).default([]),
});

// Canonical long-form story bible.
export const storyBibleSchema = z.object({
  title: z.string(),
  genre: z.string(),
  targetAudience: z.string(),
  logline: z.string(),
  worldRules: z.array(z.string()),
  powerSystem: z.array(
    z.object({
      levelName: z.string(),
      levelRank: z.number().int().nonnegative(),
      description: z.string(),
      boundary: z.string(),
    }),
  ),
  redLines: z.array(z.string()),
  mainConflict: z.string(),
  finalGoal: z.string(),
});

// Editorial quality guardrails from chief editor.
export const editorialPlanSchema = z.object({
  positioning: z.string(),
  narrativePromise: z.string(),
  pacingPolicy: z.array(z.string()),
  qualityBar: z.array(z.string()),
});

// Volume-level arc planning.
export const volumePlanSchema = z.object({
  volumeNumber: z.number().int().positive(),
  title: z.string(),
  theme: z.string(),
  villain: z.string(),
  milestoneEvents: z.array(z.string()),
  forbiddenPlots: z.array(z.string()),
});

// Chapter execution contract, consumed by planner/writer/validators.
export const chapterContractSchema = z.object({
  chapterNumber: z.number().int().positive(),
  chapterTitle: z.string(),
  mission: z.string(),
  // Opening carryover anchor that must bridge from previous chapter unresolved hook.
  openingCarryover: z.string(),
  mandatoryBeats: z.array(z.string()).min(3),
  qualityChecklist: z.array(z.string()).min(4),
  forbiddenBeats: z.array(z.string()),
  allowedCharacterIds: z.array(z.string()),
  requiredItemIds: z.array(z.string()),
  targetEmotion: z.string(),
  hookRequirement: z.string(),
  wordCountRange: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
});

// Plot-thread economy policy per chapter to avoid uncontrolled thread inflation.
export const plotEconomyPolicySchema = z.object({
  chapterNumber: z.number().int().positive(),
  maxNewThreads: z.number().int().min(0).max(3),
  minThreadTouches: z.number().int().min(0).max(4),
  minPayoffOrExpire: z.number().int().min(0).max(3),
  priorityThreadIds: z.array(z.string()),
  rationale: z.array(z.string()),
});

// Lowest planning unit for chapter execution.
export const sceneBeatSchema = z.object({
  id: z.string(),
  objective: z.string(),
  conflict: z.string(),
  turningPoint: z.string(),
  requiredCharacters: z.array(z.string()),
  estimatedWords: z.number().int().positive(),
});

// Chapter scene plan.
export const scenePlanSchema = z.object({
  chapterNumber: z.number().int().positive(),
  beats: z.array(sceneBeatSchema).min(3),
});

// Draft chapter payload.
export const chapterDraftSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
});

// Human-like reader jury evaluation report.
export const readerJuryReportSchema = z.object({
  pass: z.boolean(),
  overallScore: z.number().min(0).max(10),
  dimensions: z.object({
    excitement: z.number().min(0).max(10),
    pacing: z.number().min(0).max(10),
    cliffhanger: z.number().min(0).max(10),
    immersion: z.number().min(0).max(10),
  }),
  toxicPoints: z.array(z.string()),
  patchPlan: z.array(z.string()),
});

// New world elements discovered during writing.
export const newCharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  role: z.enum(['protagonist', 'supporting', 'villain', 'npc']),
  archetype: z.string(),
  personalityTags: z.array(z.string()).min(1),
  locationId: z.string().nullable().default(null),
  state: z.string().default(''),
  // First-impression profile from the text.
  nameOrigin: z.string().optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  appearance: z.string().optional(),
  outfit: z.string().optional(),
  ability: z.string().optional(),
});

export const newLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  dangerLevel: z.enum(['low', 'mid', 'high', 'extreme']).default('low'),
});

export const newItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  effect: z.string(),
  ownerId: z.string().nullable().default(null),
  locationId: z.string().nullable().default(null),
});

// Lore writeback record for state mutation after each chapter.
export const loreRecordSchema = z.object({
  chapterNumber: z.number().int().positive(),
  summary: z.string(),
  openLoops: z.array(z.string()).default([]),
  closedLoops: z.array(z.string()).default([]),
  stateChanges: z.array(z.string()).default([]),
  knowledgeFragments: z.array(z.string()).default([]),
  newCharacters: z.array(newCharacterSchema).default([]),
  newLocations: z.array(newLocationSchema).default([]),
  newItems: z.array(newItemSchema).default([]),
  characterLifecycleDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        lifecycleStatus: characterLifecycleStatusSchema.optional(),
        locationId: z.string().nullable().optional(),
        stateText: z.string().optional(),
        level: z.number().int().nonnegative().optional(),
        addInventoryItemIds: z.array(z.string()).default([]),
        removeInventoryItemIds: z.array(z.string()).default([]),
        plannedReturnChapter: z.number().int().positive().nullable().optional(),
        narrativeImportance: narrativeImportanceSchema.optional(),
        dormantReference: z.boolean().optional(),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  relationshipDeltas: z
    .array(
      z.object({
        fromCharacterId: z.string(),
        toCharacterId: z.string(),
        relationType: z.string(),
        strength: z.number().min(-10).max(10),
        status: z.enum(['active', 'historical', 'hidden']).default('active'),
        closeAtChapter: z.number().int().positive().nullable().default(null),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  timelineEventDeltas: z
    .array(
      z.object({
        eventType: z.string(),
        title: z.string(),
        summary: z.string(),
        locationId: z.string().nullable().default(null),
        characterIds: z.array(z.string()).default([]),
        prerequisiteEventIds: z.array(z.string()).default([]),
        consequenceThreadIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  plotThreadDeltas: z
    .array(
      z.object({
        threadId: z.string(),
        label: z.string(),
        action: z.enum(['open', 'touch', 'payoff', 'expire']),
        plannedPayoffStartChapter: z.number().int().positive().nullable().default(null),
        plannedPayoffEndChapter: z.number().int().positive().nullable().default(null),
        relatedCharacterIds: z.array(z.string()).default([]),
        relatedLocationIds: z.array(z.string()).default([]),
        relatedItemIds: z.array(z.string()).default([]),
        notes: z.string().default(''),
      }),
    )
    .default([]),
  characterAliasDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        alias: z.string(),
        action: z.enum(['add', 'remove']),
        evidence: z.string().default(''),
      }),
    )
    .optional(),
  characterFactDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        fact: z.string(),
        category: characterFactSchema.shape.category,
        action: z.enum(['add', 'confirm', 'deprecate']).default('add'),
        confidence: z.number().min(0).max(1).optional(),
        evidence: z.string().default(''),
      }),
    )
    .optional(),
  characterProfileDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        field: z.enum([
          'appearance', 'outfit', 'hairstyle', 'ability_gain',
          'ability_upgrade', 'injury', 'personality_shift',
          'hobby_discovered', 'backstory_revealed',
        ]),
        description: z.string(),
        isChange: z.boolean().default(false),
      }),
    )
    .optional(),
  characterVoiceDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        sampleDialogue: z.string(),
        speechPatternNote: z.string().optional(),
        verbalTic: z.string().optional(),
      }),
    )
    .optional(),
  curiosityDeltas: z
    .array(
      z.object({
        action: z.enum(['seed', 'tease', 'payoff']),
        curiosityId: z.string(),
        question: z.string().optional(),
        satisfactionType: z.enum(['full_answer', 'partial_reveal', 'twist', 'subversion']).optional(),
      }),
    )
    .optional(),
  informationGapDeltas: z
    .array(
      z.object({
        action: z.enum(['create', 'reveal', 'expand']),
        gapId: z.string(),
        secret: z.string().optional(),
        knownBy: z.array(z.string()).optional(),
        unknownTo: z.array(z.string()).optional(),
        type: z.enum([
          'dramatic_irony', 'mystery', 'betrayal_setup',
          'hidden_identity', 'secret_plan', 'misunderstanding',
        ]).optional(),
        dramaticPotential: z.enum(['low', 'medium', 'high', 'explosive']).optional(),
      }),
    )
    .optional(),
  satisfactionEvents: z
    .array(
      z.object({
        type: z.string(),
        intensity: z.enum(['minor', 'medium', 'major', 'climactic']),
        scale: z.enum([
          'personal', 'group', 'faction', 'regional',
          'national', 'continental', 'world',
        ]).default('personal'),
        description: z.string(),
        audienceImpact: z.string().optional(),
      }),
    )
    .optional(),
  foreshadowingOpportunities: z
    .array(
      z.object({
        targetChapterNumber: z.number().int().positive(),
        insertionType: z.enum(['sentence', 'paragraph', 'inner_thought', 'background_detail']),
        suggestedContent: z.string(),
        insertAfterParagraph: z.number().int().nonnegative(),
        reason: z.string(),
      }),
    )
    .optional(),
  timeDelta: z
    .object({
      daysElapsed: z.number().int().nonnegative().default(0),
      endTimeOfDay: z.enum(['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'evening', 'night', 'late_night']).optional(),
      seasonChange: z.enum(['spring', 'summer', 'autumn', 'winter']).optional(),
      calendarNote: z.string().optional(),
    })
    .optional(),
  addressDeltas: z
    .array(
      z.object({
        fromCharacterId: z.string(),
        toCharacterId: z.string(),
        address: z.string(),
        context: z.string().optional(),
      }),
    )
    .optional(),
  sceneSnapshot: z
    .object({
      locationId: z.string().optional(),
      locationName: z.string().optional(),
      timeOfDay: z.string().optional(),
      weather: z.string().optional(),
      presentCharacterIds: z.array(z.string()).default([]),
      ongoingAction: z.string().optional(),
      emotionalTone: z.string().optional(),
    })
    .optional(),
  locationProfileDeltas: z
    .array(
      z.object({
        locationId: z.string(),
        field: z.enum(['terrain', 'climate', 'sensory', 'architecture', 'culture', 'history', 'connection']),
        description: z.string(),
      }),
    )
    .optional(),
  itemProfileDeltas: z
    .array(
      z.object({
        itemId: z.string(),
        field: z.enum(['appearance', 'origin', 'limitation', 'evolution']),
        description: z.string(),
      }),
    )
    .optional(),
  factionDeltas: z
    .array(
      z.object({
        action: z.enum(['create', 'member_join', 'member_leave', 'rank_change', 'relation_change', 'update']),
        factionId: z.string(),
        factionName: z.string().optional(),
        factionType: z.string().optional(),
        description: z.string().optional(),
        characterId: z.string().optional(),
        rank: z.string().optional(),
        targetFactionId: z.string().optional(),
        relationType: z.enum(['alliance', 'rivalry', 'war', 'subsidiary', 'neutral', 'trade', 'vassal']).optional(),
        relationStrength: z.number().min(-10).max(10).optional(),
      }),
    )
    .optional(),
  commitmentDeltas: z
    .array(
      z.object({
        action: z.enum(['create', 'fulfill', 'break', 'progress', 'expire']),
        commitmentId: z.string(),
        characterId: z.string(),
        type: z.enum(['vow', 'promise', 'threat', 'self_restriction', 'goal', 'debt', 'prophecy']).optional(),
        content: z.string().optional(),
        targetCharacterId: z.string().optional(),
        deadline: z.string().optional(),
      }),
    )
    .optional(),
  hookClassification: z
    .object({
      hookType: z.string(),
      hookSummary: z.string(),
    })
    .optional(),
});

// Canon arbitration report for persona consistency conflicts and normalized deltas.
export const characterCanonReportSchema = z.object({
  chapterNumber: z.number().int().positive(),
  pass: z.boolean(),
  conflicts: z.array(z.string()),
  patchPlan: z.array(z.string()),
  resolvedCharacterAliasDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        alias: z.string(),
        action: z.enum(['add', 'remove']),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  resolvedCharacterFactDeltas: z
    .array(
      z.object({
        characterId: z.string(),
        fact: z.string(),
        category: characterFactSchema.shape.category,
        action: z.enum(['add', 'confirm', 'deprecate']).default('add'),
        confidence: z.number().min(0).max(1).optional(),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
});

// Deterministic hard-rule validator report.
export const hardValidationReportSchema = z.object({
  pass: z.boolean(),
  failedRules: z.array(z.string()),
});

// Deterministic state-transition validator report.
export const stateTransitionValidationReportSchema = z.object({
  pass: z.boolean(),
  failedRules: z.array(z.string()),
});

// Continuity validator report (character/world/timeline consistency).
export const continuityReportSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string()),
  patchPlan: z.array(z.string()),
});

// Writing-quality validator report (style/rhythm/AI-smell dimensions).
export const writingQualityReportSchema = z.object({
  pass: z.boolean(),
  overallScore: z.number().min(0).max(10),
  scores: z.object({
    hookStrength: z.number().min(0).max(10),
    pacingRhythm: z.number().min(0).max(10),
    dialogueVoice: z.number().min(0).max(10),
    sensoryImmersion: z.number().min(0).max(10),
    aiFreshness: z.number().min(0).max(10),
    sentenceVariety: z.number().min(0).max(10).default(10),
    informationDensity: z.number().min(0).max(10).default(10),
  }),
  issues: z.array(z.string()),
  patchPlan: z.array(z.string()),
});

// KPI row persisted per generated chapter.
export const generationKpiSchema = z.object({
  hardPass: z.boolean(),
  continuityPass: z.boolean().default(false),
  transitionPass: z.boolean().default(false),
  canonPass: z.boolean().default(true),
  qualityPass: z.boolean().default(false),
  juryPass: z.boolean(),
  qualityScore: z.number().min(0).max(10).default(0),
  overallScore: z.number().min(0).max(10),
});

// Full mutable story state persisted by storage layer.
export const storyStateSchema = z.object({
  bookId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  mainIdea: z.string(),
  editorialPlan: editorialPlanSchema,
  bible: storyBibleSchema,
  volumePlan: volumePlanSchema,
  chapterCursor: z.number().int().positive(),
  characters: z.array(characterSchema),
  locations: z.array(locationSchema),
  items: z.array(itemSchema),
  chapterSummaries: z.preprocess(
    (val) => {
      if (!Array.isArray(val)) return [];
      return val.map((item: unknown, index: number) => {
        if (typeof item === 'string') return { chapterNumber: index + 1, summary: item };
        return item;
      });
    },
    z.array(
      z.object({
        chapterNumber: z.number().int().nonnegative(),
        summary: z.string(),
      }),
    ),
  ),
  openPlotThreads: z.array(z.string()),
  // 关系/事件/伏线账本统一默认空数组，避免旧状态缺字段导致链路分支复杂化。
  relationGraph: z.array(relationshipEdgeSchema).default([]),
  timelineEvents: z.array(timelineEventSchema).default([]),
  plotThreadLedger: z.array(plotThreadSchema).default([]),
  // Optional for backward compatibility with older states.
  characterFactLedger: z.array(characterFactSchema).optional(),
  lastHook: z.string(),
  kpiHistory: z.array(generationKpiSchema),
});

// Exported inferred runtime types.
export type StoryState = z.infer<typeof storyStateSchema>;
export type EditorialPlan = z.infer<typeof editorialPlanSchema>;
export type StoryBible = z.infer<typeof storyBibleSchema>;
export type BootstrapWorld = z.infer<typeof bootstrapWorldSchema>;
export type BootstrapRelationSeed = z.infer<typeof bootstrapRelationSeedSchema>;
export type VolumePlan = z.infer<typeof volumePlanSchema>;
export type ChapterContract = z.infer<typeof chapterContractSchema>;
export type PlotEconomyPolicy = z.infer<typeof plotEconomyPolicySchema>;
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;
export type ReaderJuryReport = z.infer<typeof readerJuryReportSchema>;
export type LoreRecord = z.infer<typeof loreRecordSchema>;
export type CharacterCanonReport = z.infer<typeof characterCanonReportSchema>;
export type HardValidationReport = z.infer<typeof hardValidationReportSchema>;
export type StateTransitionValidationReport = z.infer<typeof stateTransitionValidationReportSchema>;
export type ContinuityReport = z.infer<typeof continuityReportSchema>;
export type WritingQualityReport = z.infer<typeof writingQualityReportSchema>;
export type RelationshipEdge = z.infer<typeof relationshipEdgeSchema>;
export type TimelineEvent = z.infer<typeof timelineEventSchema>;
export type PlotThread = z.infer<typeof plotThreadSchema>;
export type CharacterFact = z.infer<typeof characterFactSchema>;
