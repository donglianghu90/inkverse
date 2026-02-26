import { request } from '@umijs/max';

const BASE = '/api/novel';

/* ========== 请求参数 ========== */

export interface CreateBookParams {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  mainStoryGoal: string;
  titleHint?: string;
  targetChapterWordCount?: number;
  plannedMinChapters?: number;
  plannedMaxChapters?: number;
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
}

export interface MiniArcChapterBeat {
  chapterNumber: number;
  role: 'setup' | 'escalation' | 'twist' | 'climax' | 'aftermath' | 'transition';
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

export async function getBookProfile(bookId: string): Promise<BookPromptProfile> {
  return request(`${BASE}/books/${bookId}/profile`);
}

export async function updateBookProfile(
  bookId: string,
  profile: BookPromptProfile,
): Promise<BookPromptProfile> {
  return request(`${BASE}/books/${bookId}/profile`, { method: 'PUT', data: profile });
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
}

export function getGenerateSSEUrl(bookId: string): string {
  return `${BASE}/books/${bookId}/chapters/generate-sse`;
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

export interface PipelineView {
  bookId: string;
  draftNodes: AgentNodeConfig[];
  publishedNodes: AgentNodeConfig[] | null;
  publishedAt: string | null;
  hasDraft: boolean;
}

export async function getPipeline(bookId: string): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline`);
}

export async function savePipelineDraft(
  bookId: string,
  nodes: AgentNodeConfig[],
): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline/draft`, {
    method: 'PUT',
    data: { nodes },
  });
}

export async function publishPipeline(bookId: string): Promise<PipelineView> {
  return request(`${BASE}/books/${bookId}/pipeline/publish`, { method: 'POST' });
}

export function createBookSseUrl(progressChannel: string): string {
  const params = new URLSearchParams({ progressChannel });
  return `${BASE}/books/create-sse?${params.toString()}`;
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

export async function submitChapterFeedback(bookId: string, payload: SubmitFeedbackPayload): Promise<FeedbackSubmitResult> {
  return request(`${BASE}/books/${bookId}/feedback`, { method: 'POST', data: payload });
}

export async function triggerFeedbackAnalysis(bookId: string): Promise<unknown> {
  return request(`${BASE}/books/${bookId}/feedback/analyze`, { method: 'POST' });
}

export async function getFeedbackState(bookId: string): Promise<unknown> {
  return request(`${BASE}/books/${bookId}/feedback`);
}
