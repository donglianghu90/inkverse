/** 短剧引擎 API */
import { request } from '@umijs/max';
import { getToken } from '@/services/auth';

const BASE = '/api/drama';

export interface CreateDramaParams {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  titleHint?: string;
  mainStoryGoal?: string;
  platformTarget?: 'douyin' | 'kuaishou' | 'reelshort' | 'dramabox' | 'generic';
  aspectRatio?: '9:16' | '16:9';
  targetEpisodeDurationSec?: number;
  plannedMinEpisodes?: number;
  plannedMaxEpisodes?: number;
  genreTemplateId?: string;
  visualStyleHint?: string; // 视觉风格提示（如"真人影视""2D 动漫""水墨古风"）
  generationMode?: 'fast' | 'balanced' | 'quality';
}

export interface DramaListItem {
  id: string;
  userId: string;
  title: string;
  genre: string;
  episodesGenerated: number;
  latestOverallScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeListItem {
  id: string;
  dramaId: string;
  episodeNumber: number;
  title: string;
  overallScore: number | null;
  totalDurationSec: number;
  shotCount: number;
  mediaStatus?: string;
  videoUrl?: string;
  createdAt: string;
}

export interface VisualAssetItem {
  id: string;
  dramaId: string;
  assetType: 'character' | 'location' | 'style_guide';
  refId: string;
  name: string;
  data: Record<string, unknown>;
  referenceImageUrl: string;
  referenceImages?: Array<{ viewAngle: string; imageUrl: string }>;
  createdAt: string;
}

export interface DramaUsageBucket {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCostUsd: number;
  imageCalls: number;
  imageCostUsd: number;
  videoCalls: number;
  videoCostUsd: number;
  apiSuccessCalls: number;
  apiFailedCalls: number;
}

export interface DramaUsageStep extends DramaUsageBucket {
  step: string;
}

export interface DramaEpisodeUsage extends DramaUsageBucket {
  episodeNumber: number;
  steps: DramaUsageStep[];
}

export interface DramaUsageSummary {
  dramaId: string;
  currency: 'USD';
  creation: DramaUsageBucket & { steps: DramaUsageStep[] };
  episodes: DramaEpisodeUsage[];
  total: DramaUsageBucket;
}

export async function createDrama(data: CreateDramaParams): Promise<{ dramaId: string }> {
  return request(BASE, { method: 'POST', data });
}

/** 重试失败的创建流程，从上次 checkpoint 继续 */
export async function retryCreateDrama(dramaId: string): Promise<{ dramaId: string }> {
  return request(`${BASE}/${dramaId}/retry-create`, { method: 'POST' });
}

export async function enhanceDramaIdea(idea: string, genre?: string): Promise<{ enhanced: string; highlights: string[] }> {
  return request(`${BASE}/idea/enhance`, { method: 'POST', data: { idea, genre } });
}

export async function generateDramaGoal(mainIdea: string, genre: string, targetAudience: string): Promise<{ goal: string; alternatives: string[] }> {
  return request(`${BASE}/idea/generate-goal`, { method: 'POST', data: { mainIdea, genre, targetAudience } });
}

export async function recommendGenreAndAudience(mainIdea: string): Promise<{ genreDisplayName: string; platformTarget: string; targetAudience: string; protagonistFocus: string; reason?: string }> {
  return request(`${BASE}/idea/recommend-genre-audience`, { method: 'POST', data: { mainIdea } });
}

export async function listDramas(): Promise<{ dramas: DramaListItem[] }> {
  return request(BASE);
}

export async function getDrama(dramaId: string): Promise<Record<string, unknown>> {
  return request(`${BASE}/${dramaId}`);
}

export async function getDramaUsage(dramaId: string): Promise<DramaUsageSummary> {
  return request(`${BASE}/${dramaId}/usage`);
}

export interface DbRunningItem {
  episodeNumber: number;
  lastCheckpoint: string;
  isActive: boolean;       // true = 心跳在 60s 内，服务器仍在运行
  heartbeatAgeMs: number;
  startedAt: string;
  progressPct: number;     // 0-100，基于 checkpoint 推算
  stepLabel: string;       // 中文步骤名
}

export interface GenerationStatus {
  episode: { generating: boolean; paused: boolean; startedAt: number | null; lastStep: string | null; progress: number };
  dbRunning: DbRunningItem[];
}

export interface DramaExecutionSkippedStep {
  stepKey?: string;
  nodeId?: string;
  skipReason?: string;
  message?: string;
}

export interface DramaExecutionListItem {
  id: string;
  episodeNumber: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted' | string;
  lastCheckpoint: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  summary?: Record<string, unknown>;
  skippedSteps: DramaExecutionSkippedStep[];
  skippedCount: number;
}

export async function getGenerationStatus(dramaId: string): Promise<GenerationStatus> {
  return request(`${BASE}/${dramaId}/generation-status`);
}

export async function listDramaExecutions(
  dramaId: string,
  opts?: { latestPerEpisode?: boolean; limit?: number; includeCreation?: boolean },
): Promise<{ executions: DramaExecutionListItem[] }> {
  const latestPerEpisode = opts?.latestPerEpisode ?? true;
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 40));
  const includeCreation = opts?.includeCreation ?? false;
  const params = new URLSearchParams({
    latestPerEpisode: String(latestPerEpisode),
    limit: String(limit),
    includeCreation: String(includeCreation),
  });
  return request(`${BASE}/${dramaId}/executions?${params.toString()}`);
}

export async function generateEpisodes(dramaId: string, count = 1): Promise<{ message: string }> {
  return request(`${BASE}/${dramaId}/episodes/generate?count=${count}`, { method: 'POST' });
}

