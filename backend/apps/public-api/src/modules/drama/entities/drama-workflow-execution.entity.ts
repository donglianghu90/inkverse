import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('drama_workflow_executions')
export class DramaWorkflowExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'drama_id', type: 'uuid' })
  dramaId: string;

  @Column({ name: 'episode_number', type: 'int' })
  episodeNumber: number;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'running' })
  status: 'running' | 'completed' | 'failed' | 'interrupted';

  @Column({ name: 'owner_instance_id', type: 'varchar', length: 120, default: '' })
  ownerInstanceId: string;

  @Column({ name: 'heartbeat_at', type: 'timestamptz', nullable: true })
  heartbeatAt: Date | null;

  @Column({ name: 'last_checkpoint', type: 'varchar', length: 80, default: '' })
  lastCheckpoint: string;

  @Column({ name: 'step_outputs', type: 'jsonb', default: '{}' })
  stepOutputs: Record<string, unknown>;

  @Column({ name: 'summary', type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', default: '' })
  errorMessage: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
