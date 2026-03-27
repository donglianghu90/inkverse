/** Sora 2 图生视频 Provider（仅 sora-2-image-to-video，kie.ai API）
 *
 *  API 基础信息：
 *    提交: POST /api/v1/jobs/createTask
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与 Kling / Hailuo / Veo / Avatar 共享同一 apiKey）
 *
 *  模型：sora-2-image-to-video（必须提供首帧图）
 *
 *  核心参数：
 *    · aspect_ratio: 'landscape'(16:9) / 'portrait'(9:16)
 *    · n_frames: '10' = 10秒 / '15' = 15秒（接口字段名，实为秒数）
 *    · character_id_list: 最多 5 个角色动画 ID（可选）
 *    · remove_watermark / upload_method
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

export interface SoraVideoConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** 固定为 sora-2-image-to-video（保留字段便于配置覆盖，勿填其他值） */
  defaultModel?: 'sora-2-image-to-video';
  /** 默认时长：'10' = 10秒 / '15' = 15秒 */
  defaultNFrames?: '10' | '15';
  /** 上传存储：'s3' / 'oss'（中国大陆推荐 oss） */
  uploadMethod?: 's3' | 'oss';
  removeWatermark?: boolean;
}

// ─── Provider 实现 ─────────────────────────────────────────────────────────────

export class SoraVideoProvider implements VideoProvider {
  readonly name = 'sora';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['i2v']);
  private readonly logger = new Logger('SoraVideo');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<Omit<SoraVideoConfig, 'callBackUrl'>> & { callBackUrl: string };

  constructor(config: SoraVideoConfig) {
    this.cfg = {
      apiKey:           config.apiKey,
      baseUrl:          config.baseUrl,
      callBackUrl:      config.callBackUrl ?? '',
      defaultModel:     config.defaultModel ?? 'sora-2-image-to-video',
      defaultNFrames:   config.defaultNFrames ?? '10',
      uploadMethod:     config.uploadMethod ?? 'oss',
      removeWatermark:  config.removeWatermark ?? true,
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
    const firstFrame = req.referenceImages?.find(r => r.role === 'first_frame')?.url
      ?? req.referenceImages?.[0]?.url;

    const model = this.cfg.defaultModel;
    if (!firstFrame) {
      throw new Error('sora-2-image-to-video 需要首帧图（referenceImages 中 role: first_frame 或首张参考图）');
    }

    const aspectRatio = this.resolveAspectRatio(req.aspectRatio);
    const nFrames = this.resolveNFrames(req.duration);

    const input: Record<string, unknown> = {
      prompt: req.prompt || '',
      image_urls: [firstFrame],
      aspect_ratio: aspectRatio,
      n_frames: nFrames,
      remove_watermark: this.cfg.removeWatermark,
      upload_method: this.cfg.uploadMethod,
    };

    // 角色动画 ID（可选，通过 extra.character_id_list 传入）
    const characterIds = req.extra?.character_id_list as string[] | undefined;
    if (characterIds?.length) {
      input.character_id_list = characterIds.slice(0, 5);
    }

    const body: Record<string, unknown> = { model, input };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `提交 Sora 视频任务: model=${model} n_frames=${nFrames} ratio=${aspectRatio} firstFrame=${firstFrame.slice(0, 60)}...`,
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Sora createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }

    const taskId = res.data.data.taskId;
    this.logger.log(`Sora 视频任务已提交: taskId=${taskId}`);
    return { providerTaskId: taskId, provider: this.name, model };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    await kieAiRateLimitAcquireQuery();
    const res = await this.http.get<KieAiRecordInfoResponse>(
      '/api/v1/jobs/recordInfo',
      { params: { taskId: providerTaskId } },
    );
    return videoTaskResultFromKieAiRecordInfo(
      res.data,
      { providerTaskId, provider: this.name, model: this.cfg.defaultModel },
      this.logger,
    );
  }

  async cancel(providerTaskId: string): Promise<void> {
    this.logger.warn(`Sora 暂不支持主动取消: taskId=${providerTaskId}`);
  }

  /** 将通用 aspectRatio 转为 Sora 的 landscape/portrait */
  private resolveAspectRatio(ar?: string): 'landscape' | 'portrait' {
    if (ar === '9:16') return 'portrait';
    return 'landscape';
  }

  /** 根据分镜时长选择输出秒数：≥12s 用 15s，其余用 10s */
  private resolveNFrames(duration?: number): '10' | '15' {
    if (duration != null && duration >= 12) return '15';
    return this.cfg.defaultNFrames;
  }
}
