import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { BookEntity } from './book.entity';

export type AgentNodeType =
  | 'intent'
  | 'arc-director'
  | 'scene-planner'
  | 'creative-writer'
  | 'scene-stitcher'
  | 'reviewer'
  | 'editor'
  | 'recorder'
  | 'continuity-guard'
  | 'hook-crafter'
  | 'pacing-analyzer'
  | 'character-voice-coach'
  | 'custom';

export type CustomOutputType = 'ChapterDraft' | 'ChapterIntent';

export interface CustomAgentConfig {
  systemPrompt: string;
  userPromptTemplate: string;
  outputType: CustomOutputType;
  temperature: number;
}

export interface AgentNodeConfig {
  id: string;
  type: AgentNodeType;
  label: string;
  description: string;
  isEnabled: boolean;
  isDeletable: boolean;
  isCore: boolean;
  position: number;
  rfPosition: { x: number; y: number };
  additionalSystemPrompt: string;
  customConfig?: CustomAgentConfig;
}

export interface WorkflowParams {
  qualityPassScore: number;        // 质量门控通过分数，默认 8.5
  maxRepairRounds: number;         // 最大重写轮数，默认 2
  editorPolishThreshold: number;   // 编辑精修触发阈值，默认 7.0
  longRangeMemoryThreshold: number; // 长程记忆检索章节阈值，默认 10
}

export const DEFAULT_WORKFLOW_PARAMS: WorkflowParams = {
  qualityPassScore: 8.5,
  maxRepairRounds: 2,
  editorPolishThreshold: 7.0,
  longRangeMemoryThreshold: 10,
};

export const DEFAULT_PIPELINE_NODES: AgentNodeConfig[] = [
  { id: 'arc-director', type: 'arc-director', label: '卷级导演', description: '将当前卷合同转成单章硬约束，防止章节偏卷', isEnabled: true, isDeletable: false, isCore: true, position: 0, rfPosition: { x: 300, y: 0 }, additionalSystemPrompt: '' },
  { id: 'intent', type: 'intent', label: '意图规划', description: '为下一章设定目标、情绪方向和钩子方向', isEnabled: true, isDeletable: false, isCore: true, position: 1, rfPosition: { x: 300, y: 160 }, additionalSystemPrompt: '' },
  { id: 'continuity-guard', type: 'continuity-guard', label: '连续性守卫', description: '预检角色状态、时间线、空间关系等连续性风险', isEnabled: true, isDeletable: false, isCore: false, position: 2, rfPosition: { x: 300, y: 320 }, additionalSystemPrompt: '' },
  { id: 'scene-planner', type: 'scene-planner', label: '场景规划', description: '将章节意图拆分为独立场景（数量随章节类型动态调整），每个有独立视角、情绪弧和叙事任务', isEnabled: true, isDeletable: false, isCore: false, position: 3, rfPosition: { x: 300, y: 480 }, additionalSystemPrompt: '' },
  { id: 'creative-writer', type: 'creative-writer', label: '创意写作', description: '逐场景创作引擎，按场景契约独立生成每个场景', isEnabled: true, isDeletable: false, isCore: true, position: 4, rfPosition: { x: 300, y: 640 }, additionalSystemPrompt: '' },
  { id: 'scene-stitcher', type: 'scene-stitcher', label: '场景缝合', description: '将多个场景草稿组合为完整章节，打磨过渡段落，统一节奏', isEnabled: true, isDeletable: false, isCore: false, position: 5, rfPosition: { x: 300, y: 800 }, additionalSystemPrompt: '' },
  { id: 'reviewer', type: 'reviewer', label: '质量审核', description: '从读者视角评估章节质量，给出评分和问题', isEnabled: true, isDeletable: false, isCore: false, position: 6, rfPosition: { x: 300, y: 960 }, additionalSystemPrompt: '' },
  { id: 'character-voice-coach', type: 'character-voice-coach', label: '角色声音教练', description: '审计角色对话是否符合声音档案，检测声音偏离', isEnabled: true, isDeletable: true, isCore: false, position: 7, rfPosition: { x: 300, y: 1120 }, additionalSystemPrompt: '' },
  { id: 'pacing-analyzer', type: 'pacing-analyzer', label: '节奏分析', description: '分析句式变化、段落节奏和整体行文速度', isEnabled: true, isDeletable: true, isCore: false, position: 8, rfPosition: { x: 300, y: 1280 }, additionalSystemPrompt: '' },
  { id: 'editor', type: 'editor', label: '精细编辑', description: '针对审核发现的问题进行精准修改', isEnabled: true, isDeletable: true, isCore: false, position: 9, rfPosition: { x: 300, y: 1440 }, additionalSystemPrompt: '' },
  { id: 'hook-crafter', type: 'hook-crafter', label: '钩子优化', description: '优化章末钩子，增强读者期待和下一章吸引力', isEnabled: true, isDeletable: true, isCore: false, position: 10, rfPosition: { x: 300, y: 1600 }, additionalSystemPrompt: '' },
  { id: 'recorder', type: 'recorder', label: '知识记录', description: '从最终章节中提取世界状态变化', isEnabled: true, isDeletable: false, isCore: true, position: 11, rfPosition: { x: 300, y: 1760 }, additionalSystemPrompt: '' },
];

@Entity('book_agent_pipelines')
export class BookAgentPipelineEntity {
  @PrimaryColumn({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Column({ name: 'draft_nodes', type: 'jsonb' })
  draftNodes: AgentNodeConfig[];

  @Column({ name: 'published_nodes', type: 'jsonb', nullable: true })
  publishedNodes: AgentNodeConfig[] | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'workflow_params', type: 'jsonb', nullable: true })
  workflowParams: WorkflowParams | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
