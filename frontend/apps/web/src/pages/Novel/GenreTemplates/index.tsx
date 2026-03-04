import React, { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';
import {
  Plus, Loader2, Copy, Trash2, Sparkles, Pencil, Shield, ChevronRight, ChevronDown,
  BookOpen, Search, X, Wand2, ArrowLeft, Film,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  listGenreTemplates, getGenreTemplate, updateGenreTemplate, deleteGenreTemplate,
  cloneGenreTemplate, aiGenerateProfile, syncGenreTemplateFromSystem, createGenreTemplate,
  type GenreProfileTemplate, type AiGenerateProfileParams, type RuleAtom,
} from '@/services/novel';
import {
  listDramaGenreTemplates, getDramaGenreTemplate, updateDramaGenreTemplate,
  deleteDramaGenreTemplate, cloneDramaGenreTemplate, aiGenerateDramaTemplate,
  type DramaGenreTemplate, type AiGenerateDramaTemplateParams,
} from '@/services/drama';

type ContentTab = 'novel' | 'drama';

const GENRE_COLORS: Record<string, string> = {
  xianxia: 'from-violet-500 to-indigo-600',
  mystery: 'from-slate-500 to-zinc-700',
  'sci-fi': 'from-cyan-500 to-blue-600',
  urban: 'from-orange-400 to-rose-500',
  historical: 'from-yellow-600 to-amber-800',
  horror: 'from-gray-600 to-red-900',
  supernatural: 'from-indigo-400 to-purple-800',
  'western-fantasy': 'from-purple-500 to-fuchsia-600',
  wuxia: 'from-amber-500 to-orange-700',
  military: 'from-stone-500 to-green-800',
  adventure: 'from-teal-400 to-cyan-600',
  sports: 'from-lime-500 to-green-600',
  superpower: 'from-blue-500 to-violet-600',
  epic: 'from-rose-600 to-amber-700',
  'fantasy-romance': 'from-fuchsia-400 to-pink-600',
  children: 'from-sky-400 to-indigo-400',
  xuanhuan: 'from-blue-600 to-indigo-800',
  'infinite-flow': 'from-fuchsia-500 to-purple-700',
  'light-novel': 'from-pink-300 to-rose-400',
  'post-apocalyptic': 'from-stone-600 to-zinc-800',
  'suspense-thriller': 'from-zinc-700 to-neutral-900',
  esports: 'from-blue-400 to-indigo-500',
  vrmmo: 'from-emerald-400 to-teal-600',
  'urban-romance': 'from-rose-400 to-pink-600',
  'ancient-romance': 'from-red-400 to-rose-600',
};

const DRAMA_GENRE_COLORS: Record<string, string> = {
  boss: 'from-amber-500 to-rose-600', sweet: 'from-pink-400 to-rose-500',
  warrior: 'from-red-600 to-orange-700', timetravel: 'from-violet-500 to-purple-700',
  palace: 'from-amber-600 to-red-700', revenge: 'from-zinc-600 to-red-800',
  rebirth: 'from-emerald-500 to-teal-700', suspense: 'from-slate-500 to-zinc-700',
  urban: 'from-orange-400 to-rose-500', ancient: 'from-yellow-600 to-amber-800',
};

const PLATFORM_LABELS: Record<string, string> = {
  douyin: '抖音', kuaishou: '快手', reelshort: 'ReelShort', dramabox: 'DramaBox', generic: '通用',
};

const PLAYBOOK_META: Record<string, { label: string; desc: string; agents: string[] }> = {
  PROSE_CRAFT_PLAYBOOK: { label: '文笔技法', desc: '修辞手法、感官描写、节奏技巧等写作技法', agents: ['creative-writer', 'scene-stitcher', 'reviewer', 'editor'] },
  WRITING_SOUL_PLAYBOOK: { label: '写作灵魂', desc: '写手的创作哲学和创作自由度', agents: ['creative-writer'] },
  CHARACTER_ARC_PLAYBOOK: { label: '角色弧线', desc: '角色成长路径、内心变化和人物塑造', agents: ['creative-writer', 'reviewer'] },
  EDITOR_DISCIPLINE_PLAYBOOK: { label: '编辑纪律', desc: '编辑修改的边界、优先级和品质标准', agents: ['editor'] },
  REVIEWER_RUBRIC_PLAYBOOK: { label: '评审标尺', desc: '评审打分的锚点和评判标准', agents: ['reviewer'] },
  CONTINUITY_BASELINE_PLAYBOOK: { label: '连续性底线', desc: '情节连贯性、角色状态一致性、世界观稳定', agents: ['reviewer', 'editor'] },
  THREAD_AWARENESS_PLAYBOOK: { label: '伏线意识', desc: '伏笔铺设、悬念推进和信息差运用', agents: ['creative-writer', 'intent', 'scene-planner'] },
};
const AGENT_INFO: Record<string, { name: string; desc: string }> = {
  'creative-writer': { name: '创意写手', desc: '根据场景计划撰写小说正文，是直接产出文字的核心 Agent' },
  'scene-stitcher': { name: '场景缝合', desc: '将多个独立场景拼接为连贯的完整章节，处理过渡和节奏' },
  reviewer: { name: '质量审阅', desc: '以"第一读者"视角评分并指出问题，决定章节是否需要返修' },
  editor: { name: '编辑修复', desc: '根据审阅意见修复问题并主动提升文笔质量' },
  intent: { name: '意图策划', desc: '为每章设定核心冲突、情绪走向和叙事目标' },
  'scene-planner': { name: '场景导演', desc: '将章节意图拆分为 3-5 个独立场景，规划场景节奏和转场' },
};

const ALL_PLAYBOOK_KEYS = Object.keys(PLAYBOOK_META);

/* ─── Profile Editor Helpers ─── */
const WEIGHT_LABELS: Record<string, string> = { engagement: '吸引力', pacing: '节奏感', hookStrength: '钩子强度', consistency: '一致性', proseQuality: '文笔质量', characterDepth: '角色深度' };
const CH_TYPE_LABELS: Record<string, string> = { climax: '高潮', setup: '铺垫', rising: '上升', relief: '舒缓' };

const mkProfile = (): Record<string, any> => ({
  generatedForGenre: '', generatedForAudience: '',
  writerGuide: { coreIdentity: '', genreRules: [] as string[], pacingGuide: '', dialogueGuide: '', craftExamples: [] as any[], toneGuide: '' },
  satisfactionTypes: [] as any[], hookTypes: [] as any[], clichePatterns: [] as any[],
  reviewerCalibration: { dimensionWeights: { engagement: 1, pacing: 1, hookStrength: 1, consistency: 1, proseQuality: 1, characterDepth: 1 }, genreSpecificChecks: [] as string[], scoringAnchors: { high: '', mid: '', low: '' } },
  worldProfile: { organizationTypes: [] as string[], powerSystemApplicable: false, goldenFingerApplicable: false, commitmentTypes: [] as string[], characterRelationEmphasis: '' },
  styleReferenceTexts: [] as string[], chapterTypeTemplates: {} as Record<string, string>, firstChaptersStrategy: '', audienceReactionGuide: '',
});
const mkSeeds = () => ({
  coreLoopPatterns: [] as string[],
  goldenFingerGuidance: '',
  worldBuildingDirectives: '',
  namingDefaults: {
    personNameStyle: '',
    locationNameStyle: '',
    abilityNameStyle: '',
    factionNameStyle: '',
    itemNameStyle: '',
    examples: { personNames: [] as string[], locationNames: [] as string[], abilityNames: [] as string[], factionNames: [] as string[] },
    taboos: [] as string[],
  },
});

const deepMerge = (a: any, b: any): any => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b ?? a;
  const r = { ...a };
  for (const k of Object.keys(a)) if (b[k] !== undefined) r[k] = (typeof a[k] === 'object' && !Array.isArray(a[k]) && a[k] !== null) ? deepMerge(a[k], b[k]) : b[k];
  for (const k of Object.keys(b)) if (!(k in a)) r[k] = b[k];
  return r;
};

