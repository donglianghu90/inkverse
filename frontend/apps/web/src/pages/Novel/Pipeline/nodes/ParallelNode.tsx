import { Handle, Position, type NodeProps } from 'reactflow';
import { GitFork, GitMerge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HANDLE_CLS, NODE_SIZE } from '../node-shape-tokens';
import { NODE_TEXT } from '../node-text-tokens';

export interface ParallelNodeData {
  label: string; status?: string;
  showTopHandle?: boolean; showLeftHandle?: boolean; showRightHandle?: boolean;
  showBottomSourceHandle?: boolean; showLeftSourceHandle?: boolean; showRightSourceHandle?: boolean;
}

export function ParallelForkNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative rounded-lg border border-teal-400/40 shadow-sm transition-all duration-200',
      'bg-gradient-to-b from-teal-50/50 to-white/30 dark:from-teal-950/30 dark:to-transparent',
      selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
      data.status === 'running' && 'ring-2 ring-teal-400 animate-pulse',
    )} style={{ width: NODE_SIZE.parallelFork.w, minHeight: NODE_SIZE.parallelFork.h }}>
      <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-transparent via-teal-400/70 to-transparent" />
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-teal-400/50`} />}
      <div className="flex items-center gap-2 px-4 py-2 justify-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/40">
          <GitFork className="h-3.5 w-3.5 text-teal-500" />
        </div>
        <span className={NODE_TEXT.title}>{data.label}</span>
      </div>
      <div className="flex justify-center gap-3 pb-1 opacity-50">
        <div className="w-4 h-[2px] rounded-full bg-teal-400 origin-right rotate-[12deg]" />
        <div className="w-4 h-[2px] rounded-full bg-teal-400" />
        <div className="w-4 h-[2px] rounded-full bg-teal-400 origin-left -rotate-[12deg]" />
      </div>
      <div className="h-[3px] rounded-b-lg bg-gradient-to-r from-transparent via-teal-400/70 to-transparent" />
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-teal-400/50`} />}
      {data.showLeftSourceHandle && <Handle type="source" position={Position.Left} id="left" className={`${HANDLE_CLS.side} !bg-teal-400/50`} />}
      {data.showRightSourceHandle && <Handle type="source" position={Position.Right} id="right" className={`${HANDLE_CLS.side} !bg-teal-400/50`} />}
    </div>
  );
}

export function ParallelJoinNode({ data, selected }: NodeProps<ParallelNodeData>) {
  return (
    <div className={cn(
      'relative rounded-lg border border-teal-400/40 shadow-sm transition-all duration-200',
      'bg-gradient-to-t from-teal-50/50 to-white/30 dark:from-teal-950/30 dark:to-transparent',
      selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
      data.status === 'running' && 'ring-2 ring-teal-400 animate-pulse',
    )} style={{ width: NODE_SIZE.parallelJoin.w, minHeight: NODE_SIZE.parallelJoin.h }}>
      <div className="h-[3px] rounded-t-lg bg-gradient-to-r from-transparent via-teal-400/70 to-transparent" />
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className={`${HANDLE_CLS.top} !bg-teal-400/50`} />}
      {data.showLeftHandle && <Handle type="target" position={Position.Left} id="left" className={`${HANDLE_CLS.side} !bg-teal-400/50`} />}
      {data.showRightHandle && <Handle type="target" position={Position.Right} id="right" className={`${HANDLE_CLS.side} !bg-teal-400/50`} />}
      <div className="flex justify-center gap-3 pt-1 opacity-50">
        <div className="w-4 h-[2px] rounded-full bg-teal-400 origin-right -rotate-[12deg]" />
        <div className="w-4 h-[2px] rounded-full bg-teal-400" />
        <div className="w-4 h-[2px] rounded-full bg-teal-400 origin-left rotate-[12deg]" />
      </div>
      <div className="flex items-center gap-2 px-4 py-2 justify-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-teal-100 dark:bg-teal-900/40">
          <GitMerge className="h-3.5 w-3.5 text-teal-500" />
        </div>
        <span className={NODE_TEXT.title}>{data.label}</span>
      </div>
      <div className="h-[3px] rounded-b-lg bg-gradient-to-r from-transparent via-teal-400/70 to-transparent" />
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className={`${HANDLE_CLS.top} !bg-teal-400/50`} />}
    </div>
  );
}
