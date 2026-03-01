import { request } from '@umijs/max';
import { getToken } from '@/services/auth';

const BASE = '/api/novel';

/* ========== 请求参数 ========== */

export interface CreateBookParams {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  writingMode?: 'commercial' | 'literary';
  mainStoryGoal: string;
  titleHint?: string;
  targetChapterWordCount?: number;
  plannedMinChapters?: number;
  plannedMaxChapters?: number;
  profileTemplateId?: string;
  autoSerializationEnabled?: boolean;
  autoSerializationDailyStartTime?: string;
  autoSerializationRunEveryDays?: number;
  autoSerializationChaptersPerRun?: number;
  autoSerializationMaxRepairRounds?: number;
  autoSerializationMinQualityScore?: number;
  autoSerializationMinOverallScore?: number;
}

export interface BatchGenerateParams {
  chapterCount: number;
  maxRepairRounds?: number;
  minQualityScore?: number;
  minOverallScore?: number;
}

export interface AutoSerializationConfig {
  dailyStartTime: string;
  chaptersPerRun: number;
  runEveryDays?: number;
  maxRepairRounds?: number;
  minQualityScore?: number;
  minOverallScore?: number;
}

/* ========== 响应类型 ========== */

export interface BookListItem {
  bookId: string;
  title: string;
  genre: string;
  chaptersGenerated: number;
  latestKpi: { qualityScore: number; overallScore: number } | null;
  updatedAt: string;
}

export interface CraftExample {
  bad: string;
  good: string;
  rule: string;
}

export interface BookPromptProfile {
  generatedForGenre: string;
  generatedForAudience: string;
  writerGuide: {
    coreIdentity: string;
    genreRules: string[];
    pacingGuide: string;
    dialogueGuide: string;
    craftExamples: CraftExample[];
    toneGuide: string;
  };
  satisfactionTypes: Array<{ id: string; label: string; description: string }>;
  hookTypes: Array<{ id: string; label: string; description: string }>;
  clichePatterns: Array<{ pattern: string; maxPerChapter: number }>;
  reviewerCalibration: {
    dimensionWeights: {
      engagement: number;
      pacing: number;
      hookStrength: number;
      consistency: number;
      proseQuality: number;
      characterDepth: number;
    };
    genreSpecificChecks: string[];
    scoringAnchors: { high: string; mid: string; low: string };
  };
  worldProfile: {
    organizationTypes: string[];
    powerSystemApplicable: boolean;
    goldenFingerApplicable: boolean;
    commitmentTypes: string[];
    characterRelationEmphasis: string;
  };
  styleReferenceTexts?: string[];
  chapterTypeTemplates?: Record<string, string>;
  firstChaptersStrategy?: string;
  audienceReactionGuide?: string;
}

export interface MiniArcChapterBeat {
  chapterNumber: number;
  role: 'setup' | 'escalation' | 'twist' | 'climax' | 'aftermath' | 'transition';
  technique?: string; // AI自由输出的中文叙事技法标签
  tensionLevel: number;
  briefGoal: string;
  satisfactionType: 'none' | 'minor_payoff' | 'major_payoff' | 'emotional_peak' | 'relief';
}

export interface MiniArc {
  arcId: string;
  arcTitle: string;
  startChapter: number;
  plannedEndChapter: number;
  coreTension: string;
  emotionalTheme: string;
  climaxChapter: number;
  chapterBeats: MiniArcChapterBeat[];
  status: 'active' | 'completed';
}

export interface CreateBookResult {
  bookId: string;
  title: string;
  chapterCursor: number;
  outline: Record<string, unknown>;
  bookPromptProfile: BookPromptProfile;
  currentArc?: MiniArc | null;
  autoSerialization?: {
    enabled: boolean;
    status: 'configured' | 'failed' | 'disabled_by_user';
    schedule?: AutoSerializationView;
    error?: string;
    requested?: AutoSerializationConfig;
  };
}

