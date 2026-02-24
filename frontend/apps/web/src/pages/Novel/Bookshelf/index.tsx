import React, { useEffect, useState } from 'react';
import { history } from '@umijs/max';
import {
  Plus,
  BookOpen,
  TrendingUp,
  Clock,
  Sparkles,
  MoreVertical,
  Zap,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { listBooks, type BookListItem } from '@/services/novel';

function ScoreIndicator({ score }: { score: number }) {
  const color =
    score >= 8
      ? 'text-emerald-600'
      : score >= 7
        ? 'text-amber-600'
        : 'text-red-500';
  return <span className={`font-semibold tabular-nums ${color}`}>{score.toFixed(1)}</span>;
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

const Bookshelf: React.FC = () => {
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await listBooks();
        setBooks(res.books);
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Hero Section */}
      <div className="mb-10">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">我的书架</h1>
            <p className="mt-2 text-muted-foreground">
              管理你的所有 AI 小说创作项目
            </p>
          </div>
          <Button
            size="lg"
            className="gap-2 shadow-lg shadow-primary/25"
            onClick={() => history.push('/novel/create')}
          >
            <Plus className="h-4 w-4" />
            创建新书
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{books.length}</p>
              <p className="text-xs text-muted-foreground">作品总数</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {books.reduce((s, b) => s + b.chaptersGenerated, 0)}
              </p>
              <p className="text-xs text-muted-foreground">总章节数</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
              <Zap className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {books.filter((b) => b.latestKpi !== null).length}
              </p>
              <p className="text-xs text-muted-foreground">已评分</p>
            </div>
          </div>
        </div>
      </div>

      {/* Book Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {books.map((book) => (
          <Card
            key={book.bookId}
            className="group cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
            onClick={() => history.push(`/novel/book/${book.bookId}`)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg truncate">{book.title}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    {book.genre && (
                      <Badge variant="secondary" className="text-xs">
                        {book.genre}
                      </Badge>
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">已生成章节</span>
                  <span className="font-medium">{book.chaptersGenerated} 章</span>
                </div>

                {book.latestKpi && (
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">质量</span>
                      <ScoreIndicator score={book.latestKpi.qualityScore} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">综合</span>
                      <ScoreIndicator score={book.latestKpi.overallScore} />
                    </div>
                  </div>
                )}

                {book.updatedAt && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(book.updatedAt)}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {/* Create New Book Card */}
        <Card
          className="flex cursor-pointer items-center justify-center border-dashed transition-all hover:border-primary/50 hover:bg-accent/50 min-h-[200px]"
          onClick={() => history.push('/novel/create')}
        >
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30">
              <Plus className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium">创建新书</span>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Bookshelf;
