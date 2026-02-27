import { Handle, Position, type NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoopGroupData {
  label: string; condition?: string;
  status?: string; currentAttempt?: number; maxAttempts?: number; lastScore?: number;
}

export function LoopEntryNode({ data, selected }: NodeProps<LoopGroupData>) {
  const running = data.status === 'running';
  return (
    <div className={cn(
      'relative w-60 rounded-xl border-2 border-dashed shadow-sm transition-all duration-200',
      'border-violet-400/60 bg-gradient-to-b from-violet-50/60 to-violet-50/20 dark:from-violet-950/30 dark:to-violet-950/10',
      selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
      running && 'ring-2 ring-violet-400 shadow-md',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-violet-400/50 !border-2 !border-background" />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
            running ? 'bg-violet-200 dark:bg-violet-800/60' : 'bg-violet-100 dark:bg-violet-900/40',
          )}>
            <RefreshCw className={cn('h-4 w-4 text-violet-500', running && 'animate-spin')} />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-bold text-foreground leading-tight block">{data.label}</span>
            {data.condition && <span className="text-[9px] text-muted-foreground leading-tight font-mono">{data.condition}</span>}
          </div>
        </div>
        {running && data.currentAttempt != null && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-violet-200/60 dark:bg-violet-800/30 overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${((data.currentAttempt) / (data.maxAttempts ?? 3)) * 100}%` }} />
            </div>
            <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400 tabular-nums shrink-0">{data.currentAttempt}/{data.maxAttempts ?? '?'}</span>
            {data.lastScore != null && <span className="text-[10px] text-muted-foreground shrink-0">({data.lastScore}分)</span>}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-400/50 !border-2 !border-background" />
    </div>
  );
}

export function LoopExitNode({ data, selected }: NodeProps<LoopGroupData>) {
  return (
    <div className={cn(
      'relative w-60 rounded-xl border-2 border-dashed shadow-sm transition-all duration-200',
      'border-violet-400/40 bg-violet-50/20 dark:bg-violet-950/10',
      selected && 'ring-2 ring-primary ring-offset-2',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-violet-400/50 !border-2 !border-background" />
      <div className="flex items-center gap-2 justify-center px-3 py-2">
        <div className="h-px flex-1 bg-violet-300/40" />
        <span className="text-[10px] font-medium text-violet-500/80">{data.label ?? '循环出口'}</span>
        <div className="h-px flex-1 bg-violet-300/40" />
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-violet-400/50 !border-2 !border-background" />
    </div>
  );
}
