/** Drama Agent Pipeline 实体 — 存储短剧 Pipeline 节点配置与工作流参数 */
import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import type { DramaAgentNodeConfig, DramaWorkflowParams } from '../interfaces';
import { DramaEntity } from './drama.entity';

export type { DramaAgentNodeConfig, DramaWorkflowParams } from '../interfaces';

export const DEFAULT_DRAMA_WORKFLOW_PARAMS: DramaWorkflowParams = {
  maxEditRounds: 2, maxContinuityRetries: 1, qualityPassScore: 7.0,
  enableDialogueCoach: true, enablePacingAnalyzer: true, enableHookCrafter: true,
};

export const DEFAULT_DRAMA_PIPELINE_NODES: DramaAgentNodeConfig[] = [
  { id: 'arc-director', type: 'arc-director', label: '卷导演', description: '规划当前段落的叙事弧线与节奏', isEnabled: true, isDeletable: false, isCore: true, position: 0, rfPosition: { x: 300, y: 0 }, additionalSystemPrompt: '' },
  { id: 'episode-director', type: 'episode-director', label: '集导演', description: '为单集设定目标、情绪方向和戏剧冲突', isEnabled: true, isDeletable: false, isCore: true, position: 1, rfPosition: { x: 300, y: 160 }, additionalSystemPrompt: '' },
  { id: 'continuity-guard', type: 'continuity-guard', label: '连续性守卫', description: '预检角色状态、时间线和剧情连续性', isEnabled: true, isDeletable: false, isCore: false, position: 2, rfPosition: { x: 300, y: 320 }, additionalSystemPrompt: '' },
  { id: 'scriptwriter', type: 'scriptwriter', label: '编剧', description: '根据导演意图创作分场剧本', isEnabled: true, isDeletable: false, isCore: true, position: 3, rfPosition: { x: 300, y: 480 }, additionalSystemPrompt: '' },
  { id: 'dialogue-coach', type: 'dialogue-coach', label: '台词润色', description: '优化对白的自然度与角色辨识度', isEnabled: true, isDeletable: true, isCore: false, position: 4, rfPosition: { x: 300, y: 640 }, additionalSystemPrompt: '' },
  { id: 'storyboard-director', type: 'storyboard-director', label: '分镜导演', description: '将剧本转化为分镜 Shot 序列', isEnabled: true, isDeletable: false, isCore: true, position: 5, rfPosition: { x: 300, y: 800 }, additionalSystemPrompt: '' },
  { id: 'audio-director', type: 'audio-director', label: '音频设计', description: '为每个 Shot 标注音效与配乐', isEnabled: true, isDeletable: true, isCore: false, position: 6, rfPosition: { x: 300, y: 960 }, additionalSystemPrompt: '' },
  { id: 'deterministic-checker', type: 'deterministic-checker', label: '硬规则校验', description: '校验时长/格式/安全等确定性规则', isEnabled: true, isDeletable: false, isCore: true, position: 7, rfPosition: { x: 300, y: 1120 }, additionalSystemPrompt: '' },
  { id: 'script-reviewer', type: 'script-reviewer', label: '质量审核', description: '多维度评估剧本与分镜质量', isEnabled: true, isDeletable: false, isCore: false, position: 8, rfPosition: { x: 300, y: 1280 }, additionalSystemPrompt: '' },
  { id: 'script-editor', type: 'script-editor', label: '精修编辑', description: '针对审核问题进行定向修复', isEnabled: true, isDeletable: true, isCore: false, position: 9, rfPosition: { x: 300, y: 1440 }, additionalSystemPrompt: '' },
  { id: 'pacing-analyzer', type: 'pacing-analyzer', label: '节奏分析', description: '分析镜头节奏与情绪曲线', isEnabled: true, isDeletable: true, isCore: false, position: 10, rfPosition: { x: 300, y: 1600 }, additionalSystemPrompt: '' },
  { id: 'hook-crafter', type: 'hook-crafter', label: '悬念设计', description: '设计集末钩子增强用户留存', isEnabled: true, isDeletable: true, isCore: false, position: 11, rfPosition: { x: 300, y: 1760 }, additionalSystemPrompt: '' },
  { id: 'episode-recorder', type: 'episode-recorder', label: '知识记录', description: '提取并持久化本集世界状态变化', isEnabled: true, isDeletable: false, isCore: true, position: 12, rfPosition: { x: 300, y: 1920 }, additionalSystemPrompt: '' },
];

@Entity('drama_agent_pipelines')
export class DramaAgentPipelineEntity {
  @PrimaryColumn({ name: 'drama_id', type: 'uuid' })
  dramaId: string;

  @Column({ name: 'draft_nodes', type: 'jsonb' })
  draftNodes: DramaAgentNodeConfig[];

  @Column({ name: 'published_nodes', type: 'jsonb', nullable: true })
  publishedNodes: DramaAgentNodeConfig[] | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'workflow_params', type: 'jsonb', nullable: true })
  workflowParams: DramaWorkflowParams | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DramaEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'drama_id' })
  drama: DramaEntity;
}