export interface CreateBookSessionResult {
  progressChannel: string;
  reused: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed';
  result: CreateBookResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookInfo {
  bookId: string;
  title: string;
  genre: string;
  chapterCursor: number;
  chaptersGenerated: number;
  hasBible: boolean;
  openPlotThreads: string[];
  currentArc?: MiniArc | null;
  completedArcs?: MiniArc[];
  latestKpi: { qualityScore: number; overallScore: number } | null;
}

export interface ChapterItem {
  bookId: string;
  chapterNumber: number;
  title: string;
  content: string;
  createdAt: string;
}

export interface ChapterArtifactEntry {
  name: string;
  found: boolean;
  payload: Record<string, unknown> | null;
}

export interface ChapterTraceMatchItem {
  text: string;
  matched: boolean;
  matchScore: number;
}

export interface ChapterTraceAlignmentGroup {
  total: number;
  matched: number;
  score: number | null;
  items: ChapterTraceMatchItem[];
}

export interface ChapterTraceAlignment {
  overallAlignmentScore: number | null;
  mustHit: ChapterTraceAlignmentGroup;
  intentGoals: ChapterTraceAlignmentGroup;
  hookDirection: ChapterTraceMatchItem | null;
  remediation?: {
    shouldRewrite: boolean;
    severity: 'low' | 'medium' | 'high';
    reasons: string[];
    suggestedActions: string[];
    rewritePrompt: string | null;
  } | null;
}

export interface ChapterArtifactsView {
  bookId: string;
  chapterNumber: number;
  names: string[];
  artifacts: ChapterArtifactEntry[];
  alignment?: ChapterTraceAlignment | null;
}

export interface ChapterGenerateResult {
  chapterNumber: number;
  title: string;
  qualityScore?: number;
  overallScore: number;
  wasEdited: boolean;
  reviewVerdict: string;
}

export interface BatchGenerateResult {
  bookId: string;
  requestedChapters: number;
  generatedChapters: number;
  stopReason: string | null;
  nextChapterCursor: number;
  chapters: ChapterGenerateResult[];
}

export interface AutoSerializationView {
  bookId: string;
  enabled: boolean;
  dailyStartTime: string;
  chaptersPerRun: number;
  runEveryDays: number;
  cadence: {
    runEveryDays: number;
    chaptersPerRun: number;
    averageChaptersPerDay: number;
  };
  qualityPolicy: {
    maxRepairRounds: number;
    minQualityScore: number;
    minOverallScore: number;
  };
  intervention: {
    required: boolean;
    expired: boolean;
    reason: string | null;
    failingChapterNumber: number | null;
    markerChapterNumber: number | null;
    markerChapterNumbers: number[];
    consecutiveLowQualityRuns: number;
    threshold: number;
    raisedAt: string | null;
    expiresAt: string | null;
  };
  scheduler: {
    nextRunAt: string | null;
    lastRunAt: string | null;
    running: boolean;
    runStartedAt: string | null;
    lastError: string | null;
  };
  lastRunSummary: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/* ========== API 调用 ========== */

export async function listBooks(): Promise<{ count: number; books: BookListItem[] }> {
  return request(`${BASE}/books`);
}

export interface EnhanceIdeaResult {
  enhanced: string;
  highlights: string[];
}

export async function enhanceIdea(idea: string, genre?: string): Promise<EnhanceIdeaResult> {
  return request(`${BASE}/idea/enhance`, { method: 'POST', data: { idea, genre } });
}

export interface GenerateGoalResult {
  goal: string;
  alternatives: string[];
}

export async function generateStoryGoal(
  mainIdea: string,
  genre: string,
  targetAudience: string,
): Promise<GenerateGoalResult> {
  return request(`${BASE}/idea/generate-goal`, {
    method: 'POST',
    data: { mainIdea, genre, targetAudience },
  });
}

export async function createBook(data: CreateBookParams): Promise<CreateBookResult> {
  return request(`${BASE}/books`, { method: 'POST', data });
}

export async function createBookSession(
  data: CreateBookParams,
  idempotencyKey?: string,
): Promise<CreateBookSessionResult> {
  return request(`${BASE}/books/create-session`, {
    method: 'POST',
    data: {
      ...data,
      idempotencyKey,
    },
  });
}

export async function deleteBook(bookId: string): Promise<{ deleted: true; bookId: string }> {
  return request(`${BASE}/books/${bookId}`, { method: 'DELETE' });
}

export async function getBook(bookId: string): Promise<BookInfo> {
  return request(`${BASE}/books/${bookId}`);
}

export async function generateChapter(bookId: string): Promise<ChapterGenerateResult> {
  return request(`${BASE}/books/${bookId}/chapters/generate`, { method: 'POST' });
}

export async function generateChaptersBatch(
  bookId: string,
  data: BatchGenerateParams,
): Promise<BatchGenerateResult> {
  return request(`${BASE}/books/${bookId}/chapters/generate-batch`, { method: 'POST', data });
}

export async function listChapters(
  bookId: string,
  limit = 50,
): Promise<{ bookId: string; count: number; chapters: ChapterItem[] }> {
  return request(`${BASE}/books/${bookId}/chapters`, { params: { limit } });
}

export async function getChapter(bookId: string, chapterNumber: number): Promise<ChapterItem> {
  return request(`${BASE}/books/${bookId}/chapters/${chapterNumber}`);
}

export async function getChapterArtifacts(
  bookId: string,
  chapterNumber: number,
  names?: string[],
): Promise<ChapterArtifactsView> {
  const params =
    names && names.length > 0
      ? { names: names.join(',') }
      : undefined;
  return request(`${BASE}/books/${bookId}/chapters/${chapterNumber}/artifacts`, { params });
}

export async function updateChapter(
  bookId: string,
  chapterNumber: number,
  data: { title?: string; content?: string },
): Promise<ChapterItem> {
  return request(`${BASE}/books/${bookId}/chapters/${chapterNumber}`, {
    method: 'PUT',
    data,
  });
}

export async function configureAutoSerialization(
  bookId: string,
  data: AutoSerializationConfig,
): Promise<AutoSerializationView> {
  return request(`${BASE}/books/${bookId}/auto-serialization`, { method: 'PUT', data });
}

export async function getAutoSerialization(bookId: string): Promise<AutoSerializationView | null> {
  return request(`${BASE}/books/${bookId}/auto-serialization`);
}

export async function enableAutoSerialization(bookId: string): Promise<AutoSerializationView> {
  return request(`${BASE}/books/${bookId}/auto-serialization/enable`, { method: 'POST' });
}

export async function disableAutoSerialization(bookId: string): Promise<AutoSerializationView> {
  return request(`${BASE}/books/${bookId}/auto-serialization/disable`, { method: 'POST' });
}

export async function runAutoSerializationNow(
  bookId: string,
): Promise<{ bookId: string; trigger: string; accepted: boolean; jobId: string }> {
  return request(`${BASE}/books/${bookId}/auto-serialization/run-now`, { method: 'POST' });
}

/* ========== 世界观类型 ========== */

export interface CharacterInfo {
  id: string;
  name: string;
  aliases?: string[];
  role: 'protagonist' | 'supporting' | 'villain' | 'npc';
  archetype: string;
  personalityTags: string[];
  status: {
    locationId: string;
    state: string;
    level: number;
    inventory: string[];
    lifecycleStatus?: string;
    narrativeImportance?: string;
  };
}

export interface LocationInfo {
  id: string;
  name: string;
  description: string;
  dangerLevel: 'low' | 'mid' | 'high' | 'extreme';
}

export interface ItemInfo {
  id: string;
  name: string;
  type: string;
  effect: string;
  ownerId: string | null;
  locationId: string | null;
}

export interface RelationEdge {
  id: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationType: string;
  strength: number;
  status: 'active' | 'historical' | 'hidden';
  notes: string;
}

export interface PowerLevel {
  levelName: string;
  levelRank: number;
  description: string;
  boundary: string;
}

export interface WorldData {
  bookId: string;
  title: string;
  genre: string;
  seed: {
    logline: string;
    tone: string;
    coreConflictDirection: string;
    redLines: string[];
    protagonistConcept: {
      name: string;
      situation: string;
      coreDesire: string;
      personality: string;
    };
  };
  bible: {
    title: string;
    genre: string;
    worldRules: string[];
    powerSystem: PowerLevel[];
    redLines: string[];
    mainConflict: string;
    logline: string;
  } | null;
  characters: CharacterInfo[];
  locations: LocationInfo[];
  items: ItemInfo[];
  relationGraph: RelationEdge[];
  openPlotThreads: string[];
  plotThreadLedger: Array<{
    id: string;
    label: string;
    status: string;
    setupChapter: number;
    lastTouchedChapter: number;
  }>;
  currentArc?: MiniArc | null;
  completedArcs?: MiniArc[];
  roughOutline: {
    points: Array<{ phase: string; description: string; tentativeChapterRange: string }>;
    endingDirection: string;
  };
  chapterSummaries: Array<{ chapterNumber: number; summary: string }>;
}

/* ========== Token 用量统计 ========== */

export interface BookTokenUsage {
  bookId: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  byProvider: Array<{ provider: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number }>;
  byModel: Array<{ model: string; provider: string; tier: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; avgDurationMs: number }>;
  chapters: Array<{ chapterNumber: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; totalCalls: number; byModel?: Array<{ model: string; provider: string; tier: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; avgDurationMs: number }> }>;
}

export async function getBookTokenUsage(bookId: string): Promise<BookTokenUsage> {
  return request(`${BASE}/books/${bookId}/token-usage`);
}

export async function getBookProfile(bookId: string): Promise<BookPromptProfile> {
  return request(`${BASE}/books/${bookId}/profile`);
}

export async function updateBookProfile(
  bookId: string,
  profile: BookPromptProfile,
): Promise<BookPromptProfile> {
  return request(`${BASE}/books/${bookId}/profile`, { method: 'PUT', data: profile });
}

export interface AudienceDirective {
  audienceTags: string[];
  protagonistFocus: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference: string;
  relationshipDensity: 'low' | 'medium' | 'high';
  hardConstraints: string[];
  softPreferences: string[];
}

export async function getBookAudience(bookId: string): Promise<AudienceDirective> {
  return request(`${BASE}/books/${bookId}/audience`);
}

export async function updateBookAudience(
  bookId: string,
  audience: AudienceDirective,
): Promise<AudienceDirective> {
  return request(`${BASE}/books/${bookId}/audience`, { method: 'PUT', data: audience });
}

export async function getWorld(bookId: string): Promise<WorldData> {
  return request(`${BASE}/books/${bookId}/world`);
}

/* ========== SSE 类型 ========== */

export interface GenerationProgressEvent {
  bookId: string;
  chapterNumber: number;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  error?: string;
  nodeId?: string;
  loopAttempt?: number;
  score?: number;
  durationMs?: number;
  skipped?: boolean;
  phase?: string;
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface NodeExecution {
  nodeId: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  loopAttempt?: number;
  score?: number;
  skippedReason?: string;
  errorMessage?: string;
}

export interface ExecutionSummary {
  totalDurationMs: number;
  totalLoopAttempts: number;
  finalScore?: number;
  finalVerdict?: string;
  nodeCount: number;
  failedNodes: string[];
}

export interface WorkflowExecution {
  id: string;
  bookId: string;
  chapterNumber: number;
  nodes: NodeExecution[];
  summary: ExecutionSummary | null;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt: string | null;
}

export interface GenerationStatus { generating: boolean; startedAt: number | null; lastStep: string | null; progress: number; }

export async function getGenerationStatus(bookId: string): Promise<GenerationStatus> {
  return request(`${BASE}/books/${bookId}/generation-status`);
}

export function getGenerateSSEUrl(bookId: string): string {
  const token = getToken();
  return `${BASE}/books/${bookId}/chapters/generate-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getProgressSSEUrl(bookId: string): string {
  const token = getToken();
  return `${BASE}/books/${bookId}/chapters/progress-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/* ========== Pipeline ========== */

export type AgentNodeType =
  | 'intent'
  | 'arc-director'
  | 'scene-planner'
  | 'creative-writer'
  | 'scene-stitcher'
  | 'reviewer'
  | 'editor'
  | 'recorder'
  | 'continuity-guard'
  | 'hook-crafter'
  | 'pacing-analyzer'
  | 'character-voice-coach'
  | 'custom';

export type CustomOutputType = 'ChapterDraft' | 'ChapterIntent';

export interface CustomAgentConfig {
  systemPrompt: string;
  userPromptTemplate: string;
  outputType: CustomOutputType;
  temperature: number;
}

export interface AgentNodeConfig {
  id: string;
  type: AgentNodeType;
  label: string;
  description: string;
  isEnabled: boolean;
  isDeletable: boolean;
  isCore: boolean;
  position: number;
  rfPosition: { x: number; y: number };
  additionalSystemPrompt: string;
  customConfig?: CustomAgentConfig;
}

export interface WorkflowParams {
  qualityPassScore: number;
  maxRepairRounds: number;
  editorPolishThreshold: number;
  longRangeMemoryThreshold: number;
}

export interface PipelineView {
  bookId: string;
  draftNodes: AgentNodeConfig[];
  publishedNodes: AgentNodeConfig[] | null;
  publishedAt: string | null;
  hasDraft: boolean;
  workflowParams: WorkflowParams;
}

export type WfNodeType = 'agent' | 'condition' | 'check' | 'parallel_fork' | 'parallel_join' | 'loop_entry' | 'loop_exit' | 'phase_header';
export type WfEdgeType = 'normal' | 'conditional_true' | 'conditional_false' | 'retry' | 'rollback' | 'parallel';

export interface ConfigParam {
  key: string;
  label: string;
  type: 'number' | 'boolean';
  value: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  description: string;
}

export interface WfNode {
  id: string;
  label: string;
  type: WfNodeType;
  agentType?: string;
  icon?: string;
  isCore: boolean;
  isEnabled: boolean;
  condition?: string;
  configParams?: ConfigParam[];
  phaseId: string;
}

export interface WfEdge {
  id: string;
  source: string;
  target: string;
  type: WfEdgeType;
  label?: string;
  animated?: boolean;
}

export interface WfPhase {
  id: string;
  label: string;
  type: 'sequential' | 'loop' | 'parallel_group';
  nodeIds: string[];
}

export interface WorkflowTopology {
  phases: WfPhase[];
  nodes: WfNode[];
  edges: WfEdge[];
  params: WorkflowParams;
}

export async function getPipeline(bookId: string): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline`);
}

export async function savePipelineDraft(bookId: string, nodes: AgentNodeConfig[]): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline/draft`, { method: 'PUT', data: { nodes } });
}

export async function publishPipeline(bookId: string): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline/publish`, { method: 'POST' });
}

export async function getTopology(bookId: string): Promise<WorkflowTopology> {
  return request(`${BASE}/books/${bookId}/pipeline/topology`);
}

export async function saveWorkflowParams(bookId: string, params: Partial<WorkflowParams>): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline/workflow-params`, { method: 'PUT', data: params });
}

