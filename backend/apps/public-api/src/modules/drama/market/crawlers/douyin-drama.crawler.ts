import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface DouyinDramaItem {
  externalId: string;
  title: string;
  description: string;
  coverUrl: string;
  totalEpisodes: number;
  playCount: number;
  favoriteCount: number;
  hotScore: number;
  tags: string[];
  author: string;
  isPaid: boolean;
  genre: string;
  rankPosition: number;
  rankCategory: string;
  rawData: Record<string, unknown>;
}

const CATEGORY_MAP: Record<number, string> = {
  0: '热榜',
  101: '甜宠',
  102: '搞笑',
  103: '逆袭',
  104: '重生',
  105: '复仇',
  106: '悬疑',
  107: '古装',
  108: '都市',
  109: '穿越',
  110: '虐恋',
};

const GENRE_FROM_CATEGORY: Record<number, string> = {
  101: '甜宠', 102: '搞笑', 103: '逆袭', 104: '重生',
  105: '复仇', 106: '悬疑', 107: '古装', 108: '都市',
  109: '穿越', 110: '虐恋',
};

@Injectable()
export class DouyinDramaCrawler {
  private readonly logger = new Logger(DouyinDramaCrawler.name);

  private readonly FREE_API_BASE = 'https://v2.xxapi.cn/api/douyinhot';

  /**
   * Crawl from the free Douyin hot list API.
   * API returns a single hot list (no category param), so we call once and deduplicate.
   */
  async crawlHotList(): Promise<DouyinDramaItem[]> {
    const items = await this.fetchHotList();
    const seen = new Set<string>();
    const deduped: DouyinDramaItem[] = [];

    for (const item of items) {
      const key = item.externalId || item.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }

    this.logger.log(`Crawled ${deduped.length} unique douyin drama items (raw: ${items.length})`);
    return deduped;
  }

  /**
   * Fetch hot list once - the free API returns a single unified list, no category support.
   */
  private async fetchHotList(): Promise<DouyinDramaItem[]> {
    const items: DouyinDramaItem[] = [];

    try {
      const resp = await axios.get(this.FREE_API_BASE, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json',
        },
      });

      const data = resp.data;
      if (!data || data.code !== 200) return items;

      const list = data?.data ?? [];
      if (!Array.isArray(list)) return items;

      for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        const genre = this.inferGenre(
          String(raw.word ?? raw.sentence_tag ?? ''),
          raw.label ? [raw.label] : [],
        );
        items.push({
          externalId: raw.word_cover?.uri ?? raw.sentence_id ?? `dy_${i}`,
          title: raw.word ?? raw.sentence_tag ?? '',
          description: raw.word ?? '',
          coverUrl: raw.word_cover?.url_list?.[0] ?? '',
          totalEpisodes: 0,
          playCount: Number(raw.hot_value ?? 0),
          favoriteCount: 0,
          hotScore: Number(raw.hot_value ?? 0),
          tags: raw.label ? [raw.label] : [],
          author: '',
          isPaid: false,
          genre,
          rankPosition: i + 1,
          rankCategory: '热榜',
          rawData: raw,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Douyin hot list API failed: ${e.message}`);
    }

    return items;
  }

  /**
   * Attempt to crawl Douyin's internal series endpoint.
   * Uses public web API that may require cookie rotation.
   */
  async crawlSeriesList(contentType = 0, count = 16): Promise<DouyinDramaItem[]> {
    const items: DouyinDramaItem[] = [];
    const category = CATEGORY_MAP[contentType] ?? '未知';

    try {
      const url = 'https://www.douyin.com/aweme/v1/web/series/list/';
      const resp = await axios.get(url, {
        params: { offset: 0, count, content_type: contentType },
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Referer': 'https://www.douyin.com/',
          'Accept': 'application/json',
        },
      });

      const list = resp.data?.series_list ?? resp.data?.data ?? [];
      if (!Array.isArray(list)) return items;

      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        items.push({
          externalId: s.series_id ?? s.id ?? `dy_series_${i}`,
          title: s.series_name ?? s.title ?? '',
          description: s.description ?? '',
          coverUrl: s.cover_url ?? s.cover?.url_list?.[0] ?? '',
          totalEpisodes: s.total_item_num ?? 0,
          playCount: Number(s.play_count ?? 0),
          favoriteCount: Number(s.collect_count ?? 0),
          hotScore: Number(s.play_count ?? 0),
          tags: s.tags?.map((t: any) => t.name ?? t) ?? [],
          author: s.author?.nickname ?? '',
          isPaid: !!(s.is_pay || s.pay_info),
          genre: GENRE_FROM_CATEGORY[contentType] ?? this.inferGenre(s.series_name, s.tags),
          rankPosition: i + 1,
          rankCategory: category,
          rawData: s,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Douyin series API failed for type ${contentType}: ${e.message}`);
    }

    return items;
  }

  private inferGenre(title: string, tags?: any[]): string {
    const text = [title, ...(tags?.map((t: any) => t.name ?? t) ?? [])].join(' ');
    const genreKeywords: Record<string, string[]> = {
      '甜宠': ['甜', '宠', '恋爱', '甜蜜'],
      '古装': ['古装', '古代', '朝代', '宫廷', '皇帝', '将军'],
      '都市': ['都市', '总裁', '豪门', '霸总', '职场'],
      '悬疑': ['悬疑', '推理', '破案', '谜'],
      '复仇': ['复仇', '报仇', '打脸', '逆袭', '虐渣'],
      '重生': ['重生', '穿越', '重来'],
      '搞笑': ['搞笑', '沙雕', '爆笑', '喜剧'],
    };
    for (const [genre, kw] of Object.entries(genreKeywords)) {
      if (kw.some(k => text.includes(k))) return genre;
    }
    return '';
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
