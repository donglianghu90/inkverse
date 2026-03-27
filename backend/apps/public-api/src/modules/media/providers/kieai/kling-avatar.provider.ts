/** Kling AI Avatar 视频生成 Provider (via kie.ai API)
 *
 *  API 基础信息：
 *    提交: POST /api/v1/jobs/createTask  { model: "kling/ai-avatar-pro", input: {...} }
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与 Kling Video / Hailuo 共享同一 apiKey）
 *
 *  核心能力：
 *    · 角色图 + 音频 → 口型精确同步的说话视频
 *    · 面部表情自然协调，嘴型与语音完全匹配
 *    · 支持 prompt 描述附加动作/环境
 *
 *  短剧路由场景：
 *    dialogue shotType + 人物可见景别（close_up / medium_close_up / medium）→ Avatar
 *    解决短剧对白场景口型不同步的核心痛点
 *
 *  架构影响：
 *    使用 Avatar 的镜头必须先完成 TTS，将音频 URL 传入，
 *    生成的视频已含口型同步音频，compose 阶段不再单独混 TTS 轨。
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

export interface KlingAvatarConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** 'kling/ai-avatar-pro' 或 'kling/ai-avatar-standard' */
  defaultModel?: string;
}

export class KlingAvatarProvider implements VideoProvider {
  readonly name = 'kling-avatar';
  /**
   * i2v：Avatar 需要人物首帧图 + 音频 → 口型同步视频。
   * audio-gen：输出视频中已内嵌同步语音。
   */
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['i2v', 'audio-gen']);
  private readonly logger = new Logger('KlingAvatar');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<KlingAvatarConfig>;

  constructor(config: KlingAvatarConfig) {
    this.cfg = {
      apiKey:       config.apiKey,
      baseUrl:      config.baseUrl,
      callBackUrl:  config.callBackUrl ?? '',
      defaultModel: config.defaultModel ?? 'kling/ai-avatar-pro',
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

  /**
   * 提交 Avatar 任务。
   *
   * 关键参数通过 extra 传入：
   *  - extra.audio_url: TTS 音频 URL（必须，Avatar 核心输入）
   *
   * referenceImages[role=first_frame]: 人物面部图（必须）
   */
  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    const imageUrl = req.referenceImages?.find(r => r.role === 'first_frame')?.url
      ?? req.referenceImages?.[0]?.url;

    if (!imageUrl) {
      throw new Error('Kling Avatar 需要人物面部图（role: first_frame），当前无可用参考图');
    }

    const audioUrl = req.extra?.audio_url as string | undefined;
    if (!audioUrl) {
      throw new Error('Kling Avatar 需要音频 URL（extra.audio_url），请确保 TTS 已完成');
    }

    const model = this.cfg.defaultModel;

    const input: Record<string, unknown> = {
      image_url: imageUrl,
      audio_url: audioUrl,
      prompt: req.prompt || '',
    };

    const body: Record<string, unknown> = { model, input };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `提交 Kling Avatar 任务: model=${model}` +
      ` image=${imageUrl.slice(0, 60)}... audio=${audioUrl.slice(0, 60)}...`,
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Kling Avatar createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }

    const taskId = res.data.data.taskId;
    this.logger.log(`Kling Avatar 任务已提交: taskId=${taskId}`);
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
    this.logger.warn(`Kling Avatar 暂不支持主动取消: taskId=${providerTaskId}`);
  }
}