export function createBookSseUrl(progressChannel: string): string {
  const params = new URLSearchParams({ progressChannel });
  return `${BASE}/books/create-sse?${params.toString()}`;
}

// ── Prompt Templates ──────────────────────────────────────────────────────

export interface PromptSection {
  key: string;
  label: string;
  content: string;
  isLocked: boolean;
}

export interface AgentPromptConfig {
  agentId: string;
  sections: PromptSection[];
}

export interface PromptEditRecord { timestamp: string; target: string; label: string; oldContent: string }

export interface PromptTemplateView {
  bookId: string;
  ruleAtoms: RuleAtom[];
  agents: Record<string, AgentPromptConfig>;
  editHistory: PromptEditRecord[];
  updatedAt: string;
}

export async function getPromptTemplates(bookId: string): Promise<PromptTemplateView> {
  return request(`${BASE}/books/${bookId}/prompt-templates`);
}

export async function updateRuleAtom(bookId: string, atomId: string, patch: Partial<RuleAtom>): Promise<PromptTemplateView> {
  return request(`${BASE}/books/${bookId}/prompt-templates/rule-atoms/${atomId}`, { method: 'PUT', data: patch });
}

export async function updateAgentSection(bookId: string, agentId: string, sectionKey: string, content: string): Promise<PromptTemplateView> {
  return request(`${BASE}/books/${bookId}/prompt-templates/agents/${agentId}/sections/${sectionKey}`, { method: 'PUT', data: { content } });
}

