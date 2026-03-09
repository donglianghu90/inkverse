import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@packages/modules';
import { UsageEventEntity } from './entities/usage-event.entity';

export interface RecordUsageInput {
  userId: string;
  module: string;
  resourceId: string;
  scope: string;
  action: string;
  kind: string;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  quantity?: number;
  costUsd: number;
  ok: boolean;
  durationMs?: number;
  idempotencyKey?: string;
}

interface KindBucket {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  quantity: number;
  costUsd: number;
}

function emptyBucket(): KindBucket {
  return { calls: 0, tokensIn: 0, tokensOut: 0, quantity: 0, costUsd: 0 };
}

function round(v: number, d = 8): number {
  return Number(Number(v).toFixed(d));
}

@Injectable()
export class UsageLedgerService {
  private readonly logger = new Logger(UsageLedgerService.name);
  private readonly pricingMultiplier: number;

  constructor(
    @InjectRepository(UsageEventEntity)
    private readonly repo: Repository<UsageEventEntity>,
    private readonly configService: ConfigService,
  ) {
    this.pricingMultiplier = Number(this.configService.get('pricing.multiplier')) || 10.8;
  }

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
        costUsd: input.costUsd,
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
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.module AS module',
          'COUNT(DISTINCT e.resource_id)::int AS resources',
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.module').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          "TO_CHAR(e.created_at, 'YYYY-MM') AS month",
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy("TO_CHAR(e.created_at, 'YYYY-MM')")
        .orderBy('month', 'DESC').limit(12).getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.module AS module',
          'e.resource_id AS "resourceId"',
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where('e.user_id = :userId AND e.ok = true', { userId })
        .groupBy('e.module').addGroupBy('e.resource_id')
        .orderBy('"costUsd"', 'DESC').limit(20).getRawMany(),
    ]);

    const total = this.rollUpByKind(byKind);
    return {
      total: { ...total, priceCny: round(total.costUsd * this.pricingMultiplier, 2) },
      byModule: byModule.map(r => ({
        ...r,
        costUsd: round(+r.costUsd),
        priceCny: round(+r.costUsd * this.pricingMultiplier, 2),
      })),
      monthly: monthly.map(r => ({
        month: r.month,
        costUsd: round(+r.costUsd),
        priceCny: round(+r.costUsd * this.pricingMultiplier, 2),
      })),
      topResources: topResources.map(r => ({
        module: r.module,
        resourceId: r.resourceId,
        costUsd: round(+r.costUsd),
        priceCny: round(+r.costUsd * this.pricingMultiplier, 2),
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
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
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
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
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
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where('e.module = :module AND e.resource_id = :resourceId AND e.ok = true',
          { module, resourceId })
        .groupBy('e.kind').addGroupBy('e.provider').addGroupBy('e.model')
        .orderBy('"costUsd"', 'DESC').getRawMany(),
    ]);

    const total = this.rollUpByKind(totalRows);
    const byScope = this.groupByScope(scopeRows);
    const byModel = modelRows.map(r => ({
      kind: r.kind, provider: r.provider, model: r.model,
      calls: +r.calls, tokensIn: +r.tokensIn, tokensOut: +r.tokensOut,
      quantity: +r.quantity, costUsd: round(+r.costUsd),
      priceCny: round(+r.costUsd * this.pricingMultiplier, 2),
    }));

    return {
      total: { ...total, priceCny: round(total.costUsd * this.pricingMultiplier, 2) },
      byScope,
      byModel,
    };
  }

  // ─── Drama / Novel 前端适配格式 ───

  async resourceDetailForDrama(module: string, resourceId: string) {
    const whereClause = 'e.module = :module AND e.resource_id = :resourceId AND e.ok = true';
    const params = { module, resourceId };

    const [totalRows, scopeRows, stepRows] = await Promise.all([
      this.repo.createQueryBuilder('e')
        .select([
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where(whereClause, params)
        .groupBy('e.kind').getRawMany(),

      this.repo.createQueryBuilder('e')
        .select([
          'e.scope AS scope',
          'e.kind AS kind',
          'COUNT(*)::int AS calls',
          'COALESCE(SUM(e.tokens_in), 0)::bigint AS "tokensIn"',
          'COALESCE(SUM(e.tokens_out), 0)::bigint AS "tokensOut"',
          'COALESCE(SUM(e.quantity), 0)::int AS quantity',
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where(whereClause, params)
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
          'COALESCE(SUM(e.cost_usd), 0)::numeric AS "costUsd"',
        ])
        .where(whereClause, params)
        .groupBy('e.scope').addGroupBy('e.action').addGroupBy('e.kind').getRawMany(),
    ]);

    const total = this.toBucket(this.rollUpByKind(totalRows));

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

    const episodes: Array<{ episodeNumber: number; steps: any[] } & ReturnType<typeof this.toBucket>> = [];
    for (const [scope, kindRows] of scopeMap) {
      const m = scope.match(/^episode:(\d+)$/);
      if (!m) continue;
      episodes.push({
        episodeNumber: +m[1],
        ...this.toBucket(this.rollUpByKind(kindRows)),
        steps: buildSteps(scope),
      });
    }
    episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);

    return {
      dramaId: resourceId,
      currency: 'USD' as const,
      total,
      creation,
      episodes,
    };
  }

  private toBucket(rolled: ReturnType<UsageLedgerService['rollUpByKind']>) {
    const llm = rolled.llm;
    const img = rolled.image;
    const vid = rolled.video;
    const emb = rolled.embedding;
    const tts = rolled.tts;
    const allCalls = llm.calls + img.calls + vid.calls + emb.calls + tts.calls;
    return {
      llmCalls: llm.calls,
      promptTokens: llm.tokensIn,
      completionTokens: llm.tokensOut,
      totalTokens: llm.tokensIn + llm.tokensOut,
      llmCostUsd: round(llm.costUsd),
      imageCalls: img.calls,
      imageCostUsd: round(img.costUsd),
      videoCalls: vid.calls,
      videoCostUsd: round(vid.costUsd),
      ttsCalls: tts.calls,
      ttsCostUsd: round(tts.costUsd),
      embeddingCalls: emb.calls,
      embeddingTokens: emb.tokensIn,
      embeddingCostUsd: round(emb.costUsd),
      apiSuccessCalls: allCalls,
      apiFailedCalls: 0,
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
        costUsd: round(+r.costUsd),
        priceCny: round(+r.costUsd * this.pricingMultiplier, 2),
      })),
      total: count,
      page,
      limit,
    };
  }

  // ─── 聚合辅助 ───

  private rollUpByKind(rows: any[]) {
    const buckets: Record<string, KindBucket> = {};
    let totalCostUsd = 0;
    for (const r of rows) {
      const k = r.kind;
      const b = buckets[k] ?? emptyBucket();
      b.calls += +r.calls;
      b.tokensIn += +r.tokensIn;
      b.tokensOut += +r.tokensOut;
      b.quantity += +r.quantity;
      b.costUsd += +r.costUsd;
      totalCostUsd += +r.costUsd;
      buckets[k] = b;
    }
    return {
      costUsd: round(totalCostUsd),
      llm: this.finalizeBucket(buckets['llm']),
      image: this.finalizeBucket(buckets['image']),
      video: this.finalizeBucket(buckets['video']),
      embedding: this.finalizeBucket(buckets['embedding']),
      tts: this.finalizeBucket(buckets['tts']),
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
        priceCny: round(detail.costUsd * this.pricingMultiplier, 2),
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
    if (!b) return { calls: 0, tokensIn: 0, tokensOut: 0, quantity: 0, costUsd: 0 };
    return { ...b, costUsd: round(b.costUsd) };
  }
}
