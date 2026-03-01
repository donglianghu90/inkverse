import { Handle, Position, NodeProps } from 'reactflow';
import { Lock, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNodeConfig } from '@/services/novel';
import { NODE_TEXT } from '../node-text-tokens';
import { NODE_SIZE } from '../node-shape-tokens';

const AGENT_META: Record<string, { icon: string; color: string; accent: string }> = {
  'arc-director':          { icon: '🎬', color: 'border-cyan-400/60 bg-cyan-50/50 dark:bg-cyan-950/30', accent: 'bg-cyan-400' },
  intent:                  { icon: '🧭', color: 'border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/30', accent: 'bg-blue-400' },
  'continuity-guard':      { icon: '🛡️', color: 'border-sky-400/60 bg-sky-50/50 dark:bg-sky-950/30', accent: 'bg-sky-400' },
  'scene-planner':         { icon: '🎯', color: 'border-teal-400/60 bg-teal-50/50 dark:bg-teal-950/30', accent: 'bg-teal-400' },
  'creative-writer':       { icon: '✍️', color: 'border-violet-400/60 bg-violet-50/50 dark:bg-violet-950/30', accent: 'bg-violet-400' },
  'scene-stitcher':        { icon: '🧵', color: 'border-indigo-400/60 bg-indigo-50/50 dark:bg-indigo-950/30', accent: 'bg-indigo-400' },
  reviewer:                { icon: '🔍', color: 'border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/30', accent: 'bg-amber-400' },
  'character-voice-coach': { icon: '🎙️', color: 'border-pink-400/60 bg-pink-50/50 dark:bg-pink-950/30', accent: 'bg-pink-400' },
  'pacing-analyzer':       { icon: '⏱️', color: 'border-orange-400/60 bg-orange-50/50 dark:bg-orange-950/30', accent: 'bg-orange-400' },
  editor:                  { icon: '✂️', color: 'border-emerald-400/60 bg-emerald-50/50 dark:bg-emerald-950/30', accent: 'bg-emerald-400' },
  'hook-crafter':          { icon: '🪝', color: 'border-yellow-400/60 bg-yellow-50/50 dark:bg-yellow-950/30', accent: 'bg-yellow-400' },
  recorder:                { icon: '📚', color: 'border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/30', accent: 'bg-rose-400' },
  'memory-retrieval':      { icon: '📡', color: 'border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/30', accent: 'bg-blue-400' },
  'text-analyzer':         { icon: '📝', color: 'border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/30', accent: 'bg-rose-400' },
  'world-extractor':       { icon: '🌍', color: 'border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/30', accent: 'bg-rose-400' },
  'narrative-extractor':   { icon: '📖', color: 'border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/30', accent: 'bg-rose-400' },
  custom:                  { icon: '⚡', color: 'border-purple-400/60 bg-purple-50/50 dark:bg-purple-950/30', accent: 'bg-purple-400' },
};

export interface AgentNodeData extends AgentNodeConfig {
  agentType?: string; // 拓扑层传入的原始 agent 类型，优先用于样式查找
  showTopHandle?: boolean;
  showLeftHandle?: boolean;
  showRightHandle?: boolean;
  showBottomSourceHandle?: boolean;
  showLeftSourceHandle?: boolean;
  showRightSourceHandle?: boolean;
  isSelected?: boolean;
  onDelete?: (id: string) => void;
  onToggle?: (id: string) => void;
  status?: string;
  statusMessage?: string;
  durationMs?: number;
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const agentKey = data.agentType ?? data.type; // agentType 由拓扑层提供，type 可能被 WfNode 的 "agent" 覆盖
  const meta = AGENT_META[agentKey] ?? AGENT_META.custom;
  const isCustom = agentKey === 'custom';
  const stepNum = typeof data.position === 'number' ? data.position + 1 : null;
  const sideHidden = '!w-0 !h-0 !opacity-0 !border-0 !min-w-0 !min-h-0';
  const sideVisible = '!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-2 !border-background';
  return (
    <div
      className={cn(
        'relative w-64 rounded-xl border-2 shadow-sm transition-all duration-200',
        meta.color,
        selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
        !data.isEnabled && 'opacity-45 grayscale',
        data.status === 'running' && 'ring-2 ring-blue-400 animate-pulse shadow-md',
        data.status === 'completed' && 'ring-2 ring-emerald-400',
        data.status === 'failed' && 'ring-2 ring-red-400',
        data.status === 'skipped' && 'opacity-40',
      )}
      style={{ minHeight: NODE_SIZE.agentNode.h }}
    >
      {stepNum != null && (
        <div className={cn(
          'absolute -left-3 top-5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold shadow-sm',
          data.isCore ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground border',
        )}>
          {stepNum}
        </div>
      )}
      {data.showTopHandle && <Handle type="target" position={Position.Top} id="top" className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background" />}
      <Handle type="target" position={Position.Left} id="left" className={cn(data.showLeftHandle ? sideVisible : sideHidden)} />
      <Handle type="target" position={Position.Right} id="right" className={cn(data.showRightHandle ? sideVisible : sideHidden)} />
      <div className={cn('h-1 rounded-t-[10px]', meta.accent)} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{meta.icon}</span>
            <div>
              <div className={NODE_TEXT.title}>{data.label}</div>
              {isCustom && (
                <div className="flex items-center gap-1 mt-1">
                  <Zap className="h-3 w-3 text-purple-500" />
                  <span className={cn(NODE_TEXT.accentMeta, 'text-purple-500')}>自定义</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {data.isCore && <Lock className="h-3.5 w-3.5 text-muted-foreground/60" />}
            {!data.isCore && data.isDeletable && data.onDelete && (
              <button onClick={(e) => { e.stopPropagation(); data.onDelete!(data.id); }} className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {!data.isCore && data.onToggle && (
              <button onClick={(e) => { e.stopPropagation(); data.onToggle!(data.id); }} className="p-1 rounded hover:bg-accent transition-colors">
                {data.isEnabled ? <ToggleRight className="h-4 w-4 text-primary" /> : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
              </button>
            )}
          </div>
        </div>
        <p className={cn(NODE_TEXT.body, 'line-clamp-2 min-h-[2.5rem]')}>{data.description}</p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <div className={cn('h-1.5 w-1.5 rounded-full', data.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
          <span className={NODE_TEXT.meta}>{data.isEnabled ? '已启用' : '已禁用'}</span>
          {data.additionalSystemPrompt && (<><span className={cn(NODE_TEXT.meta, 'text-muted-foreground/40')}>·</span><span className={cn(NODE_TEXT.meta, 'text-primary/70')}>有补充指令</span></>)}
          {data.status === 'completed' && data.durationMs != null && (
            <><span className={cn(NODE_TEXT.meta, 'text-muted-foreground/40')}>·</span><span className={cn(NODE_TEXT.meta, 'text-emerald-600')}>{data.durationMs > 1000 ? `${(data.durationMs / 1000).toFixed(1)}s` : `${data.durationMs}ms`}</span></>
          )}
          {data.status === 'skipped' && data.statusMessage && (
            <><span className={cn(NODE_TEXT.meta, 'text-muted-foreground/40')}>·</span><span className={NODE_TEXT.meta}>{data.statusMessage}</span></>
          )}
        </div>
      </div>
      {data.showBottomSourceHandle && <Handle type="source" position={Position.Bottom} id="bottom" className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background" />}
      {data.showLeftSourceHandle && <Handle type="source" position={Position.Left} id="source-left" className={sideVisible} />}
      {data.showRightSourceHandle && <Handle type="source" position={Position.Right} id="source-right" className={sideVisible} />}
    </div>
  );
}
