import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type EpisodeMediaStatus = 'not_started' | 'generating_first_frames' | 'generating_images' | 'generating_videos' | 'compositing' | 'completed' | 'failed';

@Entity('drama_episodes')
export class EpisodeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  dramaId: string;

  @Column({ type: 'int' })
  episodeNumber: number;

  @Column()
  title: string;

  @Column({ type: 'jsonb', nullable: true })
  script: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  storyboard: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  review: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  loreRecord: Record<string, unknown> | null;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  overallScore: number | null;

  @Column({ type: 'int', default: 0 })
  totalDurationSec: number;

  @Column({ type: 'int', default: 0 })
  shotCount: number;

  // ═══ 媒体生成状态 ═══

  @Column({ type: 'varchar', length: 24, default: 'not_started' })
  mediaStatus: EpisodeMediaStatus;

  @Column({ type: 'text', default: '' })
  videoUrl: string; // 合成后的完整集视频

  @Column({ type: 'jsonb', nullable: true })
  shotMediaMap: Record<string, { videoUrl?: string; videoJobId?: string; ttsUrl?: string; imageUrl?: string; lastFrameImageUrl?: string; status?: string }> | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  mediaCostUsd: number;

  @Column({ type: 'text', default: '' })
  mediaError: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
