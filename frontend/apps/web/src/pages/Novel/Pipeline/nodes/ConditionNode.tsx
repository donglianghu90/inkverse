import { Handle, Position, type NodeProps } from 'reactflow';
import { Diamond } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';

export interface ConditionNodeData extends WfNode { isSelected?: boolean; status?: string; statusMessage?: string }

export function ConditionNode({ data, selected }: NodeProps<ConditionNodeData>) {
  const running = data.status === 'running', completed = data.status === 'completed';
  const failed = data.status === 'failed', skipped = data.status === 'skipped';
  return (
    <div className={cn('relative flex items-center justify-center', skipped && 'opacity-40')} style={{ width: 200, height: 112 }}>
      <Handle type="target" position={Position.Top} id="top" className="!w-3 !h-3 !bg-amber-400/60 !border-2 !border-background !z-10" />
      <svg className="absolute inset-0 w-full h-full drop-shadow-sm" viewBox="0 0 200 112" fill="none">
        <path
          d="M100 6 L192 56 L100 106 L8 56 Z"
          className={cn(
            'transition-all duration-200',
            completed ? 'fill-emerald-50/80 dark:fill-emerald-950/40 stroke-emerald-400' :
            failed ? 'fill-red-50/80 dark:fill-red-950/40 stroke-red-400' :
            running ? 'fill-blue-50/80 dark:fill-blue-950/40 stroke-blue-400' :
            'fill-amber-50/80 dark:fill-amber-950/40 stroke-amber-400/70',
          )}
          strokeWidth={selected ? 2.5 : 2} strokeLinejoin="round"
        />
        {selected && <path d="M100 6 L192 56 L100 106 L8 56 Z" className="fill-transparent stroke-primary" strokeWidth="3" strokeLinejoin="round" strokeDasharray="6 3" opacity="0.4" />}
        {running && <path d="M100 6 L192 56 L100 106 L8 56 Z" className="fill-blue-400/10 animate-pulse" />}
      </svg>
      <div className="relative z-10 flex flex-col items-center text-center max-w-[110px]">
        <Diamond className={cn('h-3 w-3 mb-0.5', completed ? 'text-emerald-500' : failed ? 'text-red-500' : running ? 'text-blue-500' : 'text-amber-500')} />
        <span className="text-[11px] font-semibold text-foreground leading-tight">{data.label}</span>
        {data.condition && <span className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-1 font-mono">{data.condition}</span>}
      </div>
      {completed && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✓</div>}
      {failed && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✗</div>}
      {skipped && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] border-2 border-background">⏭</div>}
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-3 !h-3 !bg-amber-400/60 !border-2 !border-background !z-10" />
      <Handle type="source" position={Position.Left} id="left" className="!w-2.5 !h-2.5 !bg-emerald-400/60 !border-2 !border-background !z-10" />
      <Handle type="source" position={Position.Right} id="right" className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background !z-10" />
    </div>
  );
}