const FL: React.FC<{ t: string; impact?: string }> = ({ t, impact }) => (
  <div className="flex items-baseline gap-2 mb-0.5">
    <Label className="text-xs font-medium">{t}</Label>
    {impact && <span className="text-[10px] text-muted-foreground/70">影响：{impact}</span>}
  </div>
);

const FormSection: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button type="button" className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors" onClick={() => setOpen(!open)}>
        {title}<ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="px-4 pb-4 pt-2 space-y-3 border-t">{children}</div>}
    </div>
  );
};

const StrList: React.FC<{ value: string[]; onChange: (v: string[]) => void; ph?: string; max?: number }> = ({ value = [], onChange, ph, max }) => (
  <div className="space-y-1.5">
    {value.map((item, i) => (
      <div key={i} className="flex gap-1.5">
        <Input value={item} onChange={(e) => { const n = [...value]; n[i] = e.target.value; onChange(n); }} placeholder={ph} className="text-xs h-8" />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="w-3.5 h-3.5" /></Button>
      </div>
    ))}
    {(!max || value.length < max) && <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onChange([...value, ''])}><Plus className="w-3 h-3 mr-1" />添加</Button>}
  </div>
);

const IdLabelList: React.FC<{ value: any[]; onChange: (v: any[]) => void; label: string }> = ({ value = [], onChange, label }) => (
  <div className="space-y-2">
    {value.map((item, i) => (
      <div key={i} className="border rounded p-2.5 space-y-1 relative">
        <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="w-3 h-3" /></Button>
        <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 items-center pr-6">
          <Label className="text-[10px]">标识</Label><Input className="text-xs h-7" value={item.id ?? ''} onChange={(e) => { const n = [...value]; n[i] = { ...n[i], id: e.target.value }; onChange(n); }} />
          <Label className="text-[10px]">名称</Label><Input className="text-xs h-7" value={item.label ?? ''} onChange={(e) => { const n = [...value]; n[i] = { ...n[i], label: e.target.value }; onChange(n); }} />
          <Label className="text-[10px]">描述</Label><Input className="text-xs h-7" value={item.description ?? ''} onChange={(e) => { const n = [...value]; n[i] = { ...n[i], description: e.target.value }; onChange(n); }} />
        </div>
      </div>
    ))}
    <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => onChange([...value, { id: `t${value.length}`, label: '', description: '' }])}><Plus className="w-3 h-3 mr-1" />添加{label}</Button>
  </div>
);

