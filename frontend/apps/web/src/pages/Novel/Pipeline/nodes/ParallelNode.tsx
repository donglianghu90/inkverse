import { Handle, Position, type NodeProps } from 'reactflow';
import { GitFork, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ParallelNodeData { label: string; status?: string }

export function ParallelForkNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative w-44 rounded-lg border-2 border-dashed shadow-sm px-3 py-2 transition-all',
      'border-teal-400/50 bg-teal-50/30 dark:bg-teal-950/20',
      selected && 'ring-2 ring-primary ring-offset-2',
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className="flex items-center gap-2 justify-center">
        <GitFork className="h-3.5 w-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-foreground">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
    </div>
  );
}

export function ParallelJoinNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative w-44 rounded-lg border-2 border-dashed shadow-sm px-3 py-2 transition-all',
      'border-teal-400/50 bg-teal-50/30 dark:bg-teal-950/20',
      selected && 'ring-2 ring-primary ring-offset-2',
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className="flex items-center gap-2 justify-center">
        <GitMerge className="h-3.5 w-3.5 text-teal-500" />
        <span className="text-[11px] font-medium text-foreground">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
    </div>
  );
}
