/** 题材模板进化引擎 — 跨书聚合书籍级校准数据，反哺系统级 GenreProfileTemplate */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@packages/modules';
import { GenreProfileTemplateEntity } from './entities/genre-profile-template.entity';
import { BookEntity } from './entities/book.entity';
import { BookStateRepository } from './book-state.repository';
import type { StoryState, BookPromptProfile } from './schemas/novel-state.schemas';
import type { RuleAtom } from './schemas/rule-engine.schemas';

interface GenreEvolutionEvent {
  type: 'rule_adopted' | 'weight_merged' | 'cliche_merged' | 'scoring_anchor_updated';
  genre: string;
  detail: string;
}

@Injectable()
export class GenreCalibrationService {
  private readonly logger = new Logger(GenreCalibrationService.name);
  private readonly minBooks: number;

  constructor(
    @InjectRepository(GenreProfileTemplateEntity) private readonly genreRepo: Repository<GenreProfileTemplateEntity>,
    @InjectRepository(BookEntity) private readonly bookRepo: Repository<BookEntity>,
    private readonly bookStateRepo: BookStateRepository,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.minBooks = Number(
      (this.config.get('calibration') as Record<string, unknown>)?.genreAggregateMinBooks ?? 3,
    );
  }

  /** 弧结束时由 deep-maintenance 触发 — 收集同题材已完结/进行中书籍数据，聚合后反哺模板 */
  async evolveGenreTemplate(genreKey: string): Promise<GenreEvolutionEvent[]> {
    const events: GenreEvolutionEvent[] = [];
    const sysTpl = await this.genreRepo.findOneBy({ userId: IsNull() as any, genreKey, isSystem: true });
    if (!sysTpl) return events;

    const bookStates = await this.collectBookStates(genreKey);
    if (bookStates.length < this.minBooks) {
      this.logger.log(`[GenreCalibration] ${genreKey} 书籍数量${bookStates.length}<${this.minBooks}，跳过`);
      return events;
    }

    this.mergeHighValueRules(sysTpl, bookStates, events);
    this.mergeDimensionWeights(sysTpl, bookStates, events);
    this.mergeClichePatterns(sysTpl, bookStates, events);

    sysTpl.systemVersion = (sysTpl.systemVersion ?? 1) + 1;
    await this.genreRepo.save(sysTpl);
    this.logger.log(`[GenreCalibration] ${genreKey} 模板已进化 v${sysTpl.systemVersion} | 事件: ${events.length}`);
    return events;
  }

  // ── 收集同题材书籍的 state（genre 存储在 stateJson->>seed->>genre 中） ──
  private async collectBookStates(genreKey: string): Promise<StoryState[]> {
    const books = await this.dataSource.getRepository(BookEntity)
      .createQueryBuilder('b')
      .where(`b.state_json->'seed'->>'genre' = :genre`, { genre: genreKey })
      .getMany();
    const states: StoryState[] = [];
    for (const book of books) {
      try {
        const state = await this.bookStateRepo.load(book.bookId);
        if (state && (state.chapterSummaries?.length ?? 0) >= 5) states.push(state);
      } catch { /* skip corrupted */ }
    }
    return states;
  }

  // ── 路径1：高命中率的 auto_calibration 规则提升到题材模板 ──
  private mergeHighValueRules(tpl: GenreProfileTemplateEntity, states: StoryState[], events: GenreEvolutionEvent[]): void {
    const ruleCounts = new Map<string, { content: string; category: string; agents: string[]; outputKey: string; bookCount: number }>();
    for (const state of states) {
      const patterns = (state.recentIssuePatterns ?? []).filter((p) => p.generatedRuleAtomId && p.occurrences >= 3);
      for (const p of patterns) {
        const key = p.pattern;
        const existing = ruleCounts.get(key);
        if (existing) existing.bookCount++;
        else {
          const [cat, ...descParts] = key.split(':');
          ruleCounts.set(key, {
            content: descParts.join(':'), category: cat, bookCount: 1,
            agents: ['creative-writer', 'reviewer'], outputKey: 'CALIBRATION_RULES',
          });
        }
      }
    }
    const existingIds = new Set((tpl.ruleAtoms ?? []).map((a) => a.id));
    for (const [key, data] of ruleCounts) {
      if (data.bookCount < this.minBooks) continue;
      const atomId = `genre_cal_${key.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}`;
      if (existingIds.has(atomId)) continue;
      const atom: RuleAtom = {
        id: atomId, category: this.mapCategory(data.category), title: `[题材校准] ${data.content.slice(0, 40)}`,
        content: `跨${data.bookCount}本书验证：${data.content}`, priority: 60,
        targetAgents: data.agents, outputKey: data.outputKey, source: 'auto_calibration', tags: ['genre_evolved'],
      };
      if (!tpl.ruleAtoms) tpl.ruleAtoms = [];
      tpl.ruleAtoms.push(atom);
      events.push({ type: 'rule_adopted', genre: tpl.genreKey, detail: `${key} (${data.bookCount}书)` });
    }
  }

