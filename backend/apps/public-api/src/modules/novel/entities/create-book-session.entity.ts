import { Entity, Column, PrimaryColumn, Index, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('create_book_sessions')
export class CreateBookSessionEntity {
  @PrimaryColumn({ name: 'progress_channel', type: 'uuid' })
  progressChannel: string;

  @Column({ name: 'user_id', type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'queued' })
  status: string;

  @Index('idx_create_book_sessions_idempotency_key', { unique: true })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'dto_json', type: 'jsonb' })
  dtoJson: Record<string, unknown>;

  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson: Record<string, unknown> | null;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
