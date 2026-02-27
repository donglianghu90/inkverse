import { Handle, Position, type NodeProps } from 'reactflow';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';

export interface CheckNodeData extends WfNode { isSelected?: boolean; status?: string }

export function CheckNode({ data, selected }: NodeProps<CheckNodeData>) {
  const pass = data.status === 'completed', fail = data.status === 'failed';
  const running = data.status === 'running', skipped = data.status === 'skipped';
  return (
    <div className={cn(
      'relative w-56 rounded-xl border-2 shadow-sm transition-all duration-200',
      'border-sky-400/50 bg-gradient-to-r from-sky-50/70 to-sky-50/30 dark:from-sky-950/30 dark:to-sky-950/15',
      selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
      running && 'ring-2 ring-blue-400 animate-pulse shadow-md',
      skipped && 'opacity-40',
    )}>
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-sky-400/50 !border-2 !border-background" />
      <div className="px-3.5 py-2.5 flex items-center gap-2.5">
        <div className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
          pass ? 'bg-emerald-100 dark:bg-emerald-900/40' : fail ? 'bg-red-100 dark:bg-red-900/40' : 'bg-sky-100 dark:bg-sky-900/40',
        )}>
          <ShieldCheck className={cn('h-4 w-4', pass ? 'text-emerald-500' : fail ? 'text-red-500' : 'text-sky-500')} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-foreground leading-tight block">{data.label}</span>
          {data.condition && <span className="text-[9px] text-muted-foreground leading-tight block mt-0.5 line-clamp-1 font-mono">{data.condition}</span>}
        </div>
      </div>
      {pass && <div className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✓</div>}
      {fail && <div className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✗</div>}
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-sky-400/50 !border-2 !border-background" />
    </div>
  );
}
