import { Handle, Position, type NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HANDLE_CLS, NODE_SIZE } from '../node-shape-tokens';
import { NODE_TEXT } from '../node-text-tokens';

export interface LoopGroupData {
  label: string; condition?: string;
  status?: string; currentAttempt?: number; maxAttempts?: number; lastScore?: number;
  showTopHandle?: boolean; showLeftHandle?: boolean; showRightHandle?: boolean;
  showBottomSourceHandle?: boolean;
}

export function LoopEntryNode({ data, selected }: NodeProps<LoopGroupData>) {
  const running = data.status === 'running';
  return (
    <div className={cn(
      'relative rounded-2xl border-2 shadow-sm transition-all duration-200',
      'border-violet-400/50 bg-gradient-to-b from-violet-50/60 to-violet-50/20 dark:from-violet-950/30 dark:to-violet-950/10',
      selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
      running && 'ring-2 ring-violet-400 shadow-md',
    )} style={{ width: NODE_SIZE.loopEntry.w, minHeight: NODE_SIZE.loopEntry.h }}>
      <div className={cn(
        'absolute -top-2.5 -left-2.5 h-6 w-6 rounded-full flex items-center justify-center border-2 border-background shadow-sm z-10',
        running ? 'bg-violet-200 dark:bg-violet-800/60' : 'bg-violet-100 dark:bg-violet-900/40',
      )}>
        <RefreshCw className={cn('h-3 w-3 text-violet-500', running && 'animate-spin')} />
      </div>
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-violet-400/50`} />}
      {data.showLeftHandle && <Handle type="target" position={Position.Left} id="left" className={`${HANDLE_CLS.side} !bg-violet-400/50`} />}
      {data.showRightHandle && <Handle type="target" position={Position.Right} id="right" className={`${HANDLE_CLS.side} !bg-violet-400/50`} />}
      <div className="px-4 py-3 pl-6 min-h-[4rem]">
        <div className="min-w-0">
          <span className={cn(NODE_TEXT.title, 'font-bold block')}>{data.label}</span>
          {data.condition && <span className={cn(NODE_TEXT.subtitle, 'block mt-1')}>{data.condition}</span>}
        </div>
        {running && data.currentAttempt != null && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-violet-200/60 dark:bg-violet-800/30 overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: `${((data.currentAttempt) / (data.maxAttempts ?? 3)) * 100}%` }} />
            </div>
            <span className={cn(NODE_TEXT.accentMeta, 'text-violet-600 dark:text-violet-400 tabular-nums shrink-0')}>{data.currentAttempt}/{data.maxAttempts ?? '?'}</span>
            {data.lastScore != null && <span className={cn(NODE_TEXT.meta, 'shrink-0')}>({data.lastScore}分)</span>}
          </div>
        )}
      </div>
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-violet-400/50`} />}
    </div>
  );
}

export function LoopExitNode({ data, selected }: NodeProps<LoopGroupData>) {
  return (
    <div className={cn(
      'relative rounded-full border border-violet-400/30 bg-violet-50/20 dark:bg-violet-950/10 shadow-sm transition-all',
      selected && 'ring-2 ring-primary ring-offset-2',
    )} style={{ width: NODE_SIZE.loopExit.w, minHeight: NODE_SIZE.loopExit.h }}>
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-violet-400/50`} />}
      <div className="flex items-center justify-center h-8 gap-1.5 px-4">
        <div className="h-px flex-1 max-w-8 bg-violet-300/40" />
        <span className={cn(NODE_TEXT.accentMeta, 'text-violet-500/80')}>{data.label ?? '循环出口'}</span>
        <div className="h-px flex-1 max-w-8 bg-violet-300/40" />
      </div>
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-violet-400/50`} />}
    </div>
  );
}
