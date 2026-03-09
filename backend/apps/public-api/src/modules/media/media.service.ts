/** 媒体生成门面服务 — 统一入口，屏蔽 Provider 细节，供 Drama/Novel 模块调用 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { MediaJobService } from './media-job.service';
import { MediaTraceLoggerService } from './media-trace-logger.service';
import { ImageGenerationRequest, ImageGenerationResult, VideoGenerationRequest, VideoTaskResult, TtsRequest, TtsResult, MediaProviderMeta } from './interfaces/media-provider.interface';
import { OssService, ConfigService } from '@packages/modules';
import { UsageLedgerService } from '../usage/usage-ledger.service';

export interface GenerateImageOptions extends ImageGenerationRequest {
  provider?: string;
  dramaId?: string;
  bookId?: string;
  module?: string;     // 'drama' | 'novel'
  assetType?: string;
  refId?: string;
  userId?: string;
  episodeNumber?: number;
}

export interface SubmitVideoOptions extends VideoGenerationRequest {
  provider?: string;
  dramaId?: string;
  bookId?: string;
  module?: string;
  assetType?: string;
  refId?: string;
  userId?: string;
  episodeNumber?: number;
}

export interface SynthesizeTtsOptions {
  request: TtsRequest;
  outputPath: string;
  provider?: string;
  dramaId?: string;
  bookId?: string;
  module?: string;
  userId?: string;
  episodeNumber?: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger('MediaService');
  private readonly imageCostByProvider: Record<string, number> = {};
  private readonly videoCostByProvider: Record<string, number> = {};
  private readonly ttsCostByProvider: Record<string, number> = {};

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly jobService: MediaJobService,
    private readonly traceLogger: MediaTraceLoggerService,
    private readonly usageLedger: UsageLedgerService,
    private readonly configService: ConfigService,
    @Optional() private readonly ossService?: OssService,
  ) {
    const mediaCost = (this.configService.get('media.cost') ?? {}) as Record<string, unknown>;
    const image = (mediaCost.image ?? {}) as Record<string, unknown>;
    const video = (mediaCost.video ?? {}) as Record<string, unknown>;
    const tts = (mediaCost.tts ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(image)) this.imageCostByProvider[k] = Number(v) || 0;
    for (const [k, v] of Object.entries(video)) this.videoCostByProvider[k] = Number(v) || 0;
    for (const [k, v] of Object.entries(tts)) this.ttsCostByProvider[k] = Number(v) || 0;
  }

  private resolveModule(opts: { dramaId?: string; bookId?: string; module?: string }): string {
    return opts.module ?? (opts.dramaId ? 'drama' : opts.bookId ? 'novel' : 'unknown');
  }
  private resolveResourceId(opts: { dramaId?: string; bookId?: string }): string {
    return opts.dramaId ?? opts.bookId ?? '';
  }
  private resolveScope(opts: { assetType?: string; refId?: string; episodeNumber?: number }): string {
    if (opts.episodeNumber) return `episode:${opts.episodeNumber}`;
    if (opts.assetType?.startsWith('shot_')) return `shot:${opts.refId ?? 'unknown'}`;
    return 'creation';
  }

  // ═══ 图片生成（同步） ═══

  async generateImage(opts: GenerateImageOptions): Promise<ImageGenerationResult & { jobId: string }> {
    const provider = this.registry.getImageProvider(opts.provider);
    const t0 = Date.now();
    try {
      const result = await provider.generate(opts);

      await this.persistImagesToOss(result, opts);

      const job = await this.jobService.createJob({
        jobType: 'image', provider: provider.name, providerTaskId: '',
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
        request: { prompt: opts.prompt, size: opts.size, count: opts.count },
        userId: opts.userId,
      });
      await this.jobService.markCompleted(job.id, { images: result.images } as any, Date.now() - t0);
      this.logger.log(`图片生成完成: jobId=${job.id} provider=${provider.name} ${result.images.length}张 (${result.durationMs}ms)`);
      this.traceLogger.logT2i({
        provider: provider.name, model: result.model, durationMs: result.durationMs,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
        input: { prompt: opts.prompt, size: opts.size, count: opts.count ?? 1, referenceImages: opts.referenceImages?.length },
        output: { imageUrls: result.images.map(i => i.url) },
        status: 'success', jobId: job.id,
      });
      const imgCount = result.images.length;
      const imgUnitCost = this.imageCostByProvider[provider.name] ?? 0.04;
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'image', kind: 'image',
        provider: provider.name, model: result.model,
        quantity: imgCount, costUsd: imgCount * imgUnitCost,
        ok: true, durationMs: result.durationMs,
      }).catch(() => {});
      return { ...result, jobId: job.id };
    } catch (err) {
      this.traceLogger.logT2i({
        provider: provider.name, model: 'unknown', durationMs: Date.now() - t0,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
        input: { prompt: opts.prompt, size: opts.size, count: opts.count ?? 1, referenceImages: opts.referenceImages?.length },
        output: {}, status: 'error', error: (err as Error).message,
      });
      const imgUnitCost = this.imageCostByProvider[provider.name] ?? 0.04;
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'image', kind: 'image',
        provider: provider.name, model: 'unknown',
        quantity: opts.count ?? 1, costUsd: (opts.count ?? 1) * imgUnitCost,
        ok: false, durationMs: Date.now() - t0,
      }).catch(() => {});
      throw err;
    }
  }

  /**
   * 将生成的图片转存到 OSS，替换临时 URL 为永久链接。
   * 火山引擎等 Provider 返回的图片 URL 有效期仅 24 小时，必须及时持久化。
   */
  private async persistImagesToOss(result: ImageGenerationResult, opts: GenerateImageOptions): Promise<void> {
    if (!this.ossService) return;

    const tasks = result.images.map(async (img, idx) => {
      if (!img.url || !img.url.startsWith('http')) return;
      try {
        const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
        const dramaSegment = opts.dramaId ? `${opts.dramaId}/` : '';
        const assetSegment = opts.assetType ? `${opts.assetType}/` : '';
        const ossPath = `media/images/${datePrefix}/${dramaSegment}${assetSegment}${randomUUID()}.png`;

        const uploaded = await this.ossService!.uploadFromUrl(img.url, ossPath);
        this.logger.log(`图片已持久化到 OSS: ${ossPath}`);
        img.url = uploaded.url;
      } catch (err) {
        this.logger.warn(`图片持久化到 OSS 失败 (idx=${idx}), 保留原始临时 URL: ${(err as Error).message}`);
      }
    });
    await Promise.all(tasks);
  }

  // ═══ 视频生成（异步提交，轮询由 MediaJobService 自动处理） ═══

  async submitVideo(opts: SubmitVideoOptions): Promise<{ jobId: string; providerTaskId: string }> {
    const provider = this.registry.getVideoProvider(opts.provider);
    const vidUnitCost = this.videoCostByProvider[provider.name] ?? 0.50;
    try {
      const submitResult = await provider.submit(opts);
      const job = await this.jobService.createJob({
        jobType: 'video', provider: provider.name, providerTaskId: submitResult.providerTaskId,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
        request: { prompt: opts.prompt, duration: opts.duration, quality: opts.quality, aspectRatio: opts.aspectRatio },
        userId: opts.userId,
      });
      this.logger.log(`视频任务已提交: jobId=${job.id} providerTaskId=${submitResult.providerTaskId}`);
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'video', kind: 'video',
        provider: provider.name, model: opts.quality ?? 'default',
        quantity: 1, costUsd: vidUnitCost,
        ok: true, durationMs: 0,
      }).catch(() => {});
      return { jobId: job.id, providerTaskId: submitResult.providerTaskId };
    } catch (err) {
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'video', kind: 'video',
        provider: provider.name, model: opts.quality ?? 'default',
        quantity: 1, costUsd: vidUnitCost,
        ok: false, durationMs: 0,
      }).catch(() => {});
      throw err;
    }
  }

  // ═══ 查询视频任务状态 ═══

  async queryVideoJob(jobId: string): Promise<VideoTaskResult & { jobId: string }> {
    const job = await this.jobService.findById(jobId);
    if (!job) throw new Error(`媒体任务 ${jobId} 不存在`);
    if (job.status === 'completed' || job.status === 'failed') {
      return {
        jobId: job.id, providerTaskId: job.providerTaskId, status: job.status,
        videoUrl: (job.result as any)?.videoUrl, coverUrl: (job.result as any)?.coverUrl,
        durationSeconds: (job.result as any)?.durationSeconds,
        error: job.error || undefined, provider: job.provider, model: '',
      };
    }
    const provider = this.registry.getVideoProvider(job.provider);
    return { ...(await provider.query(job.providerTaskId)), jobId: job.id };
  }

  // ═══ 取消视频任务 ═══

  async cancelVideoJob(jobId: string): Promise<void> {
    const job = await this.jobService.findById(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    const provider = this.registry.getVideoProvider(job.provider);
    await provider.cancel(job.providerTaskId);
    await this.jobService.markFailed(job.id, '用户取消');
  }

  // ═══ 批量生成（供 Drama Pipeline 调用） ═══

  async batchGenerateImages(requests: GenerateImageOptions[]): Promise<Array<ImageGenerationResult & { jobId: string }>> {
    return Promise.all(requests.map(req => this.generateImage(req)));
  }

  async batchSubmitVideos(requests: SubmitVideoOptions[]): Promise<Array<{ jobId: string; providerTaskId: string }>> {
    const results: Array<{ jobId: string; providerTaskId: string }> = [];
    for (const req of requests) results.push(await this.submitVideo(req)); // 串行避免并发限流
    return results;
  }

  // ═══ TTS 语音合成（写入本地文件） ═══

  async synthesizeTtsToFile(opts: SynthesizeTtsOptions): Promise<TtsResult>;
  /** @deprecated 使用 SynthesizeTtsOptions 重载 */
  async synthesizeTtsToFile(req: TtsRequest, outputPath: string, provider?: string): Promise<TtsResult>;
  async synthesizeTtsToFile(
    reqOrOpts: TtsRequest | SynthesizeTtsOptions,
    outputPath?: string,
    providerHint?: string,
  ): Promise<TtsResult> {
    const isNewApi = 'request' in reqOrOpts && 'outputPath' in reqOrOpts;
    const req: TtsRequest = isNewApi ? (reqOrOpts as SynthesizeTtsOptions).request : reqOrOpts as TtsRequest;
    const outPath = isNewApi ? (reqOrOpts as SynthesizeTtsOptions).outputPath : outputPath!;
    const prov = isNewApi ? (reqOrOpts as SynthesizeTtsOptions).provider : providerHint;
    const meta = isNewApi ? reqOrOpts as SynthesizeTtsOptions : {} as Partial<SynthesizeTtsOptions>;

    const tts = this.registry.getTtsProvider(prov);
    const ttsUnitCost = this.ttsCostByProvider[tts.name] ?? 0.01;
    const t0 = Date.now();
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      let result: TtsResult;
      if (tts.synthesizeToFile) {
        result = await tts.synthesizeToFile(req, outPath);
      } else {
        result = await tts.synthesize(req);
        if (result.audioUrl.startsWith('data:')) {
          const base64 = result.audioUrl.split(',')[1];
          fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
          result.audioUrl = outPath;
        } else if (result.audioUrl.startsWith('http')) {
          const axios = (await import('axios')).default;
          const res = await axios.get(result.audioUrl, { responseType: 'arraybuffer', timeout: 30_000 });
          fs.writeFileSync(outPath, res.data);
          result.audioUrl = outPath;
        }
      }
      const mod = meta.module ?? (meta.dramaId ? 'drama' : meta.bookId ? 'novel' : 'unknown');
      const resourceId = meta.dramaId ?? meta.bookId ?? '';
      const scope = meta.episodeNumber != null ? `episode:${meta.episodeNumber}` : 'creation';
      this.usageLedger.record({
        userId: meta.userId ?? '', module: mod, resourceId, scope,
        action: 'tts', kind: 'tts', provider: tts.name, model: req.voiceId || 'default',
        quantity: 1, costUsd: ttsUnitCost, ok: true, durationMs: Date.now() - t0,
      }).catch(() => {});
      return result;
    } catch (err) {
      const mod = meta.module ?? (meta.dramaId ? 'drama' : meta.bookId ? 'novel' : 'unknown');
      const resourceId = meta.dramaId ?? meta.bookId ?? '';
      const scope = meta.episodeNumber != null ? `episode:${meta.episodeNumber}` : 'creation';
      this.usageLedger.record({
        userId: meta.userId ?? '', module: mod, resourceId, scope,
        action: 'tts', kind: 'tts', provider: tts.name, model: req.voiceId || 'default',
        quantity: 1, costUsd: ttsUnitCost, ok: false, durationMs: Date.now() - t0,
      }).catch(() => {});
      throw err;
    }
  }

  // ═══ 查询 ═══

  async findJob(jobId: string) { return this.jobService.findById(jobId); }
  async listJobsByDrama(dramaId: string) { return this.jobService.findByDrama(dramaId); }
  listProviders(): MediaProviderMeta[] { return this.registry.listProviders(); }

  onJobCompleted(cb: (evt: { jobId: string; status: string; result?: Record<string, unknown> }) => void) {
    this.jobService.events.on('completed', cb);
  }

  offJobCompleted(cb: (...args: any[]) => void) { // 取消事件监听
    this.jobService.events.removeListener('completed', cb);
  }
}
