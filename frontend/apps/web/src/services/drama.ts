/** 短剧引擎 API */
import { request } from '@umijs/max';
import { getToken } from '@/services/auth';


export interface CreateDramaParams {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  titleHint?: string;
  mainStoryGoal?: string;
  platformTarget?: 'douyin' | 'kuaishou' | 'hongguo' | 'wechat_mini' | 'bilibili'
    | 'tencent_video' | 'mango_tv' | 'iqiyi' | 'reelshort' | 'dramabox' | 'generic';
  aspectRatio?: '9:16' | '16:9';
  targetEpisodeDurationSec?: number;
  plannedMinEpisodes?: number;
  plannedMaxEpisodes?: number;
  genreTemplateId?: string;
  visualStyleTemplateId?: string; // 指定视觉风格模板 ID（与 drama_visual_style_templates 关联）
  visualStyleHint?: string; // 视觉风格提示（如"真人影视""2D 动漫""水墨古风"）
  suggestedVisualStyle?: string; // 视觉风格枚举值（如 period_live / live_action / 2d_anime）
  imageResolution?: '1k' | '2k' | '4k';
  videoResolution?: '720p' | '1080p' | '4k';
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
  assetType: 'character' | 'location' | 'style_guide' | 'prop';
  refId: string;
  name: string;
  data: Record<string, unknown>;
  referenceImageUrl: string;
  referenceImages?: Array<{ viewAngle: string; imageUrl: string }>;
  createdAt: string;
}

export type VisualAssetRefineSyncScope = 'single' | 'group' | 'all';
export type VisualAssetRefineStrength = 'light' | 'balanced' | 'strong';

export interface RefineVisualAssetParams {
  instruction: string;
  viewAngle?: string;
  syncScope?: VisualAssetRefineSyncScope;
  strength?: VisualAssetRefineStrength;
  preserveIdentity?: boolean;
}

export interface RefineVisualAssetResult {
  asset: VisualAssetItem;
  affectedViews: string[];
}

export interface DramaUsageBucket {
  /** 后端聚合总费用（SUM(cost_cny)），作为总费用的权威来源 */
  costCny: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCostCny: number;
  imageCalls: number;
  imageCostCny: number;
  videoCalls: number;
  videoCostCny: number;
  ttsCalls: number;
  ttsCostCny: number;
  embeddingCalls: number;
  embeddingTokens: number;
  embeddingCostCny: number;
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
  currency: 'CNY';
  creation: DramaUsageBucket & { steps: DramaUsageStep[] };
  episodes: DramaEpisodeUsage[];
  total: DramaUsageBucket;
}

export async function createDrama(data: CreateDramaParams): Promise<{ dramaId: string }> {
  return request('/drama', { method: 'POST', data });
}

/** 重试失败的创建流程，从上次 checkpoint 继续 */
export async function retryCreateDrama(dramaId: string): Promise<{ dramaId: string }> {
  return request(`/drama/${dramaId}/retry-create`, { method: 'POST' });
}

export async function enhanceDramaIdea(idea: string, genre?: string): Promise<{ enhanced: string; highlights: string[] }> {
  return request(`/drama/idea/enhance`, { method: 'POST', data: { idea, genre } });
}

export async function generateDramaGoal(mainIdea: string, genre: string, targetAudience: string): Promise<{ goal: string; alternatives: string[] }> {
  return request(`/drama/idea/generate-goal`, { method: 'POST', data: { mainIdea, genre, targetAudience } });
}

export async function recommendGenreAndAudience(mainIdea: string): Promise<{
  genreDisplayName: string; platformTarget: string; targetAudience: string; protagonistFocus: string;
  suggestedVisualStyle?: string; aspectRatio?: '9:16' | '16:9';
  targetEpisodeDurationSec?: number; plannedEpisodes?: { min: number; max: number };
  reason?: string;
}> {
  return request(`/drama/idea/recommend-genre-audience`, { method: 'POST', data: { mainIdea } });
}

