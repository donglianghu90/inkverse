/** ElevenLabs SFX Provider — 通过 kie.ai 代理，使用 elevenlabs/sound-effect-v2 生成音效/环境音/BGM */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  AudioProvider,
  AudioCapability,
  AudioGenerationRequest,
  AudioSubmitResult,
  AudioTaskResult,
} from '../../interfaces/media-provider.interface';
import { KieAiPollingService } from './kieai-polling.service';

export interface ElevenLabsSfxConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** 最大音效时长（秒），ElevenLabs SFX v2 限制 22s，默认 22 */
  maxDurationSec?: number;
}

/** kie.ai createTask 通用响应 */
interface KieAiCreateTaskResponse {
  code: number;
  msg: string;
  success: boolean;
  data?: { taskId: string;[key: string]: unknown };
}

const SFX_MODEL = 'elevenlabs/sound-effect-v2';
const SFX_PROVIDER_NAME = 'elevenlabs-sfx';

export class ElevenLabsSfxProvider implements AudioProvider {
  readonly name = SFX_PROVIDER_NAME;
  readonly capabilities: ReadonlySet<AudioCapability> = new Set<AudioCapability>(['t2a']);

  private readonly logger = new Logger('ElevenLabsSFX');
  private readonly http: AxiosInstance;
  private readonly maxDurationSec: number;

  constructor(
    private readonly config: ElevenLabsSfxConfig,
    private readonly pollingService: KieAiPollingService,
  ) {
    this.maxDurationSec = config.maxDurationSec ?? 22;
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ── submit ────────────────────────────────────────────────────────────────

  async submit(req: AudioGenerationRequest): Promise<AudioSubmitResult> {
    const durationSec = Math.min(req.duration ?? this.maxDurationSec, this.maxDurationSec);

    const payload = {
      model: SFX_MODEL,
      callBackUrl: this.config.callBackUrl || undefined,
      input: {
        text: req.prompt,
        loop: false,
        prompt_influence: (req.extra?.prompt_influence as number) ?? 0.3,
        output_format: 'mp3_44100_128',
      },
    };

    this.logger.log(`[SFX] submit: "${req.prompt.slice(0, 60)}..." duration=${durationSec}s`);

    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', payload);
    const taskId = res.data?.data?.taskId;

    if (!taskId) {
      // success=true 但 taskId 为空 → 模型暂不可用（已下架或维护中）
      if (res.data?.success) {
        throw new Error(`[SFX] 模型 ${SFX_MODEL} 暂不可用（API 接受请求但未返回 taskId，可能已下线或维护中）`);
      }
      throw new Error(`[SFX] 提交失败: code=${res.data?.code} msg=${res.data?.msg}`);
    }

    this.logger.log(`[SFX] 任务已提交: taskId=${taskId}`);
    return { providerTaskId: taskId, provider: this.name, model: SFX_MODEL };
  }

  // ── query ─────────────────────────────────────────────────────────────────

  async query(providerTaskId: string): Promise<AudioTaskResult> {
    // 将查询委托给 KieAiPollingService 等待完成
    // 注意：这里不能阻塞等待，只做一次状态快照
    // MediaJobService 的定时轮询会调用此方法；实际等待在 submit 调用方处理
    try {
      const res = await this.http.get<{
        code: number; success: boolean; msg: string;
        data?: { state: string; resUrl?: string; failCode?: string; failMsg?: string };
      }>('/api/v1/jobs/recordInfo', { params: { taskId: providerTaskId } });

      const task = res.data?.data;
      if (!task) {
        return { providerTaskId, status: 'pending', provider: this.name, model: SFX_MODEL };
      }

      if (task.state === 'success') {
        return {
          providerTaskId, status: 'completed',
          audioUrl: task.resUrl,
          provider: this.name, model: SFX_MODEL,
        };
      }
      if (task.state === 'fail') {
        return {
          providerTaskId, status: 'failed',
          error: `failCode=${task.failCode} failMsg=${task.failMsg}`,
          provider: this.name, model: SFX_MODEL,
        };
      }
      // waiting / queuing / generating
      return { providerTaskId, status: 'processing', provider: this.name, model: SFX_MODEL };
    } catch (err: any) {
      this.logger.warn(`[SFX] query 失败: taskId=${providerTaskId} ${err?.message}`);
      return { providerTaskId, status: 'pending', provider: this.name, model: SFX_MODEL };
    }
  }

  // ── cancel ────────────────────────────────────────────────────────────────

  async cancel(_providerTaskId: string): Promise<void> {
    // kie.ai 不支持取消，忽略
    this.logger.warn(`[SFX] cancel 不受支持: taskId=${_providerTaskId}`);
  }

  // ── generateSync（轮询等待，供短时任务使用） ────────────────────────────────

  async generateSync(req: AudioGenerationRequest): Promise<AudioTaskResult> {
    const submitResult = await this.submit(req);
    const taskId = submitResult.providerTaskId;

    try {
      const data = await this.pollingService.waitForTask(taskId, SFX_MODEL, 90_000);
      const resUrl = (data as any).resUrl as string | undefined;
      if (!resUrl) throw new Error(`[SFX] 任务完成但未返回音频 URL: taskId=${taskId}`);

      this.logger.log(`[SFX] generateSync 完成: taskId=${taskId} url=${resUrl}`);
      return {
        providerTaskId: taskId, status: 'completed',
        audioUrl: resUrl,
        provider: this.name, model: SFX_MODEL,
      };
    } catch (err: any) {
      return {
        providerTaskId: taskId, status: 'failed',
        error: err?.message,
        provider: this.name, model: SFX_MODEL,
      };
    }
  }
}
