import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('usage_events')
@Index('idx_ue_user_created', ['userId', 'createdAt'])
@Index('idx_ue_user_module', ['userId', 'module'])
@Index('idx_ue_resource', ['module', 'resourceId'])
@Index('idx_ue_resource_scope', ['module', 'resourceId', 'scope'])
export class UsageEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'user_id' }) userId: string;

  @Column({ name: 'module', type: 'varchar', length: 16 })
  module: string; // 'novel' | 'drama'

  @Column({ name: 'resource_id' }) resourceId: string; // bookId | dramaId

  @Column({ name: 'scope', type: 'varchar', length: 64 })
  scope: string; // 'creation' | 'chapter:3' | 'episode:2' | 'shot:abc'

  @Column({ name: 'action', type: 'varchar', length: 64 })
  action: string; // agent/step name

  @Column({ name: 'kind', type: 'varchar', length: 16 })
  kind: string; // 'llm' | 'image' | 'video' | 'embedding' | 'tts'

  @Column({ name: 'provider', type: 'varchar', length: 32 })
  provider: string; // 'gemini' | 'claude' | 'openai' | 'flux' | 'volcengine'

  @Column({ name: 'model', type: 'varchar', length: 64 })
  model: string;

  @Column({ name: 'tokens_in', type: 'int', default: 0 }) tokensIn: number;
  @Column({ name: 'tokens_out', type: 'int', default: 0 }) tokensOut: number;

  @Column({ name: 'quantity', type: 'smallint', default: 1 }) quantity: number;

  @Column({ name: 'cost_usd', type: 'decimal', precision: 12, scale: 8, default: 0 })
  costUsd: number;

  @Column({ name: 'ok', type: 'boolean', default: true }) ok: boolean;
  @Column({ name: 'duration_ms', type: 'int', default: 0 }) durationMs: number;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true, unique: true })
  idempotencyKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
