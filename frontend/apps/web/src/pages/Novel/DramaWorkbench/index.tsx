import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, Play, Loader2, AlertCircle, Film, Clock, Star,
  ChevronRight, Eye, Camera, Music,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getDrama, listEpisodes, getEpisode, getGenerateEpisodeSseUrl, getGenerateMediaSseUrl,
  type EpisodeListItem,
} from '@/services/drama';
import { getToken } from '@/services/auth';

const DramaWorkbench: React.FC = () => {
  const { dramaId } = useParams<{ dramaId: string }>();
  const [drama, setDrama] = useState<Record<string, unknown> | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState('');
  const [lastError, setLastError] = useState<string | null>(null); // 失败时可重试，后端会从断点续跑
  const abortRef = useRef<AbortController | null>(null);
  const [previewEp, setPreviewEp] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mediaGenEp, setMediaGenEp] = useState<number | null>(null);
  const [mediaGenProgress, setMediaGenProgress] = useState(0);
  const mediaAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); mediaAbortRef.current?.abort(); }, []);

  const fetchData = useCallback(async () => {
    if (!dramaId) return;
    try {
      setLoading(true);
      const [d, epRes] = await Promise.all([getDrama(dramaId), listEpisodes(dramaId)]);
      setDrama(d);
      setEpisodes(epRes.episodes);
    } catch (e: any) {
      message.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerate = async (count = 1) => {
    if (!dramaId) return;
    setGenerating(true);
    setGenProgress(0);
    setGenStep('');
    setLastError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(getGenerateEpisodeSseUrl(dramaId, count), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error('连接失败');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload._type === 'heartbeat') continue;
            if (payload._type === 'result') { message.success(payload.message); break; }
            if (payload.error) { setLastError(payload.error); message.error(payload.error); break; }

            if (payload.totalSteps > 0) {
              const p = Math.round(((payload.stepIndex + (payload.done ? 1 : 0.5)) / payload.totalSteps) * 100);
              setGenProgress(p);
            }
            setGenStep(payload.message ?? payload.step ?? '');
          } catch { /* skip */ }
        }
      }

      await fetchData();
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '生成失败');
    } finally {
      setGenerating(false);
      setGenProgress(0);
    }
  };

  const handlePreview = async (ep: EpisodeListItem) => {
    if (!dramaId) return;
    setPreviewLoading(true);
    try {
      const full = await getEpisode(dramaId, ep.episodeNumber);
      setPreviewEp(full);
    } catch (e: any) {
      message.error('加载集详情失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleGenerateMedia = async (episodeNumber: number) => {
    if (!dramaId) return;
    setMediaGenEp(episodeNumber);
    setMediaGenProgress(0);
    const controller = new AbortController();
    mediaAbortRef.current = controller;
    try {
      const res = await fetch(getGenerateMediaSseUrl(dramaId, episodeNumber), {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('连接失败');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const p = JSON.parse(line.slice(5).trim());
            if (p._type === 'heartbeat') continue;
            if (p._type === 'result') { message.success('媒体生成完成'); break; }
            if (p.error) { message.error(p.error); break; }
            if (p.totalSteps > 0) setMediaGenProgress(Math.round(((p.stepIndex ?? 0) + (p.done ? 1 : 0.5)) / p.totalSteps * 100));
          } catch { /* skip */ }
        }
      }
      if (previewEp && (previewEp as any).episodeNumber === episodeNumber) {
        const full = await getEpisode(dramaId, episodeNumber);
        setPreviewEp(full);
      }
      await fetchData();
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '媒体生成失败');
    } finally {
      setMediaGenEp(null);
      setMediaGenProgress(0);
    }
  };

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!drama) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <AlertCircle className="h-10 w-10" />
      <p>短剧不存在</p>
      <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
    </div>
  );

  const state = (drama as any).state as Record<string, unknown> | undefined;
  const seed = state?.seed as Record<string, unknown> | undefined;
  const outline = state?.seriesOutline as Record<string, unknown> | undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => history.push('/novel')}>
          <ArrowLeft className="h-4 w-4" />返回
        </Button>
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-violet-500" />
          <Badge variant="secondary" className="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400">短剧</Badge>
        </div>
      </div>

      {/* Drama info */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{(drama as any).title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
          <span>{(drama as any).genre}</span>
          <span>·</span>
          <span>{(drama as any).episodesGenerated ?? 0} / {(outline?.totalPlannedEpisodes as number) ?? '?'} 集</span>
          {seed?.catharsisType && <><span>·</span><span>爽点：{seed.catharsisType as string}</span></>}
        </div>
        {seed?.logline && <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{seed.logline as string}</p>}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <Button className="gap-2" disabled={generating} onClick={() => handleGenerate(1)}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {generating ? '生成中...' : '生成下一集'}
        </Button>
        <Button variant="outline" className="gap-2" disabled={generating} onClick={() => handleGenerate(3)}>
          <Play className="h-4 w-4" />连续生成 3 集
        </Button>
      </div>

      {/* Generation progress */}
      {generating && (
        <Card className="mb-6 border-violet-200 dark:border-violet-800">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
              <span className="font-medium">{genStep || '准备中...'}</span>
              <span className="text-muted-foreground ml-auto tabular-nums">{genProgress}%</span>
            </div>
            <Progress value={genProgress} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {/* 失败重试：后端会从上次断点续跑 */}
      {lastError && !generating && (
        <Card className="mb-6 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">生成失败</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 truncate mt-0.5">{lastError}</p>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setLastError(null); handleGenerate(1); }}>
              从断点重试
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Episode list */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">分集列表</h2>
        {episodes.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">尚未生成任何集，点击上方按钮开始。</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {episodes.map(ep => (
              <Card key={ep.id} className="group cursor-pointer hover:border-primary/30 transition-all" onClick={() => handlePreview(ep)}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-bold text-sm shrink-0">
                    {ep.episodeNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ep.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{ep.totalDurationSec}s</span>
                      <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{ep.shotCount} shots</span>
                      {ep.mediaStatus === 'completed' && <Badge variant="secondary" className="text-[10px]">有视频</Badge>}
                    </div>
                  </div>
                  {ep.overallScore != null && (() => {
                    const score = Number(ep.overallScore);
                    if (!Number.isFinite(score)) return null;
                    return (
                      <span className={cn(
                        'text-sm font-semibold tabular-nums',
                        score >= 8 ? 'text-emerald-600' : score >= 7 ? 'text-amber-600' : 'text-red-500',
                      )}>
                        <Star className="h-3.5 w-3.5 inline mr-0.5" />{score.toFixed(1)}
                      </span>
                    );
                  })()}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Episode preview dialog */}
      <Dialog open={!!previewEp} onOpenChange={(open) => { if (!open) setPreviewEp(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Film className="h-5 w-5 text-violet-500" />
              第 {(previewEp as any)?.episodeNumber} 集 — {(previewEp as any)?.title}
            </DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : previewEp ? (
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-4 text-sm">
                {/* Script scenes */}
                {(previewEp as any).script?.scenes && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2"><Eye className="h-4 w-4" />剧本场景</h3>
                    {((previewEp as any).script.scenes as any[]).map((scene: any, i: number) => (
                      <Card key={i} className="mb-2">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{scene.purpose}</Badge>
                            <span className="text-xs font-medium">{scene.sceneHeading}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{scene.objective}</p>
                          {scene.dialogues?.map((d: any, j: number) => (
                            <div key={j} className="pl-3 border-l-2 border-violet-200 dark:border-violet-800">
                              <span className="text-xs font-semibold text-violet-600">{d.characterId}</span>
                              {d.parenthetical && <span className="text-xs text-muted-foreground ml-1">({d.parenthetical})</span>}
                              <p className="text-xs mt-0.5">{d.text}</p>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Shot count + duration + 生成媒体 */}
                {(previewEp as any).storyboard && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold flex items-center gap-2"><Camera className="h-4 w-4" />分镜概览</h3>
                      {(previewEp as any).mediaStatus !== 'completed' && (
                        <Button size="sm" variant="outline" disabled={mediaGenEp !== null} onClick={() => handleGenerateMedia((previewEp as any).episodeNumber)}>
                          {mediaGenEp === (previewEp as any).episodeNumber ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />{mediaGenProgress}%</> : <><Film className="h-3 w-3 mr-1" />生成媒体</>}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      共 {(previewEp as any).storyboard.shots?.length ?? 0} 个镜头 · 预估时长 {(previewEp as any).storyboard.totalEstimatedDurationSec}s
                      {(previewEp as any).mediaStatus && <span className="ml-2">· 媒体状态: {(previewEp as any).mediaStatus}</span>}
                    </p>
                    {/* 视频播放 */}
                    {(previewEp as any).videoUrl && (
                      <div className="mb-3 rounded-lg overflow-hidden bg-black">
                        <video src={(previewEp as any).videoUrl} controls className="w-full max-h-64" />
                      </div>
                    )}
                    {/* 分镜图片 */}
                    {((previewEp as any).shotMediaMap || (previewEp as any).storyboard?.shots) && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {((previewEp as any).storyboard?.shots ?? []).map((shot: any, i: number) => {
                          const media = (previewEp as any).shotMediaMap?.[shot.shotId];
                          const imgUrl = media?.imageUrl ?? shot.firstFrameImageUrl ?? shot.lastFrameImageUrl;
                          return (
                            <div key={shot.shotId ?? i} className="rounded border overflow-hidden bg-muted/30">
                              {imgUrl ? <img src={imgUrl} alt={`shot${i}`} className="w-full aspect-video object-cover" /> : <div className="aspect-video flex items-center justify-center text-xs text-muted-foreground">尚未生成</div>}
                              <div className="p-1.5 text-[10px] truncate">{shot.visualPrompt ? `${shot.visualPrompt.slice(0, 40)}...` : `Shot ${i + 1}`}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Review */}
                {(previewEp as any).review && (
                  <div>
                    <h3 className="font-semibold mb-2 flex items-center gap-2"><Star className="h-4 w-4" />质量审核</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries((previewEp as any).review.dimensions || {}).map(([k, v]) => (
                        <div key={k} className="text-center p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground">{k}</p>
                          <p className="text-sm font-bold">{(v as number).toFixed(1)}</p>
                        </div>
                      ))}
                    </div>
                    {(previewEp as any).review.strengths?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium">亮点：</p>
                        <ul className="text-xs text-muted-foreground list-disc pl-4">
                          {(previewEp as any).review.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DramaWorkbench;
