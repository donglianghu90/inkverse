/** 全局 Agent 提示词补充设置 — 针对短剧【创建】阶段的 5 个准备类 Agent
 *  - 用户 userId='system' 存放系统默认值
 *  - 用户首次访问时从系统行复制到自己的行（ensureUserRows）
 *  - 集内容生成的 12 个 Agent 由各短剧自己的 pipeline 管理（创作工坊）
 */
import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 短剧创建流水线中使用到的 5 个准备类 Agent */
export const GLOBAL_PROMPT_AGENT_TYPES = [
  'seed-analyzer',        // DramaSeedAnalyzerAgent   — 分析创意种子
  'series-director',      // SeriesDirectorAgent       — 规划全剧大纲
  'visual-asset-designer', // VisualAssetDesignerAgent  — 设计视觉资产
  'drama-profiler',       // DramaProfilerAgent        — 生成编剧手册
  'drama-strategy',       // DramaStrategyAgent        — 制定生成策略
] as const;

export type GlobalPromptAgentType = typeof GLOBAL_PROMPT_AGENT_TYPES[number];

/** userId 的系统默认值 */
export const SYSTEM_USER_ID = 'system';

@Entity('drama_global_prompt_settings')
export class DramaGlobalPromptSettingEntity {
  /** 用户 ID，系统默认行使用 'system' */
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 64 })
  userId: string;

  @PrimaryColumn({ name: 'agent_type', type: 'varchar', length: 64 })
  agentType: string;

  /** 全局补充指令 — 追加到 base prompt 之后 */
  @Column({ name: 'global_additional_prompt', type: 'text', default: '' })
  globalAdditionalPrompt: string;

  /** Agent 说明（展示用） */
  @Column({ name: 'description', type: 'text', default: '' })
  description: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