  // ── 路径2：维度权重均值合并 ──
  private mergeDimensionWeights(tpl: GenreProfileTemplateEntity, states: StoryState[], events: GenreEvolutionEvent[]): void {
    const profile = tpl.profileJson as any;
    if (!profile?.reviewerCalibration?.dimensionWeights) return;
    const dims = ['engagement', 'pacing', 'hookStrength', 'consistency', 'proseQuality', 'characterDepth'] as const;
    const sumWeights: Record<string, number[]> = {};
    for (const dim of dims) sumWeights[dim] = [];
    for (const state of states) {
      const cal = (state.bookPromptProfile as BookPromptProfile)?.reviewerCalibration;
      if (!cal?.calibrationHistory?.length) continue;
      for (const dim of dims) {
        const w = (cal.dimensionWeights as Record<string, number>)[dim];
        if (typeof w === 'number') sumWeights[dim].push(w);
      }
    }
    for (const dim of dims) {
      const arr = sumWeights[dim];
      if (arr.length < this.minBooks) continue;
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const oldW = profile.reviewerCalibration.dimensionWeights[dim];
      const blended = Number((oldW * 0.6 + avg * 0.4).toFixed(2)); // 保守融合：60%原值+40%聚合值
      if (Math.abs(blended - oldW) < 0.05) continue;
      profile.reviewerCalibration.dimensionWeights[dim] = blended;
      events.push({ type: 'weight_merged', genre: tpl.genreKey, detail: `${dim}: ${oldW}→${blended}` });
    }
  }

  // ── 路径3：跨书共性 AI 味/套话模式合并到题材模板 ──
  private mergeClichePatterns(tpl: GenreProfileTemplateEntity, states: StoryState[], events: GenreEvolutionEvent[]): void {
    const profile = tpl.profileJson as any;
    if (!profile?.clichePatterns) return;
    const existingSet = new Set((profile.clichePatterns as { pattern: string }[]).map((c) => c.pattern));
    const patternCounts = new Map<string, number>();
    for (const state of states) {
      const patterns = ((state.bookPromptProfile as BookPromptProfile)?.clichePatterns ?? []) as { pattern: string }[];
      for (const p of patterns) {
        if (existingSet.has(p.pattern)) continue;
        patternCounts.set(p.pattern, (patternCounts.get(p.pattern) ?? 0) + 1);
      }
    }
    for (const [pattern, count] of patternCounts) {
      if (count < this.minBooks) continue;
      profile.clichePatterns.push({ pattern, maxPerChapter: 0 });
      events.push({ type: 'cliche_merged', genre: tpl.genreKey, detail: `${pattern} (${count}书)` });
    }
  }

  private mapCategory(cat: string): 'prose_craft' | 'writing_soul' | 'character_arc' | 'editor_discipline' | 'reviewer_rubric' | 'continuity_baseline' | 'thread_awareness' {
    const m: Record<string, string> = {
      pacing: 'writing_soul', hook: 'writing_soul', dialogue: 'prose_craft', prose_quality: 'prose_craft',
      ai_smell: 'prose_craft', character_voice: 'character_arc', character_depth: 'character_arc',
      emotional_logic: 'writing_soul', continuity: 'continuity_baseline', plot_thread: 'thread_awareness',
    };
    return (m[cat] ?? 'prose_craft') as any;
  }
}
