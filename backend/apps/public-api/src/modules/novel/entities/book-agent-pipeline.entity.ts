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
  | 'creative-writer'
  | 'reviewer'
  | 'editor'
  | 'recorder'
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

export const DEFAULT_PIPELINE_NODES: AgentNodeConfig[] = [
  {
    id: 'intent',
    type: 'intent',
    label: '意图规划',
    description: '为下一章设定目标、情绪方向和钩子方向',
    isEnabled: true,
    isDeletable: false,
    isCore: true,
    position: 0,
    rfPosition: { x: 300, y: 0 },
    additionalSystemPrompt: '',
  },
  {
    id: 'creative-writer',
    type: 'creative-writer',
    label: '创意写作',
    description: '核心创作引擎，根据意图生成章节草稿',
    isEnabled: true,
    isDeletable: false,
    isCore: true,
    position: 1,
    rfPosition: { x: 300, y: 160 },
    additionalSystemPrompt: '',
  },
  {
    id: 'reviewer',
    type: 'reviewer',
    label: '质量审核',
    description: '从读者视角评估章节质量，给出评分和问题',
    isEnabled: true,
    isDeletable: false,
    isCore: false,
    position: 2,
    rfPosition: { x: 300, y: 320 },
    additionalSystemPrompt: '',
  },
  {
    id: 'editor',
    type: 'editor',
    label: '精细编辑',
    description: '针对审核发现的问题进行精准修改',
    isEnabled: true,
    isDeletable: true,
    isCore: false,
    position: 3,
    rfPosition: { x: 300, y: 480 },
    additionalSystemPrompt: '',
  },
  {
    id: 'recorder',
    type: 'recorder',
    label: '知识记录',
    description: '从最终章节中提取世界状态变化',
    isEnabled: true,
    isDeletable: false,
    isCore: true,
    position: 4,
    rfPosition: { x: 300, y: 640 },
    additionalSystemPrompt: '',
  },
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book: BookEntity;
}
