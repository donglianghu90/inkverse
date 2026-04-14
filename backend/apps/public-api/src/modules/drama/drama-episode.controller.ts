/** DramaEpisodeController — 集 CRUD、SSE 流、媒体生成、Shot 编辑、视觉资产管理 */
import { Controller, Get, Post, Patch, Param, Body, Query, Req, Sse, MessageEvent, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DramaService } from './drama.service';
import { DramaVisualAssetService } from './drama-visual-asset.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaSseHelper } from './drama-sse.helper';
import { DramaWorkflowExecutionService } from './workflow/drama-workflow-execution.service';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';

@Controller('drama')
export class DramaEpisodeController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly visualAssetService: DramaVisualAssetService,
    private readonly progressService: DramaProgressService,
    private readonly sseHelper: DramaSseHelper,
    private readonly executionService: DramaWorkflowExecutionService,
  ) {}

  private getUserId(req: any, fallback = ''): string {
    return req?.user?.id ?? req?.user?.userId ?? fallback;
  }

  private toBool(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined) return defaultValue;
    const v = value.trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'yes') return true;
    if (v === '0' || v === 'false' || v === 'no') return false;
    return defaultValue;
  }

  private toFixTarget(
    value: string | undefined,
  ): 'all' | 'identity' | 'style' | 'camera' | 'motion' | undefined {
    if (!value) return undefined;
    const v = value.trim().toLowerCase();
    if (v === 'all' || v === 'identity' || v === 'style' || v === 'camera' || v === 'motion') {
      return v;
    }
    return undefined;
  }

  private toExecutionPayload(run: DramaWorkflowExecutionEntity): Record<string, unknown> {
    const summary = (run.summary ?? {}) as Record<string, unknown>;
    const skippedSteps = Array.isArray(summary.skippedSteps)
      ? summary.skippedSteps.filter((s) => !!s && typeof s === 'object')
      : [];
    return {
      id: run.id,
      episodeNumber: run.episodeNumber,
      status: run.status,
      lastCheckpoint: run.lastCheckpoint,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      summary,
      skippedSteps,
      skippedCount: skippedSteps.length,
    };
  }

  /* ─── 集 CRUD ─── */

  @Post(':dramaId/retry-create')
  async retryCreation(@Param('dramaId') dramaId: string) {
    await this.dramaService.retryCreation(dramaId);
    return { dramaId };
  }

  @Post(':dramaId/episodes/generate')
  async generateEpisode(@Param('dramaId') dramaId: string) {
    return this.dramaService.generateEpisodes(dramaId);
  }

  @Post(':dramaId/episodes/pause')
  async pauseGeneration(@Param('dramaId') dramaId: string) {
    const ok = await this.dramaService.pauseGeneration(dramaId);
    return { paused: ok, message: ok ? '暂停请求已发送，当前集完成后将暂停' : '该短剧当前没有正在进行的生成任务' };
  }

  @Post(':dramaId/episodes/resume')
  async resumeGeneration(@Param('dramaId') dramaId: string) {
    await this.dramaService.resumeGeneration(dramaId);
    return { message: '暂停标记已清除，可重新启动生成' };
  }

  @Get(':dramaId/episodes')
  async listEpisodes(@Param('dramaId') dramaId: string) {
    return this.dramaService.listEpisodes(dramaId);
  }

  @Get(':dramaId/episodes/:episodeNumber')
  async getEpisode(@Param('dramaId') dramaId: string, @Param('episodeNumber') episodeNumber: string) {
    const ep = parseInt(episodeNumber, 10);
    if (!Number.isFinite(ep) || ep < 1) throw new NotFoundException(`无效的集数: ${episodeNumber}`);
    return this.dramaService.getEpisode(dramaId, ep);
  }

  @Get(':dramaId/executions')
  async listExecutions(
    @Param('dramaId') dramaId: string,
    @Query('latestPerEpisode') latestPerEpisode?: string,
    @Query('limit') limit?: string,
    @Query('includeCreation') includeCreation?: string,
  ) {
    const latest = this.toBool(latestPerEpisode, true);
    const includeCreate = this.toBool(includeCreation, false);
    const n = Math.max(1, Math.min(200, parseInt(limit || '40', 10) || 40));
    const runs = latest
      ? await this.executionService.listLatestRunsByEpisode(dramaId, n, includeCreate)
      : await this.executionService.listRuns(dramaId, n);
    const filtered = includeCreate ? runs : runs.filter((r) => r.episodeNumber > 0);
    return { executions: filtered.map((r) => this.toExecutionPayload(r)) };
  }

  @Get(':dramaId/executions/:runId/step-outputs')
  async getRunStepOutputs(@Param('dramaId') dramaId: string, @Param('runId') runId: string) {
    const outputs = await this.executionService.getStepOutputs(runId);
    if (!outputs) throw new NotFoundException('Execution run not found');
    return { stepOutputs: outputs };
  }

  @Patch(':dramaId/executions/:runId/step-outputs/:stepName')
  async patchRunStepOutput(
    @Param('dramaId') dramaId: string,
    @Param('runId') runId: string,
    @Param('stepName') stepName: string,
    @Body() body: Record<string, unknown>,
  ) {
    const ok = await this.executionService.patchStepOutput(runId, stepName, body);
    if (!ok) throw new NotFoundException('Execution run not found or patch failed');
    return { success: true };
  }

  /* ─── 生成状态查询（用于页面重进时判断是否需要重连 SSE）─── */

  @Get(':dramaId/generation-status')
  async getGenerationStatus(@Param('dramaId') dramaId: string) {
    const episode = this.progressService.isGenerating(`${dramaId}:generate`);
    const paused = await this.dramaService.isGenerationPaused(dramaId);
    const dbRunning = await this.executionService.findRunningForDrama(dramaId);
    return { episode: { ...episode, paused }, dbRunning };
  }

  /* ─── SSE: 集生成（触发 + 推送） ─── */

  @Sse(':dramaId/episode-generate-sse')
  generateEpisodeSse(@Param('dramaId') dramaId: string): Observable<MessageEvent> {
    return this.sseHelper.createActiveStream({
      dramaId,
      runType: 'episode',
      mutexKey: `${dramaId}:generate`,
      reconnectMessage: '已重连到正在进行的生成任务',
      executor: () => this.dramaService.generateEpisodesAndWait(dramaId),
      successMessage: '集生成完成',
      failMessage: '集生成失败',
    });
  }

  /* ─── SSE: 集生成进度订阅（仅接收，不触发，用于页面刷新后的安全重连）─── */

  @Sse(':dramaId/episode-progress-sse')
  episodeProgressSse(@Param('dramaId') dramaId: string): Observable<MessageEvent> {
    return this.sseHelper.createPassiveStream({ dramaId, runType: 'episode' });
  }

  /* ─── SSE: 创建进度 ─── */

  @Sse(':dramaId/create-sse')
  createDramaSse(@Param('dramaId') dramaId: string): Observable<MessageEvent> {
    return this.sseHelper.createPassiveStream({ dramaId, runType: 'create' });
  }

  /* ─── 视觉资产 ─── */

  @Get(':dramaId/visual-assets')
  async getVisualAssets(@Param('dramaId') dramaId: string) {
    return this.dramaService.getVisualAssets(dramaId);
  }

  /** 批量生成该短剧全部参考图，SSE 推送进度（runType='assets'） */
  @Sse(':dramaId/visual-assets/generate-all-sse')
  generateAllAssetsSse(
    @Param('dramaId') dramaId: string,
    @Req() req: any,
  ): Observable<MessageEvent> {
    return this.sseHelper.createActiveStream({
      dramaId,
      runType: 'assets',
      mutexKey: `${dramaId}:assets`,
      reconnectMessage: '参考图生成已在进行中',
      executor: () => this.visualAssetService.generateAllVisualAssets(dramaId, this.getUserId(req, 'anonymous')),
      successMessage: '参考图生成完成',
      failMessage: '参考图生成失败',
    });
  }

  /** LLM 自动修复指定角色的 faceReferencePrompt */
  @Post(':dramaId/characters/:characterId/redesign-face-prompt')
  async redesignCharacterFacePrompt(
    @Param('dramaId') dramaId: string,
    @Param('characterId') characterId: string,
    @Req() req: any,
  ) {
    return this.visualAssetService.redesignCharacterFacePrompt(dramaId, characterId, req.user?.id);
  }

  /** 手动编辑指定角色的文本字段 */
  @Patch(':dramaId/characters/:characterId')
  async patchCharacter(
    @Param('dramaId') dramaId: string,
    @Param('characterId') characterId: string,
    @Body() body: {
      faceReferencePrompt?: string;
      faceDescription?: string;
      bodyTypePrompt?: string;
      hairStylePrompt?: string;
      defaultCostumePrompt?: string;
      defaultCostume?: string;
      distinguishingFeatures?: string;
    },
  ) {
    return this.visualAssetService.patchCharacter(dramaId, characterId, body);
  }

  @Post(':dramaId/visual-assets/:assetId/variation/:variationId/regenerate')
  async regenerateVariationImage(
    @Param('dramaId') dramaId: string,
    @Param('assetId') assetId: string,
    @Param('variationId') variationId: string,
    @Req() req?: any,
  ) {
    return this.visualAssetService.regenerateVariationImage(dramaId, assetId, variationId, this.getUserId(req, 'anonymous'));
  }

  @Post(':dramaId/visual-assets/:assetId/regenerate')
  async regenerateAssetImage(
    @Param('dramaId') dramaId: string,
    @Param('assetId') assetId: string,
    @Body() body?: { viewAngle?: string },
    @Req() req?: any,
  ) {
    return this.visualAssetService.regenerateAssetImage(dramaId, assetId, this.getUserId(req, 'anonymous'), {
      viewAngle: body?.viewAngle,
    });
  }

  @Post(':dramaId/visual-assets/:assetId/refine-image')
  async refineAssetImage(
    @Param('dramaId') dramaId: string,
    @Param('assetId') assetId: string,
    @Body() body?: {
      instruction?: string;
      viewAngle?: string;
      syncScope?: 'single' | 'group' | 'all';
      strength?: 'light' | 'balanced' | 'strong';
      preserveIdentity?: boolean;
    },
    @Req() req?: any,
  ) {
    return this.visualAssetService.refineAssetImage(dramaId, assetId, {
      instruction: String(body?.instruction ?? ''),
      viewAngle: body?.viewAngle,
      syncScope: body?.syncScope,
      strength: body?.strength,
      preserveIdentity: body?.preserveIdentity,
      userId: this.getUserId(req, 'anonymous'),
    });
  }

  /* ─── Shot 编辑 & 媒体生成 ─── */

  /**
   * 人工编辑单个 Shot — 支持局部 patch，标记 isHumanEdited=true 防止 AI 重跑覆盖。
   */
  @Patch(':dramaId/episodes/:episodeNumber/shots/:shotId')
  async updateShot(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
    @Param('shotId') shotId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const episodeNumber = parseInt(ep, 10);
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) throw new NotFoundException(`无效集数: ${ep}`);
    return this.dramaService.updateShot(dramaId, episodeNumber, shotId, body);
  }

  @Post(':dramaId/episodes/:episodeNumber/generate-media')
  async generateEpisodeMedia(@Param('dramaId') dramaId: string, @Param('episodeNumber') ep: string) {
    return this.dramaService.generateEpisodeMedia(dramaId, parseInt(ep, 10));
  }

  @Post(':dramaId/episodes/:episodeNumber/reset-problem-shots')
  async resetProblemShots(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
    @Query('includeReviewRisks') includeReviewRisks?: string,
    @Query('onlyHighPriority') onlyHighPriority?: string,
    @Query('fixTarget') fixTarget?: string,
  ) {
    const episodeNumber = parseInt(ep, 10);
    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) throw new NotFoundException(`无效集数: ${ep}`);
    return this.dramaService.resetProblemShots(dramaId, episodeNumber, {
      includeReviewRisks: this.toBool(includeReviewRisks, true),
      onlyHighPriority: this.toBool(onlyHighPriority, false),
      fixTarget: this.toFixTarget(fixTarget),
    });
  }

  @Get(':dramaId/episodes/:episodeNumber/media-status')
  async getEpisodeMediaStatus(@Param('dramaId') dramaId: string, @Param('episodeNumber') ep: string) {
    return this.dramaService.getEpisodeMediaStatus(dramaId, parseInt(ep, 10));
  }

  /* ─── SSE: 媒体生成进度（触发 + 推送） ─── */

  @Sse(':dramaId/episodes/:episodeNumber/generate-media-sse')
  generateMediaSse(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
  ): Observable<MessageEvent> {
    const episodeNumber = parseInt(ep, 10);
    return this.sseHelper.createActiveStream({
      dramaId,
      runType: 'media',
      mutexKey: `${dramaId}:media:${episodeNumber}`,
      reconnectMessage: '已重连到正在进行的媒体生成任务',
      executor: () => this.dramaService.generateEpisodeMedia(dramaId, episodeNumber),
      successMessage: '媒体生成完成',
      failMessage: '媒体生成失败',
      episodeNumber,
    });
  }

  /** 批量生成单集全部分镜图（仅 T2I Phase 0，不生成视频），SSE 流式推送进度 */
  @Sse(':dramaId/episodes/:episodeNumber/generate-images-sse')
  generateImagesSse(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
  ): Observable<MessageEvent> {
    const episodeNumber = parseInt(ep, 10);
    return this.sseHelper.createActiveStream({
      dramaId,
      runType: 'images',
      mutexKey: `${dramaId}:images:${episodeNumber}`,
      reconnectMessage: '已重连到正在进行的图片生成任务',
      executor: () => this.dramaService.generateEpisodeImages(dramaId, episodeNumber),
      successMessage: '图片生成完成',
      failMessage: '图片生成失败',
      episodeNumber,
    });
  }

  /** 单镜图片生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
  @Post(':dramaId/episodes/:episodeNumber/shots/:shotId/generate-image')
  async generateShotImage(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
    @Param('shotId') shotId: string,
  ) {
    const episodeNumber = parseInt(ep, 10);
    if (isNaN(episodeNumber)) throw new NotFoundException('episodeNumber 无效');
    return this.dramaService.generateShotImage(dramaId, episodeNumber, shotId);
  }

  /** 单镜视频生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
  @Post(':dramaId/episodes/:episodeNumber/shots/:shotId/generate-video')
  async generateShotVideo(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
    @Param('shotId') shotId: string,
  ) {
    const episodeNumber = parseInt(ep, 10);
    if (isNaN(episodeNumber)) throw new NotFoundException('episodeNumber 无效');
    return this.dramaService.generateShotVideo(dramaId, episodeNumber, shotId);
  }

  /** 单镜音效生成（同步 HTTP，适合制作台逐 Shot 手动触发） */
  @Post(':dramaId/episodes/:episodeNumber/shots/:shotId/generate-sfx')
  async generateShotSfx(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
    @Param('shotId') shotId: string,
  ) {
    const episodeNumber = parseInt(ep, 10);
    if (isNaN(episodeNumber)) throw new NotFoundException('episodeNumber 无效');
    return this.dramaService.generateShotSfx(dramaId, episodeNumber, shotId);
  }
}
