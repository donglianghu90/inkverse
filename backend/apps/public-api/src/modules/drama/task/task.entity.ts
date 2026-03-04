/** Drama 任务实体 — 持久化任务状态、心跳、重试信息 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('drama_tasks')
export class DramaTaskEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Index() @Column() dramaId: string;
  @Column({ nullable: true }) episodeNumber: number;
  @Index() @Column() type: string; // DramaTaskType
  @Column() targetType: string; // drama / episode / asset
  @Column() targetId: string;
  @Index() @Column({ default: 'queued' }) status: string; // DramaTaskStatus
  @Column({ default: 0 }) progress: number;
  @Column({ default: 0 }) attempt: number;
  @Column({ default: 3 }) maxAttempts: number;
  @Column({ default: 0 }) priority: number;
  @Column({ type: 'varchar', nullable: true, unique: true }) dedupeKey: string | null; // 幂等去重键
  @Column({ type: 'jsonb', nullable: true }) payload: Record<string, unknown> | null;
  @Column({ type: 'jsonb', nullable: true }) result: Record<string, unknown> | null;
  @Column({ type: 'varchar', nullable: true }) errorCode: string | null;
  @Column({ type: 'text', nullable: true }) errorMessage: string | null;
  @Column({ type: 'jsonb', nullable: true }) billingInfo: Record<string, unknown> | null;
  @Column({ type: 'timestamptz', nullable: true }) heartbeatAt: Date | null; // 心跳时间戳，检测僵死任务
  @Column({ type: 'timestamptz', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) finishedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
