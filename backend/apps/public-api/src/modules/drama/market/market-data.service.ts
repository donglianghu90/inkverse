import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { MarketDramaEntity } from '../entities/market-drama.entity';
import { DouyinDramaCrawler } from './crawlers/douyin-drama.crawler';
import { HongguoDramaCrawler } from './crawlers/hongguo-drama.crawler';

export interface GenreTrend {
  genre: string;
  totalEntries: number;
  avgHotScore: number;
  maxHotScore: number;
  top3Titles: string[];
  recentGrowth: number;
  paidRatio: number;
}

export interface MarketSnapshot {
  date: string;
  totalEntries: number;
  platforms: Record<string, number>;
  topGenres: GenreTrend[];
  topDramas: Array<{
    title: string;
    platform: string;
    genre: string;
    hotScore: number;
    rankPosition: number;
    rankCategory: string;
  }>;
}

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    @InjectRepository(MarketDramaEntity)
    private readonly repo: Repository<MarketDramaEntity>,
    private readonly douyinCrawler: DouyinDramaCrawler,
    private readonly hongguoCrawler: HongguoDramaCrawler,
  ) {}

  /**
   * Check whether there is crawled data within the last N days.
   */
  async hasRecentData(days: number): Promise<boolean> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];
    const count = await this.repo.count({ where: { snapshotDate: MoreThanOrEqual(sinceStr) } });
    return count > 0;
  }

  /**
   * Run a full crawl across all platforms and persist results.
   */
  async runFullCrawl(): Promise<{ inserted: number; updated: number; errors: string[] }> {
    const today = new Date().toISOString().split('T')[0];
    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    const crawlers: Array<{ name: string; fn: () => Promise<any[]>; platform: string }> = [
      { name: 'douyin-hot', fn: () => this.douyinCrawler.crawlHotList(), platform: 'douyin' },
      { name: 'kule-hot', fn: () => this.hongguoCrawler.crawlKuleHotList(), platform: 'kule' },
      { name: 'kuoapp-daily', fn: () => this.hongguoCrawler.crawlKuoappDaily(), platform: 'kuoapp' },
      { name: 'hongguo-hot', fn: () => this.hongguoCrawler.crawlHotList(), platform: 'free_api' },
      { name: 'hongguo-video', fn: () => this.hongguoCrawler.crawlVideoList(), platform: 'hongguo_video' },
      { name: 'hongguo-sina', fn: () => this.hongguoCrawler.crawlSinaHotList(), platform: 'hongguo' },
    ];

    for (const crawler of crawlers) {
      try {
        this.logger.log(`Starting crawler: ${crawler.name}`);
        const items = await crawler.fn();
        for (const item of items) {
          try {
            const result = await this.upsertItem(item, crawler.platform, today);
            if (result === 'inserted') inserted++;
            else updated++;
          } catch (e: any) {
            errors.push(`${crawler.name}/${item.title}: ${e.message}`);
          }
        }
        this.logger.log(`Crawler ${crawler.name} completed: ${items.length} items`);
      } catch (e: any) {
        const msg = `Crawler ${crawler.name} failed: ${e.message}`;
        this.logger.error(msg);
        errors.push(msg);
      }
    }

    this.logger.log(`Full crawl completed: inserted=${inserted}, updated=${updated}, errors=${errors.length}`);
    return { inserted, updated, errors };
  }

  private async upsertItem(
    item: any,
    platform: string,
    snapshotDate: string,
  ): Promise<'inserted' | 'updated'> {
    const externalId = item.externalId || `${platform}_${item.title}`;

    const existing = await this.repo.findOne({
      where: { platform, externalId },
    });

    if (existing) {
      existing.hotScore = item.hotScore ?? existing.hotScore;
      existing.playCount = item.playCount ?? existing.playCount;
      existing.favoriteCount = item.favoriteCount ?? existing.favoriteCount;
      existing.rankPosition = item.rankPosition ?? existing.rankPosition;
      existing.rankCategory = item.rankCategory ?? existing.rankCategory;
      if (item.genre) existing.genre = item.genre;
      if (item.tags?.length) existing.tags = item.tags;
      existing.rawData = item.rawData ?? existing.rawData;
      existing.snapshotDate = snapshotDate;
      await this.repo.save(existing);
      return 'updated';
    }

    const entity = this.repo.create({
      platform,
      externalId,
      title: item.title,
      genre: item.genre || '',
      description: item.description || null,
      coverUrl: item.coverUrl || null,
      totalEpisodes: item.totalEpisodes || 0,
      playCount: item.playCount || 0,
      favoriteCount: item.favoriteCount || 0,
      hotScore: item.hotScore || 0,
      rankPosition: item.rankPosition ?? null,
      rankCategory: item.rankCategory ?? null,
      tags: item.tags?.length ? item.tags : null,
      author: item.author || null,
      isPaid: item.isPaid ?? false,
      rawData: item.rawData ?? null,
      snapshotDate,
    });

    await this.repo.save(entity);
    return 'inserted';
  }

  /**
   * Get a market snapshot for a given date (default: today).
   */
  async getSnapshot(date?: string): Promise<MarketSnapshot> {
    const targetDate = date ?? new Date().toISOString().split('T')[0];

    const entries = await this.repo.find({ where: { snapshotDate: targetDate } });

    if (entries.length === 0) {
      const latest = await this.repo
        .createQueryBuilder('m')
        .select('MAX(m.snapshotDate)', 'maxDate')
        .getRawOne();
      if (latest?.maxDate) {
        return this.getSnapshot(latest.maxDate);
      }
    }

    const platforms: Record<string, number> = {};
    for (const e of entries) {
      platforms[e.platform] = (platforms[e.platform] || 0) + 1;
    }

    const genreMap = new Map<string, MarketDramaEntity[]>();
    for (const e of entries) {
      if (!e.genre) continue;
      if (!genreMap.has(e.genre)) genreMap.set(e.genre, []);
      genreMap.get(e.genre)!.push(e);
    }

    const topGenres: GenreTrend[] = [...genreMap.entries()]
      .map(([genre, items]) => {
        const scores = items.map(i => Number(i.hotScore));
        const paidCount = items.filter(i => i.isPaid).length;
        return {
          genre,
          totalEntries: items.length,
          avgHotScore: scores.reduce((a, b) => a + b, 0) / scores.length,
          maxHotScore: Math.max(...scores),
          top3Titles: items
            .sort((a, b) => Number(b.hotScore) - Number(a.hotScore))
            .slice(0, 3)
            .map(i => i.title),
          recentGrowth: 0,
          paidRatio: items.length ? paidCount / items.length : 0,
        };
      })
      .sort((a, b) => b.totalEntries - a.totalEntries || b.avgHotScore - a.avgHotScore);

    const topDramas = [...entries]
      .sort((a, b) => Number(b.hotScore) - Number(a.hotScore))
      .slice(0, 20)
      .map(e => ({
        title: e.title,
        platform: e.platform,
        genre: e.genre,
        hotScore: Number(e.hotScore),
        rankPosition: e.rankPosition ?? 0,
        rankCategory: e.rankCategory ?? '',
      }));

    return {
      date: targetDate,
      totalEntries: entries.length,
      platforms,
      topGenres,
      topDramas,
    };
  }

  /**
   * Get genre trend over a date range (past N days).
   */
  async getGenreTrends(days = 7): Promise<Array<{ genre: string; dates: Array<{ date: string; count: number; avgHot: number }> }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const rows = await this.repo
      .createQueryBuilder('m')
      .select('m.genre', 'genre')
      .addSelect('m.snapshotDate', 'date')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(m.hotScore)', 'avgHot')
      .where('m.snapshotDate >= :since', { since: sinceStr })
      .andWhere("m.genre != ''")
      .groupBy('m.genre')
      .addGroupBy('m.snapshotDate')
      .orderBy('m.genre')
      .addOrderBy('m.snapshotDate')
      .getRawMany();

    const grouped = new Map<string, Array<{ date: string; count: number; avgHot: number }>>();
    for (const row of rows) {
      if (!grouped.has(row.genre)) grouped.set(row.genre, []);
      grouped.get(row.genre)!.push({
        date: row.date,
        count: Number(row.count),
        avgHot: Number(row.avgHot),
      });
    }

    return [...grouped.entries()].map(([genre, dates]) => ({ genre, dates }));
  }

  /**
   * List all crawled entries with optional filters.
   */
  async listEntries(opts: {
    platform?: string;
    genre?: string;
    limit?: number;
    days?: number;
  } = {}): Promise<MarketDramaEntity[]> {
    const qb = this.repo.createQueryBuilder('m');

    if (opts.platform) qb.andWhere('m.platform = :platform', { platform: opts.platform });
    if (opts.genre) qb.andWhere('m.genre = :genre', { genre: opts.genre });
    if (opts.days) {
      const since = new Date();
      since.setDate(since.getDate() - opts.days);
      qb.andWhere('m.snapshotDate >= :since', { since: since.toISOString().split('T')[0] });
    }

    qb.orderBy('m.hotScore', 'DESC').limit(opts.limit ?? 50);
    return qb.getMany();
  }

  /**
   * Get top genres for the selection recommendation system.
   */
  async getRecommendedGenres(): Promise<Array<{
    genre: string;
    hotScore: number;
    count: number;
    topTitles: string[];
    platforms: string[];
  }>> {
    const recent = await this.listEntries({ days: 7, limit: 500 });

    const genreMap = new Map<string, { items: MarketDramaEntity[]; platforms: Set<string> }>();
    for (const e of recent) {
      if (!e.genre) continue;
      if (!genreMap.has(e.genre)) genreMap.set(e.genre, { items: [], platforms: new Set() });
      const g = genreMap.get(e.genre)!;
      g.items.push(e);
      g.platforms.add(e.platform);
    }

    return [...genreMap.entries()]
      .map(([genre, { items, platforms }]) => ({
        genre,
        hotScore: items.reduce((sum, i) => sum + Number(i.hotScore), 0) / items.length,
        count: items.length,
        topTitles: items
          .sort((a, b) => Number(b.hotScore) - Number(a.hotScore))
          .slice(0, 3)
          .map(i => i.title),
        platforms: [...platforms],
      }))
      .sort((a, b) => b.count * b.hotScore - a.count * a.hotScore);
  }

  /**
   * 创作推荐：根据市场数据推荐用户应创作的题材、风格、话题方向。
   * 用于创建短剧前的选品指导。
   */
  async getCreationRecommendations(): Promise<{
    suggestedGenres: Array<{ genre: string; count: number; hotScore: number; topTitles: string[] }>;
    styleHints: string[];
    topicTrends: string[];
    hotDramaReferences: string[];
    summary: string;
    dataDate: string;
  }> {
    const snapshot = await this.getSnapshot();
    const recommended = await this.getRecommendedGenres();

    if (snapshot.totalEntries === 0) {
      return {
        suggestedGenres: [],
        styleHints: [],
        topicTrends: [],
        hotDramaReferences: [],
        summary: '暂无市场数据，请先爬取或自由创作',
        dataDate: snapshot.date,
      };
    }

    const suggestedGenres = snapshot.topGenres.slice(0, 6).map(g => ({
      genre: g.genre,
      count: g.totalEntries,
      hotScore: g.avgHotScore,
      topTitles: g.top3Titles ?? [],
    }));

    const genreToStyle: Record<string, string> = {
      甜宠: '甜宠风、轻喜剧',
      古装: '古装宫廷、权谋',
      都市: '现代都市、霸总',
      霸总: '霸道总裁、豪门',
      战神: '战神归来、打脸爽文',
      穿越: '穿越逆袭、金手指',
      复仇: '复仇打脸、虐渣',
      重生: '重生逆袭、改写命运',
      悬疑: '悬疑推理、烧脑',
      搞笑: '沙雕喜剧、轻松向',
    };
    const styleHints = [...new Set(snapshot.topGenres.slice(0, 5).map(g => genreToStyle[g.genre]).filter(Boolean))];

    const topicKeywords = ['逆袭', '闪婚', '重生', '穿越', '打脸', '虐渣', '豪门', '霸总', '甜宠', '复仇', '战神', '隐婚', '马甲', '身份'];
    const titleText = snapshot.topDramas.map(d => d.title).join('');
    const topicTrends = topicKeywords.filter(kw => titleText.includes(kw)).slice(0, 6);

    const hotDramaReferences = snapshot.topDramas.slice(0, 8).map(d => d.title);

    const top3 = suggestedGenres.slice(0, 3).map(g => g.genre).join('、');
    const summary = topicTrends.length > 0
      ? `近期 ${top3} 表现亮眼，话题热度集中在「${topicTrends.join('」「')}」，可据此方向策划创作`
      : `近期 ${top3} 表现亮眼，建议优先考虑此类题材`;

    return {
      suggestedGenres,
      styleHints,
      topicTrends,
      hotDramaReferences,
      summary,
      dataDate: snapshot.date,
    };
  }
}