export async function revertPromptEdit(bookId: string, historyIndex: number): Promise<PromptTemplateView> {
  return request(`${BASE}/books/${bookId}/prompt-templates/revert`, { method: 'POST', data: { historyIndex } });
}

export async function resetPromptTemplates(bookId: string): Promise<PromptTemplateView> {
  return request(`${BASE}/books/${bookId}/prompt-templates/reset`, { method: 'POST' });
}

// ── Workflow Executions ───────────────────────────────────────────────────

export async function listExecutions(bookId: string, limit = 20): Promise<WorkflowExecution[]> {
  return request(`${BASE}/books/${bookId}/executions?limit=${limit}`);
}

export async function getChapterExecution(bookId: string, chapterNumber: number): Promise<WorkflowExecution | null> {
  return request(`${BASE}/books/${bookId}/chapters/${chapterNumber}/execution`);
}

// =========================================================================
// Reader Feedback — 读者反馈
// =========================================================================

export interface ReaderCommentInput {
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  aspect: 'plot' | 'character' | 'writing' | 'pacing' | 'worldbuilding' | 'hook' | 'general';
  authorId?: string;
  platform?: string;
}

export interface SubmitFeedbackPayload {
  chapterNumber: number;
  comments: ReaderCommentInput[];
  metrics?: {
    readCompletionRate?: number;
    retentionRate?: number;
    favoriteCount?: number;
    commentCount?: number;
    wordCount?: number;
  };
}

