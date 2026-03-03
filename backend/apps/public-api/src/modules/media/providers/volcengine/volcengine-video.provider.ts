/** 火山引擎 Seedance — 视频生成 Provider (T2V / I2V，异步任务) */
import { Logger } from '@nestjs/common';
import { VideoProvider, VideoCapability, VideoGenerationRequest, VideoSubmitResult, VideoTaskResult, VideoTaskStatus } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineVideoConfig {
  model: string; // 预置接入点模型名，如 doubao-seedance-2-0-250901
  defaultDuration: number;
  defaultQuality: string;
}

interface ArkVideoSubmitResponse { id: string; model?: string; status?: string }
interface ArkVideoQueryResponse {
  id: string;
  status: string; // running | succeeded | failed | cancelled
  output?: { video_url?: string; cover_url?: string; duration?: number };
  error?: { message?: string };
}

const ROLE_ORDER: Record<string, number> = { first_frame: 0, last_frame: 1, character: 2, style: 3 };
const STATUS_MAP: Record<string, VideoTaskStatus> = {
  submitted: 'pending', queued: 'pending', running: 'processing',
  succeeded: 'completed', failed: 'failed', cancelled: 'cancelled',
};

export class VolcengineVideoProvider implements VideoProvider {
  readonly name = 'volcengine';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set(['t2v', 'i2v', 'audio-gen']);
  private readonly logger = new Logger('VolcengineVideo');

  constructor(private readonly client: VolcengineClient, private readonly config: VolcengineVideoConfig) {}

  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    const payload: Record<string, unknown> = {
      model: this.config.model,
      prompt: req.prompt,
      duration: req.duration ?? this.config.defaultDuration,
      quality: req.quality ?? this.config.defaultQuality,
      aspect_ratio: req.aspectRatio ?? '16:9',
      generate_audio: req.generateAudio ?? false,
    };
    if (req.referenceImages?.length) { // 按role排序：first_frame → last_frame → character → style
      const sorted = [...req.referenceImages].sort((a, b) => (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9));
      payload.image_urls = sorted.map(i => i.url);
    }
    if (req.referenceVideos?.length) payload.video_urls = req.referenceVideos.map(v => v.url);
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.extra) Object.assign(payload, req.extra);

    this.logger.log(`提交视频任务: model=${this.config.model} duration=${payload.duration}s quality=${payload.quality}`);
    const res = await this.client.post<ArkVideoSubmitResponse>('/videos/generations', payload);
    this.logger.log(`视频任务已提交: taskId=${res.id}`);
    return { providerTaskId: res.id, provider: this.name, model: this.config.model };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    const res = await this.client.get<ArkVideoQueryResponse>(`/videos/generations/${providerTaskId}`);
    const status = STATUS_MAP[res.status] ?? 'processing';
    return {
      providerTaskId: res.id, status, provider: this.name, model: this.config.model,
      videoUrl: res.output?.video_url, coverUrl: res.output?.cover_url,
      durationSeconds: res.output?.duration, error: res.error?.message, raw: res,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.client.delete(`/videos/generations/${providerTaskId}`);
    this.logger.log(`视频任务已取消: ${providerTaskId}`);
  }
}
