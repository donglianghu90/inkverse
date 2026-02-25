import {
  Body,
  Controller,
  Get,
  Logger,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { AutoSerializationService } from './auto-serialization.service';
import { ConfigureAutoSerializationDto } from './dto/configure-auto-serialization.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import { ListChaptersDto } from './dto/list-chapters.dto';
import { NovelV2Service } from './novel-v2.service';
import { NovelProgressService } from './novel-progress.service';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { AgentNodeConfig } from './entities/book-agent-pipeline.entity';
import { Public } from '@packages/common/guards';

@ApiTags('Novel - 小说生成')
@ApiBearerAuth('Authorization')
@Controller('novel')
export class NovelController {
  private readonly logger = new Logger(NovelController.name);

  constructor(
    private readonly novelService: NovelV2Service,
    private readonly autoSerializationService: AutoSerializationService,
    private readonly progressService: NovelProgressService,
    private readonly pipelineService: BookAgentPipelineService,
  ) {}

  @Get('books')
  @Public()
  @ApiOperation({ summary: '书籍列表', description: '返回所有书籍概览（按更新时间倒序）' })
  @ApiResponse({ status: 200, description: '成功' })
  async listBooks(): Promise<unknown> {
    return this.novelService.listBooks();
  }

  @Post('idea/enhance')
  @Public()
  @ApiOperation({ summary: '美化创意', description: '用 AI 将粗略的创意打磨为更具吸引力的故事概念' })
  @ApiResponse({ status: 200, description: '返回美化后的创意和亮点' })
  async enhanceIdea(
    @Body() body: { idea: string; genre?: string },
  ): Promise<unknown> {
    return this.novelService.enhanceIdea(body.idea, body.genre);
  }

  @Post('idea/generate-goal')
  @Public()
  @ApiOperation({ summary: '生成主线目标', description: '根据核心创意、题材和读者群体 AI 生成主线目标' })
  @ApiResponse({ status: 200, description: '返回推荐目标和备选方案' })
  async generateStoryGoal(
    @Body() body: { mainIdea: string; genre: string; targetAudience: string },
  ): Promise<unknown> {
    return this.novelService.generateStoryGoal(body);
  }

  @Post('books')
  @Public()
  @ApiOperation({ summary: '创建新书', description: '极轻量开书：种子分析 + 粗大纲（1 次 LLM 调用）' })
  @ApiResponse({ status: 201, description: '创建成功，返回书籍基本信息' })
  async createBook(@Body() dto: CreateBookDto): Promise<unknown> {
    return this.novelService.createBook(dto);
  }

  @Sse('books/create-sse')
  @Public()
  @ApiOperation({ summary: '创建新书（SSE）', description: '通过 SSE 流式推送创建进度，完成后返回书籍信息' })
  createBookSse(@Query() query: Record<string, string>): Observable<MessageEvent> {
    const dto: CreateBookDto = Object.assign(new CreateBookDto(), {
      mainIdea: query.mainIdea,
      genre: query.genre,
      targetAudience: query.targetAudience,
      mainStoryGoal: query.mainStoryGoal,
      titleHint: query.titleHint,
      targetChapterWordCount: query.targetChapterWordCount ? parseInt(query.targetChapterWordCount, 10) : undefined,
      plannedMinChapters: query.plannedMinChapters ? parseInt(query.plannedMinChapters, 10) : undefined,
      plannedMaxChapters: query.plannedMaxChapters ? parseInt(query.plannedMaxChapters, 10) : undefined,
    });

    this.logger.log(
      `[createBookSse] SSE 连接建立\n` +
      `  mainIdea: ${dto.mainIdea}\n` +
      `  genre: ${dto.genre} | targetAudience: ${dto.targetAudience}`,
    );

    const subject = new ReplaySubject<MessageEvent>(20);

    const unsubscribe = this.progressService.subscribe('__creating__', (event) => {
      this.logger.debug(`[createBookSse] 进度事件 → step=${event.step} message=${event.message} done=${event.done}`);
      subject.next({ data: event } as MessageEvent);
      if (event.done || event.error) {
        this.logger.log(`[createBookSse] 进度流结束 done=${event.done} error=${event.error ?? 'none'}`);
        setTimeout(() => subject.complete(), 200);
      }
    });

    (async () => {
      try {
        this.logger.log(`[createBookSse] 开始调用 createBook...`);
        const result = await this.novelService.createBook(dto);
        this.logger.log(`[createBookSse] createBook 完成，推送 result 事件`);
        subject.next({ data: { result, _type: 'result' } } as MessageEvent);
      } catch (err: any) {
        this.logger.error(`[createBookSse] createBook 异常: ${err.message}`, err.stack);
        subject.next({ data: { done: true, error: err.message } } as MessageEvent);
        subject.complete();
      } finally {
        unsubscribe();
        this.logger.log(`[createBookSse] SSE 流程结束，已取消订阅`);
      }
    })();

    return subject.asObservable();
  }

  @Get('books/:bookId/profile')
  @Public()
  @ApiOperation({ summary: '获取写作手册', description: '返回书籍的 AI 生成写作手册（BookPromptProfile）' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getBookProfile(@Param('bookId') bookId: string): Promise<unknown> {
    return this.novelService.getBookProfile(bookId);
  }

  @Put('books/:bookId/profile')
  @Public()
  @ApiOperation({ summary: '更新写作手册', description: '用户修改后保存写作手册' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateBookProfile(
    @Param('bookId') bookId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.novelService.updateBookProfile(bookId, body);
  }

  @Get('books/:bookId')
  @Public()
  @ApiOperation({ summary: '查询书籍', description: '返回书籍概览信息' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async getBook(@Param('bookId') bookId: string): Promise<unknown> {
    return this.novelService.getBook(bookId);
  }

  @Post('books/:bookId/chapters/generate')
  @Public()
  @ApiOperation({ summary: '生成单章', description: '5 步流程生成一章（意图→写作→审阅→修改→记录）' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 201, description: '章节生成成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async generateChapter(@Param('bookId') bookId: string): Promise<unknown> {
    return this.novelService.generateChapter(bookId);
  }

  @Post('books/:bookId/chapters/generate-batch')
  @Public()
  @ApiOperation({ summary: '批量生成章节', description: '循环生成多章，支持质量低于阈值自动停止' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 201, description: '批量生成结果' })
  @ApiResponse({ status: 404, description: '未找到' })
  async generateChaptersBatch(
    @Param('bookId') bookId: string,
    @Body() dto: GenerateChaptersBatchDto,
  ): Promise<unknown> {
    return this.novelService.generateChaptersBatch(bookId, dto);
  }

  @Get('books/:bookId/chapters')
  @Public()
  @ApiOperation({ summary: '章节列表', description: '返回最近 N 章列表（倒序）' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async listChapters(
    @Param('bookId') bookId: string,
    @Query() query: ListChaptersDto,
  ): Promise<unknown> {
    return this.novelService.listChapters(bookId, query.limit ?? 50);
  }

  @Get('books/:bookId/chapters/:chapterNumber')
  @Public()
  @ApiOperation({ summary: '获取指定章节', description: '返回章节完整内容' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiParam({ name: 'chapterNumber', description: '章节序号', example: 1 })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async getChapter(
    @Param('bookId') bookId: string,
    @Param('chapterNumber', ParseIntPipe) chapterNumber: number,
  ): Promise<unknown> {
    return this.novelService.getChapter(bookId, chapterNumber);
  }

  @Sse('books/:bookId/chapters/generate-sse')
  @Public()
  @ApiOperation({ summary: '生成章节（SSE）', description: '通过 SSE 流式推送章节生成进度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  generateChapterSse(
    @Param('bookId') bookId: string,
  ): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    const unsubscribe = this.progressService.subscribe(bookId, (event) => {
      subject.next({ data: event } as MessageEvent);
      if (event.done || event.error) {
        setTimeout(() => subject.complete(), 100);
      }
    });

    (async () => {
      try {
        await this.novelService.generateChapter(bookId);
      } catch (err: any) {
        subject.next({ data: { done: true, error: err.message } } as MessageEvent);
        subject.complete();
      } finally {
        unsubscribe();
      }
    })();

    return subject.asObservable();
  }

  @Get('books/:bookId/world')
  @Public()
  @ApiOperation({ summary: '获取世界观数据', description: '返回书籍的角色、地点、关系图、力量体系等世界观数据' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async getWorld(@Param('bookId') bookId: string): Promise<unknown> {
    return this.novelService.getWorld(bookId);
  }

  // -------------------------------------------------------------------------
  // 自动连载
  // -------------------------------------------------------------------------

  @Put('books/:bookId/auto-serialization')
  @Public()
  @ApiOperation({ summary: '配置自动连载', description: '设置每日定时自动生成章节的调度参数' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 200, description: '配置成功' })
  @ApiResponse({ status: 404, description: '书籍未找到' })
  async configureAutoSerialization(
    @Param('bookId') bookId: string,
    @Body() dto: ConfigureAutoSerializationDto,
  ): Promise<Record<string, unknown>> {
    return this.autoSerializationService.configure(bookId, dto) as unknown as Promise<Record<string, unknown>>;
  }

  @Get('books/:bookId/auto-serialization')
  @Public()
  @ApiOperation({ summary: '获取自动连载配置', description: '查询当前书籍的自动连载调度配置' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 200, description: '成功返回配置信息' })
  @ApiResponse({ status: 404, description: '书籍未找到' })
  async getAutoSerialization(
    @Param('bookId') bookId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.autoSerializationService.get(bookId) as unknown as Promise<Record<string, unknown> | null>;
  }

  @Post('books/:bookId/auto-serialization/disable')
  @Public()
  @ApiOperation({ summary: '停用自动连载', description: '暂停指定书籍的自动连载调度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 201, description: '已停用' })
  @ApiResponse({ status: 404, description: '书籍未找到' })
  async disableAutoSerialization(
    @Param('bookId') bookId: string,
  ): Promise<Record<string, unknown>> {
    return this.autoSerializationService.disable(bookId) as unknown as Promise<Record<string, unknown>>;
  }

  @Post('books/:bookId/auto-serialization/enable')
  @Public()
  @ApiOperation({ summary: '启用自动连载', description: '恢复指定书籍的自动连载调度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 201, description: '已启用' })
  @ApiResponse({ status: 404, description: '书籍未找到' })
  async enableAutoSerialization(
    @Param('bookId') bookId: string,
  ): Promise<Record<string, unknown>> {
    return this.autoSerializationService.enable(bookId) as unknown as Promise<Record<string, unknown>>;
  }

  @Post('books/:bookId/auto-serialization/run-now')
  @Public()
  @ApiOperation({ summary: '立即执行自动连载', description: '手动触发一次自动连载运行，不等待定时调度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID', example: 'b1a2c3d4-e5f6-7890-abcd-ef1234567890' })
  @ApiResponse({ status: 201, description: '触发成功' })
  @ApiResponse({ status: 404, description: '书籍未找到' })
  async runAutoSerializationNow(
    @Param('bookId') bookId: string,
  ): Promise<Record<string, unknown>> {
    return this.autoSerializationService.runNow(bookId);
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────

  @Get('books/:bookId/pipeline')
  @Public()
  @ApiOperation({ summary: '获取 Agent Pipeline', description: '返回草稿和已发布的 pipeline 配置' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getPipeline(@Param('bookId') bookId: string): Promise<unknown> {
    return this.pipelineService.getPipeline(bookId);
  }

  @Put('books/:bookId/pipeline/draft')
  @Public()
  @ApiOperation({ summary: '保存 Pipeline 草稿', description: '保存节点配置为草稿，不影响生成' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '保存成功' })
  async savePipelineDraft(
    @Param('bookId') bookId: string,
    @Body() body: { nodes: AgentNodeConfig[] },
  ): Promise<unknown> {
    return this.pipelineService.saveDraft(bookId, body.nodes);
  }

  @Post('books/:bookId/pipeline/publish')
  @Public()
  @ApiOperation({ summary: '发布 Pipeline', description: '将草稿发布为生效配置，下次生成立即使用' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '发布成功' })
  async publishPipeline(@Param('bookId') bookId: string): Promise<unknown> {
    return this.pipelineService.publish(bookId);
  }
}
