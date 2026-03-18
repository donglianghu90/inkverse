/** 火山引擎 Seedance — 视频生成 Provider (T2V / I2V，异步任务)
 *
 *  API: POST /contents/generations/tasks  (新版 content array 格式)
 *  Query: GET /contents/generations/tasks/{id}
 *
 *  多模型可降级：models 数组按优先级排列，当某个模型返回 400/404 时自动尝试下一个。
 */
import { Logger } from '@nestjs/common';
import { VideoProvider, VideoCapability, VideoGenerationRequest, VideoSubmitResult, VideoTaskResult, VideoTaskStatus } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineVideoConfig {
  /** 按优先级排列的模型列表，第一个为首选（通常是 fast），其余为降级候选 */
  models: string[];
  defaultDuration: number;
  defaultQuality: string;
  watermark?: boolean;
}

interface ArkTaskSubmitResponse { id: string; model?: string; status?: string }

interface ArkTaskContentItem {
  type: string;
  /** 新版 API 返回的视频内容项 */
  video_url?: string | { url?: string; duration?: number; cover_image_url?: string };
}

interface ArkTaskQueryResponse {
  id: string;
  status: string; // queued | running | succeeded | failed | cancelled
  content?: ArkTaskContentItem[];
  /** 兼容旧版 API 响应字段 */
  output?: { video_url?: string; cover_url?: string; duration?: number };
  error?: { message?: string };
}

const STATUS_MAP: Record<string, VideoTaskStatus> = {
  submitted: 'pending', queued: 'pending', running: 'processing',
  succeeded: 'completed', failed: 'failed', cancelled: 'cancelled',
};

const ROLE_ORDER: Record<string, number> = { first_frame: 0, last_frame: 1, character: 2, style: 3 };

export class VolcengineVideoProvider implements VideoProvider {
  readonly name = 'volcengine';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set(['t2v', 'i2v', 'audio-gen']);
  private readonly logger = new Logger('VolcengineVideo');

  constructor(private readonly client: VolcengineClient, private readonly config: VolcengineVideoConfig) {}

  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    let lastErr: unknown;
    for (let i = 0; i < this.config.models.length; i++) {
      const model = this.config.models[i];
      try {
        return await this.submitWithModel(model, req);
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status ?? 0;
        const isModelError = status === 404 || status === 400;
        const hasNext = i < this.config.models.length - 1;
        if (isModelError && hasNext) {
          this.logger.warn(`模型 ${model} 不可用(${status})，降级到 ${this.config.models[i + 1]}`);
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private async submitWithModel(model: string, req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    const duration = req.duration ?? this.config.defaultDuration;
    const quality = req.quality ?? this.config.defaultQuality;

    // 参数以 flag 形式拼接在 prompt 末尾（新版 API 规范）
    const flags = [
      `--resolution ${quality}`,
      `--duration ${duration}`,
      '--camerafixed false',
      `--watermark ${this.config.watermark ? 'true' : 'false'}`,
    ].join(' ');

    const content: Record<string, unknown>[] = [
      { type: 'text', text: `${req.prompt} ${flags}` },
    ];

    // I2V：参考图按 role 排序后逐一添加（first_frame → last_frame → character → style）
    if (req.referenceImages?.length) {
      const sorted = [...req.referenceImages].sort(
        (a, b) => (ROLE_ORDER[a.role ?? ''] ?? 9) - (ROLE_ORDER[b.role ?? ''] ?? 9),
      );
      for (const img of sorted) {
        content.push({ type: 'image_url', image_url: { url: img.url } });
      }
    }

    const payload: Record<string, unknown> = { model, content };
    if (req.seed !== undefined) payload.seed = req.seed;
    if (req.extra) Object.assign(payload, req.extra);

    this.logger.log(`提交视频任务: model=${model} duration=${duration}s quality=${quality}`);
    const res = await this.client.post<ArkTaskSubmitResponse>('/contents/generations/tasks', payload);
    this.logger.log(`视频任务已提交: taskId=${res.id} model=${model}`);
    return { providerTaskId: res.id, provider: this.name, model };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    const res = await this.client.get<ArkTaskQueryResponse>(`/contents/generations/tasks/${providerTaskId}`);
    const status = STATUS_MAP[res.status] ?? 'processing';

    let videoUrl: string | undefined;
    let coverUrl: string | undefined;
    let durationSeconds: number | undefined;

    // 新版 API：从 content 数组中解析视频
    if (res.content?.length) {
      const item = res.content.find(c => c.type === 'video' || c.type === 'video_url');
      if (item?.video_url) {
        if (typeof item.video_url === 'string') {
          videoUrl = item.video_url;
        } else {
          videoUrl = item.video_url.url;
          coverUrl = item.video_url.cover_image_url;
          durationSeconds = item.video_url.duration;
        }
      }
    } else if (res.output) {
      // 兼容旧版 API 响应
      videoUrl = res.output.video_url;
      coverUrl = res.output.cover_url;
      durationSeconds = res.output.duration;
    }

    return {
      providerTaskId: res.id, status, provider: this.name,
      model: this.config.models[0],
      videoUrl, coverUrl, durationSeconds,
      error: res.error?.message, raw: res,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.client.delete(`/contents/generations/tasks/${providerTaskId}`);
    this.logger.log(`视频任务已取消: ${providerTaskId}`);
  }
}
