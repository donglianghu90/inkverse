/** Wan 2.2 Animate Replace — V2V 角色替换 Provider (via kie.ai API)
 *
 *  API 基础信息：
 *    提交: POST /api/v1/jobs/createTask  { model: "wan/2-2-animate-replace", input: {...} }
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与 Kling / Hailuo / Veo / Sora / Avatar 共享）
 *
 *  核心能力：
 *    · V2V（视频 + 角色图 → 角色替换视频）
 *    · 输入: video_url（源视频，必填）+ image_url（替换角色/风格图，必填）
 *    · resolution: 580p / 720p
 *    · 无 prompt 参数，无时长控制（由源视频决定）
 *
 *  短剧路由场景：
 *    styleBucket = two_d → 先用 Seedance/Kling 生成源视频，再走 V2V 替换
 *    需要 orchestrator 两步流程：Phase 1a 生成源视频 → Phase 1b Wan Replace
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
} from '../kieai/kieai-record-info';
import { kieAiRateLimitAcquireQuery, kieAiRateLimitAcquireSubmit } from '../kieai/kieai-rate-limiter';

export interface WanAnimateVideoConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  defaultResolution?: '580p' | '720p';
  nsfwChecker?: boolean;
}

export class WanAnimateVideoProvider implements VideoProvider {
  readonly name = 'wan-animate';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['v2v']);
  private readonly logger = new Logger('WanAnimateVideo');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<WanAnimateVideoConfig>;

  constructor(config: WanAnimateVideoConfig) {
    this.cfg = {
      apiKey:            config.apiKey,
      baseUrl:           config.baseUrl,
      callBackUrl:       config.callBackUrl ?? '',
      defaultResolution: config.defaultResolution ?? '720p',
      nsfwChecker:       config.nsfwChecker ?? false,
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
    const videoUrl = req.referenceVideos?.[0]?.url;
    if (!videoUrl) {
      throw new Error(
        'Wan Animate Replace 是 V2V 模型，需要 referenceVideos[0].url（源视频）。' +
        '请先用其他 Provider 生成源视频后再调用。',
      );
    }

    const imageUrl = req.referenceImages?.find(r => r.role === 'first_frame')?.url
      ?? req.referenceImages?.find(r => r.role === 'character')?.url
      ?? req.referenceImages?.[0]?.url;

    if (!imageUrl) {
      throw new Error(
        'Wan Animate Replace 需要 image_url（角色/风格参考图），当前无可用参考图。',
      );
    }

    const resolution = this.resolveResolution(req.quality);

    const input: Record<string, unknown> = {
      video_url: videoUrl,
      image_url: imageUrl,
      resolution,
      nsfw_checker: this.cfg.nsfwChecker,
    };

    const body: Record<string, unknown> = {
      model: 'wan/2-2-animate-replace',
      input,
    };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `提交 Wan Animate Replace 任务: resolution=${resolution}` +
      ` videoUrl=${videoUrl.slice(0, 60)}... imageUrl=${imageUrl.slice(0, 60)}...`,
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Wan Animate createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }

    const taskId = res.data.data.taskId;
    this.logger.log(`Wan Animate Replace 任务已提交: taskId=${taskId}`);
    return { providerTaskId: taskId, provider: this.name, model: 'wan/2-2-animate-replace' };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    await kieAiRateLimitAcquireQuery();
    const res = await this.http.get<KieAiRecordInfoResponse>(
      '/api/v1/jobs/recordInfo',
      { params: { taskId: providerTaskId } },
    );
    return videoTaskResultFromKieAiRecordInfo(
      res.data,
      { providerTaskId, provider: this.name, model: 'wan/2-2-animate-replace' },
      this.logger,
    );
  }

  async cancel(providerTaskId: string): Promise<void> {
    this.logger.warn(`Wan Animate Replace 暂不支持主动取消: taskId=${providerTaskId}`);
  }

  private resolveResolution(quality?: string): '580p' | '720p' {
    if (quality === '720p' || quality === '1080p') return '720p';
    if (quality === '580p') return '580p';
    return this.cfg.defaultResolution;
  }
}
