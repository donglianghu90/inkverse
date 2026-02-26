import { useState } from 'react';
import { X, Lock, ChevronDown, ChevronRight } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { AgentNodeConfig } from '@/services/novel';

const LOCKED_DESCRIPTIONS: Record<string, string[]> = {
  'arc-director': [
    '卷节拍识别（entry/build/twist/climax/aftermath/transition）',
    '卷合同约束下发（mustHit / shouldAvoid）',
    '必回收伏线优先级与回收窗口控制',
    '反派压力与章末钩子方向约束',
    '风险预算分级（low/medium/high）',
    '输出格式：ArcDirectorDirective JSON Schema',
  ],
  intent: [
    '角色生命周期检查（死亡/退场角色不可出场）',
    '逾期伏线检测与优先级排序',
    '读者悬念管理（overdue/boiling 状态）',
    '多巴胺调度计算',
    '角色弧线预警系统',
    '输出格式：ChapterIntent JSON Schema',
  ],
  'continuity-guard': [
    '角色死亡/退场状态校验',
    '时间线连续性检查',
    '空间位移合理性验证',
    '前后文矛盾检测',
    '输出格式：ContinuityPreCheck JSON Schema',
  ],
  'scene-planner': [
    '将章节意图拆分为3-5个独立场景契约',
    '每场景有独立POV视角、情绪弧和叙事任务',
    '场景purpose分类（hook/conflict/revelation/emotional/action等）',
    '场景间过渡策略和节奏分配',
    '伏线分配到具体场景',
    '输出格式：ChapterScenePlan JSON Schema',
  ],
  'creative-writer': [
    '逐场景独立创作，每场景独立LLM调用',
    'PROSE_CRAFT_PLAYBOOK（散文技巧）',
    '场景purpose特化prompt（hook/conflict/action等）',
    '角色声音档案注入和POV锁定',
    '节奏指令（slow_burn/breakneck/stillness等）',
    '输出格式：SceneDraft → ChapterDraft JSON Schema',
  ],
  'scene-stitcher': [
    '将多场景草稿组合为完整章节',
    '过渡段落打磨（环境描写/时间推移/感官切换）',
    '句式去重和节奏统一',
    '情绪弧线验证',
    'PROSE_CRAFT_PLAYBOOK',
    '输出格式：ChapterDraft JSON Schema',
  ],
  reviewer: [
    '评分维度权重计算（engagement/pacing/hookStrength 等）',
    '裁决逻辑：good / needs_edit / major_issues',
    '硬规则检查（禁止角色、字数、能力等级）',
    'CONTINUITY_BASELINE_PLAYBOOK / CHARACTER_ARC_PLAYBOOK',
    '输出格式：ChapterReview JSON Schema',
  ],
  'character-voice-coach': [
    '角色声音档案匹配度审计',
    '对话风格一致性评分（< 7 触发警告）',
    '声音偏离具体问题定位',
    '修正建议生成',
  ],
  'pacing-analyzer': [
    '句式长度变化分析（variety < 5 触发警告）',
    '段落节奏分布检测',
    '整体行文速度评估（too_slow/good/too_fast）',
    '节奏优化建议',
  ],
  editor: [
    '编辑纪律：只修复标记问题，保留优点，不重构',
    'EDITOR_DISCIPLINE_PLAYBOOK',
    'CONTINUITY_BASELINE_PLAYBOOK',
    '输出格式：ChapterDraft JSON Schema',
  ],
  'hook-crafter': [
    '章末钩子质量评估',
    '悬念/期待感增强',
    '下章预期引导优化',
    '仅在内容变化时替换',
  ],
  recorder: [
    '15 类信息提取规则（角色/地点/物品/关系等）',
    'ID 格式规范（char_/loc_/item_/fac_ 等）',
    '角色生命周期追踪逻辑',
    'CONTINUITY_BASELINE / THREAD_AWARENESS PLAYBOOK',
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
              className="min-h-[120px] text-sm resize-none"
            />
            <div className="text-right text-[10px] text-muted-foreground/50">
              {node.additionalSystemPrompt.length} 字
            </div>
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
