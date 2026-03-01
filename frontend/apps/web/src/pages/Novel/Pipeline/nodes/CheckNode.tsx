import { Handle, Position, type NodeProps } from 'reactflow';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WfNode } from '@/services/novel';
import { HANDLE_CLS, NODE_SIZE } from '../node-shape-tokens';
import { NODE_TEXT } from '../node-text-tokens';

export interface CheckNodeData extends WfNode {
  isSelected?: boolean;
  status?: string;
  showTopHandle?: boolean;
  showLeftHandle?: boolean;
  showRightHandle?: boolean;
  showBottomSourceHandle?: boolean;
}

export function CheckNode({ data, selected }: NodeProps<CheckNodeData>) {
  const pass = data.status === 'completed', fail = data.status === 'failed';
  const running = data.status === 'running', skipped = data.status === 'skipped';
  const sideHidden = HANDLE_CLS.hidden;
  const sideVisible = `${HANDLE_CLS.side} !bg-sky-400/50 !z-10`;
  const HEX = 'M22 2 L202 2 L222 40 L202 78 L22 78 L2 40Z';
  return (
    <div className={cn('relative flex items-center justify-center', skipped && 'opacity-40')} style={{ width: NODE_SIZE.checkNode.w, height: NODE_SIZE.checkNode.h }}>
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-sky-400/50 !z-10`} />}
      <Handle type="target" position={Position.Left} id="left" className={cn(data.showLeftHandle ? sideVisible : sideHidden)} />
      <Handle type="target" position={Position.Right} id="right" className={cn(data.showRightHandle ? sideVisible : sideHidden)} />
      <svg className="absolute inset-0 w-full h-full drop-shadow-sm" viewBox={`0 0 ${NODE_SIZE.checkNode.w} ${NODE_SIZE.checkNode.h}`} fill="none">
        <path d={HEX} className={cn('transition-all duration-200',
          pass ? 'fill-emerald-50/80 dark:fill-emerald-950/40 stroke-emerald-400' :
          fail ? 'fill-red-50/80 dark:fill-red-950/40 stroke-red-400' :
          running ? 'fill-blue-50/80 dark:fill-blue-950/40 stroke-blue-400' :
          'fill-sky-50/80 dark:fill-sky-950/40 stroke-sky-400/70',
        )} strokeWidth={selected ? 2.5 : 2} strokeLinejoin="round" />
        {selected && <path d={HEX} className="fill-transparent stroke-primary" strokeWidth="3" strokeLinejoin="round" strokeDasharray="6 3" opacity="0.4" />}
        {running && <path d={HEX} className="fill-blue-400/10 animate-pulse" />}
      </svg>
      <div className="relative z-10 flex items-center gap-2 max-w-[160px]">
        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
          pass ? 'bg-emerald-100/80 dark:bg-emerald-900/40' : fail ? 'bg-red-100/80 dark:bg-red-900/40' : 'bg-sky-100/80 dark:bg-sky-900/40',
        )}>
          <ShieldCheck className={cn('h-4 w-4', pass ? 'text-emerald-500' : fail ? 'text-red-500' : 'text-sky-500')} />
        </div>
        <div className="min-w-0">
          <span className={cn(NODE_TEXT.title, 'block')}>{data.label}</span>
          {data.condition && <span className={cn(NODE_TEXT.subtitle, 'block mt-1 line-clamp-1')}>{data.condition}</span>}
        </div>
      </div>
      {pass && <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✓</div>}
      {fail && <div className="absolute right-0.5 top-1/2 -translate-y-1/2 z-20 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow-sm border-2 border-background">✗</div>}
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-sky-400/50 !z-10`} />}
    </div>
  );
}
