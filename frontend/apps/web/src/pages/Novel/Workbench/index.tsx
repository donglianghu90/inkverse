import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { history, useParams } from '@umijs/max';
import { message } from 'antd';
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
  Workflow,
  Pencil,
  Save,
  X,
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
  updateChapter,
  type BookInfo,
  type ChapterItem,
} from '@/services/novel';
import { AutoSerializationPanel } from './AutoSerializationPanel';
import { BatchGenerateDialog } from './BatchGenerateDialog';
import { QualityDashboard } from './QualityDashboard';

const SERIF_FONT = '"Noto Serif SC", "Source Han Serif SC", Georgia, "Times New Roman", serif';
const P_CLASS = 'text-[15px] leading-[2] text-foreground/85 indent-[2em] mb-5 tracking-wide';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function contentToHtml(content: string): string {
  if (!content.trim()) {
    return `<p class="${P_CLASS}" style="font-family:${SERIF_FONT}"><br></p>`;
  }
  return content
    .split('\n\n')
    .filter((p) => p.trim())
    .map((p) => {
      const inner = escapeHtml(p.trim()).replace(/\n/g, '<br>');
      return `<p class="${P_CLASS}" style="font-family:${SERIF_FONT}">${inner}</p>`;
    })
    .join('');
}

function extractTextFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  if (el.tagName === 'BR') return '\n';
  return Array.from(el.childNodes).map(extractTextFromNode).join('');
}