export async function listDramas(): Promise<{ dramas: DramaListItem[] }> {
  return request('/drama');
}

export async function deleteDrama(dramaId: string): Promise<{ success: boolean }> {
  return request(`/drama/${dramaId}`, { method: 'DELETE' });
}

export async function getDrama(dramaId: string): Promise<Record<string, unknown>> {
  return request(`/drama/${dramaId}`);
}

export interface VisualStyleGuideUpdate {
  overallAesthetic: string;
  colorGrading: string;
  lightingStyle: string;
  era: string;
  renderTechnique?: string;
  textureStyle?: string;
  referenceStyle?: string;
  styleReferencePrompt?: string;
}

export async function updateDramaVisualStyle(
  dramaId: string,
  visualStyle: VisualStyleGuideUpdate,
): Promise<{ success: boolean }> {
  return request(`/drama/${dramaId}/visual-style`, { method: 'PATCH', data: { visualStyle } });
}

export async function getDramaUsage(dramaId: string): Promise<DramaUsageSummary> {
  return request(`/drama/${dramaId}/usage`);
}

export interface DbRunningItem {
  runId: string;
  episodeNumber: number;
  lastCheckpoint: string;
  isActive: boolean;       // true = 心跳在 60s 内，服务器仍在运行
  heartbeatAgeMs: number;
  startedAt: string;
  progressPct: number;     // 0-100，基于 checkpoint 推算
  stepLabel: string;       // 中文步骤名
  status?: string;         // running / failed / interrupted
  errorMessage?: string;   // 失败原因（仅 status=failed 时有值）
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
  return request(`/drama/${dramaId}/generation-status`);
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
  return request(`/drama/${dramaId}/executions?${params.toString()}`);
}

export async function getRunStepOutputs(dramaId: string, runId: string): Promise<{ stepOutputs: Record<string, unknown> }> {
  return request(`/drama/${dramaId}/executions/${runId}/step-outputs`);
}

export async function patchRunStepOutput(dramaId: string, runId: string, stepName: string, body: Record<string, unknown>): Promise<{ success: boolean }> {
  return request(`/drama/${dramaId}/executions/${runId}/step-outputs/${stepName}`, { method: 'PATCH', data: body });
}

export async function generateEpisodes(dramaId: string): Promise<{ message: string }> {
  return request(`/drama/${dramaId}/episodes/generate`, { method: 'POST' });
}

export async function pauseEpisodeGeneration(dramaId: string): Promise<{ paused: boolean; message: string }> {
  return request(`/drama/${dramaId}/episodes/pause`, { method: 'POST' });
}

export async function resumeEpisodeGeneration(dramaId: string): Promise<{ message: string }> {
  return request(`/drama/${dramaId}/episodes/resume`, { method: 'POST' });
}

export async function listEpisodes(dramaId: string): Promise<{ episodes: EpisodeListItem[] }> {
  return request(`/drama/${dramaId}/episodes`);
}

export async function getEpisode(dramaId: string, episodeNumber: number): Promise<Record<string, unknown> & { shotMedia?: any[] }> {
  return request(`/drama/${dramaId}/episodes/${episodeNumber}`);
}

export async function getVisualAssets(dramaId: string): Promise<{ assets: VisualAssetItem[] }> {
  return request(`/drama/${dramaId}/visual-assets`);
}

export async function regenerateVisualAssetImage(
  dramaId: string,
  assetId: string,
  opts?: { viewAngle?: string },
): Promise<VisualAssetItem> {
  return request(`/drama/${dramaId}/visual-assets/${assetId}/regenerate`, {
    method: 'POST',
    data: opts?.viewAngle ? { viewAngle: opts.viewAngle } : undefined,
  });
}

