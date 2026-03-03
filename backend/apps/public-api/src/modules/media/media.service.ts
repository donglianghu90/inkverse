/** 媒体生成门面服务 — 统一入口，屏蔽 Provider 细节，供 Drama/Novel 模块调用 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { MediaJobService } from './media-job.service';
import { ImageGenerationRequest, ImageGenerationResult, VideoGenerationRequest, VideoTaskResult, TtsRequest, TtsResult, MediaProviderMeta } from './interfaces/media-provider.interface';

export interface GenerateImageOptions extends ImageGenerationRequest {
  provider?: string; // 指定 Provider，不传用默认
  dramaId?: string;
  assetType?: string; // character_image / scene_image
  refId?: string;
  userId?: string;
}

export interface SubmitVideoOptions extends VideoGenerationRequest {
  provider?: string;
  dramaId?: string;
  assetType?: string; // shot_video
  refId?: string;
  userId?: string;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger('MediaService');

  constructor(
    private readonly registry: ProviderRegistryService,
    private readonly jobService: MediaJobService,
  ) {}

  // ═══ 图片生成（同步） ═══

  async generateImage(opts: GenerateImageOptions): Promise<ImageGenerationResult & { jobId: string }> {
    const provider = this.registry.getImageProvider(opts.provider);
    const t0 = Date.now();
    const result = await provider.generate(opts);

    const job = await this.jobService.createJob({
      jobType: 'image', provider: provider.name, providerTaskId: '',
      dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
      request: { prompt: opts.prompt, size: opts.size, count: opts.count },
      userId: opts.userId,
    });
    await this.jobService.markCompleted(job.id, { images: result.images } as any, Date.now() - t0);
    this.logger.log(`图片生成完成: jobId=${job.id} provider=${provider.name} ${result.images.length}张 (${result.durationMs}ms)`);
    return { ...result, jobId: job.id };
  }

  // ═══ 视频生成（异步提交，轮询由 MediaJobService 自动处理） ═══

  async submitVideo(opts: SubmitVideoOptions): Promise<{ jobId: string; providerTaskId: string }> {
    const provider = this.registry.getVideoProvider(opts.provider);
    const submitResult = await provider.submit(opts);

    const job = await this.jobService.createJob({
      jobType: 'video', provider: provider.name, providerTaskId: submitResult.providerTaskId,
      dramaId: opts.dramaId, assetType: opts.assetType, refId: opts.refId,
      request: { prompt: opts.prompt, duration: opts.duration, quality: opts.quality, aspectRatio: opts.aspectRatio },
      userId: opts.userId,
    });
    this.logger.log(`视频任务已提交: jobId=${job.id} providerTaskId=${submitResult.providerTaskId}`);
    return { jobId: job.id, providerTaskId: submitResult.providerTaskId };
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

  async synthesizeTtsToFile(req: TtsRequest, outputPath: string, provider?: string): Promise<TtsResult> {
    const tts = this.registry.getTtsProvider(provider);
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (tts.synthesizeToFile) return tts.synthesizeToFile(req, outputPath); // Provider 原生支持写文件
    const result = await tts.synthesize(req);
    if (result.audioUrl.startsWith('data:')) { // data URI → 解码写文件
      const base64 = result.audioUrl.split(',')[1];
      fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
      result.audioUrl = outputPath;
    } else if (result.audioUrl.startsWith('http')) { // 远程 URL → 下载
      const axios = (await import('axios')).default;
      const res = await axios.get(result.audioUrl, { responseType: 'arraybuffer', timeout: 30_000 });
      fs.writeFileSync(outputPath, res.data);
      result.audioUrl = outputPath;
    }
    return result;
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
