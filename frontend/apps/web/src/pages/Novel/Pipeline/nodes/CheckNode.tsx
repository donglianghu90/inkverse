import { Handle, Position, type NodeProps } from 'reactflow';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';

export interface CheckNodeData extends WfNode { isSelected?: boolean; status?: string }

export function CheckNode({ data, selected }: NodeProps<CheckNodeData>) {
  const pass = data.status === 'completed';
  const fail = data.status === 'failed';
  return (
    <div className={cn(
      'relative w-48 rounded-lg border-2 shadow-sm px-3 py-2 transition-all',
      'border-sky-400/60 bg-sky-50/50 dark:bg-sky-950/30',
      selected && 'ring-2 ring-primary ring-offset-2',
      data.status === 'running' && 'ring-2 ring-blue-400 animate-pulse',
      data.status === 'skipped' && 'opacity-40',
    )}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className="flex items-center gap-2">
        <ShieldCheck className={cn('h-4 w-4 shrink-0', pass ? 'text-emerald-500' : fail ? 'text-red-500' : 'text-sky-500')} />
        <span className="text-xs font-semibold text-foreground">{data.label}</span>
      </div>
      {pass && <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px]">✓</span>}
      {fail && <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[9px]">✗</span>}
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
    </div>
  );
}
