/** 媒体生成任务持久化 — 跟踪异步视频任务状态，支持断线续查 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { VideoTaskStatus } from '../interfaces/media-provider.interface';

export type MediaJobType = 'image' | 'video' | 'tts' | 'audio';

@Entity('media_jobs')
export class MediaJobEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  jobType: MediaJobType; // image / video / tts

  @Column({ type: 'varchar', length: 32 })
  provider: string; // volcengine / kling / ...

  @Column({ type: 'varchar', length: 128, default: '' })
  providerTaskId: string; // Provider 返回的任务 ID

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: VideoTaskStatus; // 复用 VideoTaskStatus

  @Index()
  @Column({ type: 'uuid', nullable: true })
  dramaId: string | null; // 关联短剧

  @Column({ type: 'varchar', length: 32, default: '' })
  assetType: string; // character_image / scene_image / shot_video

  @Column({ type: 'varchar', length: 128, default: '' })
  refId: string; // characterId / locationId / shotId

  /** 短剧集号，用于计费 scope 归属 episode:N */
  @Column({ type: 'int', nullable: true })
  episodeNumber: number | null;

  @Column({ type: 'jsonb', default: {} })
  request: Record<string, unknown>; // 原始请求参数

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, unknown> | null; // 生成结果 { url, coverUrl, ... }

  @Column({ type: 'text', default: '' })
  error: string;

  @Column({ type: 'int', default: 0 })
  durationMs: number; // 自任务创建至轮询标记完成（墙钟 ms），非成片时长

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
