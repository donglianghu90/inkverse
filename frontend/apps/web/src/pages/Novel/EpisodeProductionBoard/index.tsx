/**
 * EpisodeProductionBoard — 单集媒体制作台
 *
 * 工作流：分镜脚本(只读) → 图片制作(T2I逐Shot/批量) → 视频制作(I2V逐Shot/批量)
 * 每一步都支持手动触发 + AI生成 + 审核，符合"人工干预→全自动"渐进架构。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, ImageIcon, Video, Film, Loader2, RefreshCw,
  CheckCircle2, Clock, AlertCircle, Sparkles, Play, ChevronDown, ChevronUp,
  ZapIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  getDrama, getEpisode, listEpisodes,
  generateShotImage, getGenerateImagesSseUrl, getGenerateMediaSseUrl, resetProblemShots,
  type EpisodeListItem, type DramaSseEvent, type ResetFixTarget,
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
  videoUrl?: string;
  videoJobId?: string;
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
  return <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />待生成</span>;
}

function ShotVideoStatus({ entry }: { entry?: ShotMediaEntry }) {
  if (entry?.videoUrl) return <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />已生成</span>;
  if (entry?.videoJobId && entry?.status === 'submitted') return <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />生成中…</span>;
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

  const imgContainerClass = aspectRatio === '9:16'
    ? 'aspect-[9/16] w-full max-w-[140px] mx-auto'
    : 'aspect-[16/9] w-full';

  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col',
      shot.qualityTier === 'golden' ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800' : '',
      hasImage && shot.qualityTier !== 'golden' ? 'border-emerald-200 dark:border-emerald-800' : '',
      generating ? 'border-amber-200 dark:border-amber-800 animate-pulse' : '',
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
        <div className="flex gap-1 flex-wrap justify-end">
          {shot.camera?.angle && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {ANGLE_LABELS[shot.camera.angle] ?? shot.camera.angle}
            </Badge>
          )}
          {shot.camera?.movement && shot.camera.movement !== 'static' && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {MOVEMENT_LABELS[shot.camera.movement] ?? shot.camera.movement}
            </Badge>
          )}
        </div>
      </div>

      {/* Image area */}
      <div className="px-3 py-1">
        <div className={cn(imgContainerClass, 'relative bg-muted rounded-lg overflow-hidden')}>
          {generating ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-amber-50 dark:bg-amber-950/40">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <span className="text-xs text-amber-700 dark:text-amber-400">AI 生成中…</span>
            </div>
          ) : hasImage ? (
            <img
              src={media!.imageUrl!}
              alt={`Shot ${shot.shotIndex + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/50">
              <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
              <span className="text-xs text-muted-foreground/60">待生成</span>
            </div>
          )}
        </div>
      </div>

      {/* Status + actions */}
      <div className="px-3 pb-2 pt-1 flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <ShotImageStatus entry={media} generating={generating} />
          <span className="text-xs text-muted-foreground">{shot.estimatedDurationSec}s</span>
        </div>

        {/* Prompt preview */}
        <div className="min-h-[60px]">
          <p className={cn('text-xs text-muted-foreground leading-relaxed', expanded ? '' : 'line-clamp-2')}>
            {shot.visualPrompt}
          </p>
          {shot.dialogue?.text && (
            <p className="text-xs text-foreground/70 italic line-clamp-1 mt-1">
              「{shot.dialogue.text}」
            </p>
          )}
          {expanded && media?.qc && (
            <div className="mt-1.5 space-y-0.5">
              <p className="text-[10px] text-muted-foreground">
                QC: {typeof media.qc.score === 'number' ? media.qc.score.toFixed(1) : '-'}
                {typeof media.qc.readabilityScore === 'number' ? ` · 可读性 ${media.qc.readabilityScore.toFixed(1)}` : ''}
              </p>
              {media.qc.failReasons?.length ? (
                <p className="text-[10px] text-amber-700 dark:text-amber-300">
                  归因：{media.qc.failReasons.map((x) => FIX_TARGET_LABELS[x]).join('、')}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Expand / collapse */}
        <div className="h-4">
          {shot.visualPrompt && shot.visualPrompt.length > 80 && (
            <button
              type="button"
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-0.5 self-start"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? '收起' : '展开'}
            </button>
          )}
        </div>

        {(shot.isFlashback || shot.isPreview) && (
          <p className="text-[10px] text-muted-foreground text-center">
            {shot.isFlashback ? '闪回镜头' : '预览镜头'}（自动复用）
          </p>
        )}

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
}

const ShotVideoCard: React.FC<ShotVideoCardProps> = ({
  shot,
  media,
  aspectRatio,
  consistencyRisk,
  cameraRisk,
}) => {
  const hasVideo = !!media?.videoUrl;
  const hasImage = !!media?.imageUrl;
  const isSubmitted = media?.status === 'submitted';

  const containerClass = aspectRatio === '9:16'
    ? 'aspect-[9/16] w-full max-w-[140px] mx-auto'
    : 'aspect-[16/9] w-full';

  return (
    <div className={cn(
      'rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden flex flex-col',
      shot.qualityTier === 'golden' ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-800' : '',
      hasVideo && shot.qualityTier !== 'golden' ? 'border-emerald-200 dark:border-emerald-800' : '',
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
          {hasVideo ? (
            <video
              src={media!.videoUrl!}
              className="absolute inset-0 w-full h-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
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
      <div className="px-3 pb-3 pt-1">
        <p className="text-xs text-muted-foreground line-clamp-2">{shot.visualPrompt}</p>
        {shot.dialogue?.text && (
          <p className="text-xs text-foreground/70 italic line-clamp-1 mt-1">「{shot.dialogue.text}」</p>
        )}
        {media?.qc?.failReasons?.length ? (
          <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
            归因：{media.qc.failReasons.map((x) => FIX_TARGET_LABELS[x]).join('、')}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground mt-1">{shot.estimatedDurationSec}s</p>
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

// ─── Pipeline step indicator ────────────────────────────────────────────────────

function PipelineStep({ icon, label, status }: { icon: React.ReactNode; label: string; status: 'done' | 'partial' | 'idle' }) {
  return (
    <div className={cn(
      'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0',
      status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
      status === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
      'bg-muted text-muted-foreground',
    )}>
      {icon}{label}
      {status === 'done' && <CheckCircle2 className="w-3 h-3 ml-0.5" />}
    </div>
  );
}

function PipelineArrow() {
  return <span className="text-muted-foreground/40 shrink-0">→</span>;
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
  { shot, consistencyRisk, cameraRisk }: { shot: Shot; consistencyRisk?: boolean; cameraRisk?: boolean },
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
                  {c.characterId} — {c.action}（{c.emotion}）
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

  // Batch image generation state (SSE)
  const [isGeneratingImages, setIsGeneratingImages] = useState(false);
  const [imageBatchProgress, setImageBatchProgress] = useState({ current: 0, total: 0, message: '' });

  // Batch video generation state (SSE)
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [videoBatchProgress, setVideoBatchProgress] = useState({ current: 0, total: 0, message: '' });
  const [problemResetMode, setProblemResetMode] = useState<'all' | 'high' | QcFixTarget | null>(null);
  const [sortMode, setSortMode] = useState<'story' | 'priority'>('story');

  const imagesSseRef = useRef<AbortController | null>(null);
  const videosSseRef = useRef<AbortController | null>(null);

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
    ]).finally(() => setLoading(false));
  }, [dramaId, episodeNumber]);

  // Clean up SSE on unmount
  useEffect(() => () => {
    imagesSseRef.current?.abort();
    videosSseRef.current?.abort();
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────────

  const storyOrderedShots: Shot[] = [...(episode?.storyboard?.shots ?? [])].sort((a, b) => a.shotIndex - b.shotIndex);
  const displayShots: Shot[] = sortMode === 'priority' ? sortShotsByPriority(storyOrderedShots) : storyOrderedShots;
  const shotMediaMap: Record<string, ShotMediaEntry> = (episode?.shotMediaMap ?? {}) as Record<string, ShotMediaEntry>;
  const consistencyRiskSet = new Set((episode?.review?.consistencyRiskShots ?? []).map((r) => r.shotId));
  const cameraRiskSet = new Set((episode?.review?.cameraReadabilityRiskShots ?? []).map((r) => r.shotId));
  const reviewRiskShotSet = new Set<string>([...consistencyRiskSet, ...cameraRiskSet]);
  const readinessScore = episode?.review?.generationReadinessScore;
  const aspectRatio: '9:16' | '16:9' = ((drama as any)?.state?.audienceDirective?.aspectRatio ?? '9:16') as '9:16' | '16:9';

  const imageCount = storyOrderedShots.filter(s => shotMediaMap[s.shotId]?.imageUrl).length;
  const videoCount = storyOrderedShots.filter(s => shotMediaMap[s.shotId]?.videoUrl).length;
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
        setEpisode(prev => prev ? {
          ...prev,
          shotMediaMap: {
            ...prev.shotMediaMap,
            [shotId]: { ...(prev.shotMediaMap?.[shotId] ?? {}), imageUrl: result.imageUrl, status: 'image_done' },
          },
        } : prev);
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-[57px] z-30 border-b bg-background/95 backdrop-blur-sm px-4 h-12 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => history.push(`/novel/drama/${dramaId}`)}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-muted-foreground truncate">{dramaTitleRaw}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-semibold truncate">{episodeTitle}</span>
          </div>
        </div>

        {/* Episode navigator */}
        <div className="flex items-center gap-1 shrink-0 max-w-[40%] overflow-x-auto scrollbar-none">
          {episodes.map(ep => (
            <button
              key={ep.episodeNumber}
              type="button"
              onClick={() => history.push(`/novel/drama/${dramaId}/episodes/${ep.episodeNumber}`)}
              className={cn(
                'w-6 h-6 rounded text-[10px] font-mono transition-colors shrink-0',
                ep.episodeNumber === episodeNumber
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground',
              )}
            >
              {ep.episodeNumber}
            </button>
          ))}
        </div>
      </header>

      {/* ─── Pipeline progress ───────────────────────────────────────────────── */}
      <div className="sticky top-[105px] z-20 border-b px-4 py-2 bg-muted/30 backdrop-blur-sm flex items-center gap-4 text-sm overflow-x-auto">
        <PipelineStep icon={<Film className="w-3.5 h-3.5" />} label="脚本" status="done" />
        <PipelineArrow />
        <PipelineStep
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          label={`分镜图 ${imageCount}/${totalShots}`}
          status={imageCount === totalShots ? 'done' : imageCount > 0 ? 'partial' : 'idle'}
        />
        <PipelineArrow />
        <PipelineStep
          icon={<Video className="w-3.5 h-3.5" />}
          label={`视频 ${videoCount}/${totalShots}`}
          status={videoCount === totalShots ? 'done' : videoCount > 0 ? 'partial' : 'idle'}
        />
        <PipelineArrow />
        <PipelineStep
          icon={<ZapIcon className="w-3.5 h-3.5" />}
          label="合成"
          status={episode.videoUrl ? 'done' : 'idle'}
        />

        {episode.videoUrl && (
          <a
            href={episode.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0"
          >
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
              <Play className="w-3 h-3" />预览成片
            </Button>
          </a>
        )}
      </div>

      {/* ─── Main content ────────────────────────────────────────────────────── */}
      <Tabs defaultValue="images" className="flex-1 flex flex-col">
        <div className="mx-4 mt-3 flex items-center justify-between gap-2">
          <TabsList className="w-auto self-start">
            <TabsTrigger value="script" className="gap-1.5 text-xs">
              <Film className="w-3.5 h-3.5" />分镜脚本
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{totalShots}</Badge>
            </TabsTrigger>
            <TabsTrigger value="images" className="gap-1.5 text-xs">
              <ImageIcon className="w-3.5 h-3.5" />图片制作
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

        {problemShotCount > 0 && (
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
              {storyOrderedShots.map((shot) => (
                <ScriptShotRow
                  key={shot.shotId}
                  shot={shot}
                  consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                  cameraRisk={cameraRiskSet.has(shot.shotId)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ── 图片制作 tab ──────────────────────────────────────────────────── */}
        <TabsContent value="images" className="flex-1 mt-0 flex flex-col">
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
            <div className={cn(
              'p-4 grid gap-3',
              aspectRatio === '9:16'
                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
            )}>
              {displayShots.map(shot => (
                <ShotImageCard
                  key={shot.shotId}
                  shot={shot}
                  media={shotMediaMap[shot.shotId]}
                  aspectRatio={aspectRatio}
                  generating={generatingImageShots.has(shot.shotId)}
                  busy={isGeneratingImages || isGeneratingVideos || problemResetMode !== null}
                  consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                  cameraRisk={cameraRiskSet.has(shot.shotId)}
                  onGenerate={() => handleGenerateShotImage(shot.shotId)}
                />
              ))}
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
            <div className={cn(
              'p-4 grid gap-3',
              aspectRatio === '9:16'
                ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'
                : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
            )}>
              {displayShots.map(shot => (
                <ShotVideoCard
                  key={shot.shotId}
                  shot={shot}
                  media={shotMediaMap[shot.shotId]}
                  aspectRatio={aspectRatio}
                  consistencyRisk={consistencyRiskSet.has(shot.shotId)}
                  cameraRisk={cameraRiskSet.has(shot.shotId)}
                />
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EpisodeProductionBoard;
