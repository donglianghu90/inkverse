/** 短剧进度推送服务 — EventEmitter 驱动，支持创建进度 + 逐集生成进度 */
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type DramaRunType = 'create' | 'episode' | 'media' | 'images';
export type DramaTerminalStatus = 'success' | 'failed' | 'paused';

export interface DramaProgressEvent {
  _type: 'progress';
  dramaId: string;
  runType: DramaRunType; // 创建 / 逐集生成 / 媒体生成 / 分镜图批量生成
  episodeNumber?: number;
  step: string;
  stepKey?: string; // 语义步骤键（如 reviewed / edited）
  nodeId?: string; // pipeline 节点 id（如 dialogue-coach）
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  skipped?: boolean; // 本步骤是否跳过
  skipReason?: string; // 跳过原因（如 pipeline_disabled）
  terminal: boolean;
  terminalStatus?: DramaTerminalStatus;
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

  emit(event: Omit<DramaProgressEvent, '_type' | 'terminal'> & { terminal?: boolean }): void {
    const payload: DramaProgressEvent = {
      ...event,
      _type: 'progress',
      terminal: event.terminal ?? false,
    };
    const keys = [`${payload.dramaId}:generate`];
    if (payload.runType === 'media' && payload.episodeNumber) keys.push(`${payload.dramaId}:media:${payload.episodeNumber}`);
    if (payload.runType === 'images' && payload.episodeNumber) keys.push(`${payload.dramaId}:images:${payload.episodeNumber}`);
    for (const k of keys) {
      const a = this.active.get(k);
      if (a) {
        a.lastStep = payload.message ?? payload.step;
        if (payload.totalSteps > 0) {
          a.progress = Math.round(((payload.stepIndex + (payload.done ? 1 : 0.5)) / payload.totalSteps) * 100);
        }
      }
    }
    this.emitter.emit(`progress:${payload.dramaId}`, payload);
  }

  subscribe(dramaId: string, listener: (event: DramaProgressEvent) => void): () => void {
    this.emitter.on(`progress:${dramaId}`, listener);
    return () => this.emitter.removeListener(`progress:${dramaId}`, listener);
  }
}
