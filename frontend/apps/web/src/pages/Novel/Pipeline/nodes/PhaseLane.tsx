import { type NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';

const LANE_STYLE: Record<string, string> = {
  preparation: 'border-blue-300/35 bg-blue-100/14 dark:bg-blue-950/10',
  quality_loop: 'border-violet-300/50 bg-violet-100/22 dark:bg-violet-950/16',
  post_process: 'border-emerald-300/35 bg-emerald-100/14 dark:bg-emerald-950/10',
  recording: 'border-rose-300/22 bg-rose-100/8 dark:bg-rose-950/6',
};
const TAG_STYLE: Record<string, string> = {
  preparation: 'border-blue-300/55 bg-blue-100/80 text-blue-700 dark:bg-blue-950/55 dark:text-blue-300',
  quality_loop: 'border-violet-300/70 bg-violet-100/90 text-violet-800 dark:bg-violet-950/70 dark:text-violet-200',
  post_process: 'border-emerald-300/55 bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/55 dark:text-emerald-300',
  recording: 'border-rose-300/40 bg-rose-100/68 text-rose-700 dark:bg-rose-950/42 dark:text-rose-300',
};
const PHASE_TEXT: Record<string, string> = {
  preparation: '准备阶段',
  quality_loop: '质量门控循环',
  post_process: '后处理',
  recording: '知识记录',
};
const PHASE_ICON: Record<string, string> = {
  preparation: '📋',
  quality_loop: '🔄',
  post_process: '✨',
  recording: '💾',
};

export interface PhaseLaneData { phaseId: string; height: number }

export function PhaseLane({ data }: NodeProps<PhaseLaneData>) {
  return (
    <div
      className={cn(
        'relative w-[940px] rounded-2xl border backdrop-blur-[1px] pointer-events-none',
        LANE_STYLE[data.phaseId] ?? 'border-border/30 bg-muted/10',
      )}
      style={{ height: data.height }}
    >
      <div className={cn(
        'absolute left-3 top-3 h-6 px-2 rounded-md border shadow-sm flex items-center gap-1.5 text-[10px] font-semibold tracking-wide',
        TAG_STYLE[data.phaseId] ?? 'border-border/60 bg-card/80 text-foreground/80',
      )}>
        <span className="leading-none">{PHASE_ICON[data.phaseId] ?? '📌'}</span>
        <span>{PHASE_TEXT[data.phaseId] ?? data.phaseId}</span>
      </div>
    </div>
  );
}
