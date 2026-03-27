import { Controller, Post, Get, Put, Patch, Delete, Param, Body, Query, Req, Sse, MessageEvent, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DramaService } from './drama.service';
import { CreateDramaDto } from './dto/create-drama.dto';
import { DramaProgressEvent, DramaProgressService, DramaRunType } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaAgentPipelineService } from './workflow/drama-agent-pipeline.service';
import { DramaWorkflowExecutionService } from './workflow/drama-workflow-execution.service';
import { DramaAgentNodeConfig, DramaWorkflowParams } from './entities/drama-agent-pipeline.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto, AiGenerateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';
import { DramaVisualStyleTemplateService } from './drama-visual-style-template.service';
import { CreateDramaVisualStyleTemplateDto, UpdateDramaVisualStyleTemplateDto } from './dto/drama-visual-style-template.dto';
import { UsageLedgerService } from '../usage/usage-ledger.service';
import { DramaGlobalPromptSettingService } from './drama-global-prompt-setting.service';
import { DramaPromptTemplateService } from './prompting/drama-prompt-template.service';

@Controller('drama')
export class DramaController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly progressService: DramaProgressService,
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly visualStyleTemplateService: DramaVisualStyleTemplateService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly executionService: DramaWorkflowExecutionService,
    private readonly usageLedger: UsageLedgerService,
    private readonly globalPromptSettingService: DramaGlobalPromptSettingService,
    private readonly promptTemplateService: DramaPromptTemplateService,
  ) {}

  private getUserId(req: any, fallback = ''): string {
    return req?.user?.id ?? req?.user?.userId ?? fallback;
  }

  private createSseSender(subject: Subject<MessageEvent>, runType: DramaRunType, dramaId: string, episodeNumber?: number) {
    const runId = randomUUID();
    let seq = 0;
    const base = {
      runType,
      runId,
      dramaId,
      ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    };
    const send = (payload: Record<string, unknown>) => {
      subject.next({
        data: {
          ...base,
          seq: ++seq,
          ts: Date.now(),
          ...payload,
        },
      } as MessageEvent);
    };
    return { runId, send };
  }

  private sendProgress(send: (payload: Record<string, unknown>) => void, event: DramaProgressEvent): void {
    send({
      _type: 'progress',
      step: event.step,
      ...(event.stepKey ? { stepKey: event.stepKey } : {}),
      ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      stepIndex: event.stepIndex,
      totalSteps: event.totalSteps,
      message: event.message,
      done: event.done,
      ...(event.skipped !== undefined ? { skipped: event.skipped } : {}),
      ...(event.skipReason ? { skipReason: event.skipReason } : {}),
      terminal: false,
      ...(event.episodeNumber !== undefined ? { episodeNumber: event.episodeNumber } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.data ? { data: event.data } : {}),
    });
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

  /* ─── 题材模板（静态路由优先于 :dramaId 参数路由） ─── */

  @Get('genre-templates/list')
  async listGenreTemplates(@Req() req: any) {
    return this.genreTemplateService.list(req.user?.id);
  }

  @Get('genre-templates/analytics')
  async getGenreAnalytics() {
    return this.genreTemplateService.getRecommendedGenres();
  }

  @Post('genre-templates/ai-generate')
  async aiGenerateGenreTemplate(@Body() dto: AiGenerateDramaGenreTemplateDto, @Req() req: any) {
    const result = await this.genreTemplateService.aiGenerate({ ...dto, userId: req.user?.id });
    return this.genreTemplateService.create(req.user?.id ?? 'anonymous', {
      genreKey: dto.genreName.toLowerCase().replace(/\s+/g, '-'),
      displayName: result.displayName,
      description: result.description,
      genreKeywords: result.genreKeywords,
      profileJson: result.profileJson,
      seedHints: result.seedHints as any,
      audienceTags: result.audienceTags,
      protagonistFocusTags: result.protagonistFocusTags,
      toneTags: result.toneTags,
      platformTags: result.platformTags,
    });
  }

  @Get('genre-templates/:id')
  async getGenreTemplate(@Param('id') id: string) {
    return this.genreTemplateService.getById(id);
  }

  @Post('genre-templates')
  async createGenreTemplate(@Body() dto: CreateDramaGenreTemplateDto, @Req() req: any) {
    return this.genreTemplateService.create(req.user?.id ?? 'anonymous', dto);
  }

  @Put('genre-templates/:id')
  async updateGenreTemplate(@Param('id') id: string, @Body() dto: UpdateDramaGenreTemplateDto, @Req() req: any) {
    return this.genreTemplateService.update(id, req.user?.id ?? 'anonymous', dto);
  }

  @Delete('genre-templates/:id')
  async deleteGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.remove(id, req.user?.id ?? 'anonymous');
  }

  @Post('genre-templates/:id/clone')
  async cloneGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.clone(id, req.user?.id ?? 'anonymous');
  }

  /* ─── 视觉风格模板 ─── */

  @Get('visual-style-templates/list')
  async listVisualStyleTemplates(@Req() req: any) {
    return this.visualStyleTemplateService.list(req.user?.id);
  }

  @Get('visual-style-templates/:id')
  async getVisualStyleTemplate(@Param('id') id: string) {
    return this.visualStyleTemplateService.getById(id);
  }

  @Post('visual-style-templates')
  async createVisualStyleTemplate(@Body() dto: CreateDramaVisualStyleTemplateDto, @Req() req: any) {
    return this.visualStyleTemplateService.create(req.user?.id ?? 'anonymous', dto);
  }

  @Put('visual-style-templates/:id')
  async updateVisualStyleTemplate(@Param('id') id: string, @Body() dto: UpdateDramaVisualStyleTemplateDto, @Req() req: any) {
    return this.visualStyleTemplateService.update(id, req.user?.id ?? 'anonymous', dto);
  }

  @Delete('visual-style-templates/:id')
  async deleteVisualStyleTemplate(@Param('id') id: string, @Req() req: any) {
    return this.visualStyleTemplateService.remove(id, req.user?.id ?? 'anonymous');
  }

  @Post('visual-style-templates/:id/clone')
  async cloneVisualStyleTemplate(@Param('id') id: string, @Req() req: any) {
    return this.visualStyleTemplateService.clone(id, req.user?.id ?? 'anonymous');
  }

  /* ─── Pipeline 配置 ─── */

  @Get(':dramaId/pipeline')
  async getPipeline(@Param('dramaId') dramaId: string) { return this.pipelineService.getPipeline(dramaId); }

  @Put(':dramaId/pipeline/draft')
  async savePipelineDraft(@Param('dramaId') dramaId: string, @Body() body: { nodes: DramaAgentNodeConfig[] }) {
    return this.pipelineService.saveDraft(dramaId, body.nodes);
  }

  @Post(':dramaId/pipeline/publish')
  async publishPipeline(@Param('dramaId') dramaId: string) {
    const result = await this.pipelineService.publish(dramaId);
    // 发布后立即使提示词缓存失效，确保下次生成使用最新的 pipeline 节点配置
    this.promptTemplateService.invalidateCache(dramaId);
    return result;
  }

  @Put(':dramaId/pipeline/params')
  async savePipelineParams(@Param('dramaId') dramaId: string, @Body() params: Partial<DramaWorkflowParams>) {
    return this.pipelineService.saveWorkflowParams(dramaId, params);
  }

  @Get(':dramaId/pipeline/topology')
  async getPipelineTopology(@Param('dramaId') dramaId: string) { return this.pipelineService.getTopology(dramaId); }

  @Get(':dramaId/pipeline/node-preview/:nodeId')
  async getNodePreview(@Param('dramaId') dramaId: string, @Param('nodeId') nodeId: string) {
    return this.dramaService.buildNodePreview(dramaId, nodeId);
  }

  /* ─── 全局 Agent 提示词设置（静态路由，无 dramaId） ─── */

  /** 返回指定节点的系统默认基础提示词（无短剧上下文，用于全局设置页预览） */
  @Get('global-prompt-preview/:nodeId')
  async getGlobalNodePreview(@Param('nodeId') nodeId: string) {
    return this.dramaService.buildGlobalNodePreview(nodeId);
  }

  @Get('global-prompt-settings')
  async listGlobalPromptSettings(@Req() req: any) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.listAll(userId);
  }

  @Put('global-prompt-settings/:agentType')
  async updateGlobalPromptSetting(
    @Param('agentType') agentType: string,
    @Body() body: { globalAdditionalPrompt: string },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.update(userId, agentType, body.globalAdditionalPrompt ?? '');
  }

  @Put('global-prompt-settings')
  async batchUpdateGlobalPromptSettings(
    @Body() body: { items: Array<{ agentType: string; globalAdditionalPrompt: string }> },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.batchUpdate(userId, body.items ?? []);
  }

  @Put('global-prompt-settings/:agentType/reset')
  async resetGlobalPromptSetting(
    @Param('agentType') agentType: string,
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.resetToSystem(userId, agentType);
  }

  /* ─── 创意辅助（静态路由） ─── */

  @Post('idea/enhance')
  async enhanceIdea(@Body() body: { idea: string; genre?: string }, @Req() req: any) {
    return this.dramaService.enhanceIdea(body.idea, body.genre, req.user?.id);
  }

  @Post('idea/generate-goal')
  async generateGoal(@Body() body: { mainIdea: string; genre: string; targetAudience: string }, @Req() req: any) {
    return this.dramaService.generateStoryGoal(body, req.user?.id);
  }

  @Post('idea/recommend-genre-audience')
  async recommendGenreAndAudience(@Body() body: { mainIdea: string }, @Req() req: any) {
    return this.dramaService.recommendGenreAndAudience(body.mainIdea, req.user?.id);
  }

  /* ─── CRUD ─── */

  @Post()
  async createDrama(@Body() dto: CreateDramaDto, @Req() req: any) {
    return this.dramaService.createDrama(dto, { userId: req.user?.id });
  }

  @Get()
  async listDramas(@Req() req: any) {
    return this.dramaService.listDramas(req.user?.id);
  }

  @Get(':dramaId')
  async getDrama(@Param('dramaId') dramaId: string) {
    return this.dramaService.getDrama(dramaId);
  }

  @Delete(':dramaId')
  async deleteDrama(@Param('dramaId') dramaId: string, @Req() req: any) {
    return this.dramaService.deleteDrama(dramaId, req.user?.id);
  }

  @Patch(':dramaId/visual-style')
  async updateVisualStyle(
    @Param('dramaId') dramaId: string,
    @Body() body: { visualStyle: Record<string, unknown> },
    @Req() req: any,
  ) {
    return this.dramaService.updateVisualStyle(dramaId, body.visualStyle, req.user?.id);
  }

  @Get(':dramaId/usage')
  async getDramaUsage(@Param('dramaId') dramaId: string, @Req() req: any) {
    const userId = req.user?.id ?? '';
    await this.dramaService.assertDramaOwnership(dramaId, userId);
    return this.usageLedger.resourceDetailForDrama('drama', dramaId);
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
    const ok = this.dramaService.pauseGeneration(dramaId);
    return { paused: ok, message: ok ? '暂停请求已发送，当前集完成后将暂停' : '该短剧当前没有正在进行的生成任务' };
  }

  @Post(':dramaId/episodes/resume')
  async resumeGeneration(@Param('dramaId') dramaId: string) {
    this.dramaService.resumeGeneration(dramaId);
    return { message: '暂停标记已清除，可重新启动生成' };
  }

  @Get(':dramaId/episodes')
  async listEpisodes(@Param('dramaId') dramaId: string) {
    return this.dramaService.listEpisodes(dramaId);
  }

  @Sse(':dramaId/episode-generate-sse')
  async generateEpisodeSse(
    @Param('dramaId') dramaId: string,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, 'episode', dramaId);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const key = `${dramaId}:generate`;
    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'episode') return;
      if (event.terminal) return; // 终态由 result/error 统一发射
      this.sendProgress(send, event);
    });
    if (alreadyRunning) {
      send({ _type: 'info', terminal: false, message: '已重连到正在进行的生成任务' });
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }
    setTimeout(async () => {
      try {
        const result = await this.dramaService.generateEpisodesAndWait(dramaId);
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: result.paused ? 'paused' : 'success',
          message: result.message,
          done: true,
          data: result,
        });
      } catch (err: any) {
        const msg = err?.message ?? '集生成失败';
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          message: msg,
          error: msg,
          done: true,
        });
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);
    return subject.asObservable();
  }

  /* ─── SSE: 集生成进度订阅（仅接收，不触发，用于页面刷新后的安全重连）─── */

  @Sse(':dramaId/episode-progress-sse')
  async episodeProgressSse(@Param('dramaId') dramaId: string): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, 'episode', dramaId);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'episode') return;
      if (!event.terminal) {
        this.sendProgress(send, event);
        return;
      }
      if (event.terminalStatus === 'failed' || event.error) {
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          step: event.step,
          message: event.error ?? event.message,
          error: event.error ?? event.message,
          done: true,
        });
      } else {
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: event.terminalStatus ?? 'success',
          step: event.step,
          message: event.message,
          done: true,
          data: {
            step: event.step,
            message: event.message,
            terminalStatus: event.terminalStatus ?? 'success',
          },
        });
      }
      clearInterval(heartbeat);
      setTimeout(() => subject.complete(), 300);
    });
    return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
  }

  @Get(':dramaId/episodes/:episodeNumber')
  async getEpisode(@Param('dramaId') dramaId: string, @Param('episodeNumber') episodeNumber: string) {
    const ep = parseInt(episodeNumber, 10);
    if (!Number.isFinite(ep) || ep < 1) throw new NotFoundException(`无效的集数: ${episodeNumber}`);
    return this.dramaService.getEpisode(dramaId, ep);
  }

  @Get(':dramaId/visual-assets')
  async getVisualAssets(@Param('dramaId') dramaId: string) {
    return this.dramaService.getVisualAssets(dramaId);
  }

  /** 批量生成该短剧全部参考图，SSE 推送进度（runType='assets'） */
  @Sse(':dramaId/visual-assets/generate-all-sse')
  async generateAllAssetsSse(
    @Param('dramaId') dramaId: string,
    @Req() req: any,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, 'assets', dramaId);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const key = `${dramaId}:assets`;
    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'assets') return;
      if (event.terminal) return;
      this.sendProgress(send, event);
    });
    if (alreadyRunning) {
      send({ _type: 'info', terminal: false, message: '参考图生成已在进行中' });
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }
    setTimeout(async () => {
      try {
        await this.dramaService.generateAllVisualAssets(dramaId, this.getUserId(req, 'anonymous'));
        send({ _type: 'result', terminal: true, terminalStatus: 'success', message: '参考图生成完成', done: true });
      } catch (err: any) {
        const msg = err?.message ?? '参考图生成失败';
        send({ _type: 'error', terminal: true, terminalStatus: 'failed', message: msg, error: msg, done: true });
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);
    return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
  }

  /** LLM 自动修复指定角色的 faceReferencePrompt（建剧时 LLM 遗漏导致字段为空时使用） */
  @Post(':dramaId/characters/:characterId/redesign-face-prompt')
  async redesignCharacterFacePrompt(
    @Param('dramaId') dramaId: string,
    @Param('characterId') characterId: string,
    @Req() req: any,
  ) {
    return this.dramaService.redesignCharacterFacePrompt(dramaId, characterId, req.user?.id);
  }

  /** 手动编辑指定角色的文本字段（前端直接写入正确值） */
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
    return this.dramaService.patchCharacter(dramaId, characterId, body);
  }

  @Post(':dramaId/visual-assets/:assetId/variation/:variationId/regenerate')
  async regenerateVariationImage(
    @Param('dramaId') dramaId: string,
    @Param('assetId') assetId: string,
    @Param('variationId') variationId: string,
    @Req() req?: any,
  ) {
    return this.dramaService.regenerateVariationImage(dramaId, assetId, variationId, this.getUserId(req, 'anonymous'));
  }

  @Post(':dramaId/visual-assets/:assetId/regenerate')
  async regenerateAssetImage(
    @Param('dramaId') dramaId: string,
    @Param('assetId') assetId: string,
    @Body() body?: { viewAngle?: string },
    @Req() req?: any,
  ) {
    return this.dramaService.regenerateAssetImage(dramaId, assetId, this.getUserId(req, 'anonymous'), {
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
    return this.dramaService.refineAssetImage(dramaId, assetId, {
      instruction: String(body?.instruction ?? ''),
      viewAngle: body?.viewAngle,
      syncScope: body?.syncScope,
      strength: body?.strength,
      preserveIdentity: body?.preserveIdentity,
      userId: this.getUserId(req, 'anonymous'),
    });
  }

  /**
   * 人工编辑单个 Shot — 支持局部 patch，标记 isHumanEdited=true 防止 AI 重跑覆盖。
   * 前端可编辑：visualPrompt / camera / specialTechnique / firstFrameImageUrl 等安全字段。
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

  /* ─── 生成状态查询（用于页面重进时判断是否需要重连 SSE）─── */

  @Get(':dramaId/generation-status')
  async getGenerationStatus(@Param('dramaId') dramaId: string) {
    const episode = this.progressService.isGenerating(`${dramaId}:generate`);
    const paused = this.dramaService.isGenerationPaused(dramaId);
    const dbRunning = await this.executionService.findRunningForDrama(dramaId);
    return { episode: { ...episode, paused }, dbRunning };
  }

  /* ─── SSE: 创建进度 ─── */

  @Sse(':dramaId/create-sse')
  async createDramaSse(@Param('dramaId') dramaId: string): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, 'create', dramaId);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'create') return;
      if (!event.terminal) {
        this.sendProgress(send, event);
        return;
      }
      if (event.terminalStatus === 'failed' || event.error) {
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          step: event.step,
          message: event.error ?? event.message,
          error: event.error ?? event.message,
          done: true,
        });
      } else {
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: event.terminalStatus ?? 'success',
          step: event.step,
          message: event.message,
          done: true,
          data: { message: event.message },
        });
      }
      clearInterval(heartbeat);
      setTimeout(() => subject.complete(), 200);
    });
    return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
  }

  /* ─── SSE: 媒体生成进度（触发 + 推送） ─── */

  @Sse(':dramaId/episodes/:episodeNumber/generate-media-sse')
  async generateMediaSse(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const episodeNumber = parseInt(ep, 10);
    const { send } = this.createSseSender(subject, 'media', dramaId, episodeNumber);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const key = `${dramaId}:media:${episodeNumber}`;

    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'media' || event.episodeNumber !== episodeNumber) return;
      if (event.terminal) return; // 终态由 result/error 统一发射
      this.sendProgress(send, event);
    });

    if (alreadyRunning) {
      send({ _type: 'info', terminal: false, message: '已重连到正在进行的媒体生成任务' });
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }

    setTimeout(async () => {
      try {
        const result = await this.dramaService.generateEpisodeMedia(dramaId, episodeNumber);
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: 'success',
          message: '媒体生成完成',
          done: true,
          data: result,
        });
      } catch (err: any) {
        const msg = err?.message ?? '媒体生成失败';
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          message: msg,
          error: msg,
          done: true,
        });
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);

    return subject.asObservable();
  }

  /** 批量生成单集全部分镜图（仅 T2I Phase 0，不生成视频），SSE 流式推送进度 */
  @Sse(':dramaId/episodes/:episodeNumber/generate-images-sse')
  async generateImagesSse(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const episodeNumber = parseInt(ep, 10);
    const { send } = this.createSseSender(subject, 'images', dramaId, episodeNumber);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const key = `${dramaId}:images:${episodeNumber}`;

    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.runType !== 'images' || event.episodeNumber !== episodeNumber) return;
      if (event.terminal) return; // 终态由 result/error 统一发射
      this.sendProgress(send, event);
    });

    if (alreadyRunning) {
      send({ _type: 'info', terminal: false, message: '已重连到正在进行的图片生成任务' });
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }

    setTimeout(async () => {
      try {
        await this.dramaService.generateEpisodeImages(dramaId, episodeNumber);
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: 'success',
          message: '图片生成完成',
          done: true,
          data: { message: '图片生成完成' },
        });
      } catch (err: any) {
        const msg = err?.message ?? '图片生成失败';
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          message: msg,
          error: msg,
          done: true,
        });
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);

    return subject.asObservable();
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

}
