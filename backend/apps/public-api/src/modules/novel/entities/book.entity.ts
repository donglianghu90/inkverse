import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { ChapterEntity } from './chapter.entity';
import { ArtifactEntity } from './artifact.entity';
import { AutoSerializationJobEntity } from './auto-serialization-job.entity';

@Entity('books')
export class BookEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'book_id' })
  bookId: string;

  @Index('idx_books_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @Column({ name: 'state_json', type: 'jsonb' })
  stateJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Index('idx_books_updated_at')
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => ChapterEntity, (chapter) => chapter.book)
  chapters: ChapterEntity[];

  @OneToMany(() => ArtifactEntity, (artifact) => artifact.book)
  artifacts: ArtifactEntity[];

  @OneToOne(() => AutoSerializationJobEntity, (job) => job.book)
  autoSerializationJob: AutoSerializationJobEntity;
}
