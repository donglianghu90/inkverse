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
  nodeId?: string;          // 对应拓扑图节点 ID
  loopAttempt?: number;     // 质量门控当前轮次
  score?: number;           // 当前分数
  durationMs?: number;      // 当前步骤耗时 ms
  skipped?: boolean;        // 是否被跳过
  phase?: string;           // 当前阶段 ID (preparation/quality_loop/post_process/recording)
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
}
