import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { history, useLocation } from '@umijs/max';
import { message } from 'antd';
import {
  TrendingUp, Flame, BarChart3, RefreshCw, Loader2,
  ExternalLink, Trophy, Clock, Film, Search, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  getMarketSnapshot, triggerMarketCrawl,
  type MarketSnapshot,
} from '@/services/drama';

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音', hongguo: '红果', free_api: '热门榜', kuaishou: '快手',
  kule: '酷乐热榜', kuoapp: 'Kuoapp', hongguo_video: '红果影视',
};
const PLATFORM_COLORS: Record<string, string> = {
  douyin: 'bg-black text-white', hongguo: 'bg-red-500 text-white',
  free_api: 'bg-blue-500 text-white', kuaishou: 'bg-orange-500 text-white',
  kule: 'bg-indigo-500 text-white', kuoapp: 'bg-emerald-500 text-white',
  hongguo_video: 'bg-red-400 text-white',
};

const PODIUM_STYLES = [
  'from-amber-400 via-yellow-500 to-orange-500',
  'from-slate-300 via-gray-400 to-slate-500',
  'from-amber-600 via-orange-700 to-yellow-800',
];

const GENRE_BAR_COLORS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500',
  'bg-yellow-500', 'bg-lime-500', 'bg-emerald-500',
  'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500',
  'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
];

const RANK_MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const fmtHot = (v: number): string => {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
};

/* ─── Sub-Tab Nav ─── */
const DRAMA_TABS = [
  { key: '/novel/dramas', label: '我的作品', icon: Film },
  { key: '/novel/market', label: '市场选品', icon: TrendingUp },
] as const;

const DramaSubTabs: React.FC = () => {
  const location = useLocation();
  return (
    <div className="flex gap-1 p-0.5 rounded-lg bg-muted/50 w-fit">
      {DRAMA_TABS.map(tab => {
        const active = location.pathname === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
            )}
            onClick={() => history.push(tab.key)}
          >
            <Icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

/* ─── Top-3 Podium Card ─── */
const PodiumCard: React.FC<{
  rank: number;
  title: string;
  genre: string;
  platform: string;
  hotScore: number;
  rankCategory?: string;
}> = ({ rank, title, genre, platform, hotScore, rankCategory }) => (
  <div className={cn(
    'relative rounded-xl overflow-hidden p-4 cursor-default',
    'bg-gradient-to-br shadow-lg',
    PODIUM_STYLES[rank - 1],
    rank === 1 ? 'col-span-2 sm:col-span-1' : '',
  )}>
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.2),_transparent_60%)]" />
    <div className="relative z-10">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{RANK_MEDAL[rank]}</span>
        <span className="text-white/90 text-xs font-bold bg-white/20 backdrop-blur-sm rounded-full px-2 py-0.5">
          {fmtHot(hotScore)}
        </span>
      </div>
      <h3 className="text-white font-bold text-sm leading-tight line-clamp-2 mb-2 drop-shadow-sm">
        {title}
      </h3>
      <div className="flex items-center gap-1.5 flex-wrap">
        {genre && (
          <span className="text-[10px] bg-white/20 backdrop-blur-sm text-white px-1.5 py-0.5 rounded">
            {genre}
          </span>
        )}
        <span className={cn('text-[10px] px-1.5 py-0.5 rounded', PLATFORM_COLORS[platform] ?? 'bg-white/20 text-white')}>
          {PLATFORM_LABELS[platform] ?? platform}
        </span>
        {rankCategory && (
          <span className="text-[10px] text-white/60">{rankCategory}</span>
        )}
      </div>
    </div>
  </div>
);

