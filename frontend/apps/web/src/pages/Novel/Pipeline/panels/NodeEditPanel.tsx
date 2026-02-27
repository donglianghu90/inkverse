/** Agent 节点编辑面板 — 控制单个 AI 角色的工作方式 */
import { useState, useEffect } from 'react';
import { X, Lock, ChevronDown, ChevronRight, Loader2, Save, RotateCcw, Info } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useParams } from '@umijs/max';
import type { AgentNodeConfig, PromptSection } from '@/services/novel';
import { getPromptTemplates, updateAgentSection } from '@/services/novel';

interface Props { node: AgentNodeConfig; onClose: () => void; onChange: (updated: AgentNodeConfig) => void }

function SectionEditor({ bookId, section, agentId, onSaved }: { bookId: string; section: PromptSection; agentId: string; onSaved?: (key: string, content: string) => void }) {
  const [content, setContent] = useState(section.content);
  const [saved, setSaved] = useState(section.content); // 记录已保存的基准值，不直接 mutate prop
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(!section.isLocked);
  const changed = content !== saved;

  const handleSave = async () => {
    if (section.isLocked) return;
    setSaving(true);
    try { await updateAgentSection(bookId, agentId, section.key, content); setSaved(content); onSaved?.(section.key, content); } finally { setSaving(false); }
  };

  return (
    <div className={cn('rounded-lg border overflow-hidden', section.isLocked ? 'border-dashed border-muted-foreground/30' : 'border-border')}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors" onClick={() => setOpen(!open)}>
        {section.isLocked && <Lock className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
        <span className={cn('text-xs flex-1 font-medium', section.isLocked ? 'text-muted-foreground' : 'text-foreground')}>{section.label}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {section.isLocked ? (
            <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap leading-relaxed font-sans">{section.content}</pre>
          ) : (
            <>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[100px] text-[12px] resize-y leading-relaxed font-mono" />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground/50">{content.length} 字</span>
                {changed && (
                  <div className="flex gap-1.5">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setContent(saved)}><RotateCcw className="h-3 w-3 mr-1" />撤销</Button>
                    <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleSave} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}保存
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function NodeEditPanel({ node, onClose, onChange }: Props) {
  const { bookId } = useParams<{ bookId: string }>();
  const [sections, setSections] = useState<PromptSection[]>([]);
  const [loadingTpl, setLoadingTpl] = useState(false);

  useEffect(() => {
    if (!bookId) return;
    setLoadingTpl(true);
    getPromptTemplates(bookId)
      .then((tpl) => { const agent = tpl.agents[node.id]; setSections(agent?.sections ?? []); })
      .catch(() => setSections([]))
      .finally(() => setLoadingTpl(false));
  }, [bookId, node.id]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div><h3 className="font-semibold text-sm">{node.label}</h3><p className="text-xs text-muted-foreground mt-0.5">{node.description}</p></div>
        <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors"><X className="h-4 w-4" /></button>
      </div>
      <div className="mx-4 mt-3 rounded-md bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200/50 px-3 py-2 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-sky-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          这里控制 <strong>{node.label}</strong> 的角色定义和工作方式。文笔标准、题材规则等通用设置请在「写作规则」中修改。
        </p>
      </div>
      <Tabs defaultValue="template" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 grid grid-cols-3 shrink-0">
          <TabsTrigger value="template" className="text-xs">角色指令</TabsTrigger>
          <TabsTrigger value="extra" className="text-xs">补充指示</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs">设置</TabsTrigger>
        </TabsList>

        <TabsContent value="template" className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 mt-3">
          <p className="text-[10px] text-muted-foreground leading-relaxed">定义这个 AI 角色"是谁、怎么做"。修改后只影响该角色，不影响其他节点。</p>
          {loadingTpl ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : sections.length > 0 ? (
            sections.map((s) => <SectionEditor key={s.key} bookId={bookId!} section={s} agentId={node.id} />)
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">此节点无角色指令</p>
          )}
        </TabsContent>

        <TabsContent value="extra" className="flex-1 overflow-y-auto px-4 pb-4 space-y-4 mt-3">
          <div className="space-y-2">
            <Label className="text-xs font-medium">补充指示</Label>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              追加给该角色的额外指令。适合临时调整，如"本章对话多一些幽默感"。修改后只影响该角色。
            </p>
            <Textarea
              value={node.additionalSystemPrompt}
              onChange={(e) => onChange({ ...node, additionalSystemPrompt: e.target.value })}
              placeholder="例如：本章风格偏向轻松幽默，对话多用短句..."
              className="min-h-[120px] text-sm resize-none"
            />
            <div className="text-right text-[10px] text-muted-foreground/50">{node.additionalSystemPrompt.length} 字</div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-4">
          {!node.isCore ? (
            <div className="flex items-center justify-between">
              <div><Label className="text-sm">启用此节点</Label><p className="text-xs text-muted-foreground mt-0.5">禁用后此节点将在生成时跳过</p></div>
              <Switch checked={node.isEnabled} onCheckedChange={(checked) => onChange({ ...node, isEnabled: checked })} />
            </div>
          ) : (
            <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5', 'bg-muted/50 text-muted-foreground text-xs')}>
              <Lock className="h-3.5 w-3.5 shrink-0" /><span>核心节点，不可禁用或删除</span>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
