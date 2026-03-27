/** Google Veo 3.1 视频生成 Provider (via kie.ai API)
 *
 *  API 基础信息：
 *    提交: POST /api/v1/veo/generate
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与 Kling / Hailuo 共享同一 apiKey）
 *
 *  核心能力：
 *    · T2V + I2V（首帧/尾帧插值，FIRST_AND_LAST_FRAMES_2_VIDEO）
 *    · 参考图生成（REFERENCE_2_VIDEO，1-3 张，仅 veo3_fast 支持）
 *    · 原生音频（默认开启背景音频）
 *    · model: veo3（最高画质）/ veo3_fast（快速 + 支持 REFERENCE_2_VIDEO）
 *    · aspect_ratio: 16:9 / 9:16 / Auto
 *    · 输出：1080P（默认），4K 需额外积分
 *    · enableTranslation: 默认开启多语言翻译
 *
 *  短剧路由场景：
 *    golden tier + wide/宏大叙事/关键高潮镜头 → Veo（画质天花板）
 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  VideoProvider, VideoCapability,
  VideoGenerationRequest, VideoSubmitResult,
  VideoTaskResult, VideoTaskStatus,
} from '../../interfaces/media-provider.interface';
import { kieAiRateLimitAcquireQuery, kieAiRateLimitAcquireSubmit } from '../kieai/kieai-rate-limiter';

export interface VeoVideoConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** 'veo3'（最高画质）/ 'veo3_fast'（快速 + 支持 REFERENCE_2_VIDEO） */
  defaultModel?: 'veo3' | 'veo3_fast';
  defaultAspectRatio?: '16:9' | '9:16';
  enableTranslation?: boolean;
}

// ─── 内部 API 响应类型 ─────────────────────────────────────────────────────────

interface VeoCreateResponse {
  code: number;
  msg?: string;
  data?: { taskId: string };
}

interface VeoTaskData {
  taskId: string;
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail' | string;
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
}

interface VeoQueryResponse {
  code: number;
  msg?: string;
  data?: VeoTaskData;
}

interface VeoResultJson {
  resultUrls?: string[];
  videoUrl?: string;
  url?: string;
  coverUrl?: string;
  info?: {
    resultUrls?: string | string[];
    originUrls?: string | string[];
    resolution?: string;
  };
}

// ─── 状态映射 ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, VideoTaskStatus> = {
  waiting: 'pending',
  queuing: 'pending',
  generating: 'processing',
  success: 'completed',
  fail: 'failed',
};

// ─── generationType 自动推断 ────────────────────────────────────────────────────

type VeoGenerationType = 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' | 'REFERENCE_2_VIDEO';

// ─── Provider 实现 ─────────────────────────────────────────────────────────────

