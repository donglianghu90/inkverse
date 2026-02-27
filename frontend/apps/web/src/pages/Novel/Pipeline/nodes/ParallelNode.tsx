import { Handle, Position, type NodeProps } from 'reactflow';
import { GitFork, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ParallelNodeData { label: string; status?: string }

export function ParallelForkNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative w-52 rounded-xl border-2 border-dashed shadow-sm transition-all duration-200',
      'border-teal-400/50 bg-gradient-to-b from-teal-50/60 to-transparent dark:from-teal-950/30 dark:to-transparent',
      selected && 'ring-2 ring-primary ring-offset-2',
      data.status === 'running' && 'ring-2 ring-teal-400 animate-pulse',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-400/50 !border-2 !border-background" />
      <div className="flex items-center gap-2.5 px-3.5 py-2 justify-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/40">
          <GitFork className="h-3.5 w-3.5 text-teal-500" />
        </div>
        <span className="text-[11px] font-semibold text-foreground">{data.label}</span>
      </div>
      <div className="flex justify-center gap-5 pb-2 opacity-50">
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-teal-400/50 !border-2 !border-background" />
    </div>
  );
}

export function ParallelJoinNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative w-52 rounded-xl border-2 border-dashed shadow-sm transition-all duration-200',
      'border-teal-400/50 bg-gradient-to-t from-teal-50/60 to-transparent dark:from-teal-950/30 dark:to-transparent',
      selected && 'ring-2 ring-primary ring-offset-2',
      data.status === 'running' && 'ring-2 ring-teal-400 animate-pulse',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-400/50 !border-2 !border-background" />
      <div className="flex justify-center gap-5 pt-2 opacity-50">
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
        <div className="h-0.5 w-6 rounded-full bg-teal-400" />
      </div>
      <div className="flex items-center gap-2.5 px-3.5 py-2 justify-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/40">
          <GitMerge className="h-3.5 w-3.5 text-teal-500" />
        </div>
        <span className="text-[11px] font-semibold text-foreground">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-teal-400/50 !border-2 !border-background" />
    </div>
  );
}
