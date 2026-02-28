/** 题材参考 Profile 模板 — 系统预置(种子) + 用户私有副本，注册时自动同步，增量更新 */
import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import type { RuleAtom } from '../schemas/rule-engine.schemas';

export interface SeedAnalyzerHints {
  coreLoopPatterns?: string[];
  goldenFingerGuidance?: string;
  worldBuildingDirectives?: string;
}

export interface CachedAgentSections {
  sections: Array<{ agentId: string; key: string; content: string }>;
  ruleAtoms?: RuleAtom[];
}

@Entity('genre_profile_templates')
@Unique('uq_genre_tpl_user_genre', ['userId', 'genreKey'])
export class GenreProfileTemplateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Index('idx_genre_tpl_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 64, nullable: true })
  userId: string | null; // null = 系统种子模板

  @Column({ name: 'genre_key', type: 'varchar', length: 100 })
  genreKey: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description: string;

  @Column({ name: 'genre_keywords', type: 'jsonb', default: '[]' })
  genreKeywords: string[];

  @Column({ name: 'profile_json', type: 'jsonb' })
  profileJson: Record<string, unknown>;

  @Column({ name: 'seed_hints', type: 'jsonb', nullable: true })
  seedHints: SeedAnalyzerHints | null;

  @Column({ name: 'rule_atoms', type: 'jsonb', nullable: true, default: '[]' })
  ruleAtoms: RuleAtom[];

  @Column({ name: 'cached_agent_sections', type: 'jsonb', nullable: true })
  cachedAgentSections: CachedAgentSections | null; // 预生成的 agent 指令缓存，创建小说时直接使用

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ name: 'parent_template_id', type: 'uuid', nullable: true })
  parentTemplateId: string | null; // 用户副本指向源系统模板 ID

  @Column({ name: 'system_version', type: 'int', default: 1 })
  systemVersion: number; // 系统模板版本号，每次系统更新递增

  @Column({ name: 'synced_system_version', type: 'int', default: 0 })
  syncedSystemVersion: number; // 用户副本同步自系统模板的版本号

  @Column({ name: 'is_user_modified', type: 'boolean', default: false })
  isUserModified: boolean; // 用户是否手动修改过此副本

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
