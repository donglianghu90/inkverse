/** 短剧进度推送服务 — EventEmitter 驱动，支持创建进度 + 逐集生成进度 */
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface DramaProgressEvent {
  dramaId: string;
  phase: 'create' | 'episode'; // 创建阶段 or 逐集生成阶段
  episodeNumber?: number;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  error?: string;
}

export interface DramaGenerationStatus { generating: boolean; startedAt: number | null; lastStep: string | null; progress: number; }

@Injectable()
export class DramaProgressService {
  private readonly emitter = new EventEmitter();
  private readonly active = new Map<string, { startedAt: number; lastStep: string; progress: number }>();

  constructor() { this.emitter.setMaxListeners(200); }

  markGenerating(key: string): boolean {
    if (this.active.has(key)) return false;
    this.active.set(key, { startedAt: Date.now(), lastStep: '', progress: 0 });
    return true;
  }

  clearGenerating(key: string): void { this.active.delete(key); }

  isGenerating(key: string): DramaGenerationStatus {
    const a = this.active.get(key);
    return a ? { generating: true, startedAt: a.startedAt, lastStep: a.lastStep, progress: a.progress }
             : { generating: false, startedAt: null, lastStep: null, progress: 0 };
  }

  emit(event: DramaProgressEvent): void {
    const genKey = `${event.dramaId}:generate`;
    const a = this.active.get(genKey);
    if (a) {
      a.lastStep = event.message ?? event.step;
      if (event.totalSteps > 0) a.progress = Math.round(((event.stepIndex + (event.done ? 1 : 0.5)) / event.totalSteps) * 100);
    }
    this.emitter.emit(`progress:${event.dramaId}`, event);
  }

  subscribe(dramaId: string, listener: (event: DramaProgressEvent) => void): () => void {
    this.emitter.on(`progress:${dramaId}`, listener);
    return () => this.emitter.removeListener(`progress:${dramaId}`, listener);
  }
}
