/** Kie.ai 异步图片生成 Provider，支持 nano-banana-pro / nano-banana-2 / flux-2 等多模型。
 *
 * 等待结果优先级：
 *   1. 回调模式（callBackUrl + KieAiCallbackService）— 最优，服务端推送
 *   2. 共享轮询（KieAiPollingService）— 单调度器，10s tick，300s 超时
 *   （无以上两种时不应发生，ProviderRegistry 注册时必须至少提供 pollingService）
 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ImageProvider, ImageCapability, ImageGenerationRequest, ImageGenerationResult } from '../../interfaces/media-provider.interface';
import { KieAiCallbackService, KieAiTaskData } from './kieai-callback.service';
import { KieAiPollingService } from './kieai-polling.service';
import { kieAiRateLimitAcquireSubmit } from './kieai-rate-limiter';

export interface KieAiImageConfig {
  apiKey: string;
  baseUrl: string;
  /** 回调地址，线上部署时填写实际服务地址 */
  callBackUrl: string;
  model: string;
  /** 默认宽高比，如 '1:1' */
  defaultAspectRatio: string;
  /** 默认分辨率，如 '1K' */
  defaultResolution: string;
  /** 默认输出格式，如 'png'；不传则 input 中不包含 output_format 字段 */
  defaultOutputFormat?: string;
  /** 是否支持参考图（I2I），false 时只注册 t2i 能力，默认 true */
  supportsImageInput?: boolean;
  /**
   * 参考图在 input 对象中的字段名，默认 'image_input'。
   * flux-2/pro-image-to-image 使用 'input_urls'。
   */
  imageInputField?: string;
  /**
   * 覆盖自动推导的 provider name 后缀（kieai.<suffix>）。
   * 默认取 model 中 '/' 前的部分，多个模型同前缀时需手动区分。
   */
  providerNameSuffix?: string;
  /** 参考图最大数量，默认 8；nano-banana-2 支持最多 14 张 */
  maxImageInput?: number;
  /**
   * 是否在 input 中包含 google_search 字段。
   * undefined = 不发送；true/false = 发送对应布尔值（可被 req.extra.google_search 覆盖）。
   */
  defaultGoogleSearch?: boolean;
  /**
   * 使用 quality 字段替代 resolution 字段（Seedream 5.0 Lite 系列）。
   * true 时 input 发送 quality（basic/high），不发送 resolution。
   */
  useQualityField?: boolean;
  /** 默认质量档位，仅 useQualityField=true 时生效，枚举: 'basic' | 'high'，默认 'basic' */
  defaultQuality?: string;
  /**
   * 是否在 input 中包含 nsfw_checker 字段。
   * undefined = 不发送；true/false = 发送对应布尔值（可被 req.extra.nsfw_checker 覆盖）。
   */
  defaultNsfwChecker?: boolean;
  /**
   * 使用 image_size 字段替代 aspect_ratio + resolution（google/nano-banana-edit 系列）。
   * true 时 input 发送 image_size（如 '1:1'），不发送 aspect_ratio / resolution。
   */
  useImageSizeField?: boolean;
}

interface KieAiCreateResponse {
  code: number;
  msg?: string;      // API 文档字段名
  message?: string;  // 兼容旧字段
  data?: { taskId: string };
}

