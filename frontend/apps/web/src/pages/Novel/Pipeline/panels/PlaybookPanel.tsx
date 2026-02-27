/** 写作规则管理面板 — 通用规则 + 写作手册双 Tab 编辑 */
import { useState, useEffect, useCallback } from 'react';
import { X, BookOpen, Save, Loader2, RotateCcw, AlertTriangle, Pen, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  getPromptTemplates, updatePlaybook, resetPromptTemplates, type PromptTemplateView,
  getBookProfile, updateBookProfile, type BookPromptProfile, type CraftExample,
} from '@/services/novel';

interface Props { bookId: string; onClose: () => void }

// ─── Tab 1: Playbook 通用规则 ───

interface PlaybookMeta { label: string; desc: string; impact: string; tip: string; color: string; agents: string[] }

const PLAYBOOK_META: Record<string, PlaybookMeta> = {
  PROSE_CRAFT_PLAYBOOK: {
    label: '文笔技法', color: 'text-violet-500', agents: ['编辑', '审阅', '场景缝合'],
    desc: '控制 AI 的写作质量标准：展示而非讲述、对白技法、句式节奏、感官叠加、环境映射情绪、留白术、金句意识、杀死AI味',
    impact: '影响编辑精修、审阅评分、场景缝合的写作质量底线',
    tip: '建议只微调细节或增减技法条目，不要删除核心规则。修改后 AI 在润色和评审时会按新标准执行。',
  },
  WRITING_SOUL_PLAYBOOK: {
    label: '写作灵魂', color: 'text-orange-500', agents: ['种子分析'],
    desc: '定义 AI 创作的核心哲学：简体中文、代入感优先、情绪先行、角色行为从性格自然流出、不完美原则',
    impact: '影响新书种子分析阶段的创作方向',
    tip: '这是最底层的写作价值观，修改需谨慎。建议保留"简体中文"和"代入感"条目。',
  },
  CONTINUITY_BASELINE_PLAYBOOK: {
    label: '连续性底线', color: 'text-blue-500', agents: ['编辑', '审阅'],
    desc: '确保故事逻辑不矛盾：角色姓名一致性、死亡角色不再出场、休眠角色规则、空间位移合理性',
    impact: '影响编辑修改和审阅检查的连续性标准',
    tip: '这是防止出 Bug 的硬规则，建议只增不减。可以根据你的世界观补充专属规则。',
  },
  THREAD_AWARENESS_PLAYBOOK: {
    label: '伏线意识', color: 'text-teal-500', agents: ['创作写手', '意图策划'],
    desc: '管理故事的悬念节奏：不要无节制开新坑、逾期伏线优先推进、回收必须兑现铺垫、新伏线服务当前冲突',
    impact: '影响 AI 创作和章节策划时对伏线的处理方式',
    tip: '如果觉得故事伏线太多/太少，可以调整这里的约束力度。',
  },
  CHARACTER_ARC_PLAYBOOK: {
    label: '角色弧线', color: 'text-amber-500', agents: ['审阅'],
    desc: '确保角色有深度：矛盾内核、成长不是线性的、关系是双向的、情绪逻辑不可违反、扁平化警报',
    impact: '影响审阅时对角色深度的评判标准',
    tip: '如果觉得角色太平面或成长太机械，可以在这里强化要求。',
  },
  EDITOR_DISCIPLINE_PLAYBOOK: {
    label: '编辑纪律', color: 'text-rose-500', agents: ['编辑'],
    desc: '约束 AI 编辑的行为边界：优先修复问题、保留已验证事实、不削弱已有钩子、主动提升平淡段落',
    impact: '影响编辑精修时的修改策略和边界',
    tip: '如果觉得编辑改动太大或太保守，可以在这里调整纪律条目。',
  },
  REVIEWER_RUBRIC_PLAYBOOK: {
    label: '评审标尺', color: 'text-emerald-500', agents: ['审阅'],
    desc: '定义质量评分的严格程度：9-10分=强烈追更、7-8分=可追更、5-6分=平庸、0-4分=重大缺陷',
    impact: '影响审阅给出的分数区间和通过门槛',
    tip: '如果觉得评分太宽松或太严格，可以调整各分段的描述标准。',
  },
};