/* ─── Template Card ─── */
const TemplateCard: React.FC<{
  tpl: GenreProfileTemplate;
  onEdit: (tpl: GenreProfileTemplate) => void;
  onClone: (id: string) => void;
  onDelete: (tpl: GenreProfileTemplate) => void;
}> = ({ tpl, onEdit, onClone, onDelete }) => {
  const gradient = GENRE_COLORS[tpl.genreKey] ?? 'from-primary to-primary/70';
  const atomCount = tpl.ruleAtoms?.length ?? 0;
  return (
    <Card
      className="group cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 overflow-hidden relative"
      onClick={() => onEdit(tpl)}
    >
      {tpl.hasSystemUpdate && (
        <div className="absolute top-3 right-3 z-10">
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5 animate-pulse">系统已更新</Badge>
        </div>
      )}
      <div className={cn('h-2 bg-gradient-to-r', gradient)} />
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="font-semibold text-sm truncate">{tpl.displayName}</h3>
              {tpl.parentTemplateId && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0 translate-y-[-1px]">
                  <Shield className="w-3 h-3 mr-0.5" />预置
                </Badge>
              )}
              {tpl.isUserModified && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 translate-y-[-1px] border-orange-300 text-orange-600">已修改</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description || '暂无描述'}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="flex flex-wrap gap-1">
          {tpl.genreKeywords.slice(0, 5).map((kw) => (
            <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0">{kw}</Badge>
          ))}
          {tpl.genreKeywords.length > 5 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{tpl.genreKeywords.length - 5}</Badge>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{atomCount > 0 ? `${atomCount} 条规则原子` : '使用默认写作规则'}</span>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClone(tpl.id)} title="克隆">
              <Copy className="w-3.5 h-3.5" />
            </Button>
            {!tpl.parentTemplateId && (
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(tpl)} title="删除">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/* ─── AI Generate Dialog ─── */
const AiGenerateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}> = ({ open, onClose, onGenerated }) => {
  const [form, setForm] = useState<AiGenerateProfileParams>({ genreName: '' });
  const [loading, setLoading] = useState(false);
  const [worksInput, setWorksInput] = useState('');

  const handleGenerate = async () => {
    if (!form.genreName.trim()) { message.warning('请输入题材名称'); return; }
    setLoading(true);
    try {
      const generated = await aiGenerateProfile({
        ...form,
        referenceWorks: worksInput.trim() ? worksInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : undefined,
      });
      await createGenreTemplate({
        genreKey: form.genreName.toLowerCase().replace(/\s+/g, '-'),
        displayName: form.genreName,
        description: form.styleDescription || `AI 生成的 ${form.genreName} 题材模板`,
        genreKeywords: [form.genreName],
        profileJson: generated.profileJson,
        seedHints: generated.seedHints,
        ruleAtoms: generated.ruleAtoms,
        cachedAgentSections: generated.cachedAgentSections ?? undefined,
      });
      message.success('AI 生成完成，请在列表中查看');
      onGenerated();
      onClose();
    } catch (err: any) {
      message.error(err?.data?.message || 'AI 生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-primary" />AI 生成题材模板</DialogTitle>
          <DialogDescription>描述你想要的题材风格，AI 将自动生成完整的写作档案、创意引导和写作规则</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-4 pb-2">
          <div className="space-y-2">
            <Label>题材名称 *</Label>
            <Input placeholder="如：硬科幻、校园言情、克苏鲁" value={form.genreName} onChange={(e) => setForm({ ...form, genreName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>风格描述</Label>
            <Textarea placeholder="如：刘慈欣风格，注重物理定律内自洽，宏大叙事..." rows={3} value={form.styleDescription ?? ''} onChange={(e) => setForm({ ...form, styleDescription: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>参考作品（逗号分隔）</Label>
            <Input placeholder="如：三体、基地系列" value={worksInput} onChange={(e) => setWorksInput(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>目标读者</Label>
            <Input placeholder="如：18-35岁科幻爱好者" value={form.targetAudience ?? ''} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中...</> : <><Sparkles className="w-4 h-4 mr-2" />开始生成</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Drama AI Generate Dialog ─── */

const DramaAiGenerateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}> = ({ open, onClose, onGenerated }) => {
  const [form, setForm] = useState<AiGenerateDramaTemplateParams>({ genreName: '' });
  const [loading, setLoading] = useState(false);
  const [worksInput, setWorksInput] = useState('');

  const handleGenerate = async () => {
    if (!form.genreName.trim()) { message.warning('请输入题材名称'); return; }
    setLoading(true);
    try {
      await aiGenerateDramaTemplate({
        ...form,
        referenceWorks: worksInput.trim() ? worksInput.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : undefined,
      });
      message.success('AI 生成完成，请在列表中查看');
      onGenerated();
      onClose();
    } catch (err: any) {
      message.error(err?.data?.message || 'AI 生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="w-5 h-5 text-primary" />AI 生成短剧题材模板</DialogTitle>
          <DialogDescription>描述你想要的短剧题材风格，AI 将自动生成受众定位、创作引导和爽点策略</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-4 pb-2">
          <div className="space-y-2">
            <Label>题材名称 *</Label>
            <Input placeholder="如：霸总逆袭、甜宠日常、悬疑反转" value={form.genreName} onChange={(e) => setForm({ ...form, genreName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>风格描述</Label>
            <Textarea placeholder="如：高甜互动+身份反差+每集一个反转..." rows={3} value={form.styleDescription ?? ''} onChange={(e) => setForm({ ...form, styleDescription: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>参考作品（逗号分隔）</Label>
            <Input placeholder="如：闪婚后傅先生马甲藏不住了、墨雨云间" value={worksInput} onChange={(e) => setWorksInput(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>目标受众</Label>
              <Input placeholder="如：18-35岁女性" value={form.targetAudience ?? ''} onChange={(e) => setForm({ ...form, targetAudience: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>目标平台</Label>
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={form.platformTarget ?? ''} onChange={(e) => setForm({ ...form, platformTarget: e.target.value || undefined })}>
                <option value="">自动推荐</option>
                {Object.entries(PLATFORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />生成中...</> : <><Sparkles className="w-4 h-4 mr-2" />开始生成</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ─── Template Edit Panel ─── */
const TemplateEditPanel: React.FC<{
  tplId: string;
  onBack: () => void;
  onSaved: (newId?: string) => void;
}> = ({ tplId, onBack, onSaved }) => {
  const [tpl, setTpl] = useState<GenreProfileTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [pd, setPd] = useState<Record<string, any>>(mkProfile());
  const [sh, setSh] = useState<Record<string, any>>(mkSeeds());
  const [playbookTab, setPlaybookTab] = useState(ALL_PLAYBOOK_KEYS[0]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [ruleAtoms, setRuleAtoms] = useState<import('@/services/novel').RuleAtom[]>([]);
  const [editingAtomId, setEditingAtomId] = useState<string | null>(null);
  const [agentSections, setAgentSections] = useState<Array<{ agentId: string; key: string; content: string }>>([]);
  const [syncing, setSyncing] = useState(false);
  const [audienceMeta, setAudienceMeta] = useState<import('@/services/novel').AudienceMeta>({
    audienceTags: [], protagonistFocusTags: [], toneTags: [], relationshipDensity: 'medium', hardConstraints: [], softPreferences: []
  });

  const up = (k: string, v: any) => setPd(p => ({ ...p, [k]: v }));
  const upW = (k: string, v: any) => setPd(p => ({ ...p, writerGuide: { ...p.writerGuide, [k]: v } }));
  const upR = (k: string, v: any) => setPd(p => ({ ...p, reviewerCalibration: { ...p.reviewerCalibration, [k]: v } }));
  const upRW = (k: string, v: number) => setPd(p => ({ ...p, reviewerCalibration: { ...p.reviewerCalibration, dimensionWeights: { ...p.reviewerCalibration?.dimensionWeights, [k]: v } } }));
  const upRS = (k: string, v: string) => setPd(p => ({ ...p, reviewerCalibration: { ...p.reviewerCalibration, scoringAnchors: { ...p.reviewerCalibration?.scoringAnchors, [k]: v } } }));
  const upWP = (k: string, v: any) => setPd(p => ({ ...p, worldProfile: { ...p.worldProfile, [k]: v } }));
  const upCT = (k: string, v: string) => setPd(p => ({ ...p, chapterTypeTemplates: { ...p.chapterTypeTemplates, [k]: v } }));

  useEffect(() => {
    setLoading(true);
    getGenreTemplate(tplId).then((data) => {
      setTpl(data);
      setDisplayName(data.displayName);
      setDescription(data.description);
      setKeywords(data.genreKeywords.join('、'));
      setPd(deepMerge(mkProfile(), data.profileJson));
      setSh(deepMerge(mkSeeds(), data.seedHints));
      setRuleAtoms(data.ruleAtoms ?? []);
      setAgentSections(data.cachedAgentSections?.sections ?? []);
      setAudienceMeta({
        audienceTags: data.audienceTags ?? [],
        protagonistFocusTags: data.protagonistFocusTags ?? [],
        toneTags: data.toneTags ?? [],
        relationshipDensity: data.relationshipDensity ?? 'medium',
        hardConstraints: data.hardConstraints ?? [],
        softPreferences: data.softPreferences ?? [],
      });
    }).catch(() => message.error('加载模板详情失败')).finally(() => setLoading(false));
  }, [tplId]);

  const handleSave = async () => {
    if (!tpl) return;
    setSaving(true);
    try {
      const saved = await updateGenreTemplate(tplId, {
        displayName, description,
        genreKeywords: keywords.split(/[,，、\s]+/).filter(Boolean),
        profileJson: pd, seedHints: sh, ruleAtoms,
        cachedAgentSections: agentSections.length ? { sections: agentSections, ruleAtoms } : undefined,
        audienceMeta,
      });
      message.success('保存成功');
      onSaved(saved.id !== tplId ? saved.id : undefined);
    } catch (err: any) {
      message.error(err?.data?.message || '保存失败');
    } finally { setSaving(false); }
  };

  const handleSyncSystem = async () => {
    if (!tpl) return;
    setSyncing(true);
    try {
      const synced = await syncGenreTemplateFromSystem(tplId);
      setTpl(synced); setDisplayName(synced.displayName); setDescription(synced.description);
      setKeywords(synced.genreKeywords.join('、'));
      setPd(deepMerge(mkProfile(), synced.profileJson));
      setSh(deepMerge(mkSeeds(), synced.seedHints));
      setRuleAtoms(synced.ruleAtoms ?? []);
      setAgentSections(synced.cachedAgentSections?.sections ?? []);
      setAudienceMeta({
        audienceTags: synced.audienceTags ?? [],
        protagonistFocusTags: synced.protagonistFocusTags ?? [],
        toneTags: synced.toneTags ?? [],
        relationshipDensity: synced.relationshipDensity ?? 'medium',
        hardConstraints: synced.hardConstraints ?? [],
        softPreferences: synced.softPreferences ?? [],
      });
      message.success('已同步为系统最新版本');
    } catch (err: any) {
      message.error(err?.data?.message || '同步失败');
    } finally { setSyncing(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!tpl) return <div className="text-center py-12 text-muted-foreground">模板不存在</div>;

  const wg = pd.writerGuide ?? {};
  const rc = pd.reviewerCalibration ?? {};
  const dw = rc.dimensionWeights ?? {};
  const sa = rc.scoringAnchors ?? {};
  const wp = pd.worldProfile ?? {};
  const ct = pd.chapterTypeTemplates ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5"><ArrowLeft className="w-4 h-4" />返回列表</Button>
        <div className="flex gap-2">
          {tpl.parentTemplateId && tpl.isUserModified && (
            <Button variant="outline" size="sm" onClick={handleSyncSystem} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Shield className="w-4 h-4 mr-1.5" />}
              恢复系统版本
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Pencil className="w-4 h-4 mr-1.5" />}保存修改
          </Button>
        </div>
      </div>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="w-full grid grid-cols-6">
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="audience">受众策略</TabsTrigger>
          <TabsTrigger value="profile">写作档案</TabsTrigger>
          <TabsTrigger value="seedhints">创意引导</TabsTrigger>
          <TabsTrigger value="playbooks">写作规则</TabsTrigger>
          <TabsTrigger value="agents">Agent 指令</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 pt-4">
          <div><Label>显示名称</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>描述</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>关键词（顿号/逗号分隔）</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="玄幻、仙侠、修仙" /></div>
        </TabsContent>

        <TabsContent value="audience" className="space-y-4 pt-4">
          <FormSection title="受众与叙事聚焦">
            <FL t="受众标签" impact="模板匹配、受众策略约束" />
            <StrList value={audienceMeta.audienceTags ?? []} onChange={(v) => setAudienceMeta(p => ({ ...p, audienceTags: v }))} ph="如: 女性向、18-35岁、言情读者" />
            
            <FL t="主角聚焦标签" impact="模板匹配、Agent 叙事视角" />
            <div className="flex flex-wrap gap-2 mt-1 mb-2">
              {['female_lead', 'male_lead', 'dual_lead', 'ensemble'].map(tag => {
                const labels: Record<string, string> = { female_lead: '女主视角', male_lead: '男主视角', dual_lead: '双主角', ensemble: '群像' };
                const selected = audienceMeta.protagonistFocusTags?.includes(tag as any);
                return (
                  <Badge 
                    key={tag} 
                    variant={selected ? 'default' : 'outline'} 
                    className="cursor-pointer"
                    onClick={() => {
                      const tags = audienceMeta.protagonistFocusTags ?? [];
                      setAudienceMeta(p => ({ ...p, protagonistFocusTags: selected ? tags.filter(t => t !== tag) : [...tags, tag as any] }));
                    }}
                  >
                    {labels[tag]}
                  </Badge>
                );
              })}
            </div>
            
            <FL t="调性标签" impact="模板匹配、文风约束" />
            <StrList value={audienceMeta.toneTags ?? []} onChange={(v) => setAudienceMeta(p => ({ ...p, toneTags: v }))} ph="如: 细腻慢热、轻松幽默、杀伐果断" />
          </FormSection>
          
          <FormSection title="关系与规则偏好">
            <FL t="关系密度" impact="人物互动频率、情感线比重" />
            <div className="flex gap-4 mt-1 mb-2">
              {['low', 'medium', 'high'].map(level => {
                const labels: Record<string, string> = { low: '低 (剧情主导)', medium: '中 (剧情与关系平衡)', high: '高 (关系主导/言情)' };
                return (
                  <label key={level} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input 
                      type="radio" 
                      name="relationshipDensity" 
                      value={level} 
                      checked={audienceMeta.relationshipDensity === level}
                      onChange={(e) => setAudienceMeta(p => ({ ...p, relationshipDensity: e.target.value as any }))}
                    />
                    {labels[level]}
                  </label>
                );
              })}
            </div>

            <FL t="硬性约束 (Hard Constraints)" impact="Agent 绝对不能违反的底线" />
            <StrList value={audienceMeta.hardConstraints ?? []} onChange={(v) => setAudienceMeta(p => ({ ...p, hardConstraints: v }))} ph="如: 禁止出现后宫情节" />

            <FL t="软性偏好 (Soft Preferences)" impact="Agent 优先考虑的写作倾向" />
            <StrList value={audienceMeta.softPreferences ?? []} onChange={(v) => setAudienceMeta(p => ({ ...p, softPreferences: v }))} ph="如: 倾向于描写细腻的心理活动" />
          </FormSection>
        </TabsContent>

        <TabsContent value="profile" className="pt-4 space-y-3">
          {(pd.generatedForGenre || pd.generatedForAudience) && (
            <div className="flex gap-2 text-xs">
              {pd.generatedForGenre && <Badge variant="outline">题材：{pd.generatedForGenre}</Badge>}
              {pd.generatedForAudience && <Badge variant="outline">受众：{pd.generatedForAudience}</Badge>}
            </div>
          )}

          <FormSection title="一、写手身份与风格">
            <FL t="写手人设" impact="写作、场景规划" />
            <Textarea className="text-xs" rows={3} value={wg.coreIdentity ?? ''} onChange={(e) => upW('coreIdentity', e.target.value)} />
            <FL t="题材规则" impact="写作、编辑、场景规划" />
            <StrList value={wg.genreRules ?? []} onChange={(v) => upW('genreRules', v)} ph="输入一条题材专属规则..." />
            <FL t="节奏指南" impact="写作" />
            <Textarea className="text-xs" rows={3} value={wg.pacingGuide ?? ''} onChange={(e) => upW('pacingGuide', e.target.value)} />
            <FL t="对话指南" impact="写作" />
            <Textarea className="text-xs" rows={2} value={wg.dialogueGuide ?? ''} onChange={(e) => upW('dialogueGuide', e.target.value)} />
            <FL t="调性指南" impact="写作" />
            <Textarea className="text-xs" rows={2} value={wg.toneGuide ?? ''} onChange={(e) => upW('toneGuide', e.target.value)} />
            <FL t="正反例" impact="写作、编辑" />
            {(wg.craftExamples ?? []).map((ex: any, i: number) => (
              <div key={i} className="border rounded-lg p-3 space-y-1.5 relative">
                <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => upW('craftExamples', wg.craftExamples.filter((_: any, j: number) => j !== i))}><X className="w-3 h-3" /></Button>
                <div><Label className="text-[10px] text-destructive/80">坏写法</Label><Input className="text-xs h-8" value={ex.bad ?? ''} onChange={(e) => { const n = [...wg.craftExamples]; n[i] = { ...n[i], bad: e.target.value }; upW('craftExamples', n); }} /></div>
                <div><Label className="text-[10px] text-green-600/80">好写法</Label><Input className="text-xs h-8" value={ex.good ?? ''} onChange={(e) => { const n = [...wg.craftExamples]; n[i] = { ...n[i], good: e.target.value }; upW('craftExamples', n); }} /></div>
                <div><Label className="text-[10px]">规则</Label><Input className="text-xs h-8" value={ex.rule ?? ''} onChange={(e) => { const n = [...wg.craftExamples]; n[i] = { ...n[i], rule: e.target.value }; upW('craftExamples', n); }} /></div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => upW('craftExamples', [...(wg.craftExamples ?? []), { bad: '', good: '', rule: '' }])}><Plus className="w-3 h-3 mr-1" />添加正反例</Button>
          </FormSection>

          <FormSection title="二、读者爽感与钩子">
            <FL t="爽感类型" impact="叙事分析" />
            <IdLabelList value={pd.satisfactionTypes ?? []} onChange={(v) => up('satisfactionTypes', v)} label="爽感类型" />
            <FL t="钩子类型" impact="叙事分析、钩子生成、意图规划" />
            <IdLabelList value={pd.hookTypes ?? []} onChange={(v) => up('hookTypes', v)} label="钩子类型" />
          </FormSection>

          <FormSection title="三、套话黑名单" defaultOpen={false}>
            <FL t="套话模式" impact="写作、编辑、评审" />
            {(pd.clichePatterns ?? []).map((cp: any, i: number) => (
              <div key={i} className="flex gap-1.5 items-center">
                <Input className="text-xs h-8 flex-1" value={cp.pattern ?? ''} placeholder="套话内容" onChange={(e) => { const n = [...pd.clichePatterns]; n[i] = { ...n[i], pattern: e.target.value }; up('clichePatterns', n); }} />
                <div className="flex items-center gap-1 shrink-0">
                  <Label className="text-[10px] whitespace-nowrap">上限</Label>
                  <Input type="number" min={0} max={10} className="text-xs h-8 w-14 text-center" value={cp.maxPerChapter ?? 1} onChange={(e) => { const n = [...pd.clichePatterns]; n[i] = { ...n[i], maxPerChapter: parseInt(e.target.value) || 0 }; up('clichePatterns', n); }} />
                  <span className="text-[10px]">次/章</span>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => up('clichePatterns', pd.clichePatterns.filter((_: any, j: number) => j !== i))}><X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => up('clichePatterns', [...(pd.clichePatterns ?? []), { pattern: '', maxPerChapter: 1 }])}><Plus className="w-3 h-3 mr-1" />添加套话</Button>
          </FormSection>

          <FormSection title="四、评审校准" defaultOpen={false}>
            <FL t="维度权重（0.5 ~ 2.0，值越高越重视）" impact="评审打分" />
            <div className="space-y-2">
              {Object.entries(WEIGHT_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-xs w-16 shrink-0">{label}</span>
                  <Slider min={0.5} max={2} step={0.1} value={[dw[k] ?? 1]} onValueChange={([v]) => upRW(k, v)} className="flex-1" />
                  <span className="text-xs w-8 text-right tabular-nums text-muted-foreground">{(dw[k] ?? 1).toFixed(1)}</span>
                </div>
              ))}
            </div>
            <FL t="题材专项检查" impact="评审" />
            <StrList value={rc.genreSpecificChecks ?? []} onChange={(v) => upR('genreSpecificChecks', v)} ph="输入一项检查要点..." />
            <FL t="高分标准（9-10 分）" impact="评审" />
            <Textarea className="text-xs" rows={2} value={sa.high ?? ''} onChange={(e) => upRS('high', e.target.value)} />
            <FL t="中分标准（5-6 分）" />
            <Textarea className="text-xs" rows={2} value={sa.mid ?? ''} onChange={(e) => upRS('mid', e.target.value)} />
            <FL t="低分标准（0-4 分）" />
            <Textarea className="text-xs" rows={2} value={sa.low ?? ''} onChange={(e) => upRS('low', e.target.value)} />
          </FormSection>

          <FormSection title="五、世界观配置" defaultOpen={false}>
            <div className="flex items-center gap-8">
              <div className="flex items-center gap-2"><Switch checked={wp.powerSystemApplicable ?? false} onCheckedChange={(v) => upWP('powerSystemApplicable', v)} /><Label className="text-xs">需要力量体系</Label></div>
              <div className="flex items-center gap-2"><Switch checked={wp.goldenFingerApplicable ?? false} onCheckedChange={(v) => upWP('goldenFingerApplicable', v)} /><Label className="text-xs">需要金手指</Label></div>
            </div>
            <FL t="组织类型" impact="写作" />
            <StrList value={wp.organizationTypes ?? []} onChange={(v) => upWP('organizationTypes', v)} ph="如：宗门、公会、学院..." />
            <FL t="承诺类型" impact="写作" />
            <StrList value={wp.commitmentTypes ?? []} onChange={(v) => upWP('commitmentTypes', v)} ph="如：誓言、约定、债务..." />
            <FL t="人际关系重心" impact="写作" />
            <Textarea className="text-xs" rows={2} value={wp.characterRelationEmphasis ?? ''} onChange={(e) => upWP('characterRelationEmphasis', e.target.value)} />
          </FormSection>

          <FormSection title="六、文风与章节策略" defaultOpen={false}>
            <FL t="文风参考文本（每段 150-200 字，最多 3 段）" impact="写作" />
            {(pd.styleReferenceTexts ?? []).map((txt: string, i: number) => (
              <div key={i} className="flex gap-1.5">
                <Textarea className="text-xs flex-1" rows={3} value={txt} onChange={(e) => { const n = [...pd.styleReferenceTexts]; n[i] = e.target.value; up('styleReferenceTexts', n); }} />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 mt-0.5 text-muted-foreground hover:text-destructive" onClick={() => up('styleReferenceTexts', pd.styleReferenceTexts.filter((_: string, j: number) => j !== i))}><X className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            {(pd.styleReferenceTexts?.length ?? 0) < 3 && <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => up('styleReferenceTexts', [...(pd.styleReferenceTexts ?? []), ''])}><Plus className="w-3 h-3 mr-1" />添加参考文本</Button>}
            <FL t="章节类型模板" impact="写作" />
            {Object.entries(CH_TYPE_LABELS).map(([k, label]) => (
              <div key={k}><Label className="text-[10px] text-muted-foreground">{label}章</Label><Textarea className="text-xs" rows={3} value={ct[k] ?? ''} onChange={(e) => upCT(k, e.target.value)} placeholder={`${label}章的写作模板...`} /></div>
            ))}
            <FL t="前三章策略" impact="写作" />
            <Textarea className="text-xs" rows={3} value={pd.firstChaptersStrategy ?? ''} onChange={(e) => up('firstChaptersStrategy', e.target.value)} placeholder="描述前 3 章如何抓住读者..." />
            <FL t="观众反应写法" impact="写作" />
            <Textarea className="text-xs" rows={3} value={pd.audienceReactionGuide ?? ''} onChange={(e) => up('audienceReactionGuide', e.target.value)} placeholder="描述关键时刻如何写周围人的反应..." />
          </FormSection>
        </TabsContent>

        <TabsContent value="seedhints" className="pt-4 space-y-4">
          <FL t="核心循环模式" impact="种子分析" />
          <StrList value={sh.coreLoopPatterns ?? []} onChange={(v) => setSh(p => ({ ...p, coreLoopPatterns: v }))} ph="如：逆袭式 — 被小看→积蓄→爆发→震惊众人..." />
          <FL t="金手指设计指引" impact="种子分析" />
          <Textarea className="text-xs" rows={3} value={sh.goldenFingerGuidance ?? ''} onChange={(e) => setSh(p => ({ ...p, goldenFingerGuidance: e.target.value }))} placeholder="描述这个题材的金手指/特殊能力设计要点..." />
          <FL t="世界观构建方向" impact="种子分析" />
          <Textarea className="text-xs" rows={3} value={sh.worldBuildingDirectives ?? ''} onChange={(e) => setSh(p => ({ ...p, worldBuildingDirectives: e.target.value }))} placeholder="描述这个题材的世界观构建方向和要点..." />

          <div className="border-t pt-4 space-y-3">
            <FL t="命名默认规则（系统模板优先）" impact="创建时优先写入并持久化" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">人名风格</Label>
                <Textarea className="text-xs mt-1" rows={2} value={sh.namingDefaults?.personNameStyle ?? ''} onChange={(e) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), personNameStyle: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">地名风格</Label>
                <Textarea className="text-xs mt-1" rows={2} value={sh.namingDefaults?.locationNameStyle ?? ''} onChange={(e) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), locationNameStyle: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">能力名风格（可选）</Label>
                <Textarea className="text-xs mt-1" rows={2} value={sh.namingDefaults?.abilityNameStyle ?? ''} onChange={(e) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), abilityNameStyle: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">势力名风格（可选）</Label>
                <Textarea className="text-xs mt-1" rows={2} value={sh.namingDefaults?.factionNameStyle ?? ''} onChange={(e) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), factionNameStyle: e.target.value } }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">道具名风格（可选）</Label>
                <Textarea className="text-xs mt-1" rows={2} value={sh.namingDefaults?.itemNameStyle ?? ''} onChange={(e) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), itemNameStyle: e.target.value } }))} />
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">示例人名</Label>
              <div className="mt-1">
                <StrList
                  value={sh.namingDefaults?.examples?.personNames ?? []}
                  onChange={(v) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), examples: { ...(p.namingDefaults?.examples ?? {}), personNames: v } } }))}
                  ph="如：凌霜、顾长歌..."
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">示例地名</Label>
              <div className="mt-1">
                <StrList
                  value={sh.namingDefaults?.examples?.locationNames ?? []}
                  onChange={(v) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), examples: { ...(p.namingDefaults?.examples ?? {}), locationNames: v } } }))}
                  ph="如：落霞谷、北陵城..."
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">示例能力名</Label>
              <div className="mt-1">
                <StrList
                  value={sh.namingDefaults?.examples?.abilityNames ?? []}
                  onChange={(v) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), examples: { ...(p.namingDefaults?.examples ?? {}), abilityNames: v } } }))}
                  ph="如：碧落剑诀、天火焚空..."
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">示例势力名</Label>
              <div className="mt-1">
                <StrList
                  value={sh.namingDefaults?.examples?.factionNames ?? []}
                  onChange={(v) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), examples: { ...(p.namingDefaults?.examples ?? {}), factionNames: v } } }))}
                  ph="如：天机阁、苍穹宗..."
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">命名禁忌</Label>
              <div className="mt-1">
                <StrList
                  value={sh.namingDefaults?.taboos ?? []}
                  onChange={(v) => setSh((p: any) => ({ ...p, namingDefaults: { ...(p.namingDefaults ?? {}), taboos: v } }))}
                  ph="如：英文名、现代网络梗..."
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="playbooks" className="pt-4 space-y-4">
          <p className="text-xs text-muted-foreground">结构化规则引擎——每条规则精确控制影响哪些 Agent、在什么条件下生效。点击规则可编辑。</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_PLAYBOOK_KEYS.map((key) => {
              const count = ruleAtoms.filter((a) => a.outputKey === key).length;
              return (
                <Button key={key} variant={playbookTab === key ? 'default' : 'outline'} size="sm" className="text-xs h-7" onClick={() => { setPlaybookTab(key); setActiveAgent(null); setEditingAtomId(null); }}>
                  {PLAYBOOK_META[key].label}
                  {count > 0 && <span className="ml-1 text-[10px] opacity-60">{count}</span>}
                </Button>
              );
            })}
          </div>
          <div className="rounded-md bg-muted/50 px-3 py-2.5 mb-2">
            <Label className="text-xs font-medium">{PLAYBOOK_META[playbookTab].label}</Label>
            <p className="text-[11px] text-muted-foreground mt-0.5">{PLAYBOOK_META[playbookTab].desc}</p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground/70 shrink-0">影响的 Agent：</span>
              {PLAYBOOK_META[playbookTab].agents.map((a) => {
                const info = AGENT_INFO[a];
                const isActive = activeAgent === a;
                return (
                  <Badge key={a} variant={isActive ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 cursor-pointer transition-colors"
                    onClick={() => setActiveAgent(isActive ? null : a)}>{info?.name ?? a}</Badge>
                );
              })}
            </div>
            {activeAgent && AGENT_INFO[activeAgent] && (
              <p className="text-[11px] text-primary/80 mt-1.5 pl-0.5">{AGENT_INFO[activeAgent].name}：{AGENT_INFO[activeAgent].desc}</p>
            )}
          </div>
          {/* 规则列表 */}
          <div className="space-y-1.5">
            {ruleAtoms.filter((a) => a.outputKey === playbookTab).sort((a, b) => b.priority - a.priority).map((atom) => {
              const isEditing = editingAtomId === atom.id;
              return (
                <div key={atom.id} className={cn('border rounded-lg transition-all', isEditing ? 'border-primary shadow-sm' : 'hover:border-muted-foreground/30')}>
                  <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setEditingAtomId(isEditing ? null : atom.id)}>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono shrink-0">P:{atom.priority}</Badge>
                    <span className={cn('text-xs font-medium flex-1 truncate', !atom.isEnabled && 'line-through opacity-50')}>{atom.title}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {atom.targetAgents.slice(0, 3).map((a) => (
                        <Badge key={a} variant="secondary" className="text-[9px] px-1 py-0">{AGENT_INFO[a]?.name ?? a}</Badge>
                      ))}
                      {atom.targetAgents.length > 3 && <Badge variant="secondary" className="text-[9px] px-1 py-0">+{atom.targetAgents.length - 3}</Badge>}
                      {atom.conditions?.length ? <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-300 text-amber-600">条件</Badge> : null}
                    </div>
                    <Switch checked={atom.isEnabled} onCheckedChange={(v) => {
                      setRuleAtoms((prev) => prev.map((a) => a.id === atom.id ? { ...a, isEnabled: v } : a));
                    }} className="shrink-0 scale-75" onClick={(e) => e.stopPropagation()} />
                    <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0', isEditing && 'rotate-180')} />
                  </div>
                  {isEditing && (
                    <div className="px-3 pb-3 pt-1 border-t space-y-2.5">
                      <div className="grid grid-cols-[60px_1fr] gap-x-2 gap-y-2 items-center">
                        <Label className="text-[10px]">标题</Label>
                        <Input className="text-xs h-7" value={atom.title} onChange={(e) => setRuleAtoms((prev) => prev.map((a) => a.id === atom.id ? { ...a, title: e.target.value } : a))} />
                        <Label className="text-[10px]">优先级</Label>
                        <div className="flex items-center gap-2">
                          <Slider min={0} max={100} step={5} value={[atom.priority]} onValueChange={([v]) => setRuleAtoms((prev) => prev.map((a) => a.id === atom.id ? { ...a, priority: v } : a))} className="flex-1" />
                          <span className="text-xs font-mono w-7 text-right">{atom.priority}</span>
                        </div>
                        <Label className="text-[10px]">来源</Label>
                        <Badge variant={atom.source === 'system' ? 'secondary' : atom.source === 'genre' ? 'default' : 'outline'} className="text-[10px] w-fit px-1.5 py-0">
                          {atom.source === 'system' ? '系统' : atom.source === 'genre' ? '题材' : '用户'}
                        </Badge>
                      </div>
                      <div>
                        <Label className="text-[10px] mb-1 block">影响 Agent</Label>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(AGENT_INFO).map(([id, info]) => (
                            <Badge key={id} variant={atom.targetAgents.includes(id) ? 'default' : 'outline'}
                              className="text-[10px] px-1.5 py-0 cursor-pointer transition-colors"
                              onClick={() => setRuleAtoms((prev) => prev.map((a) => {
                                if (a.id !== atom.id) return a;
                                const has = a.targetAgents.includes(id);
                                return { ...a, targetAgents: has ? a.targetAgents.filter((x) => x !== id) : [...a.targetAgents, id] };
                              }))}>{info.name}</Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] mb-1 block">规则内容</Label>
                        <Textarea className="font-mono text-xs min-h-[120px]" value={atom.content}
                          onChange={(e) => setRuleAtoms((prev) => prev.map((a) => a.id === atom.id ? { ...a, content: e.target.value } : a))} />
                      </div>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" className="text-xs h-7 text-destructive hover:text-destructive"
                          onClick={() => { setRuleAtoms((prev) => prev.filter((a) => a.id !== atom.id)); setEditingAtomId(null); }}>
                          <Trash2 className="w-3 h-3 mr-1" />删除规则
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {ruleAtoms.filter((a) => a.outputKey === playbookTab).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-xs">该分类暂无规则</div>
            )}
          </div>
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => {
            const catKey = Object.entries(PLAYBOOK_META).find(([k]) => k === playbookTab)?.[0] ?? playbookTab;
            const category = catKey.replace('_PLAYBOOK', '').toLowerCase();
            const newAtom: RuleAtom = {
              id: `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              category, title: '新规则', content: '', priority: 50,
              targetAgents: PLAYBOOK_META[playbookTab]?.agents ?? ['creative-writer'],
              outputKey: playbookTab, isEnabled: true, source: 'user',
            };
            setRuleAtoms((prev) => [...prev, newAtom]);
            setEditingAtomId(newAtom.id);
          }}><Plus className="w-3 h-3 mr-1" />添加规则</Button>
        </TabsContent>

        <TabsContent value="agents" className="pt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Agent 指令由 AI 根据写作档案和写作规则自动生成，用于指导各个写作 Agent 的工作方式。修改写作档案或写作规则后会自动重新生成。
          </p>
          {agentSections.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">暂无 Agent 指令缓存，保存模板后在创建小说时会自动生成</div>
          ) : (
            (() => {
              const grouped = new Map<string, Array<{ key: string; content: string; idx: number }>>();
              agentSections.forEach((s, idx) => {
                const list = grouped.get(s.agentId) ?? [];
                list.push({ key: s.key, content: s.content, idx });
                grouped.set(s.agentId, list);
              });
              const AGENT_LABELS: Record<string, string> = {
                intent: '意图策划', 'scene-planner': '场景导演', 'creative-writer': '创意写手',
                'scene-stitcher': '场景缝合', reviewer: '质量审阅', editor: '编辑修复',
                'hook-crafter': '钩子工匠', 'arc-director': '卷导演', 'arc-planner': '卷规划',
                'volume-director': '大卷导演', 'volume-foreshadowing': '伏笔设计', 'style-anchoring': '文风锚定',
              };
              return Array.from(grouped.entries()).map(([agentId, items]) => (
                <FormSection key={agentId} title={AGENT_LABELS[agentId] ?? agentId} defaultOpen={false}>
                  {items.map((item) => (
                    <div key={item.key}>
                      <Label className="text-[10px] text-muted-foreground">{item.key}</Label>
                      <Textarea className="font-mono text-xs min-h-[120px] mt-0.5" value={item.content}
                        onChange={(e) => { const n = [...agentSections]; n[item.idx] = { ...n[item.idx], content: e.target.value }; setAgentSections(n); }} />
                    </div>
                  ))}
                </FormSection>
              ));
            })()
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

/* ─── Drama Template Card ─── */
const DramaTemplateCard: React.FC<{
  tpl: DramaGenreTemplate;
  onEdit: (tpl: DramaGenreTemplate) => void;
  onClone: (id: string) => void;
  onDelete: (tpl: DramaGenreTemplate) => void;
}> = ({ tpl, onEdit, onClone, onDelete }) => {
  const gradient = DRAMA_GENRE_COLORS[tpl.genreKey] ?? 'from-violet-500 to-fuchsia-600';
  return (
    <Card className="group cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 overflow-hidden relative" onClick={() => onEdit(tpl)}>
      <div className={cn('h-2 bg-gradient-to-r', gradient)} />
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3 className="font-semibold text-sm truncate">{tpl.displayName}</h3>
              {tpl.isSystem && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0"><Shield className="w-3 h-3 mr-0.5" />预置</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description || '暂无描述'}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
        <div className="flex flex-wrap gap-1">
          {tpl.genreKeywords.slice(0, 4).map((kw) => <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0">{kw}</Badge>)}
          {(tpl.platformTags ?? []).slice(0, 3).map((p) => <Badge key={p} className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">{PLATFORM_LABELS[p] ?? p}</Badge>)}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex gap-1.5">
            {tpl.audienceTags?.slice(0, 2).map((t) => <span key={t}>{t}</span>)}
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClone(tpl.id)} title="克隆"><Copy className="w-3.5 h-3.5" /></Button>
            {!tpl.isSystem && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(tpl)} title="删除"><Trash2 className="w-3.5 h-3.5" /></Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

/* ─── Drama Template Edit Panel ─── */
const DramaEditPanel: React.FC<{ tplId: string; onBack: () => void; onSaved: () => void }> = ({ tplId, onBack, onSaved }) => {
  const [tpl, setTpl] = useState<DramaGenreTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [audienceTags, setAudienceTags] = useState<string[]>([]);
  const [protagonistFocusTags, setProtagonistFocusTags] = useState<string[]>([]);
  const [toneTags, setToneTags] = useState<string[]>([]);
  const [platformTags, setPlatformTags] = useState<string[]>([]);
  const [seedHints, setSeedHints] = useState<Record<string, any>>({});

  useEffect(() => {
    setLoading(true);
    getDramaGenreTemplate(tplId).then((data) => {
      setTpl(data); setDisplayName(data.displayName); setDescription(data.description);
      setKeywords(data.genreKeywords.join('、'));
      setAudienceTags(data.audienceTags ?? []); setProtagonistFocusTags(data.protagonistFocusTags ?? []);
      setToneTags(data.toneTags ?? []); setPlatformTags(data.platformTags ?? []);
      setSeedHints(data.seedHints ?? {});
    }).catch(() => message.error('加载短剧模板详情失败')).finally(() => setLoading(false));
  }, [tplId]);

  const handleSave = async () => {
    if (!tpl) return;
    setSaving(true);
    try {
      await updateDramaGenreTemplate(tplId, {
        displayName, description, genreKeywords: keywords.split(/[,，、\s]+/).filter(Boolean),
        audienceTags, protagonistFocusTags: protagonistFocusTags as any, toneTags, platformTags, seedHints,
      });
      message.success('保存成功'); onSaved();
    } catch (err: any) { message.error(err?.data?.message || '保存失败'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!tpl) return <div className="text-center py-12 text-muted-foreground">模板不存在</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5"><ArrowLeft className="w-4 h-4" />返回列表</Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Pencil className="w-4 h-4 mr-1.5" />}保存修改
        </Button>
      </div>
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="basic">基本信息</TabsTrigger>
          <TabsTrigger value="audience">受众与平台</TabsTrigger>
          <TabsTrigger value="seedhints">创作引导</TabsTrigger>
          <TabsTrigger value="profile">扩展配置</TabsTrigger>
        </TabsList>
        <TabsContent value="basic" className="space-y-4 pt-4">
          <div><Label>显示名称</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>描述</Label><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><Label>关键词（顿号/逗号分隔）</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="霸总、总裁、豪门" /></div>
        </TabsContent>
        <TabsContent value="audience" className="space-y-4 pt-4">
          <FormSection title="受众标签">
            <StrList value={audienceTags} onChange={setAudienceTags} ph="如: 女性向、18-35岁" />
          </FormSection>
          <FormSection title="主角聚焦">
            <div className="flex flex-wrap gap-2">
              {['female_lead', 'male_lead', 'dual_lead', 'ensemble'].map(tag => {
                const labels: Record<string, string> = { female_lead: '女主视角', male_lead: '男主视角', dual_lead: '双主角', ensemble: '群像' };
                const selected = protagonistFocusTags.includes(tag);
                return <Badge key={tag} variant={selected ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setProtagonistFocusTags(selected ? protagonistFocusTags.filter(t => t !== tag) : [...protagonistFocusTags, tag])}>{labels[tag]}</Badge>;
              })}
            </div>
          </FormSection>
          <FormSection title="调性标签">
            <StrList value={toneTags} onChange={setToneTags} ph="如: 爽快、反转、高甜" />
          </FormSection>
          <FormSection title="目标平台">
            <div className="flex flex-wrap gap-2">
              {Object.entries(PLATFORM_LABELS).map(([key, label]) => {
                const selected = platformTags.includes(key);
                return <Badge key={key} variant={selected ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setPlatformTags(selected ? platformTags.filter(t => t !== key) : [...platformTags, key])}>{label}</Badge>;
              })}
            </div>
          </FormSection>
        </TabsContent>
        <TabsContent value="seedhints" className="space-y-4 pt-4">
          <FormSection title="爽点预设">
            <StrList value={seedHints.catharsisPresets ?? []} onChange={(v) => setSeedHints(p => ({ ...p, catharsisPresets: v }))} ph="如: 打脸、身份揭露、逆袭归来" />
          </FormSection>
          <FormSection title="冲突模式">
            <StrList value={seedHints.conflictPatterns ?? []} onChange={(v) => setSeedHints(p => ({ ...p, conflictPatterns: v }))} ph="如: 阶级对立、身份反差、前任纠葛" />
          </FormSection>
          <FormSection title="付费卡点策略">
            <Textarea className="text-xs" rows={3} value={seedHints.paywallStrategyHints ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, paywallStrategyHints: e.target.value }))} placeholder="描述关键付费卡点的设置策略..." />
          </FormSection>
          <FormSection title="视觉风格提示" defaultOpen={false}>
            <Textarea className="text-xs" rows={2} value={seedHints.visualStyleHints ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, visualStyleHints: e.target.value }))} placeholder="如: 暖色调、柔光滤镜、都市质感..." />
          </FormSection>
          <FormSection title="台词风格提示" defaultOpen={false}>
            <Textarea className="text-xs" rows={2} value={seedHints.dialogueStyleHints ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, dialogueStyleHints: e.target.value }))} placeholder="如: 短句为主、金句密集、情绪张力强..." />
          </FormSection>
        </TabsContent>
        <TabsContent value="profile" className="space-y-4 pt-4">
          <p className="text-xs text-muted-foreground">短剧 Profile 扩展配置，后续版本将支持更多定制项。</p>
          <FormSection title="平台默认参数" defaultOpen={false}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label className="text-[10px]">目标平台</Label><Input className="text-xs h-8 mt-1" value={seedHints.platformDefaults?.platformTarget ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, platformDefaults: { ...(p.platformDefaults ?? {}), platformTarget: e.target.value } }))} placeholder="douyin" /></div>
              <div><Label className="text-[10px]">画面比例</Label><Input className="text-xs h-8 mt-1" value={seedHints.platformDefaults?.aspectRatio ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, platformDefaults: { ...(p.platformDefaults ?? {}), aspectRatio: e.target.value } }))} placeholder="9:16" /></div>
              <div><Label className="text-[10px]">单集时长(秒)</Label><Input type="number" className="text-xs h-8 mt-1" value={seedHints.platformDefaults?.durationSec ?? ''} onChange={(e) => setSeedHints(p => ({ ...p, platformDefaults: { ...(p.platformDefaults ?? {}), durationSec: parseInt(e.target.value) || undefined } }))} placeholder="90" /></div>
            </div>
          </FormSection>
        </TabsContent>
      </Tabs>
    </div>
  );
};

/* ─── Main Page ─── */
const GenreTemplatesPage: React.FC = () => {
  const [contentTab, setContentTab] = useState<ContentTab>('novel');
  const [templates, setTemplates] = useState<GenreProfileTemplate[]>([]);
  const [dramaTemplates, setDramaTemplates] = useState<DramaGenreTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [showDramaAiDialog, setShowDramaAiDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dramaEditingId, setDramaEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GenreProfileTemplate | null>(null);
  const [dramaDeleteTarget, setDramaDeleteTarget] = useState<DramaGenreTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const [novels, dramas] = await Promise.all([listGenreTemplates(), listDramaGenreTemplates()]);
      setTemplates(novels); setDramaTemplates(dramas);
    } catch { message.error('加载题材模板失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const handleClone = async (id: string) => {
    try {
      await cloneGenreTemplate(id);
      message.success('克隆成功'); fetchTemplates();
    } catch (err: any) { message.error(err?.data?.message || '克隆失败'); }
  };

  const handleDramaClone = async (id: string) => {
    try {
      await cloneDramaGenreTemplate(id);
      message.success('克隆成功'); fetchTemplates();
    } catch (err: any) { message.error(err?.data?.message || '克隆失败'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGenreTemplate(deleteTarget.id);
      message.success('删除成功'); setDeleteTarget(null); fetchTemplates();
    } catch (err: any) { message.error(err?.data?.message || '删除失败'); }
    finally { setDeleting(false); }
  };

  const handleDramaDelete = async () => {
    if (!dramaDeleteTarget) return;
    setDeleting(true);
    try {
      await deleteDramaGenreTemplate(dramaDeleteTarget.id);
      message.success('删除成功'); setDramaDeleteTarget(null); fetchTemplates();
    } catch (err: any) { message.error(err?.data?.message || '删除失败'); }
    finally { setDeleting(false); }
  };

  const filtered = templates.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.displayName.toLowerCase().includes(q) || t.genreKey.toLowerCase().includes(q) || t.genreKeywords.some((kw) => kw.toLowerCase().includes(q));
  });

  const filteredDrama = dramaTemplates.filter((t) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return t.displayName.toLowerCase().includes(q) || t.genreKey.toLowerCase().includes(q) || t.genreKeywords.some((kw) => kw.toLowerCase().includes(q));
  });

  if (editingId) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <TemplateEditPanel tplId={editingId} onBack={() => { setEditingId(null); fetchTemplates(); }} onSaved={(newId) => { fetchTemplates(); if (newId) setEditingId(newId); }} />
      </div>
    );
  }

  if (dramaEditingId) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <DramaEditPanel tplId={dramaEditingId} onBack={() => { setDramaEditingId(null); fetchTemplates(); }} onSaved={fetchTemplates} />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" />题材模板管理
        </h1>
        <p className="text-sm text-muted-foreground mt-1">管理小说和短剧的题材模板，创建作品时自动匹配使用</p>
        <div className="flex items-center gap-4 mt-4 border-b">
          {(['novel', 'drama'] as ContentTab[]).map(t => (
            <button key={t} className={cn('flex items-center gap-1.5 text-sm font-medium pb-2.5 border-b-2 -mb-px transition-colors', contentTab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')} onClick={() => { setContentTab(t); setSearch(''); }}>
              {t === 'novel' ? <><BookOpen className="w-3.5 h-3.5" />小说 ({templates.length})</> : <><Film className="w-3.5 h-3.5" />短剧 ({dramaTemplates.length})</>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9 pr-8" placeholder="搜索题材名称、关键词..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>}
        </div>
        <Button variant="outline" size="sm" onClick={() => contentTab === 'novel' ? setShowAiDialog(true) : setShowDramaAiDialog(true)}><Wand2 className="w-4 h-4 mr-1.5" />AI 生成</Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : contentTab === 'novel' ? (
        filtered.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><Plus className="w-6 h-6 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground mb-4">暂无小说题材模板，使用 AI 快速生成一个</p>
              <Button variant="outline" size="sm" onClick={() => setShowAiDialog(true)}><Wand2 className="w-4 h-4 mr-1.5" />AI 生成新模板</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => <TemplateCard key={t.id} tpl={t} onEdit={(tpl) => setEditingId(tpl.id)} onClone={handleClone} onDelete={setDeleteTarget} />)}
          </div>
        )
      ) : (
        filteredDrama.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3"><Film className="w-6 h-6 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground mb-4">暂无短剧题材模板，使用 AI 快速生成一个</p>
              <Button variant="outline" size="sm" onClick={() => setShowDramaAiDialog(true)}><Wand2 className="w-4 h-4 mr-1.5" />AI 生成新模板</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDrama.map((t) => <DramaTemplateCard key={t.id} tpl={t} onEdit={(tpl) => setDramaEditingId(tpl.id)} onClone={handleDramaClone} onDelete={setDramaDeleteTarget} />)}
          </div>
        )
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle><DialogDescription>删除模板「{deleteTarget?.displayName}」后无法恢复，确定继续？</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dramaDeleteTarget} onOpenChange={(v) => !v && setDramaDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle><DialogDescription>删除短剧模板「{dramaDeleteTarget?.displayName}」后无法恢复，确定继续？</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDramaDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDramaDelete} disabled={deleting}>{deleting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1.5" />}确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AiGenerateDialog open={showAiDialog} onClose={() => setShowAiDialog(false)} onGenerated={fetchTemplates} />
      <DramaAiGenerateDialog open={showDramaAiDialog} onClose={() => setShowDramaAiDialog(false)} onGenerated={fetchTemplates} />
    </div>
  );
};

export default GenreTemplatesPage;
