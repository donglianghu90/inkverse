import React, { useState } from 'react';
import { X, Settings2, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { WfNode, ConfigParam } from '@/services/novel';

interface Props {
  node: WfNode;
  onClose: () => void;
  onSave: (key: string, value: number) => Promise<void>;
}

function ParamEditor({ param, onSave }: { param: ConfigParam; onSave: (key: string, value: number) => Promise<void> }) {
  const [value, setValue] = useState<number>(param.value as number);
  const [saving, setSaving] = useState(false);
  const changed = value !== param.value;

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(param.key, value); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border bg-background/50 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{param.label}</span>
        <span className="text-sm font-mono font-bold tabular-nums text-primary">{value}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{param.description}</p>
      {param.type === 'number' && param.min != null && param.max != null && (
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground w-6 text-right">{param.min}</span>
          <Slider
            min={param.min} max={param.max} step={param.step ?? 1}
            value={[value]} onValueChange={([v]) => setValue(v)}
            className="flex-1"
          />
          <span className="text-[10px] text-muted-foreground w-6">{param.max}</span>
        </div>
      )}
      {changed && (
        <Button size="sm" className="w-full gap-1.5" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}保存
        </Button>
      )}
    </div>
  );
}

export function ConditionEditPanel({ node, onClose, onSave }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-bold">{node.label}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      {node.condition && (
        <div className="mx-4 mt-3 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 px-3 py-2">
          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">条件表达式</p>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{node.condition}</p>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {node.configParams?.map((p) => <ParamEditor key={p.key} param={p} onSave={onSave} />)}
        {!node.configParams?.length && <p className="text-sm text-muted-foreground text-center py-8">此节点无可配置参数</p>}
      </div>
    </div>
  );
}
