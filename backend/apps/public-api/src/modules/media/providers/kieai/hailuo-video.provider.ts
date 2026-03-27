/** Hailuo 2.3 Standard 图生视频 Provider (via kie.ai API)
 *
 *  API 基础信息：
 *    提交: POST /api/v1/jobs/createTask  { model: "hailuo/2-3-image-to-video-standard", input: {...} }
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与 Kling/图片 Provider 共享同一 apiKey）
 *
 *  核心特性：
 *    · 纯 I2V（首帧图生视频），仅支持单张 image_url（无法传多图或角色元素）
 *    · 面部情感表现力行业最优，最适合黄金档情感特写镜头
 *    · duration: 仅支持 '6' 或 '10'（1080P 不支持 10s，自动降级为 6s）
 *    · resolution: '768P'(默认) 或 '1080P'
 *
 *  短剧路由场景：
 *    golden tier + portrait/dialogue + close_up → Hailuo（情感特写最强）
 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  VideoProvider, VideoCapability,
  VideoGenerationRequest, VideoSubmitResult,
  VideoTaskResult,
} from '../../interfaces/media-provider.interface';
import {
  KieAiCreateTaskResponse,
  KieAiRecordInfoResponse,
  videoTaskResultFromKieAiRecordInfo,
} from './kieai-record-info';
import { kieAiRateLimitAcquireQuery, kieAiRateLimitAcquireSubmit } from './kieai-rate-limiter';

export interface HailuoVideoConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** '768P'(默认) 或 '1080P' */
  defaultResolution?: '768P' | '1080P';
  /** 默认时长，会被 snap 到 6 或 10（秒），默认 6 */
  defaultDuration?: number;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * Hailuo 只支持 6s 或 10s。
 * 1080P 不支持 10s（API 限制），此时强制 6s。
 */
function snapDuration(sec: number | undefined, def: number, resolution: '768P' | '1080P'): '6' | '10' {
  const n = Math.round(sec ?? def);
  if (resolution === '1080P') return '6';       // 1080P 仅支持 6s
  return n <= 7 ? '6' : '10';                   // ≤7s → 6s，>7s → 10s
}

function resolveResolution(
  quality?: string,
  extra?: Record<string, unknown>,
  defaultRes?: '768P' | '1080P',
): '768P' | '1080P' {
  if (extra?.resolution === '1080P') return '1080P';
  if (extra?.resolution === '768P')  return '768P';
  if (quality === '1080p')           return '1080P';
  return defaultRes ?? '768P';
}

// ─── Provider 实现 ─────────────────────────────────────────────────────────────

export class HailuoVideoProvider implements VideoProvider {
  readonly name = 'hailuo';
  /**
   * i2v：Hailuo 只做图生视频（必须有首帧）。
   * t2v 未声明 — 无首帧时请降级到 Seedance / Kling。
   */
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['i2v']);
  private readonly logger = new Logger('HailuoVideo');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<HailuoVideoConfig>;

  constructor(config: HailuoVideoConfig) {
    this.cfg = {
      apiKey:            config.apiKey,
      baseUrl:           config.baseUrl,
      callBackUrl:       config.callBackUrl ?? '',
      defaultResolution: config.defaultResolution ?? '768P',
      defaultDuration:   config.defaultDuration ?? 6,
    };
    this.http = axios.create({
      baseURL: this.cfg.baseUrl,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
    });
  }

  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    // Hailuo 必须有首帧图（纯 I2V）
    const firstFrame = req.referenceImages?.find(r => r.role === 'first_frame')?.url
      // 兼容：若调用方未设 role，取第一个 url
      ?? req.referenceImages?.[0]?.url;

    if (!firstFrame) {
      throw new Error('Hailuo I2V 需要首帧图（role: first_frame），当前无可用参考图，请降级到 T2V Provider');
    }

    const resolution = resolveResolution(req.quality, req.extra, this.cfg.defaultResolution);
    const duration   = snapDuration(req.duration, this.cfg.defaultDuration, resolution);

    const input: Record<string, unknown> = {
      prompt:     req.prompt,
      image_url:  firstFrame,
      duration,
      resolution,
    };

    const body: Record<string, unknown> = {
      model: 'hailuo/2-3-image-to-video-standard',
      input,
    };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `提交 Hailuo 视频任务: resolution=${resolution} duration=${duration}s` +
      ` firstFrame=${firstFrame.slice(0, 60)}...`,
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Hailuo createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }

    const taskId = res.data.data.taskId;
    this.logger.log(`Hailuo 视频任务已提交: taskId=${taskId}`);
    return { providerTaskId: taskId, provider: this.name, model: 'hailuo-2.3-standard' };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    await kieAiRateLimitAcquireQuery();
    const res = await this.http.get<KieAiRecordInfoResponse>(
      '/api/v1/jobs/recordInfo',
      { params: { taskId: providerTaskId } },
    );
    return videoTaskResultFromKieAiRecordInfo(
      res.data,
      { providerTaskId, provider: this.name, model: 'hailuo-2.3-standard' },
      this.logger,
    );
  }

  async cancel(providerTaskId: string): Promise<void> {
    this.logger.warn(`Hailuo 暂不支持主动取消: taskId=${providerTaskId}`);
  }
}
