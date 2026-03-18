import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface HongguoDramaItem {
  externalId: string;
  title: string;
  description: string;
  coverUrl: string;
  totalEpisodes: number;
  hotScore: number;
  tags: string[];
  author: string;
  genre: string;
  rankPosition: number;
  rankCategory: string;
  rawData: Record<string, unknown>;
}

@Injectable()
export class HongguoDramaCrawler {
  private readonly logger = new Logger(HongguoDramaCrawler.name);

  private readonly RMDJ_API = 'https://api.aa1.cn/api/rmdj/';
  private readonly KULE_API = 'https://api.kuleu.com/api/shortdramarank';
  private readonly KUOAPP_API = 'https://kuoapp.com/duanju/get.php';

  /**
   * Crawl from 酷乐API - 短剧热榜 (working, 30 items with ranking/hots).
   */
  async crawlKuleHotList(): Promise<HongguoDramaItem[]> {
    try {
      const resp = await axios.get(this.KULE_API, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
      });
      const data = resp.data;
      if (data?.code !== 200 || !Array.isArray(data?.data)) return [];

      const items = data.data.map((raw: any, i: number) => {
        const hotsStr = String(raw.hots ?? '0');
        const hotScore = this.parseHots(hotsStr); // "188.1w" -> 1881000
        return {
          externalId: `kule_${raw.ranking ?? i}_${(raw.title ?? '').replace(/\s+/g, '')}`,
          title: raw.title ?? '',
          description: '',
          coverUrl: '',
          totalEpisodes: 0,
          hotScore,
          tags: [],
          author: '',
          genre: this.inferGenre(raw.title ?? '', ''),
          rankPosition: raw.ranking ?? i + 1,
          rankCategory: '酷乐短剧热榜',
          rawData: raw,
        } as HongguoDramaItem;
      });

      if (items.length > 0) this.logger.log(`Crawled ${items.length} items from Kule short drama rank`);
      return items;
    } catch (e: any) {
      this.logger.warn(`Kule shortdramarank API failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Parse hots string: "188.1w" -> 1881000, "1.2万" -> 12000, "5000" -> 5000
   */
  private parseHots(s: string): number {
    const cleaned = s.replace(/\s/g, '').toLowerCase();
    const num = parseFloat(cleaned.replace(/[万w]/g, '')) || 0;
    if (/[万w]/.test(cleaned)) return num * 10000;
    return num;
  }

  /**
   * Crawl from the free hot drama API (api.aa1.cn) - may be offline.
   * Tries direct API first, then falls back to extracting URL from doc page.
   */
  async crawlHotList(): Promise<HongguoDramaItem[]> {
    let items = await this.fetchFromUrl(this.RMDJ_API);
    if (items.length === 0) {
      this.logger.log('Direct rmdj API returned empty, trying doc page...');
      const apiUrl = await this.fetchApiUrlFromDoc();
      if (apiUrl) items = await this.fetchFromUrl(apiUrl);
    }
    if (items.length > 0) {
      this.logger.log(`Crawled ${items.length} hot drama items from free API`);
    }
    return items;
  }

  private async fetchApiUrlFromDoc(): Promise<string | null> {
    try {
      const resp = await axios.get('https://api.aa1.cn/doc/rmdj.html', {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        responseType: 'text',
      });
      return this.extractApiUrl(resp.data) || this.RMDJ_API;
    } catch (e: any) {
      this.logger.warn(`Doc page fetch failed: ${e.message}`);
      return null;
    }
  }

  private async fetchFromUrl(url: string): Promise<HongguoDramaItem[]> {
    try {
      const resp = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
      });
      const raw = resp.data;
      const ct = resp.headers['content-type'] || '';
      if (typeof raw === 'string') {
        if (raw.includes('接口不存在')) {
          this.logger.warn(`API ${url} 返回「接口不存在」，该接口可能已下线或变更`);
        } else if (ct.includes('text/html')) {
          this.logger.warn(`API ${url} 返回 HTML 而非 JSON，可能需登录或接口已变更`);
        }
        return [];
      }
      const list = Array.isArray(raw)
        ? raw
        : raw?.data ?? raw?.list ?? raw?.result ?? (raw?.code === 1 || raw?.code === 200 ? raw?.data : null) ?? [];
      if (!Array.isArray(list) || list.length === 0) return [];
      return list.map((item: any, i: number) => this.parseItem(item, i));
    } catch (e: any) {
      this.logger.warn(`API ${url} failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Crawl from kuoapp.com - 每日更新短剧列表 (no hot score, use rank as proxy).
   */
  async crawlKuoappDaily(): Promise<HongguoDramaItem[]> {
    try {
      const resp = await axios.get(`${this.KUOAPP_API}?day`, {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
      });
      const list = Array.isArray(resp.data) ? resp.data : [];
      if (list.length === 0) return [];

      const items = list.slice(0, 50).map((raw: any, i: number) => {
        const name = raw.name ?? '';
        const title = name.replace(/\s*[（(]\d+集[）)].*/, '').replace(/\s*[＆&].*$/, '').trim();
        return {
          externalId: raw.id ?? `kuoapp_${i}`,
          title: title || name,
          description: '',
          coverUrl: raw.cover ?? '',
          totalEpisodes: Number(raw.episodes ?? 0),
          hotScore: 10000 - i * 100,
          tags: [],
          author: '',
          genre: this.inferGenre(title, ''),
          rankPosition: i + 1,
          rankCategory: 'kuoapp每日更新',
          rawData: raw,
        } as HongguoDramaItem;
      });

      this.logger.log(`Crawled ${items.length} items from Kuoapp daily`);
      return items;
    } catch (e: any) {
      this.logger.warn(`Kuoapp daily API failed: ${e.message}`);
      return [];
    }
  }

  /**
   * Crawl from the short drama video API (api.aa1.cn).
   * This provides searchable short drama content with episodes.
   */
  async crawlVideoList(keyword?: string): Promise<HongguoDramaItem[]> {
    const items: HongguoDramaItem[] = [];

    try {
      const params: Record<string, string> = {};
      if (keyword) params.keyword = keyword;

      const resp = await axios.get('https://api.aa1.cn/api/yingshi/', {
        params,
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
      });

      const raw = resp.data;
      if (typeof raw === 'string' && raw.includes('接口不存在')) {
        this.logger.warn('yingshi API 返回「接口不存在」，该接口可能已下线');
        return items;
      }
      const list = Array.isArray(raw)
        ? raw
        : raw?.data ?? raw?.list ?? raw?.result ?? [];
      if (!Array.isArray(list)) return items;

      for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        items.push({
          externalId: raw.id?.toString() ?? `hg_video_${i}`,
          title: raw.title ?? raw.name ?? '',
          description: raw.desc ?? raw.description ?? '',
          coverUrl: raw.cover ?? raw.pic ?? '',
          totalEpisodes: Number(raw.total ?? 0),
          hotScore: Number(raw.hot ?? raw.score ?? 0),
          tags: this.extractTags(raw),
          author: raw.author ?? '',
          genre: this.inferGenre(raw.title ?? '', raw.tags ?? ''),
          rankPosition: i + 1,
          rankCategory: '影视库',
          rawData: raw,
        });
      }

      this.logger.log(`Crawled ${items.length} video items${keyword ? ` for keyword "${keyword}"` : ''}`);
    } catch (e: any) {
      this.logger.warn(`Short drama video API failed: ${e.message}`);
    }

    return items;
  }

  /**
   * Crawl Sina news articles about 红果短剧 hot lists.
   * Extracts structured data from editorial articles.
   */
  async crawlSinaHotList(): Promise<HongguoDramaItem[]> {
    const items: HongguoDramaItem[] = [];

    const urls = [
      'https://www.sina.cn/news/detail/5263638508080012.html',
      'https://www.sina.cn/news/detail/5264758471393996.html',
    ];

    for (const url of urls) {
      try {
        const resp = await axios.get(url, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          },
          responseType: 'text',
        });

        const parsed = this.parseSinaArticle(resp.data);
        items.push(...parsed);
        await this.sleep(2000);
      } catch (e: any) {
        this.logger.warn(`Sina article crawl failed for ${url}: ${e.message}`);
      }
    }

