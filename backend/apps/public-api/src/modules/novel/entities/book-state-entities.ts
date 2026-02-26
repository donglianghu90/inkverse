/** StoryState 规范化子表 — 将大型数组从 books.state_json 拆出，支持独立查询/索引/部分更新。 */
import { Entity, Column, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BookEntity } from './book.entity';

@Entity('book_characters')
export class BookCharacterEntity {
  @Index('idx_bkchar_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'character_id', type: 'varchar', length: 128 }) characterId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_plot_threads')
export class BookPlotThreadEntity {
  @Index('idx_bkthread_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'thread_id', type: 'varchar', length: 128 }) threadId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_timeline_events')
export class BookTimelineEventEntity {
  @Index('idx_bkevt_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 128 }) eventId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_character_facts')
export class BookCharacterFactEntity {
  @Index('idx_bkfact_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'fact_id', type: 'varchar', length: 128 }) factId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_relations')
export class BookRelationEntity {
  @Index('idx_bkrel_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'relation_id', type: 'varchar', length: 128 }) relationId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_chapter_summaries')
export class BookChapterSummaryEntity {
  @Index('idx_bksum_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'chapter_number', type: 'int' }) chapterNumber: number;
  @Column({ type: 'text' }) summary: string;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_factions')
export class BookFactionEntity {
  @Index('idx_bkfac_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'faction_id', type: 'varchar', length: 128 }) factionId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('book_commitments')
export class BookCommitmentEntity {
  @Index('idx_bkcmt_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'commitment_id', type: 'varchar', length: 128 }) commitmentId: string;
  @Column({ type: 'jsonb' }) data: Record<string, unknown>;
  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}
