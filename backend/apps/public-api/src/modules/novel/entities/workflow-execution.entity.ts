/** 工作流执行记录 — 每次章节生成的逐节点执行数据 */
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface NodeExecution {
  nodeId: string;
  status: NodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  loopAttempt?: number;
  score?: number;
  skippedReason?: string;
  errorMessage?: string;
  output?: Record<string, unknown>;
}

export interface ExecutionSummary {
  totalDurationMs: number;
  totalLoopAttempts: number;
  finalScore?: number;
  finalVerdict?: string;
  nodeCount: number;
  failedNodes: string[];
}

@Entity('workflow_executions')
export class WorkflowExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'book_id', type: 'uuid' })
  bookId: string;

  @Index()
  @Column({ name: 'chapter_number', type: 'int' })
  chapterNumber: number;

  @Column({ name: 'nodes', type: 'jsonb' })
  nodes: NodeExecution[];

  @Column({ name: 'summary', type: 'jsonb', nullable: true })
  summary: ExecutionSummary | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: 'running' | 'completed' | 'failed';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