    return items;
  }

  private parseSinaArticle(html: string): HongguoDramaItem[] {
    const items: HongguoDramaItem[] = [];
    const $ = cheerio.load(html);

    // 支持多种格式：1️⃣剧名🔥7618 | 《剧名》热度 1.2万 | 1.《剧名》
    const patterns: Array<{ re: RegExp; hotMultiplier?: number }> = [
      { re: /\d+️⃣([^🔥]+?)🔥(\d+)/g, hotMultiplier: 1 },
      { re: /《(.+?)》.*?热度[：:]?\s*(\d+(?:\.\d+)?)\s*万?/g, hotMultiplier: 10000 },
      { re: /(?:第?\d+[.、]?\s*)《(.+?)》/g },
    ];

    const text = $('article, main, body').text();
    const seen = new Set<string>();
    let rank = 1;

    for (const { re, hotMultiplier = 0 } of patterns) {
      const pattern = new RegExp(re.source, re.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const title = match[1].trim();
        if (!title || title.length < 2 || seen.has(title)) continue;
        seen.add(title);

        const hotStr = match[2];
        let hotScore = 0;
        if (hotStr) hotScore = hotMultiplier ? parseFloat(hotStr) * hotMultiplier : Number(hotStr);

        items.push({
          externalId: `sina_hg_${title.replace(/\s+/g, '')}`,
          title,
          description: '',
          coverUrl: '',
          totalEpisodes: 0,
          hotScore,
          tags: [],
          author: '',
          genre: this.inferGenre(title, ''),
          rankPosition: rank++,
          rankCategory: '红果热播榜',
          rawData: { source: 'sina', hotStr },
        });
      }
    }

    return items;
  }

  private extractApiUrl(html: string): string | null {
    const $ = cheerio.load(html);
    const codeBlocks = $('code, pre').text();
    const urlMatch = codeBlocks.match(/(https?:\/\/api\.aa1\.cn\/api\/\S+)/);
    return urlMatch?.[1] ?? 'https://api.aa1.cn/api/rmdj/';
  }

  private extractTags(raw: any): string[] {
    if (Array.isArray(raw.tags)) return raw.tags;
    if (typeof raw.tags === 'string') return raw.tags.split(/[,，/]/).filter(Boolean);
    if (raw.category) return [raw.category];
    return [];
  }

  private inferGenre(title: string, tagsStr: string): string {
    const text = `${title} ${tagsStr}`;
    const genreKeywords: Record<string, string[]> = {
      '甜宠': ['甜', '宠', '恋爱', '婚后', '老公', '新娘'],
      '古装': ['古装', '古代', '宫', '皇', '将军', '太子', '公主', '穿书'],
      '都市': ['都市', '总裁', '豪门', '霸总', '职场', '闪婚'],
      '悬疑': ['悬疑', '推理', '破案', '谋杀'],
      '复仇': ['复仇', '报仇', '打脸', '逆袭', '虐渣', '回归'],
      '重生': ['重生', '穿越', '重来', '回到'],
      '战神': ['战神', '兵王', '特种兵', '龙王', '帝师'],
      '搞笑': ['搞笑', '沙雕', '爆笑'],
      '仙侠': ['仙', '修仙', '修真', '飞升'],
    };
    for (const [genre, kw] of Object.entries(genreKeywords)) {
      if (kw.some(k => text.includes(k))) return genre;
    }
    return '';
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseItem(raw: any, index: number): HongguoDramaItem {
    return {
      externalId: raw.id?.toString() ?? `hg_${index}`,
      title: raw.title ?? raw.name ?? '',
      description: raw.desc ?? raw.description ?? '',
      coverUrl: raw.cover ?? raw.pic ?? raw.img ?? '',
      totalEpisodes: Number(raw.total ?? raw.episodes ?? 0),
      hotScore: Number(raw.hot ?? raw.heat ?? raw.score ?? 0),
      tags: this.extractTags(raw),
      author: raw.author ?? '',
      genre: this.inferGenre(raw.title ?? '', typeof raw.tags === 'string' ? raw.tags : ''),
      rankPosition: index + 1,
      rankCategory: '热门短剧',
      rawData: raw,
    };
  }
}
