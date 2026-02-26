import { Handle, Position, type NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LoopGroupData {
  label: string;
  condition?: string;
  status?: string; // 'idle' | 'running' | 'completed'
  currentAttempt?: number;
  maxAttempts?: number;
  lastScore?: number;
}

export function LoopEntryNode({ data, selected }: NodeProps<LoopGroupData>) {
  return (
    <div className={cn(
      'relative w-56 rounded-t-xl border-2 border-b-0 border-dashed shadow-sm px-4 py-3 transition-all',
      'border-violet-400/60 bg-violet-50/40 dark:bg-violet-950/20',
      selected && 'ring-2 ring-primary ring-offset-2',
      data.status === 'running' && 'ring-2 ring-violet-400 animate-pulse',
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className="flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-violet-500 shrink-0" />
        <span className="text-xs font-bold text-foreground">{data.label}</span>
      </div>
      {data.condition && <p className="text-[10px] text-muted-foreground mt-1">{data.condition}</p>}
      {data.status === 'running' && data.currentAttempt && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-violet-600">第 {data.currentAttempt}/{data.maxAttempts ?? '?'} 轮</span>
          {data.lastScore != null && <span className="text-[10px] text-muted-foreground">分数: {data.lastScore}</span>}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
    </div>
  );
}

export function LoopExitNode({ data, selected }: NodeProps<LoopGroupData>) {
  return (
    <div className={cn(
      'relative w-56 rounded-b-xl border-2 border-t-0 border-dashed shadow-sm px-4 py-2 transition-all',
      'border-violet-400/60 bg-violet-50/40 dark:bg-violet-950/20',
      selected && 'ring-2 ring-primary ring-offset-2',
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className="flex items-center gap-2 justify-center">
        <span className="text-[10px] text-muted-foreground">{data.label ?? '循环出口'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
    </div>
  );
}