export class KieAiImageProvider implements ImageProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ImageCapability>;
  private readonly logger = new Logger('KieAiImage');
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: KieAiImageConfig,
    /** 回调模式：服务端主动推送结果（需配置 callBackUrl） */
    private readonly callbackService?: KieAiCallbackService,
    /** 轮询模式：共享调度器，每 10s 统一轮询所有挂起任务 */
    private readonly pollingService?: KieAiPollingService,
  ) {
    const suffix = config.providerNameSuffix ?? config.model.split('/')[0];
    this.name = `kieai.${suffix}`;
    const caps: ImageCapability[] = ['t2i'];
    if (config.supportsImageInput !== false) caps.push('i2i');
    this.capabilities = new Set<ImageCapability>(caps);
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const t0 = Date.now();
    const model = this.config.model;

    const aspectRatio = (req.extra?.aspect_ratio as string) || this.config.defaultAspectRatio;
    const outputFormat = (req.extra?.output_format as string) || this.config.defaultOutputFormat;

    const maxImages = this.config.maxImageInput ?? 8;
    // Kie.ai API 要求 image_input 为合法 URL（format: uri），不支持 base64 data URI
    const imageInput: string[] = this.config.supportsImageInput !== false
      ? (req.referenceImages ?? [])
          .map(img => img.url ?? '')
          .filter(u => /^https?:\/\//.test(u))
          .slice(0, maxImages)
      : [];

    const imageInputField = this.config.imageInputField ?? 'image_input';

    const input: Record<string, unknown> = {
      prompt: req.prompt,
    };

    if (this.config.useImageSizeField) {
      // google/nano-banana-edit: 用 image_size 代替 aspect_ratio + resolution
      input.image_size = aspectRatio;
    } else {
      input.aspect_ratio = aspectRatio;
      if (this.config.useQualityField) {
        const quality = (req.extra?.quality as string) || this.config.defaultQuality || 'basic';
        input.quality = quality;
      } else {
        const resolution = (req.extra?.resolution as string) || this.config.defaultResolution;
        input.resolution = resolution;
      }
    }

    if (outputFormat) input.output_format = outputFormat;
    if (imageInput.length) input[imageInputField] = imageInput;
    if (this.config.defaultGoogleSearch !== undefined) {
      input.google_search = req.extra?.google_search ?? this.config.defaultGoogleSearch;
    }
    if (this.config.defaultNsfwChecker !== undefined) {
      input.nsfw_checker = req.extra?.nsfw_checker ?? this.config.defaultNsfwChecker;
    }

    const body: Record<string, unknown> = { model, input };
    if (this.config.callBackUrl) body.callBackUrl = this.config.callBackUrl;

    const useCallback = !!(this.callbackService && this.config.callBackUrl);
    const mode = useCallback ? 'callback' : 'polling';

    const qualityOrRes = this.config.useQualityField
      ? `quality=${input.quality}`
      : `res=${input.resolution}`;
    this.logger.log(
      `提交任务 [${mode}]: model=${model} ratio=${aspectRatio} ${qualityOrRes}` +
      (outputFormat ? ` fmt=${outputFormat}` : '') +
      (imageInput.length ? ` refImages=${imageInput.length}张` : '') +
      (this.config.defaultGoogleSearch !== undefined ? ` googleSearch=${input.google_search}` : '') +
      (this.config.defaultNsfwChecker !== undefined ? ` nsfwChecker=${input.nsfw_checker}` : ''),
    );

    await kieAiRateLimitAcquireSubmit();
    const createRes = await this.http.post<KieAiCreateResponse>('/api/v1/jobs/createTask', body);
    if (createRes.data.code !== 200 || !createRes.data.data?.taskId) {
      throw new Error(`Kie.ai createTask 失败: code=${createRes.data.code} msg=${createRes.data.msg ?? createRes.data.message}`);
    }

    const taskId = createRes.data.data.taskId;
    this.logger.log(`任务已提交: taskId=${taskId}，等待结果 [${mode}]…`);

    let result: KieAiTaskData;
    if (useCallback) {
      // 回调模式：等待 KieAiCallbackService 被控制器触发
      result = await this.callbackService!.waitForTask(taskId, 300_000);
    } else if (this.pollingService) {
      // 共享轮询模式：注册到调度器，等待下一个 tick 拉取结果
      result = await this.pollingService.waitForTask(taskId, model);
    } else {
      throw new Error('KieAiImageProvider: 未注入 pollingService 或 callbackService');
    }

    const images = this.parseResultUrls(result);
    const durationMs = Date.now() - t0;
    this.logger.log(`图片生成完成: ${images.length}张 taskId=${taskId} (${durationMs}ms)`);

    return { images, provider: this.name, model, durationMs, raw: result };
  }

  private parseResultUrls(result: KieAiTaskData): Array<{ url: string }> {
    if (!result.resultJson) return [];
    try {
      const parsed = JSON.parse(result.resultJson) as { resultUrls?: string[] };
      return (parsed.resultUrls ?? []).map(url => ({ url }));
    } catch {
      this.logger.warn(`resultJson 解析失败: ${result.resultJson?.slice(0, 200)}`);
      return [];
    }
  }
}
