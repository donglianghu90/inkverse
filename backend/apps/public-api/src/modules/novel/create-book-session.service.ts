import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateBookDto } from './dto/create-book.dto';

type CreateSessionStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface CreateBookSessionRecord {
  progressChannel: string;
  dto: CreateBookDto;
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
  private readonly byProgressChannel = new Map<string, CreateBookSessionRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();

  createOrReuse(dto: CreateBookDto, idempotencyKey?: string): {
    session: CreateBookSessionRecord;
    reused: boolean;
  } {
    this.cleanupExpiredSessions();
    const key = idempotencyKey?.trim() || null;
    if (key) {
      const progressChannel = this.byIdempotencyKey.get(key);
      if (progressChannel) {
        const existing = this.byProgressChannel.get(progressChannel);
        if (existing) {
          existing.updatedAt = Date.now();
          return { session: existing, reused: true };
        }
        this.byIdempotencyKey.delete(key);
      }
    }

    const progressChannel = randomUUID();
    const session: CreateBookSessionRecord = {
      progressChannel,
      dto: Object.assign(new CreateBookDto(), dto),
      status: 'queued',
      idempotencyKey: key,
      result: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.byProgressChannel.set(progressChannel, session);
    if (key) {
      this.byIdempotencyKey.set(key, progressChannel);
    }
    return { session, reused: false };
  }

  get(progressChannel: string): CreateBookSessionRecord | null {
    this.cleanupExpiredSessions();
    return this.byProgressChannel.get(progressChannel) ?? null;
  }

  markRunning(progressChannel: string): CreateBookSessionRecord | null {
    const session = this.byProgressChannel.get(progressChannel);
    if (!session) return null;
    if (session.status !== 'queued') return session;
    session.status = 'running';
    session.updatedAt = Date.now();
    return session;
  }

  markCompleted(progressChannel: string, result: Record<string, unknown>): void {
    const session = this.byProgressChannel.get(progressChannel);
    if (!session) return;
    session.status = 'completed';
    session.result = result;
    session.error = null;
    session.updatedAt = Date.now();
  }

  markFailed(progressChannel: string, message: string): void {
    const session = this.byProgressChannel.get(progressChannel);
    if (!session) return;
    session.status = 'failed';
    session.error = message;
    session.updatedAt = Date.now();
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [progressChannel, session] of this.byProgressChannel.entries()) {
      if (now - session.updatedAt <= SESSION_TTL_MS) continue;
      this.byProgressChannel.delete(progressChannel);
      if (session.idempotencyKey) {
        const mapped = this.byIdempotencyKey.get(session.idempotencyKey);
        if (mapped === progressChannel) {
          this.byIdempotencyKey.delete(session.idempotencyKey);
        }
      }
    }
  }
}

