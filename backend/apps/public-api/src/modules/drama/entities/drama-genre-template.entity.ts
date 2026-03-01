/** 短剧题材模板 — 系统预置 + 用户自定义，为种子分析与编剧手册提供题材基线 */
import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

export interface DramaSeedHints {
  catharsisPresets?: string[]; // 推荐爽点类型（打脸/逆袭/真相揭露/甜蜜反转）
  conflictPatterns?: string[]; // 核心冲突模式（身份反差/阶级对立/家族秘密）
  paywallStrategyHints?: string; // 付费卡点策略提示
  platformDefaults?: { platformTarget?: string; aspectRatio?: string; durationSec?: number };
  visualStyleHints?: string; // 视觉风格提示（滤镜/色调/氛围）
  dialogueStyleHints?: string; // 台词风格提示
}

@Entity('drama_genre_templates')
@Unique('uq_drama_genre_tpl_user_genre', ['userId', 'genreKey'])
export class DramaGenreTemplateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Index('idx_drama_genre_tpl_user_id')
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

  @Column({ name: 'profile_json', type: 'jsonb', default: '{}' })
  profileJson: Record<string, unknown>; // DramaPromptProfile 的种子数据

  @Column({ name: 'seed_hints', type: 'jsonb', nullable: true })
  seedHints: DramaSeedHints | null;

  @Column({ name: 'audience_tags', type: 'jsonb', default: '[]' })
  audienceTags: string[];

  @Column({ name: 'protagonist_focus_tags', type: 'jsonb', default: '[]' })
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;

  @Column({ name: 'tone_tags', type: 'jsonb', default: '[]' })
  toneTags: string[];

  @Column({ name: 'platform_tags', type: 'jsonb', default: '[]' })
  platformTags: string[]; // douyin/kuaishou/reelshort/dramabox

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ name: 'parent_template_id', type: 'uuid', nullable: true })
  parentTemplateId: string | null;

  @Column({ name: 'system_version', type: 'int', default: 1 })
  systemVersion: number;

  @Column({ name: 'synced_system_version', type: 'int', default: 0 })
  syncedSystemVersion: number;

  @Column({ name: 'is_user_modified', type: 'boolean', default: false })
  isUserModified: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
