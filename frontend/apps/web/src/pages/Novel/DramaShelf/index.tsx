import React, { useCallback, useEffect, useState } from 'react';
import { history } from '@umijs/max';
import { Plus, Loader2, AlertCircle, Sparkles, Film, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { listDramas, deleteDrama, type DramaListItem } from '@/services/drama';

const DRAMA_GENRE_GRADIENTS: Record<string, string> = {
  '霸总': 'from-amber-500 to-rose-600',
  '甜宠': 'from-pink-400 to-rose-500',
  '战神': 'from-red-600 to-orange-700',
  '穿越': 'from-violet-500 to-purple-700',
  '宫斗': 'from-amber-600 to-red-700',
  '复仇': 'from-zinc-600 to-red-800',
  '重生': 'from-emerald-500 to-teal-700',
  '悬疑': 'from-slate-500 to-zinc-700',
  '都市': 'from-orange-400 to-rose-500',
  '古装': 'from-yellow-600 to-amber-800',
};

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

/* ─── DramaCard (landscape film poster) ─── */
const DramaCard: React.FC<{ drama: DramaListItem; onDelete: (d: DramaListItem) => void }> = ({ drama, onDelete }) => {
  const gradient = drama.genre && DRAMA_GENRE_GRADIENTS[drama.genre]
    ? DRAMA_GENRE_GRADIENTS[drama.genre]
    : 'from-rose-500 to-violet-600';

  return (
    <div className="group cursor-pointer" onClick={() => history.push(`/novel/drama/${drama.id}`)}>
      <div className={cn(
        'relative rounded-xl overflow-hidden shadow-md',
        'group-hover:shadow-xl group-hover:-translate-y-1',
        'transition-all duration-300 aspect-video bg-gradient-to-br',
        gradient,
      )}>
        {/* Film perforated strip */}
        <div className="absolute left-0 top-0 bottom-0 w-5 z-10 flex flex-col items-center justify-between py-2">
          <div className="w-2 flex-1 flex flex-col gap-1.5 items-center pt-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-1.5 h-2 rounded-[1px] bg-black/20" />
            ))}
          </div>
        </div>

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_rgba(255,255,255,0.12),_transparent_50%)]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />

        {/* Badges */}
        <div className="absolute top-2.5 left-7 z-20 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/90 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
            <Film className="w-2.5 h-2.5" />
            短剧
          </span>
          {drama.genre && (
            <span className="inline-flex rounded-md bg-black/25 backdrop-blur-sm px-1.5 py-0.5 text-[10px] font-medium text-white/90">
              {drama.genre}
            </span>
          )}
        </div>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 p-3 pl-7 z-10">
          <h3 className="text-base font-bold text-white leading-snug line-clamp-1 drop-shadow-sm">
            {drama.title}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-[11px]">
            <span className="text-white/70">{drama.episodesGenerated} 集</span>
            {drama.latestOverallScore != null && (
              <>
                <span className="text-white/30">·</span>
                <span className={cn(
                  'font-semibold tabular-nums',
                  drama.latestOverallScore >= 8 ? 'text-emerald-300'
                    : drama.latestOverallScore >= 7 ? 'text-amber-300' : 'text-red-300',
                )}>
                  ★ {Number(drama.latestOverallScore).toFixed(1)}
                </span>
              </>
            )}
            <span className="text-white/30">·</span>
            <span className="text-white/50">{formatRelativeTime(drama.updatedAt)}</span>
          </div>
        </div>

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/8 transition-colors duration-200" />

        {/* Delete button */}
        <button
          className="absolute top-2.5 right-2 z-20 p-1 rounded-md bg-black/30 backdrop-blur-sm text-white/70 hover:text-white hover:bg-red-600/80 opacity-0 group-hover:opacity-100 transition-all"
          onClick={(e) => { e.stopPropagation(); onDelete(drama); }}
          title="删除短剧"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};

/* ─── CreateCard ─── */
const DramaCreateCard: React.FC = () => (
  <div className="group cursor-pointer" onClick={() => history.push('/novel/create-drama')}>
    <div className="relative rounded-xl border-2 border-dashed border-muted-foreground/15 group-hover:border-primary/50 group-hover:bg-gradient-to-br group-hover:from-primary/5 group-hover:to-violet-500/5 transition-all duration-300 aspect-video flex flex-col items-center justify-center gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/40 group-hover:bg-primary/10 flex items-center justify-center transition-all duration-300 group-hover:scale-110">
        <Sparkles className="h-5 w-5 text-muted-foreground/60 group-hover:text-primary transition-colors" />
      </div>
      <span className="text-xs font-medium text-muted-foreground/60 group-hover:text-primary transition-colors">
        创建短剧
      </span>
    </div>
  </div>
);

/* ─── DramaShelf ─── */
const DramaShelf: React.FC = () => {
  const [dramas, setDramas] = useState<DramaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DramaListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await listDramas();
      const sorted = [...res.dramas].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setDramas(sorted);
    } catch (e: any) {
      const raw = e?.message ?? '加载失败';
      const friendly = typeof raw === 'string' && raw.startsWith('[')
        ? '短剧数据加载失败，请稍后重试'
        : raw;
      setError(friendly);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDrama(deleteTarget.id);
      setDramas((prev) => prev.filter((d) => d.id !== deleteTarget.id));
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
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <AlertCircle className="h-10 w-10 text-destructive/60" />
        <div className="text-center max-w-sm">
          <p className="text-base font-medium text-foreground mb-1">加载失败</p>
          <p className="text-sm">{error}</p>
        </div>
        <Button variant="outline" onClick={fetchData}>重试</Button>
      </div>
    );
  }

  const hasDramas = dramas.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Empty state */}
      {!hasDramas && (
        <div className="animate-fade-in flex flex-col items-center py-16 text-center">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-100 to-purple-50 dark:from-violet-900/30 dark:to-purple-900/20 flex items-center justify-center mb-6">
            <Film className="w-10 h-10 text-primary/60" />
          </div>
          <h2 className="text-2xl font-bold mb-2">还没有短剧作品</h2>
          <p className="text-muted-foreground max-w-md mb-8 leading-relaxed">
            InkVerse 可以从一个创意生成完整短剧——包括剧本、分镜、AI 图片和视频。
          </p>
          <Button size="lg" className="gap-2 shadow-lg shadow-primary/25" onClick={() => history.push('/novel/create-drama')}>
            <Sparkles className="h-4 w-4" />
            创建短剧
          </Button>
        </div>
      )}

      {/* Drama grid */}
      {hasDramas && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">我的短剧</h2>
              <p className="text-sm text-muted-foreground mt-1">{dramas.length} 部短剧</p>
            </div>
            <Button
              size="sm"
              className="gap-1.5 shadow-sm shadow-primary/20"
              onClick={() => history.push('/novel/create-drama')}
            >
              <Plus className="h-3.5 w-3.5" />
              创建短剧
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {dramas.map(d => <DramaCard key={d.id} drama={d} onDelete={setDeleteTarget} />)}
            <DramaCreateCard />
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              即将永久删除《{deleteTarget?.title}》及其全部集数、角色、场景等数据，此操作不可恢复。
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

export default DramaShelf;
