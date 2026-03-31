/**
 * DramaStateStore — Redis-backed 短剧生成状态管理。
 *
 * 替代原先 DramaService 中的 3 个内存 Set<string>：
 *   generatingDramas / pausedDramas / cancelledDramas
 *
 * 优势：
 *   - 多实例部署共享状态
 *   - 进程重启不丢失（Redis 持久化）
 *   - cancelled 自带 TTL（5 分钟），无需 setTimeout 手动清理
 *
 * 生成锁设计：
 *   - SET 成员记录正在生成的 dramaId
 *   - 每个 dramaId 有独立 TTL key，值 = 进程实例 ID（instanceId）
 *   - 启动时比较 instanceId 判断锁是否属于当前进程，不匹配则清理
 *   - 兜底 TTL 2 小时，防止所有实例都崩溃后永久占用
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

/** Redis key 常量 */
const KEY_GENERATING = 'drama:state:generating';
const KEY_PAUSED     = 'drama:state:paused';

/** cancelled 使用独立 key + TTL，精确到单个 dramaId */
const cancelledKey = (dramaId: string) => `drama:state:cancelled:${dramaId}`;

/** generating 心跳 key（兜底 TTL，防止进程崩溃后永久占用），值 = instanceId */
const generatingTtlKey = (dramaId: string) => `drama:state:gen_ttl:${dramaId}`;

const CANCELLED_TTL = 300;     // 5 分钟（与原 setTimeout 一致）
const GENERATING_TTL = 7200;   // 2 小时兜底

@Injectable()
export class DramaStateStore implements OnModuleInit {
  private readonly logger = new Logger(DramaStateStore.name);
  private redis!: Redis;

  /** 当前进程唯一标识 — 每次启动生成新 UUID，用于区分不同进程持有的锁 */
  private readonly instanceId = randomUUID();

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    this.redis = this.redisService.getOrThrow();
    this.logger.log(`Instance ID: ${this.instanceId}`);

    // 清理因进程崩溃/重启残留的 generating 锁
    const members = await this.redis.smembers(KEY_GENERATING);
    let cleaned = 0;
    for (const dramaId of members) {
      const ownerInstanceId = await this.redis.get(generatingTtlKey(dramaId));
      // 清理条件：TTL key 已过期（null）或 属于不同进程实例（重启 / 崩溃）
      if (!ownerInstanceId || ownerInstanceId !== this.instanceId) {
        await this.redis.srem(KEY_GENERATING, dramaId);
        await this.redis.del(generatingTtlKey(dramaId));
        await this.redis.srem(KEY_PAUSED, dramaId);
        cleaned++;
        this.logger.warn(`清理残留生成锁 dramaId=${dramaId}（owner=${ownerInstanceId ?? 'expired'} ≠ current=${this.instanceId}）`);
      }
    }
    this.logger.log(`Redis state store initialized${cleaned ? `, cleaned ${cleaned} stale entries` : ''}`);
  }

  // ── Generating ──

  async isGenerating(dramaId: string): Promise<boolean> {
    return (await this.redis.sismember(KEY_GENERATING, dramaId)) === 1;
  }

  async startGenerating(dramaId: string): Promise<void> {
    await this.redis.sadd(KEY_GENERATING, dramaId);
    // 兜底 TTL：如果进程崩溃，2 小时后自动释放；值 = instanceId 用于重启检测
    await this.redis.set(generatingTtlKey(dramaId), this.instanceId, 'EX', GENERATING_TTL);
  }

  async stopGenerating(dramaId: string): Promise<void> {
    await this.redis.srem(KEY_GENERATING, dramaId);
    await this.redis.del(generatingTtlKey(dramaId));
  }

  // ── Paused ──

  async isPaused(dramaId: string): Promise<boolean> {
    return (await this.redis.sismember(KEY_PAUSED, dramaId)) === 1;
  }

  async pause(dramaId: string): Promise<void> {
    await this.redis.sadd(KEY_PAUSED, dramaId);
  }

  async resume(dramaId: string): Promise<void> {
    await this.redis.srem(KEY_PAUSED, dramaId);
  }

  // ── Cancelled ──

  async isCancelled(dramaId: string): Promise<boolean> {
    return (await this.redis.exists(cancelledKey(dramaId))) === 1;
  }

  async cancel(dramaId: string): Promise<void> {
    // 自动 5 分钟后过期，无需手动清理
    await this.redis.set(cancelledKey(dramaId), '1', 'EX', CANCELLED_TTL);
    // 同时从 paused 中移除
    await this.redis.srem(KEY_PAUSED, dramaId);
  }
  // ── Episode-level Generation Lock (分布式集级锁) ──

  private epGenKey(dramaId: string, epNum: number): string {
    return `drama:state:ep_gen:${dramaId}:${epNum}`;
  }

  /** 尝试获取集级生成锁（SET NX EX 原子操作），返回 true 表示获取成功 */
  async startEpisodeGen(dramaId: string, epNum: number): Promise<boolean> {
    const key = this.epGenKey(dramaId, epNum);
    const result = await this.redis.set(key, this.instanceId, 'EX', 3600, 'NX');
    return result === 'OK';
  }

  /** 释放集级生成锁（仅释放自己持有的锁） */
  async stopEpisodeGen(dramaId: string, epNum: number): Promise<void> {
    const key = this.epGenKey(dramaId, epNum);
    const owner = await this.redis.get(key);
    if (owner === this.instanceId || !owner) {
      await this.redis.del(key);
    }
  }

  /** 检查某集是否正在生成 */
  async isEpisodeGenerating(dramaId: string, epNum: number): Promise<boolean> {
    return (await this.redis.exists(this.epGenKey(dramaId, epNum))) === 1;
  }

}