function extractContentFromEl(root: HTMLElement): string {
  const paragraphs: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    const text = extractTextFromNode(node).trim();
    if (text) paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

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
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCharCount, setEditCharCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);
  const articleRef = useRef<HTMLDivElement>(null);

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

  const handleStartEdit = useCallback(() => {
    if (!selectedChapter) return;
    setEditTitle(selectedChapter.title);
    setEditCharCount(selectedChapter.content.length);
    setIsEditing(true);
    requestAnimationFrame(() => articleRef.current?.focus());
  }, [selectedChapter]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setContentVersion((v) => v + 1);
  }, []);

  const handleContentInput = useCallback(() => {
    if (!articleRef.current) return;
    setEditCharCount(extractContentFromEl(articleRef.current).length);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!bookId || !selectedChapter || !articleRef.current) return;
    const newContent = extractContentFromEl(articleRef.current);
    const titleChanged = editTitle !== selectedChapter.title;
    const contentChanged = newContent !== selectedChapter.content;
    if (!titleChanged && !contentChanged) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateChapter(bookId, selectedChapter.chapterNumber, {
        ...(titleChanged ? { title: editTitle } : {}),
        ...(contentChanged ? { content: newContent } : {}),
      });
      setSelectedChapter(updated);
      setChapters((prev) =>
        prev.map((ch) =>
          ch.chapterNumber === updated.chapterNumber ? updated : ch,
        ),
      );
      setIsEditing(false);
      setContentVersion((v) => v + 1);
      message.success('保存成功');
    } catch (e: any) {
      message.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  }, [bookId, selectedChapter, editTitle]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveEdit();
      }
      if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  const handleChapterSelect = useCallback(
    (ch: ChapterItem) => {
      if (isEditing && articleRef.current) {
        const currentContent = extractContentFromEl(articleRef.current);
        const hasChanges =
          editTitle !== selectedChapter?.title || currentContent !== selectedChapter?.content;
        if (hasChanges && !window.confirm('当前修改尚未保存，确定要切换章节吗？')) return;
        setIsEditing(false);
        setContentVersion((v) => v + 1);
      }
      setSelectedChapter(ch);
    },
    [isEditing, editTitle, selectedChapter],
  );

  const articleHtml = useMemo(
    () => (selectedChapter ? contentToHtml(selectedChapter.content) : ''),
    [selectedChapter?.content, selectedChapter?.chapterNumber, contentVersion],
  );

  const arcProgressText = useMemo(() => {
    if (!book?.currentArc) return '';
    const arc = book.currentArc;
    const currentWrittenChapter = Math.max(0, book.chapterCursor - 1);
    const total = Math.max(1, arc.plannedEndChapter - arc.startChapter + 1);
    const done = Math.min(
      total,
      Math.max(0, currentWrittenChapter - arc.startChapter + 1),
    );
    return `${arc.arcTitle}（${arc.startChapter}-${arc.plannedEndChapter}，${done}/${total}章）`;
  }, [book]);

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
      <div className="flex w-80 flex-col border-r bg-card/50">
        {/* Book Header */}
        <div className="border-b p-4 bg-card">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => history.push('/novel')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="font-semibold truncate text-sm">《{book.title}》</h2>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground ml-9">
            {book.genre && <Badge variant="secondary" className="text-xs">{book.genre}</Badge>}
            <span>{book.chaptersGenerated} 章</span>
            {book.currentArc && (
              <>
                <span>·</span>
                <span className="truncate max-w-[150px]" title={arcProgressText}>
                  当前卷 {arcProgressText}
                </span>
              </>
            )}
            {book.latestKpi && (
              <>
                <span>·</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
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
          className="flex-1 flex flex-col min-h-0"
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
              <div className="p-2 space-y-0.5">
                {chapters.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground text-sm gap-2">
                    <BookOpen className="h-8 w-8 opacity-30" />
                    <p>还没有章节</p>
                    <p className="text-xs">点击下方按钮开始生成</p>
                  </div>
                ) : (
                  [...chapters].reverse().map((ch) => {
                    const isActive = selectedChapter?.chapterNumber === ch.chapterNumber;
                    return (
                      <button
                        key={ch.chapterNumber}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all',
                          isActive
                            ? 'bg-primary/8 text-primary ring-1 ring-primary/15'
                            : 'hover:bg-accent',
                        )}
                        onClick={() => handleChapterSelect(ch)}
                      >
                        <span className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {ch.chapterNumber}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate', isActive ? 'font-semibold' : 'font-medium')}>
                            {ch.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {new Date(ch.createdAt).toLocaleDateString('zh-CN')}
                          </p>
                        </div>
                        <ChevronRight className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-primary/50' : 'text-muted-foreground/30',
                        )} />
                      </button>
                    );
                  })
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
        <div className="border-t p-3 space-y-2.5 bg-card">
          <Button
            className="w-full gap-2 shadow-sm shadow-primary/15"
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
          <div className="grid grid-cols-3 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-8"
              onClick={() => setShowBatchDialog(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              批量
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-8"
              onClick={() => setShowAutoPanel(true)}
            >
              <Settings className="h-3.5 w-3.5" />
              连载
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs h-8"
              onClick={() => history.push(`/novel/book/${bookId}/pipeline`)}
            >
              <Workflow className="h-3.5 w-3.5" />
              工作流
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
              onClick={() => history.push(`/novel/book/${bookId}/world`)}
            >
              <Globe className="h-3.5 w-3.5" />
              世界观百科
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
              onClick={() => history.push(`/novel/book/${bookId}/profile`)}
            >
              <FileEdit className="h-3.5 w-3.5" />
              写作手册
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        {selectedChapter ? (
          <>
            {/* Chapter Header */}
            <div className="flex items-center justify-between border-b px-8 py-4 bg-card/30">
              <div className="min-w-0 flex-1 mr-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">
                  <BookOpen className="h-3.5 w-3.5" />
                  第 {selectedChapter.chapterNumber} 章
                </div>
                {isEditing ? (
                  <input
                    className="w-full text-xl font-bold tracking-tight bg-transparent border-b-2 border-primary/30 focus:border-primary outline-none py-0.5 transition-colors"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="章节标题"
                  />
                ) : (
                  <h1 className="text-xl font-bold tracking-tight">{selectedChapter.title}</h1>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {isEditing ? (
                  <>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {editCharCount} 字
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                      onClick={handleCancelEdit}
                      disabled={saving}
                    >
                      <X className="h-4 w-4" />
                      取消
                    </Button>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={handleSaveEdit}
                      disabled={saving}
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {saving ? '保存中...' : '保存'}
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(selectedChapter.createdAt).toLocaleDateString('zh-CN', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </div>
                      <div className="w-px h-3 bg-border" />
                      <span>约 {selectedChapter.content.length} 字</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 ml-2"
                      onClick={handleStartEdit}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Chapter Content — read & edit share the same styled article */}
            <ScrollArea className="flex-1">
              <article
                key={`${selectedChapter.chapterNumber}-${contentVersion}`}
                ref={articleRef}
                className={cn(
                  'mx-auto max-w-2xl px-8 py-10 outline-none transition-shadow rounded-lg',
                  isEditing && 'ring-1 ring-primary/10 bg-card/30 cursor-text',
                )}
                contentEditable={isEditing}
                suppressContentEditableWarning
                onInput={isEditing ? handleContentInput : undefined}
                onPaste={isEditing ? handlePaste : undefined}
                onKeyDown={isEditing ? handleEditKeyDown : undefined}
                dangerouslySetInnerHTML={{ __html: articleHtml }}
              />
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
                <BookOpen className="h-8 w-8 text-muted-foreground/30" />
              </div>
              <p className="text-muted-foreground font-medium">选择一个章节开始阅读</p>
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">正在生成第 {book.chaptersGenerated + 1} 章</span>
                  <span className="text-xs text-muted-foreground">{genStep || 'AI 创作中'}</span>
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
