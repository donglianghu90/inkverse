import { Handle, Position, type NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';

export interface ConditionNodeData extends WfNode { isSelected?: boolean; status?: string }

export function ConditionNode({ data, selected }: NodeProps<ConditionNodeData>) {
  const statusColor = { running: 'ring-blue-400 animate-pulse', completed: 'ring-emerald-400', skipped: 'opacity-40', failed: 'ring-red-400' }[data.status ?? ''] ?? '';
  return (
    <div className={cn('relative flex items-center justify-center', statusColor && `ring-2 ${statusColor}`)}>
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      <div className={cn(
        'w-40 h-24 rotate-45 rounded-lg border-2 border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/30 shadow-sm transition-all',
        selected && 'ring-2 ring-primary ring-offset-2',
      )}>
        <div className="-rotate-45 flex flex-col items-center justify-center h-full px-2">
          <span className="text-xs font-semibold text-foreground text-center leading-tight">{data.label}</span>
          {data.condition && <span className="text-[10px] text-muted-foreground text-center leading-tight mt-0.5 line-clamp-2">{data.condition}</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background" />
      {data.status === 'completed' && <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px]">✓</div>}
      {data.status === 'skipped' && <div className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[9px]">⏭</div>}
    </div>
  );
}