export interface FeedbackSubmitResult {
  stored: boolean;
  analysisTriggered: boolean;
  analysis?: unknown;
}

// ── Genre Profile Templates ───────────────────────────────────────────────

export interface SeedAnalyzerHints {
  coreLoopPatterns?: string[];
  goldenFingerGuidance?: string;
  worldBuildingDirectives?: string;
  namingDefaults?: {
    personNameStyle?: string;
    locationNameStyle?: string;
    abilityNameStyle?: string;
    factionNameStyle?: string;
    itemNameStyle?: string;
    examples?: {
      personNames?: string[];
      locationNames?: string[];
      abilityNames?: string[];
      factionNames?: string[];
    };
    taboos?: string[];
  };
}

export interface RuleAtom {
  id: string;
  category: string;
  title: string;
  content: string;
  priority: number;
  targetAgents: string[];
  outputKey: string;
  conditions?: Array<{ field: string; op: string; value: string | string[] | number | boolean }>;
  tags?: string[];
  isEnabled: boolean;
  source: 'system' | 'genre' | 'user';
}

export interface CachedAgentSections {
  sections: Array<{ agentId: string; key: string; content: string }>;
  ruleAtoms?: RuleAtom[];
}

export interface AudienceMeta {
  audienceTags?: string[];
  protagonistFocusTags?: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;
  toneTags?: string[];
  relationshipDensity?: 'low' | 'medium' | 'high';
  hardConstraints?: string[];
  softPreferences?: string[];
}

