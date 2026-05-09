/**
 * Apimart GPT-Image-2 图片生成 Provider（T2I / I2I）
 *
 * 异步任务模式：
 *   1. POST /v1/images/generations → 返回 task_id
 *   2. GET  /v1/tasks/{task_id}    → 轮询直到 completed / failed
 *
 * 特性：
 *   - 支持 13 种比例（size）+ 3 档分辨率（resolution: 1k/2k/4k）
 *   - 图生图：通过 image_urls 数组传入参考图（URL 或 base64 data URI），最多 16 张
 *   - 内置轮询逻辑，首次查询延迟 → 固定间隔 → 超时保护
 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';

export interface ApimartImageConfig {
  apiKey: string;
  baseUrl: string;              // 默认 https://api.apimart.ai
  defaultSize: string;          // 默认 '1:1'
  defaultResolution: string;    // 默认 '2k'
  /** 首次查询延迟（ms），建议 10~20s */
  pollInitialDelayMs: number;
  /** 轮询间隔（ms），建议 3~5s */
  pollIntervalMs: number;
  /** 任务超时（ms），默认 300s */
  taskTimeoutMs: number;
}

/** 提交生成任务的响应 */
interface ApimartSubmitResponse {
  code: number;
  data?: Array<{ status: string; task_id: string }>;
  error?: { code: number; message: string; type: string };
}

/** 查询任务状态的响应 */
interface ApimartTaskResponse {
  code: number;
  data?: {
    id: string;
    status: 'submitted' | 'processing' | 'completed' | 'failed' | 'pending' | 'cancelled';
    progress: number;
    result?: {
      images?: Array<{
        url: string[];
        expires_at: number;
      }>;
    };
    error?: { code: number; message: string; type: string };
    created: number;
    completed?: number;
    estimated_time?: number;
    actual_time?: number;
  };
  error?: { code: number; message: string; type: string };
}

export class ApimartImageProvider implements ImageProvider {
  readonly name = 'apimart.gpt-image-2';
  readonly capabilities: ReadonlySet<ImageCapability> = new Set(['t2i', 'i2i', 'multi-ref']);
  private readonly logger = new Logger('ApimartImage');
  private readonly http: AxiosInstance;

  constructor(private readonly config: ApimartImageConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const t0 = Date.now();

    // ── 构建请求体 ────────────────────────────────────────────────────────
    const size = (req.extra?.size as string) || req.size || this.config.defaultSize;
    const resolution = (req.extra?.resolution as string) || this.config.defaultResolution;

    const body: Record<string, unknown> = {
      model: 'gpt-image-2',
      prompt: req.prompt,
      n: 1,
      size: this.normalizeSize(size),
      resolution,
    };

    // I2I 模式：收集参考图 URL / base64
    const imageUrls = this.collectImageUrls(req);
    if (imageUrls.length) {
      body.image_urls = imageUrls;
    }

    this.logger.log(
      `提交任务: size=${body.size} resolution=${resolution}` +
      (imageUrls.length ? ` refImages=${imageUrls.length}张` : '') +
      ` prompt=${(req.prompt ?? '').slice(0, 80)}…`,
    );

    // ── 提交任务 ─────────────────────────────────────────────────────────
    const submitRes = await this.http.post<ApimartSubmitResponse>('/v1/images/generations', body);

    if (submitRes.data.code !== 200 || !submitRes.data.data?.[0]?.task_id) {
      const errMsg = submitRes.data.error?.message ?? JSON.stringify(submitRes.data).slice(0, 200);
      throw new Error(`Apimart 提交失败: ${errMsg}`);
    }

    const taskId = submitRes.data.data[0].task_id;
    this.logger.log(`任务已提交: taskId=${taskId}，等待轮询…`);

    // ── 轮询等待结果 ─────────────────────────────────────────────────────
    const result = await this.pollForResult(taskId);

    const images = this.parseResultImages(result);
    const durationMs = Date.now() - t0;
    this.logger.log(`图片生成完成: ${images.length}张 taskId=${taskId} (${durationMs}ms)`);

    return {
      images,
      provider: this.name,
      model: 'gpt-image-2',
      durationMs,
      raw: result,
    };
  }

  // ── 轮询逻辑 ──────────────────────────────────────────────────────────

