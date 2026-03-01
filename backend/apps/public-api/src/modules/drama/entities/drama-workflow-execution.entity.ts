import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('drama_workflow_executions')
export class DramaWorkflowExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  dramaId: string;

  @Column({ type: 'int' })
  episodeNumber: number;

  @Column({ type: 'enum', enum: ['running', 'completed', 'failed', 'interrupted'], default: 'running' })
  status: 'running' | 'completed' | 'failed' | 'interrupted';

  @Column({ default: '' })
  ownerInstanceId: string;

  @Column({ type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ default: '' })
  lastCheckpoint: string;

  @Column({ type: 'jsonb', default: {} })
  stepOutputs: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  @Column({ type: 'text', default: '' })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