export interface GenreProfileTemplate {
  id: string;
  userId: string | null;
  genreKey: string;
  displayName: string;
  description: string;
  genreKeywords: string[];
  profileJson: Record<string, unknown>;
  seedHints: SeedAnalyzerHints | null;
  ruleAtoms: RuleAtom[];
  cachedAgentSections: CachedAgentSections | null;
  audienceTags: string[];
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;
  toneTags: string[];
  relationshipDensity: 'low' | 'medium' | 'high';
  hardConstraints: string[];
  softPreferences: string[];
  isSystem: boolean;
  parentTemplateId: string | null;
  systemVersion: number;
  syncedSystemVersion: number;
  isUserModified: boolean;
  hasSystemUpdate?: boolean; // list 接口附加字段
  createdAt: string;
  updatedAt: string;
}

export interface CreateGenreTemplateParams {
  genreKey: string;
  displayName: string;
  description?: string;
  genreKeywords?: string[];
  profileJson: Record<string, unknown>;
  seedHints?: SeedAnalyzerHints;
  ruleAtoms?: RuleAtom[];
  cachedAgentSections?: CachedAgentSections;
  audienceMeta?: AudienceMeta;
}

export interface UpdateGenreTemplateParams {
  displayName?: string;
  description?: string;
  genreKeywords?: string[];
  profileJson?: Record<string, unknown>;
  seedHints?: SeedAnalyzerHints;
  ruleAtoms?: RuleAtom[];
  cachedAgentSections?: CachedAgentSections;
  audienceMeta?: AudienceMeta;
}

