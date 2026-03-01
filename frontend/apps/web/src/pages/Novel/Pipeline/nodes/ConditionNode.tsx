import { Handle, Position, type NodeProps } from 'reactflow';
import { Diamond } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';
import { HANDLE_CLS, NODE_SIZE } from '../node-shape-tokens';
import { NODE_TEXT } from '../node-text-tokens';

export interface ConditionNodeData extends WfNode {
  isSelected?: boolean;
  status?: string;
  statusMessage?: string;
  showTopHandle?: boolean;
  showBottomSourceHandle?: boolean;
  showLeftSourceHandle?: boolean;
  showRightSourceHandle?: boolean;
}

export function ConditionNode({ data, selected }: NodeProps<ConditionNodeData>) {
  const running = data.status === 'running', completed = data.status === 'completed';
  const failed = data.status === 'failed', skipped = data.status === 'skipped';
  const showFalseHint = !!data.showLeftSourceHandle;
  const showTrueHint = !!data.showRightSourceHandle;
  return (
    <div className={cn('relative flex items-center justify-center', skipped && 'opacity-40')} style={{ width: NODE_SIZE.conditionNode.w, height: NODE_SIZE.conditionNode.h }}>
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-amber-400/60 !z-10`} />}
      <svg className="absolute inset-0 w-full h-full drop-shadow-sm" viewBox={`0 0 ${NODE_SIZE.conditionNode.w} ${NODE_SIZE.conditionNode.h}`} fill="none">
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
        <Diamond className={cn('h-3 w-3 mb-1', completed ? 'text-emerald-500' : failed ? 'text-red-500' : running ? 'text-blue-500' : 'text-amber-500')} />
        <span className={NODE_TEXT.title}>{data.label}</span>
        {data.condition && <span className={cn(NODE_TEXT.subtitle, 'mt-1 line-clamp-1')}>{data.condition}</span>}
      </div>
      {completed && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✓</div>}
      {failed && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✗</div>}
      {skipped && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] border-2 border-background">⏭</div>}
      {showFalseHint && <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 text-[9px] font-semibold text-muted-foreground/80 bg-background/75 border border-border/50 rounded px-1">否</div>}
      {showTrueHint && <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 text-[9px] font-semibold text-emerald-600/90 bg-background/75 border border-emerald-400/40 rounded px-1">是</div>}
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-amber-400/60 !z-10`} />}
      {data.showLeftSourceHandle && <Handle type="source" position={Position.Left} id="left" className={`${HANDLE_CLS.side} !bg-muted-foreground/50 !z-10`} />}
      {data.showRightSourceHandle && <Handle type="source" position={Position.Right} id="right" className={`${HANDLE_CLS.side} !bg-emerald-400/70 !z-10`} />}
    </div>
  );
}
