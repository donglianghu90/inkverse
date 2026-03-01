import { Controller, Post, Get, Put, Delete, Param, Body, Query, Req, Sse, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DramaService } from './drama.service';
import { CreateDramaDto } from './dto/create-drama.dto';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';

@Controller('drama')
export class DramaController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly progressService: DramaProgressService,
    private readonly genreTemplateService: DramaGenreTemplateService,
  ) {}

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
    return this.dramaService.generateEpisodes(dramaId, parseInt(count || '1', 10));
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

  /* ─── SSE: 创建进度 ─── */

  @Sse(':dramaId/create-sse')
  async createDramaSse(@Param('dramaId') dramaId: string): Promise<Observable<MessageEvent>> {
    const subject = new Subject<MessageEvent>();
    const heartbeat = setInterval(() => subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent), 15_000);
    const unsub = this.progressService.subscribe(dramaId, (event) => {
      subject.next({ data: event } as MessageEvent);
      if (event.done && event.step === 'create_4') { clearInterval(heartbeat); setTimeout(() => subject.complete(), 100); }
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
        setTimeout(() => subject.complete(), 100);
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

  /* ─── 题材模板 ─── */

  @Get('genre-templates/list')
  async listGenreTemplates(@Req() req: any) {
    return this.genreTemplateService.list(req.user?.userId);
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
}
