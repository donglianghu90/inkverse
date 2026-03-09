import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { history } from '@umijs/max';
import {
  Plus, Loader2, AlertCircle, Sparkles, Trash2,
  Search, SlidersHorizontal, ArrowUpDown, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listBooks, getAutoSerialization, deleteBook, type BookListItem } from '@/services/novel';
import emptyImg from '@/assets/illustrations/empty-bookshelf.png';

const GENRE_GRADIENTS: Record<string, string> = {
  '仙侠': 'from-teal-400 to-emerald-600',
  '玄幻': 'from-violet-500 to-indigo-600',
  '都市现实': 'from-orange-400 to-rose-500',
  '历史': 'from-yellow-600 to-amber-800',
  '西方奇幻': 'from-purple-500 to-fuchsia-600',
  '科幻': 'from-cyan-500 to-blue-600',
  '武侠': 'from-amber-500 to-red-600',
  '战争/军事': 'from-stone-500 to-green-800',
  '悬疑推理': 'from-slate-500 to-zinc-700',
  '无限流': 'from-fuchsia-500 to-purple-700',
  '轻小说': 'from-pink-300 to-rose-400',
  '末世危机': 'from-stone-600 to-zinc-800',
  '悬疑惊悚': 'from-zinc-700 to-neutral-900',
  '恐怖/规则怪谈': 'from-gray-600 to-red-900',
  '灵异/民俗': 'from-indigo-400 to-purple-800',
  '冒险/探险': 'from-teal-400 to-cyan-600',
  '电子竞技': 'from-blue-400 to-indigo-500',
  '虚拟网游': 'from-emerald-400 to-teal-600',
  '体育竞技': 'from-lime-500 to-green-600',
  '超能力/异能': 'from-blue-500 to-violet-600',
  '史诗/传奇': 'from-rose-600 to-amber-700',
  '现代言情': 'from-rose-400 to-pink-600',
  '古代言情': 'from-red-400 to-rose-600',
  '幻想言情': 'from-fuchsia-400 to-pink-600',
  '儿童/少儿文学': 'from-sky-400 to-indigo-400',
};
const DEFAULT_GRADIENT = 'from-primary to-primary/70';

function getBookGradient(genre?: string): string {
  return genre && GENRE_GRADIENTS[genre] ? GENRE_GRADIENTS[genre] : DEFAULT_GRADIENT;
}

function formatRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(isoStr).toLocaleDateString('zh-CN');
}

type SortKey = 'updatedAt' | 'score' | 'chapters';

/* ─── BookCard ─── */
const BookCard: React.FC<{
  book: BookListItem;
  isRunning: boolean;
  onDelete: (book: BookListItem) => void;
}> = ({ book, isRunning, onDelete }) => (
  <div
    className="group cursor-pointer"
    onClick={() => history.push(`/novel/book/${book.bookId}`)}
  >
    <div className={cn(
      'relative rounded-xl overflow-hidden shadow-md',
      'group-hover:shadow-xl group-hover:-translate-y-1',
      'transition-all duration-300 aspect-[2/3] bg-gradient-to-br',
      getBookGradient(book.genre),
    )}>
      <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/30 to-transparent z-10" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]" />

      {isRunning && (
        <div className="absolute top-2 left-4 z-20">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            更新中
          </span>
        </div>
      )}

      {book.genre && (
        <div className="absolute top-2 right-2 z-20">
          <span className="inline-flex rounded-md bg-black/25 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-medium text-white/90">
            {book.genre}
          </span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent z-10">
        <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{book.title}</h3>
        {book.mainIdea && (
          <p className="text-[10px] text-white/60 leading-snug line-clamp-2 mt-1">{book.mainIdea}</p>
        )}
      </div>

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/8 transition-colors duration-200" />
    </div>

    <div className="mt-2 px-0.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted-foreground">{book.chaptersGenerated} 章</span>
        <div className="flex items-center gap-1">
          {book.latestKpi && (
            <span className={cn(
              'text-xs font-semibold tabular-nums',
              book.latestKpi.overallScore >= 8
                ? 'text-emerald-600 dark:text-emerald-400'
                : book.latestKpi.overallScore >= 7
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-500',
            )}>
              ★ {book.latestKpi.overallScore.toFixed(1)}
            </span>
          )}
          <button
            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(book); }}
            title="删除书籍"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
        {formatRelativeTime(book.updatedAt)}
      </p>
    </div>
  </div>
);

/* ─── CreateCard ─── */
const CreateCard: React.FC = () => (
  <div className="group cursor-pointer" onClick={() => history.push('/novel/create')}>
    <div className="relative rounded-xl border-2 border-dashed border-muted-foreground/15 group-hover:border-primary/50 group-hover:bg-gradient-to-br group-hover:from-primary/5 group-hover:to-violet-500/5 transition-all duration-300 aspect-[2/3] flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/40 group-hover:bg-primary/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110">
        <Sparkles className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
      </div>
      <span className="text-xs font-medium text-muted-foreground/60 group-hover:text-primary transition-colors">
        创建新书
      </span>
    </div>
  </div>
);

