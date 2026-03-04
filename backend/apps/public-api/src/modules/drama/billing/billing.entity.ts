/** 计费实体 — 用户余额 + 冻结记录 + 流水 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('drama_user_balances')
export class DramaUserBalanceEntity { // 用户余额
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true }) @Column() userId: string;
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 }) balance: number; // 可用余额
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 }) frozenAmount: number; // 冻结金额
  @Column({ type: 'decimal', precision: 18, scale: 6, default: 0 }) totalSpent: number; // 总消费
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('drama_balance_freezes')
export class DramaBalanceFreezeEntity { // 预冻结记录
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column({ type: 'decimal', precision: 18, scale: 6 }) amount: number;
  @Index() @Column({ default: 'pending' }) status: string; // pending|settled|rolled_back|expired
  @Column({ nullable: true }) taskId: string;
  @Column({ type: 'varchar', nullable: true, unique: true }) idempotencyKey: string;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, unknown>;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt: Date;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}

@Entity('drama_balance_transactions')
export class DramaBalanceTransactionEntity { // 流水记录
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column() userId: string;
  @Column() type: string; // charge|recharge|refund|freeze|unfreeze
  @Column({ type: 'decimal', precision: 18, scale: 6 }) amount: number;
  @Column({ type: 'decimal', precision: 18, scale: 6 }) balanceAfter: number;
  @Column({ type: 'text', nullable: true }) description: string;
  @Column({ nullable: true }) taskId: string;
  @Column({ nullable: true }) dramaId: string;
  @Column({ nullable: true }) taskType: string;
  @Column({ type: 'jsonb', nullable: true }) billingMeta: Record<string, unknown>; // { model, quantity, unit, tokens... }
  @CreateDateColumn() createdAt: Date;
}