export async function regenerateVariationImage(
  dramaId: string,
  assetId: string,
  variationId: string,
): Promise<VisualAssetItem> {
  return request(`/drama/${dramaId}/visual-assets/${assetId}/variation/${variationId}/regenerate`, {
    method: 'POST',
  });
}

export async function refineVisualAssetImage(
  dramaId: string,
  assetId: string,
  data: RefineVisualAssetParams,
): Promise<RefineVisualAssetResult> {
  return request(`/drama/${dramaId}/visual-assets/${assetId}/refine-image`, {
    method: 'POST',
    data,
  });
}

/* ─── SSE URLs ─── */

export type DramaSseType = 'heartbeat' | 'progress' | 'result' | 'error' | 'info';
export type DramaRunType = 'create' | 'episode' | 'media' | 'images' | 'assets';
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
  return `/api/drama/${dramaId}/create-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getGenerateEpisodeSseUrl(dramaId: string): string {
  const token = getToken();
  return `/api/drama/${dramaId}/episode-generate-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getGenerateAllAssetsSseUrl(dramaId: string): string {
  const token = getToken();
  return `/api/drama/${dramaId}/visual-assets/generate-all-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export async function generateAllVisualAssets(dramaId: string): Promise<void> {
  return request(`/drama/${dramaId}/visual-assets/generate-all`, { method: 'POST' });
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
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/shots/${shotId}`, { method: 'PATCH', data: patch });
}

export async function generateEpisodeMedia(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: string; videoUrl?: string }> {
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/generate-media`, { method: 'POST' });
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
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/reset-problem-shots${qs ? `?${qs}` : ''}`, { method: 'POST' });
}

export async function getEpisodeMediaStatus(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: string; videoUrl?: string; shotMedia?: any[] }> {
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/media-status`);
}

export function getGenerateMediaSseUrl(dramaId: string, episodeNumber: number): string {
  const token = getToken();
  return `/api/drama/${dramaId}/episodes/${episodeNumber}/generate-media-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 批量生成单集全部分镜图（仅 T2I Phase 0，不生成视频），SSE 流式推送进度 */
export function getGenerateImagesSseUrl(dramaId: string, episodeNumber: number): string {
  const token = getToken();
  return `/api/drama/${dramaId}/episodes/${episodeNumber}/generate-images-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 单镜图片生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
export async function generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/shots/${shotId}/generate-image`, { method: 'POST' });
}

/** 单镜视频生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
export async function generateShotVideo(dramaId: string, episodeNumber: number, shotId: string): Promise<{ videoUrl: string; status: string }> {
  return request(`/drama/${dramaId}/episodes/${episodeNumber}/shots/${shotId}/generate-video`, { method: 'POST' });
}

export function getEpisodeProgressSseUrl(dramaId: string): string {
  const token = getToken();
  return `/api/drama/${dramaId}/episode-progress-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
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
  profileJson: Record<string, unknown> | null;
  audienceTags: string[];
  protagonistFocusTags: string[];
  toneTags: string[];
  platformTags: string[];
  isSystem: boolean;
  isUserModified: boolean;
  parentTemplateId: string | null;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenreAnalytics {
  genre: string;
  totalDramas: number;
  avgScore: number | null;
  avgEpisodes: number;
  recentCount30d: number;
  recommendScore: number;
}

export async function getGenreAnalytics(): Promise<GenreAnalytics[]> {
  return request(`/drama/genre-templates/analytics`);
}

/* ─── 市场数据（爬虫） ─── */

export interface MarketGenreTrend {
  genre: string;
  totalEntries: number;
  avgHotScore: number;
  maxHotScore: number;
  top3Titles: string[];
  recentGrowth: number;
  paidRatio: number;
}

export interface MarketTopDrama {
  title: string;
  platform: string;
  genre: string;
  hotScore: number;
  rankPosition: number;
  rankCategory: string;
}

export interface MarketSnapshot {
  date: string;
  totalEntries: number;
  platforms: Record<string, number>;
  topGenres: MarketGenreTrend[];
  topDramas: MarketTopDrama[];
}