  private async pollForResult(taskId: string): Promise<ApimartTaskResponse['data']> {
    const { pollInitialDelayMs, pollIntervalMs, taskTimeoutMs } = this.config;
    const deadline = Date.now() + taskTimeoutMs;

    // 首次查询延迟（文档建议提交后等待 10~20s）
    await this.sleep(pollInitialDelayMs);

    while (Date.now() < deadline) {
      let taskRes: ApimartTaskResponse;
      try {
        const resp = await this.http.get<ApimartTaskResponse>(`/v1/tasks/${taskId}`, {
          params: { language: 'zh' },
        });
        taskRes = resp.data;
      } catch (err: any) {
        this.logger.warn(`轮询请求失败: taskId=${taskId} ${err?.message}`);
        await this.sleep(pollIntervalMs);
        continue;
      }

      // API 错误响应
      if (taskRes.error) {
        throw new Error(`Apimart 任务查询错误: code=${taskRes.error.code} ${taskRes.error.message}`);
      }

      const data = taskRes.data;
      if (!data) {
        this.logger.warn(`轮询响应无 data: taskId=${taskId}`);
        await this.sleep(pollIntervalMs);
        continue;
      }

      const age = Math.round((Date.now() - data.created * 1000) / 1000);

      switch (data.status) {
        case 'completed':
          this.logger.log(`任务完成: taskId=${taskId} actual_time=${data.actual_time}s`);
          return data;

        case 'failed':
          throw new Error(
            `Apimart 任务失败: taskId=${taskId} ${data.error?.message ?? 'unknown error'}`,
          );

        case 'cancelled':
          throw new Error(`Apimart 任务已取消: taskId=${taskId}`);

        default:
          // submitted / pending / processing — 继续等待
          this.logger.debug(
            `任务进行中: taskId=${taskId} status=${data.status} progress=${data.progress}% age=${age}s`,
          );
      }

      await this.sleep(pollIntervalMs);
    }

    throw new Error(`Apimart 任务超时 ${taskTimeoutMs / 1000}s: taskId=${taskId}`);
  }

  // ── 工具方法 ──────────────────────────────────────────────────────────

  /**
   * 收集参考图 URL 列表（I2I 模式）。
   * 支持 http(s):// URL 和 base64 data URI，最多 16 张。
   */
  private collectImageUrls(req: ImageGenerationRequest): string[] {
    if (!req.referenceImages?.length) return [];
    return req.referenceImages
      .map(img => {
        if (img.url && /^https?:\/\//.test(img.url)) return img.url;
        if (img.base64) {
          // 已经是完整 data URI 格式则直接使用，否则补上前缀
          if (img.base64.startsWith('data:')) return img.base64;
          return `data:image/png;base64,${img.base64}`;
        }
        return '';
      })
      .filter(Boolean)
      .slice(0, 16);
  }

  /**
   * 将 size 规格化为 Apimart 支持的比例格式。
   * Apimart 原生支持：auto, 1:1, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 16:9, 9:16, 2:1, 1:2, 21:9, 9:21
   */
  private normalizeSize(size: string): string {
    // 已经是比例格式，直接返回
    if (/^\d+:\d+$/.test(size) || size === 'auto') return size;

    // 像素格式 "1024x1024" → 换算最近比例
    const m = size.match(/^(\d+)[xX×](\d+)$/);
    if (m) {
      const w = parseInt(m[1]), h = parseInt(m[2]);
      const ratio = w / h;
      if (ratio > 2.0) return '21:9';
      if (ratio > 1.7) return '16:9';
      if (ratio > 1.4) return '3:2';
      if (ratio > 1.2) return '4:3';
      if (ratio > 1.1) return '5:4';
      if (ratio > 0.9) return '1:1';
      if (ratio > 0.8) return '4:5';
      if (ratio > 0.7) return '3:4';
      if (ratio > 0.6) return '2:3';
      if (ratio > 0.5) return '9:16';
      return '9:21';
    }

    return '1:1';
  }

  /** 解析任务结果中的图片 URL */
  private parseResultImages(data: ApimartTaskResponse['data']): Array<{ url: string }> {
    if (!data?.result?.images?.length) return [];
    return data.result.images.flatMap(img =>
      (img.url ?? []).map(url => ({ url })),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
