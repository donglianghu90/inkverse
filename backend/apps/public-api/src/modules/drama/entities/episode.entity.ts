import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

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
  script: Record<string, unknown> | null; // EpisodeScript JSON

  @Column({ type: 'jsonb', nullable: true })
  storyboard: Record<string, unknown> | null; // EpisodeStoryboard JSON (含 Shot 数组)

  @Column({ type: 'jsonb', nullable: true })
  review: Record<string, unknown> | null; // EpisodeReview JSON

  @Column({ type: 'jsonb', nullable: true })
  loreRecord: Record<string, unknown> | null; // EpisodeLoreRecord JSON

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  overallScore: number | null;

  @Column({ type: 'int', default: 0 })
  totalDurationSec: number;

  @Column({ type: 'int', default: 0 })
  shotCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
