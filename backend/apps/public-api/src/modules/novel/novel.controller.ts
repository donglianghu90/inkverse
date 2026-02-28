import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { CurrentUser } from '@packages/common/decorators';
import { AutoSerializationService } from './auto-serialization.service';
import { ConfigureAutoSerializationDto } from './dto/configure-auto-serialization.dto';
import { CreateBookDto } from './dto/create-book.dto';
import { CreateBookSessionDto } from './dto/create-book-session.dto';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import { ListChaptersDto } from './dto/list-chapters.dto';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { NovelService } from './novel.service';
import { NovelProgressService } from './novel-progress.service';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { AgentNodeConfig } from './entities/book-agent-pipeline.entity';
import { CreateBookSessionService } from './create-book-session.service';

@ApiTags('Novel - 小说生成')
@ApiBearerAuth('Authorization')
@Controller('novel')
export class NovelController {
  private readonly logger = new Logger(NovelController.name);

  constructor(
    private readonly novelService: NovelService,
    private readonly autoSerializationService: AutoSerializationService,
    private readonly progressService: NovelProgressService,
    private readonly pipelineService: BookAgentPipelineService,
    private readonly createBookSessionService: CreateBookSessionService,
    private readonly promptTemplateService: BookPromptTemplateService,
    private readonly executionService: WorkflowExecutionService,
  ) {}

  private async guard(bookId: string, userId: string): Promise<void> {
    await this.novelService.assertBookOwnership(bookId, userId);
  }

  // ── Books ─────────────────────────────────────────────────────────────────

  @Get('books')
  @ApiOperation({ summary: '书籍列表', description: '返回当前用户的书籍概览（按更新时间倒序）' })
  @ApiResponse({ status: 200, description: '成功' })
  async listBooks(@CurrentUser('id') userId: string): Promise<unknown> {
    return this.novelService.listBooks(userId);
  }

  @Post('idea/enhance')
  @ApiOperation({ summary: '美化创意', description: '用 AI 将粗略的创意打磨为更具吸引力的故事概念' })
  @ApiResponse({ status: 200, description: '返回美化后的创意和亮点' })
  async enhanceIdea(@Body() body: { idea: string; genre?: string }): Promise<unknown> {
    return this.novelService.enhanceIdea(body.idea, body.genre);
  }

  @Post('idea/generate-goal')
  @ApiOperation({ summary: '生成主线目标', description: '根据核心创意、题材和读者群体 AI 生成主线目标' })
  @ApiResponse({ status: 200, description: '返回推荐目标和备选方案' })
  async generateStoryGoal(
    @Body() body: { mainIdea: string; genre: string; targetAudience: string },
  ): Promise<unknown> {
    return this.novelService.generateStoryGoal(body);
  }

  @Post('books')
  @ApiOperation({ summary: '创建新书', description: '极轻量开书：种子分析 + 粗大纲（1 次 LLM 调用）' })
  @ApiResponse({ status: 201, description: '创建成功，返回书籍基本信息' })
  async createBook(@Body() dto: CreateBookDto, @CurrentUser('id') userId: string): Promise<unknown> {
    const created = await this.novelService.createBook(dto, { userId });
    return this.attachInitialAutoSerialization(created, dto);
  }

  @Post('books/create-session')
  @ApiOperation({ summary: '创建新书会话', description: '创建或复用开书任务会话，返回 progressChannel（支持幂等键）' })
  @ApiResponse({ status: 201, description: '返回会话信息' })
  async createBookSession(@Body() dto: CreateBookSessionDto, @CurrentUser('id') userId: string): Promise<Record<string, unknown>> {
    const { idempotencyKey, ...payload } = dto;
    const createBookDto = Object.assign(new CreateBookDto(), payload);
    const { session, reused } = await this.createBookSessionService.createOrReuse(createBookDto, idempotencyKey, userId);
    return {
      progressChannel: session.progressChannel,
      reused,
      status: session.status,
      result: session.result,
      error: session.error,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date(session.updatedAt).toISOString(),
    };
  }

