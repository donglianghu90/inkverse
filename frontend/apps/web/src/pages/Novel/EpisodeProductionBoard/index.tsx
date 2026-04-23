/**
 * EpisodeProductionBoard — 单集媒体制作台
 *
 * 工作流：分镜脚本(只读) → 图片制作(T2I逐Shot/批量) → 视频制作(I2V逐Shot/批量)
 * 每一步都支持手动触发 + AI生成 + 审核，符合"人工干预→全自动"渐进架构。
 */
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useParams, history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, ImageIcon, Video, Film, Loader2, RefreshCw,
  CheckCircle2, Clock, AlertCircle, Sparkles, Play, ChevronDown, ChevronUp,
  Users, Music, Blend,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getDrama, getEpisode, listEpisodes,
  generateShotImage, generateShotVideo, generateShotSfx, composeShotPreview, getGenerateImagesSseUrl, getGenerateMediaSseUrl, resetProblemShots,
  getVisualAssets, regenerateVisualAssetImage, getEpisodeMediaStatus,
  type VisualAssetItem, type EpisodeListItem, type DramaSseEvent, type ResetFixTarget,
} from '@/services/drama';
import { getToken } from '@/services/auth';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ShotCamera { angle?: string; movement?: string; composition?: string; depthOfField?: string; }
interface ShotChar { characterId: string; action: string; emotion: string; }
interface ShotDialogue { text: string; characterId: string; isVoiceover?: boolean; }
interface Shot {
  shotIndex: number; shotId: string; sceneId?: string;
  camera: ShotCamera; characters?: ShotChar[]; dialogue?: ShotDialogue | null;
  visualPrompt: string; estimatedDurationSec: number;
  firstFrameImageUrl?: string | null; firstFramePrompt?: string | null;
  lastFrameImageUrl?: string | null; lastFramePrompt?: string | null;
  isFlashback?: boolean; isPreview?: boolean;
  isMasterShot?: boolean;
  shotType?: 'portrait' | 'dialogue' | 'action' | 'wide' | 'insert';
  regenPriority?: 'high' | 'medium' | 'low';
  specialTechnique?: string | null;
  isHumanEdited?: boolean;
  qualityTier?: 'golden' | 'standard' | 'filler';

}
type QcFixTarget = Exclude<ResetFixTarget, 'all'>;
interface ShotMediaEntry {
  imageUrl?: string;
  lastFrameImageUrl?: string;
  videoUrl?: string;
  videoJobId?: string;
  sfxUrl?: string;
  sfxJobId?: string;
  sfxStatus?: string;
  status?: string;
  qc?: {
    identityScore?: number;
    styleScore?: number;
    readabilityScore?: number;
    score?: number;
    passed?: boolean;
    attempts?: number;
    issues?: string[];
    failReasons?: QcFixTarget[];
    recommendedFix?: QcFixTarget;
  };
}
interface EpisodeData {
  id: string; episodeNumber: number; title?: string; totalDurationSec?: number;
  storyboard?: { shots: Shot[] };
  review?: {
    generationReadinessScore?: number;
    consistencyRiskShots?: Array<{ shotId: string; reason: string }>;
    cameraReadabilityRiskShots?: Array<{ shotId: string; reason: string }>;
  } | null;
  shotMediaMap?: Record<string, ShotMediaEntry>;
  mediaStatus?: string; videoUrl?: string;
}

const FIX_TARGET_LABELS: Record<ResetFixTarget, string> = {
  all: '全部',
  identity: '身份',
  style: '风格',
  camera: '构图',
  motion: '动作',
};
const FIX_TARGET_ORDER: QcFixTarget[] = ['identity', 'style', 'camera', 'motion'];

// ─── Label maps ────────────────────────────────────────────────────────────────

const ANGLE_LABELS: Record<string, string> = {
  extreme_close_up: '极特写', close_up: '特写', medium_close_up: '中特写',
  medium: '中景', medium_wide: '中远景', wide: '远景', extreme_wide: '极远景',
  over_shoulder: '过肩', bird_eye: '俯瞰', low_angle: '仰角', pov: '主观视角',
};
const MOVEMENT_LABELS: Record<string, string> = {
  static: '固定', slow_push_in: '慢推', slow_pull_back: '慢拉', dolly_zoom: '变焦',
  pan_left: '左摇', pan_right: '右摇', tilt_up: '上仰', tilt_down: '下俯',
  whip_pan: '甩镜', crane_up: '升镜', crane_down: '降镜',
  tracking: '跟镜', orbit: '环绕', handheld: '手持',
};
const SHOT_TYPE_LABELS: Record<string, string> = {
  portrait: '人物',
  dialogue: '对话',
  action: '动作',
  wide: '全景',
  insert: '插入',
};

// ─── Helper: status badge for a shot's image ───────────────────────────────────

function ShotImageStatus({ entry, generating }: { entry?: ShotMediaEntry; generating?: boolean }) {
  if (generating) return <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />生成中…</span>;
  if (entry?.imageUrl) return <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />已生成</span>;
  if (entry?.status === 'failed') return <span className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />图片生成失败</span>;
  return <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />待生成</span>;
}

function ShotVideoStatus({ entry }: { entry?: ShotMediaEntry }) {
  if (entry?.videoUrl) {
    const isFallbackImage = /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(entry.videoUrl);
    if (isFallbackImage) {
      return <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />降级静态</span>;
    }
    return <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />已生成</span>;
  }

  if (entry?.videoJobId && entry?.status === 'submitted') return <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />生成中…</span>;
  if (entry?.status === 'failed') return <span className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />视频生成失败</span>;
  if (entry?.imageUrl) return <span className="text-xs text-blue-600 flex items-center gap-1"><Play className="w-3 h-3" />可生成视频</span>;
  return <span className="text-xs text-muted-foreground flex items-center gap-1"><AlertCircle className="w-3 h-3" />需先生成图片</span>;
}

// ─── Quality Tier Badge ─────────────────────────────────────────────────────────

function QualityTierBadge({ tier }: { tier?: string }) {
  if (tier === 'golden') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300">
      ⭐ 黄金
    </span>
  );
  if (tier === 'filler') return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
      过场
    </span>
  );
  return null; // standard 不显示标记
}

function MasterShotBadge({ isMaster }: { isMaster?: boolean }) {
  if (!isMaster) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-300">
      主镜
    </span>
  );
}

function RegenPriorityBadge({ priority }: { priority?: 'high' | 'medium' | 'low' }) {
  if (!priority || priority === 'medium') return null;
  if (priority === 'high') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-300">
        高优先
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
      低优先
    </span>
  );
}

function ShotTypeBadge({ shotType }: { shotType?: Shot['shotType'] }) {
  if (!shotType) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
      {SHOT_TYPE_LABELS[shotType] ?? shotType}
    </span>
  );
}

function RiskBadge({ consistencyRisk, cameraRisk }: { consistencyRisk?: boolean; cameraRisk?: boolean }) {
  if (!consistencyRisk && !cameraRisk) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-300">
      {consistencyRisk ? '一致性风险' : '可读性风险'}
    </span>
  );
}

// ─── Shot Image Card ────────────────────────────────────────────────────────────

interface ShotImageCardProps {
  shot: Shot;
  media?: ShotMediaEntry;
  aspectRatio: '9:16' | '16:9';
  generating: boolean;
  busy?: boolean;
  consistencyRisk?: boolean;
  cameraRisk?: boolean;
  onGenerate: () => void;
}

