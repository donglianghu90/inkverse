/** 分层摘要记忆金字塔实体 — 弧级 + 卷级摘要（章数跨度由全书规模动态决定），支持 pgvector 语义检索。 */
import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { BookEntity } from './book.entity';

@Entity('arc_summaries')
export class ArcSummaryEntity {
  @Index('idx_arcsum_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'arc_id', type: 'varchar', length: 64 }) arcId: string;

  @Column({ name: 'arc_title', type: 'varchar', length: 256 }) arcTitle: string;
  @Column({ name: 'start_chapter', type: 'int' }) startChapter: number;
  @Column({ name: 'end_chapter', type: 'int' }) endChapter: number;
  @Column({ type: 'text' }) summary: string; // 弧整体摘要(300-500字)
  @Column({ name: 'key_character_arcs', type: 'jsonb', default: '[]' }) keyCharacterArcs: { characterId: string; name: string; arc: string }[];
  @Column({ name: 'resolved_threads', type: 'jsonb', default: '[]' }) resolvedThreads: string[];
  @Column({ name: 'new_threads_planted', type: 'jsonb', default: '[]' }) newThreadsPlanted: string[];
  @Column({ name: 'emotional_arc', type: 'text', default: '' }) emotionalArc: string; // 情感弧线描述
  @Column({ name: 'key_turning_points', type: 'jsonb', default: '[]' }) keyTurningPoints: string[];
  @Column({ name: 'world_state_changes', type: 'text', default: '' }) worldStateChanges: string; // 世界观变化
  @Column({ type: 'jsonb', default: '[]' }) keywords: string[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}

@Entity('volume_summaries')
export class VolumeSummaryEntity {
  @Index('idx_volsum_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' }) bookId: string;
  @PrimaryColumn({ name: 'volume_id', type: 'varchar', length: 64 }) volumeId: string;

  @Column({ name: 'volume_number', type: 'int' }) volumeNumber: number;
  @Column({ type: 'varchar', length: 256 }) title: string;
  @Column({ name: 'start_chapter', type: 'int' }) startChapter: number;
  @Column({ name: 'end_chapter', type: 'int' }) endChapter: number;
  @Column({ type: 'text' }) summary: string; // 卷整体摘要(500-800字)
  @Column({ name: 'power_progression', type: 'text', default: '' }) powerProgression: string;
  @Column({ name: 'major_plot_movements', type: 'jsonb', default: '[]' }) majorPlotMovements: string[];
  @Column({ name: 'character_growth', type: 'jsonb', default: '[]' }) characterGrowth: { characterId: string; name: string; growth: string }[];
  @Column({ name: 'world_expansion', type: 'text', default: '' }) worldExpansion: string;
  @Column({ name: 'arc_ids', type: 'jsonb', default: '[]' }) arcIds: string[]; // 本卷包含的 arc
  @Column({ type: 'jsonb', default: '[]' }) keywords: string[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;

  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' }) book: BookEntity;
}