export interface AiGenerateProfileParams {
  genreName: string;
  styleDescription?: string;
  referenceWorks?: string[];
  targetAudience?: string;
  baseTemplateId?: string;
}

export interface AiGenerateProfileResult {
  profileJson: Record<string, unknown>;
  seedHints: SeedAnalyzerHints;
  ruleAtoms: RuleAtom[];
  cachedAgentSections: CachedAgentSections | null;
}

export async function listGenreTemplates(): Promise<GenreProfileTemplate[]> {
  return request(`${BASE}/genre-templates`);
}

export async function getGenreTemplate(id: string): Promise<GenreProfileTemplate> {
  return request(`${BASE}/genre-templates/${id}`);
}

export async function createGenreTemplate(data: CreateGenreTemplateParams): Promise<GenreProfileTemplate> {
  return request(`${BASE}/genre-templates`, { method: 'POST', data });
}

export async function updateGenreTemplate(id: string, data: UpdateGenreTemplateParams): Promise<GenreProfileTemplate> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'PUT', data });
}

export async function deleteGenreTemplate(id: string): Promise<{ success: boolean }> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'DELETE' });
}

export async function cloneGenreTemplate(id: string): Promise<GenreProfileTemplate> {
  return request(`${BASE}/genre-templates/${id}/clone`, { method: 'POST' });
}

export async function aiGenerateProfile(data: AiGenerateProfileParams): Promise<AiGenerateProfileResult> {
  return request(`${BASE}/genre-templates/ai-generate`, { method: 'POST', data });
}

export async function getGenreTemplateSystemDiff(id: string): Promise<{ userTemplate: GenreProfileTemplate; systemTemplate: GenreProfileTemplate } | null> {
  return request(`${BASE}/genre-templates/${id}/system-diff`);
}

export async function syncGenreTemplateFromSystem(id: string): Promise<GenreProfileTemplate> {
  return request(`${BASE}/genre-templates/${id}/sync-system`, { method: 'POST' });
}

// ── Reader Feedback ───────────────────────────────────────────────────────

export async function submitChapterFeedback(bookId: string, payload: SubmitFeedbackPayload): Promise<FeedbackSubmitResult> {
  return request(`${BASE}/books/${bookId}/feedback`, { method: 'POST', data: payload });
}

export async function triggerFeedbackAnalysis(bookId: string): Promise<unknown> {
  return request(`${BASE}/books/${bookId}/feedback/analyze`, { method: 'POST' });
}

export async function getFeedbackState(bookId: string): Promise<unknown> {
  return request(`${BASE}/books/${bookId}/feedback`);
}
