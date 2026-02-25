import React, { useEffect, useState } from 'react';
import { history } from '@umijs/max';
import {
  Plus,
  Clock,
  Loader2,
  AlertCircle,
  PenTool,
  Sparkles,
  ArrowRight,
  ChevronRight,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { listBooks, type BookListItem } from '@/services/novel';

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

const GENRE_DOT_COLORS: Record<string, string> = {
  '玄幻': 'bg-violet-500',
  '科幻': 'bg-cyan-500',
  '都市': 'bg-orange-500',
  '悬疑': 'bg-slate-500',
  '武侠': 'bg-amber-500',
  '历史': 'bg-yellow-600',
  '仙侠': 'bg-teal-500',
  '末世': 'bg-gray-500',
  '言情': 'bg-pink-500',
  '奇幻': 'bg-purple-500',
  '游戏': 'bg-green-500',
  '军事': 'bg-stone-500',
};

function getBookGradient(genre?: string): string {
  return genre && GENRE_GRADIENTS[genre] ? GENRE_GRADIENTS[genre] : DEFAULT_GRADIENT;
}

function getGenreDot(genre?: string): string {
  return genre && GENRE_DOT_COLORS[genre] ? GENRE_DOT_COLORS[genre] : 'bg-primary';
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

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : score >= 7
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
        : 'bg-red-500/15 text-red-600 dark:text-red-400';
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums', color)}>
      {score.toFixed(1)}
    </span>
  );
}

const Bookshelf: React.FC = () => {
  const [books, setBooks] = useState<BookListItem[]>([]);
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
  const recentBook = hasBooks ? books[0] : null;
  const otherBooks = hasBooks ? books.slice(1) : [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Empty State */}
      {!hasBooks && (
        <div className="animate-fade-in flex flex-col items-center py-24 text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center">
              <PenTool className="h-10 w-10 text-primary" />
            </div>
            <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-3 w-3 text-primary" />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">开始你的创作之旅</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            InkVerse 使用 AI 帮你构建完整的小说世界观，自动生成精彩章节。
            输入你的创意灵感，一切从这里开始。
          </p>
          <Button
            size="lg"
            className="gap-2 shadow-lg shadow-primary/25"
            onClick={() => history.push('/novel/create')}
          >
            <Plus className="h-4 w-4" />
            创建我的第一本书
          </Button>
        </div>
      )}

      {/* Has Books */}
      {hasBooks && recentBook && (
        <div className="animate-fade-in space-y-8">
          {/* Section: Continue Writing */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">继续创作</h2>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => history.push('/novel/create')}
              >
                <Plus className="h-3.5 w-3.5" />
                创建新书
              </Button>
            </div>

            {/* Hero Card — most recently active book */}
            <Card
              className="group cursor-pointer overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-primary/8 hover:border-primary/20"
              onClick={() => history.push(`/novel/book/${recentBook.bookId}`)}
            >
              <div className="flex flex-col sm:flex-row">
                {/* Gradient cover */}
                <div className={cn(
                  'relative h-36 sm:h-auto sm:w-48 bg-gradient-to-br shrink-0 overflow-hidden',
                  getBookGradient(recentBook.genre),
                )}>
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)]" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <BookOpen className="h-12 w-12 text-white/30" />
                  </div>
                  {recentBook.genre && (
                    <div className="absolute top-3 left-3">
                      <span className="inline-flex items-center rounded-md bg-white/20 backdrop-blur-sm px-2 py-0.5 text-xs font-medium text-white">
                        {recentBook.genre}
                      </span>
                    </div>
                  )}
                </div>

                {/* Info */}
                <CardContent className="flex-1 p-5 sm:p-6 flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold tracking-tight mb-2">
                      {recentBook.title}
                    </h3>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>已生成 {recentBook.chaptersGenerated} 章</span>
                      {recentBook.latestKpi && (
                        <>
                          <span className="text-border">|</span>
                          <span className="flex items-center gap-1.5">
                            综合评分 <ScoreBadge score={recentBook.latestKpi.overallScore} />
                          </span>
                        </>
                      )}
                    </div>
                    {recentBook.updatedAt && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground mt-2">
                        <Clock className="h-3 w-3" />
                        上次更新 {formatRelativeTime(recentBook.updatedAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      className="gap-2 shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        history.push(`/novel/book/${recentBook.bookId}`);
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                      继续创作
                    </Button>
                    <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-1">
                      进入工作台 <ArrowRight className="h-3 w-3" />
                    </span>
                  </div>
                </CardContent>
              </div>
            </Card>
          </section>

          {/* Section: Other Books */}
          {otherBooks.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-foreground mb-4">其他作品</h2>
              <div className="space-y-2">
                {otherBooks.map((book) => (
                  <Card
                    key={book.bookId}
                    className="group cursor-pointer transition-all duration-200 hover:border-primary/20 hover:bg-accent/30"
                    onClick={() => history.push(`/novel/book/${book.bookId}`)}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      {/* Genre color indicator */}
                      <div className={cn(
                        'w-1 h-10 rounded-full shrink-0',
                        getGenreDot(book.genre),
                      )} />

                      {/* Book info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate">{book.title}</h3>
                          {book.genre && (
                            <Badge variant="secondary" className="text-[11px] shrink-0">
                              {book.genre}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{book.chaptersGenerated} 章</span>
                          {book.latestKpi && (
                            <>
                              <span className="text-border">·</span>
                              <span>综合 {book.latestKpi.overallScore.toFixed(1)}</span>
                            </>
                          )}
                          {book.updatedAt && (
                            <>
                              <span className="text-border">·</span>
                              <span>{formatRelativeTime(book.updatedAt)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Action */}
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* Create new book footer */}
          <div className="pt-2">
            <button
              className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/15 py-5 text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors group"
              onClick={() => history.push('/novel/create')}
            >
              <Plus className="h-4 w-4" />
              <span className="font-medium">创建新书</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Bookshelf;
