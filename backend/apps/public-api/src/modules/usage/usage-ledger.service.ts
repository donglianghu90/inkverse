import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageEventEntity } from './entities/usage-event.entity';
import type { RecordUsageInput } from './interfaces/record-usage.interface';
import type { KindBucket, UsageBucketView } from './interfaces/usage-bucket.interface';
import type { ScopeGranularity } from './usage.types';
import { MODULE_SCOPE_GRANULARITY, USAGE_KINDS } from './usage.types';

export type { RecordUsageInput } from './interfaces/record-usage.interface';

function emptyBucket(): KindBucket {
  return { calls: 0, tokensIn: 0, tokensOut: 0, quantity: 0, costCny: 0 };
}

function round(v: number, d = 8): number {
  return Number(Number(v).toFixed(d));
}

@Injectable()
export class UsageLedgerService {
  private readonly logger = new Logger(UsageLedgerService.name);

  constructor(
    @InjectRepository(UsageEventEntity)
    private readonly repo: Repository<UsageEventEntity>,
  ) {}

  async record(input: RecordUsageInput): Promise<UsageEventEntity | null> {
    try {
      if (input.idempotencyKey) {
        const dup = await this.repo.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (dup) return dup;
      }
      return await this.repo.save(this.repo.create({
        userId: input.userId || '',
        module: input.module,
        resourceId: input.resourceId,
        scope: input.scope,
        action: input.action,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        quantity: input.quantity ?? 1,
        costCny: input.costCny,
        ok: input.ok,
        durationMs: input.durationMs ?? 0,
        idempotencyKey: input.idempotencyKey ?? null,
      }));
    } catch (err) {
      this.logger.error(`usage record failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── 用户总面板 ("我的" 页面) ───

  async userDashboard(userId: string) {
    const [byKind, byModule, monthly, topResources] = await Promise.all([
      this.repo.createQueryBuilder('e')
        .select([
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.module AS module',
          'COUNT(DISTINCT e.resource_id)::int AS resources',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.module').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          "TO_CHAR(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month",
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy("TO_CHAR(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM')")
        .orderBy('month', 'DESC').limit(12).getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.module AS module',
          'e.resource_id AS "resourceId"',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.module').addGroupBy('e.resource_id')
        .orderBy('"costCny"', 'DESC').limit(20).getRawMany(),
    ]);

    const total = this.rollUpByKind(byKind);
    return {
      total: { ...total, costCny: round(total.costCny, 2) },
      byModule: byModule.map(r => ({
        ...r,
        costCny: round(+r.costCny, 2),
      })),
      monthly: monthly.map(r => ({
        month: r.month,
        costCny: round(+r.costCny, 2),
      })),
      topResources: topResources.map(r => ({
        module: r.module,
        resourceId: r.resourceId,
        costCny: round(+r.costCny, 2),
      })),
    };
  }

  // ─── 单本书 / 单部剧消耗详情 ───

  async resourceDetail(module: string, resourceId: string) {
    const [totalRows, scopeRows, modelRows] = await Promise.all([
      this.repo.createQueryBuilder('e')
        .select([
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.module = :module AND e.resource_id = :resourceId AND e.ok = true',
          { module, resourceId })
        .groupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.scope AS scope',
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.module = :module AND e.resource_id = :resourceId AND e.ok = true',
          { module, resourceId })
        .groupBy('e.scope').addGroupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.kind AS kind',
          'e.provider AS provider',
          'e.model AS model',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where('e.module = :module AND e.resource_id = :resourceId AND e.ok = true',
          { module, resourceId })
        .groupBy('e.kind').addGroupBy('e.provider').addGroupBy('e.model')
        .orderBy('"costCny"', 'DESC').getRawMany(),
    ]);

    const total = this.rollUpByKind(totalRows);
    const byScope = this.groupByScope(scopeRows);
    const byModel = modelRows.map(r => ({
      kind: r.kind, provider: r.provider, model: r.model,
      calls: +r.calls, tokensIn: +r.tokensIn, tokensOut: +r.tokensOut,
      quantity: +r.quantity, costCny: round(+r.costCny, 2),
    }));

    return {
      total: { ...total, costCny: round(total.costCny, 2) },
      byScope,
      byModel,
    };
  }

  // ─── Drama / Novel 前端适配格式（可扩展：支持 episode/chapter 等粒度） ───

  /** 统一资源详情，按 scope 粒度（episode/chapter 等）分组，支持小说/短剧及未来模块 */
  async resourceDetailForResource(
    module: string,
    resourceId: string,
    scopeGranularity?: ScopeGranularity,
  ) {
    const granularity = scopeGranularity ?? MODULE_SCOPE_GRANULARITY[module] ?? 'episode';
    const whereOk = 'e.module = :module AND e.resource_id = :resourceId';
    const params = { module, resourceId };

    const [totalRows, scopeRows, stepRows, failedRow] = await Promise.all([
      this.repo.createQueryBuilder('e')
        .select([
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where(`${whereOk} AND e.ok = true`, params)
        .groupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.scope AS scope',
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where(`${whereOk} AND e.ok = true`, params)
        .groupBy('e.scope').addGroupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.scope AS scope',
          'e.action AS action',
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_cny), 0)::numeric AS "costCny"',
        ])
        .where(`${whereOk} AND e.ok = true`, params)
        .groupBy('e.scope').addGroupBy('e.action').addGroupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select('COUNT(*)::int AS count')
        .where(`${whereOk} AND e.ok = false`, params)
        .getRawOne(),
    ]);

    const failedCalls = failedRow?.count ? +failedRow.count : 0;
    const total = this.toBucket(this.rollUpByKind(totalRows), failedCalls);

    const scopeMap = new Map<string, any[]>();
    for (const r of scopeRows) {
      const list = scopeMap.get(r.scope) ?? [];
      list.push(r);
      scopeMap.set(r.scope, list);
    }

    const stepMap = new Map<string, Map<string, any[]>>();
    for (const r of stepRows) {
      let actionMap = stepMap.get(r.scope);
      if (!actionMap) { actionMap = new Map(); stepMap.set(r.scope, actionMap); }
      const list = actionMap.get(r.action) ?? [];
      list.push(r);
      actionMap.set(r.action, list);
    }

    const buildSteps = (scope: string) => {
      const actionMap = stepMap.get(scope);
      if (!actionMap) return [];
      return [...actionMap.entries()].map(([action, rows]) => ({
        step: action,
        ...this.toBucket(this.rollUpByKind(rows)),
      }));
    };

    const creationKindRows = scopeMap.get('creation') ?? [];
    const creation = {
      ...this.toBucket(this.rollUpByKind(creationKindRows)),
      steps: buildSteps('creation'),
    };

    const scopeRegex = new RegExp(`^${granularity}:(\\d+)$`);
    const items: Array<{ itemNumber: number; steps: any[] } & UsageBucketView> = [];
    for (const [scope, kindRows] of scopeMap) {
      const m = scope.match(scopeRegex);
      if (!m) continue;
      items.push({
        itemNumber: +m[1],
        ...this.toBucket(this.rollUpByKind(kindRows)),
        steps: buildSteps(scope),
      });
    }
    items.sort((a, b) => a.itemNumber - b.itemNumber);

    return {
      resourceId,
      module,
      scopeGranularity: granularity,
      currency: 'CNY' as const,
      total,
      creation,
      items,
    };
  }

  /** 短剧专用：返回 dramaId + episodes 结构（向后兼容） */
  async resourceDetailForDrama(module: string, resourceId: string) {
    const raw = await this.resourceDetailForResource(module, resourceId, 'episode');
    return {
      dramaId: raw.resourceId,
      currency: raw.currency,
      total: raw.total,
      creation: raw.creation,
      episodes: raw.items.map(({ itemNumber, ...r }) => ({ episodeNumber: itemNumber, ...r })),
    };
  }

  /** 转为前端 bucket 视图，含 byKind 便于任意 kind 扩展展示 */
  private toBucket(rolled: ReturnType<UsageLedgerService['rollUpByKind']>, failedCalls = 0): UsageBucketView {
    const llm = rolled.llm;
    const img = rolled.image;
    const vid = rolled.video;
    const emb = rolled.embedding;
    const tts = rolled.tts;
    const byKindRaw = (rolled as any).byKind ?? {};
    const allCalls = Object.values(byKindRaw).reduce((s: number, b: any) => s + (b?.calls ?? 0), 0);
    const byKind: Record<string, { calls: number; tokensIn: number; tokensOut: number; quantity: number; costCny: number }> = {};
    for (const [k, v] of Object.entries(byKindRaw)) {
      const b = v as KindBucket;
      if (b) byKind[k] = { calls: b.calls, tokensIn: b.tokensIn, tokensOut: b.tokensOut, quantity: b.quantity, costCny: round(b.costCny) };
    }
    return {
      byKind,
      costCny: round(rolled.costCny, 2),
      promptTokens: llm.tokensIn,
      completionTokens: llm.tokensOut,
      totalTokens: llm.tokensIn + llm.tokensOut,
      llmCostCny: round(llm.costCny),
      imageCalls: img.calls,
      imageCostCny: round(img.costCny),
      videoCalls: vid.calls,
      videoCostCny: round(vid.costCny),
      ttsCalls: tts.calls,
      ttsCostCny: round(tts.costCny),
      embeddingCalls: emb.calls,
      embeddingTokens: emb.tokensIn,
      embeddingCostCny: round(emb.costCny),
      apiSuccessCalls: allCalls,
      apiFailedCalls: failedCalls,
    };
  }

  // ─── 用户消耗明细（分页） ───

  async userEvents(userId: string, page = 1, limit = 20) {
    const [rows, count] = await this.repo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: rows.map(r => ({
        ...r,
        costCny: round(+r.costCny, 2),
      })),
      total: count,
      page,
      limit,
    };
  }

  // ─── 聚合辅助 ───

  /** 按 kind 聚合，支持任意扩展 kind（llm/image/video/embedding/tts 及未来类型） */
  private rollUpByKind(rows: any[]) {
    const buckets: Record<string, KindBucket> = {};
    let totalCostCny = 0;
    for (const r of rows) {
      const k = r.kind;
      const b = buckets[k] ?? emptyBucket();
      b.calls += +r.calls;
      b.tokensIn += +r.tokensIn;
      b.tokensOut += +r.tokensOut;
      b.quantity += +r.quantity;
      b.costCny += +r.costCny;
      totalCostCny += +r.costCny;
      buckets[k] = b;
    }
    const byKind: Record<string, KindBucket> = {};
    for (const kind of USAGE_KINDS) byKind[kind] = this.finalizeBucket(buckets[kind]);
    for (const [k, v] of Object.entries(buckets))
      if (!USAGE_KINDS.includes(k as any)) byKind[k] = this.finalizeBucket(v);
    return {
      costCny: round(totalCostCny),
      llm: this.finalizeBucket(buckets['llm']),
      image: this.finalizeBucket(buckets['image']),
      video: this.finalizeBucket(buckets['video']),
      embedding: this.finalizeBucket(buckets['embedding']),
      tts: this.finalizeBucket(buckets['tts']),
      byKind,
    };
  }

  private groupByScope(rows: any[]) {
    const scopeMap = new Map<string, any[]>();
    for (const r of rows) {
      const list = scopeMap.get(r.scope) ?? [];
      list.push(r);
      scopeMap.set(r.scope, list);
    }
    return [...scopeMap.entries()].map(([scope, kindRows]) => {
      const detail = this.rollUpByKind(kindRows);
      return {
        scope,
        ...detail,
        costCny: round(detail.costCny, 2),
      };
    }).sort((a, b) => {
      const order = (s: string) => {
        if (s === 'creation') return -1;
        const m = s.match(/:(\d+)$/);
        return m ? +m[1] : 999;
      };
      return order(a.scope) - order(b.scope);
    });
  }

  private finalizeBucket(b?: KindBucket) {
    if (!b) return { calls: 0, tokensIn: 0, tokensOut: 0, quantity: 0, costCny: 0 };
    return { ...b, costCny: round(b.costCny) };
  }
}
