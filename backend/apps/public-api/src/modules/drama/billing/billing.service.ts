/** 计费服务 — 冻结→结算→回滚三阶段事务模型 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DramaUserBalanceEntity, DramaBalanceFreezeEntity, DramaBalanceTransactionEntity } from './billing.entity';
import { DramaError } from '../errors';

export type BillingMode = 'OFF' | 'SHADOW' | 'ENFORCE'; // OFF=不计费 SHADOW=记录不扣费 ENFORCE=强制扣费

export interface FreezeInput { userId: string; amount: number; taskId: string; idempotencyKey?: string; metadata?: Record<string, unknown>; expiresInMs?: number; }
export interface SettleInput { freezeId: string; actualAmount: number; taskId: string; dramaId?: string; taskType?: string; billingMeta?: Record<string, unknown>; }

@Injectable()
export class DramaBillingService {
  private readonly logger = new Logger(DramaBillingService.name);
  private mode: BillingMode = 'OFF'; // 默认关闭，通过配置开启

  constructor(
    @InjectRepository(DramaUserBalanceEntity) private readonly balanceRepo: Repository<DramaUserBalanceEntity>,
    @InjectRepository(DramaBalanceFreezeEntity) private readonly freezeRepo: Repository<DramaBalanceFreezeEntity>,
    @InjectRepository(DramaBalanceTransactionEntity) private readonly txnRepo: Repository<DramaBalanceTransactionEntity>,
    private readonly ds: DataSource,
  ) {}

  setMode(mode: BillingMode) { this.mode = mode; }

  async getBalance(userId: string): Promise<{ balance: number; frozen: number; available: number }> {
    const b = await this.ensureBalance(userId);
    return { balance: Number(b.balance), frozen: Number(b.frozenAmount), available: Number(b.balance) - Number(b.frozenAmount) };
  }

  async freeze(input: FreezeInput): Promise<{ freezeId: string }> { // 阶段1: 预冻结
    if (this.mode === 'OFF') return { freezeId: '' };
    if (input.idempotencyKey) { // 幂等检查
      const existing = await this.freezeRepo.findOne({ where: { idempotencyKey: input.idempotencyKey, status: 'pending' } });
      if (existing) return { freezeId: existing.id };
    }
    return this.ds.transaction(async (mgr) => {
      const bal = await this.ensureBalanceInTx(mgr, input.userId);
      const available = Number(bal.balance) - Number(bal.frozenAmount);
      if (this.mode === 'ENFORCE' && available < input.amount) throw new DramaError('INSUFFICIENT_BALANCE', `余额不足: 需要${input.amount}, 可用${available}`, { required: input.amount, available });
      bal.frozenAmount = Number(bal.frozenAmount) + input.amount;
      await mgr.save(DramaUserBalanceEntity, bal);
      const freeze = await mgr.save(DramaBalanceFreezeEntity, mgr.create(DramaBalanceFreezeEntity, {
        userId: input.userId, amount: input.amount, taskId: input.taskId,
        idempotencyKey: input.idempotencyKey, metadata: input.metadata,
        expiresAt: input.expiresInMs ? new Date(Date.now() + input.expiresInMs) : null,
      }));
      return { freezeId: freeze.id };
    });
  }

  async settle(input: SettleInput): Promise<void> { // 阶段2: 结算（执行成功后）
    if (this.mode === 'OFF') return;
    await this.ds.transaction(async (mgr) => {
      const freeze = await mgr.findOne(DramaBalanceFreezeEntity, { where: { id: input.freezeId, status: 'pending' }, lock: { mode: 'pessimistic_write' } });
      if (!freeze) { this.logger.warn(`冻结记录 ${input.freezeId} 不存在或已处理`); return; }
      const bal = await mgr.findOne(DramaUserBalanceEntity, { where: { userId: freeze.userId }, lock: { mode: 'pessimistic_write' } });
      if (!bal) return;
      const chargeAmount = Math.min(input.actualAmount, Number(freeze.amount)); // 实际扣费不超过冻结额
      const refundDiff = Number(freeze.amount) - chargeAmount;
      bal.balance = Number(bal.balance) - chargeAmount;
      bal.frozenAmount = Number(bal.frozenAmount) - Number(freeze.amount);
      bal.totalSpent = Number(bal.totalSpent) + chargeAmount;
      await mgr.save(DramaUserBalanceEntity, bal);
      freeze.status = 'settled'; freeze.metadata = { ...freeze.metadata, actualAmount: chargeAmount, refundDiff };
      await mgr.save(DramaBalanceFreezeEntity, freeze);
      await mgr.save(DramaBalanceTransactionEntity, mgr.create(DramaBalanceTransactionEntity, { // 记录流水
        userId: freeze.userId, type: 'charge', amount: -chargeAmount, balanceAfter: Number(bal.balance),
        description: `任务扣费 ${input.taskType ?? ''}`, taskId: input.taskId, dramaId: input.dramaId,
        taskType: input.taskType, billingMeta: input.billingMeta,
      }));
    });
  }

  async rollback(freezeId: string): Promise<void> { // 阶段3: 回滚（执行失败时）
    if (this.mode === 'OFF' || !freezeId) return;
    await this.ds.transaction(async (mgr) => {
      const freeze = await mgr.findOne(DramaBalanceFreezeEntity, { where: { id: freezeId, status: 'pending' }, lock: { mode: 'pessimistic_write' } });
      if (!freeze) return;
      const bal = await mgr.findOne(DramaUserBalanceEntity, { where: { userId: freeze.userId }, lock: { mode: 'pessimistic_write' } });
      if (bal) { bal.frozenAmount = Math.max(0, Number(bal.frozenAmount) - Number(freeze.amount)); await mgr.save(DramaUserBalanceEntity, bal); }
      freeze.status = 'rolled_back';
      await mgr.save(DramaBalanceFreezeEntity, freeze);
    });
  }

  async recharge(userId: string, amount: number, description?: string): Promise<void> { // 充值
    await this.ds.transaction(async (mgr) => {
      const bal = await this.ensureBalanceInTx(mgr, userId);
      bal.balance = Number(bal.balance) + amount;
      await mgr.save(DramaUserBalanceEntity, bal);
      await mgr.save(DramaBalanceTransactionEntity, mgr.create(DramaBalanceTransactionEntity, { userId, type: 'recharge', amount, balanceAfter: Number(bal.balance), description: description ?? '充值' }));
    });
  }

  async getTransactions(userId: string, limit = 50): Promise<DramaBalanceTransactionEntity[]> {
    return this.txnRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }

  private async ensureBalance(userId: string): Promise<DramaUserBalanceEntity> {
    let b = await this.balanceRepo.findOne({ where: { userId } });
    if (!b) b = await this.balanceRepo.save(this.balanceRepo.create({ userId }));
    return b;
  }

  private async ensureBalanceInTx(mgr: any, userId: string): Promise<DramaUserBalanceEntity> {
    let b = await mgr.findOne(DramaUserBalanceEntity, { where: { userId }, lock: { mode: 'pessimistic_write' } });
    if (!b) b = await mgr.save(DramaUserBalanceEntity, mgr.create(DramaUserBalanceEntity, { userId }));
    return b;
  }
}
