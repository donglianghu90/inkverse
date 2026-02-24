import {
  Entity,
  Column,
  Index,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BookEntity } from './book.entity';

@Index('idx_artifacts_book_chapter', ['bookId', 'chapterNumber'])
@Entity('artifacts')
export class ArtifactEntity {
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @PrimaryColumn({ name: 'chapter_number', type: 'int' })
  chapterNumber: number;

  @PrimaryColumn({ type: 'text' })
  name: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => BookEntity, (book) => book.artifacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
