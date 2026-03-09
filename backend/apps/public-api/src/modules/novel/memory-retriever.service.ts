/** 记忆检索器 — pgvector 语义向量 + 结构化过滤的三层金字塔记忆召回（章→弧→卷）。 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { toSql } from 'pgvector';
import { ChapterMemoryEntity } from './entities/chapter-memory.entity';
import { ArcSummaryEntity, VolumeSummaryEntity } from './entities/summary-pyramid.entity';
import { ChapterIntent, MiniArc, StoryState, VolumeArc } from './schemas/novel-state.schemas';
import { ChapterDraft, LoreRecord } from './schemas/novel.schemas';
import { EmbeddingService } from './llm/embedding.service';
import { CONTEXT_WINDOW_SUMMARIES } from './prompting/novel-playbook';
import type { MemoryQuery, RankedMemory, PyramidLayer, LongRangeContext } from './interfaces';

export type { MemoryQuery, RankedMemory, PyramidLayer, LongRangeContext } from './interfaces';

const W_VEC = 0.6;
const W_STRUCT = 0.4;

@Injectable()
export class MemoryRetrieverService implements OnModuleInit {
  private readonly logger = new Logger(MemoryRetrieverService.name);
  private vectorReady = false;

  constructor(
    @InjectRepository(ChapterMemoryEntity) private readonly memoryRepo: Repository<ChapterMemoryEntity>,
    @InjectRepository(ArcSummaryEntity) private readonly arcSumRepo: Repository<ArcSummaryEntity>,
    @InjectRepository(VolumeSummaryEntity) private readonly volSumRepo: Repository<VolumeSummaryEntity>,
    private readonly dataSource: DataSource,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async onModuleInit() { await this.initPgVector(); }

  /** 初始化 pgvector 扩展、向量列、HNSW 索引；三张表统一处理，维度不匹配自动重建。 */
  private async initPgVector(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    const dim = this.embeddingService.dimensions;
    try {
      await qr.query('CREATE EXTENSION IF NOT EXISTS vector');
      const tables = ['chapter_memories', 'arc_summaries', 'volume_summaries'];
      for (const tbl of tables) {
        const colCheck: { atttypmod: number }[] = await qr.query(
          `SELECT a.atttypmod FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid WHERE c.relname = $1 AND a.attname = 'embedding' AND NOT a.attisdropped`, [tbl],
        );
        if (colCheck.length > 0 && colCheck[0].atttypmod !== dim) { // 维度不匹配，先删旧列和索引
          await qr.query(`DROP INDEX IF EXISTS idx_${tbl}_emb`);
          await qr.query(`ALTER TABLE ${tbl} DROP COLUMN IF EXISTS embedding`);
          this.logger.warn(`${tbl}.embedding 维度不匹配(${colCheck[0].atttypmod}→${dim})，已重建`);
        }
        await qr.query(`DO $$ BEGIN ALTER TABLE ${tbl} ADD COLUMN embedding vector(${dim}); EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        if (dim <= 2000) await qr.query(`CREATE INDEX IF NOT EXISTS idx_${tbl}_emb ON ${tbl} USING hnsw (embedding vector_cosine_ops)`);
        else this.logger.warn(`${tbl}.embedding dim=${dim} 超过 hnsw 上限 2000，已跳过索引创建并使用无索引向量检索`);
      }
      this.vectorReady = true;
      this.logger.log(`pgvector 三层金字塔初始化完成 (dim=${dim})`);
    } catch (e) {
      this.logger.warn(`pgvector 初始化失败，降级纯结构化检索: ${e instanceof Error ? e.message : String(e)}`);
    } finally { await qr.release(); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 持久化：章级
  // ═══════════════════════════════════════════════════════════════════════════

  async persistChapterMemory(
    bookId: string, chapterNumber: number,
    draft: ChapterDraft, lore: LoreRecord, state: StoryState, intent: ChapterIntent,
  ): Promise<void> {
    const characterIds = [...new Set([
      ...lore.characterLifecycleDeltas.map((d) => d.characterId),
      ...(intent.characterAvailability?.activeCharacterIds ?? []),
    ])];
    const locationIds = [...new Set(lore.newLocations?.map((l) => l.id) ?? [])];
    const plotThreadIds = [...new Set(lore.plotThreadDeltas.map((d) => d.label ?? d.threadId ?? ''))].filter(Boolean);
    const planted = lore.plotThreadDeltas.filter((d) => d.action === 'open').map((d) => d.label ?? d.threadId ?? '');
    const resolved = lore.plotThreadDeltas.filter((d) => d.action === 'payoff').map((d) => d.label ?? d.threadId ?? '');
    const keywords = this.extractKeywords(draft, lore, intent);
    const summary = lore.summary || draft.title;

    const charMap = new Map(state.characters.map((c) => [c.id, c]));
    const characterStates = Object.fromEntries(
      characterIds.map((id) => {
        const c = charMap.get(id);
        return [id, {
          level: String(c?.status?.level ?? ''),
          mood: (c?.psychology?.currentMood ?? '').slice(0, 50),
          status: c?.status?.lifecycleStatus ?? 'active',
          location: c?.status?.locationId ?? '',
        }];
      }),
    );

    await this.memoryRepo.upsert({
      bookId, chapterNumber, summary,
      keyEvents: [...(lore.openLoops ?? []), ...(lore.stateChanges ?? [])].slice(0, 10),
      characterIds, locationIds, plotThreadIds,
      emotionalTone: (intent.emotionDirection || '').slice(0, 250),
      tensionLevel: Math.min(10, Math.max(1, 5 + (state.readerTension?.chaptersSinceLastPayoff ?? 0))),
      keywords, foreshadowingPlanted: planted, foreshadowingResolved: resolved,
      characterStates,
    }, ['bookId', 'chapterNumber']);

    if (this.vectorReady && this.embeddingService.available) {
      const embText = [summary, ...keywords.slice(0, 10), ...planted].join(' ');
      const vec = await this.embeddingService.embed(embText, { bookId, chapterNumber, userId: state.userId });
      if (vec) {
        await this.dataSource.query(
          `UPDATE chapter_memories SET embedding = $1::vector WHERE book_id = $2 AND chapter_number = $3`,
          [toSql(vec), bookId, chapterNumber],
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 持久化：弧级摘要
  // ═══════════════════════════════════════════════════════════════════════════

  async persistArcSummary(bookId: string, arc: ArcSummaryEntity, userId?: string): Promise<void> {
    await this.arcSumRepo.upsert(arc, ['bookId', 'arcId']);
    if (this.vectorReady && this.embeddingService.available) {
      const embText = [arc.summary, arc.emotionalArc, ...arc.keywords.slice(0, 10)].filter(Boolean).join(' ');
      const vec = await this.embeddingService.embed(embText, { bookId, userId });
      if (vec) {
        await this.dataSource.query(
          `UPDATE arc_summaries SET embedding = $1::vector WHERE book_id = $2 AND arc_id = $3`,
          [toSql(vec), bookId, arc.arcId],
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 持久化：卷级摘要
  // ═══════════════════════════════════════════════════════════════════════════

  async persistVolumeSummary(bookId: string, vol: VolumeSummaryEntity, userId?: string): Promise<void> {
    await this.volSumRepo.upsert(vol, ['bookId', 'volumeId']);
    if (this.vectorReady && this.embeddingService.available) {
      const embText = [vol.summary, vol.powerProgression, vol.worldExpansion, ...vol.keywords.slice(0, 10)].filter(Boolean).join(' ');
      const vec = await this.embeddingService.embed(embText, { bookId, userId });
      if (vec) {
        await this.dataSource.query(
          `UPDATE volume_summaries SET embedding = $1::vector WHERE book_id = $2 AND volume_id = $3`,
          [toSql(vec), bookId, vol.volumeId],
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 混合检索：章节级
  // ═══════════════════════════════════════════════════════════════════════════

  async retrieve(bookId: string, query: MemoryQuery): Promise<RankedMemory[]> {
    const maxResults = query.maxResults ?? 8;
    const excludeRecent = query.excludeRecentN ?? 6;
    const useVector = this.vectorReady && this.embeddingService.available && !!query.semanticQuery;
    const shortlistLimit = Math.min(1000, Math.max(120, maxResults * 30));

    const latestRaw = await this.memoryRepo
      .createQueryBuilder('m')
      .select('MAX(m.chapterNumber)', 'max')
      .where('m.bookId = :bookId', { bookId })
      .getRawOne<{ max: string | null }>();
    const latestCh = Number(latestRaw?.max ?? 0);
    if (latestCh <= 0) return [];
    const upperBound = latestCh - excludeRecent;
    if (upperBound <= 0) return [];

    const vectorScores = new Map<number, number>();
    const vectorChapterNums: number[] = [];
    if (useVector) {
      const vec = await this.embeddingService.embed(query.semanticQuery!, { bookId });
      if (vec) {
        const rows: { chapter_number: number; distance: number }[] = await this.dataSource.query(
          `SELECT chapter_number, embedding <=> $1::vector AS distance
             FROM chapter_memories
            WHERE book_id = $2 AND chapter_number <= $3 AND embedding IS NOT NULL
            ORDER BY distance ASC LIMIT $4`,
          [toSql(vec), bookId, upperBound, maxResults * 8],
        );
        rows.forEach((r) => {
          vectorScores.set(r.chapter_number, Math.max(0, 1 - r.distance));
          vectorChapterNums.push(r.chapter_number);
        });
      }
    }

    // SQL 前置过滤：只取最近候选窗口，避免全表扫描。
    const recentCandidates = await this.memoryRepo
      .createQueryBuilder('m')
      .where('m.bookId = :bookId', { bookId })
      .andWhere('m.chapterNumber <= :upperBound', { upperBound })
      .orderBy('m.chapterNumber', 'DESC')
      .take(shortlistLimit)
      .getMany();
    const recentMap = new Map(recentCandidates.map((m) => [m.chapterNumber, m]));
    const missingVectorChapters = [...new Set(vectorChapterNums)].filter((ch) => !recentMap.has(ch));
    const vectorCandidates = missingVectorChapters.length > 0
      ? await this.memoryRepo.find({ where: { bookId, chapterNumber: In(missingVectorChapters) } })
      : [];
    const candidates = [...recentCandidates, ...vectorCandidates];
    if (candidates.length === 0) return [];

    const scored = candidates.map((mem) => {
      const { score: sScore, reasons } = this.calcStructScore(mem, query);
      const vScore = vectorScores.get(mem.chapterNumber) ?? 0;
      const finalScore = useVector ? W_VEC * vScore + W_STRUCT * sScore : sScore;
      if (vScore > 0) reasons.push(`语义${(vScore * 100).toFixed(0)}%`);
      return { mem, score: finalScore, reasons };
    });

    return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults).map((s) => ({
      chapterNumber: s.mem.chapterNumber, summary: s.mem.summary,
      keyEvents: s.mem.keyEvents, relevanceScore: Math.round(s.score * 100) / 100, matchReasons: s.reasons,
      characterStates: s.mem.characterStates,
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 三层金字塔上下文构建
  // ═══════════════════════════════════════════════════════════════════════════

  async buildLongRangeContext(bookId: string, intent: ChapterIntent, state: StoryState): Promise<LongRangeContext> {
    const activeThreadIds = (state.plotThreadLedger ?? []).filter((t) => t.status === 'open').map((t) => t.label);
    const semanticQuery = [
      ...(intent.goals?.slice(0, 3) ?? []),
      intent.emotionDirection ?? '', intent.carryoverFromLastChapter ?? '',
    ].filter(Boolean).join(' ');

    const pyramidLayers: PyramidLayer[] = [];
    const lines: string[] = [];

    // ── 卷级摘要（最宏观） ──
    const volSummaries = await this.retrieveVolumeSummaries(bookId, semanticQuery, 3);
    for (const v of volSummaries) {
      pyramidLayers.push({ level: 'volume', id: v.volumeId, summary: v.summary, chapterRange: `${v.startChapter}-${v.endChapter}`, score: v.score });
      lines.push(`[卷·${v.title}] (${v.startChapter}-${v.endChapter}章) ${v.summary.slice(0, 200)}${v.powerProgression ? ` | 实力：${v.powerProgression.slice(0, 80)}` : ''}`);
    }

    // ── 弧级摘要（中观） ──
    const currentArcId = state.currentArc?.arcId;
    const arcSummaries = await this.retrieveArcSummaries(bookId, semanticQuery, currentArcId, 4);
    for (const a of arcSummaries) {
      pyramidLayers.push({ level: 'arc', id: a.arcId, summary: a.summary, chapterRange: `${a.startChapter}-${a.endChapter}`, score: a.score });
      const threads = a.resolvedThreads.length > 0 ? ` | 回收：${a.resolvedThreads.slice(0, 2).join('、')}` : '';
      lines.push(`[弧·${a.arcTitle}] (${a.startChapter}-${a.endChapter}章) ${a.summary.slice(0, 150)}${threads}`);
    }

    // ── 章节级记忆（微观） ──
    const charImpMap: Record<string, string> = {};
    for (const c of state.characters) if (c.status.narrativeImportance) charImpMap[c.id] = c.status.narrativeImportance;
    const memories = await this.retrieve(bookId, {
      characterIds: intent.characterAvailability?.activeCharacterIds,
      characterImportanceMap: charImpMap,
      plotThreadIds: activeThreadIds,
      keywords: intent.goals?.slice(0, 3),
      semanticQuery,
      excludeRecentN: CONTEXT_WINDOW_SUMMARIES,
      maxResults: 6,
    });
    for (const m of memories) {
      pyramidLayers.push({ level: 'chapter', id: `ch${m.chapterNumber}`, summary: m.summary, chapterRange: `${m.chapterNumber}`, score: m.relevanceScore });
      const ev = m.keyEvents.length > 0 ? ` | 事件：${m.keyEvents.slice(0, 2).join('；')}` : '';
      const charStateStr = m.characterStates && Object.keys(m.characterStates).length > 0
        ? ' | 角色状态：' + Object.entries(m.characterStates).slice(0, 3).map(([id, s]) => `${id}[${s.status}${s.level ? '/' + s.level : ''}${s.mood ? '/' + s.mood : ''}]`).join('，')
        : '';
      lines.push(`[第${m.chapterNumber}章] ${m.summary}${ev}${charStateStr}（${m.matchReasons.join('+')}）`);
    }

    if (lines.length === 0) return { memories: [], pyramidLayers: [], contextText: '' };

    const contextText = `=== 分层远程记忆（卷→弧→章，与当前相关） ===\n${lines.join('\n')}`;
    this.logger.log(`[buildLongRangeContext] bookId=${bookId} ch=${intent.chapterNumber} 召回 卷${volSummaries.length}+弧${arcSummaries.length}+章${memories.length}条`);
    return { memories, pyramidLayers, contextText };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 弧级语义检索
  // ═══════════════════════════════════════════════════════════════════════════

  private async retrieveArcSummaries(
    bookId: string, semanticQuery: string, excludeArcId: string | undefined, limit: number,
  ): Promise<(ArcSummaryEntity & { score: number })[]> {
    const all = await this.arcSumRepo.find({ where: { bookId }, order: { startChapter: 'ASC' } });
    const candidates = excludeArcId ? all.filter((a) => a.arcId !== excludeArcId) : all;
    if (candidates.length === 0) return [];

    if (this.vectorReady && this.embeddingService.available && semanticQuery) {
      const vec = await this.embeddingService.embed(semanticQuery, { bookId });
      if (vec) {
        const rows: { arc_id: string; distance: number }[] = await this.dataSource.query(
          `SELECT arc_id, embedding <=> $1::vector AS distance FROM arc_summaries WHERE book_id = $2 AND embedding IS NOT NULL${excludeArcId ? ' AND arc_id != $3' : ''} ORDER BY distance ASC LIMIT $${excludeArcId ? '4' : '3'}`,
          excludeArcId ? [toSql(vec), bookId, excludeArcId, limit] : [toSql(vec), bookId, limit],
        );
        const distMap = new Map(rows.map((r) => [r.arc_id, Math.max(0, 1 - r.distance)]));
        return candidates.map((a) => ({ ...a, score: distMap.get(a.arcId) ?? 0.1 }))
          .sort((a, b) => b.score - a.score).slice(0, limit);
      }
    }
    return candidates.slice(-limit).map((a) => ({ ...a, score: 0.5 })); // 降级：最近N个
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 卷级语义检索
  // ═══════════════════════════════════════════════════════════════════════════

  private async retrieveVolumeSummaries(
    bookId: string, semanticQuery: string, limit: number,
  ): Promise<(VolumeSummaryEntity & { score: number })[]> {
    const all = await this.volSumRepo.find({ where: { bookId }, order: { volumeNumber: 'ASC' } });
    if (all.length === 0) return [];

    if (this.vectorReady && this.embeddingService.available && semanticQuery) {
      const vec = await this.embeddingService.embed(semanticQuery, { bookId });
      if (vec) {
        const rows: { volume_id: string; distance: number }[] = await this.dataSource.query(
          `SELECT volume_id, embedding <=> $1::vector AS distance FROM volume_summaries WHERE book_id = $2 AND embedding IS NOT NULL ORDER BY distance ASC LIMIT $3`,
          [toSql(vec), bookId, limit],
        );
        const distMap = new Map(rows.map((r) => [r.volume_id, Math.max(0, 1 - r.distance)]));
        return all.map((v) => ({ ...v, score: distMap.get(v.volumeId) ?? 0.1 }))
          .sort((a, b) => b.score - a.score).slice(0, limit);
      }
    }
    return all.slice(-limit).map((v) => ({ ...v, score: 0.5 }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 结构化打分 + 工具方法
  // ═══════════════════════════════════════════════════════════════════════════

  private calcStructScore(mem: ChapterMemoryEntity, q: MemoryQuery): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    if (q.characterIds?.length) {
      const ol = q.characterIds.filter((id) => mem.characterIds.includes(id));
      if (ol.length) {
        const IMP_W: Record<string, number> = { core: 1.5, major: 1.2, minor: 1.0, cameo: 0.6 };
        const wSum = ol.reduce((s, id) => s + (IMP_W[q.characterImportanceMap?.[id] ?? ''] ?? 1.0), 0);
        score += 0.4 * (wSum / q.characterIds.length); reasons.push(`角色[${ol.join(',')}]`);
      }
    }
    if (q.locationIds?.length) {
      const ol = q.locationIds.filter((id) => mem.locationIds.includes(id));
      if (ol.length) { score += 0.2 * (ol.length / q.locationIds.length); reasons.push(`地点[${ol.join(',')}]`); }
    }
    if (q.plotThreadIds?.length) {
      const ol = q.plotThreadIds.filter((id) => mem.plotThreadIds.includes(id));
      if (ol.length) { score += 0.25 * (ol.length / q.plotThreadIds.length); reasons.push(`伏线[${ol.join(',')}]`); }
    }
    if (q.keywords?.length) {
      const txt = `${mem.summary} ${mem.keyEvents.join(' ')} ${mem.keywords.join(' ')}`.toLowerCase();
      const matched = q.keywords.filter((k) => txt.includes(k.toLowerCase()));
      if (matched.length) { score += 0.15 * (matched.length / q.keywords.length); reasons.push(`关键词[${matched.join(',')}]`); }
    }
    if (mem.foreshadowingPlanted.length > 0 && mem.foreshadowingResolved.length === 0) {
      score += 0.05; reasons.push('悬伏线');
    }
    return { score, reasons };
  }

  private extractKeywords(draft: ChapterDraft, lore: LoreRecord, intent: ChapterIntent): string[] {
    const kw = new Set<string>();
    intent.goals?.forEach((g) => g.split(/[，。；、\s]+/).filter((w) => w.length >= 2 && w.length <= 8).forEach((w) => kw.add(w)));
    [...(lore.openLoops ?? []), ...(lore.stateChanges ?? [])].forEach((e) =>
      e.split(/[，。；、\s]+/).filter((w) => w.length >= 2 && w.length <= 8).forEach((w) => kw.add(w)),
    );
    lore.newCharacters?.forEach((c) => kw.add(c.name));
    lore.newLocations?.forEach((l) => kw.add(l.name));
    lore.newItems?.forEach((i) => kw.add(i.name));
    if (draft.title) kw.add(draft.title);
    return [...kw].slice(0, 30);
  }

  async removeChapterMemory(bookId: string, chapterNumber: number): Promise<void> {
    await this.memoryRepo.delete({ bookId, chapterNumber });
  }
}