const ShotImageCard: React.FC<ShotImageCardProps> = ({
  shot,
  media,
  aspectRatio,
  generating,
  busy,
  consistencyRisk,
  cameraRisk,
  onGenerate,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasImage = !!media?.imageUrl;

  // 使用固定纵横比容器
  const imgPadding = aspectRatio === '9:16' ? '120%' : '56.25%';

  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col',
      generating ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200/50' :
      shot.qualityTier === 'golden' ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800' :
      hasImage ? 'border-emerald-200/60 dark:border-emerald-800/60' : '',
    )}>
      {/* ─ Header: number + badges ─ */}
      <div className="px-2.5 pt-2 pb-1 flex items-center gap-1 overflow-x-auto scrollbar-none">
        <span className="font-mono text-[11px] font-bold text-muted-foreground shrink-0">
          #{String(shot.shotIndex + 1).padStart(3, '0')}
        </span>
        <MasterShotBadge isMaster={shot.isMasterShot} />
        <QualityTierBadge tier={shot.qualityTier} />
        <RegenPriorityBadge priority={shot.regenPriority} />
        <ShotTypeBadge shotType={shot.shotType} />
        <RiskBadge consistencyRisk={consistencyRisk} cameraRisk={cameraRisk} />
        {shot.lastFramePrompt && (
          <span className={cn(
            'inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded shrink-0',
            media?.lastFrameImageUrl
              ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
              : 'bg-orange-100 text-orange-700 border border-orange-200',
          )}>
            {media?.lastFrameImageUrl ? '🖼 双帧' : '⏳ 尾帧'}
          </span>
        )}
        {shot.camera?.angle && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
            {ANGLE_LABELS[shot.camera.angle] ?? shot.camera.angle}
          </Badge>
        )}
        {shot.camera?.movement && shot.camera.movement !== 'static' && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
            {MOVEMENT_LABELS[shot.camera.movement] ?? shot.camera.movement}
          </Badge>
        )}
        {media?.qc?.recommendedFix && (
          <Badge className="text-[9px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-300 shrink-0">
            修{FIX_TARGET_LABELS[media.qc.recommendedFix]}
          </Badge>
        )}
      </div>

      {/* ─ Image area (fixed aspect ratio) ─ */}
      <div className="px-2 pb-1">
        {hasImage && media?.lastFrameImageUrl ? (
          /* 双帧并排 */
          <div className="grid grid-cols-2 gap-1">
            <div className="relative w-full rounded-lg overflow-hidden bg-muted" style={{ paddingTop: imgPadding }}>
              <img src={media!.imageUrl!} alt={`Shot ${shot.shotIndex + 1} start`} className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded">首帧</div>
            </div>
            <div className="relative w-full rounded-lg overflow-hidden bg-muted" style={{ paddingTop: imgPadding }}>
              <img src={media!.lastFrameImageUrl!} alt={`Shot ${shot.shotIndex + 1} end`} className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded">尾帧</div>
            </div>
          </div>
        ) : (
          /* 单帧 / 生成中 / 待生成 */
          <div className="relative w-full rounded-lg overflow-hidden bg-muted" style={{ paddingTop: imgPadding }}>
            {generating ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-amber-50/80 dark:bg-amber-950/40">
                <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                <span className="text-[10px] text-amber-700 dark:text-amber-400">AI 生成中…</span>
              </div>
            ) : hasImage ? (
              <img
                src={media!.imageUrl!}
                alt={`Shot ${shot.shotIndex + 1}`}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <ImageIcon className="w-6 h-6 text-muted-foreground/30" />
                <span className="text-[10px] text-muted-foreground/50">待生成</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─ Info area (fixed structure) ─ */}
      <div className="px-2.5 pb-2 pt-0.5 flex flex-col gap-1 flex-1">
        {/* Status + duration */}
        <div className="flex items-center justify-between">
          <ShotImageStatus entry={media} generating={generating} />
          <span className="text-[10px] text-muted-foreground tabular-nums">{shot.estimatedDurationSec}s</span>
        </div>

        {/* Prompt (clamped) */}
        <div className="flex-1 min-h-0">
          <p
            className={cn(
              'text-[10px] text-muted-foreground leading-relaxed break-words',
              expanded ? '' : 'line-clamp-3',
            )}
          >
            {shot.visualPrompt}
          </p>
          {shot.dialogue?.text && (
            <p className="text-[10px] text-foreground/60 italic line-clamp-1 mt-0.5">
              「{shot.dialogue.text}」
            </p>
          )}
          {expanded && media?.qc && (
            <div className="mt-1 space-y-0.5">
              <p className="text-[9px] text-muted-foreground">
                QC: {typeof media.qc.score === 'number' ? media.qc.score.toFixed(1) : '-'}
                {typeof media.qc.readabilityScore === 'number' ? ` · 可读性 ${media.qc.readabilityScore.toFixed(1)}` : ''}
              </p>
              {media.qc.failReasons?.length ? (
                <p className="text-[9px] text-amber-700 dark:text-amber-300">
                  归因：{media.qc.failReasons.map((x) => FIX_TARGET_LABELS[x]).join('、')}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Expand toggle */}
        {shot.visualPrompt && shot.visualPrompt.length > 60 && (
          <button
            type="button"
            className="text-[10px] text-primary/60 hover:text-primary flex items-center gap-0.5 self-start -mt-0.5"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? '收起' : '…展开'}
          </button>
        )}

        {(shot.isFlashback || shot.isPreview) && (
          <p className="text-[9px] text-muted-foreground text-center py-0.5">
            {shot.isFlashback ? '闪回镜头' : '预览镜头'}（自动复用）
          </p>
        )}

        {/* Generate button */}
        <Button
          size="sm"
          variant={hasImage ? 'outline' : 'default'}
          className="w-full h-7 text-xs gap-1 mt-auto"
          disabled={busy || generating || shot.isFlashback || shot.isPreview}
          onClick={onGenerate}
        >
          {generating ? (
            <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
          ) : hasImage ? (
            <><RefreshCw className="w-3 h-3" />重新生成</>
          ) : (
            <><Sparkles className="w-3 h-3" />生成图片</>
          )}
        </Button>
      </div>
    </div>
  );
};

// ─── Shot Video Card ────────────────────────────────────────────────────────────

interface ShotVideoCardProps {
  shot: Shot;
  media?: ShotMediaEntry;
  aspectRatio: '9:16' | '16:9';
  consistencyRisk?: boolean;
  cameraRisk?: boolean;
  generating?: boolean;
  busy?: boolean;
  isComposing?: boolean;
  onGenerate?: () => void;
  onGenerateSfx?: () => void;
  onCompose?: () => void;
}

const ShotVideoCard: React.FC<ShotVideoCardProps> = ({
  shot,
  media,
  aspectRatio,
  consistencyRisk,
  cameraRisk,
  generating = false,
  busy = false,
  isComposing = false,
  onGenerate,
  onGenerateSfx,
  onCompose,
}) => {
  const hasVideoUrl = !!media?.videoUrl;
  const isFallbackImage = hasVideoUrl && /\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(media.videoUrl!);
  const hasVideo = hasVideoUrl && !isFallbackImage;
  const hasImage = !!media?.imageUrl;
  const isSubmitted = media?.status === 'submitted';
  const hasSfx = !!media?.sfxUrl;
  const isSfxGenerating = media?.sfxStatus === 'generating' || media?.sfxStatus === 'submitted';

  const containerClass = aspectRatio === '9:16'
    ? 'aspect-[9/16] w-full max-w-[140px] mx-auto'
    : 'aspect-[16/9] w-full';

  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col',
      shot.qualityTier === 'golden' ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800' : '',
      hasVideoUrl && shot.qualityTier !== 'golden' ? 'border-emerald-200 dark:border-emerald-800' : '',
    )}>
      {/* Shot header */}
      <div className="px-3 pt-3 pb-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-muted-foreground">
            #{String(shot.shotIndex + 1).padStart(3, '0')}
          </span>
          <MasterShotBadge isMaster={shot.isMasterShot} />
          <QualityTierBadge tier={shot.qualityTier} />
          <RegenPriorityBadge priority={shot.regenPriority} />
          <ShotTypeBadge shotType={shot.shotType} />
          <RiskBadge consistencyRisk={consistencyRisk} cameraRisk={cameraRisk} />
          {media?.qc?.recommendedFix && (
            <Badge className="text-[10px] px-1 py-0 bg-amber-100 text-amber-700 border-amber-300">
              建议修{FIX_TARGET_LABELS[media.qc.recommendedFix]}
            </Badge>
          )}
        </div>
        <ShotVideoStatus entry={media} />
      </div>

      {/* Video / image area */}
      <div className="px-3 py-1">
        <div className={cn(containerClass, 'relative bg-muted rounded-lg overflow-hidden')}>
          {hasVideoUrl ? (
            isFallbackImage ? (
              <div className="absolute inset-0">
                <img src={media!.videoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute top-2 right-2 z-10">
                  <Badge className="bg-black/60 text-white border border-white/20 text-[9px] px-1.5 py-0 shadow-sm pointer-events-none">
                    降级静态
                  </Badge>
                </div>
              </div>
            ) : (
              <video
                src={media!.videoUrl!}
                className="absolute inset-0 w-full h-full object-cover"
                controls
                playsInline
                preload="metadata"
              />
            )
          ) : isSubmitted ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-amber-50 dark:bg-amber-950/40">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <span className="text-xs text-amber-700 dark:text-amber-400">视频生成中…</span>
            </div>
          ) : hasImage ? (
            <div className="absolute inset-0">
              <img src={media!.imageUrl!} alt="" className="w-full h-full object-cover opacity-60" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-black/60 rounded-full p-2">
                  <Video className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Video className="w-8 h-8 text-muted-foreground/30" />
              <span className="text-xs text-muted-foreground/50">需先生成图片</span>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="px-3 pb-3 pt-1 flex flex-col gap-1">
        <p className="text-xs text-muted-foreground line-clamp-2">{shot.visualPrompt}</p>
        {shot.dialogue?.text && (
          <p className="text-xs text-foreground/70 italic line-clamp-1">「{shot.dialogue.text}」</p>
        )}
        {media?.qc?.failReasons?.length ? (
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            归因：{media.qc.failReasons.map((x) => FIX_TARGET_LABELS[x]).join('、')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{shot.estimatedDurationSec}s</p>
        {onGenerate && !shot.isFlashback && !shot.isPreview && (
          <div className="flex gap-1 mt-1">
            <Button
              size="sm"
              variant={hasVideo ? 'outline' : 'default'}
              className="flex-1 h-7 text-xs gap-1"
              disabled={busy || generating || !hasImage || isSubmitted}
              onClick={onGenerate}
            >
              {generating || isSubmitted ? (
                <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
              ) : hasVideoUrl ? (
                <><RefreshCw className="w-3 h-3" />重新生成</>
              ) : (
                <><Video className="w-3 h-3" />生成视频</>
              )}
            </Button>
            {onGenerateSfx && (
              <Button
                size="sm"
                variant={hasSfx ? 'outline' : 'secondary'}
                className="px-2 h-7"
                title={hasSfx ? '重新生成音效' : '生成音效'}
                disabled={busy || isSfxGenerating || !hasVideo}
                onClick={onGenerateSfx}
              >
                {isSfxGenerating ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Music className="w-3 h-3" />
                )}
              </Button>
            )}
            {hasSfx && (
              <audio src={media.sfxUrl} controls className="hidden" id={`audio-${shot.shotId}`} />
            )}
            {hasSfx && (
              <Button
                size="sm"
                variant="ghost"
                className="px-2 h-7"
                title="播放音效"
                onClick={() => {
                  const audio = document.getElementById(`audio-${shot.shotId}`) as HTMLAudioElement;
                  if (audio) audio.play();
                }}
              >
                <Play className="w-3 h-3 text-emerald-600" />
              </Button>
            )}
            {onCompose && (
              <Button
                size="sm"
                variant="secondary"
                className="px-2 h-7"
                title="音画合成 (Merge)"
                disabled={busy || !hasVideo || !hasSfx || isComposing}
                onClick={onCompose}
              >
                {isComposing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Blend className="w-3 h-3" />}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Batch progress bar ────────────────────────────────────────────────────────

interface BatchProgressProps { label: string; current: number; total: number; message?: string; }

const BatchProgress: React.FC<BatchProgressProps> = ({ label, current, total, message: msg }) => (
  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3 flex flex-col gap-1.5">
    <div className="flex items-center justify-between text-sm">
      <span className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />{label}
      </span>
      <span className="text-amber-700 dark:text-amber-400 tabular-nums">{current}/{total}</span>
    </div>
    <Progress value={total > 0 ? (current / total) * 100 : 0} className="h-1.5" />
    {msg && <p className="text-xs text-amber-700 dark:text-amber-400 truncate">{msg}</p>}
  </div>
);

function regenPriorityScore(priority?: Shot['regenPriority']): number {
  if (priority === 'high') return 3;
  if (priority === 'low') return 1;
  return 2;
}

function qualityTierScore(tier?: Shot['qualityTier']): number {
  if (tier === 'golden') return 3;
  if (tier === 'filler') return 1;
  return 2;
}

function shotTypeScore(shotType?: Shot['shotType']): number {
  if (shotType === 'action' || shotType === 'dialogue') return 3;
  if (shotType === 'wide' || shotType === 'portrait') return 2;
  if (shotType === 'insert') return 1;
  return 2;
}

function sortShotsByPriority(shots: Shot[]): Shot[] {
  return [...shots].sort((a, b) => {
    const regenDiff = regenPriorityScore(b.regenPriority) - regenPriorityScore(a.regenPriority);
    if (regenDiff !== 0) return regenDiff;
    const masterDiff = Number(!!b.isMasterShot) - Number(!!a.isMasterShot);
    if (masterDiff !== 0) return masterDiff;
    const tierDiff = qualityTierScore(b.qualityTier) - qualityTierScore(a.qualityTier);
    if (tierDiff !== 0) return tierDiff;
    const typeDiff = shotTypeScore(b.shotType) - shotTypeScore(a.shotType);
    if (typeDiff !== 0) return typeDiff;
    return a.shotIndex - b.shotIndex;
  });
}

function isHighPriorityShot(shot: Shot): boolean {
  return !!(shot.isMasterShot || shot.regenPriority === 'high' || shot.qualityTier === 'golden');
}

function isProblemShotMediaEntry(
  shot: Shot,
  media: ShotMediaEntry | undefined,
  episodeMediaStatus?: string,
): boolean {
  if (!media) return false;
  if (shot.isPreview) return false;
  if (media.qc?.passed === false) return true;
  if (media.status === 'failed' || media.status === 'submitted') return true;
  if (media.status === 'completed' && !media.videoUrl) return true;
  if (episodeMediaStatus === 'failed' && media.status === 'image_done' && !media.videoUrl && !shot.isFlashback) return true;
  return false;
}

function isQcFixTarget(value: unknown): value is QcFixTarget {
  return value === 'identity' || value === 'style' || value === 'camera' || value === 'motion';
}

function resolveShotFixTags(
  shot: Shot,
  media: ShotMediaEntry | undefined,
  consistencyRiskSet: Set<string>,
  cameraRiskSet: Set<string>,
): Set<QcFixTarget> {
  const tags = new Set<QcFixTarget>();
  const qc = media?.qc;
  if (isQcFixTarget(qc?.recommendedFix)) tags.add(qc.recommendedFix);
  for (const reason of qc?.failReasons ?? []) {
    if (isQcFixTarget(reason)) tags.add(reason);
  }
  if (consistencyRiskSet.has(shot.shotId)) {
    tags.add('identity');
    tags.add('style');
  }
  if (cameraRiskSet.has(shot.shotId)) tags.add('camera');
  const likelyMotionProblem = media?.status === 'failed' && !media.videoUrl && !shot.isPreview;
  if (likelyMotionProblem) tags.add('motion');
  return tags;
}

// ─── Script shot row (read-only) ────────────────────────────────────────────────

const ANGLE_LABELS_S: Record<string, string> = {
  extreme_close_up: '极特写', close_up: '特写', medium_close_up: '中特写',
  medium: '中景', medium_wide: '中远景', wide: '远景', extreme_wide: '极远景',
  over_shoulder: '过肩', bird_eye: '俯瞰', low_angle: '仰角', pov: '主观视角',
};
const MOVEMENT_LABELS_S: Record<string, string> = {
  static: '固定', slow_push_in: '慢推', slow_pull_back: '慢拉',
  pan_left: '左摇', pan_right: '右摇', tilt_up: '上仰', tilt_down: '下俯',
  whip_pan: '甩镜', tracking: '跟镜', orbit: '环绕', handheld: '手持',
};

function ScriptShotRow(
  { shot, consistencyRisk, cameraRisk, charNames }: { shot: Shot; consistencyRisk?: boolean; cameraRisk?: boolean; charNames?: Map<string, string> },
) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="font-mono text-xs font-bold text-muted-foreground w-8 shrink-0 pt-0.5">
          #{String(shot.shotIndex + 1).padStart(3, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1 mb-1.5">
            {shot.camera?.angle && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {ANGLE_LABELS_S[shot.camera.angle] ?? shot.camera.angle}
              </Badge>
            )}
            {shot.camera?.movement && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {MOVEMENT_LABELS_S[shot.camera.movement] ?? shot.camera.movement}
              </Badge>
            )}
            {shot.specialTechnique && (
              <Badge className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700 border-purple-200">
                {shot.specialTechnique}
              </Badge>
            )}
            <MasterShotBadge isMaster={shot.isMasterShot} />
            <RegenPriorityBadge priority={shot.regenPriority} />
            <ShotTypeBadge shotType={shot.shotType} />
            <RiskBadge consistencyRisk={consistencyRisk} cameraRisk={cameraRisk} />
            {shot.isHumanEdited && (
              <Badge className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-700 border-orange-200">
                已锁定
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground self-center">{shot.estimatedDurationSec}s</span>
          </div>
          <p className={cn('text-sm text-foreground/80', open ? '' : 'line-clamp-2')}>{shot.visualPrompt}</p>
          {shot.dialogue?.text && (
            <p className="text-xs text-muted-foreground italic mt-1">
              {shot.dialogue.isVoiceover ? '旁白' : '台词'}：「{shot.dialogue.text}」
            </p>
          )}
          {open && shot.characters && shot.characters.length > 0 && (
            <div className="mt-2 space-y-1">
              {shot.characters.map(c => (
                <p key={c.characterId} className="text-xs text-muted-foreground">
                  {charNames?.get(c.characterId) ?? c.characterId} — {c.action}（{c.emotion}）
                </p>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="text-muted-foreground/50 hover:text-muted-foreground shrink-0 mt-0.5"
          onClick={() => setOpen(v => !v)}
        >
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const EpisodeProductionBoard: React.FC = () => {
  const { dramaId, episodeNumber: epParam } = useParams<{ dramaId: string; episodeNumber: string }>();
  const episodeNumber = parseInt(epParam ?? '1', 10);

  const [drama, setDrama] = useState<Record<string, unknown>>({});
  const [episode, setEpisode] = useState<EpisodeData | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Per-shot generation state
  const [generatingImageShots, setGeneratingImageShots] = useState<Set<string>>(new Set());
  const [generatingVideoShots, setGeneratingVideoShots] = useState<Set<string>>(new Set());
  const [generatingSfxShots, setGeneratingSfxShots] = useState<Set<string>>(new Set());
  const [composingShots, setComposingShots] = useState<Set<string>>(new Set());

  // Batch image generation state (SSE)
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imageBatchProgress, setImageBatchProgress] = useState({ current: 0, total: 0, message: '' });

  // Batch video generation state (SSE)
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [videoBatchProgress, setVideoBatchProgress] = useState({ current: 0, total: 0, message: '' });
  const [problemResetMode, setProblemResetMode] = useState<'all' | 'high' | QcFixTarget | null>(null);
  const [sortMode, setSortMode] = useState<'story' | 'priority'>('story');
  const [visualAssets, setVisualAssets] = useState<VisualAssetItem[]>([]);

  // Batch asset generation state (SSE)
  const [isGeneratingAssets, setIsGeneratingAssets] = useState(false);
  const [assetsBatchProgress, setAssetsBatchProgress] = useState({ current: 0, total: 0, message: '' });
  const [regeneratingAssetIds, setRegeneratingAssetIds] = useState<Set<string>>(new Set());

  const imagesSseRef = useRef<AbortController | null>(null);
  const videosSseRef = useRef<AbortController | null>(null);
  const assetsBatchAbortRef = useRef(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadEpisode = useCallback(async () => {
    if (!dramaId) return;
    try {
      const data = await getEpisode(dramaId, episodeNumber);
      setEpisode(data as unknown as EpisodeData);
    } catch {
      message.error('加载集数失败');
    }
  }, [dramaId, episodeNumber]);

  useEffect(() => {
    if (!dramaId) return;
    setLoading(true);
    Promise.all([
      getDrama(dramaId).then(setDrama),
      getEpisode(dramaId, episodeNumber).then(d => setEpisode(d as unknown as EpisodeData)),
      listEpisodes(dramaId).then(r => setEpisodes(r.episodes)),
      getVisualAssets(dramaId).then(r => setVisualAssets(r.assets)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [dramaId, episodeNumber]);

  // ── Probe backend for ongoing generation on mount ──────────────────────────
  useEffect(() => {
    if (!dramaId) return;
    getEpisodeMediaStatus(dramaId, episodeNumber).then(status => {
      if (status.mediaStatus === 'generating_images' || status.mediaStatus === 'generating_first_frames') {
        setIsGeneratingImages(true);
      }
      if (status.mediaStatus === 'generating_videos') {
        setIsGeneratingVideos(true);
      }
    }).catch(() => {});
  }, [dramaId, episodeNumber]);

  // Clean up SSE on unmount
  useEffect(() => () => {
    imagesSseRef.current?.abort();
    videosSseRef.current?.abort();
    assetsBatchAbortRef.current = true;
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────────

  const storyOrderedShots: Shot[] = [...(episode?.storyboard?.shots ?? [])].sort((a, b) => a.shotIndex - b.shotIndex);
  const displayShots: Shot[] = sortMode === 'priority' ? sortShotsByPriority(storyOrderedShots) : storyOrderedShots;
  const shotMediaMap = useMemo(() => {
    return Object.fromEntries(((episode as any)?.shotMedia ?? []).map((m: any) => [m.shotId, m])) as Record<string, ShotMediaEntry>;
  }, [episode]);
  const consistencyRiskSet = new Set((episode?.review?.consistencyRiskShots ?? []).map((r) => r.shotId));
  const cameraRiskSet = new Set((episode?.review?.cameraReadabilityRiskShots ?? []).map((r) => r.shotId));
  const reviewRiskShotSet = new Set<string>([...consistencyRiskSet, ...cameraRiskSet]);
  const readinessScore = episode?.review?.generationReadinessScore;
  const aspectRatio: '9:16' | '16:9' = ((drama as any)?.state?.audienceDirective?.aspectRatio ?? '9:16') as '9:16' | '16:9';
  const videoProvider: string = ((drama as any)?.state?.videoProvider ?? '') as string;

  const patchShotMedia = useCallback((shotId: string, patch: any) => {
    setEpisode(prev => {
      if (!prev) return prev;
      const mediaArr = (prev as any).shotMedia ?? [];
      const idx = mediaArr.findIndex((m: any) => m.shotId === shotId);
      const newArr = [...mediaArr];
      if (idx >= 0) {
        newArr[idx] = { ...newArr[idx], ...patch, qc: patch.qc ?? newArr[idx].qc };
      } else {
        newArr.push({ shotId, ...patch });
      }
      return { ...prev, shotMedia: newArr } as any;
    });
  }, []);

  const imageCount = storyOrderedShots.filter(s => shotMediaMap[s.shotId]?.imageUrl).length;
  const videoCount = storyOrderedShots.filter(s => {
    const url = shotMediaMap[s.shotId]?.videoUrl;
    return url && !/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url);
  }).length;
  const totalShots = storyOrderedShots.length;
  const problemShotIds = storyOrderedShots
    .filter((shot) => isProblemShotMediaEntry(shot, shotMediaMap[shot.shotId], episode?.mediaStatus) || reviewRiskShotSet.has(shot.shotId))
    .map((shot) => shot.shotId);
  const problemShotSet = new Set(problemShotIds);
  const problemShotCount = problemShotIds.length;
  const highPriorityProblemShotCount = storyOrderedShots.filter(
    (shot) => problemShotSet.has(shot.shotId) && isHighPriorityShot(shot),
  ).length;
  const fixTargetCounts: Record<QcFixTarget, number> = { identity: 0, style: 0, camera: 0, motion: 0 };
  for (const shot of storyOrderedShots) {
    if (!problemShotSet.has(shot.shotId)) continue;
    const tags = resolveShotFixTags(shot, shotMediaMap[shot.shotId], consistencyRiskSet, cameraRiskSet);
    for (const tag of tags) fixTargetCounts[tag] += 1;
  }

  const episodeTitle = episode?.title ?? `第 ${episodeNumber} 集`;
  const dramaTitleRaw = (drama as any)?.state?.title ?? (drama as any)?.title ?? '';

  // ── Per-shot image generation ─────────────────────────────────────────────────

  const handleGenerateShotImage = useCallback(async (shotId: string) => {
    if (!dramaId) return;
    setGeneratingImageShots(prev => new Set(prev).add(shotId));
    try {
      const result = await generateShotImage(dramaId, episodeNumber, shotId);
      if (result.imageUrl) {
        patchShotMedia(shotId, { imageUrl: result.imageUrl, status: 'image_done' });
        message.success('图片生成成功');
      } else {
        message.warning('图片未生成，请检查配置');
      }
    } catch (err: any) {
      message.error(`生成失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setGeneratingImageShots(prev => { const s = new Set(prev); s.delete(shotId); return s; });
    }
  }, [dramaId, episodeNumber]);

  // ── Per-shot video generation ─────────────────────────────────────────────────

  const handleGenerateShotVideo = useCallback(async (shotId: string) => {
    if (!dramaId) return;
    setGeneratingVideoShots(prev => new Set(prev).add(shotId));
    try {
      const result = await generateShotVideo(dramaId, episodeNumber, shotId);
      if (result.videoUrl) {
        patchShotMedia(shotId, { videoUrl: result.videoUrl, status: 'completed' });
        message.success('视频生成成功');
      } else {
        message.warning('视频未生成，请检查配置');
      }
    } catch (err: any) {
      message.error(`视频生成失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setGeneratingVideoShots(prev => { const s = new Set(prev); s.delete(shotId); return s; });
    }
  }, [dramaId, episodeNumber]);

  // ── Per-shot sfx generation ─────────────────────────────────────────────────

  const handleGenerateShotSfx = useCallback(async (shotId: string) => {
    if (!dramaId) return;
    setGeneratingSfxShots(prev => new Set(prev).add(shotId));
    try {
      const result = await generateShotSfx(dramaId, episodeNumber, shotId);
      if (result.sfxUrl) {
        patchShotMedia(shotId, { sfxUrl: result.sfxUrl, sfxStatus: 'completed' });
        message.success('音效生成成功');
      } else if (result.status === 'skipped') {
        message.info('音效功能暂未开放，敬请期待');
      } else if (result.status === 'unavailable') {
        message.info('音效服务暂不可用，已跳过');
      } else {
        message.warning('音效未生成，请检查状态');
      }
    } catch (err: any) {
      message.error(`音效生成失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setGeneratingSfxShots(prev => { const s = new Set(prev); s.delete(shotId); return s; });
    }
  }, [dramaId, episodeNumber]);

  // ── Per-shot Compose Preview ─────────────────────────────────────────────────

  const handleComposeShotMedia = useCallback(async (shotId: string) => {
    if (!dramaId) return;
    setComposingShots(prev => new Set(prev).add(shotId));
    try {
      const result = await composeShotPreview(dramaId, episodeNumber, shotId);
      if (result.videoUrl) {
        patchShotMedia(shotId, { videoUrl: result.videoUrl, status: 'completed' });
        message.success('单镜头音画合成成功');
      } else {
        message.warning('合成失败，请检查视频状态');
      }
    } catch (err: any) {
      message.error(`合成失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setComposingShots(prev => { const s = new Set(prev); s.delete(shotId); return s; });
    }
  }, [dramaId, episodeNumber]);

  // ── Batch image generation (SSE) ─────────────────────────────────────────────

  const handleBatchGenerateImages = useCallback(async () => {
    if (!dramaId || isGeneratingImages) return;
    imagesSseRef.current?.abort();

    const needsGen = displayShots.filter(s => !s.isFlashback && !s.isPreview && !shotMediaMap[s.shotId]?.imageUrl);
    if (needsGen.length === 0) {
      message.info('所有分镜图已生成');
      return;
    }

    setIsGeneratingImages(true);
    setImageBatchProgress({ current: 0, total: needsGen.length, message: '正在连接…' });

    const controller = new AbortController();
    imagesSseRef.current = controller;
    const url = getGenerateImagesSseUrl(dramaId, episodeNumber);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('SSE 连接失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stopped = false;
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as DramaSseEvent;
            if (data._type === 'heartbeat' || data._type === 'info') continue;
            if (data._type === 'error' || data.error || data.terminalStatus === 'failed') {
              message.error(`生成失败: ${data.error || data.message || '未知错误'}`);
              stopped = true; break;
            }
            if (data._type === 'progress') {
              setImageBatchProgress({
                current: data.stepIndex ?? 0,
                total: data.totalSteps ?? needsGen.length,
                message: data.message ?? '',
              });
              if (data.data?.imageUrl && data.stepKey) {
                patchShotMedia(data.stepKey, { imageUrl: data.data.imageUrl, status: 'image_done' });
              }
              continue;
            }
            if (data._type === 'result') {
              message.success(data.message || '批量图片生成完成');
              stopped = true; break;
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '批量图片生成失败');
    } finally {
      setIsGeneratingImages(false);
      loadEpisode();
    }
  }, [dramaId, episodeNumber, isGeneratingImages, displayShots, shotMediaMap, loadEpisode]);

  // ── Problem shot reset (targeted) ───────────────────────────────────────────

  const handleResetProblemShots = useCallback(async (
    opts?: { onlyHighPriority?: boolean; fixTarget?: ResetFixTarget },
  ) => {
    if (!dramaId) return;
    const onlyHighPriority = opts?.onlyHighPriority ?? false;
    const fixTarget = opts?.fixTarget ?? 'all';
    const activeMode: 'all' | 'high' | QcFixTarget = onlyHighPriority ? 'high' : fixTarget;
    setProblemResetMode(activeMode);
    try {
      const result = await resetProblemShots(dramaId, episodeNumber, {
        includeReviewRisks: true,
        onlyHighPriority,
        fixTarget,
      });
      const scopeLabel = onlyHighPriority
        ? '高优先'
        : (fixTarget === 'all' ? '全部' : `${FIX_TARGET_LABELS[fixTarget]}类`);
      if (result.resetCount > 0) {
        message.success(`已重置 ${result.resetCount} 个${scopeLabel}问题镜头`);
      } else {
        message.info(`未发现${scopeLabel}问题镜头`);
      }
      await loadEpisode();
    } catch (err: any) {
      message.error(`重置失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setProblemResetMode(null);
    }
  }, [dramaId, episodeNumber, loadEpisode]);

  // ── Batch video generation (SSE, reuses media-sse endpoint) ──────────────────

  const handleBatchGenerateVideos = useCallback(async () => {
    if (!dramaId || isGeneratingVideos) return;
    videosSseRef.current?.abort();

    if (imageCount < totalShots) {
      const missing = totalShots - imageCount;
      message.warning(`还有 ${missing} 张分镜图未生成，建议先完成图片阶段`);
    }

    setIsGeneratingVideos(true);
    setVideoBatchProgress({ current: 0, total: totalShots, message: '正在连接…' });

    const controller = new AbortController();
    videosSseRef.current = controller;
    const url = getGenerateMediaSseUrl(dramaId, episodeNumber);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('SSE 连接失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stopped = false;
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as DramaSseEvent;
            if (data._type === 'heartbeat' || data._type === 'info') continue;
            if (data._type === 'error' || data.error || data.terminalStatus === 'failed') {
              message.error(`生成失败: ${data.error || data.message || '未知错误'}`);
              stopped = true; break;
            }
            if (data._type === 'progress') {
              setVideoBatchProgress({
                current: data.stepIndex ?? 0,
                total: data.totalSteps ?? totalShots,
                message: data.message ?? '',
              });
              if (data.data?.videoUrl && data.stepKey) {
                patchShotMedia(data.stepKey, { videoUrl: data.data.videoUrl, status: 'completed' });
              }
              continue;
            }
            if (data._type === 'result') {
              message.success(data.message || '批量视频生成完成');
              stopped = true; break;
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '批量视频生成失败');
    } finally {
      setIsGeneratingVideos(false);
      loadEpisode();
    }
  }, [dramaId, episodeNumber, isGeneratingVideos, imageCount, totalShots, loadEpisode]);

  // ── Per-asset image regeneration ────────────────────────────────────────────

  const handleRegenerateAsset = useCallback(async (assetId: string) => {
    if (!dramaId) return;
    setRegeneratingAssetIds(prev => new Set(prev).add(assetId));
    try {
      const updated = await regenerateVisualAssetImage(dramaId, assetId);
      setVisualAssets(prev => prev.map(a => a.id === assetId ? updated : a));
      message.success('参考图已重新生成');
    } catch (err: any) {
      message.error(`生成失败: ${err?.message ?? '未知错误'}`);
    } finally {
      setRegeneratingAssetIds(prev => { const s = new Set(prev); s.delete(assetId); return s; });
    }
  }, [dramaId]);

  // ── Batch asset generation (per-episode, sequential) ───────────────────────────

  const handleBatchGenerateAssets = useCallback(async (missingAssetIds: string[]) => {
    if (!dramaId || isGeneratingAssets || !missingAssetIds.length) return;

    assetsBatchAbortRef.current = false;
    setIsGeneratingAssets(true);
    setAssetsBatchProgress({ current: 0, total: missingAssetIds.length, message: '正在生成参考图…' });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < missingAssetIds.length; i++) {
      if (assetsBatchAbortRef.current) break;
      const assetId = missingAssetIds[i];
      const assetName = visualAssets.find(a => a.id === assetId)?.name ?? assetId;

      setAssetsBatchProgress({
        current: i,
        total: missingAssetIds.length,
        message: `正在生成: ${assetName} (${i + 1}/${missingAssetIds.length})`,
      });

      try {
        const updated = await regenerateVisualAssetImage(dramaId, assetId);
        setVisualAssets(prev => prev.map(a => a.id === assetId ? updated : a));
        successCount++;
      } catch {
        failCount++;
      }
    }

    setAssetsBatchProgress({ current: missingAssetIds.length, total: missingAssetIds.length, message: '完成' });

    if (failCount === 0) {
      message.success(`本集参考图全部生成完成 (${successCount}张)`);
    } else {
      message.warning(`生成完成: ${successCount}张成功, ${failCount}张失败`);
    }

    setIsGeneratingAssets(false);
    // 刷新最新资产列表
    if (dramaId) getVisualAssets(dramaId).then(r => setVisualAssets(r.assets)).catch(() => {});
  }, [dramaId, isGeneratingAssets, visualAssets]);

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!episode) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">集数数据不存在</p>
        <Button variant="outline" onClick={() => history.back()}>返回</Button>
      </div>
    );
  }

  // ── 视频 Tab：每个 Shot 独立渲染 ─────
  const videoRenderItems = displayShots;
  const shotGridClass = aspectRatio === '9:16'
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
    : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-[57px] z-30 border-b bg-background/95 backdrop-blur-sm px-4 h-12 flex items-center gap-3 overflow-x-auto">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 shrink-0"
          onClick={() => history.back()}
        >
          <ArrowLeft className="w-4 h-4" />返回
        </Button>
        <span className="font-semibold text-sm shrink-0 truncate max-w-[200px]">
          {dramaTitleRaw ? `${dramaTitleRaw} · ` : ''}{episodeTitle}
        </span>

        {videoProvider && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-mono">
            <Video className="w-3 h-3" />
            {videoProvider}
          </span>
        )}
        {episode?.videoUrl && (
          <a href={episode.videoUrl} target="_blank" rel="noreferrer" className="shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Play className="w-3 h-3" />预览成片
            </Button>
          </a>
        )}

        <div className="flex items-center gap-1 ml-auto shrink-0">
          {episodes.map(ep => (
            <button
              key={ep.episodeNumber}
              type="button"
              className={cn(
                'h-7 min-w-[28px] px-2 rounded text-xs font-medium transition-colors',
                ep.episodeNumber === episodeNumber
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/80 text-muted-foreground hover:bg-muted',
              )}
              onClick={() => history.push(`/novel/${dramaId}/episode/${ep.episodeNumber}/production`)}
            >
              {ep.episodeNumber}
            </button>
          ))}
        </div>
      </header>

      {/* ─── Main content ────────────────────────────────────────────────────── */}
      <Tabs defaultValue="assets" className="flex-1 flex flex-col">
        <div className="mx-4 mt-3 flex items-center justify-between gap-2">
          <TabsList className="w-auto self-start">
            <TabsTrigger value="assets" className="gap-1.5 text-xs">
              <Users className="w-3.5 h-3.5" />本集资产
            </TabsTrigger>
            <TabsTrigger value="script" className="gap-1.5 text-xs">
              <Film className="w-3.5 h-3.5" />分镜脚本
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{totalShots}</Badge>
            </TabsTrigger>
            <TabsTrigger value="images" className="gap-1.5 text-xs">
              <ImageIcon className="w-3.5 h-3.5" />分镜图制作
              <Badge
                variant={imageCount === totalShots ? 'default' : 'secondary'}
                className="text-[10px] px-1.5 py-0"
              >
                {imageCount}/{totalShots}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="videos" className="gap-1.5 text-xs">
              <Video className="w-3.5 h-3.5" />视频制作
              <Badge
                variant={videoCount === totalShots ? 'default' : 'secondary'}
                className="text-[10px] px-1.5 py-0"
              >
                {videoCount}/{totalShots}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {typeof readinessScore === 'number' && (
              <Badge
                variant={readinessScore >= 7 ? 'default' : 'secondary'}
                className="text-[10px] px-1.5 py-0"
              >
                生成稳定性 {readinessScore.toFixed(1)}
              </Badge>
            )}
            <Button
              size="sm"
              variant={sortMode === 'priority' ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setSortMode((m) => (m === 'priority' ? 'story' : 'priority'))}
            >
              {sortMode === 'priority' ? '优先级视图' : '剧情顺序'}
            </Button>
          </div>
        </div>

        {problemShotCount > 0 && imageCount > 0 && (
          <div className="mx-4 mt-2 mb-1 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
                问题镜头 {problemShotCount}
              </Badge>
              {highPriorityProblemShotCount > 0 && (
                <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50">
                  高优先 {highPriorityProblemShotCount}
                </Badge>
              )}
              {FIX_TARGET_ORDER.filter((tag) => fixTargetCounts[tag] > 0).map((tag) => (
                <Badge key={tag} variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
                  {FIX_TARGET_LABELS[tag]} {fixTargetCounts[tag]}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs gap-1"
                disabled={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                onClick={() => handleResetProblemShots({ onlyHighPriority: false, fixTarget: 'all' })}
              >
                {problemResetMode === 'all'
                  ? <><Loader2 className="w-3 h-3 animate-spin" />全量重置中…</>
                  : <><RefreshCw className="w-3 h-3" />重生全部问题镜头</>}
              </Button>
              {highPriorityProblemShotCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                  onClick={() => handleResetProblemShots({ onlyHighPriority: true, fixTarget: 'all' })}
                >
                  {problemResetMode === 'high'
                    ? <><Loader2 className="w-3 h-3 animate-spin" />高优先重置中…</>
                    : <><AlertCircle className="w-3 h-3" />仅高优先重生</>}
                </Button>
              )}
              {FIX_TARGET_ORDER.filter((target) => fixTargetCounts[target] > 0).map((target) => (
                <Button
                  key={target}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  disabled={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                  onClick={() => handleResetProblemShots({ onlyHighPriority: false, fixTarget: target })}
                >
                  {problemResetMode === target
                    ? <><Loader2 className="w-3 h-3 animate-spin" />{FIX_TARGET_LABELS[target]}重置中…</>
                    : <><RefreshCw className="w-3 h-3" />仅修{FIX_TARGET_LABELS[target]}</>}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* ── 分镜脚本 tab ──────────────────────────────────────────────────── */}
        <TabsContent value="script" className="flex-1 mt-0 p-4">
          <ScrollArea className="h-[calc(100vh-220px)]">
            <div className="space-y-2 max-w-3xl mx-auto pr-3">
              {(() => {
                const charNames = new Map<string, string>(visualAssets.filter(a => a.assetType === 'character').map(a => [a.refId, a.name]));
                return storyOrderedShots.map((shot) => (
                  <ScriptShotRow
                    key={shot.shotId}
                    shot={shot}
                    consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                    cameraRisk={cameraRiskSet.has(shot.shotId)}
                    charNames={charNames}
                  />
                ));
              })()}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── 图片制作 tab ──────────────────────────────────────────────────── */}
        <TabsContent value="images" className="flex-1 mt-0 flex flex-col">
          {/* 当参考图缺失时提示 */}
          {(() => {
            const usedCharIds = new Set<string>();
            const usedSceneIds = new Set<string>();
            for (const shot of storyOrderedShots) {
              for (const c of shot.characters ?? []) usedCharIds.add(c.characterId);
              if (shot.sceneId) usedSceneIds.add(shot.sceneId);
            }
            const needed = visualAssets.filter(
              a => (a.assetType === 'character' && usedCharIds.has(a.refId))
                || (a.assetType === 'location' && usedSceneIds.has(a.refId))
            );
            const missing = needed.filter(a => !a.referenceImageUrl).length;
            if (missing === 0) return null;
            return (
              <div className="mx-4 mt-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>本集有 <strong>{missing}</strong> 个角色/场景参考图尚未生成。点击「批量生成」时系统会自动先完成参考图生成。
                  可切换到「<strong>参考图</strong>」 Tab 查看详情。</span>
              </div>
            );
          })()}
          {/* Batch controls */}
          <div className="px-4 pt-3 pb-2 border-b flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {isGeneratingImages && (
                <BatchProgress
                  label="批量生成分镜图"
                  current={imageBatchProgress.current}
                  total={imageBatchProgress.total}
                  message={imageBatchProgress.message}
                />
              )}
              {!isGeneratingImages && imageCount > 0 && (
                <div className="flex items-center gap-2">
                  <Progress value={(imageCount / totalShots) * 100} className="h-2 flex-1" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    {imageCount}/{totalShots} 已生成
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={loadEpisode}
                disabled={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
              >
                <RefreshCw className="w-3 h-3" />刷新
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleBatchGenerateImages}
                disabled={isGeneratingImages || isGeneratingVideos || problemResetMode !== null || imageCount === totalShots}
              >
                {isGeneratingImages ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
                ) : (
                  <><Sparkles className="w-3 h-3" />批量生成全部图片</>
                )}
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className={cn('p-4 grid gap-3', shotGridClass)}>
              {(() => {
                // 图片 Tab 也支持 Shot Group 分组（与视频 Tab 一致）
                const imageRenderItems = displayShots.map(shot => ({ type: 'shot' as const, shot }));
                return imageRenderItems.map(item => {
                  if (item.type === 'shot') {
                    const shot = item.shot;
                    // 依赖资产就绪检查：该 Shot 涉及的角色/场景参考图是否已生成
                    const shotCharIds = (shot.characters ?? []).map(c => c.characterId);
                    const shotDeps = visualAssets.filter(
                      a => (a.assetType === 'character' && shotCharIds.includes(a.refId))
                        || (a.assetType === 'location' && a.refId === shot.sceneId)
                    );
                    const missingDeps = shotDeps.filter(a => !a.referenceImageUrl && !(a.referenceImages?.[0]?.imageUrl));
                    return (
                      <div key={shot.shotId} className="relative">
                        <ShotImageCard
                          shot={shot}
                          media={shotMediaMap[shot.shotId]}
                          aspectRatio={aspectRatio}
                          generating={generatingImageShots.has(shot.shotId)}
                          busy={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                          consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                          cameraRisk={cameraRiskSet.has(shot.shotId)}
                          onGenerate={() => handleGenerateShotImage(shot.shotId)}
                        />
                        {missingDeps.length > 0 && (
                          <div className="absolute top-1 left-1 z-10 inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-100/90 text-amber-700 border border-amber-300 backdrop-blur-sm">
                            <AlertCircle className="w-2.5 h-2.5" />
                            缺{missingDeps.length}个参考图
                          </div>
                        )}
                      </div>
                    );
                  }
                  // Shot Group
                  const groupTotalSec = item.shots.reduce((s, sh) => s + (sh.estimatedDurationSec ?? 0), 0);
                  return (
                    <div
                      key={item.groupId}
                      className="col-span-full rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/30 dark:bg-indigo-950/20 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                          <ImageIcon className="w-3 h-3" />
                          镜头组 · {item.shots.length} Shot · {groupTotalSec.toFixed(1)}s
                        </span>
                      </div>
                      <div className={cn('grid gap-2', shotGridClass)}>
                        {item.shots.map(shot => (
                          <ShotImageCard
                            key={shot.shotId}
                            shot={shot}
                            media={shotMediaMap[shot.shotId]}
                            aspectRatio={aspectRatio}
                            generating={generatingImageShots.has(shot.shotId) || shotMediaMap[shot.shotId]?.status === 'generating_image'}
                            busy={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                            consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                            cameraRisk={cameraRiskSet.has(shot.shotId)}
                            onGenerate={() => handleGenerateShotImage(shot.shotId)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── 视频制作 tab ──────────────────────────────────────────────────── */}
        <TabsContent value="videos" className="flex-1 mt-0 flex flex-col">
          {/* Batch controls */}
          <div className="px-4 pt-3 pb-2 border-b flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {isGeneratingVideos && (
                <BatchProgress
                  label="批量生成视频"
                  current={videoBatchProgress.current}
                  total={videoBatchProgress.total}
                  message={videoBatchProgress.message}
                />
              )}
              {!isGeneratingVideos && videoCount > 0 && (
                <div className="flex items-center gap-2">
                  <Progress value={(videoCount / totalShots) * 100} className="h-2 flex-1" />
                  <span className="text-xs text-muted-foreground shrink-0">
                    {videoCount}/{totalShots} 已生成
                  </span>
                </div>
              )}
              {imageCount < totalShots && !isGeneratingVideos && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  建议先完成图片生成（{totalShots - imageCount} 张待生成），视频质量更佳
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1"
                onClick={loadEpisode}
                disabled={isGeneratingVideos || isGeneratingImages || problemResetMode !== null}
              >
                <RefreshCw className="w-3 h-3" />刷新
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleBatchGenerateVideos}
                disabled={isGeneratingVideos || isGeneratingImages || problemResetMode !== null}
              >
                {isGeneratingVideos ? (
                  <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
                ) : (
                  <><Video className="w-3 h-3" />批量生成全部视频</>
                )}
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className={cn('p-4 grid gap-3', shotGridClass)}>
              {videoRenderItems.map(shot => (
                <ShotVideoCard
                  key={shot.shotId}
                  shot={shot}
                  media={shotMediaMap[shot.shotId]}
                  aspectRatio={aspectRatio}
                  consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                  cameraRisk={cameraRiskSet.has(shot.shotId)}
                  generating={generatingVideoShots.has(shot.shotId)}
                  busy={isGeneratingVideos || isGeneratingImages || generatingSfxShots.has(shot.shotId) || composingShots.has(shot.shotId)}
                  isComposing={composingShots.has(shot.shotId)}
                  onGenerate={() => handleGenerateShotVideo(shot.shotId)}
                  onGenerateSfx={() => handleGenerateShotSfx(shot.shotId)}
                  onCompose={() => handleComposeShotMedia(shot.shotId)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ─── Assets Tab ────────────────────────────────────────────────────────── */}
        <TabsContent value="assets" className="flex-1 flex flex-col mt-0">
          {(() => {
            // 本集涉及的角色 ID 和场景 ID（从分镜及剧本中提取并映射）
            const usedCharIds = new Set<string>();
            const usedLocationIds = new Set<string>();
            const sceneMap = new Map<string, string>();
            const scriptScenes = ((episode as any)?.script?.scenes ?? []) as Array<{ sceneId: string; locationId?: string }>;
            for (const s of scriptScenes) {
              if (s.sceneId && s.locationId) sceneMap.set(s.sceneId, s.locationId);
            }

            for (const shot of storyOrderedShots) {
              for (const c of shot.characters ?? []) usedCharIds.add(c.characterId);
              if (shot.sceneId) {
                const locId = sceneMap.get(shot.sceneId) || shot.sceneId;
                usedLocationIds.add(locId);
              }
            }

            const charAssets = visualAssets.filter(a => a.assetType === 'character' && usedCharIds.has(a.refId));
            const locAssets  = visualAssets.filter(a => a.assetType === 'location'  && usedLocationIds.has(a.refId));
            
            // 筛选本集出现的签名道具：如果它的拥有者在本集出场，或者它出现的场景在本集用到
            const propAssets = visualAssets.filter(a => {
              if (a.assetType !== 'prop') return false;
              const d = a.data as any;
              
              // 匹配角色拥有者（AI 可能生成的是 characterId 也可能是中文名）
              if (d?.characterOwner) {
                if (usedCharIds.has(d.characterOwner)) return true;
                if (charAssets.some(c => (c.name || '').includes(d.characterOwner) || (c.refId || '').includes(d.characterOwner))) return true;
              }
              
              // 匹配出场场景
              if (d?.appearsInScenes?.some((sceneNameOrLocId: string) => 
                usedLocationIds.has(sceneNameOrLocId) || 
                locAssets.some(l => l.name === sceneNameOrLocId || l.refId === sceneNameOrLocId)
              )) {
                return true;
              }
              
              // 兜底：如果该道具的 propId 或 name 在本集的任何分镜 visualPrompt 或动作描写中被提及，也算作本集资产
              const propIdStr = (d.propId || a.refId || '').toLowerCase();
              const propNameStr = (a.name || d.name || '').toLowerCase();
              if (propIdStr || propNameStr) {
                for (const shot of storyOrderedShots) {
                  const vp = (shot.visualPrompt || '').toLowerCase();
                  if (propIdStr && vp.includes(propIdStr)) return true;
                  if (propNameStr && vp.includes(propNameStr)) return true;
                  
                  for (const char of shot.characters ?? []) {
                    const action = (char.action || '').toLowerCase();
                    if (propIdStr && action.includes(propIdStr)) return true;
                    if (propNameStr && action.includes(propNameStr)) return true;
                  }
                }
                
                // 也找一下剧本阶段
                for (const scene of scriptScenes as any[]) {
                  for (const action of scene.actions ?? []) {
                    const desc = (action.description || '').toLowerCase();
                    if (propIdStr && desc.includes(propIdStr)) return true;
                    if (propNameStr && desc.includes(propNameStr)) return true;
                  }
                }
              }

              return false;
            });


            const allEpisodeAssets = [...charAssets, ...locAssets, ...propAssets];
            const missingAssets = allEpisodeAssets.filter(a => !a.referenceImageUrl && !(a.referenceImages?.[0]?.imageUrl));
            const missingCount = missingAssets.length;
            const missingAssetIds = missingAssets.map(a => a.id);
            const totalCount   = allEpisodeAssets.length;

            // ── 资产卡片 ──────────────────────────────────────────────────────────
            const AssetCard = ({ asset }: { asset: VisualAssetItem }) => {
              const [showPrompts, setShowPrompts] = useState(false);
              const img = asset.referenceImageUrl || asset.referenceImages?.[0]?.imageUrl;
              const isRegen = regeneratingAssetIds.has(asset.id);
              const d = asset.data ?? {};

              // 构建详细字段列表
              const detailFields: Array<{ label: string; value: string }> = [];
              if (asset.assetType === 'character') {
                if (d.role) detailFields.push({ label: '角色', value: String(d.role) });
                if (d.faceReferencePrompt) detailFields.push({ label: '面部提示词', value: String(d.faceReferencePrompt) });
                if (d.faceDescription) detailFields.push({ label: '面部描述', value: String(d.faceDescription) });
                if (d.bodyTypePrompt) detailFields.push({ label: '体型', value: String(d.bodyTypePrompt) });
                if (d.hairStylePrompt) detailFields.push({ label: '发型', value: String(d.hairStylePrompt) });
                if (d.defaultCostumePrompt) detailFields.push({ label: '服装', value: String(d.defaultCostumePrompt) });
                if (d.defaultCostume) detailFields.push({ label: '服装描述', value: String(d.defaultCostume) });
                if (d.voiceProfile) {
                  const vp: any = d.voiceProfile;
                  const parts = [];
                  if (vp.timbre) parts.push(`音色: ${vp.timbre}`);
                  if (vp.speakingStyle) parts.push(`风格: ${vp.speakingStyle}`);
                  if (vp.catchphrase) parts.push(`口头禅: "${vp.catchphrase}"`);
                  detailFields.push({ label: '配音', value: parts.length > 0 ? parts.join(' | ') : typeof vp === 'string' ? vp : JSON.stringify(vp) });
                }
                if (d.appearanceHint) detailFields.push({ label: '外观提示', value: String(d.appearanceHint) });
              } else {
                if (d.description) detailFields.push({ label: '描述', value: String(d.description) });
                if (d.visualPrompt) detailFields.push({ label: '视觉提示词', value: String(d.visualPrompt) });
                if (d.lightingDefault) detailFields.push({ label: '光照', value: String(d.lightingDefault) });
                if (d.colorTone) detailFields.push({ label: '色调', value: String(d.colorTone) });
                if (d.ambientSoundDefault) detailFields.push({ label: '环境音', value: String(d.ambientSoundDefault) });
                if (d.keyProps && Array.isArray(d.keyProps)) detailFields.push({ label: '道具', value: (d.keyProps as string[]).join('、') });
              }

              return (
                <div className={cn(
                  'rounded-xl border bg-card overflow-hidden flex flex-col',
                  !img ? 'border-amber-200 dark:border-amber-800' : 'border-emerald-200/60 dark:border-emerald-800/60',
                )}>
                  {/* 图片区域 */}
                  <div className="relative bg-muted" style={{ paddingTop: asset.assetType === 'character' ? '133%' : '56%' }}>
                    {isRegen ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-amber-50 dark:bg-amber-950/40">
                        <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                        <span className="text-xs text-amber-700 dark:text-amber-400">生成中…</span>
                      </div>
                    ) : img ? (
                      <img
                        src={img}
                        alt={asset.name}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                        <ImageIcon className="w-7 h-7 text-muted-foreground/30" />
                        <span className="text-[11px] text-muted-foreground/50">参考图待生成</span>
                      </div>
                    )}
                    {/* 状态角标 */}
                    {!img && !isRegen && (
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
                        <Clock className="w-2.5 h-2.5" />待生成
                      </span>
                    )}
                    {img && !isRegen && (
                      <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-2.5 h-2.5" />已生成
                      </span>
                    )}
                  </div>

                  {/* 信息区域 */}
                  <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant={asset.assetType === 'character' ? 'default' : asset.assetType === 'prop' ? 'outline' : 'secondary'} className="text-[10px] px-1.5 py-0">
                          {asset.assetType === 'character' ? '角色' : asset.assetType === 'prop' ? '道具' : '场景'}
                        </Badge>
                        <p className="text-xs font-semibold truncate max-w-[100px]">{asset.name || asset.refId}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!!d.role && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800">
                            {String(d.role) === 'protagonist' ? '主角' : String(d.role) === 'antagonist' ? '反派' : String(d.role) === 'supporting' ? '配角' : String(d.role)}
                          </span>
                        )}
                        {!!d.isRecurring && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-400">
                            常驻
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 详细提示词 — 可折叠 */}
                    {detailFields.length > 0 && (
                      <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setShowPrompts(v => !v)}
                          className="w-full flex items-center justify-between px-2 py-1 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">
                            提示词详情 ({detailFields.length})
                          </span>
                          {showPrompts
                            ? <ChevronUp className="h-3 w-3 text-slate-400" />
                            : <ChevronDown className="h-3 w-3 text-slate-400" />}
                        </button>
                        {showPrompts && (
                          <div className="px-2 py-1.5 space-y-1.5 bg-slate-50/50 dark:bg-slate-900/30">
                            {detailFields.map(({ label, value }) => (
                              <div key={label}>
                                <p className="text-[9px] font-medium text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
                                <p className="text-[10px] text-slate-700 dark:text-slate-300 leading-relaxed break-all select-all font-mono">{value}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 重新生成按钮 */}
                    <Button
                      size="sm"
                      variant={img ? 'outline' : 'default'}
                      className="w-full h-7 text-xs gap-1 mt-auto"
                      disabled={isRegen || isGeneratingAssets}
                      onClick={() => handleRegenerateAsset(asset.id)}
                    >
                      {isRegen ? (
                        <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
                      ) : img ? (
                        <><RefreshCw className="w-3 h-3" />重新生成</>
                      ) : (
                        <><Sparkles className="w-3 h-3" />生成参考图</>
                      )}
                    </Button>
                  </div>
                </div>
              );
            };

            return (
              <div className="flex flex-col flex-1 min-h-0">
                {/* 工具栏 */}
                <div className="px-4 pt-3 pb-2 border-b flex items-center gap-3 shrink-0">
                  <div className="flex-1 min-w-0">
                    {isGeneratingAssets && (
                      <BatchProgress
                        label="批量生成参考图"
                        current={assetsBatchProgress.current}
                        total={assetsBatchProgress.total}
                        message={assetsBatchProgress.message}
                      />
                    )}
                    {!isGeneratingAssets && totalCount > 0 && (
                      <div className="flex items-center gap-2">
                        <Progress value={totalCount > 0 ? ((totalCount - missingCount) / totalCount) * 100 : 0} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground shrink-0">
                          {totalCount - missingCount}/{totalCount} 已生成
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      disabled={isGeneratingAssets}
                      onClick={() => {
                        if (dramaId) getVisualAssets(dramaId).then(r => setVisualAssets(r.assets)).catch(() => {});
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />刷新
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 text-xs gap-1"
                      disabled={isGeneratingAssets || missingCount === 0}
                      onClick={() => handleBatchGenerateAssets(missingAssetIds)}
                    >
                      {isGeneratingAssets ? (
                        <><Loader2 className="w-3 h-3 animate-spin" />生成中…</>
                      ) : (
                        <><Sparkles className="w-3 h-3" />一键生成参考图{missingCount > 0 ? `（${missingCount}）` : ''}</>
                      )}
                    </Button>
                  </div>
                </div>

                {/* 资产列表 */}
                <ScrollArea className="flex-1">
                  {!charAssets.length && !locAssets.length ? (
                    <div className="flex flex-col items-center justify-center gap-3 text-muted-foreground py-20">
                      <Users className="w-10 h-10 opacity-30" />
                      <p className="text-sm">本集暂无角色/场景资产信息</p>
                      <p className="text-xs max-w-xs text-center">完成分镜生成后，本集涉及的角色和场景将在此展示</p>
                    </div>
                  ) : (
                    <div className="p-4 space-y-6">
                      {charAssets.length > 0 && (
                        <section>
                          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <Users className="w-4 h-4" />本集角色
                            <span className="text-muted-foreground font-normal text-xs">({charAssets.length})</span>
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {charAssets.map(a => <AssetCard key={a.id} asset={a} />)}
                          </div>
                        </section>
                      )}
                      {locAssets.length > 0 && (
                        <section>
                          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <ImageIcon className="w-4 h-4" />本集场景
                            <span className="text-muted-foreground font-normal text-xs">({locAssets.length})</span>
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            {locAssets.map(a => <AssetCard key={a.id} asset={a} />)}
                          </div>
                        </section>
                      )}
                      {propAssets.length > 0 && (
                        <section>
                          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4" />本集道具
                            <span className="text-muted-foreground font-normal text-xs">({propAssets.length})</span>
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {propAssets.map(a => <AssetCard key={a.id} asset={a} />)}
                          </div>
                        </section>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </div>
            );
          })()}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EpisodeProductionBoard;