export class VeoVideoProvider implements VideoProvider {
  readonly name = 'veo';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['t2v', 'i2v', 'multi-ref', 'audio-gen']);
  private readonly logger = new Logger('VeoVideo');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<VeoVideoConfig>;

  constructor(config: VeoVideoConfig) {
    this.cfg = {
      apiKey:             config.apiKey,
      baseUrl:            config.baseUrl,
      callBackUrl:        config.callBackUrl ?? '',
      defaultModel:       config.defaultModel ?? 'veo3_fast',
      defaultAspectRatio: config.defaultAspectRatio ?? '16:9',
      enableTranslation:  config.enableTranslation ?? true,
    };
    this.http = axios.create({
      baseURL: this.cfg.baseUrl,
      timeout: 60_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
    });
  }

  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    const model = (req.extra?.model as 'veo3' | 'veo3_fast' | undefined) ?? this.cfg.defaultModel;
    const aspectRatio = this.resolveAspectRatio(req.aspectRatio);

    // ── 参考图分类 ──────────────────────────────────────────────────────────────
    const firstFrameUrl = req.referenceImages?.find(r => r.role === 'first_frame')?.url;
    const lastFrameUrl  = req.referenceImages?.find(r => r.role === 'last_frame')?.url;
    const characterUrls = (req.referenceImages ?? [])
      .filter(r => r.role === 'character' || r.role === 'style')
      .map(r => r.url)
      .slice(0, 3);

    // ── 推断 generationType ─────────────────────────────────────────────────────
    let generationType: VeoGenerationType;
    const imageUrls: string[] = [];

    if (characterUrls.length > 0 && model === 'veo3_fast') {
      // REFERENCE_2_VIDEO：仅 veo3_fast 支持，1-3 张参考图
      generationType = 'REFERENCE_2_VIDEO';
      imageUrls.push(...characterUrls);
    } else if (firstFrameUrl || lastFrameUrl) {
      // FIRST_AND_LAST_FRAMES_2_VIDEO：1-2 张帧图
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO';
      if (firstFrameUrl) imageUrls.push(firstFrameUrl);
      if (lastFrameUrl)  imageUrls.push(lastFrameUrl);
    } else {
      generationType = 'TEXT_2_VIDEO';
    }

    // ── 构建请求体 ─────────────────────────────────────────────────────────────
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      model,
      generationType,
      aspect_ratio: aspectRatio,
      enableTranslation: this.cfg.enableTranslation,
    };

    if (imageUrls.length > 0) body.imageUrls = imageUrls;
    if (req.seed !== undefined && req.seed >= 10000 && req.seed <= 99999) {
      body.seeds = req.seed;
    }
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `提交 Veo 视频任务: model=${model} type=${generationType} ratio=${aspectRatio}` +
      (imageUrls.length ? ` images=${imageUrls.length}` : ''),
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<VeoCreateResponse>('/api/v1/veo/generate', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Veo generate 失败: code=${res.data.code} msg=${res.data.msg}`);
    }

    const taskId = res.data.data.taskId;
    this.logger.log(`Veo 视频任务已提交: taskId=${taskId}`);
    return { providerTaskId: taskId, provider: this.name, model };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    await kieAiRateLimitAcquireQuery();
    const res = await this.http.get<VeoQueryResponse>(
      '/api/v1/jobs/recordInfo',
      { params: { taskId: providerTaskId } },
    );

    if (res.data.code !== 200 || !res.data.data) {
      this.logger.warn(`Veo 查询响应异常: taskId=${providerTaskId} code=${res.data.code}`);
      return {
        providerTaskId,
        status: 'processing',
        provider: this.name,
        model: this.cfg.defaultModel,
        raw: res.data,
      };
    }

    const task = res.data.data;
    const status = STATUS_MAP[task.state] ?? 'processing';
    let videoUrl: string | undefined;
    let coverUrl: string | undefined;

    if (task.state === 'success' && task.resultJson) {
      try {
        const parsed = JSON.parse(task.resultJson) as VeoResultJson;
        // 优先从 info.resultUrls 提取（回调格式），兼容顶层 resultUrls
        const infoUrls = parsed.info?.resultUrls;
        if (typeof infoUrls === 'string') {
          try { videoUrl = JSON.parse(infoUrls)?.[0]; } catch { videoUrl = infoUrls; }
        } else if (Array.isArray(infoUrls)) {
          videoUrl = infoUrls[0];
        }
        if (!videoUrl) {
          videoUrl = parsed.resultUrls?.[0] ?? parsed.videoUrl ?? parsed.url;
        }
        coverUrl = parsed.coverUrl;
      } catch {
        this.logger.warn(`Veo resultJson 解析失败: taskId=${providerTaskId} raw=${task.resultJson?.slice(0, 200)}`);
      }
    }

    return {
      providerTaskId,
      status,
      provider: this.name,
      model: this.cfg.defaultModel,
      videoUrl,
      coverUrl,
      durationSeconds: 8,
      error: task.failMsg ?? undefined,
      raw: task,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    this.logger.warn(`Veo 暂不支持主动取消: taskId=${providerTaskId}`);
  }

  private resolveAspectRatio(ar?: string): '16:9' | '9:16' | 'Auto' {
    if (ar === '9:16') return '9:16';
    if (ar === '16:9') return '16:9';
    return this.cfg.defaultAspectRatio;
  }
}
