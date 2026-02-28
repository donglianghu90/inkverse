import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { randomUUID } from 'crypto';
import { CreateBookDto } from './dto/create-book.dto';
import { CreateBookSessionEntity } from './entities/create-book-session.entity';

type CreateSessionStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CreateBookSessionRecord {
  progressChannel: string;
  dto: CreateBookDto;
  userId: string | null;
  status: CreateSessionStatus;
  idempotencyKey: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CreateBookSessionService {
  private readonly logger = new Logger(CreateBookSessionService.name);
  private readonly cache = new Map<string, CreateBookSessionRecord>(); // 内存热缓存
  private readonly idempotencyIndex = new Map<string, string>(); // idempotencyKey → progressChannel

  constructor(
    @InjectRepository(CreateBookSessionEntity)
    private readonly repo: Repository<CreateBookSessionEntity>,
  ) {}

  async createOrReuse(dto: CreateBookDto, idempotencyKey?: string, userId?: string): Promise<{
    session: CreateBookSessionRecord;
    reused: boolean;
  }> {
    const key = idempotencyKey?.trim() || null;
    if (key) {
      const cached = this.idempotencyIndex.get(key);
      if (cached) {
        const existing = this.cache.get(cached);
        if (existing) {
          existing.updatedAt = Date.now();
          this.persistAsync(existing);
          return { session: existing, reused: true };
        }
        this.idempotencyIndex.delete(key);
      }
      const dbEntity = await this.repo.findOneBy({ idempotencyKey: key });
      if (dbEntity) {
        const record = this.toRecord(dbEntity);
        if (record.status === 'running') { record.status = 'queued'; record.updatedAt = Date.now(); this.persistAsync(record); }
        this.cache.set(record.progressChannel, record);
        this.idempotencyIndex.set(key, record.progressChannel);
        return { session: record, reused: true };
      }
    }

    const progressChannel = randomUUID();
    const session: CreateBookSessionRecord = {
      progressChannel, dto: Object.assign(new CreateBookDto(), dto),
      userId: userId ?? null, status: 'queued', idempotencyKey: key,
      result: null, error: null, createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.cache.set(progressChannel, session);
    if (key) this.idempotencyIndex.set(key, progressChannel);
    this.persistAsync(session);
    return { session, reused: false };
  }

  get(progressChannel: string): CreateBookSessionRecord | null {
    const cached = this.cache.get(progressChannel);
    if (cached) return cached;
    return null; // DB 异步回填由 getAsync 处理
  }

  async getAsync(progressChannel: string): Promise<CreateBookSessionRecord | null> {
    const cached = this.cache.get(progressChannel);
    if (cached) return cached;
    const entity = await this.repo.findOneBy({ progressChannel });
    if (!entity) return null;
    const record = this.toRecord(entity);
    if (record.status === 'running') { // 重启恢复：running 状态的创建进程已死，重置为 queued 可重试
      record.status = 'queued';
      record.updatedAt = Date.now();
      this.persistAsync(record);
    }
    this.cache.set(progressChannel, record);
    if (record.idempotencyKey) this.idempotencyIndex.set(record.idempotencyKey, progressChannel);
    return record;
  }

  markRunning(progressChannel: string): CreateBookSessionRecord | null {
    const session = this.cache.get(progressChannel);
    if (!session) return null;
    if (session.status !== 'queued') return session;
    session.status = 'running';
    session.updatedAt = Date.now();
    this.persistAsync(session);
    return session;
  }

  markCompleted(progressChannel: string, result: Record<string, unknown>): void {
    const session = this.cache.get(progressChannel);
    if (!session) return;
    session.status = 'completed';
    session.result = result;
    session.error = null;
    session.updatedAt = Date.now();
    this.persistAsync(session);
  }

  markFailed(progressChannel: string, message: string): void {
    const session = this.cache.get(progressChannel);
    if (!session) return;
    session.status = 'failed';
    session.error = message;
    session.updatedAt = Date.now();
    this.persistAsync(session);
  }

  private persistAsync(record: CreateBookSessionRecord): void {
    this.repo.upsert({
      progressChannel: record.progressChannel,
      userId: record.userId,
      status: record.status,
      idempotencyKey: record.idempotencyKey,
      dtoJson: record.dto as unknown as Record<string, unknown>,
      resultJson: record.result,
      error: record.error,
    }, ['progressChannel']).catch((err) =>
      this.logger.warn(`会话持久化失败 channel=${record.progressChannel}: ${err}`),
    );
  }

  private toRecord(entity: CreateBookSessionEntity): CreateBookSessionRecord {
    return {
      progressChannel: entity.progressChannel,
      dto: Object.assign(new CreateBookDto(), entity.dtoJson),
      userId: entity.userId,
      status: entity.status as CreateSessionStatus,
      idempotencyKey: entity.idempotencyKey,
      result: entity.resultJson,
      error: entity.error,
      createdAt: entity.createdAt.getTime(),
      updatedAt: entity.updatedAt.getTime(),
    };
  }

  async cleanupExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - SESSION_TTL_MS);
    const { affected } = await this.repo.delete({ updatedAt: LessThan(cutoff) });
    for (const [ch, rec] of this.cache.entries()) {
      if (Date.now() - rec.updatedAt > SESSION_TTL_MS) {
        this.cache.delete(ch);
        if (rec.idempotencyKey) this.idempotencyIndex.delete(rec.idempotencyKey);
      }
    }
    return affected ?? 0;
  }
}
