/** Provider 注册表 — 配置驱动的动态 Provider 解析，新增 Provider 只需 register() + 改配置 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import { ImageProvider, VideoProvider, TtsProvider, MediaProviderMeta } from '../interfaces/media-provider.interface';
import { VolcengineClient, VolcengineClientConfig } from './volcengine/volcengine.client';
import { VolcengineImageProvider } from './volcengine/volcengine-image.provider';
import { VolcengineVideoProvider } from './volcengine/volcengine-video.provider';
import { VolcengineTtsProvider } from './volcengine/volcengine-tts.provider';

@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly logger = new Logger('ProviderRegistry');
  private readonly imageProviders = new Map<string, ImageProvider>();
  private readonly videoProviders = new Map<string, VideoProvider>();
  private readonly ttsProviders = new Map<string, TtsProvider>();
  private defaultImageProvider = '';
  private defaultVideoProvider = '';
  private defaultTtsProvider = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    this.defaultImageProvider = String(media.defaultImageProvider || 'volcengine');
    this.defaultVideoProvider = String(media.defaultVideoProvider || 'volcengine');
    this.defaultTtsProvider = String(media.defaultTtsProvider || '');
    this.initVolcengine(media);
    this.initVolcengineTts(media);
    this.logger.log(`Image: [${[...this.imageProviders.keys()]}] default=${this.defaultImageProvider}`);
    this.logger.log(`Video: [${[...this.videoProviders.keys()]}] default=${this.defaultVideoProvider}`);
    if (this.ttsProviders.size) this.logger.log(`TTS: [${[...this.ttsProviders.keys()]}] default=${this.defaultTtsProvider}`);
  }

  // ═══ 注册入口（供未来扩展：Kling / MiniMax / Runway 等） ═══

  registerImageProvider(provider: ImageProvider) { this.imageProviders.set(provider.name, provider); }
  registerVideoProvider(provider: VideoProvider) { this.videoProviders.set(provider.name, provider); }
  registerTtsProvider(provider: TtsProvider) { this.ttsProviders.set(provider.name, provider); }

  // ═══ 解析（按名称 or 默认） ═══

  getImageProvider(name?: string): ImageProvider {
    const key = name || this.defaultImageProvider;
    const p = this.imageProviders.get(key);
    if (!p) throw new Error(`图片 Provider [${key}] 未注册，可用: ${[...this.imageProviders.keys()]}`);
    return p;
  }

  getVideoProvider(name?: string): VideoProvider {
    const key = name || this.defaultVideoProvider;
    const p = this.videoProviders.get(key);
    if (!p) throw new Error(`视频 Provider [${key}] 未注册，可用: ${[...this.videoProviders.keys()]}`);
    return p;
  }

  getTtsProvider(name?: string): TtsProvider {
    const key = name || this.defaultTtsProvider;
    const p = this.ttsProviders.get(key);
    if (!p) throw new Error(`TTS Provider [${key}] 未注册，可用: ${[...this.ttsProviders.keys()]}`);
    return p;
  }

  listProviders(): MediaProviderMeta[] {
    const out: MediaProviderMeta[] = [];
    this.imageProviders.forEach((p, k) => out.push({ type: 'image', name: k, displayName: `${k} (Image)`, capabilities: p.capabilities }));
    this.videoProviders.forEach((p, k) => out.push({ type: 'video', name: k, displayName: `${k} (Video)`, capabilities: p.capabilities }));
    this.ttsProviders.forEach((p, k) => out.push({ type: 'tts', name: k, displayName: `${k} (TTS)`, capabilities: new Set() }));
    return out;
  }

  // ═══ 火山引擎初始化 ═══

  private initVolcengine(media: Record<string, unknown>) {
    const vc = (media.volcengine ?? {}) as Record<string, unknown>;
    const apiKey = String(vc.apiKey || '');
    if (!apiKey) { this.logger.warn('media.volcengine.apiKey 未配置，跳过火山引擎'); return; }

    const clientCfg: VolcengineClientConfig = {
      apiKey,
      baseUrl: String(vc.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3'),
      timeoutMs: Number(vc.timeoutMs) || 120_000,
    };
    const client = new VolcengineClient(clientCfg);

    const imgCfg = (vc.image ?? {}) as Record<string, unknown>;
    if (imgCfg.model || imgCfg.enabled !== false) {
      const imageProvider = new VolcengineImageProvider(client, {
        model: String(imgCfg.model || 'doubao-seedream-5-0-260128'),
        defaultSize: String(imgCfg.defaultSize || '1:1'),
        defaultResolution: String(imgCfg.defaultResolution || '2K'),
        watermark: String(imgCfg.watermark) === 'true',
      });
      this.registerImageProvider(imageProvider);
    }

    const vidCfg = (vc.video ?? {}) as Record<string, unknown>;
    if (vidCfg.model || vidCfg.enabled !== false) {
      const videoProvider = new VolcengineVideoProvider(client, {
        model: String(vidCfg.model || 'seedance-2-0-250901'),
        defaultDuration: Number(vidCfg.defaultDuration) || 5,
        defaultQuality: String(vidCfg.defaultQuality || '720p'),
      });
      this.registerVideoProvider(videoProvider);
    }
  }

  private initVolcengineTts(media: Record<string, unknown>) {
    const vc = (media.volcengine ?? {}) as Record<string, unknown>;
    const tts = (vc.tts ?? {}) as Record<string, unknown>;
    const appId = String(tts.appId || '');
    const token = String(tts.token || '');
    if (!appId || !token) { this.logger.debug('media.volcengine.tts 未配置，跳过 TTS'); return; }

    const provider = new VolcengineTtsProvider({
      appId, token,
      cluster: String(tts.cluster || 'volcano_tts'),
      defaultVoiceType: String(tts.defaultVoiceType || 'zh_female_cancan_mars_bigtts'),
      format: (tts.format as any) || 'mp3',
      sampleRate: Number(tts.sampleRate) || 24000,
    });
    this.registerTtsProvider(provider);
    if (!this.defaultTtsProvider) this.defaultTtsProvider = 'volcengine';
  }
}
