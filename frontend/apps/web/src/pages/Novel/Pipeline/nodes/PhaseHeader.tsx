import { type NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';

const PHASE_STYLE: Record<string, string> = {
  preparation: 'bg-blue-100/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300/60',
  quality_loop: 'bg-violet-100/70 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-300/60',
  post_process: 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300/60',
  recording: 'bg-rose-100/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300/60',
};

const PHASE_ICON: Record<string, string> = { preparation: '📋', quality_loop: '🔄', post_process: '✨', recording: '💾' };

const PHASE_ACCENT: Record<string, string> = {
  preparation: 'bg-blue-500', quality_loop: 'bg-violet-500', post_process: 'bg-emerald-500', recording: 'bg-rose-500',
};

export interface PhaseHeaderData { label: string; phaseId: string }

export function PhaseHeader({ data }: NodeProps<PhaseHeaderData>) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-xl border px-5 py-2.5 shadow-sm pointer-events-none select-none',
      PHASE_STYLE[data.phaseId] ?? 'bg-muted border-border text-muted-foreground',
    )}>
      <div className={cn('h-6 w-1 rounded-full', PHASE_ACCENT[data.phaseId] ?? 'bg-muted-foreground')} />
      <span className="text-base leading-none">{PHASE_ICON[data.phaseId] ?? '📌'}</span>
      <span className="text-xs font-bold tracking-wider uppercase">{data.label}</span>
    </div>
  );
}
