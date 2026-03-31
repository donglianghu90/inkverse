/** DramaSseHelper — 统一 SSE 流创建逻辑，消除各端点的重复样板代码 */
import { Injectable, MessageEvent } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { DramaProgressEvent, DramaProgressService, DramaRunType } from './drama-progress.service';

export interface SseSender {
  (payload: Record<string, unknown>): void;
}

export interface SseStreamConfig {
  /** 短剧 ID */
  dramaId: string;
  /** 运行类型 */
  runType: DramaRunType;
  /** 互斥 key（用于 markGenerating 去重） */
  mutexKey: string;
  /** 重连时显示的信息文案 */
  reconnectMessage: string;
  /** 异步执行体 */
  executor: () => Promise<any>;
  /** 成功时的信息文案 */
  successMessage: string;
  /** 失败时的默认信息文案 */
  failMessage: string;
  /** 集号（可选，media/images 类型需要） */
  episodeNumber?: number;
  /** 是否过滤掉 terminal 事件（默认 true，终态由 result/error 统一发射） */
  filterTerminal?: boolean;
}

export interface PassiveStreamConfig {
  /** 短剧 ID */
  dramaId: string;
  /** 运行类型 */
  runType: DramaRunType;
  /** 集号（可选） */
  episodeNumber?: number;
}

@Injectable()
export class DramaSseHelper {
  constructor(private readonly progressService: DramaProgressService) {}

  /**
   * 创建一个「触发 + SSE 推送」流 — 用于 generate-sse / generate-media-sse / generate-images-sse / generate-all-assets-sse。
   * 统一处理：心跳、互斥、进度订阅、成功/失败终态、cleanup。
   */
  createActiveStream(config: SseStreamConfig): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, config.runType, config.dramaId, config.episodeNumber);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);
    const filterTerminal = config.filterTerminal !== false;

    const alreadyRunning = !this.progressService.markGenerating(config.mutexKey);
    const unsub = this.progressService.subscribe(config.dramaId, (event) => {
      if (event.runType !== config.runType) return;
      if (config.episodeNumber !== undefined && event.episodeNumber !== config.episodeNumber) return;
      if (filterTerminal && event.terminal) return;
      this.sendProgress(send, event);
    });

    if (alreadyRunning) {
      send({ _type: 'info', terminal: false, message: config.reconnectMessage });
      return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
    }

    setTimeout(async () => {
      try {
        const result = await config.executor();
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: result?.paused ? 'paused' : 'success',
          message: result?.message ?? config.successMessage,
          done: true,
          data: result ?? { message: config.successMessage },
        });
      } catch (err: any) {
        const msg = err?.message ?? config.failMessage;
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          message: msg,
          error: msg,
          done: true,
        });
      } finally {
        this.progressService.clearGenerating(config.mutexKey);
        clearInterval(heartbeat);
        unsub();
        setTimeout(() => subject.complete(), 200);
      }
    }, 0);

    return subject.asObservable();
  }

  /**
   * 创建一个「仅订阅进度」的被动流 — 用于 episode-progress-sse / create-sse。
   * 不触发执行，仅接收 progress / terminal 事件。
   */
  createPassiveStream(config: PassiveStreamConfig): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    const { send } = this.createSseSender(subject, config.runType, config.dramaId, config.episodeNumber);
    const heartbeat = setInterval(() => send({ _type: 'heartbeat', terminal: false }), 15_000);

    const unsub = this.progressService.subscribe(config.dramaId, (event) => {
      if (event.runType !== config.runType) return;
      if (!event.terminal) {
        this.sendProgress(send, event);
        return;
      }
      if (event.terminalStatus === 'failed' || event.error) {
        send({
          _type: 'error',
          terminal: true,
          terminalStatus: 'failed',
          step: event.step,
          message: event.error ?? event.message,
          error: event.error ?? event.message,
          done: true,
        });
      } else {
        send({
          _type: 'result',
          terminal: true,
          terminalStatus: event.terminalStatus ?? 'success',
          step: event.step,
          message: event.message,
          done: true,
          data: {
            step: event.step,
            message: event.message,
            terminalStatus: event.terminalStatus ?? 'success',
          },
        });
      }
      clearInterval(heartbeat);
      setTimeout(() => subject.complete(), 300);
    });

    return subject.asObservable().pipe(finalize(() => { clearInterval(heartbeat); unsub(); }));
  }

  // ── Private ──

  private createSseSender(subject: Subject<MessageEvent>, runType: DramaRunType, dramaId: string, episodeNumber?: number) {
    const runId = randomUUID();
    let seq = 0;
    const base = {
      runType,
      runId,
      dramaId,
      ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    };
    const send: SseSender = (payload: Record<string, unknown>) => {
      subject.next({
        data: {
          ...base,
          seq: ++seq,
          ts: Date.now(),
          ...payload,
        },
      } as MessageEvent);
    };
    return { runId, send };
  }

  private sendProgress(send: SseSender, event: DramaProgressEvent): void {
    send({
      _type: 'progress',
      step: event.step,
      ...(event.stepKey ? { stepKey: event.stepKey } : {}),
      ...(event.nodeId ? { nodeId: event.nodeId } : {}),
      stepIndex: event.stepIndex,
      totalSteps: event.totalSteps,
      message: event.message,
      done: event.done,
      ...(event.skipped !== undefined ? { skipped: event.skipped } : {}),
      ...(event.skipReason ? { skipReason: event.skipReason } : {}),
      terminal: false,
      ...(event.episodeNumber !== undefined ? { episodeNumber: event.episodeNumber } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.data ? { data: event.data } : {}),
    });
  }
}
