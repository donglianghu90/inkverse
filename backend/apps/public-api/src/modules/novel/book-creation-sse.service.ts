/** 创建小说 SSE 生命周期管理 — 封装心跳、进度转发、结果推送、资源清理 */
import { BadRequestException, Injectable, Logger, MessageEvent } from '@nestjs/common';
import { Observable, ReplaySubject } from 'rxjs';
import { NovelProgressService } from './novel-progress.service';
import { CreateBookSessionService, CreateBookSessionRecord } from './create-book-session.service';
import { NovelService } from './novel.service';
import { AutoSerializationService } from './auto-serialization.service';
import { ConfigureAutoSerializationDto } from './dto/configure-auto-serialization.dto';
import { CreateBookDto } from './dto/create-book.dto';

const HEARTBEAT_MS = 15_000;

@Injectable()
export class BookCreationSseService {
  private readonly logger = new Logger(BookCreationSseService.name);

  constructor(
    private readonly progressService: NovelProgressService,
    private readonly sessionService: CreateBookSessionService,
    private readonly novelService: NovelService,
    private readonly autoSerializationService: AutoSerializationService,
  ) {}

  async observe(progressChannel: string): Promise<Observable<MessageEvent>> {
    if (!progressChannel?.trim()) throw new BadRequestException('progressChannel is required');
    const session = await this.sessionService.get(progressChannel);
    if (!session) throw new BadRequestException(`会话不存在或已过期（progressChannel=${progressChannel}），请重新调用 POST /books/create-session 创建会话`);

    const subject = new ReplaySubject<MessageEvent>(20);
    let finished = false;
    const heartbeat = setInterval(() => { if (!finished) subject.next({ data: { _type: 'heartbeat', ts: Date.now() } } as MessageEvent); }, HEARTBEAT_MS);
    const cleanups: Array<() => void> = [() => clearInterval(heartbeat)];
    const finish = () => {
      if (finished) return;
      finished = true;
      cleanups.forEach((fn) => fn());
      setTimeout(() => subject.complete(), 80);
    };

    if (session.status === 'completed') { // 已完成直接返回
      clearInterval(heartbeat);
      subject.next({ data: { result: session.result, _type: 'result' } } as MessageEvent);
      subject.complete();
      return subject.asObservable();
    }
    if (session.status === 'failed') { // 已失败直接返回
      clearInterval(heartbeat);
      subject.next({ data: { done: true, error: session.error ?? 'create book session failed' } } as MessageEvent);
      subject.complete();
      return subject.asObservable();
    }

    const unsubProgress = this.progressService.subscribe(progressChannel, (event) => { // 进度事件转发
      subject.next({ data: event } as MessageEvent);
    });
    cleanups.push(unsubProgress);

    const unsubResult = this.progressService.subscribeResult(progressChannel, (event) => { // 结果事件（替代轮询）
      if (event.result) subject.next({ data: { result: event.result, _type: 'result' } } as MessageEvent);
      else if (event.error) subject.next({ data: { done: true, error: event.error } } as MessageEvent);
      finish();
    });
    cleanups.push(unsubResult);

    const markResult = await this.sessionService.markRunning(progressChannel);
    const shouldStart = session.status === 'queued' && markResult?.status === 'running';
    if (!shouldStart) return subject.asObservable();

    setTimeout(() => this.runCreateBook(progressChannel, session), 0); // 后台执行创建
    return subject.asObservable();
  }

  private async runCreateBook(progressChannel: string, session: CreateBookSessionRecord): Promise<void> {
    try {
      this.logger.log(`[BookCreationSse] 开始创建新书 channel=${progressChannel}`);
      const created = await this.novelService.createBook(session.dto, { progressChannel, userId: session.userId });
      const result = await this.attachAutoSerialization(created, session.dto);
      await this.sessionService.markCompleted(progressChannel, result as Record<string, unknown>);
      this.progressService.emitResult(progressChannel, { result: result as Record<string, unknown> });
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[BookCreationSse] createBook 异常 channel=${progressChannel}: ${message}`);
      await this.sessionService.markFailed(progressChannel, message);
      this.progressService.emitResult(progressChannel, { error: message });
    }
  }

  private async attachAutoSerialization(created: unknown, dto: CreateBookDto): Promise<unknown> {
    const result = (created ?? {}) as Record<string, unknown>;
    const bookId = typeof result.bookId === 'string' ? result.bookId : null;
    if (!bookId) return created;
    const enabled = dto.autoSerializationEnabled ?? true;
    if (!enabled) return { ...result, autoSerialization: { enabled: false, status: 'disabled_by_user' } };
    const config: ConfigureAutoSerializationDto = {
      dailyStartTime: dto.autoSerializationDailyStartTime ?? '08:00',
      runEveryDays: Math.max(1, dto.autoSerializationRunEveryDays ?? 1),
      chaptersPerRun: Math.max(1, dto.autoSerializationChaptersPerRun ?? 3),
      maxRepairRounds: Math.max(1, dto.autoSerializationMaxRepairRounds ?? 2),
      minQualityScore: Math.max(dto.autoSerializationMinQualityScore ?? 7, 7),
      minOverallScore: Math.max(dto.autoSerializationMinOverallScore ?? 7, 7),
    };
    try {
      const schedule = await this.autoSerializationService.configure(bookId, config);
      return { ...result, autoSerialization: { enabled: true, status: 'configured', schedule } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[BookCreationSse] 初始化自动连载失败 bookId=${bookId}: ${message}`);
      return { ...result, autoSerialization: { enabled: true, status: 'failed', error: message, requested: config } };
    }
  }
}
