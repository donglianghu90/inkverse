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
}

export interface BatchGenerateParams {
  chapterCount: number;
  maxRepairRounds?: number;
  stopWhenLowQuality?: boolean;
  strictQuality?: boolean;
  minQualityScore?: number;
  minOverallScore?: number;
}

export interface AutoSerializationConfig {
  dailyStartTime: string;
  chaptersPerRun: number;
  maxRepairRounds?: number;
  strictQuality?: boolean;
  stopWhenLowQuality?: boolean;
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

export interface CreateBookResult {
  bookId: string;
  title: string;
  chapterCursor: number;
  outline: Record<string, unknown>;
}

export interface BookInfo {
  bookId: string;
  title: string;
  genre: string;
  chapterCursor: number;
  chaptersGenerated: number;
  hasBible: boolean;
  openPlotThreads: string[];
  latestKpi: { qualityScore: number; overallScore: number } | null;
}

export interface ChapterItem {
  bookId: string;
  chapterNumber: number;
  title: string;
  content: string;
  createdAt: string;
}

export interface ChapterGenerateResult {
  chapterNumber: number;
  title: string;
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
  qualityPolicy: {
    maxRepairRounds: number;
    strictQuality: boolean;
    stopWhenLowQuality: boolean;
    minQualityScore: number;
    minOverallScore: number;
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
  roughOutline: {
    points: Array<{ phase: string; description: string; tentativeChapterRange: string }>;
    endingDirection: string;
  };
  chapterSummaries: Array<{ chapterNumber: number; summary: string }>;
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