function PlaybookEditor({ bookId, name, content: initial, meta }: { bookId: string; name: string; content: string; meta: PlaybookMeta }) {
  const [content, setContent] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const changed = content !== initial;
  const handleSave = async () => { setSaving(true); try { await updatePlaybook(bookId, name, content); } finally { setSaving(false); } };

  return (
    <div className="rounded-lg border overflow-hidden">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors" onClick={() => setOpen(!open)}>
        <BookOpen className={cn('h-3.5 w-3.5 shrink-0', meta.color)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{meta.label}</span>
            <div className="flex gap-0.5">{meta.agents.map((a) => <span key={a} className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">{a}</span>)}</div>
          </div>
          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{meta.desc}</p>
        </div>
        {changed && <div className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t bg-background/50">
          <div className="mt-2 space-y-1.5">
            <p className="text-[10px] text-primary/70 leading-relaxed"><span className="font-medium">影响范围：</span>{meta.impact}</p>
            <p className="text-[10px] text-muted-foreground leading-relaxed"><span className="font-medium">修改建议：</span>{meta.tip}</p>
          </div>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[200px] text-[11px] resize-y leading-relaxed font-mono" />
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

function PlaybookTab({ bookId }: { bookId: string }) {
  const [tpl, setTpl] = useState<PromptTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => { setLoading(true); getPromptTemplates(bookId).then(setTpl).finally(() => setLoading(false)); }, [bookId]);

  const handleReset = useCallback(async () => {
    setResetting(true);
    try { const r = await resetPromptTemplates(bookId); setTpl(r); } finally { setResetting(false); }
  }, [bookId]);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="mx-4 mt-3 rounded-md bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/50 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-[11px] text-muted-foreground leading-relaxed space-y-1">
          <p>修改仅影响<strong>当前这本书</strong>，每条规则标注了影响的 AI 环节。</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {tpl && Object.entries(tpl.playbooks).map(([name, content]) => {
          const meta = PLAYBOOK_META[name] ?? { label: name, desc: '', impact: '', tip: '', color: 'text-muted-foreground', agents: [] };
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

// ─── Tab 2: 写作手册 (BookPromptProfile) ───

const PROFILE_SECTIONS: Array<{ key: string; label: string; desc: string; impact: string }> = [
  { key: 'coreIdentity', label: '写手人设', desc: '定义这本书的理想写手形象，AI 会以此为人设进行创作', impact: '影响创作写手的角色定位' },
  { key: 'genreRules', label: '题材规则', desc: '本书题材专属的写作规则', impact: '影响创作写手和编辑' },
  { key: 'pacingGuide', label: '节奏指南', desc: '控制故事节奏的快慢和张力节拍', impact: '影响意图策划和创作写手' },
  { key: 'dialogueGuide', label: '对话风格', desc: '定义角色对话的风格特征', impact: '影响创作写手' },
  { key: 'toneGuide', label: '整体调性', desc: '控制整本书的情感基调和叙事腔调', impact: '影响创作写手' },
  { key: 'craftExamples', label: '正反例示范', desc: '坏写法 → 好写法的对比，AI 会参考学习', impact: '影响创作写手和编辑' },
  { key: 'clichePatterns', label: '套话黑名单', desc: '禁止或限制使用的套路表达', impact: '影响创作写手、编辑和审阅' },
  { key: 'dimensionWeights', label: '评分权重', desc: '调整审阅时各维度的重要性', impact: '影响审阅评分的加权计算' },
];

function ProfileTextEditor({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} className="min-h-[80px] text-[11px] resize-y leading-relaxed" />;
}

function ProfileListEditor({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex gap-1">
          <Input value={item} onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }} className="h-7 text-[11px] flex-1" />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => onChange([...items, ''])}>+ 添加</Button>
    </div>
  );
}

function CraftExampleEditor({ examples, onChange }: { examples: CraftExample[]; onChange: (v: CraftExample[]) => void }) {
  return (
    <div className="space-y-2">
      {examples.map((ex, i) => (
        <div key={i} className="rounded border p-2 space-y-1.5 bg-background/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground">示例 {i + 1}</span>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => onChange(examples.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1"><span className="text-[10px] text-rose-500 w-6 shrink-0">坏</span>
              <Input value={ex.bad} onChange={(e) => { const n = [...examples]; n[i] = { ...ex, bad: e.target.value }; onChange(n); }} className="h-6 text-[10px] flex-1" /></div>
            <div className="flex items-center gap-1"><span className="text-[10px] text-emerald-500 w-6 shrink-0">好</span>
              <Input value={ex.good} onChange={(e) => { const n = [...examples]; n[i] = { ...ex, good: e.target.value }; onChange(n); }} className="h-6 text-[10px] flex-1" /></div>
            <div className="flex items-center gap-1"><span className="text-[10px] text-muted-foreground w-6 shrink-0">则</span>
              <Input value={ex.rule} onChange={(e) => { const n = [...examples]; n[i] = { ...ex, rule: e.target.value }; onChange(n); }} className="h-6 text-[10px] flex-1" /></div>
          </div>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => onChange([...examples, { bad: '', good: '', rule: '' }])}>+ 添加正反例</Button>
    </div>
  );
}

function WeightSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-14 shrink-0">{label}</span>
      <input type="range" min={0.5} max={2} step={0.1} value={value} onChange={(e) => onChange(+e.target.value)}
        className="flex-1 h-1 accent-primary" />
      <span className="text-[10px] font-mono w-6 text-right">{value.toFixed(1)}</span>
    </div>
  );
}

function ProfileTab({ bookId }: { bookId: string }) {
  const [profile, setProfile] = useState<BookPromptProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => { setLoading(true); getBookProfile(bookId).then(setProfile).finally(() => setLoading(false)); }, [bookId]);

  const update = <K extends keyof BookPromptProfile>(key: K, val: BookPromptProfile[K]) => {
    if (!profile) return;
    setProfile({ ...profile, [key]: val });
    setDirty(true);
  };
  const updateGuide = (key: string, val: unknown) => {
    if (!profile) return;
    setProfile({ ...profile, writerGuide: { ...profile.writerGuide, [key]: val } });
    setDirty(true);
  };
  const updateWeight = (key: string, val: number) => {
    if (!profile) return;
    setProfile({
      ...profile, reviewerCalibration: {
        ...profile.reviewerCalibration,
        dimensionWeights: { ...profile.reviewerCalibration.dimensionWeights, [key]: val },
      },
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try { await updateBookProfile(bookId, profile); setDirty(false); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!profile) return <div className="text-center py-8 text-sm text-muted-foreground">暂无写作手册数据</div>;

  const w = profile.reviewerCalibration.dimensionWeights;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="mx-4 mt-3 rounded-md bg-sky-50/60 dark:bg-sky-950/20 border border-sky-200/50 px-3 py-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          写作手册由 AI 根据题材（<strong>{profile.generatedForGenre}</strong>）自动生成，你可以微调以匹配本书风格。
        </p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {PROFILE_SECTIONS.map(({ key, label, desc, impact }) => (
          <div key={key} className="rounded-lg border overflow-hidden">
            <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors" onClick={() => setExpandedKey(expandedKey === key ? null : key)}>
              <Pen className="h-3.5 w-3.5 shrink-0 text-sky-500" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">{label}</span>
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">{desc}</p>
              </div>
            </button>
            {expandedKey === key && (
              <div className="px-3 pb-3 border-t bg-background/50 space-y-2 mt-0">
                <p className="text-[10px] text-primary/70 mt-2"><span className="font-medium">影响范围：</span>{impact}</p>
                {key === 'coreIdentity' && <ProfileTextEditor label="写手人设" value={profile.writerGuide.coreIdentity} onChange={(v) => updateGuide('coreIdentity', v)} />}
                {key === 'genreRules' && <ProfileListEditor items={profile.writerGuide.genreRules} onChange={(v) => updateGuide('genreRules', v)} />}
                {key === 'pacingGuide' && <ProfileTextEditor label="节奏指南" value={profile.writerGuide.pacingGuide} onChange={(v) => updateGuide('pacingGuide', v)} />}
                {key === 'dialogueGuide' && <ProfileTextEditor label="对话风格" value={profile.writerGuide.dialogueGuide} onChange={(v) => updateGuide('dialogueGuide', v)} />}
                {key === 'toneGuide' && <ProfileTextEditor label="调性" value={profile.writerGuide.toneGuide} onChange={(v) => updateGuide('toneGuide', v)} />}
                {key === 'craftExamples' && <CraftExampleEditor examples={profile.writerGuide.craftExamples} onChange={(v) => updateGuide('craftExamples', v)} />}
                {key === 'clichePatterns' && (
                  <ProfileListEditor
                    items={profile.clichePatterns.map((c) => c.pattern)}
                    onChange={(v) => update('clichePatterns', v.map((pattern) => ({ pattern, maxPerChapter: 1 })))}
                  />
                )}
                {key === 'dimensionWeights' && (
                  <div className="space-y-1.5">
                    <WeightSlider label="吸引力" value={w.engagement} onChange={(v) => updateWeight('engagement', v)} />
                    <WeightSlider label="节奏" value={w.pacing} onChange={(v) => updateWeight('pacing', v)} />
                    <WeightSlider label="钩子" value={w.hookStrength} onChange={(v) => updateWeight('hookStrength', v)} />
                    <WeightSlider label="一致性" value={w.consistency} onChange={(v) => updateWeight('consistency', v)} />
                    <WeightSlider label="文笔" value={w.proseQuality} onChange={(v) => updateWeight('proseQuality', v)} />
                    <WeightSlider label="角色深度" value={w.characterDepth} onChange={(v) => updateWeight('characterDepth', v)} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {dirty && (
        <div className="border-t px-4 py-2.5">
          <Button size="sm" className="w-full gap-1.5 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}保存写作手册
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── 主面板 ───

export function PlaybookPanel({ bookId, onClose }: Props) {
  const [tab, setTab] = useState<'playbook' | 'profile'>('playbook');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /><span className="text-sm font-bold">写作规则</span></div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="mx-4 mt-3 rounded-md bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/50 px-3 py-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <strong>写作规则</strong> = 这本书「写成什么样」的标准，多个 AI 角色共享。<br/>
          点击工作流节点可编辑单个角色「怎么工作」的指令，两者互不冲突。
        </p>
      </div>
      <div className="flex border-b px-4 mt-2">
        <button className={cn('px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === 'playbook' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setTab('playbook')}>
          <Sliders className="h-3 w-3" />通用规则
        </button>
        <button className={cn('px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === 'profile' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => setTab('profile')}>
          <Pen className="h-3 w-3" />写作手册
        </button>
      </div>
      {tab === 'playbook' ? <PlaybookTab bookId={bookId} /> : <ProfileTab bookId={bookId} />}
    </div>
  );
}
