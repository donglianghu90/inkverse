import { Logger } from '@nestjs/common';
import { AudioProvider, AudioGenerationRequest, AudioSubmitResult, AudioTaskResult, AudioTaskStatus } from '../../interfaces/media-provider.interface';
import { VolcengineClient } from './volcengine.client';

export interface VolcengineAudioConfig {
  models: string[];
}

interface ArkTaskSubmitResponse { id: string; model?: string; status?: string }
interface ArkTaskQueryResponse {
  id: string;
  status: string; // queued | running | succeeded | failed | cancelled
  content?: Array<{ type: string; audio_url?: string | { url?: string; duration?: number } }>;
  error?: { message?: string };
}

const STATUS_MAP: Record<string, AudioTaskStatus> = {
  submitted: 'pending', queued: 'pending', running: 'processing',
  succeeded: 'completed', failed: 'failed', cancelled: 'cancelled',
};

export class VolcengineAudioProvider implements AudioProvider {
  readonly name = 'volcengine';
  readonly capabilities = new Set(['t2a'] as const);
  private readonly logger = new Logger('VolcengineAudio');

  constructor(
    private readonly client: VolcengineClient,
    private readonly config: VolcengineAudioConfig,
  ) {}

  private get defaultModel(): string {
    return this.config.models[0] || 'doubao-audio-generation';
  }

  async submit(req: AudioGenerationRequest): Promise<AudioSubmitResult> {
    try {
      this.logger.log(`[Audio Submit] 提交音效生成任务: prompt='${req.prompt}'`);
      
      const content: Record<string, unknown>[] = [
        { type: 'text', text: req.prompt },
      ];
      if (req.referenceVideoUrl) {
        content.push({ type: 'video_url', video_url: { url: req.referenceVideoUrl } });
      }

      const payload: Record<string, unknown> = {
        model: this.defaultModel,
        content,
      };
      
      if (req.duration) payload.duration = req.duration;

      const res = await this.client.post<ArkTaskSubmitResponse>('/contents/generations/tasks', payload);
      
      return {
        providerTaskId: res.id,
        provider: this.name,
        model: this.defaultModel,
      };
    } catch (err: any) {
      this.logger.error(`[Audio Submit] 失败: ${err.message}`);
      throw err;
    }
  }

  async query(providerTaskId: string): Promise<AudioTaskResult> {
    try {
      const res = await this.client.get<ArkTaskQueryResponse>(`/contents/generations/tasks/${providerTaskId}`);
      const status = STATUS_MAP[res.status] ?? 'processing';
      
      let audioUrl: string | undefined;
      let durationSeconds: number | undefined;

      if (Array.isArray(res.content) && res.content.length) {
        const item = res.content.find(c => c.type === 'audio' || c.type === 'audio_url');
        if (item?.audio_url) {
          if (typeof item.audio_url === 'string') {
            audioUrl = item.audio_url;
          } else {
            audioUrl = item.audio_url.url;
            durationSeconds = item.audio_url.duration;
          }
        }
      }
      
      return {
        providerTaskId,
        status,
        audioUrl,
        durationSeconds,
        provider: this.name,
        model: this.defaultModel,
        error: res.error?.message,
        raw: res,
      };
    } catch (err: any) {
      this.logger.error(`[Audio Query] 失败: ${err.message}`);
      throw err;
    }
  }

  async cancel(providerTaskId: string): Promise<void> {
    try {
      await this.client.delete(`/contents/generations/tasks/${providerTaskId}`);
      this.logger.log(`[Audio Cancel] 取消任务 ${providerTaskId}`);
    } catch (err: any) {
      this.logger.error(`[Audio Cancel] 取消失败: ${err.message}`);
    }
  }
}