/* ─── Bookshelf (novels only) ─── */
const Bookshelf: React.FC = () => {
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [filterGenre, setFilterGenre] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const bookRes = await listBooks();
      const sorted = [...bookRes.books].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setBooks(sorted);
      const results = await Promise.allSettled(sorted.map(b => getAutoSerialization(b.bookId)));
      const map: Record<string, boolean> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value?.scheduler?.running) map[sorted[i].bookId] = true;
      });
      setRunningMap(map);
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const genres = useMemo(() => {
    const set = new Set<string>();
    books.forEach(b => { if (b.genre) set.add(b.genre); });
    return Array.from(set).sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    let result = [...books];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.mainIdea ?? '').toLowerCase().includes(q) ||
        (b.genre ?? '').toLowerCase().includes(q),
      );
    }

    if (filterGenre) {
      result = result.filter(b => b.genre === filterGenre);
    }

    result.sort((a, b) => {
      switch (sortKey) {
        case 'score': {
          const sa = a.latestKpi?.overallScore ?? 0;
          const sb = b.latestKpi?.overallScore ?? 0;
          return sb - sa;
        }
        case 'chapters':
          return b.chaptersGenerated - a.chaptersGenerated;
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

    return result;
  }, [books, searchQuery, filterGenre, sortKey]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBook(deleteTarget.bookId);
      setBooks((prev) => prev.filter((b) => b.bookId !== deleteTarget.bookId));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message ?? '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>重试</Button>
      </div>
    );
  }

  const hasBooks = books.length > 0;
  const runningCount = Object.values(runningMap).filter(Boolean).length;
  const totalChapters = books.reduce((sum, b) => sum + b.chaptersGenerated, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Empty state */}
      {!hasBooks && (
        <div className="animate-fade-in flex flex-col items-center py-16 text-center">
          <img src={emptyImg} alt="" className="w-72 h-auto mb-4 pointer-events-none select-none" draggable={false} />
          <h2 className="text-2xl font-bold mb-2">书架空空，等待你的灵感落笔</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            InkVerse 可以帮你从一个创意出发，生成完整的世界观和持续更新的章节。
          </p>
          <Button size="lg" className="gap-2 shadow-lg shadow-primary/25" onClick={() => history.push('/novel/create')}>
            <Sparkles className="h-4 w-4" />
            开始写小说
          </Button>
        </div>
      )}

      {/* Bookshelf grid */}
      {hasBooks && (
        <div className="animate-fade-in">
          {/* Header with stats */}
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight">我的书架</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span>{books.length} 部小说</span>
                <span className="text-muted-foreground/30">·</span>
                <span>共 {totalChapters} 章</span>
                {runningCount > 0 && (
                  <>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                      {runningCount} 部更新中
                    </span>
                  </>
                )}
              </div>
            </div>
            <Button
              size="sm"
              className="gap-1.5 shadow-sm shadow-primary/20"
              onClick={() => history.push('/novel/create')}
            >
              <Plus className="h-3.5 w-3.5" />
              创建新书
            </Button>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input
                placeholder="搜索书名、创意或题材..."
                className="pl-8 h-8 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant={showFilters ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => setShowFilters(v => !v)}
              >
                <SlidersHorizontal className="h-3 w-3" />
                筛选
                {filterGenre && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-primary" />}
              </Button>
              <div className="flex items-center gap-0.5 rounded-md border bg-background">
                {([
                  { key: 'updatedAt' as SortKey, label: '最近更新' },
                  { key: 'score' as SortKey, label: '评分' },
                  { key: 'chapters' as SortKey, label: '章数' },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    className={cn(
                      'px-2 py-1 text-[11px] font-medium rounded-[5px] transition-all',
                      sortKey === opt.key
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setSortKey(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Genre Filter Chips */}
          {showFilters && genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5 animate-fade-in">
              <Badge
                variant={filterGenre === null ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => setFilterGenre(null)}
              >
                全部
              </Badge>
              {genres.map(g => (
                <Badge
                  key={g}
                  variant={filterGenre === g ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setFilterGenre(filterGenre === g ? null : g)}
                >
                  {g}
                </Badge>
              ))}
            </div>
          )}

          {/* Results count when filtered */}
          {(searchQuery || filterGenre) && (
            <p className="text-xs text-muted-foreground mb-3">
              找到 {filteredBooks.length} 部小说
              {filterGenre && <span> · 题材「{filterGenre}」</span>}
              {searchQuery && <span> · 关键词「{searchQuery}」</span>}
            </p>
          )}

          {filteredBooks.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
              <Search className="h-10 w-10 mb-3 opacity-30" />
              <p className="font-medium">没有匹配的小说</p>
              <p className="text-sm mt-1">试试调整搜索词或筛选条件</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 lg:grid-cols-5 xl:grid-cols-6">
              {filteredBooks.map(book => (
                <BookCard key={book.bookId} book={book} isRunning={!!runningMap[book.bookId]} onDelete={setDeleteTarget} />
              ))}
              {!searchQuery && !filterGenre && <CreateCard />}
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              即将永久删除《{deleteTarget?.title}》及其全部章节、世界观、执行记录等数据，此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Bookshelf;
