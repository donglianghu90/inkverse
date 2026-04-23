/** ElevenLabs TTS Provider — 通过 kie.ai 代理调用 elevenlabs/text-to-speech-turbo-2-5 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { TtsProvider, TtsRequest, TtsResult } from '../../interfaces/media-provider.interface';
import { KieAiPollingService } from './kieai-polling.service';
import { KieAiCallbackService } from './kieai-callback.service';

export interface ElevenLabsTtsConfig {
  apiKey: string;
  baseUrl: string;
  callBackUrl?: string;
  /** 默认音色 ID 或预设名称（如 Rachel、Adam，或 voice_id 字符串） */
  defaultVoice: string;
  /** 语音稳定性 0-1，默认 0.5 */
  stability?: number;
  /** 相似度提升 0-1，默认 0.75 */
  similarityBoost?: number;
  /** 风格夸张 0-1，默认 0 */
  style?: number;
  /** 语速 0.7-1.2，默认 1.0 */
  speed?: number;
}

/** kie.ai createTask 响应 */
interface KieAiCreateTaskResponse {
  code: number;
  msg: string;
  success: boolean;
  data?: { taskId: string; [key: string]: unknown };
}

/** kie.ai recordInfo 中 TTS 任务的 resUrl */
interface KieAiTtsTaskData {
  state: 'success' | 'fail' | 'waiting' | 'queuing' | 'generating';
  resUrl?: string;       // 生成的音频文件 URL
  failCode?: string;
  failMsg?: string;
  [key: string]: unknown;
}

const MODEL_ID = 'elevenlabs/text-to-speech-turbo-2-5';

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs-tts';
  private readonly logger = new Logger('ElevenLabsTTS');
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ElevenLabsTtsConfig,
    private readonly callbackService: KieAiCallbackService,
    private readonly pollingService: KieAiPollingService,
  ) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    let voice = req.voiceId || this.config.defaultVoice;
    // 过滤掉原本为火山引擎设置的大模型音色或 openspeech 音色（ElevenLabs API 不接受这些 ID）
    if (voice.startsWith('voice_') || voice.startsWith('zh_')) {
      voice = this.config.defaultVoice;
    }
    const text = req.text;

    this.logger.log(`[TTS] 提交合成任务: voice=${voice} text="${text.slice(0, 40)}..."`);

    // ── 1. 提交任务 ──────────────────────────────────────────────────────────
    // 自动按需识别并强制指定中文 language_code
    // ElevenLabs Turbo 2.5 遇到简短中文文本如果不指定 language_code，很容易使用纯英文母语引擎硬度拼音，造成洋腔洋调
    let resolvedLanguageCode = req.extra?.language_code;
    if (!resolvedLanguageCode && /[\\u4e00-\\u9fa5]/.test(text)) {
      resolvedLanguageCode = 'zh';
      this.logger.debug(`[TTS] 侦测到中文字符，自动附加 language_code: 'zh'`);
    }

    const payload = {
      model: MODEL_ID,
      callBackUrl: this.config.callBackUrl || undefined,
      input: {
        voice,
        text,
        stability:       req.extra?.stability       ?? this.config.stability       ?? 0.5,
        similarity_boost: req.extra?.similarity_boost ?? this.config.similarityBoost ?? 0.75,
        style:           req.extra?.style            ?? this.config.style            ?? 0,
        speed:           typeof req.speed === 'number' ? req.speed : (this.config.speed ?? 1.0),
        language_code:   resolvedLanguageCode,
        previous_text:   req.extra?.previous_text    ?? undefined,
        next_text:       req.extra?.next_text        ?? undefined,
      },
    };

    let taskId: string;
    try {
      const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', payload);
      if (res.data?.code !== 200 || !res.data?.data?.taskId) {
        throw new Error(`提交失败: code=${res.data?.code} msg=${res.data?.msg}`);
      }
      taskId = res.data.data.taskId;
      this.logger.log(`[TTS] 任务已提交: taskId=${taskId} voice=${voice}`);
    } catch (err: any) {
      this.logger.error(`[TTS] 提交异常: ${err?.message}`);
      throw err;
    }

    // ── 2. 尝试通过 Callback 接收结果（如果配置了回调 URL）──────────────────
    if (this.config.callBackUrl) {
      try {
        const data = await this.callbackService.waitForTask(taskId, 120_000);
        const ttsData = data as unknown as KieAiTtsTaskData;
        if (ttsData.resUrl) {
          this.logger.log(`[TTS] Callback 完成: taskId=${taskId} url=${ttsData.resUrl}`);
          return this._buildResult(ttsData.resUrl, voice);
        }
      } catch {
        this.logger.warn(`[TTS] Callback 超时或失败，降级到轮询: taskId=${taskId}`);
      }
    }

    // ── 3. 轮询兜底 ──────────────────────────────────────────────────────────
    const data = await this.pollingService.waitForTask(taskId, MODEL_ID, 120_000);
    const ttsData = data as unknown as KieAiTtsTaskData;

    if (!ttsData.resUrl) {
      throw new Error(`[TTS] 任务完成但未返回音频 URL: taskId=${taskId}`);
    }

    this.logger.log(`[TTS] 轮询完成: taskId=${taskId} url=${ttsData.resUrl}`);
    return this._buildResult(ttsData.resUrl, voice);
  }

  async synthesizeToFile(req: TtsRequest, outputPath: string): Promise<TtsResult> {
    const result = await this.synthesize(req);
    // ElevenLabs via kie.ai 直接返回 CDN URL，下载写入本地
    if (result.audioUrl.startsWith('http')) {
      const { default: fs } = await import('fs/promises');
      const resp = await axios.get(result.audioUrl, { responseType: 'arraybuffer', timeout: 30_000 });
      await fs.writeFile(outputPath, Buffer.from(resp.data as ArrayBuffer));
      result.audioUrl = outputPath;
      this.logger.log(`[TTS] 音频已写入文件: ${outputPath}`);
    }
    return result;
  }

  private _buildResult(audioUrl: string, voice: string): TtsResult {
    return {
      audioUrl,
      durationSeconds: 0, // kie.ai TTS 接口不返回时长，由调用方通过 ffprobe 获取
      provider: this.name,
      model: `${MODEL_ID}:${voice}`,
    };
  }
}
