/** 每本书独立的 Prompt 模板存储 — 代码中的默认值只用于初始化 */
import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { BookEntity } from './book.entity';
import type { RuleAtom } from '../schemas/rule-engine.schemas';

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

export interface PromptEditRecord {
  timestamp: string;
  target: string;          // 编辑目标：ruleAtom id 或 "agent:{agentId}:{sectionKey}"
  label: string;
  oldContent: string;
}

export interface BookPromptTemplates {
  ruleAtoms: RuleAtom[];                            // 结构化规则原子
  agents: Record<string, AgentPromptConfig>;        // agentId -> config（agent sections 暂保留）
  editHistory?: PromptEditRecord[];
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
