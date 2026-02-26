import React, { useEffect, useState } from 'react';
import { history } from '@umijs/max';
import { Plus, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { listBooks, getAutoSerialization, type BookListItem } from '@/services/novel';
import emptyImg from '@/assets/illustrations/empty-bookshelf.png';

const GENRE_GRADIENTS: Record<string, string> = {
  '玄幻': 'from-violet-500 to-indigo-600',
  '科幻': 'from-cyan-500 to-blue-600',
  '都市': 'from-orange-400 to-rose-500',
  '悬疑': 'from-slate-500 to-zinc-700',
  '武侠': 'from-amber-500 to-red-600',
  '历史': 'from-yellow-600 to-amber-800',
  '仙侠': 'from-teal-400 to-emerald-600',
  '末世': 'from-gray-500 to-red-800',
  '言情': 'from-pink-400 to-rose-500',
  '奇幻': 'from-purple-500 to-fuchsia-600',
  '游戏': 'from-green-500 to-emerald-600',
  '军事': 'from-stone-500 to-slate-700',
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

/* ─── BookCard ─── */
const BookCard: React.FC<{ book: BookListItem; isRunning: boolean }> = ({ book, isRunning }) => (
  <div
    className="group cursor-pointer"
    onClick={() => history.push(`/novel/book/${book.bookId}`)}
  >
    {/* Cover — 2:3 book proportion */}
    <div className={cn(
      'relative rounded-lg overflow-hidden shadow-md',
      'group-hover:shadow-xl group-hover:-translate-y-1',
      'transition-all duration-300 aspect-[2/3] bg-gradient-to-br',
      getBookGradient(book.genre),
    )}>
      {/* Book spine shadow */}
      <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/30 to-transparent z-10" />
      {/* Light sheen */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]" />

      {/* Running badge */}
      {isRunning && (
        <div className="absolute top-2 left-4 z-20">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            更新中
          </span>
        </div>
      )}

      {/* Genre tag */}
      {book.genre && (
        <div className="absolute top-2 right-2 z-20">
          <span className="inline-flex rounded-md bg-black/25 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-medium text-white/90">
            {book.genre}
          </span>
        </div>
      )}

      {/* Title overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent z-10">
        <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{book.title}</h3>
      </div>

      {/* Hover dim */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/8 transition-colors duration-200" />
    </div>

    {/* Meta below cover */}
    <div className="mt-2 px-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{book.chaptersGenerated} 章</span>
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
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">
        {formatRelativeTime(book.updatedAt)}
      </p>
    </div>
  </div>
);

/* ─── CreateBookCard ─── */
const CreateBookCard: React.FC = () => (
  <div className="group cursor-pointer" onClick={() => history.push('/novel/create')}>
    <div className="relative rounded-lg border-2 border-dashed border-muted-foreground/15 group-hover:border-primary/50 group-hover:bg-gradient-to-br group-hover:from-primary/5 group-hover:to-violet-500/5 transition-all duration-300 aspect-[2/3] flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/40 group-hover:bg-primary/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110">
        <Sparkles className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
      </div>
      <span className="text-xs font-medium text-muted-foreground/60 group-hover:text-primary transition-colors">
        创建新书
      </span>
    </div>
  </div>
);

/* ─── Bookshelf ─── */
const Bookshelf: React.FC = () => {
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await listBooks();
        const sorted = [...res.books].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        setBooks(sorted);

        // Fetch auto-serialization running status for all books in parallel
        const results = await Promise.allSettled(sorted.map(b => getAutoSerialization(b.bookId)));
        const map: Record<string, boolean> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value?.scheduler?.running) {
            map[sorted[i].bookId] = true;
          }
        });
        setRunningMap(map);
      } catch (e: any) {
        setError(e?.message ?? '加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Empty state */}
      {!hasBooks && (
        <div className="animate-fade-in flex flex-col items-center py-16 text-center">
          <img src={emptyImg} alt="" className="w-72 h-auto mb-4 pointer-events-none select-none" draggable={false} />
          <h2 className="text-2xl font-bold mb-2">书架空空，等待你的灵感落笔</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            InkVerse 会帮你构建完整世界观、生成专属写作手册，然后自动续写每一章精彩故事。
          </p>
          <Button
            size="lg"
            className="gap-2 shadow-lg shadow-primary/25"
            onClick={() => history.push('/novel/create')}
          >
            <Sparkles className="h-4 w-4" />
            开始我的第一本书
          </Button>
        </div>
      )}

      {/* Bookshelf grid */}
      {hasBooks && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">我的书架</h2>
              <p className="text-sm text-muted-foreground mt-1">
                共 {books.length} 部作品
                {runningCount > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    {runningCount} 部更新中
                  </span>
                )}
              </p>
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

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 lg:grid-cols-5 xl:grid-cols-6">
            {books.map(book => (
              <BookCard key={book.bookId} book={book} isRunning={!!runningMap[book.bookId]} />
            ))}
            <CreateBookCard />
          </div>
        </div>
      )}
    </div>
  );
};

export default Bookshelf;
