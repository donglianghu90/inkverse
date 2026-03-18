/**
 * Kie.ai 回调服务 — 以 deferred promise 将异步回调转为同步等待。
 * 回调到达时 resolve/reject 对应 provider 的 generate() 调用；
 * 若回调早于 waitForTask（极端竞态），结果暂存 30s 供后续取用。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface KieAiTaskData {
  taskId: string;
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail' | string;
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  completeTime?: number;
  costTime?: number;
  model?: string;
}

interface Deferred {
  resolve: (data: KieAiTaskData) => void;
  reject: (err: Error) => void;
}

/** 回调到达时 pending 中找不到对应 waiter 时的短暂缓存时长（ms） */
const EARLY_CALLBACK_TTL_MS = 30_000;

@Injectable()
export class KieAiCallbackService {
  private readonly logger = new Logger('KieAiCallback');

  /** taskId → 等待回调的 deferred */
  private readonly pending = new Map<string, Deferred>();

  /** 早于 waitForTask 到达的回调结果缓存 */
  private readonly earlyResults = new Map<string, KieAiTaskData>();

  /**
   * 注册对 taskId 的等待，返回一个 Promise：
   * - 回调成功到达 → resolve(data)
   * - 回调失败到达 → reject(Error)
   * - timeoutMs 超时 → reject(Error)
   */
  waitForTask(taskId: string, timeoutMs: number): Promise<KieAiTaskData> {
    // 回调已提前到达，直接返回
    const early = this.earlyResults.get(taskId);
    if (early) {
      this.earlyResults.delete(taskId);
      this.logger.debug(`回调已预先缓存: taskId=${taskId}`);
      return early.state === 'success'
        ? Promise.resolve(early)
        : Promise.reject(new Error(`Kie.ai 任务失败: failCode=${early.failCode} failMsg=${early.failMsg}`));
    }

    return new Promise<KieAiTaskData>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(taskId)) {
          this.logger.warn(`回调超时: taskId=${taskId} (${timeoutMs}ms)`);
          reject(new Error(`Kie.ai 回调超时: taskId=${taskId} 超过 ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(taskId, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
    });
  }

  /**
   * 回调控制器调用此方法通知任务完成。
   * @returns true = 找到等待的 waiter；false = 无 waiter（结果已缓存备用）
   */
  complete(taskId: string, data: KieAiTaskData): boolean {
    const deferred = this.pending.get(taskId);
    if (!deferred) {
      // 回调早于 waitForTask，暂存结果
      this.earlyResults.set(taskId, data);
      setTimeout(() => this.earlyResults.delete(taskId), EARLY_CALLBACK_TTL_MS);
      this.logger.warn(`收到回调但无等待方: taskId=${taskId} state=${data.state}（已缓存 ${EARLY_CALLBACK_TTL_MS / 1000}s）`);
      return false;
    }

    this.pending.delete(taskId);
    if (data.state === 'success') {
      deferred.resolve(data);
    } else {
      deferred.reject(new Error(`Kie.ai 任务失败: taskId=${taskId} failCode=${data.failCode} failMsg=${data.failMsg}`));
    }
    return true;
  }

  get pendingCount(): number { return this.pending.size; }
}
