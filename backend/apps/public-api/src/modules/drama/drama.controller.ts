import { Controller, Post, Get, Put, Delete, Param, Body, Query, Req, Sse, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DramaService } from './drama.service';
import { CreateDramaDto } from './dto/create-drama.dto';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaAgentPipelineService } from './drama-agent-pipeline.service';
import { DramaAgentNodeConfig, DramaWorkflowParams } from './entities/drama-agent-pipeline.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto, AiGenerateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';

@Controller('drama')
export class DramaController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly progressService: DramaProgressService,
    private readonly genreTemplateService: DramaGenreTemplateService,
    private readonly pipelineService: DramaAgentPipelineService,
  ) {}

  /* ─── 题材模板（静态路由优先于 :dramaId 参数路由） ─── */

  @Get('genre-templates/list')
  async listGenreTemplates(@Req() req: any) {
    return this.genreTemplateService.list(req.user?.userId);
  }

  @Post('genre-templates/ai-generate')
  async aiGenerateGenreTemplate(@Body() dto: AiGenerateDramaGenreTemplateDto, @Req() req: any) {
    const result = await this.genreTemplateService.aiGenerate(dto);
    return this.genreTemplateService.create(req.user?.userId ?? 'anonymous', {
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
    return this.genreTemplateService.create(req.user?.userId ?? 'anonymous', dto);
  }

  @Put('genre-templates/:id')
  async updateGenreTemplate(@Param('id') id: string, @Body() dto: UpdateDramaGenreTemplateDto, @Req() req: any) {
    return this.genreTemplateService.update(id, req.user?.userId ?? 'anonymous', dto);
  }

  @Delete('genre-templates/:id')
  async deleteGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.remove(id, req.user?.userId ?? 'anonymous');
  }

  @Post('genre-templates/:id/clone')
  async cloneGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.clone(id, req.user?.userId ?? 'anonymous');
  }

  /* ─── Pipeline 配置 ─── */

  @Get(':dramaId/pipeline')
  async getPipeline(@Param('dramaId') dramaId: string) { return this.pipelineService.getPipeline(dramaId); }

  @Put(':dramaId/pipeline/draft')
  async savePipelineDraft(@Param('dramaId') dramaId: string, @Body() body: { nodes: DramaAgentNodeConfig[] }) {
    return this.pipelineService.saveDraft(dramaId, body.nodes);
  }

  @Post(':dramaId/pipeline/publish')
  async publishPipeline(@Param('dramaId') dramaId: string) { return this.pipelineService.publish(dramaId); }

  @Put(':dramaId/pipeline/params')
  async savePipelineParams(@Param('dramaId') dramaId: string, @Body() params: Partial<DramaWorkflowParams>) {
    return this.pipelineService.saveWorkflowParams(dramaId, params);
  }

  @Get(':dramaId/pipeline/topology')
  async getPipelineTopology(@Param('dramaId') dramaId: string) { return this.pipelineService.getTopology(dramaId); }

  /* ─── 创意辅助（静态路由） ─── */

  @Post('idea/enhance')
  async enhanceIdea(@Body() body: { idea: string; genre?: string }) {
    return this.dramaService.enhanceIdea(body.idea, body.genre);
  }

  @Post('idea/generate-goal')
  async generateGoal(@Body() body: { mainIdea: string; genre: string; targetAudience: string }) {
    return this.dramaService.generateStoryGoal(body);
  }

  /* ─── CRUD ─── */

  @Post()
  async createDrama(@Body() dto: CreateDramaDto, @Req() req: any) {
    return this.dramaService.createDrama(dto, { userId: req.user?.userId });
  }

  @Get()
  async listDramas(@Req() req: any) {
    return this.dramaService.listDramas(req.user?.userId);
  }

  @Get(':dramaId')
  async getDrama(@Param('dramaId') dramaId: string) {
    return this.dramaService.getDrama(dramaId);
  }

  @Post(':dramaId/episodes/generate')
  async generateEpisode(@Param('dramaId') dramaId: string, @Query('count') count?: string) {
    return this.dramaService.generateEpisodes(dramaId, parseInt(count || '1', 10)); // 异步启动，立即返回
  }

  @Get(':dramaId/episodes')
  async listEpisodes(@Param('dramaId') dramaId: string) {
    return this.dramaService.listEpisodes(dramaId);
  }

  @Get(':dramaId/episodes/:episodeNumber')
  async getEpisode(@Param('dramaId') dramaId: string, @Param('episodeNumber') episodeNumber: string) {
    return this.dramaService.getEpisode(dramaId, parseInt(episodeNumber, 10));
  }

  @Get(':dramaId/visual-assets')
  async getVisualAssets(@Param('dramaId') dramaId: string) {
    return this.dramaService.getVisualAssets(dramaId);
  }

  @Post(':dramaId/visual-assets/:assetId/regenerate')
  async regenerateAssetImage(@Param('dramaId') dramaId: string, @Param('assetId') assetId: string) {
    return this.dramaService.regenerateAssetImage(dramaId, assetId);
  }

  @Post(':dramaId/episodes/:episodeNumber/generate-media')
  async generateEpisodeMedia(@Param('dramaId') dramaId: string, @Param('episodeNumber') ep: string) {
    return this.dramaService.generateEpisodeMedia(dramaId, parseInt(ep, 10));
  }

  @Get(':dramaId/episodes/:episodeNumber/media-status')
  async getEpisodeMediaStatus(@Param('dramaId') dramaId: string, @Param('episodeNumber') ep: string) {
    return this.dramaService.getEpisodeMediaStatus(dramaId, parseInt(ep, 10));
  }

  /* ─── SSE: 创建进度 ─── */

  @Sse(':dramaId/create-sse')
  async createDramaSse(@Param('dramaId') dramaId: string): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const heartbeat = setInterval(() => subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent), 15_000);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      subject.next({ data: event } as MessageEvent);
      if (event.done && (event.step === 'create_5' || event.error)) { clearInterval(heartbeat); setTimeout(() => subject.complete(), 200); }
    });
    return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
  }

  /* ─── SSE: 逐集生成进度 ─── */

  @Sse(':dramaId/episodes/generate-sse')
  async generateEpisodeSse(
    @Param('dramaId') dramaId: string,
    @Query('count') count?: string,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const heartbeat = setInterval(() => subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent), 15_000);
    const n = parseInt(count || '1', 10);
    const key = `${dramaId}:generate`;

    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      subject.next({ data: event } as MessageEvent);
    });

    if (alreadyRunning) {
      subject.next({ data: { reconnected: true, message: '已重连到正在进行的生成任务' } } as MessageEvent);
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }

    setTimeout(async () => {
      try {
        const result = await this.dramaService.generateEpisodes(dramaId, n);
        subject.next({ data: { _type: 'result', ...result } } as MessageEvent);
      } catch (err: any) {
        subject.next({ data: { done: true, error: err.message } } as MessageEvent);
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);

    return subject.asObservable();
  }

  /* ─── SSE: 媒体生成进度（触发 + 推送） ─── */

  @Sse(':dramaId/episodes/:episodeNumber/generate-media-sse')
  async generateMediaSse(
    @Param('dramaId') dramaId: string,
    @Param('episodeNumber') ep: string,
  ): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const heartbeat = setInterval(() => subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent), 15_000);
    const episodeNumber = parseInt(ep, 10);
    const key = `${dramaId}:media:${episodeNumber}`;

    const alreadyRunning = !this.progressService.markGenerating(key);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      if (event.phase === 'media' && event.episodeNumber === episodeNumber) subject.next({ data: event } as MessageEvent);
    });

    if (alreadyRunning) {
      subject.next({ data: { reconnected: true, message: '已重连到正在进行的媒体生成任务' } } as MessageEvent);
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }

    setTimeout(async () => {
      try {
        const result = await this.dramaService.generateEpisodeMedia(dramaId, episodeNumber);
        subject.next({ data: { _type: 'result', ...result } } as MessageEvent);
      } catch (err: any) {
        subject.next({ data: { done: true, error: err.message } } as MessageEvent);
      } finally {
        this.progressService.clearGenerating(key);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);

    return subject.asObservable();
  }

  @Sse(':dramaId/episodes/progress-sse')
  async progressSse(@Param('dramaId') dramaId: string): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    subject.next({ data: { connected: true, dramaId } } as MessageEvent);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      subject.next({ data: event } as MessageEvent);
    });
    return subject.asObservable().pipe(finalize(() => unsub()));
  }
}
