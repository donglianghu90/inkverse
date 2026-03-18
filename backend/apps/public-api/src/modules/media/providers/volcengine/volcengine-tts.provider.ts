/** 火山引擎豆包 TTS — 语音合成 Provider (openspeech.bytedance.com) */
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { TtsProvider, TtsRequest, TtsResult } from '../../interfaces/media-provider.interface';

export interface VolcengineTtsConfig {
  appId: string;
  token: string;
  cluster: string; // 如 volcano_tts
  defaultVoiceType: string; // 默认音色，如 zh_female_cancan_mars_bigtts
  format: 'mp3' | 'wav' | 'ogg';
  sampleRate: number;
}

const SPEED_MAP: Record<string, number> = { very_slow: 0.7, slow: 0.85, normal: 1.0, fast: 1.2, very_fast: 1.5 };
const VOLUME_MAP: Record<string, number> = { whisper: 0.5, low: 0.7, normal: 1.0, loud: 1.3, scream: 1.6 };

interface TtsApiResponse { data: string; reqid: string; code: number; message: string; sequence: number; addition?: { duration?: string } }

export class VolcengineTtsProvider implements TtsProvider {
  readonly name = 'volcengine';
  private readonly logger = new Logger('VolcengineTTS');
  private readonly endpoint = 'https://openspeech.bytedance.com/api/v1/tts';

  constructor(private readonly config: VolcengineTtsConfig) {}

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const t0 = Date.now();
    const speed = typeof req.speed === 'number' ? req.speed : (SPEED_MAP[req.speed as string] ?? 1.0);
    const voiceType = req.voiceId || this.config.defaultVoiceType;

    const payload = {
      app: { appid: this.config.appId, token: this.config.token, cluster: this.config.cluster },
      user: { uid: 'inkverse' },
      audio: {
        voice_type: voiceType,
        encoding: this.config.format === 'mp3' ? 'mp3' : this.config.format === 'ogg' ? 'ogg_opus' : 'wav',
        speed_ratio: speed,
        loudness_ratio: VOLUME_MAP[req.extra?.volume as string] ?? 1.0,
        emotion: req.emotion || undefined,
      },
      request: { reqid: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, text: req.text, operation: 'query' },
    };

    this.logger.debug(`TTS: voice=${voiceType} speed=${speed} text=${req.text.slice(0, 40)}...`);

    let res: { status: number; data: TtsApiResponse | unknown };
    try {
      res = await axios.post<TtsApiResponse>(this.endpoint, payload, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer;${this.config.token}`,
        },
        timeout: 30_000,
        validateStatus: () => true,
      });
    } catch (err: unknown) {
      const ax = err && typeof err === 'object' && 'response' in err ? (err as { response?: { status?: number; data?: unknown } }).response : undefined;
      const status = ax?.status;
      const body = ax?.data;
      const msg = typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : (body != null ? String(body) : (err as Error).message);
      this.logger.warn(`TTS HTTP 请求异常 status=${status} message=${msg}`);
      throw new Error(`TTS 请求失败: ${status === 403 ? '鉴权失败(403)，请检查 appId/token/cluster 及控制台是否开通并生效；若使用豆包大模型音色(如 voice_xxx)，需确认与 openspeech 接口音色列表一致' : `status=${status} ${msg}`.trim()}`);
    }

    if (res.status !== 200) {
      const body = res.data;
      const msg = typeof body === 'object' && body !== null && 'message' in body ? String((body as { message: unknown }).message) : (body != null ? String(body) : `HTTP ${res.status}`);
      const hint = res.status === 403 ? ' 鉴权失败：请检查 media.volcengine.tts 的 appId/token/cluster 及控制台是否开通；音色需使用 openspeech 支持的 voice_type（如 zh_female_cancan_mars_bigtts），勿用豆包大模型音色(voice_xxx)。' : '';
      this.logger.warn(`TTS HTTP ${res.status}: ${msg}`);
      throw new Error(`TTS 请求失败 status=${res.status}: ${msg}${hint}`);
    }

    const data = res.data as TtsApiResponse;
    if (data.code !== 3000) throw new Error(`TTS 失败 code=${data.code}: ${data.message}`);

    const audioBase64 = data.data;
    const durationStr = data.addition?.duration ?? '0';
    const durationMs = Date.now() - t0;
    const audioUrl = `data:audio/${this.config.format};base64,${audioBase64}`; // 暂用 data URI，后续可上传 OSS

    this.logger.log(`TTS 完成: ${durationMs}ms | voice=${voiceType} | audioDuration=${durationStr}ms`);
    return { audioUrl, durationSeconds: parseFloat(durationStr) / 1000, provider: this.name, model: voiceType };
  }

  /** 将 base64 音频数据写入本地文件（供 FFmpeg 合成使用） */
  async synthesizeToFile(req: TtsRequest, outputPath: string): Promise<TtsResult> {
    const result = await this.synthesize(req);
    if (result.audioUrl.startsWith('data:')) {
      const base64 = result.audioUrl.split(',')[1];
      const fs = await import('fs/promises');
      await fs.writeFile(outputPath, Buffer.from(base64, 'base64'));
      result.audioUrl = outputPath;
    }
    return result;
  }
}
