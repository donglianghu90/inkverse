import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { history, useLocation, useParams } from '@umijs/max';
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
  Trash2,
} from 'lucide-react';
import emptyBookshelfImg from '@/assets/illustrations/empty-bookshelf.png';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  getBook,
  listChapters,
  getAutoSerialization,
  getBookTokenUsage,
  getGenerationStatus,
  getGenerateSSEUrl,
  updateChapter,
  deleteChapter,
  type BookInfo,
  type BookTokenUsage,
  type ChapterItem,
} from '@/services/novel';
import { AutoSerializationPanel } from './AutoSerializationPanel';
import { BatchGenerateDialog } from './BatchGenerateDialog';
import { QualityDashboard } from './QualityDashboard';

const SERIF_FONT = '"Noto Serif SC", "Source Han Serif SC", Georgia, "Times New Roman", serif';
const P_CLASS = 'text-[15px] leading-[1.9] text-foreground/85 indent-[2em] mb-4 tracking-wide';

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff <= 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff}天前`;
  if (diff < 30) return `${Math.floor(diff / 7)}周前`;
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
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
  const location = useLocation();
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
  const [interventionAlert, setInterventionAlert] = useState<{
    reason: string | null;
    failingChapterNumber: number | null;
    consecutiveLowQualityRuns: number;
    threshold: number;
  } | null>(null);
  const [interventionMarkerChapters, setInterventionMarkerChapters] = useState<number[]>([]);
  const [tokenUsage, setTokenUsage] = useState<BookTokenUsage | null>(null);
  const [deleteChapterTarget, setDeleteChapterTarget] = useState<ChapterItem | null>(null);
  const [deletingChapter, setDeletingChapter] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const workbenchPath = bookId ? `/novel/book/${bookId}` : '';

  const disconnectSSE = useCallback((clearState = false) => {
    esRef.current?.close();
    esRef.current = null;
    if (!clearState) return;
    setGenerating(false);
    setGenProgress(0);
    setGenStep('');
  }, []);

  const connectSSE = useCallback((bookIdVal: string, baselineChapterCount: number) => {
    const url = getGenerateSSEUrl(bookIdVal);
    disconnectSSE();
    const es = new EventSource(url);
    esRef.current = es;

    let settled = false;
    const STALE_MS = 600_000;
    let staleTimer: ReturnType<typeof setTimeout>;

    const loadTokenUsageWithRetry = async (preferChapterNumber?: number): Promise<BookTokenUsage | null> => {
      let usage = await getBookTokenUsage(bookIdVal).catch(() => null);
      if (!preferChapterNumber) return usage;
      const hasPreferred = !!usage?.chapters?.some((c) => c.chapterNumber === preferChapterNumber);
      if (hasPreferred) return usage;
      for (let i = 0; i < 4; i += 1) {
        await new Promise((r) => setTimeout(r, 600));
        usage = await getBookTokenUsage(bookIdVal).catch(() => usage);
        if (usage?.chapters?.some((c) => c.chapterNumber === preferChapterNumber)) return usage;
      }
      return usage;
    };

    const syncLatestData = async (preferChapterNumber?: number) => {
      const [bookInfo, chaptersRes] = await Promise.all([
        getBook(bookIdVal),
        listChapters(bookIdVal),
      ]);
      const usage = await loadTokenUsageWithRetry(preferChapterNumber);
      setBook(bookInfo);
      setTokenUsage(usage);
      const sorted = [...chaptersRes.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
      setChapters(sorted);
      if (preferChapterNumber) {
        const preferred = sorted.find((ch) => ch.chapterNumber === preferChapterNumber);
        if (preferred) { setSelectedChapter(preferred); return; }
      }
      if (sorted.length > 0) setSelectedChapter(sorted[sorted.length - 1]);
    };

    const recover = async () => {
      setGenStep('连接中断，正在确认生成结果...');
      let confirmed = false;
      for (let i = 0; i < 10; i += 1) {
        try {
          const latestBook = await getBook(bookIdVal);
          if (latestBook.chaptersGenerated > baselineChapterCount) {
            await syncLatestData();
            confirmed = true;
            break;
          }
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!confirmed) message.error('生成连接中断，未确认到新章节，请稍后刷新重试');
      disconnectSSE(true);
    };

    const touchStale = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => { if (!settled) { settled = true; es.close(); recover(); } }, STALE_MS);
    };
    touchStale();

    es.onmessage = (event) => {
      touchStale();
      try {
        const data = JSON.parse(event.data);
        if (data.reconnected) return;
        if (data.totalSteps > 0) {
          setGenProgress(Math.round(((data.stepIndex + (data.done ? 1 : 0.5)) / data.totalSteps) * 100));
        }
        setGenStep(data.message ?? '');
        if (data.done) {
          settled = true;
          clearTimeout(staleTimer);
          disconnectSSE();
          (async () => {
            await syncLatestData(data.chapterNumber);
            disconnectSSE(true);
          })();
        }
        if (data.error) {
          settled = true;
          clearTimeout(staleTimer);
          disconnectSSE();
          message.error(data.error || '生成失败，请重试');
          disconnectSSE(true);
        }
      } catch {}
    };

    es.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(staleTimer);
      disconnectSSE();
      recover();
    };
  }, [disconnectSSE]);

  const syncGenerationStatus = useCallback(async () => {
    if (!bookId) return;
    try {
      const genStatus = await getGenerationStatus(bookId).catch(() => ({ generating: false, startedAt: null, lastStep: null, progress: 0 }));
      if (!genStatus.generating) {
        disconnectSSE(true);
        return;
      }
      setGenerating(true);
      setGenProgress(genStatus.progress);
      setGenStep(genStatus.lastStep ?? '');
      if (!esRef.current) connectSSE(bookId, book?.chaptersGenerated ?? chapters.length);
    } catch {
      disconnectSSE(true);
    }
  }, [bookId, book?.chaptersGenerated, chapters.length, connectSSE, disconnectSSE]);

  const fetchData = useCallback(async () => {
    if (!bookId) return;
    try {
      const [bookInfo, chaptersRes, genStatus] = await Promise.all([
        getBook(bookId),
        listChapters(bookId),
        getGenerationStatus(bookId).catch(() => ({ generating: false, startedAt: null, lastStep: null, progress: 0 })),
      ]);
      const [auto, usage] = await Promise.all([
        getAutoSerialization(bookId).catch(() => null),
        getBookTokenUsage(bookId).catch(() => null),
      ]);
      setBook(bookInfo);
      setTokenUsage(usage);
      const sorted = [...chaptersRes.chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
      setChapters(sorted);
      setInterventionAlert(
        auto?.intervention?.required
          ? {
              reason: auto.intervention.reason,
              failingChapterNumber: auto.intervention.failingChapterNumber,
              consecutiveLowQualityRuns: auto.intervention.consecutiveLowQualityRuns,
              threshold: auto.intervention.threshold,
            }
          : null,
      );
      setInterventionMarkerChapters(
        auto?.intervention?.markerChapterNumbers ??
        (auto?.intervention?.markerChapterNumber
          ? [auto.intervention.markerChapterNumber]
          : []),
      );
      if (sorted.length > 0 && !selectedChapter) {
        setSelectedChapter(sorted[sorted.length - 1]);
      }
      if (genStatus.generating) {
        setGenerating(true);
        setGenProgress(genStatus.progress);
        setGenStep(genStatus.lastStep ?? '');
        connectSSE(bookId, bookInfo.chaptersGenerated);
      }
    } catch (e: any) {
      setError(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [bookId, connectSSE]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => () => { disconnectSSE(); }, [disconnectSSE]);

  useEffect(() => {
    if (!workbenchPath) return;
    if (location.pathname !== workbenchPath) {
      disconnectSSE(true);
      return;
    }
    syncGenerationStatus();
  }, [location.pathname, workbenchPath, disconnectSSE, syncGenerationStatus]);

  const handleGenerate = useCallback(async () => {
    if (!bookId || generating) return;
    setGenerating(true);
    setGenProgress(0);
    setGenStep('');
    connectSSE(bookId, book?.chaptersGenerated ?? chapters.length);
  }, [bookId, generating, book?.chaptersGenerated, chapters.length, connectSSE]);

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

  const handleDeleteChapter = useCallback(async () => {
    if (!bookId || !deleteChapterTarget) return;
    setDeletingChapter(true);
    try {
      await deleteChapter(bookId, deleteChapterTarget.chapterNumber);
      setChapters((prev) => prev.filter((c) => c.chapterNumber !== deleteChapterTarget.chapterNumber));
      if (selectedChapter?.chapterNumber === deleteChapterTarget.chapterNumber) {
        const rest = chapters.filter((c) => c.chapterNumber !== deleteChapterTarget.chapterNumber);
        setSelectedChapter(rest.length > 0 ? rest[rest.length - 1] : null);
      }
      setDeleteChapterTarget(null);
      fetchData();
      message.success('章节已删除');
    } catch (e: any) {
      message.error(e?.message ?? '删除失败');
    } finally {
      setDeletingChapter(false);
    }
  }, [bookId, deleteChapterTarget, selectedChapter, chapters, fetchData]);

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
    <div className="flex min-h-[calc(100vh-57px)] flex-col lg:h-[calc(100vh-57px)] lg:flex-row">
      {/* Sidebar */}
      <div className="flex w-full flex-col border-b bg-card/50 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        {/* Book Header */}
        <div className="border-b bg-card">
          <div className="h-0.5 bg-gradient-to-r from-primary/60 via-primary/20 to-transparent" />
          <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => history.push('/novel')}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="font-bold truncate text-base tracking-tight">《{book.title}》</h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground ml-9">
            {book.genre && <Badge variant="secondary" className="text-xs max-w-[140px] truncate">{book.genre}</Badge>}
            <span className="shrink-0">{chapters.length} 章</span>
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
          {interventionAlert && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-[11px] text-red-700">
              <p className="font-medium">需要人工介入</p>
              <p className="mt-1">
                连续低分 {interventionAlert.consecutiveLowQualityRuns}/{interventionAlert.threshold} 次。
                {interventionAlert.failingChapterNumber
                  ? ` 重点检查第 ${interventionAlert.failingChapterNumber} 章。`
                  : ''}
              </p>
              {interventionAlert.reason ? <p className="mt-1">{interventionAlert.reason}</p> : null}
            </div>
          )}
          </div>
        </div>

        {/* Sidebar Tabs */}
        <Tabs
          value={sidebarTab}
          onValueChange={(v) => setSidebarTab(v as 'chapters' | 'quality')}
          className="flex flex-col min-h-0 lg:flex-1"
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

          <TabsContent value="chapters" className="mt-0 overflow-hidden lg:flex-1">
            <ScrollArea className="max-h-72 lg:h-full lg:max-h-none">
              <div className="p-1.5 space-y-0.5">
                {chapters.length === 0 ? (
                  <div className="flex flex-col items-center py-12 text-muted-foreground text-sm gap-2">
                    <BookOpen className="h-8 w-8 opacity-30" />
                    <p>还没有章节</p>
                    <p className="text-xs">点击下方按钮开始生成</p>
                  </div>
                ) : (
                  [...chapters].reverse().map((ch) => {
                    const isActive = selectedChapter?.chapterNumber === ch.chapterNumber;
                    const displayTitle = ch.title.replace(/^第\d+章\s*/, '');
                    const wc = ch.content?.length ?? 0;
                    return (
                      <button
                        key={ch.chapterNumber}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-all',
                          isActive
                            ? 'bg-primary/8 ring-1 ring-primary/20'
                            : 'hover:bg-accent/60',
                        )}
                        onClick={() => handleChapterSelect(ch)}
                      >
                        <span className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums transition-all',
                          isActive
                            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
                            : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                        )}>
                          {ch.chapterNumber}
                        </span>
                        <div className="min-w-0 flex-1 space-y-px">
                          <div className="flex items-center gap-1.5">
                            <p className={cn('truncate text-[13px] leading-none', isActive ? 'font-semibold text-primary' : 'font-medium')}>
                              {displayTitle || ch.title}
                            </p>
                            {interventionMarkerChapters.includes(ch.chapterNumber) ? (
                              <span className="shrink-0 rounded-full border border-amber-300/80 bg-amber-50 px-1.5 text-[10px] text-amber-600 font-medium">
                                需修复
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
                            <span>{new Date(ch.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                            {wc > 0 && <>
                              <span className="opacity-30">·</span>
                              <span>{wc >= 1000 ? `${(wc / 1000).toFixed(1)}k` : wc} 字</span>
                            </>}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteChapterTarget(ch); }}
                            title="删除章节"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                          <ChevronRight className={cn(
                            'h-3.5 w-3.5 transition-all',
                            isActive ? 'text-primary/60' : 'text-muted-foreground/20 group-hover:text-muted-foreground/50',
                          )} />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="quality" className="mt-0 overflow-hidden lg:flex-1">
            <ScrollArea className="max-h-72 lg:h-full lg:max-h-none">
              <div className="p-4">
                <QualityDashboard latestKpi={book.latestKpi} tokenUsage={tokenUsage} />
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
            <div className="flex flex-col gap-2 border-b bg-card/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-3">
              <div className="min-w-0 flex-1 sm:mr-4">
                {isEditing ? (
                  <input
                    className="w-full text-lg font-bold tracking-tight bg-transparent border-b-2 border-primary/30 focus:border-primary outline-none py-0.5 transition-colors"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="章节标题"
                  />
                ) : (
                  <h1 className="text-lg font-bold tracking-tight">
                    <span className="text-muted-foreground font-medium">第{selectedChapter.chapterNumber}章</span>
                    {' '}
                    {selectedChapter.title.replace(/^第\d+章\s*/, '')}
                  </h1>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isEditing ? (
                  <>
                    <span className="text-xs text-muted-foreground tabular-nums">{editCharCount} 字</span>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground" onClick={handleCancelEdit} disabled={saving}>
                      <X className="h-4 w-4" />
                      取消
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {saving ? '保存中...' : '保存'}
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {selectedChapter.content.length >= 1000
                        ? `${(selectedChapter.content.length / 1000).toFixed(1)}k`
                        : selectedChapter.content.length} 字
                    </span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">{new Date(selectedChapter.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
                    {(() => {
                      const cu = tokenUsage?.chapters?.find((c: any) => c.chapterNumber === selectedChapter.chapterNumber);
                      if (!cu) return null;
                      const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
                      const modelTip = (cu.byModel?.length ?? 0) > 0
                        ? '\n\n模型明细:\n' + cu.byModel!.map((m: any) => `  ${m.model} (${m.provider}/${m.tier}): ${m.calls}次 · 入${m.promptTokens.toLocaleString()} 出${m.completionTokens.toLocaleString()} · $${m.estimatedCostUsd.toFixed(4)}`).join('\n')
                        : '';
                      return (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-[11px] tabular-nums text-muted-foreground" title={`输入 ${cu.promptTokens.toLocaleString()} / 输出 ${cu.completionTokens.toLocaleString()} tokens · ${cu.totalCalls} 次调用 · $${cu.estimatedCostUsd.toFixed(4)}${modelTip}`}>
                            <span className="text-blue-500">入{fmt(cu.promptTokens)}</span>
                            <span className="opacity-40"> / </span>
                            <span className="text-violet-500">出{fmt(cu.completionTokens)}</span>
                            {' '}
                            <span className="text-amber-500">${cu.estimatedCostUsd < 0.01 ? cu.estimatedCostUsd.toFixed(4) : cu.estimatedCostUsd.toFixed(2)}</span>
                          </span>
                        </>
                      );
                    })()}
                    <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs ml-1" onClick={handleStartEdit}>
                      <Pencil className="h-3 w-3" />
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
                  'mx-auto max-w-2xl rounded-lg px-4 py-4 outline-none transition-shadow sm:px-8 sm:py-6',
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
            <div className="text-center space-y-2">
              <img src={emptyBookshelfImg} alt="" className="w-48 h-auto mx-auto mb-2 pointer-events-none select-none opacity-80" draggable={false} />
              <p className="text-muted-foreground font-medium">选择一个章节开始阅读</p>
              <p className="text-sm text-muted-foreground">
                或者点击「生成下一章」创作新内容
              </p>
            </div>
          </div>
        )}

        {/* Generation Progress Bar */}
        {generating && (
          <div className="border-t bg-card px-4 py-3 sm:px-8 sm:py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">正在生成第 {chapters.length + 1} 章</span>
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
      <Dialog open={!!deleteChapterTarget} onOpenChange={(o) => { if (!o) setDeleteChapterTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除章节</DialogTitle>
            <DialogDescription>
              即将永久删除第{deleteChapterTarget?.chapterNumber}章《{deleteChapterTarget?.title.replace(/^第\d+章\s*/, '')}》及其关联数据（artifacts、workflow、memory 等），此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteChapterTarget(null)} disabled={deletingChapter}>取消</Button>
            <Button variant="destructive" onClick={handleDeleteChapter} disabled={deletingChapter}>
              {deletingChapter ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {deletingChapter ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Workbench;
