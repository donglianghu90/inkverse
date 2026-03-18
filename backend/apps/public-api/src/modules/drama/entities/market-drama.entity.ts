import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity('market_dramas')
@Unique(['platform', 'externalId'])
export class MarketDramaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 32 })
  platform: string; // douyin | hongguo | kuaishou | free_api

  @Column({ length: 128 })
  externalId: string;

  @Column()
  title: string;

  @Index()
  @Column({ length: 64, default: '' })
  genre: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ nullable: true })
  coverUrl: string | null;

  @Column({ type: 'int', default: 0 })
  totalEpisodes: number;

  @Column({ type: 'bigint', default: 0 })
  playCount: number;

  @Column({ type: 'bigint', default: 0 })
  favoriteCount: number;

  @Column({ type: 'decimal', precision: 12, scale: 1, default: 0 })
  hotScore: number;

  @Column({ type: 'int', nullable: true })
  rankPosition: number | null;

  @Column({ length: 64, nullable: true })
  rankCategory: string | null;

  @Column({ type: 'simple-array', nullable: true })
  tags: string[] | null;

  @Column({ nullable: true })
  author: string | null;

  @Column({ type: 'boolean', default: false })
  isPaid: boolean;

  @Column({ type: 'jsonb', nullable: true })
  rawData: Record<string, unknown> | null;

  @Index()
  @Column({ type: 'date' })
  snapshotDate: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
