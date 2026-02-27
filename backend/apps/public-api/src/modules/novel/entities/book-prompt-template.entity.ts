/** 每本书独立的 Prompt 模板存储 — 代码中的默认值只用于初始化 */
import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { BookEntity } from './book.entity';

export interface PromptSection {
  key: string;       // 区块标识 e.g. 'role', 'principles', 'rules'
  label: string;     // 显示名
  content: string;   // 实际内容
  isLocked: boolean; // 锁定区块不可前端编辑（变量占位/JSON schema）
}

export interface AgentPromptConfig {
  agentId: string;
  sections: PromptSection[];
}

export interface PromptEditRecord { // 单条编辑历史
  timestamp: string;       // ISO 时间
  target: string;          // 编辑目标：playbook name 或 "agent:{agentId}:{sectionKey}"
  label: string;           // 显示名
  oldContent: string;      // 修改前内容
}

export interface BookPromptTemplates {
  playbooks: Record<string, string>;                // playbookName -> content
  agents: Record<string, AgentPromptConfig>;        // agentId -> config
  editHistory?: PromptEditRecord[];                 // 最近 20 条编辑历史
}

@Entity('book_prompt_templates')
export class BookPromptTemplateEntity {
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({ name: 'templates', type: 'jsonb' })
  templates: BookPromptTemplates;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
