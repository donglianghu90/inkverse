/** 记忆检索器 — pgvector 语义向量 + 结构化过滤的三层金字塔记忆召回（章→弧→卷）。 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { toSql } from 'pgvector';
import { ChapterMemoryEntity } from './entities/chapter-memory.entity';
import { ArcSummaryEntity, VolumeSummaryEntity } from './entities/summary-pyramid.entity';
import { ChapterIntent, MiniArc, StoryState, VolumeArc } from './schemas/novel-state.schemas';
import { ChapterDraft, LoreRecord } from './schemas/novel.schemas';
import { EmbeddingService } from './llm/embedding.service';

const VECTOR_DIM = 768;
const W_VEC = 0.6;
const W_STRUCT = 0.4;

export interface MemoryQuery {
  characterIds?: string[];
  locationIds?: string[];
  plotThreadIds?: string[];
  keywords?: string[];
  semanticQuery?: string;
  excludeRecentN?: number;
  maxResults?: number;
}

export interface RankedMemory {
  chapterNumber: number;
  summary: string;
  keyEvents: string[];
  relevanceScore: number;
  matchReasons: string[];
}

export interface PyramidLayer { level: 'volume' | 'arc' | 'chapter'; id: string; summary: string; chapterRange: string; score: number }

export interface LongRangeContext {
  memories: RankedMemory[];
  pyramidLayers: PyramidLayer[];
  contextText: string;
}

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

  /** 初始化 pgvector 扩展、向量列、HNSW 索引；三张表统一处理。 */
  private async initPgVector(): Promise<void> {
    const qr = this.dataSource.createQueryRunner();
    try {
      await qr.query('CREATE EXTENSION IF NOT EXISTS vector');
      const tables = ['chapter_memories', 'arc_summaries', 'volume_summaries'];
      for (const tbl of tables) {
        await qr.query(`DO $$ BEGIN ALTER TABLE ${tbl} ADD COLUMN embedding vector(${VECTOR_DIM}); EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await qr.query(`CREATE INDEX IF NOT EXISTS idx_${tbl}_emb ON ${tbl} USING hnsw (embedding vector_cosine_ops)`);
      }
      this.vectorReady = true;
      this.logger.log(`pgvector 三层金字塔初始化完成 (dim=${VECTOR_DIM})`);
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

    await this.memoryRepo.upsert({
      bookId, chapterNumber, summary,
      keyEvents: [...(lore.openLoops ?? []), ...(lore.stateChanges ?? [])].slice(0, 10),
      characterIds, locationIds, plotThreadIds,
      emotionalTone: intent.emotionDirection || '',
      tensionLevel: Math.min(10, Math.max(1, 5 + (state.readerTension?.chaptersSinceLastPayoff ?? 0))),
      keywords, foreshadowingPlanted: planted, foreshadowingResolved: resolved,
    }, ['bookId', 'chapterNumber']);

    if (this.vectorReady && this.embeddingService.available) {
      const embText = [summary, ...keywords.slice(0, 10), ...planted].join(' ');
      const vec = await this.embeddingService.embed(embText);
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

  async persistArcSummary(bookId: string, arc: ArcSummaryEntity): Promise<void> {
    await this.arcSumRepo.upsert(arc, ['bookId', 'arcId']);
    if (this.vectorReady && this.embeddingService.available) {
      const embText = [arc.summary, arc.emotionalArc, ...arc.keywords.slice(0, 10)].filter(Boolean).join(' ');
      const vec = await this.embeddingService.embed(embText);
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

  async persistVolumeSummary(bookId: string, vol: VolumeSummaryEntity): Promise<void> {
    await this.volSumRepo.upsert(vol, ['bookId', 'volumeId']);
    if (this.vectorReady && this.embeddingService.available) {
      const embText = [vol.summary, vol.powerProgression, vol.worldExpansion, ...vol.keywords.slice(0, 10)].filter(Boolean).join(' ');
      const vec = await this.embeddingService.embed(embText);
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

    const vectorScores = new Map<number, number>();
    if (useVector) {
      const vec = await this.embeddingService.embed(query.semanticQuery!);
      if (vec) {
        const rows: { chapter_number: number; distance: number }[] = await this.dataSource.query(
          `SELECT chapter_number, embedding <=> $1::vector AS distance FROM chapter_memories WHERE book_id = $2 AND embedding IS NOT NULL ORDER BY distance ASC LIMIT $3`,
          [toSql(vec), bookId, maxResults * 3],
        );
        rows.forEach((r) => vectorScores.set(r.chapter_number, Math.max(0, 1 - r.distance)));
      }
    }

    const allMemories = await this.memoryRepo.find({ where: { bookId }, order: { chapterNumber: 'ASC' } });
    if (allMemories.length === 0) return [];
    const latestCh = Math.max(...allMemories.map((m) => m.chapterNumber));
    const candidates = allMemories.filter((m) => m.chapterNumber <= latestCh - excludeRecent);
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
    const memories = await this.retrieve(bookId, {
      characterIds: intent.characterAvailability?.activeCharacterIds,
      plotThreadIds: activeThreadIds,
      keywords: intent.goals?.slice(0, 3),
      semanticQuery,
      excludeRecentN: state.chapterSummaries?.length ?? 6,
      maxResults: 6,
    });
    for (const m of memories) {
      pyramidLayers.push({ level: 'chapter', id: `ch${m.chapterNumber}`, summary: m.summary, chapterRange: `${m.chapterNumber}`, score: m.relevanceScore });
      const ev = m.keyEvents.length > 0 ? ` | 事件：${m.keyEvents.slice(0, 2).join('；')}` : '';
      lines.push(`[第${m.chapterNumber}章] ${m.summary}${ev}（${m.matchReasons.join('+')}）`);
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
      const vec = await this.embeddingService.embed(semanticQuery);
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
      const vec = await this.embeddingService.embed(semanticQuery);
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
      if (ol.length) { score += 0.4 * (ol.length / q.characterIds.length); reasons.push(`角色[${ol.join(',')}]`); }
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
