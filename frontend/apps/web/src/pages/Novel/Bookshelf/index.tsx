import React, { useCallback, useEffect, useState } from 'react';
import { history } from '@umijs/max';
import { Plus, Loader2, AlertCircle, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listBooks, getAutoSerialization, deleteBook, type BookListItem } from '@/services/novel';
import { listDramas, type DramaListItem } from '@/services/drama';
import emptyImg from '@/assets/illustrations/empty-bookshelf.png';

type ContentType = 'novel' | 'drama';

const DRAMA_GENRE_GRADIENTS: Record<string, string> = {
  '霸总': 'from-amber-500 to-rose-600',
  '甜宠': 'from-pink-400 to-rose-500',
  '战神': 'from-red-600 to-orange-700',
  '穿越': 'from-violet-500 to-purple-700',
  '宫斗': 'from-amber-600 to-red-700',
  '复仇': 'from-zinc-600 to-red-800',
  '重生': 'from-emerald-500 to-teal-700',
  '悬疑': 'from-slate-500 to-zinc-700',
};

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
      'relative rounded-lg overflow-hidden shadow-md',
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

      {/* Delete button — hover only */}
      <button
        className="absolute top-2 left-4 z-30 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-red-500/80 hover:bg-red-600 text-white"
        onClick={(e) => { e.stopPropagation(); onDelete(book); }}
        title="删除书籍"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent z-10">
        <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{book.title}</h3>
      </div>

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/8 transition-colors duration-200" />
    </div>

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

/* ─── DramaCard ─── */
const DramaCard: React.FC<{ drama: DramaListItem }> = ({ drama }) => {
  const gradient = drama.genre && DRAMA_GENRE_GRADIENTS[drama.genre] ? DRAMA_GENRE_GRADIENTS[drama.genre] : 'from-rose-500 to-violet-600';
  return (
    <div className="group cursor-pointer" onClick={() => history.push(`/novel/drama/${drama.id}`)}>
      <div className={cn(
        'relative rounded-lg overflow-hidden shadow-md',
        'group-hover:shadow-xl group-hover:-translate-y-1',
        'transition-all duration-300 aspect-[2/3] bg-gradient-to-br',
        gradient,
      )}>
        <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-black/30 to-transparent z-10" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]" />
        <div className="absolute top-2 left-4 z-20">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
            短剧
          </span>
        </div>
        {drama.genre && (
          <div className="absolute top-2 right-2 z-20">
            <span className="inline-flex rounded-md bg-black/25 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-medium text-white/90">
              {drama.genre}
            </span>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent z-10">
          <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">{drama.title}</h3>
        </div>
      </div>
      <div className="mt-2 px-0.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{drama.episodesGenerated} 集</span>
          {drama.latestOverallScore != null && (
            <span className={cn(
              'text-xs font-semibold tabular-nums',
              drama.latestOverallScore >= 8 ? 'text-emerald-600 dark:text-emerald-400'
                : drama.latestOverallScore >= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500',
            )}>
              ★ {drama.latestOverallScore.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5 truncate">{formatRelativeTime(drama.updatedAt)}</p>
      </div>
    </div>
  );
};

/* ─── CreateCard ─── */
const CreateCard: React.FC<{ type: ContentType }> = ({ type }) => (
  <div className="group cursor-pointer" onClick={() => history.push(type === 'novel' ? '/novel/create' : '/novel/create-drama')}>
    <div className="relative rounded-lg border-2 border-dashed border-muted-foreground/15 group-hover:border-primary/50 group-hover:bg-gradient-to-br group-hover:from-primary/5 group-hover:to-violet-500/5 transition-all duration-300 aspect-[2/3] flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/40 group-hover:bg-primary/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110">
        <Sparkles className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
      </div>
      <span className="text-xs font-medium text-muted-foreground/60 group-hover:text-primary transition-colors">
        {type === 'novel' ? '创建新书' : '创建短剧'}
      </span>
    </div>
  </div>
);

/* ─── Bookshelf ─── */
const Bookshelf: React.FC = () => {
  const [tab, setTab] = useState<ContentType>('novel');
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [dramas, setDramas] = useState<DramaListItem[]>([]);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [bookRes, dramaRes] = await Promise.all([listBooks(), listDramas()]);
      const sorted = [...bookRes.books].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setBooks(sorted);
      setDramas(dramaRes.dramas);
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
  const hasDramas = dramas.length > 0;
  const hasContent = hasBooks || hasDramas;
  const runningCount = Object.values(runningMap).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Empty state */}
      {!hasContent && (
        <div className="animate-fade-in flex flex-col items-center py-16 text-center">
          <img src={emptyImg} alt="" className="w-72 h-auto mb-4 pointer-events-none select-none" draggable={false} />
          <h2 className="text-2xl font-bold mb-2">书架空空，等待你的灵感落笔</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            InkVerse 可以帮你创作小说或短剧，从创意到成品一站式完成。
          </p>
          <div className="flex gap-3">
            <Button size="lg" className="gap-2 shadow-lg shadow-primary/25" onClick={() => history.push('/novel/create')}>
              <Sparkles className="h-4 w-4" />
              开始写小说
            </Button>
            <Button size="lg" variant="outline" className="gap-2" onClick={() => history.push('/novel/create-drama')}>
              <Sparkles className="h-4 w-4" />
              创建短剧
            </Button>
          </div>
        </div>
      )}

      {/* Bookshelf grid */}
      {hasContent && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">我的书架</h2>
              <div className="flex items-center gap-3 mt-2">
                {(['novel', 'drama'] as ContentType[]).map(t => (
                  <button
                    key={t}
                    className={cn(
                      'px-3 py-1 rounded-full text-sm font-medium transition-all',
                      tab === t ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                    onClick={() => setTab(t)}
                  >
                    {t === 'novel' ? `小说 (${books.length})` : `短剧 (${dramas.length})`}
                  </button>
                ))}
                {runningCount > 0 && tab === 'novel' && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    {runningCount} 部更新中
                  </span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              className="gap-1.5 shadow-sm shadow-primary/20"
              onClick={() => history.push(tab === 'novel' ? '/novel/create' : '/novel/create-drama')}
            >
              <Plus className="h-3.5 w-3.5" />
              {tab === 'novel' ? '创建新书' : '创建短剧'}
            </Button>
          </div>

          {tab === 'novel' && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 lg:grid-cols-5 xl:grid-cols-6">
              {books.map(book => (
                <BookCard key={book.bookId} book={book} isRunning={!!runningMap[book.bookId]} onDelete={setDeleteTarget} />
              ))}
              <CreateCard type="novel" />
            </div>
          )}

          {tab === 'drama' && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 lg:grid-cols-5 xl:grid-cols-6">
              {dramas.map(d => <DramaCard key={d.id} drama={d} />)}
              <CreateCard type="drama" />
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
