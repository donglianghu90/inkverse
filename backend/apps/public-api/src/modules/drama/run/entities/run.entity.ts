/** 运行时三表设计 — GraphRun + GraphStep + GraphEvent，支持断线回放 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, OneToMany, ManyToOne, JoinColumn } from 'typeorm';

@Entity('drama_graph_runs')
export class DramaGraphRunEntity { // 一次 AI 执行的根对象
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Index() @Column() dramaId: string;
  @Column({ nullable: true }) episodeNumber: number;
  @Column() workflowType: string; // create_drama / generate_episode
  @Column({ nullable: true }) taskId: string;
  @Index() @Column({ default: 'queued' }) status: string; // queued|running|completed|failed|canceling|canceled
  @Column({ default: 0 }) lastSeq: number; // 事件时钟游标（单调递增）
  @Column({ type: 'jsonb', nullable: true }) input: Record<string, unknown>;
  @Column({ type: 'jsonb', nullable: true }) output: Record<string, unknown>;
  @Column({ type: 'varchar', nullable: true }) errorCode: string;
  @Column({ type: 'text', nullable: true }) errorMessage: string;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @OneToMany(() => DramaGraphStepEntity, s => s.run) steps: DramaGraphStepEntity[];
  @OneToMany(() => DramaGraphEventEntity, e => e.run) events: DramaGraphEventEntity[];
}

@Entity('drama_graph_steps')
@Index(['runId', 'stepKey'], { unique: true })
export class DramaGraphStepEntity { // run 内步骤投影
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() runId: string;
  @Column() stepKey: string; // 稳定标识（如 seed_analyzed, script_drafted）
  @Column() stepTitle: string;
  @Column({ default: 'pending' }) status: string; // pending|running|completed|failed|canceled
  @Column({ default: 0 }) currentAttempt: number;
  @Column() stepIndex: number;
  @Column() stepTotal: number;
  @Column({ type: 'text', nullable: true }) lastErrorMessage: string;
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @ManyToOne(() => DramaGraphRunEntity, r => r.steps, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'runId', referencedColumnName: 'id' }) run: DramaGraphRunEntity;
}

@Entity('drama_graph_events')
@Index(['runId', 'seq'], { unique: true })
export class DramaGraphEventEntity { // 事件日志 + 回放源
  @PrimaryGeneratedColumn('increment') id: number;
  @Column() runId: string;
  @Column() seq: number; // run 内单调递增
  @Column() eventType: string; // run.start|step.start|step.chunk|step.complete|step.error|run.complete|run.error
  @Column({ nullable: true }) stepKey: string;
  @Column({ nullable: true }) attempt: number;
  @Column({ type: 'jsonb', nullable: true }) payload: Record<string, unknown>;
  @CreateDateColumn() createdAt: Date;
  @ManyToOne(() => DramaGraphRunEntity, r => r.events, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'runId', referencedColumnName: 'id' }) run: DramaGraphRunEntity;
}
