/** 媒体僵尸任务清道夫 — 定时扫描并回收卡死的媒体生成任务 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { EpisodeEntity, EpisodeMediaStatus } from './entities/episode.entity';
import { DramaStateStore } from './drama-state-store.service';

const STUCK_STATUSES: EpisodeMediaStatus[] = [
  'generating_first_frames', 'generating_images', 'generating_videos',
];

/** 超过此时长（毫秒）未更新的媒体任务视为僵尸 */
const ZOMBIE_THRESHOLD_MS = 60 * 60 * 1000; // 1 小时

@Injectable()
export class DramaMediaWatchdogService {
  private readonly logger = new Logger('DramaMediaWatchdog');

  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    private readonly stateStore: DramaStateStore,
  ) {}

  /** 每 15 分钟扫描一次僵尸任务 */
  @Cron('0 */15 * * * *')
  async sweepZombies(): Promise<void> {
    const cutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
    const zombies = await this.episodeRepo.find({
      where: {
        mediaStatus: In(STUCK_STATUSES),
        updatedAt: LessThan(cutoff),
      },
    });

    if (!zombies.length) return;

    this.logger.warn(`[Watchdog] 发现 ${zombies.length} 个僵尸媒体任务，开始回收...`);

    for (const ep of zombies) {
      try {
        await this.episodeRepo.update(ep.id, {
          mediaStatus: 'failed',
          mediaError: `僵尸任务自动回收: 状态 "${ep.mediaStatus}" 超过 ${ZOMBIE_THRESHOLD_MS / 60000} 分钟未更新 (updatedAt=${ep.updatedAt?.toISOString()})`,
        });
        // 释放可能残留的生成锁
        await this.stateStore.stopGenerating(ep.dramaId);
        await this.stateStore.stopEpisodeGen(ep.dramaId, ep.episodeNumber);
        this.logger.warn(`[Watchdog] 回收 E${ep.episodeNumber}(${ep.dramaId}): ${ep.mediaStatus} → failed`);
      } catch (err) {
        this.logger.error(`[Watchdog] 回收失败 E${ep.episodeNumber}(${ep.dramaId}): ${(err as Error).message}`);
      }
    }
  }
}