export async function getMarketSnapshot(date?: string): Promise<MarketSnapshot> {
  const params = date ? `?date=${date}` : '';
  return request(`/drama/market/snapshot${params}`);
}

export async function getMarketRecommendedGenres(): Promise<Array<{
  genre: string;
  hotScore: number;
  count: number;
  topTitles: string[];
  platforms: string[];
}>> {
  return request(`/drama/market/recommended-genres`);
}

export interface CreationRecommendations {
  suggestedGenres: Array<{ genre: string; count: number; hotScore: number; topTitles: string[] }>;
  styleHints: string[];
  topicTrends: string[];
  hotDramaReferences: string[];
  summary: string;
  dataDate: string;
}

export async function getCreationRecommendations(): Promise<CreationRecommendations> {
  return request(`/drama/market/creation-recommendations`);
}

export async function triggerMarketCrawl(): Promise<{ inserted: number; updated: number; errors: string[] }> {
  return request(`/drama/market/crawl`, { method: 'POST' });
}

export async function listDramaGenreTemplates(): Promise<DramaGenreTemplate[]> {
  return request(`/drama/genre-templates/list`);
}

export async function getDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates/${id}`);
}

export async function createDramaGenreTemplate(data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates`, { method: 'POST', data });
}

export async function updateDramaGenreTemplate(id: string, data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates/${id}`, { method: 'PUT', data });
}

export async function deleteDramaGenreTemplate(id: string): Promise<{ success: boolean }> {
  return request(`/drama/genre-templates/${id}`, { method: 'DELETE' });
}

export async function cloneDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates/${id}/clone`, { method: 'POST' });
}

// ─── Pipeline / 提示词工坊 ────────────────────────────────────────────────────

export interface DramaAgentNodeConfig {
  id: string;
  type: string;
  label: string;
  description: string;
  isEnabled: boolean;
  isDeletable: boolean;
  isCore: boolean;
  position: number;
  additionalSystemPrompt: string;
  /** 用户固定编辑后的基础提示词快照，存在时替代代码自动生成的 basePrompt */
  basePromptSnapshot?: string;
  customConfig?: { systemPrompt?: string; temperature?: number };
}

export interface DramaWorkflowParams {
  maxEditRounds?: number;
  maxContinuityRetries?: number;
  qualityPassScore?: number;
  enableDialogueCoach?: boolean;
  enablePacingAnalyzer?: boolean;
  enableHookCrafter?: boolean;
  pauseAfterScript?: boolean;
  pauseAfterStoryboard?: boolean;
}

export interface DramaPipeline {
  dramaId: string;
  draftNodes: DramaAgentNodeConfig[];
  publishedNodes: DramaAgentNodeConfig[] | null;
  publishedAt: string | null;
  workflowParams: DramaWorkflowParams | null;
  hasDraft: boolean; // draft !== published (from backend)
}

export async function getDramaPipeline(dramaId: string): Promise<DramaPipeline> {
  return request(`/drama/${dramaId}/pipeline`);
}

export async function saveDramaPipelineDraft(dramaId: string, nodes: DramaAgentNodeConfig[]): Promise<DramaPipeline> {
  return request(`/drama/${dramaId}/pipeline/draft`, { method: 'PUT', data: { nodes } });
}

export async function publishDramaPipeline(dramaId: string): Promise<DramaPipeline> {
  return request(`/drama/${dramaId}/pipeline/publish`, { method: 'POST' });
}

export async function saveDramaWorkflowParams(dramaId: string, params: Partial<DramaWorkflowParams>): Promise<DramaPipeline> {
  return request(`/drama/${dramaId}/pipeline/params`, { method: 'PUT', data: params });
}

export async function getDramaNodePreview(dramaId: string, nodeId: string): Promise<{ nodeId: string; basePrompt: string }> {
  return request(`/drama/${dramaId}/pipeline/node-preview/${nodeId}`);
}

