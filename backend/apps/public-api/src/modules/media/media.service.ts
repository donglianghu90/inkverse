/** 媒体生成门面服务 — 统一入口，屏蔽 Provider 细节，供 Drama/Novel 模块调用 */
import { Injectable, Logger, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { MediaJobService } from './media-job.service';
import { MediaTraceLoggerService } from './media-trace-logger.service';
import { ImageGenerationRequest, ImageGenerationResult, VideoGenerationRequest, VideoTaskResult, TtsRequest, TtsResult, AudioGenerationRequest, AudioTaskResult, MediaProviderMeta } from './interfaces/media-provider.interface';
import { OssService, ConfigService } from '@packages/modules';
import { UsageLedgerService } from '../usage/usage-ledger.service';
import { BillingResolverService } from '../usage/billing-resolver.service';

/** 通用 scope 粒度，支持 novel(drama)/短剧(chapter/episode) 及未来模块 */
export interface MediaScopeOpts {
  episodeNumber?: number;
  chapterNumber?: number;
  assetType?: string;
  refId?: string;
}

export interface GenerateImageOptions extends ImageGenerationRequest {
  provider?: string;
  /**
   * 跨 Provider 降级：当主 provider 完整调用链全部失败时（如内容审核、服务不可用），
   * 自动切换此备用 provider 重试一次。与 volcengine 内部 seedream 版本降级是两个层次。
   */
  fallbackProvider?: string;
  /** fallbackProvider 专属 extra 参数（如 kieai 的 aspect_ratio/resolution） */
  fallbackExtra?: Record<string, unknown>;
  dramaId?: string;
  bookId?: string;
  module?: string;     // 'drama' | 'novel'
  assetType?: string;
  refId?: string;
  userId?: string;
  episodeNumber?: number;
  chapterNumber?: number;
}

export interface SubmitVideoOptions extends VideoGenerationRequest {
  provider?: string;
  /** 跨 Provider 降级：主 provider 提交失败时自动切换此备用 provider 重试 */
  fallbackProvider?: string;
  dramaId?: string;
  bookId?: string;
  module?: string;
  assetType?: string;
  refId?: string;
  userId?: string;
  episodeNumber?: number;
  chapterNumber?: number;
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
  chapterNumber?: number;
}

export interface SubmitAudioOptions extends AudioGenerationRequest {
  provider?: string;
  fallbackProvider?: string;
  dramaId?: string;
  bookId?: string;
  module?: string;
  assetType?: string;
  refId?: string;
  userId?: string;
  episodeNumber?: number;
  chapterNumber?: number;
}

@Injectable()
export class MediaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MediaService');
  private videoCompletionHandler: ((evt: { jobId: string; status: string; result?: Record<string, unknown>; error?: string }) => void) | null = null;

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly jobService: MediaJobService,
    private readonly traceLogger: MediaTraceLoggerService,
    private readonly usageLedger: UsageLedgerService,
    private readonly billingResolver: BillingResolverService,
    private readonly configService: ConfigService,
    @Optional() private readonly ossService?: OssService,
  ) {}

  onModuleInit() {
    this.videoCompletionHandler = async (evt) => {
      if (evt.status !== 'completed' && evt.status !== 'failed') return;
      const job = await this.jobService.findById(evt.jobId);
      if (!job || job.jobType !== 'video') return;
      const module = job.dramaId ? 'drama' : 'novel';
      const resourceId = job.dramaId || (job as any).bookId || '_unknown';
      const scope = job.episodeNumber != null ? `episode:${job.episodeNumber}` : ((job as any).chapterNumber != null ? `chapter:${(job as any).chapterNumber}` : (job.assetType?.startsWith('shot_') ? `shot:${job.refId || 'unknown'}` : 'creation'));
      const quality = (job.request as any)?.quality as string | undefined;
      const durationSeconds = (evt.result as any)?.durationSeconds ? Number((evt.result as any).durationSeconds) : ((job.request as any)?.duration ? Number((job.request as any).duration) : 0);
      const vidCost = evt.status === 'completed' ? this.billingResolver.resolveVideoCostCny(job.provider, quality, durationSeconds) : 0;
      const durationMs = evt.status === 'completed' && job.durationMs ? job.durationMs : 0;
      this.usageLedger.record({
        userId: job.userId ?? '', module, resourceId, scope,
        action: job.assetType ?? 'video', kind: 'video',
        provider: job.provider, model: quality ?? 'default',
        quantity: 1, costCny: vidCost,
        ok: evt.status === 'completed', durationMs,
        idempotencyKey: `video:${evt.jobId}:completed`,
      }).catch(() => {});
    };
    this.jobService.events.on('completed', this.videoCompletionHandler);
  }

  onModuleDestroy() {
    if (this.videoCompletionHandler) this.jobService.events.removeListener('completed', this.videoCompletionHandler);
  }

  private resolveModule(opts: { dramaId?: string; bookId?: string; module?: string }): string {
    return opts.module ?? (opts.dramaId ? 'drama' : opts.bookId ? 'novel' : 'unknown');
  }
  private resolveResourceId(opts: { dramaId?: string; bookId?: string }): string {
    return opts.dramaId ?? opts.bookId ?? '';
  }
  /** 统一 scope 解析：支持 episode/chapter/shot，便于 novel 与 drama 共用图片/视频/TTS */
  private resolveScope(opts: MediaScopeOpts): string {
    if (opts.episodeNumber != null) return `episode:${opts.episodeNumber}`;
    if (opts.chapterNumber != null) return `chapter:${opts.chapterNumber}`;
    if (opts.assetType?.startsWith('shot_')) return `shot:${opts.refId ?? 'unknown'}`;
    return 'creation';
  }

  // ═══ 图片生成（同步） ═══

  async generateImage(opts: GenerateImageOptions): Promise<ImageGenerationResult & { jobId: string }> {
    const provider = this.registry.getImageProvider(opts.provider);
    const t0 = Date.now();
    const callId = randomUUID();
    try {
      const result = await provider.generate(opts);
      return await this.finalizeImageResult(result, provider.name, opts, t0, callId);
    } catch (primaryErr) {
      // 跨 Provider 降级：volcengine 内容审核等全链路失败时，切换到备用 Provider 重试
      if (opts.fallbackProvider) {
        const fbProvider = this.registry.getImageProvider(opts.fallbackProvider);
        this.logger.warn(
          `Provider ${provider.name} 全链路失败，降级至 ${fbProvider.name}: ${(primaryErr as Error).message?.slice(0, 120)}`,
        );
        // 记录主 Provider 的失败事件（无论降级是否成功，主 Provider 确实失败了）
        this.usageLedger.record({
          userId: opts.userId ?? '', module: this.resolveModule(opts),
          resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
          action: opts.assetType ?? 'image', kind: 'image',
          provider: provider.name, model: 'unknown',
          quantity: opts.count ?? 1, costCny: 0,
          ok: false, durationMs: Date.now() - t0,
          idempotencyKey: `img:${callId}:${provider.name}:fail`,
        }).catch(() => {});
        try {
          const fbOpts: GenerateImageOptions = {
            ...opts,
            extra: opts.fallbackExtra ?? opts.extra,
            provider: opts.fallbackProvider,
            fallbackProvider: undefined,
            fallbackExtra: undefined,
          };
          const fbResult = await fbProvider.generate(fbOpts);
          return await this.finalizeImageResult(fbResult, fbProvider.name, opts, t0, callId);
        } catch (fbErr) {
          this.logger.error(
            `备用 Provider ${fbProvider.name} 亦失败: ${(fbErr as Error).message?.slice(0, 120)}`,
          );
          // 录入备用 Provider 的失败 usage，避免统计遗漏
          this.usageLedger.record({
            userId: opts.userId ?? '', module: this.resolveModule(opts),
            resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
            action: opts.assetType ?? 'image', kind: 'image',
            provider: fbProvider.name, model: 'unknown',
            quantity: opts.count ?? 1, costCny: 0,
            ok: false, durationMs: Date.now() - t0,
            idempotencyKey: `img:${callId}:${fbProvider.name}:fail`,
          }).catch(() => {});
        }
      }

      this.traceLogger.logT2i({
        provider: provider.name, model: 'unknown', durationMs: Date.now() - t0,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
        input: {
          prompt: opts.prompt, size: opts.size, count: opts.count ?? 1,
          referenceImages: opts.referenceImages?.length,
          referenceImageUrls: opts.referenceImages?.map(r => r.url),
        },
        output: {}, status: 'error', error: (primaryErr as Error).message,
      });
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'image', kind: 'image',
        provider: provider.name, model: 'unknown',
        quantity: opts.count ?? 1, costCny: 0,
        ok: false, durationMs: Date.now() - t0,
        idempotencyKey: `img:${callId}:${provider.name}:fail`,
      }).catch(() => {});
      throw primaryErr;
    }
  }

  private async finalizeImageResult(
    result: ImageGenerationResult,
    providerName: string,
    opts: GenerateImageOptions,
    t0: number,
    callId?: string,
  ): Promise<ImageGenerationResult & { jobId: string }> {
    await this.persistImagesToOss(result, opts);
    const job = await this.jobService.createJob({
      jobType: 'image', provider: providerName, providerTaskId: '',
      dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
      request: { prompt: opts.prompt, size: opts.size, count: opts.count },
      userId: opts.userId,
    });
    await this.jobService.markCompleted(job.id, { images: result.images } as any, Date.now() - t0);
    this.logger.log(`图片生成完成: jobId=${job.id} provider=${providerName} ${result.images.length}张 (${result.durationMs}ms)`);
    const imgCount = result.images.length;
    const imgUnitCost = this.billingResolver.resolveImageCostCny(providerName, result.model, opts.size);
    this.traceLogger.logT2i({
      provider: providerName, model: result.model, durationMs: result.durationMs,
      dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
      input: {
        prompt: opts.prompt, size: opts.size, count: opts.count ?? 1,
        referenceImages: opts.referenceImages?.length,
        referenceImageUrls: opts.referenceImages?.map(r => r.url),
      },
      output: { imageUrls: result.images.map(i => i.url) },
      status: 'success', jobId: job.id,
      costCny: imgCount * imgUnitCost,
    });
    const idempotencyKey = callId ? `img:${callId}:${providerName}:ok` : `img:${job.id}:ok`;
    this.usageLedger.record({
      userId: opts.userId ?? '', module: this.resolveModule(opts),
      resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
      action: opts.assetType ?? 'image', kind: 'image',
      provider: providerName, model: result.model,
      quantity: imgCount, costCny: imgCount * imgUnitCost,
      ok: true, durationMs: result.durationMs,
      idempotencyKey,
    }).catch(() => {});
    return { ...result, jobId: job.id };
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
    const callId = randomUUID();
    try {
      const submitResult = await provider.submit(opts);
      const job = await this.jobService.createJob({
        jobType: 'video', provider: provider.name, providerTaskId: submitResult.providerTaskId,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId, episodeNumber: opts.episodeNumber,
        request: { prompt: opts.prompt, duration: opts.duration, quality: opts.quality, aspectRatio: opts.aspectRatio },
        userId: opts.userId,
      });
      this.logger.log(`视频任务已提交: jobId=${job.id} provider=${provider.name} providerTaskId=${submitResult.providerTaskId}`);
      return { jobId: job.id, providerTaskId: submitResult.providerTaskId };
    } catch (primaryErr) {
      // 跨 Provider 降级：主 provider 提交失败时切换备用 provider 重试
      if (opts.fallbackProvider) {
        const fbProvider = this.registry.getVideoProvider(opts.fallbackProvider);
        this.logger.warn(
          `视频 Provider ${provider.name} 提交失败，降级至 ${fbProvider.name}: ${(primaryErr as Error).message?.slice(0, 120)}`,
        );
        // 记录主 Provider 的提交失败事件
        this.usageLedger.record({
          userId: opts.userId ?? '', module: this.resolveModule(opts),
          resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
          action: opts.assetType ?? 'video', kind: 'video',
          provider: provider.name, model: opts.quality ?? 'default',
          quantity: 1, costCny: 0,
          ok: false, durationMs: 0,
          idempotencyKey: `vid:${callId}:${provider.name}:submit-fail`,
        }).catch(() => {});
        try {
          // submit() 只接受 VideoGenerationRequest，将 SubmitVideoOptions 的扩展字段剥离后传入
          const { provider: _p, fallbackProvider: _fb, dramaId: _d, bookId: _b, module: _m,
            assetType: _at, refId: _rid, userId: _u, episodeNumber: _ep, chapterNumber: _ch,
            ...videoReq } = opts;
          const fbResult = await fbProvider.submit(videoReq);
          const job = await this.jobService.createJob({
            jobType: 'video', provider: fbProvider.name, providerTaskId: fbResult.providerTaskId,
            dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId, episodeNumber: opts.episodeNumber,
            request: { prompt: opts.prompt, duration: opts.duration, quality: opts.quality, aspectRatio: opts.aspectRatio },
            userId: opts.userId,
          });
          this.logger.log(`视频任务已提交(降级): jobId=${job.id} provider=${fbProvider.name} providerTaskId=${fbResult.providerTaskId}`);
          return { jobId: job.id, providerTaskId: fbResult.providerTaskId };
        } catch (fbErr) {
          this.logger.error(`备用视频 Provider ${fbProvider.name} 亦失败: ${(fbErr as Error).message?.slice(0, 120)}`);
          // 录入备用 Provider 的失败 usage，避免统计遗漏
          this.usageLedger.record({
            userId: opts.userId ?? '', module: this.resolveModule(opts),
            resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
            action: opts.assetType ?? 'video', kind: 'video',
            provider: fbProvider.name, model: opts.quality ?? 'default',
            quantity: 1, costCny: 0,
            ok: false, durationMs: 0,
            idempotencyKey: `vid:${callId}:${fbProvider.name}:submit-fail`,
          }).catch(() => {});
        }
      }
      this.usageLedger.record({
        userId: opts.userId ?? '', module: this.resolveModule(opts),
        resourceId: this.resolveResourceId(opts), scope: this.resolveScope(opts),
        action: opts.assetType ?? 'video', kind: 'video',
        provider: provider.name, model: opts.quality ?? 'default',
        quantity: 1, costCny: 0,
        ok: false, durationMs: 0,
        idempotencyKey: `vid:${callId}:${provider.name}:submit-fail`,
      }).catch(() => {});
      throw primaryErr;
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

  // ═══ 音频 (Audio / SFX) 生成 ═══

  async submitAudio(opts: SubmitAudioOptions): Promise<{ jobId: string; providerTaskId: string }> {
    const provider = this.registry.getAudioProvider(opts.provider);
    const callId = randomUUID();
    try {
      const submitResult = await provider.submit(opts);
      const job = await this.jobService.createJob({
        jobType: 'audio', provider: provider.name, providerTaskId: submitResult.providerTaskId,
        dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId, episodeNumber: opts.episodeNumber,
        request: { prompt: opts.prompt, duration: opts.duration, referenceVideoUrl: opts.referenceVideoUrl },
        userId: opts.userId,
      });
      this.logger.log(`Audio task submitted: jobId=${job.id} provider=${provider.name} taskId=${submitResult.providerTaskId}`);
      return { jobId: job.id, providerTaskId: submitResult.providerTaskId };
    } catch (primaryErr) {
      if (opts.fallbackProvider) {
        const fbProvider = this.registry.getAudioProvider(opts.fallbackProvider);
        this.logger.warn(`Audio Provider ${provider.name} failed, falling back to ${fbProvider.name}: ${(primaryErr as Error).message}`);
        try {
          const { provider: _p, fallbackProvider: _fb, dramaId: _d, bookId: _b, module: _m, assetType: _at, refId: _rid, userId: _u, episodeNumber: _ep, chapterNumber: _ch, ...audioReq } = opts;
          const fbResult = await fbProvider.submit(audioReq);
          const job = await this.jobService.createJob({
            jobType: 'audio', provider: fbProvider.name, providerTaskId: fbResult.providerTaskId,
            dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId, episodeNumber: opts.episodeNumber,
            request: { prompt: opts.prompt, duration: opts.duration },
            userId: opts.userId,
          });
          return { jobId: job.id, providerTaskId: fbResult.providerTaskId };
        } catch (fbErr) {
          this.logger.error(`Fallback Audio Provider ${fbProvider.name} failed: ${(fbErr as Error).message}`);
        }
      }
      throw primaryErr;
    }
  }

  async queryAudioJob(jobId: string): Promise<AudioTaskResult & { jobId: string }> {
    const job = await this.jobService.findById(jobId);
    if (!job) throw new Error(`Media job ${jobId} not found`);
    if (job.status === 'completed' || job.status === 'failed') {
      return {
        jobId: job.id, providerTaskId: job.providerTaskId, status: job.status,
        audioUrl: (job.result as any)?.audioUrl,
        durationSeconds: (job.result as any)?.durationSeconds,
        error: job.error || undefined, provider: job.provider, model: '',
      };
    }
    const provider = this.registry.getAudioProvider(job.provider);
    return { ...(await provider.query(job.providerTaskId)), jobId: job.id };
  }

  async cancelAudioJob(jobId: string): Promise<void> {
    const job = await this.jobService.findById(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') return;
    const provider = this.registry.getAudioProvider(job.provider);
    await provider.cancel(job.providerTaskId);
    await this.jobService.markFailed(job.id, 'User cancelled');
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
    const ttsUnitCost = this.billingResolver.resolveTtsCostCny(tts.name, req.voiceId);
    const t0 = Date.now();
    const ttsCallId = randomUUID();
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
      // Provider 未返回时长时（如 ElevenLabs/kie.ai），用 ffprobe 从本地文件获取实际时长
      if (result.durationSeconds <= 0 && fs.existsSync(outPath)) {
        try {
          const execFileAsync = promisify(execFile);
          const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath,
          ]);
          const probedDuration = parseFloat(stdout.trim());
          if (probedDuration > 0) {
            result.durationSeconds = probedDuration;
            this.logger.debug(`TTS ffprobe 补充时长: ${probedDuration.toFixed(2)}s (${outPath})`);
          }
        } catch (probeErr) {
          this.logger.warn(`TTS ffprobe 获取时长失败: ${(probeErr as Error).message}`);
        }
      }
      const mod = meta.module ?? (meta.dramaId ? 'drama' : meta.bookId ? 'novel' : 'unknown');
      const resourceId = meta.dramaId ?? meta.bookId ?? '';
      const scope = this.resolveScope({ episodeNumber: meta.episodeNumber, chapterNumber: meta.chapterNumber });
      this.usageLedger.record({
        userId: meta.userId ?? '', module: mod, resourceId, scope,
        action: 'tts', kind: 'tts', provider: tts.name, model: req.voiceId || 'default',
        quantity: 1, costCny: ttsUnitCost, ok: true, durationMs: Date.now() - t0,
        idempotencyKey: `tts:${ttsCallId}:ok`,
      }).catch(() => {});
      return result;
    } catch (err) {
      const mod = meta.module ?? (meta.dramaId ? 'drama' : meta.bookId ? 'novel' : 'unknown');
      const resourceId = meta.dramaId ?? meta.bookId ?? '';
      const scope = this.resolveScope({ episodeNumber: meta.episodeNumber, chapterNumber: meta.chapterNumber });
      this.usageLedger.record({
        userId: meta.userId ?? '', module: mod, resourceId, scope,
        action: 'tts', kind: 'tts', provider: tts.name, model: req.voiceId || 'default',
        quantity: 1, costCny: 0, ok: false, durationMs: Date.now() - t0,
        idempotencyKey: `tts:${ttsCallId}:fail`,
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