  @Sse('books/create-sse')
  @ApiOperation({ summary: '创建新书（SSE）', description: '通过 progressChannel 订阅创建进度，完成后返回书籍信息' })
  @ApiQuery({ name: 'progressChannel', required: true, description: '创建会话返回的进度通道 ID' })
  async createBookSse(@Query('progressChannel') progressChannelQuery?: string): Promise<Observable<MessageEvent>> {
    const progressChannel = progressChannelQuery?.trim();
    if (!progressChannel) throw new BadRequestException('progressChannel is required');
    const session = this.createBookSessionService.get(progressChannel)
      ?? await this.createBookSessionService.getAsync(progressChannel);
    if (!session) throw new BadRequestException(`会话不存在或已过期（progressChannel=${progressChannel}），请重新调用 POST /books/create-session 创建会话`);

    const subject = new ReplaySubject<MessageEvent>(20);
    let finished = false;
    const HEARTBEAT_MS = 15_000; // 每15秒发送心跳，防止代理/浏览器断开空闲连接
    const heartbeat = setInterval(() => { if (!finished) subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent); }, HEARTBEAT_MS);
    const finish = (unsubscribe: () => void): void => {
      if (finished) return;
      finished = true;
      clearInterval(heartbeat);
      unsubscribe();
      setTimeout(() => subject.complete(), 80);
    };

    if (session.status === 'completed') {
      this.logger.log(`[createBookSse] 会话已完成，直接返回结果 channel=${progressChannel} result=${JSON.stringify(session.result)}`);
      clearInterval(heartbeat);
      subject.next({ data: { result: session.result, _type: 'result' } } as MessageEvent);
      subject.complete();
      return subject.asObservable();
    }
    if (session.status === 'failed') {
      this.logger.warn(`[createBookSse] 会话已失败，直接返回错误 channel=${progressChannel} error=${session.error}`);
      clearInterval(heartbeat);
      subject.next({ data: { done: true, error: session.error ?? 'create book session failed' } } as MessageEvent);
      subject.complete();
      return subject.asObservable();
    }

    const unsubscribe = this.progressService.subscribe(progressChannel, (event) => {
      this.logger.log(`[createBookSse] SSE推送进度 → channel=${progressChannel} data=${JSON.stringify(event)}`);
      subject.next({ data: event } as MessageEvent);
      if (event.done || event.error) {
        const flushFinalResult = (attempt: number) => {
          const latest = this.createBookSessionService.get(progressChannel);
          if (latest?.status === 'completed') {
            this.logger.log(`[createBookSse] SSE推送最终结果 → channel=${progressChannel} result=${JSON.stringify(latest.result)}`);
            subject.next({ data: { result: latest.result, _type: 'result' } } as MessageEvent);
            finish(unsubscribe);
            return;
          }
          if (latest?.status === 'failed') {
            this.logger.warn(`[createBookSse] SSE推送失败结果 → channel=${progressChannel} error=${latest.error}`);
            subject.next({ data: { done: true, error: latest.error ?? 'create book session failed' } } as MessageEvent);
            finish(unsubscribe);
            return;
          }
          if (attempt >= 25) { finish(unsubscribe); return; }
          setTimeout(() => flushFinalResult(attempt + 1), 200);
        };
        setTimeout(() => flushFinalResult(0), 120);
      }
    });

    const statusBefore = session.status;
    const markResult = this.createBookSessionService.markRunning(progressChannel);
    const shouldStartCreate = statusBefore === 'queued' && markResult?.status === 'running';
    if (!shouldStartCreate) return subject.asObservable();