export interface AiGenerateDramaTemplateParams {
  genreName: string;
  styleDescription?: string;
  referenceWorks?: string[];
  targetAudience?: string;
  platformTarget?: string;
}

export async function aiGenerateDramaTemplate(data: AiGenerateDramaTemplateParams): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates/ai-generate`, { method: 'POST', data });
}

/* ─── 视觉风格模板 ─── */

export interface VisualStyleGuide {
  overallAesthetic: string;
  colorGrading: string;
  lightingStyle: string;
  era: string;
  renderTechnique?: string;
  textureStyle?: string;
  referenceStyle?: string;
  styleReferencePrompt?: string;
}

export interface VisualPromptGuidance {
  positiveKeywords?: string[];
  negativeKeywords?: string[];
  characterStyle?: string;
  backgroundStyle?: string;
}

export type VisualStyleCategory = 'live_action' | '2d_animation' | '3d_animation' | 'stop_motion' | 'chinese_traditional' | '2d_art';

export interface DramaVisualStyleTemplate {
  id: string;
  userId: string | null;
  styleKey: string;
  displayName: string;
  description: string;
  styleCategory: VisualStyleCategory;
  tags: string[];
  visualGuide: VisualStyleGuide;
  promptGuidance: VisualPromptGuidance | null;
  genreCompatibility: string[];
  audienceTags: string[];
  platformTags: string[];
  isSystem: boolean;
  parentTemplateId: string | null;
  coverUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export async function listDramaVisualStyleTemplates(): Promise<DramaVisualStyleTemplate[]> {
  return request(`/drama/visual-style-templates/list`);
}

export async function getDramaVisualStyleTemplate(id: string): Promise<DramaVisualStyleTemplate> {
  return request(`/drama/visual-style-templates/${id}`);
}

export async function createDramaVisualStyleTemplate(data: Partial<DramaVisualStyleTemplate>): Promise<DramaVisualStyleTemplate> {
  return request(`/drama/visual-style-templates`, { method: 'POST', data });
}

export async function updateDramaVisualStyleTemplate(id: string, data: Partial<DramaVisualStyleTemplate>): Promise<DramaVisualStyleTemplate> {
  return request(`/drama/visual-style-templates/${id}`, { method: 'PUT', data });
}

export async function deleteDramaVisualStyleTemplate(id: string): Promise<{ success: boolean }> {
  return request(`/drama/visual-style-templates/${id}`, { method: 'DELETE' });
}

export async function cloneDramaVisualStyleTemplate(id: string): Promise<DramaVisualStyleTemplate> {
  return request(`/drama/visual-style-templates/${id}/clone`, { method: 'POST' });
}


/** 单独更新题材模板中某个 Agent 的系统提示词 */
export async function updateDramaAgentPrompt(
  templateId: string,
  agentType: string,
  systemPrompt: string,
): Promise<DramaGenreTemplate> {
  return request(`/drama/genre-templates/${templateId}/agent-prompts`, {
    method: 'POST',
    data: { agentType, systemPrompt },
  });
}

/**
 * 重新 bake 已有短剧的逐集阶段 pipeline 提示词快照。
 * 适用场景：用户修改了题材模板的 agentSystemPrompts 后，希望让更改对某部已创建的短剧生效。
 * 此操作会重新解析 profile/strategy/visualStyle 等上下文并覆盖 publishedNodes 的 basePromptSnapshot。
 */
export async function rebakeDramaPrompts(dramaId: string): Promise<{ success: boolean; message: string }> {
  return request(`/drama/${dramaId}/pipeline/rebake`, { method: 'POST' });
}

// ── System Config ──
export async function listDramaSystemAgents() {
  return request<{
    id: string;
    label: string;
    desc: string;
    agents: { key: string; taskKey: string; name: string; desc: string }[];
  }[]>('/drama/system/agents', { method: 'GET' });
}
