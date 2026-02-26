import { Handle, Position, NodeProps } from 'reactflow';
import { Lock, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentNodeConfig } from '@/services/novel';

const AGENT_META: Record<string, { icon: string; color: string }> = {
  'arc-director':          { icon: '🎬', color: 'border-cyan-400/60 bg-cyan-50/50 dark:bg-cyan-950/30' },
  intent:                  { icon: '🧭', color: 'border-blue-400/60 bg-blue-50/50 dark:bg-blue-950/30' },
  'continuity-guard':      { icon: '🛡️', color: 'border-sky-400/60 bg-sky-50/50 dark:bg-sky-950/30' },
  'scene-planner':         { icon: '🎯', color: 'border-teal-400/60 bg-teal-50/50 dark:bg-teal-950/30' },
  'creative-writer':       { icon: '✍️', color: 'border-violet-400/60 bg-violet-50/50 dark:bg-violet-950/30' },
  'scene-stitcher':        { icon: '🧵', color: 'border-indigo-400/60 bg-indigo-50/50 dark:bg-indigo-950/30' },
  reviewer:                { icon: '🔍', color: 'border-amber-400/60 bg-amber-50/50 dark:bg-amber-950/30' },
  'character-voice-coach': { icon: '🎙️', color: 'border-pink-400/60 bg-pink-50/50 dark:bg-pink-950/30' },
  'pacing-analyzer':       { icon: '⏱️', color: 'border-orange-400/60 bg-orange-50/50 dark:bg-orange-950/30' },
  editor:                  { icon: '✂️', color: 'border-emerald-400/60 bg-emerald-50/50 dark:bg-emerald-950/30' },
  'hook-crafter':          { icon: '🪝', color: 'border-yellow-400/60 bg-yellow-50/50 dark:bg-yellow-950/30' },
  recorder:                { icon: '📚', color: 'border-rose-400/60 bg-rose-50/50 dark:bg-rose-950/30' },
  custom:                  { icon: '⚡', color: 'border-purple-400/60 bg-purple-50/50 dark:bg-purple-950/30' },
};

export interface AgentNodeData extends AgentNodeConfig {
  isSelected?: boolean;
  onDelete?: (id: string) => void;
  onToggle?: (id: string) => void;
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const meta = AGENT_META[data.type] ?? AGENT_META.custom;
  const isCustom = data.type === 'custom';
  const stepNum = data.position + 1;

  return (
    <div
      className={cn(
        'relative w-64 rounded-xl border-2 shadow-sm transition-all duration-200',
        meta.color,
        selected && 'ring-2 ring-primary ring-offset-2 shadow-md',
        !data.isEnabled && 'opacity-45 grayscale',
      )}
    >
      {/* Step badge */}
      <div className={cn(
        'absolute -left-3 top-4 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold shadow-sm',
        data.isCore
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground border',
      )}>
        {stepNum}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background"
      />

      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{meta.icon}</span>
            <div>
              <div className="font-semibold text-sm text-foreground leading-tight">{data.label}</div>
              {isCustom && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Zap className="h-3 w-3 text-purple-500" />
                  <span className="text-xs text-purple-500 font-medium">自定义</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {data.isCore && <Lock className="h-3.5 w-3.5 text-muted-foreground/60" />}
            {!data.isCore && data.isDeletable && data.onDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); data.onDelete!(data.id); }}
                className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
            {!data.isCore && data.onToggle && (
              <button
                onClick={(e) => { e.stopPropagation(); data.onToggle!(data.id); }}
                className="p-1 rounded hover:bg-accent transition-colors"
              >
                {data.isEnabled
                  ? <ToggleRight className="h-4 w-4 text-primary" />
                  : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
              </button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{data.description}</p>

        <div className="mt-3 flex items-center gap-1.5">
          <div className={cn(
            'h-1.5 w-1.5 rounded-full',
            data.isEnabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
          )} />
          <span className="text-xs text-muted-foreground">{data.isEnabled ? '已启用' : '已禁用'}</span>
          {data.additionalSystemPrompt && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs text-primary/70">有补充指令</span>
            </>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-muted-foreground/40 !border-2 !border-background"
      />
    </div>
  );
}
