import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { BookEntity } from './book.entity';

@Index('idx_auto_serialization_due', ['enabled', 'running', 'nextRunAt'])
@Entity('book_auto_serialization_jobs')
export class AutoSerializationJobEntity {
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'daily_start_time', type: 'text' })
  dailyStartTime: string;

  @Column({ name: 'chapters_per_run', type: 'int' })
  chaptersPerRun: number;

  @Column({ name: 'max_repair_rounds', type: 'int', default: 2 })
  maxRepairRounds: number;

  @Column({ name: 'strict_quality', type: 'boolean', default: true })
  strictQuality: boolean;

  @Column({ name: 'stop_when_low_quality', type: 'boolean', default: true })
  stopWhenLowQuality: boolean;

  @Column({ name: 'min_quality_score', type: 'numeric', precision: 4, scale: 2, default: 7 })
  minQualityScore: number;

  @Column({ name: 'min_overall_score', type: 'numeric', precision: 4, scale: 2, default: 7 })
  minOverallScore: number;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt: Date | null;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ name: 'run_started_at', type: 'timestamptz', nullable: true })
  runStartedAt: Date | null;

  @Column({ type: 'boolean', default: false })
  running: boolean;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_result', type: 'jsonb', nullable: true })
  lastResult: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => BookEntity, (book) => book.autoSerializationJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
