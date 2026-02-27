/** 书籍状态持久化层 — StoryState 拆分存储：核心JSONB + 8个规范化子表。 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BookEntity } from './entities/book.entity';
import {
  BookCharacterEntity, BookPlotThreadEntity, BookTimelineEventEntity,
  BookCharacterFactEntity, BookRelationEntity, BookChapterSummaryEntity,
  BookFactionEntity, BookCommitmentEntity,
} from './entities/book-state-entities';
import { StoryState, storyStateSchema } from './schemas/novel-state.schemas';

const EXTRACTED_KEYS = [
  'characters', 'plotThreadLedger', 'timelineEvents', 'characterFactLedger',
  'relationGraph', 'chapterSummaries', 'factions', 'activeCommitments',
] as const;

@Injectable()
export class BookStateRepository {
  constructor(
    @InjectRepository(BookEntity) private readonly bookRepo: Repository<BookEntity>,
    @InjectRepository(BookCharacterEntity) private readonly charRepo: Repository<BookCharacterEntity>,
    @InjectRepository(BookPlotThreadEntity) private readonly threadRepo: Repository<BookPlotThreadEntity>,
    @InjectRepository(BookTimelineEventEntity) private readonly eventRepo: Repository<BookTimelineEventEntity>,
    @InjectRepository(BookCharacterFactEntity) private readonly factRepo: Repository<BookCharacterFactEntity>,
    @InjectRepository(BookRelationEntity) private readonly relRepo: Repository<BookRelationEntity>,
    @InjectRepository(BookChapterSummaryEntity) private readonly summaryRepo: Repository<BookChapterSummaryEntity>,
    @InjectRepository(BookFactionEntity) private readonly factionRepo: Repository<BookFactionEntity>,
    @InjectRepository(BookCommitmentEntity) private readonly commitRepo: Repository<BookCommitmentEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** 从核心表 + 8子表组装完整 StoryState。 */
  async load(bookId: string): Promise<StoryState> {
    const book = await this.bookRepo.findOneBy({ bookId });
    if (!book) throw new NotFoundException(`Book not found: ${bookId}`);
    const [chars, threads, events, facts, rels, sums, facs, commits] = await Promise.all([
      this.charRepo.find({ where: { bookId } }),
      this.threadRepo.find({ where: { bookId } }),
      this.eventRepo.find({ where: { bookId } }),
      this.factRepo.find({ where: { bookId } }),
      this.relRepo.find({ where: { bookId } }),
      this.summaryRepo.find({ where: { bookId }, order: { chapterNumber: 'ASC' } }),
      this.factionRepo.find({ where: { bookId } }),
      this.commitRepo.find({ where: { bookId } }),
    ]);
    return storyStateSchema.parse({
      ...book.stateJson,
      characters: chars.map((c) => c.data),
      plotThreadLedger: threads.map((t) => t.data),
      timelineEvents: events.map((e) => e.data),
      characterFactLedger: facts.map((f) => f.data),
      relationGraph: rels.map((r) => r.data),
      chapterSummaries: sums.map((s) => ({ chapterNumber: s.chapterNumber, summary: s.summary })),
      factions: facs.map((f) => f.data),
      activeCommitments: commits.map((c) => c.data),
    });
  }

  /** 事务写入：核心状态 + 8子表全量同步。 */
  async save(state: StoryState): Promise<void> {
    const bookId = state.bookId;
    const coreState: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(state)) {
      if (!(EXTRACTED_KEYS as readonly string[]).includes(k)) coreState[k] = v;
    }
    await this.dataSource.transaction(async (em) => {
      await em.save(BookEntity, { bookId, stateJson: coreState });
      await em.delete(BookCharacterEntity, { bookId });
      if (state.characters.length)
        await em.insert(BookCharacterEntity, state.characters.map((c) => ({ bookId, characterId: c.id, data: c as any })));
      await em.delete(BookPlotThreadEntity, { bookId });
      if (state.plotThreadLedger?.length)
        await em.insert(BookPlotThreadEntity, state.plotThreadLedger.map((t) => ({ bookId, threadId: t.id, data: t as any })));
      await em.delete(BookTimelineEventEntity, { bookId });
      if (state.timelineEvents?.length)
        await em.insert(BookTimelineEventEntity, state.timelineEvents.map((e) => ({ bookId, eventId: e.id, data: e as any })));
      await em.delete(BookCharacterFactEntity, { bookId });
      if (state.characterFactLedger?.length)
        await em.insert(BookCharacterFactEntity, state.characterFactLedger.map((f) => ({ bookId, factId: f.id, data: f as any })));
      await em.delete(BookRelationEntity, { bookId });
      if (state.relationGraph?.length)
        await em.insert(BookRelationEntity, state.relationGraph.map((r) => ({ bookId, relationId: r.id, data: r as any })));
      await em.delete(BookChapterSummaryEntity, { bookId });
      if (state.chapterSummaries.length)
        await em.insert(BookChapterSummaryEntity, state.chapterSummaries.map((s) => ({ bookId, chapterNumber: s.chapterNumber, summary: s.summary })));
      await em.delete(BookFactionEntity, { bookId });
      if (state.factions?.length)
        await em.insert(BookFactionEntity, state.factions.map((f) => ({ bookId, factionId: f.id, data: f as any })));
      await em.delete(BookCommitmentEntity, { bookId });
      if (state.activeCommitments?.length)
        await em.insert(BookCommitmentEntity, state.activeCommitments.map((c) => ({ bookId, commitmentId: c.id, data: c as any })));
    });
  }

  /** 创建空 Book 行（后续由 save 填充完整状态）。 */
  async createEmpty(userId?: string): Promise<BookEntity> {
    return this.bookRepo.save(this.bookRepo.create({ userId: userId ?? null, stateJson: {} as Record<string, unknown> }));
  }

  /** 轻量列表查询（只读核心 stateJson，不加载子表）。 */
  async findAllLightweight(limit: number, userId?: string): Promise<BookEntity[]> {
    const where = userId ? { userId } : {};
    return this.bookRepo.find({ where, order: { updatedAt: 'DESC' }, take: limit });
  }

  async exists(bookId: string): Promise<boolean> {
    return (await this.bookRepo.count({ where: { bookId } })) > 0;
  }

  /** 校验书籍归属，不匹配则抛 NotFoundException。 */
  async assertOwnership(bookId: string, userId: string): Promise<void> {
    const book = await this.bookRepo.findOne({ where: { bookId }, select: ['bookId', 'userId'] });
    if (!book) throw new NotFoundException(`Book not found: ${bookId}`);
    if (book.userId && book.userId !== userId) throw new NotFoundException(`Book not found: ${bookId}`);
  }
}
