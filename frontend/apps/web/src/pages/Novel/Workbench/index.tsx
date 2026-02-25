import React, { useState, useCallback, useEffect } from 'react';
import { history, useParams } from '@umijs/max';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  FileText,
  Loader2,
  Settings,
  Sparkles,
  Layers,
  Clock,
  BarChart3,
  AlertCircle,
  Globe,
  FileEdit,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  getBook,
  listChapters,
  generateChapter,
  type BookInfo,
  type ChapterItem,
} from '@/services/novel';
import { AutoSerializationPanel } from './AutoSerializationPanel';
import { BatchGenerateDialog } from './BatchGenerateDialog';
import { QualityDashboard } from './QualityDashboard';

const Workbench: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<ChapterItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState('');
  const [showBatchDialog, setShowBatchDialog] = useState(false);
  const [showAutoPanel, setShowAutoPanel] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'chapters' | 'quality'>('chapters');

  const fetchData = useCallback(async () => {
    if (!bookId) return;
    try {
      const [bookInfo, chaptersRes] = await Promise.all([
        getBook(bookId),
        listChapters(bookId),
      ]);
      setBook(bookInfo);
      const sorted = [...chaptersRes.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
      setChapters(sorted);
      if (sorted.length > 0 && !selectedChapter) {
        setSelectedChapter(sorted[sorted.length - 1]);
      }
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerate = useCallback(async () => {
    if (!bookId) return;
    setGenerating(true);
    setGenProgress(0);
    setGenStep('');

    const proxyBase = '/api/novel';
    const url = `${proxyBase}/books/${bookId}/chapters/generate-sse`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.totalSteps > 0) {
          setGenProgress(Math.round(((data.stepIndex + (data.done ? 1 : 0.5)) / data.totalSteps) * 100));
        }
        setGenStep(data.message ?? '');
        if (data.done) {
          es.close();
          (async () => {
            const [bookInfo, chaptersRes] = await Promise.all([
              getBook(bookId),
              listChapters(bookId),
            ]);
            setBook(bookInfo);
            const sorted = [...chaptersRes.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
            setChapters(sorted);
            if (data.chapterNumber) {
              const newCh = sorted.find((ch: any) => ch.chapterNumber === data.chapterNumber);
              if (newCh) setSelectedChapter(newCh);
            }
            setGenerating(false);
            setGenProgress(0);
            setGenStep('');
          })();
        }
        if (data.error) {
          es.close();
          setGenerating(false);
          setGenProgress(0);
          setGenStep('');
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      (async () => {
        try {
          const result = await generateChapter(bookId);
          const [bookInfo, chaptersRes] = await Promise.all([
            getBook(bookId),
            listChapters(bookId),
          ]);
          setBook(bookInfo);
          const sorted = [...chaptersRes.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
          setChapters(sorted);
          const newChapter = sorted.find((ch) => ch.chapterNumber === result.chapterNumber);
          if (newChapter) setSelectedChapter(newChapter);
        } catch {}
        setGenerating(false);
        setGenProgress(0);
        setGenStep('');
      })();
    };
  }, [bookId]);

  const handleBatchDone = useCallback(() => {
    setShowBatchDialog(false);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error ?? '书籍不存在'}</p>
        <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Sidebar */}
      <div className="flex w-80 flex-col border-r bg-card">
        {/* Book Header */}
        <div className="border-b p-4">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => history.push('/novel')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="font-semibold truncate">《{book.title}》</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {book.genre && <Badge variant="secondary" className="text-xs">{book.genre}</Badge>}
            <span>{book.chaptersGenerated} 章</span>
            {book.latestKpi && (
              <>
                <span>·</span>
                <span className="text-emerald-600 font-medium">
                  综合 {book.latestKpi.overallScore.toFixed(1)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Sidebar Tabs */}
        <Tabs
          value={sidebarTab}
          onValueChange={(v) => setSidebarTab(v as 'chapters' | 'quality')}
          className="flex-1 flex flex-col"
        >
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2">
            <TabsTrigger value="chapters" className="gap-1 text-xs">
              <FileText className="h-3.5 w-3.5" />
              章节
            </TabsTrigger>
            <TabsTrigger value="quality" className="gap-1 text-xs">
              <BarChart3 className="h-3.5 w-3.5" />
              质量
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chapters" className="flex-1 mt-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-2">
                {chapters.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground text-sm gap-2">
                    <BookOpen className="h-8 w-8 opacity-30" />
                    <p>还没有章节</p>
                    <p className="text-xs">点击下方按钮开始生成</p>
                  </div>
                ) : (
                  [...chapters].reverse().map((ch) => (
                    <button
                      key={ch.chapterNumber}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent',
                        selectedChapter?.chapterNumber === ch.chapterNumber && 'bg-accent',
                      )}
                      onClick={() => setSelectedChapter(ch)}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">
                        {ch.chapterNumber}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{ch.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(ch.createdAt).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="quality" className="flex-1 mt-0 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="p-4">
                <QualityDashboard latestKpi={book.latestKpi} />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Sidebar Footer Actions */}
        <div className="border-t p-3 space-y-2">
          <Button
            className="w-full gap-2"
            disabled={generating}
            onClick={handleGenerate}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                生成下一章
              </>
            )}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => setShowBatchDialog(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              批量
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => setShowAutoPanel(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              连载
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => history.push(`/novel/book/${bookId}/world`)}
            >
              <Globe className="h-3.5 w-3.5" />
              世界观
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1"
              onClick={() => history.push(`/novel/book/${bookId}/profile`)}
            >
              <FileEdit className="h-3.5 w-3.5" />
              手册
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedChapter ? (
          <>
            {/* Chapter Header */}
            <div className="flex items-center justify-between border-b px-8 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <BookOpen className="h-4 w-4" />
                  第 {selectedChapter.chapterNumber} 章
                </div>
                <h1 className="text-xl font-bold">{selectedChapter.title}</h1>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(selectedChapter.createdAt).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </div>
                <span>约 {selectedChapter.content.length} 字</span>
              </div>
            </div>

            {/* Chapter Content */}
            <ScrollArea className="flex-1">
              <article className="mx-auto max-w-2xl px-8 py-8">
                <div className="prose prose-lg prose-neutral max-w-none">
                  {selectedChapter.content.split('\n\n').map((paragraph, i) => (
                    <p
                      key={i}
                      className="text-base leading-8 text-foreground/90 indent-8 mb-4"
                      style={{ fontFamily: '"Noto Serif SC", Georgia, serif' }}
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </article>
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-3">
              <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/30" />
              <p className="text-muted-foreground">选择一个章节开始阅读</p>
              <p className="text-sm text-muted-foreground">
                或者点击「生成下一章」创作新内容
              </p>
            </div>
          </div>
        )}

        {/* Generation Progress Bar */}
        {generating && (
          <div className="border-t bg-card px-8 py-4">
            <div className="flex items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>正在生成第 {book.chaptersGenerated + 1} 章...</span>
                  <span className="text-muted-foreground">{genStep || 'AI 创作中'}</span>
                </div>
                <Progress value={genProgress} className="h-1.5" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs & Panels */}
      <BatchGenerateDialog
        open={showBatchDialog}
        onOpenChange={setShowBatchDialog}
        bookId={bookId!}
        onDone={handleBatchDone}
      />
      <AutoSerializationPanel
        open={showAutoPanel}
        onOpenChange={setShowAutoPanel}
        bookId={bookId!}
      />
    </div>
  );
};

export default Workbench;
