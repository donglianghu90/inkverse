/** Provider 注册表 — 配置驱动的动态 Provider 解析，新增 Provider 只需 register() + 改配置 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import { ImageProvider, VideoProvider, TtsProvider, MediaProviderMeta } from '../interfaces/media-provider.interface';
import { VolcengineClient, VolcengineClientConfig } from './volcengine/volcengine.client';
import { VolcengineImageProvider } from './volcengine/volcengine-image.provider';
import { VolcengineVideoProvider } from './volcengine/volcengine-video.provider';
import { VolcengineTtsProvider } from './volcengine/volcengine-tts.provider';
import { KieAiImageProvider } from './kieai/kieai-image.provider';
import { KieAiCallbackService } from './kieai/kieai-callback.service';
import { KieAiPollingService } from './kieai/kieai-polling.service';
import { KlingVideoProvider } from './kieai/kling-video.provider';
import { HailuoVideoProvider } from './kieai/hailuo-video.provider';
import { KlingAvatarProvider } from './kieai/kling-avatar.provider';
import { VeoVideoProvider } from './google/veo-video.provider';
import { SoraVideoProvider } from './openai/sora-video.provider';
import { WanAnimateVideoProvider } from './dashscope/wan-animate-video.provider';
import { configureKieAiRateLimitsFromConfig } from './kieai/kieai-rate-limiter';

@Injectable()
export class ProviderRegistryService implements OnModuleInit {
  private readonly logger = new Logger('ProviderRegistry');
  private readonly imageProviders = new Map<string, ImageProvider>();
  private readonly videoProviders = new Map<string, VideoProvider>();
  private readonly ttsProviders = new Map<string, TtsProvider>();
  private defaultImageProvider = '';
  private defaultVideoProvider = '';
  private defaultTtsProvider = '';

  constructor(
    private readonly configService: ConfigService,
    private readonly kieAiCallbackService: KieAiCallbackService,
    private readonly kieAiPollingService: KieAiPollingService,
  ) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    this.defaultImageProvider = String(media.defaultImageProvider || 'volcengine');
    this.defaultVideoProvider = String(media.defaultVideoProvider || 'volcengine');
    this.defaultTtsProvider = String(media.defaultTtsProvider || '');
    this.initVolcengine(media);
    this.initVolcengineTts(media);
    this.initKieAi(media);
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
    // 按优先级收集已配置的模型（主 → 降级顺序）
    const IMAGE_MODEL_PRIORITY = ['seedream-5', 'seedream-4-5', 'seedream-4'] as const;
    const models = IMAGE_MODEL_PRIORITY
      .map(key => String(imgCfg[key] || '').trim())
      .filter(Boolean);
    if (!models.length) models.push('doubao-seedream-5-0-260128');
    if (imgCfg.enabled !== false) {
      const imageProvider = new VolcengineImageProvider(client, {
        models,
        defaultSize: String(imgCfg.defaultSize || '1:1'),
        defaultResolution: String(imgCfg.defaultResolution || '2K'),
        watermark: String(imgCfg.watermark) === 'true',
      });
      this.registerImageProvider(imageProvider);
    }

    const vidCfg = (vc.video ?? {}) as Record<string, unknown>;
    if (vidCfg.models || vidCfg.model || vidCfg.enabled !== false) {
      const modelsRaw = String(vidCfg.models || vidCfg.model || 'doubao-seedance-1-0-pro-fast-251015,doubao-seedance-1-0-pro-250528');
      const models = modelsRaw.split(',').map(s => s.trim()).filter(Boolean);
      const videoProvider = new VolcengineVideoProvider(client, {
        models,
        defaultDuration: Number(vidCfg.defaultDuration) || 5,
        defaultQuality: String(vidCfg.defaultQuality || '720p'),
        watermark: String(vidCfg.watermark) === 'true',
      });
      this.registerVideoProvider(videoProvider);
    }
  }

  // ═══ Kie.ai 初始化（多模型：nano-banana-pro / flux-2 / kling-3.0 等，共享同一 apiKey） ═══

  private initKieAi(media: Record<string, unknown>) {
    const kieai = (media.kieai ?? {}) as Record<string, unknown>;
    configureKieAiRateLimitsFromConfig(kieai);
    const apiKey = String(kieai.apiKey || '');
    if (!apiKey) { this.logger.debug('media.kieai.apiKey 未配置，跳过 Kie.ai'); return; }

    const baseUrl = String(kieai.baseUrl || 'https://api.kie.ai');
    const callBackUrl = String(kieai.callBackUrl || '');

    const modelDefs: Array<{
      cfgKey: string;
      defaultModel: string;
      defaultAspectRatio: string;
      defaultResolution: string;
      defaultOutputFormat?: string;
      supportsImageInput: boolean;
      imageInputField?: string;
      providerNameSuffix?: string;
      maxImageInput?: number;
      defaultGoogleSearch?: boolean;
      useQualityField?: boolean;
      defaultQuality?: string;
      defaultNsfwChecker?: boolean;
      useImageSizeField?: boolean;
    }> = [
      {
        cfgKey: 'nanoBanana',
        defaultModel: 'nano-banana-pro',
        defaultAspectRatio: '1:1',
        defaultResolution: '1K',
        defaultOutputFormat: 'png',
        supportsImageInput: true,
      },
      {
        cfgKey: 'nanoBanana2',
        defaultModel: 'nano-banana-2',
        defaultAspectRatio: 'auto',
        defaultResolution: '1K',
        defaultOutputFormat: 'jpg',
        supportsImageInput: true,
        maxImageInput: 14,
        defaultGoogleSearch: false,
      },
      {
        cfgKey: 'flux2',
        defaultModel: 'flux-2/flex-text-to-image',
        defaultAspectRatio: '1:1',
        defaultResolution: '1K',
        supportsImageInput: false,
        providerNameSuffix: 'flux-2',
      },
      {
        cfgKey: 'flux2I2I',
        defaultModel: 'flux-2/pro-image-to-image',
        defaultAspectRatio: 'auto',
        defaultResolution: '1K',
        supportsImageInput: true,
        imageInputField: 'input_urls',
        providerNameSuffix: 'flux-2-i2i',
      },
      {
        cfgKey: 'seedream5Lite',
        defaultModel: 'seedream/5-lite-text-to-image',
        defaultAspectRatio: '1:1',
        defaultResolution: '1K',
        supportsImageInput: false,
        providerNameSuffix: 'seedream-5-lite',
        useQualityField: true,
        defaultQuality: 'basic',
        defaultNsfwChecker: false,
      },
      {
        cfgKey: 'nanoBananaEdit',
        defaultModel: 'google/nano-banana-edit',
        defaultAspectRatio: '1:1',
        defaultResolution: '1K',
        defaultOutputFormat: 'png',
        supportsImageInput: true,
        imageInputField: 'image_urls',
        maxImageInput: 10,
        providerNameSuffix: 'nano-banana-edit',
        useImageSizeField: true,
      },
    ];

    for (const def of modelDefs) {
      const cfg = (kieai[def.cfgKey] ?? {}) as Record<string, unknown>;
      if (String(cfg.enabled ?? 'true') === 'false') continue;
      const model = String(cfg.model || def.defaultModel);
      const provider = new KieAiImageProvider({
        apiKey,
        baseUrl,
        callBackUrl,
        model,
        defaultAspectRatio: String(cfg.defaultAspectRatio || def.defaultAspectRatio),
        defaultResolution: String(cfg.defaultResolution || def.defaultResolution),
        defaultOutputFormat: def.defaultOutputFormat
          ? String(cfg.defaultOutputFormat || def.defaultOutputFormat)
          : undefined,
        supportsImageInput: def.supportsImageInput,
        imageInputField: def.imageInputField,
        providerNameSuffix: def.providerNameSuffix,
        maxImageInput: def.maxImageInput,
        defaultGoogleSearch: def.defaultGoogleSearch,
        useQualityField: def.useQualityField,
        defaultQuality: def.defaultQuality
          ? String(cfg.defaultQuality || def.defaultQuality)
          : undefined,
        defaultNsfwChecker: def.defaultNsfwChecker,
        useImageSizeField: def.useImageSizeField,
      }, this.kieAiCallbackService, this.kieAiPollingService);
      this.registerImageProvider(provider);
      this.logger.log(`Kie.ai 图片 Provider 已注册: name=${provider.name} model=${model}`);
    }

    // ── Kling 3.0 视频 Provider（与图片共享同一 apiKey + baseUrl） ──────────────
    const klingCfg = (kieai.kling ?? {}) as Record<string, unknown>;
    if (String(klingCfg.enabled ?? 'true') !== 'false') {
      const klingProvider = new KlingVideoProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultMode:     (klingCfg.defaultMode as 'std' | 'pro' | undefined) ?? 'pro',
        defaultDuration: Number(klingCfg.defaultDuration) || 5,
        defaultSound:    String(klingCfg.defaultSound) === 'true',
      });
      this.registerVideoProvider(klingProvider);
      this.logger.log(`Kling 视频 Provider 已注册: name=${klingProvider.name} mode=${klingCfg.defaultMode ?? 'pro'}`);
    }

    // ── Hailuo 2.3 Standard 视频 Provider（I2V，面部情感最优） ────────────────
    const hailuoCfg = (kieai.hailuo ?? {}) as Record<string, unknown>;
    if (String(hailuoCfg.enabled ?? 'true') !== 'false') {
      const hailuoProvider = new HailuoVideoProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultResolution: (hailuoCfg.defaultResolution as '768P' | '1080P' | undefined) ?? '768P',
        defaultDuration:   Number(hailuoCfg.defaultDuration) || 6,
      });
      this.registerVideoProvider(hailuoProvider);
      this.logger.log(`Hailuo 视频 Provider 已注册: name=${hailuoProvider.name} resolution=${hailuoCfg.defaultResolution ?? '768P'}`);
    }

    // ── Kling AI Avatar Provider（对话口型同步，共享 kieai apiKey） ─────────
    const avatarCfg = (kieai.avatar ?? {}) as Record<string, unknown>;
    if (String(avatarCfg.enabled ?? 'true') !== 'false') {
      const avatarProvider = new KlingAvatarProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultModel: String(avatarCfg.model || 'kling/ai-avatar-pro'),
      });
      this.registerVideoProvider(avatarProvider);
      this.logger.log(`Kling Avatar Provider 已注册: name=${avatarProvider.name} model=${avatarCfg.model ?? 'kling/ai-avatar-pro'}`);
    }

    // ── Veo 3.1 视频 Provider（画质天花板，共享 kieai apiKey + baseUrl） ────────
    const veoCfg = (kieai.veo ?? {}) as Record<string, unknown>;
    if (String(veoCfg.enabled ?? 'true') !== 'false') {
      const veoProvider = new VeoVideoProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultModel: (veoCfg.defaultModel as 'veo3' | 'veo3_fast' | undefined) ?? 'veo3',
        defaultAspectRatio: (veoCfg.defaultAspectRatio as '16:9' | '9:16' | undefined) ?? '16:9',
        enableTranslation: String(veoCfg.enableTranslation ?? 'true') === 'true',
      });
      this.registerVideoProvider(veoProvider);
      this.logger.log(`Veo 视频 Provider 已注册: name=${veoProvider.name} model=${veoCfg.defaultModel ?? 'veo3'}`);
    }

    // ── Sora 2 视频 Provider（长镜头连贯叙事，共享 kieai apiKey + baseUrl） ────
    const soraCfg = (kieai.sora ?? {}) as Record<string, unknown>;
    if (String(soraCfg.enabled ?? 'true') !== 'false') {
      const soraModel = (soraCfg.defaultModel as 'sora-2-image-to-video' | undefined) ?? 'sora-2-image-to-video';
      const soraProvider = new SoraVideoProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultModel: soraModel,
        defaultNFrames: (soraCfg.defaultNFrames as '10' | '15' | undefined) ?? '10',
        uploadMethod: (soraCfg.uploadMethod as 's3' | 'oss' | undefined) ?? 'oss',
        removeWatermark: String(soraCfg.removeWatermark ?? 'true') === 'true',
      });
      this.registerVideoProvider(soraProvider);
      this.logger.log(`Sora 视频 Provider 已注册: name=${soraProvider.name} model=${soraModel}`);
    }

    // ── Wan 2.2 Animate Replace（V2V 角色替换，共享 kieai apiKey + baseUrl） ──
    const wanCfg = (kieai.wanAnimate ?? {}) as Record<string, unknown>;
    if (String(wanCfg.enabled ?? 'true') !== 'false') {
      const wanProvider = new WanAnimateVideoProvider({
        apiKey,
        baseUrl,
        callBackUrl: callBackUrl || undefined,
        defaultResolution: (wanCfg.defaultResolution as '580p' | '720p' | undefined) ?? '720p',
        nsfwChecker: String(wanCfg.nsfwChecker ?? 'false') === 'true',
      });
      this.registerVideoProvider(wanProvider);
      this.logger.log(`Wan Animate Replace Provider 已注册: name=${wanProvider.name} resolution=${wanCfg.defaultResolution ?? '720p'}`);
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
