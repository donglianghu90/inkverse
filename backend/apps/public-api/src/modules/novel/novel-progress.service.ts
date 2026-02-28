/** 进度推送服务 — EventEmitter 驱动，支持章节生成进度 + 创建结果事件 */
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface GenerationProgressEvent {
  bookId: string;
  chapterNumber: number;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  error?: string;
  nodeId?: string;
  loopAttempt?: number;
  score?: number;
  durationMs?: number;
  skipped?: boolean;
  phase?: string;
}

export interface CreateBookResultEvent { // 创建完成/失败的结果事件
  result?: Record<string, unknown>;
  error?: string;
}

export interface GenerationStatus { generating: boolean; startedAt: number | null; lastStep: string | null; progress: number; }

@Injectable()
export class NovelProgressService {
  private readonly emitter = new EventEmitter();
  private readonly activeGenerations = new Map<string, { startedAt: number; lastStep: string; progress: number }>();

  constructor() { this.emitter.setMaxListeners(100); }

  markGenerating(bookId: string): boolean {
    if (this.activeGenerations.has(bookId)) return false;
    this.activeGenerations.set(bookId, { startedAt: Date.now(), lastStep: '', progress: 0 });
    return true;
  }

  clearGenerating(bookId: string): void { this.activeGenerations.delete(bookId); }

  isGenerating(bookId: string): GenerationStatus {
    const active = this.activeGenerations.get(bookId);
    if (!active) return { generating: false, startedAt: null, lastStep: null, progress: 0 };
    return { generating: true, startedAt: active.startedAt, lastStep: active.lastStep, progress: active.progress };
  }

  emit(event: GenerationProgressEvent): void {
    const active = this.activeGenerations.get(event.bookId);
    if (active) {
      active.lastStep = event.message ?? event.step;
      if (event.totalSteps > 0) active.progress = Math.round(((event.stepIndex + (event.done ? 1 : 0.5)) / event.totalSteps) * 100);
    }
    if (event.done || event.error) this.activeGenerations.delete(event.bookId);
    this.emitter.emit(`progress:${event.bookId}`, event);
  }

  subscribe(bookId: string, listener: (event: GenerationProgressEvent) => void): () => void {
    this.emitter.on(`progress:${bookId}`, listener);
    return () => this.emitter.removeListener(`progress:${bookId}`, listener);
  }

  emitResult(channel: string, event: CreateBookResultEvent): void { // 推送创建结果到 SSE，替代轮询
    this.emitter.emit(`result:${channel}`, event);
  }

  subscribeResult(channel: string, listener: (event: CreateBookResultEvent) => void): () => void {
    this.emitter.on(`result:${channel}`, listener);
    return () => this.emitter.removeListener(`result:${channel}`, listener);
  }
}