    setTimeout(async () => {
      try {
        this.logger.log(`[createBookSse] 开始创建新书 channel=${progressChannel}`);
        const created = await this.novelService.createBook(session.dto, { progressChannel, userId: session.userId });
        const result = await this.attachInitialAutoSerialization(created, session.dto);
        this.createBookSessionService.markCompleted(progressChannel, result as Record<string, unknown>);
        this.logger.log(`[createBookSse] SSE推送创建完成 → channel=${progressChannel} result=${JSON.stringify(result)}`);
        subject.next({ data: { result, _type: 'result' } } as MessageEvent);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`[createBookSse] createBook 异常 channel=${progressChannel}: ${message}`);
        this.createBookSessionService.markFailed(progressChannel, message);
        this.logger.error(`[createBookSse] SSE推送创建异常 → channel=${progressChannel} error=${message}`);
        subject.next({ data: { done: true, error: message } } as MessageEvent);
      } finally {
        finish(unsubscribe);
      }
    }, 0);

    return subject.asObservable();
  }

  @Get('books/:bookId/profile')
  @ApiOperation({ summary: '获取写作手册', description: '返回书籍的 AI 生成写作手册（BookPromptProfile）' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getBookProfile(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getBookProfile(bookId);
  }

  @Put('books/:bookId/profile')
  @ApiOperation({ summary: '更新写作手册', description: '用户修改后保存写作手册' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateBookProfile(
    @Param('bookId') bookId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.updateBookProfile(bookId, body);
  }

  @Delete('books/:bookId')
  @ApiOperation({ summary: '删除书籍', description: '永久删除书籍及其全部关联数据，不可恢复' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async deleteBook(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.deleteBook(bookId);
  }

  @Get('books/:bookId/token-usage')
  @ApiOperation({ summary: '书籍Token用量', description: '返回书籍所有章节的LLM Token用量汇总与明细' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getBookTokenUsage(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getBookTokenUsage(bookId);
  }

  @Get('books/:bookId')
  @ApiOperation({ summary: '查询书籍', description: '返回书籍概览信息' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  @ApiResponse({ status: 404, description: '未找到' })
  async getBook(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getBook(bookId);
  }

  @Get('books/:bookId/quality-stats')
  @ApiOperation({ summary: '质量统计', description: '返回书籍的质量分布数据：通过率、维度平均分、重写轮次等' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getQualityStats(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getQualityStats(bookId);
  }

  // ── Chapters ──────────────────────────────────────────────────────────────

  @Post('books/:bookId/chapters/generate')
  @ApiOperation({ summary: '生成单章', description: '5 步流程生成一章' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '章节生成成功' })
  async generateChapter(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.generateChapter(bookId);
  }

  @Post('books/:bookId/chapters/generate-batch')
  @ApiOperation({ summary: '批量生成章节', description: '循环生成多章，质量门控固定开启' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '批量生成结果' })
  async generateChaptersBatch(
    @Param('bookId') bookId: string,
    @Body() dto: GenerateChaptersBatchDto,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.generateChaptersBatch(bookId, dto);
  }

  @Get('books/:bookId/chapters')
  @ApiOperation({ summary: '章节列表', description: '返回最近 N 章列表（倒序）' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async listChapters(
    @Param('bookId') bookId: string,
    @Query() query: ListChaptersDto,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.listChapters(bookId, query.limit ?? 50);
  }

  @Get('books/:bookId/generation-status')
  @ApiOperation({ summary: '查询生成状态', description: '返回书籍当前是否正在生成章节' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getGenerationStatus(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.progressService.isGenerating(bookId);
  }

  @Sse('books/:bookId/chapters/generate-sse')
  @ApiOperation({ summary: '生成章节（SSE）', description: '通过 SSE 流式推送章节生成进度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  async generateChapterSse(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<Observable<MessageEvent>> {
    await this.guard(bookId, userId);
    const subject = new Subject<MessageEvent>();
    const alreadyRunning = !this.progressService.markGenerating(bookId);

    const unsubscribe = this.progressService.subscribe(bookId, (event) => {
      subject.next({ data: event } as MessageEvent);
      if (event.done || event.error) setTimeout(() => subject.complete(), 100);
    });

    if (alreadyRunning) {
      const status = this.progressService.isGenerating(bookId);
      subject.next({ data: { reconnected: true, message: '已重连到正在进行的生成任务', ...status } } as MessageEvent);
      return subject.asObservable();
    }

    setTimeout(async () => {
      try {
        await this.novelService.generateChapter(bookId);
      } catch (err: any) {
        subject.next({ data: { done: true, error: err.message } } as MessageEvent);
        subject.complete();
      } finally {
        this.progressService.clearGenerating(bookId);
        unsubscribe();
      }
    }, 0);

    return subject.asObservable();
  }

  @Get('books/:bookId/chapters/:chapterNumber')
  @ApiOperation({ summary: '获取指定章节', description: '返回章节完整内容' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiParam({ name: 'chapterNumber', description: '章节序号' })
  @ApiResponse({ status: 200, description: '成功' })
  async getChapter(
    @Param('bookId') bookId: string,
    @Param('chapterNumber', ParseIntPipe) chapterNumber: number,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getChapter(bookId, chapterNumber);
  }

  @Get('books/:bookId/chapters/:chapterNumber/artifacts')
  @ApiOperation({ summary: '查询章节产物', description: '按名称查询指定章节的 artifacts' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiParam({ name: 'chapterNumber', description: '章节序号' })
  @ApiResponse({ status: 200, description: '成功' })
  async getChapterArtifacts(
    @Param('bookId') bookId: string,
    @Param('chapterNumber', ParseIntPipe) chapterNumber: number,
    @CurrentUser('id') userId: string,
    @Query('names') names?: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getChapterArtifacts(bookId, chapterNumber, names);
  }

  @Put('books/:bookId/chapters/:chapterNumber')
  @ApiOperation({ summary: '更新章节', description: '用户修改章节标题或内容后保存' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiParam({ name: 'chapterNumber', description: '章节序号' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateChapter(
    @Param('bookId') bookId: string,
    @Param('chapterNumber', ParseIntPipe) chapterNumber: number,
    @Body() body: { title?: string; content?: string; resyncState?: boolean },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.updateChapter(bookId, chapterNumber, body);
  }

  @Get('books/:bookId/chapter-resync-jobs/:jobId')
  @ApiOperation({ summary: '查询章节回灌任务', description: '查询异步章节回灌任务的状态和进度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiParam({ name: 'jobId', description: '回灌任务 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getChapterResyncJob(
    @Param('bookId') bookId: string,
    @Param('jobId') jobId: string,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getChapterResyncJob(bookId, jobId);
  }

  // ── World & Arc ───────────────────────────────────────────────────────────

  @Get('books/:bookId/world')
  @ApiOperation({ summary: '获取世界观数据', description: '返回书籍的角色、地点、关系图、力量体系等' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getWorld(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getWorld(bookId);
  }

  @Get('books/:bookId/arc-contract')
  @ApiOperation({ summary: '获取当前卷合同', description: '返回当前卷定义、验收状态与下一卷规划提示' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getArcContract(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getArcContract(bookId);
  }

  // ── 自动连载 ──────────────────────────────────────────────────────────────

  @Put('books/:bookId/auto-serialization')
  @ApiOperation({ summary: '配置自动连载', description: '设置按周期自动生成章节的调度参数' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '配置成功' })
  async configureAutoSerialization(
    @Param('bookId') bookId: string,
    @Body() dto: ConfigureAutoSerializationDto,
    @CurrentUser('id') userId: string,
  ): Promise<Record<string, unknown>> {
    await this.guard(bookId, userId);
    return this.autoSerializationService.configure(bookId, dto) as unknown as Promise<Record<string, unknown>>;
  }

  @Get('books/:bookId/auto-serialization')
  @ApiOperation({ summary: '获取自动连载配置', description: '查询当前书籍的自动连载调度配置' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getAutoSerialization(
    @Param('bookId') bookId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Record<string, unknown> | null> {
    await this.guard(bookId, userId);
    return this.autoSerializationService.get(bookId) as unknown as Promise<Record<string, unknown> | null>;
  }

  @Post('books/:bookId/auto-serialization/disable')
  @ApiOperation({ summary: '停用自动连载', description: '暂停指定书籍的自动连载调度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '已停用' })
  async disableAutoSerialization(
    @Param('bookId') bookId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Record<string, unknown>> {
    await this.guard(bookId, userId);
    return this.autoSerializationService.disable(bookId) as unknown as Promise<Record<string, unknown>>;
  }

  @Post('books/:bookId/auto-serialization/enable')
  @ApiOperation({ summary: '启用自动连载', description: '恢复指定书籍的自动连载调度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '已启用' })
  async enableAutoSerialization(
    @Param('bookId') bookId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Record<string, unknown>> {
    await this.guard(bookId, userId);
    return this.autoSerializationService.enable(bookId) as unknown as Promise<Record<string, unknown>>;
  }

  @Post('books/:bookId/auto-serialization/run-now')
  @ApiOperation({ summary: '立即执行自动连载', description: '手动触发一次自动连载运行' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '触发成功' })
  async runAutoSerializationNow(
    @Param('bookId') bookId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Record<string, unknown>> {
    await this.guard(bookId, userId);
    return this.autoSerializationService.runNow(bookId);
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────

  @Get('books/:bookId/pipeline')
  @ApiOperation({ summary: '获取 Agent Pipeline', description: '返回草稿和已发布的 pipeline 配置' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getPipeline(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.pipelineService.getPipeline(bookId);
  }

  @Put('books/:bookId/pipeline/draft')
  @ApiOperation({ summary: '保存 Pipeline 草稿', description: '保存节点配置为草稿，不影响生成' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '保存成功' })
  async savePipelineDraft(
    @Param('bookId') bookId: string,
    @Body() body: { nodes: AgentNodeConfig[] },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.pipelineService.saveDraft(bookId, body.nodes);
  }

  @Post('books/:bookId/pipeline/publish')
  @ApiOperation({ summary: '发布 Pipeline', description: '将草稿发布为生效配置' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '发布成功' })
  async publishPipeline(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.pipelineService.publish(bookId);
  }

  @Get('books/:bookId/pipeline/topology')
  @ApiOperation({ summary: '获取工作流完整拓扑', description: '返回反映后端真实执行逻辑的完整工作流拓扑描述' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getTopology(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.pipelineService.getTopology(bookId);
  }

  @Put('books/:bookId/pipeline/workflow-params')
  @ApiOperation({ summary: '更新工作流参数', description: '更新质量阈值、重写轮数等可配置参数' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async saveWorkflowParams(
    @Param('bookId') bookId: string,
    @Body() body: { qualityPassScore?: number; maxRepairRounds?: number; editorPolishThreshold?: number; longRangeMemoryThreshold?: number },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.pipelineService.saveWorkflowParams(bookId, body);
  }

  // ── Prompt Templates ──────────────────────────────────────────────────────

  @Get('books/:bookId/prompt-templates')
  @ApiOperation({ summary: '获取 Prompt 模板', description: '返回当前书籍的所有 Prompt 模板' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  async getPromptTemplates(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.promptTemplateService.getTemplates(bookId);
  }

  @Put('books/:bookId/prompt-templates/playbooks/:name')
  @ApiOperation({ summary: '更新 Playbook', description: '更新指定 Playbook 的内容' })
  async updatePlaybook(
    @Param('bookId') bookId: string,
    @Param('name') name: string,
    @Body() body: { content: string },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.promptTemplateService.updatePlaybook(bookId, name, body.content);
  }

  @Put('books/:bookId/prompt-templates/agents/:agentId/sections/:sectionKey')
  @ApiOperation({ summary: '更新 Agent Prompt 区块', description: '更新指定 Agent 的指定区块内容' })
  async updateAgentSection(
    @Param('bookId') bookId: string,
    @Param('agentId') agentId: string,
    @Param('sectionKey') sectionKey: string,
    @Body() body: { content: string },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.promptTemplateService.updateAgentSection(bookId, agentId, sectionKey, body.content);
  }

  @Post('books/:bookId/prompt-templates/reset')
  @ApiOperation({ summary: '重置 Prompt 模板', description: '将所有模板重置为系统默认值' })
  async resetPromptTemplates(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.promptTemplateService.resetToDefaults(bookId);
  }

  @Post('books/:bookId/prompt-templates/revert')
  @ApiOperation({ summary: '回滚编辑', description: '将指定历史记录的内容恢复到修改前的状态' })
  async revertPromptEdit(
    @Param('bookId') bookId: string,
    @Body() body: { historyIndex: number },
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.promptTemplateService.revertEdit(bookId, body.historyIndex);
  }

  // ── Workflow Executions ────────────────────────────────────────────────────

  @Get('books/:bookId/executions')
  @ApiOperation({ summary: '执行记录列表', description: '返回最近的工作流执行记录' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  async listExecutions(
    @Param('bookId') bookId: string,
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.executionService.listRuns(bookId, limit ? parseInt(limit, 10) : 20);
  }

  @Get('books/:bookId/chapters/:chapterNumber/execution')
  @ApiOperation({ summary: '章节最新执行记录', description: '返回指定章节最近一次的工作流执行数据' })
  async getChapterExecution(
    @Param('bookId') bookId: string,
    @Param('chapterNumber', ParseIntPipe) chapterNumber: number,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.executionService.getLatestRun(bookId, chapterNumber);
  }

  // ── Reader Feedback ───────────────────────────────────────────────────────

  @Post('books/:bookId/feedback')
  @ApiOperation({ summary: '提交章节读者评论', description: '提交单章的平台评论+数据指标' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '提交成功' })
  async submitFeedback(
    @Param('bookId') bookId: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser('id') userId: string,
  ): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.submitChapterFeedback(bookId, {
      chapterNumber: dto.chapterNumber,
      comments: dto.comments as any,
      metrics: dto.metrics,
      submittedAt: new Date().toISOString(),
    });
  }

  @Post('books/:bookId/feedback/analyze')
  @ApiOperation({ summary: '手动触发反馈分析', description: '不管累积量，立刻对已有评论执行三层分析' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 201, description: '分析完成' })
  async triggerFeedbackAnalysis(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.triggerFeedbackAnalysis(bookId);
  }

  @Get('books/:bookId/feedback')
  @ApiOperation({ summary: '查看反馈分析状态', description: '获取当前反馈历史+最新分析+新鲜度' })
  @ApiParam({ name: 'bookId', description: '书籍唯一 ID' })
  @ApiResponse({ status: 200, description: '成功' })
  async getFeedbackState(@Param('bookId') bookId: string, @CurrentUser('id') userId: string): Promise<unknown> {
    await this.guard(bookId, userId);
    return this.novelService.getFeedbackState(bookId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildInitialAutoSerializationConfig(dto: CreateBookDto): ConfigureAutoSerializationDto | null {
    const enabled = dto.autoSerializationEnabled ?? true;
    if (!enabled) return null;
    return {
      dailyStartTime: dto.autoSerializationDailyStartTime ?? '08:00',
      runEveryDays: Math.max(1, dto.autoSerializationRunEveryDays ?? 1),
      chaptersPerRun: Math.max(1, dto.autoSerializationChaptersPerRun ?? 3),
      maxRepairRounds: Math.max(1, dto.autoSerializationMaxRepairRounds ?? 2),
      minQualityScore: Math.max(dto.autoSerializationMinQualityScore ?? 7, 7),
      minOverallScore: Math.max(dto.autoSerializationMinOverallScore ?? 7, 7),
    };
  }

  private async attachInitialAutoSerialization(created: unknown, dto: CreateBookDto): Promise<unknown> {
    const result = (created ?? {}) as Record<string, unknown>;
    const bookId = typeof result.bookId === 'string' ? result.bookId : null;
    const config = this.buildInitialAutoSerializationConfig(dto);
    if (!bookId) return created;
    if (!config) return { ...result, autoSerialization: { enabled: false, status: 'disabled_by_user' } };
    try {
      const schedule = await this.autoSerializationService.configure(bookId, config);
      return { ...result, autoSerialization: { enabled: true, status: 'configured', schedule } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[createBook] 初始化自动连载失败 bookId=${bookId}: ${message}`);
      return { ...result, autoSerialization: { enabled: true, status: 'failed', error: message, requested: config } };
    }
  }
}
