/** 创建小说会话管理 — 纯 DB 驱动，无内存缓存 */
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
      const existing = await this.repo.findOneBy({ idempotencyKey: key });
      if (existing) {
        const record = this.toRecord(existing);
        if (record.status === 'running') { // 重启恢复：running 进程已死，重置为 queued
          await this.repo.update({ progressChannel: record.progressChannel }, { status: 'queued' });
          record.status = 'queued';
          record.updatedAt = Date.now();
        }
        return { session: record, reused: true };
      }
    }
    const progressChannel = randomUUID();
    const entity = this.repo.create({
      progressChannel, userId: userId ?? null, status: 'queued',
      idempotencyKey: key, dtoJson: dto as unknown as Record<string, unknown>,
      resultJson: null, error: null,
    });
    await this.repo.save(entity);
    return { session: this.toRecord(entity), reused: false };
  }

  async get(progressChannel: string): Promise<CreateBookSessionRecord | null> {
    const entity = await this.repo.findOneBy({ progressChannel });
    if (!entity) return null;
    const record = this.toRecord(entity);
    if (record.status === 'running') { // 重启恢复
      await this.repo.update({ progressChannel }, { status: 'queued' });
      record.status = 'queued';
      record.updatedAt = Date.now();
    }
    return record;
  }

  async markRunning(progressChannel: string): Promise<CreateBookSessionRecord | null> {
    const result = await this.repo.createQueryBuilder()
      .update(CreateBookSessionEntity)
      .set({ status: 'running' })
      .where('progress_channel = :progressChannel', { progressChannel })
      .andWhere('status = :status', { status: 'queued' })
      .execute();
    if (result.affected === 0) {
      const entity = await this.repo.findOneBy({ progressChannel });
      return entity ? this.toRecord(entity) : null;
    }
    const entity = await this.repo.findOneBy({ progressChannel });
    return entity ? this.toRecord(entity) : null;
  }

  async markCompleted(progressChannel: string, result: Record<string, unknown>): Promise<void> {
    await this.repo.update({ progressChannel }, { status: 'completed', resultJson: result, error: null });
  }

  async markFailed(progressChannel: string, message: string): Promise<void> {
    await this.repo.update({ progressChannel }, { status: 'failed', error: message });
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
    return affected ?? 0;
  }
}
