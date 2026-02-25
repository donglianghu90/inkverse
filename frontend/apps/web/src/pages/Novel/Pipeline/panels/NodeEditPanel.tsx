import React, { useState } from 'react';
import { X, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { AgentNodeConfig } from '@/services/novel';

const LOCKED_DESCRIPTIONS: Record<string, string[]> = {
  intent: [
    '角色生命周期检查（死亡/退场角色不可出场）',
    '逾期伏线检测与优先级排序',
    '读者悬念管理（overdue/boiling 状态）',
    '多巴胺调度计算',
    '角色弧线预警系统',
    '输出格式：ChapterIntent JSON Schema',
  ],
  'creative-writer': [
    '硬规则：禁止出场角色、开头承接、结尾钩子、字数限制',
    'PROSE_CRAFT_PLAYBOOK（散文技巧）',
    'WRITING_SOUL_PLAYBOOK（写作灵魂）',
    'CHAPTER_RHYTHM_V2_PLAYBOOK（章节节奏）',
    'CONTINUITY_BASELINE_PLAYBOOK（连续性基线）',
    '输出格式：ChapterDraft JSON Schema',
  ],
  reviewer: [
    '评分维度权重计算（engagement/pacing/hookStrength 等）',
    '裁决逻辑：good / needs_edit / major_issues',
    '硬规则检查（禁止角色、字数、能力等级）',
    'CONTINUITY_BASELINE_PLAYBOOK',
    'CHARACTER_ARC_PLAYBOOK',
    '输出格式：ChapterReview JSON Schema',
  ],
  editor: [
    '编辑纪律：只修复标记问题，保留优点，不重构',
    'EDITOR_DISCIPLINE_PLAYBOOK',
    'CONTINUITY_BASELINE_PLAYBOOK',
    '输出格式：ChapterDraft JSON Schema',
  ],
  recorder: [
    '15 类信息提取规则（角色/地点/物品/关系等）',
    'ID 格式规范（char_/loc_/item_/fac_ 等）',
    '角色生命周期追踪逻辑',
    'CONTINUITY_BASELINE_PLAYBOOK',
    'THREAD_AWARENESS_PLAYBOOK',
    '输出格式：LoreRecord JSON Schema',
  ],
};

interface NodeEditPanelProps {
  node: AgentNodeConfig;
  onClose: () => void;
  onChange: (updated: AgentNodeConfig) => void;
}

function LockedSection({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/30 overflow-hidden">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Lock className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <span className="text-xs text-muted-foreground flex-1">系统锁定内容（只读）</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground/70">
              <span className="mt-0.5 shrink-0">·</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeEditPanel({ node, onClose, onChange }: NodeEditPanelProps) {
  const lockedItems = LOCKED_DESCRIPTIONS[node.type] ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div>
          <h3 className="font-semibold text-sm">{node.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{node.description}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="prompt" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 grid grid-cols-2 shrink-0">
          <TabsTrigger value="prompt" className="text-xs">提示词</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="prompt" className="flex-1 overflow-y-auto px-4 pb-4 space-y-4 mt-3">
          {/* Editable section */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">补充指令</Label>
            <p className="text-xs text-muted-foreground">
              追加到 system prompt 末尾，作为「作者补充指示」区块。
            </p>
            <Textarea
              value={node.additionalSystemPrompt}
              onChange={(e) => onChange({ ...node, additionalSystemPrompt: e.target.value })}
              placeholder={`例如：本书风格偏向轻松幽默，${node.type === 'intent' ? '设定目标时优先考虑感情线发展' : '写作时注意保持轻松的语调'}...`}
              className="min-h-[140px] text-sm font-mono resize-none"
            />
          </div>

          {/* Locked section */}
          {lockedItems.length > 0 && <LockedSection items={lockedItems} />}
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-4">
          {/* Enable/Disable */}
          {!node.isCore && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">启用此节点</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  禁用后此节点将在生成时跳过
                </p>
              </div>
              <Switch
                checked={node.isEnabled}
                onCheckedChange={(checked) => onChange({ ...node, isEnabled: checked })}
              />
            </div>
          )}
          {node.isCore && (
            <div className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2.5',
              'bg-muted/50 text-muted-foreground text-xs',
            )}>
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>核心节点，不可禁用或删除</span>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