export async function pauseEpisodeGeneration(dramaId: string): Promise<{ paused: boolean; message: string }> {
  return request(`${BASE}/${dramaId}/episodes/pause`, { method: 'POST' });
}

export async function resumeEpisodeGeneration(dramaId: string): Promise<{ message: string }> {
  return request(`${BASE}/${dramaId}/episodes/resume`, { method: 'POST' });
}

export async function listEpisodes(dramaId: string): Promise<{ episodes: EpisodeListItem[] }> {
  return request(`${BASE}/${dramaId}/episodes`);
}

export async function getEpisode(dramaId: string, episodeNumber: number): Promise<Record<string, unknown>> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}`);
}

export async function getVisualAssets(dramaId: string): Promise<{ assets: VisualAssetItem[] }> {
  return request(`${BASE}/${dramaId}/visual-assets`);
}

/* ─── SSE URLs ─── */

export type DramaSseType = 'heartbeat' | 'progress' | 'result' | 'error' | 'info';
export type DramaRunType = 'create' | 'episode' | 'media' | 'images';
export type DramaTerminalStatus = 'success' | 'failed' | 'paused';

export interface DramaSseEvent {
  _type: DramaSseType;
  runType: DramaRunType;
  runId: string;
  seq: number;
  ts: number;
  dramaId: string;
  episodeNumber?: number;
  step?: string;
  stepKey?: string;
  nodeId?: string;
  stepIndex?: number;
  totalSteps?: number;
  message?: string;
  done?: boolean;
  skipped?: boolean;
  skipReason?: string;
  terminal?: boolean;
  terminalStatus?: DramaTerminalStatus;
  error?: string;
  data?: Record<string, unknown>;
}

export function getCreateDramaSseUrl(dramaId: string): string {
  const token = getToken();
  return `${BASE}/${dramaId}/create-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getGenerateEpisodeSseUrl(dramaId: string, count = 1): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/generate-sse?count=${count}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

export interface ShotPatch {
  visualPrompt?: string;
  specialTechnique?: string | null;
  firstFrameImageUrl?: string | null;
  lastFrameImageUrl?: string | null;
  firstFramePrompt?: string | null;
  lastFramePrompt?: string | null;
  estimatedDurationSec?: number;
  transitionToNext?: string;
  humanEditNote?: string;
  camera?: {
    angle?: string;
    movement?: string;
    composition?: string;
    depthOfField?: string;
  };
}

/** 人工编辑单个 Shot — 标记 isHumanEdited=true，AI 重跑时跳过 */
export async function updateShot(
  dramaId: string,
  episodeNumber: number,
  shotId: string,
  patch: ShotPatch,
): Promise<{ shotId: string; isHumanEdited: true }> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}/shots/${shotId}`, { method: 'PATCH', data: patch });
}

export async function generateEpisodeMedia(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: string; videoUrl?: string }> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}/generate-media`, { method: 'POST' });
}

export interface ResetProblemShotsResult {
  episodeNumber: number;
  totalShots: number;
  problemShotIds: string[];
  resetCount: number;
}

export type ResetFixTarget = 'all' | 'identity' | 'style' | 'camera' | 'motion';

export async function resetProblemShots(
  dramaId: string,
  episodeNumber: number,
  opts?: { includeReviewRisks?: boolean; onlyHighPriority?: boolean; fixTarget?: ResetFixTarget },
): Promise<ResetProblemShotsResult> {
  const params = new URLSearchParams();
  if (opts?.includeReviewRisks !== undefined) params.set('includeReviewRisks', String(opts.includeReviewRisks));
  if (opts?.onlyHighPriority !== undefined) params.set('onlyHighPriority', String(opts.onlyHighPriority));
  if (opts?.fixTarget !== undefined) params.set('fixTarget', String(opts.fixTarget));
  const qs = params.toString();
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}/reset-problem-shots${qs ? `?${qs}` : ''}`, { method: 'POST' });
}

export async function getEpisodeMediaStatus(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: string; videoUrl?: string; shotMediaMap?: Record<string, unknown> }> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}/media-status`);
}

export function getGenerateMediaSseUrl(dramaId: string, episodeNumber: number): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/${episodeNumber}/generate-media-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 批量生成单集全部分镜图（仅 T2I Phase 0，不生成视频），SSE 流式推送进度 */
export function getGenerateImagesSseUrl(dramaId: string, episodeNumber: number): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/${episodeNumber}/generate-images-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 单镜图片生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
export async function generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}/shots/${shotId}/generate-image`, { method: 'POST' });
}

export function getEpisodeProgressSseUrl(dramaId: string): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/progress-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/* ─── 题材模板 ─── */

export interface DramaGenreTemplate {
  id: string;
  userId: string | null;
  genreKey: string;
  displayName: string;
  description: string;
  genreKeywords: string[];
  seedHints: Record<string, unknown> | null;
  audienceTags: string[];
  protagonistFocusTags: string[];
  toneTags: string[];
  platformTags: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listDramaGenreTemplates(): Promise<DramaGenreTemplate[]> {
  return request(`${BASE}/genre-templates/list`);
}

export async function getDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}`);
}

export async function createDramaGenreTemplate(data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates`, { method: 'POST', data });
}

export async function updateDramaGenreTemplate(id: string, data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'PUT', data });
}

export async function deleteDramaGenreTemplate(id: string): Promise<{ success: boolean }> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'DELETE' });
}

export async function cloneDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}/clone`, { method: 'POST' });
}

export interface AiGenerateDramaTemplateParams {
  genreName: string;
  styleDescription?: string;
  referenceWorks?: string[];
  targetAudience?: string;
  platformTarget?: string;
}

export async function aiGenerateDramaTemplate(data: AiGenerateDramaTemplateParams): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/ai-generate`, { method: 'POST', data });
}