const MarketInsights: React.FC = () => {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMarketSnapshot();
      setSnapshot(data);
    } catch {
      message.error('加载市场数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCrawl = async () => {
    setCrawling(true);
    try {
      const result = await triggerMarketCrawl();
      message.success(`爬取完成：新增 ${result.inserted}，更新 ${result.updated}`);
      if (result.errors.length > 0) message.warning(`${result.errors.length} 个错误`);
      await fetchData();
    } catch (e: any) {
      message.error(e?.message ?? '爬取失败');
    } finally {
      setCrawling(false);
    }
  };

  const top3 = useMemo(() => snapshot?.topDramas.slice(0, 3) ?? [], [snapshot]);

  const restDramas = useMemo(() => {
    if (!snapshot) return [];
    let dramas = snapshot.topDramas.slice(3);
    if (platformFilter) dramas = dramas.filter(d => d.platform === platformFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      dramas = dramas.filter(d => d.title.toLowerCase().includes(q) || d.genre.toLowerCase().includes(q));
    }
    return dramas;
  }, [snapshot, platformFilter, searchQuery]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasData = snapshot && snapshot.totalEntries > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <DramaSubTabs />
        <div className="flex items-center gap-2">
          {snapshot?.date && (
            <span className="hidden sm:flex text-[11px] text-muted-foreground items-center gap-1">
              <Clock className="h-3 w-3" />{snapshot.date}
            </span>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" disabled={crawling} onClick={handleCrawl}>
            {crawling
              ? <><Loader2 className="h-3 w-3 animate-spin" />爬取中...</>
              : <><RefreshCw className="h-3 w-3" />立即爬取</>}
          </Button>
        </div>
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="p-16 text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-rose-100 to-orange-50 dark:from-rose-900/20 dark:to-orange-900/10 flex items-center justify-center">
              <BarChart3 className="h-8 w-8 text-rose-400" />
            </div>
            <div>
              <p className="text-lg font-semibold">暂无市场数据</p>
              <p className="text-sm text-muted-foreground mt-1">从抖音、酷乐、Kuoapp、红果等平台抓取最新短剧排行</p>
            </div>
            <Button onClick={handleCrawl} disabled={crawling} className="gap-1.5">
              {crawling ? <><Loader2 className="h-4 w-4 animate-spin" />爬取中...</> : <><Zap className="h-4 w-4" />开始爬取</>}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ═══ Left: Leaderboard (2/3) ═══ */}
          <div className="lg:col-span-2 space-y-5">
            {/* Top 3 Podium */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold">热播 Top 3</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {top3.map((d, i) => (
                  <PodiumCard key={d.title} rank={i + 1} {...d} />
                ))}
              </div>
            </div>

            {/* Rest of ranking */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-semibold text-muted-foreground">排行榜</span>
                  {/* Platform pills */}
                  <div className="flex gap-1 flex-wrap">
                    {Object.entries(snapshot!.platforms).map(([p, count]) => (
                      <button
                        key={p}
                        type="button"
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium transition-all',
                          platformFilter === p
                            ? PLATFORM_COLORS[p] ?? 'bg-primary text-primary-foreground'
                            : 'bg-muted/60 text-muted-foreground hover:bg-muted',
                        )}
                        onClick={() => setPlatformFilter(prev => prev === p ? '' : p)}
                      >
                        {PLATFORM_LABELS[p] ?? p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="搜索..."
                    className="h-7 text-xs w-32 pl-7"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="divide-y divide-border/40">
                    {restDramas.map((d, i) => {
                      const globalRank = i + 4;
                      return (
                        <div
                          key={`${d.title}-${i}`}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-muted/20 transition-colors group"
                        >
                          <span className="w-6 text-center text-xs font-bold text-muted-foreground tabular-nums shrink-0">
                            {globalRank}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium truncate">{d.title}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {d.genre && (
                                <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded">
                                  {d.genre}
                                </span>
                              )}
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded', PLATFORM_COLORS[d.platform] ?? 'bg-muted text-muted-foreground')}>
                                {PLATFORM_LABELS[d.platform] ?? d.platform}
                              </span>
                            </div>
                          </div>
                          {/* Hot bar + number */}
                          <div className="flex items-center gap-2 shrink-0">
                            <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-rose-400 to-orange-400"
                                style={{ width: `${Math.min(100, (d.hotScore / (top3[0]?.hotScore || 1)) * 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-semibold text-rose-500 tabular-nums w-12 text-right">
                              {fmtHot(d.hotScore)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                    {restDramas.length === 0 && (
                      <div className="px-4 py-10 text-center text-sm text-muted-foreground">无匹配结果</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ═══ Right: Sidebar (1/3) ═══ */}
          <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
            {/* Genre Heat */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Flame className="h-4 w-4 text-rose-500" />
                  <h2 className="text-sm font-semibold">题材风向</h2>
                  <span className="text-[10px] text-muted-foreground ml-auto">{snapshot!.topGenres.length} 个</span>
                </div>
                <div className="space-y-2.5">
                  {snapshot!.topGenres.map((g, i) => {
                    const maxAvg = snapshot!.topGenres[0]?.avgHotScore || 1;
                    const pct = Math.min(100, (g.avgHotScore / maxAvg) * 100);
                    const barColor = GENRE_BAR_COLORS[i % GENRE_BAR_COLORS.length];
                    return (
                      <button
                        key={g.genre}
                        type="button"
                        className="w-full text-left group/genre"
                        onClick={() => history.push('/novel/create-drama')}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-4 text-right tabular-nums">{i + 1}</span>
                            <span className="text-xs font-medium group-hover/genre:text-primary transition-colors">{g.genre}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">{g.totalEntries}部</span>
                            <span className="text-[10px] font-semibold text-rose-500 tabular-nums">{fmtHot(g.avgHotScore)}</span>
                          </div>
                        </div>
                        <div className="ml-5 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all duration-500', barColor)}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-4 text-xs gap-1 h-8"
                  onClick={() => history.push('/novel/create-drama')}
                >
                  <ExternalLink className="h-3 w-3" />基于热门题材创作
                </Button>
              </CardContent>
            </Card>

            {/* Data Overview */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <h2 className="text-sm font-semibold">数据概览</h2>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-2xl font-bold">{snapshot!.totalEntries}</p>
                    <p className="text-[10px] text-muted-foreground">短剧总数</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-rose-500">
                      {fmtHot(Math.max(...snapshot!.topDramas.map(d => d.hotScore), 0))}
                    </p>
                    <p className="text-[10px] text-muted-foreground">最高热度</p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40">
                  <p className="text-[10px] text-muted-foreground mb-2">平台分布</p>
                  <div className="space-y-1.5">
                    {Object.entries(snapshot!.platforms).map(([p, count]) => {
                      const pct = Math.min(100, (count / snapshot!.totalEntries) * 100);
                      return (
                        <div key={p} className="flex items-center gap-2">
                          <span className="text-[11px] w-12 shrink-0">{PLATFORM_LABELS[p] ?? p}</span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', PLATFORM_COLORS[p]?.split(' ')[0] ?? 'bg-primary')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground tabular-nums w-6 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default MarketInsights;
