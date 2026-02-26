/** 写作规则管理面板 — 书级别写作规则编辑 */
import { useState, useEffect, useCallback } from 'react';
import { X, BookOpen, Save, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { getPromptTemplates, updatePlaybook, resetPromptTemplates, type PromptTemplateView } from '@/services/novel';

interface Props { bookId: string; onClose: () => void }

const PLAYBOOK_META: Record<string, { label: string; desc: string; color: string }> = {
  PROSE_CRAFT_PLAYBOOK: { label: '文笔技法', desc: '展示而非讲述、对白技法、句式节奏、感官叠加、环境映射情绪等', color: 'text-violet-500' },
  CONTINUITY_BASELINE_PLAYBOOK: { label: '连续性底线', desc: '角色姓名一致性、死亡角色规则、休眠角色、空间位移', color: 'text-blue-500' },
  THREAD_AWARENESS_PLAYBOOK: { label: '伏线意识', desc: '新坑控制、逾期伏线、回收伏线、新伏线规则', color: 'text-teal-500' },
  CHARACTER_ARC_PLAYBOOK: { label: '角色弧线', desc: '矛盾内核、成长规则、硬规则', color: 'text-amber-500' },
  EDITOR_DISCIPLINE_PLAYBOOK: { label: '编辑纪律', desc: '修复问题优先、保留事实、不削弱钩子等', color: 'text-rose-500' },
  REVIEWER_RUBRIC_PLAYBOOK: { label: '评审标尺', desc: '0-10分标准定义', color: 'text-emerald-500' },
  WRITING_SOUL_PLAYBOOK: { label: '写作灵魂', desc: '简体中文、代入感、情绪先行、角色行为等核心准则', color: 'text-orange-500' },
};

function PlaybookEditor({ bookId, name, content: initial, meta }: { bookId: string; name: string; content: string; meta: typeof PLAYBOOK_META[string] }) {
  const [content, setContent] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const changed = content !== initial;

  const handleSave = async () => {
    setSaving(true);
    try { await updatePlaybook(bookId, name, content); } finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors" onClick={() => setOpen(!open)}>
        <BookOpen className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium">{meta.label}</span>
          <p className="text-[10px] text-muted-foreground truncate">{meta.desc}</p>
        </div>
        {changed && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t bg-background/50">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[200px] text-[11px] resize-y leading-relaxed font-mono mt-2" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">{content.length} 字</span>
            {changed && (
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setContent(initial)}><RotateCcw className="h-3 w-3 mr-1" />撤销</Button>
                <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}保存
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlaybookPanel({ bookId, onClose }: Props) {
  const [tpl, setTpl] = useState<PromptTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setLoading(true);
    getPromptTemplates(bookId).then(setTpl).finally(() => setLoading(false));
  }, [bookId]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try { const r = await resetPromptTemplates(bookId); setTpl(r); } finally { setResetting(false); }
  }, [bookId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /><span className="text-sm font-bold">写作规则</span></div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="mx-4 mt-3 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">修改写作规则将影响本书所有 AI 创作环节。如不确定，可先保存再测试效果。</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {tpl && Object.entries(tpl.playbooks).map(([name, content]) => {
          const meta = PLAYBOOK_META[name] ?? { label: name, desc: '', color: 'text-muted-foreground' };
          return <PlaybookEditor key={name} bookId={bookId} name={name} content={content} meta={meta} />;
        })}
      </div>
      <div className="border-t px-4 py-2.5">
        <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={handleReset} disabled={resetting}>
          {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}重置所有为默认值
        </Button>
      </div>
    </div>
  );
}
