/** 媒体任务生命周期管理 — 创建/查询/轮询异步视频任务 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { MediaJobEntity, MediaJobType } from './entities/media-job.entity';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { VideoTaskStatus } from './interfaces/media-provider.interface';
import { EventEmitter } from 'events';

const POLL_INTERVAL_MS = 8_000; // 8秒轮询一次

export interface JobCompletedEvent { jobId: string; status: VideoTaskStatus; result?: Record<string, unknown>; error?: string }

@Injectable()
export class MediaJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MediaJob');
  readonly events = new EventEmitter(); // 外部监听 'completed' 事件
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    @InjectRepository(MediaJobEntity) private readonly repo: Repository<MediaJobEntity>,
    private readonly registry: ProviderRegistryService,
  ) {}

  onModuleInit() { this.startPolling(); }
  onModuleDestroy() { if (this.pollTimer) clearInterval(this.pollTimer); }

  async createJob(params: { jobType: MediaJobType; provider: string; providerTaskId: string; dramaId?: string; assetType?: string; refId?: string; episodeNumber?: number; request: Record<string, unknown>; userId?: string }): Promise<MediaJobEntity> {
    const entity = this.repo.create({
      jobType: params.jobType, provider: params.provider,
      providerTaskId: params.providerTaskId, status: 'pending' as VideoTaskStatus,
      dramaId: params.dramaId ?? null, assetType: params.assetType ?? '',
      refId: params.refId ?? '', episodeNumber: params.episodeNumber ?? null,
      request: params.request, userId: params.userId ?? null,
    });
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<MediaJobEntity | null> { return this.repo.findOne({ where: { id } }); }

  async findByDrama(dramaId: string): Promise<MediaJobEntity[]> {
    return this.repo.find({ where: { dramaId }, order: { createdAt: 'ASC' } });
  }

  async markCompleted(id: string, result: Record<string, unknown>, durationMs: number): Promise<void> {
    await this.repo.update(id, { status: 'completed', result, durationMs });
    const job = await this.findById(id);
    if (job) this.events.emit('completed', { jobId: id, status: 'completed' as VideoTaskStatus, result } as JobCompletedEvent);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.repo.update(id, { status: 'failed', error });
    this.events.emit('completed', { jobId: id, status: 'failed' as VideoTaskStatus, error } as JobCompletedEvent);
  }

  async deleteByDrama(dramaId: string): Promise<number> {
    const r = await this.repo.delete({ dramaId });
    return r.affected ?? 0;
  }

  // ═══ 异步轮询 — 定期检查未完成的视频任务 ═══

  private startPolling() {
    this.pollTimer = setInterval(() => this.pollPendingJobs(), POLL_INTERVAL_MS);
    this.logger.log(`视频任务轮询已启动 (间隔 ${POLL_INTERVAL_MS}ms)`);
    setTimeout(() => this.pollPendingJobs(), 3000); // 启动3秒后首次扫描
  }

  private async pollPendingJobs() {
    if (this.polling) return;
    this.polling = true;
    try {
      const pending = await this.repo.find({
        where: { jobType: 'video' as MediaJobType, status: In(['pending', 'processing'] as VideoTaskStatus[]) },
        order: { createdAt: 'ASC' }, take: 50,
      });
      if (!pending.length) { this.polling = false; return; }
      this.logger.debug(`轮询 ${pending.length} 个待完成视频任务`);
      for (const job of pending) {
        try {
          const provider = this.registry.getVideoProvider(job.provider);
          const result = await provider.query(job.providerTaskId);
          if (result.status === 'completed') {
            const res = { videoUrl: result.videoUrl, coverUrl: result.coverUrl, durationSeconds: result.durationSeconds };
            const wallMs = Date.now() - job.createdAt.getTime();
            await this.markCompleted(job.id, res as Record<string, unknown>, wallMs);
            const clip =
              result.durationSeconds != null && Number.isFinite(result.durationSeconds)
                ? `成片时长 ${result.durationSeconds}s，`
                : '';
            this.logger.log(
              `视频任务完成: ${job.id} (${clip}自任务创建至完成 ${wallMs}ms) → ${result.videoUrl?.slice(0, 80)}`,
            );
          } else if (result.status === 'failed') {
            await this.markFailed(job.id, result.error ?? '未知错误');
            this.logger.warn(`视频任务失败: ${job.id} → ${result.error}`);
          } else {
            if (job.status !== result.status) await this.repo.update(job.id, { status: result.status });
          }
        } catch (err) {
          this.logger.error(`轮询任务 ${job.id} 出错: ${(err as Error).message}`);
        }
      }
    } finally { this.polling = false; }
  }
}
