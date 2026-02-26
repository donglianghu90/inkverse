import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BookEntity } from './book.entity';

export type ChapterResyncJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

@Index('idx_chapter_resync_book_status', ['bookId', 'status'])
@Index('idx_chapter_resync_created_at', ['createdAt'])
@Entity('book_chapter_resync_jobs')
export class ChapterResyncJobEntity {
  @PrimaryColumn({ name: 'job_id', type: 'uuid' })
  jobId: string;

  @Column({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({ name: 'requested_start_chapter', type: 'int' })
  requestedStartChapter: number;

  @Column({ name: 'requested_end_chapter', type: 'int' })
  requestedEndChapter: number;

  @Column({ type: 'text' })
  status: ChapterResyncJobStatus;

  @Column({ name: 'requested_by', type: 'text', default: 'updateChapter' })
  requestedBy: string;

  @Column({ name: 'effective_start_chapter', type: 'int', nullable: true })
  effectiveStartChapter: number | null;

  @Column({ name: 'effective_end_chapter', type: 'int', nullable: true })
  effectiveEndChapter: number | null;

  @Column({ name: 'total_chapters', type: 'int', nullable: true })
  totalChapters: number | null;

  @Column({ name: 'completed_chapters', type: 'int', default: 0 })
  completedChapters: number;

  @Column({ name: 'progress_chapter', type: 'int', nullable: true })
  progressChapter: number | null;

  @Column({ name: 'progress_message', type: 'text', nullable: true })
  progressMessage: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_result', type: 'jsonb', nullable: true })
  lastResult: Record<string, unknown> | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
