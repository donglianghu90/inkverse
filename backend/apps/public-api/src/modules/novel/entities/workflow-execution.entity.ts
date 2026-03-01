/** 工作流执行记录 — 每次章节生成的逐节点执行数据，含检查点和故障恢复信息 */
import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'interrupted';

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
  status: ExecutionStatus;

  @Column({ name: 'owner_instance_id', type: 'varchar', length: 120, nullable: true })
  ownerInstanceId: string | null; // 当前持有执行权的实例ID（多实例防误抢）

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null; // 执行心跳时间（用于判定 running 是否失活）

  @Column({ name: 'last_checkpoint', type: 'varchar', length: 50, nullable: true })
  lastCheckpoint: string | null; // 最后完成的工作流步骤名称

  @Column({ name: 'step_outputs', type: 'jsonb', default: '{}' })
  stepOutputs: Record<string, unknown>; // 各步骤中间产物缓存，用于断点续传

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null; // 失败/中断原因

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
