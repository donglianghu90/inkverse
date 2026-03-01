/** 章节记忆实体 — 结构化存储每章的可查询摘要，支持跨章节语义检索。 */
import {
  Entity, Column, Index, PrimaryColumn,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { BookEntity } from './book.entity';

@Entity('chapter_memories')
export class ChapterMemoryEntity {
  @Index('idx_chaptermem_book')
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @PrimaryColumn({ name: 'chapter_number', type: 'int' })
  chapterNumber: number;

  @Column({ type: 'text' })
  summary: string; // 本章核心摘要(150字内)

  @Column({ name: 'key_events', type: 'jsonb', default: '[]' })
  keyEvents: string[]; // 关键事件列表

  @Column({ name: 'character_ids', type: 'jsonb', default: '[]' })
  characterIds: string[]; // 出场角色ID

  @Column({ name: 'location_ids', type: 'jsonb', default: '[]' })
  locationIds: string[]; // 涉及地点ID

  @Column({ name: 'plot_thread_ids', type: 'jsonb', default: '[]' })
  plotThreadIds: string[]; // 推进的伏线ID

  @Column({ name: 'emotional_tone', type: 'varchar', length: 255, default: '' })
  emotionalTone: string; // 情绪基调

  @Column({ name: 'tension_level', type: 'smallint', default: 5 })
  tensionLevel: number; // 张力等级1-10

  @Column({ type: 'jsonb', default: '[]' })
  keywords: string[]; // 检索关键词(混合中英文)

  @Column({ name: 'foreshadowing_planted', type: 'jsonb', default: '[]' })
  foreshadowingPlanted: string[]; // 本章埋下的伏笔描述

  @Column({ name: 'foreshadowing_resolved', type: 'jsonb', default: '[]' })
  foreshadowingResolved: string[]; // 本章回收的伏笔描述

  /** 本章活跃角色的关键状态快照，供向量召回时还原"当时角色状态" */
  @Column({ name: 'character_states', type: 'jsonb', default: '{}' })
  characterStates: Record<string, { level: string; mood: string; status: string; location: string }>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
