/**
 * Kie.ai 共享轮询服务
 *
 * 设计思路：
 *   所有 KieAiImageProvider 实例的 generate() 提交任务后，不再各自阻塞循环，
 *   而是向本服务注册一个 deferred Promise，然后返回等待。
 *   本服务每 POLL_INTERVAL_MS 执行一次 tick()，批量查询所有挂起任务的状态，
 *   找到完成/失败的任务后 resolve/reject 对应 Promise。
 *
 * 优点：
 *   - N 张图只有 1 个调度器，而非 N 个并发轮询循环
 *   - 统一速率控制，轮询与提交共享 20req/10s 配额
 *   - 超时由 300s 统一管理，生产环境更宽松
 *   - 未来可扩展为持久化（DB 存 taskId），服务重启后恢复
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@packages/modules';
import { KieAiTaskData } from './kieai-callback.service';
import { configureKieAiRateLimitsFromConfig, kieAiRateLimitAcquireQuery } from './kieai-rate-limiter';
import {
  KIE_AI_RECORD_INFO_FAIL_CODES,
  KIE_AI_RECORD_INFO_RETRY_CODES,
  KieAiRecordInfoResponse,
} from './kieai-record-info';

interface PendingEntry {
  resolve: (data: KieAiTaskData) => void;
  reject: (err: Error) => void;
  submittedAt: number;
  model: string;
  timeoutMs: number;
}

/** 每次 tick 最多处理的任务数（避免单次 tick 耗尽全部配额） */
const MAX_POLLS_PER_TICK = 15;
/** 默认 tick 间隔（ms） */
const DEFAULT_POLL_INTERVAL_MS = 10_000;
/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 300_000;

@Injectable()
export class KieAiPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('KieAiPolling');
  private readonly pending = new Map<string, PendingEntry>();
  private http!: AxiosInstance;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private defaultTimeoutMs = DEFAULT_TIMEOUT_MS;
  private timer?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const kieai = (media.kieai ?? {}) as Record<string, unknown>;
    configureKieAiRateLimitsFromConfig(kieai);
    const apiKey = String(kieai.apiKey || '');
    const baseUrl = String(kieai.baseUrl || 'https://api.kie.ai');

    this.pollIntervalMs = Number(kieai.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS;
    this.defaultTimeoutMs = Number(kieai.taskTimeoutMs) || DEFAULT_TIMEOUT_MS;

    if (apiKey) {
      this.http = axios.create({
        baseURL: baseUrl,
        timeout: 15_000,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      });
      this.timer = setInterval(() => { this.tick().catch(e => this.logger.error(`tick 异常: ${e?.message}`)); }, this.pollIntervalMs);
      this.logger.log(`KieAi 轮询调度器启动: interval=${this.pollIntervalMs}ms timeout=${this.defaultTimeoutMs / 1000}s maxPerTick=${MAX_POLLS_PER_TICK}`);
    } else {
      this.logger.debug('media.kieai.apiKey 未配置，跳过 KieAi 轮询调度器');
    }
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * 注册一个挂起任务，返回 Promise。
   * generate() 提交任务后调用此方法，等待结果而不阻塞。
   */
  waitForTask(taskId: string, model: string, timeoutMs?: number): Promise<KieAiTaskData> {
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<KieAiTaskData>((resolve, reject) => {
      // 超时兜底（定时器独立于 tick，确保任务一定不会永久挂起）
      const timer = setTimeout(() => {
        if (this.pending.delete(taskId)) {
          this.logger.warn(`任务超时: taskId=${taskId} model=${model} (${effectiveTimeout / 1000}s)`);
          reject(new Error(`Kie.ai 任务超时 ${effectiveTimeout / 1000}s: taskId=${taskId}`));
        }
      }, effectiveTimeout);

      this.pending.set(taskId, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
        submittedAt: Date.now(),
        model,
        timeoutMs: effectiveTimeout,
      });

      this.logger.debug(`任务已注册: taskId=${taskId} model=${model} pending=${this.pending.size}`);
    });
  }

  /** 当前挂起任务数（供监控/调试） */
  get pendingCount(): number { return this.pending.size; }

  // ── 核心调度 tick ──────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.pending.size === 0) return;

    // 按提交时间排序（优先处理等待最久的）
    const entries = [...this.pending.entries()]
      .sort(([, a], [, b]) => a.submittedAt - b.submittedAt)
      .slice(0, MAX_POLLS_PER_TICK);

    this.logger.debug(`tick: pending=${this.pending.size} 本次查询=${entries.length}`);

    for (const [taskId, entry] of entries) {
      // 每次 poll 也纳入全局速率限制
      await kieAiRateLimitAcquireQuery();

      let queryRes: KieAiRecordInfoResponse | undefined;
      try {
        const resp = await this.http.get<KieAiRecordInfoResponse>('/api/v1/jobs/recordInfo', {
          params: { taskId },
        });
        queryRes = resp.data;
      } catch (err: any) {
        this.logger.warn(`轮询请求失败: taskId=${taskId} ${err?.message}`);
        continue;
      }

      if (!queryRes.data) {
        if (queryRes.success === false) {
          this.pending.delete(taskId);
          const errMsg = queryRes.msg?.trim() || 'recordInfo success=false';
          this.logger.warn(`任务查询失败终止: taskId=${taskId} success=false msg=${errMsg}`);
          entry.reject(new Error(`Kie.ai ${errMsg}`));
          continue;
        }
        if (KIE_AI_RECORD_INFO_FAIL_CODES.has(queryRes.code)) {
          this.pending.delete(taskId);
          const errMsg = queryRes.msg?.trim() || `recordInfo code=${queryRes.code}`;
          this.logger.warn(`任务查询失败终止: taskId=${taskId} code=${queryRes.code} msg=${errMsg}`);
          entry.reject(new Error(`Kie.ai ${errMsg}`));
          continue;
        }
        if (KIE_AI_RECORD_INFO_RETRY_CODES.has(queryRes.code)) {
          this.logger.debug(`轮询暂可重试: taskId=${taskId} code=${queryRes.code} msg=${queryRes.msg}`);
          continue;
        }
        this.logger.warn(`轮询响应无 data: taskId=${taskId} code=${queryRes.code} msg=${queryRes.msg}`);
        continue;
      }

      const task = queryRes.data;
      const age = Math.round((Date.now() - entry.submittedAt) / 1000);

      if (task.state === 'success') {
        this.pending.delete(taskId);
        this.logger.log(`任务完成: taskId=${taskId} model=${entry.model} age=${age}s pending剩余=${this.pending.size}`);
        entry.resolve(task);
      } else if (task.state === 'fail') {
        this.pending.delete(taskId);
        this.logger.warn(`任务失败: taskId=${taskId} model=${entry.model} failCode=${task.failCode} failMsg=${task.failMsg}`);
        entry.reject(new Error(`Kie.ai 任务失败: taskId=${taskId} failCode=${task.failCode} failMsg=${task.failMsg}`));
      } else {
        // waiting / queuing / generating — 继续等待（Sora 等模型可能带 progress）
        const prog = task.progress != null ? ` progress=${task.progress}%` : '';
        this.logger.debug(`任务进行中: taskId=${taskId} state=${task.state} age=${age}s${prog}`);
      }
    }
  }
}
