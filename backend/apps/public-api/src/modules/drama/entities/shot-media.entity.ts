import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity('drama_shot_media')
@Unique(['episodeId', 'shotId'])
export class ShotMediaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  episodeId: string;

  @Column()
  shotId: string;

  @Column({ default: '' })
  imageUrl: string;

  @Column({ default: '' })
  lastFrameImageUrl: string;

  @Column({ default: '' })
  videoUrl: string;

  @Column({ default: '' })
  videoJobId: string;

  @Column({ default: '' })
  videoProvider: string;

  @Column({ default: '' })
  ttsUrl: string;

  @Column({ default: '' })
  sfxUrl: string;

  @Column({ default: '' })
  sfxJobId: string;

  @Column({ type: 'varchar', length: 32, default: 'not_started' })
  sfxStatus: string;

  @Column({ type: 'text', default: '' })
  sfxPrompt: string;

  @Column({ default: '' })
  videoWithSfxUrl: string; // 视频+音效合成后的最终 URL（FFmpeg mux 结果）


  @Column({ type: 'text', default: '' })
  t2iPrompt: string;

  @Column({ type: 'text', default: '' })
  t2iNegativePrompt: string;

  @Column({ type: 'text', default: '' })
  lastFrameT2iPrompt: string;

  @Column({ type: 'varchar', length: 32, default: 'not_started' })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  qc: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  videoQcIssues: string[] | null;

  @Column({ type: 'text', default: '' })
  imageError: string;

  @Column({ type: 'text', default: '' })
  lastFrameError: string;

  @Column({ type: 'boolean', default: false })
  kenBurnsFallback: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
