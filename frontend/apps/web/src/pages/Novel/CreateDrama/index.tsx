import React, { useState, useCallback, useEffect, useRef } from 'react';
import { history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, ArrowRight, Sparkles, Loader2, Film, Users, Target,
  Settings2, Check, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  createDrama, retryCreateDrama, getDrama, getCreateDramaSseUrl, listDramaGenreTemplates,
  enhanceDramaIdea, generateDramaGoal, recommendGenreAndAudience,
  type CreateDramaParams, type DramaGenreTemplate,
} from '@/services/drama';
import { getToken } from '@/services/auth';

const GENRE_ICONS: Record<string, string> = {
  boss: '💼', sweet: '🍬', warrior: '⚔️', timetravel: '🌀', palace: '👑',
  revenge: '🔥', rebirth: '🔄', suspense: '🔍', urban: '🏙️', ancient: '🏮',
};

const PLATFORM_PRESETS = [
  { value: 'douyin' as const, label: '抖音' },
  { value: 'kuaishou' as const, label: '快手' },
  { value: 'reelshort' as const, label: 'ReelShort' },
  { value: 'dramabox' as const, label: 'DramaBox' },
  { value: 'generic' as const, label: '通用' },
];

const DURATION_PRESETS = [
  { value: 120, label: '2 分钟', desc: '节奏最快' },
  { value: 180, label: '3 分钟', desc: '标准时长' },
  { value: 300, label: '5 分钟', desc: '深度叙事' },
];

const SCALE_PRESETS = [
  { min: 40, max: 60, label: '40-60 集', desc: '紧凑型' },
  { min: 60, max: 100, label: '60-100 集', desc: '标准型' },
  { min: 100, max: 150, label: '100-150 集', desc: '长线型' },
];

const AUDIENCE_PRESETS = [
  { label: '18-30 岁女性', tags: ['女性向', '18-30岁'] },
  { label: '18-30 岁男性', tags: ['男性向', '18-30岁'] },
  { label: '25-40 岁女性', tags: ['女性向', '25-40岁'] },
  { label: '全年龄', tags: ['男女通吃'] },
];

const PROTAGONIST_FOCUS = [
  { value: 'female_lead' as const, label: '女主向' },
  { value: 'male_lead' as const, label: '男主向' },
  { value: 'dual_lead' as const, label: '双主角' },
  { value: 'ensemble' as const, label: '群像' },
];

const STEPS = [
  { title: '核心创意', icon: Sparkles, desc: '描述你的短剧灵感' },
  { title: '类型与受众', icon: Users, desc: '选择题材、平台与受众' },
  { title: '主线与剧名', icon: Target, desc: '定义核心冲突和剧名' },
  { title: '规模配置', icon: Settings2, desc: '集数和时长设置' },
];

const GEN_STEPS = [
  { label: '种子分析', step: 'create_0' },
  { label: '总导演规划大纲', step: 'create_1' },
  { label: '视觉资产设计', step: 'create_2' },
  { label: '编剧手册+策略', step: 'create_3' },
  { label: '完成', step: 'create_4' },
];

interface FormState extends CreateDramaParams { customAudience: string; useCustomAudience: boolean; }

const CreateDrama: React.FC = () => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genSteps, setGenSteps] = useState(GEN_STEPS.map(s => ({ ...s, done: false })));
  const [genError, setGenError] = useState<string | null>(null);
  const failedDramaIdRef = useRef<string | null>(null); // 失败时保存 dramaId，重试时从 checkpoint 继续
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const [enhancing, setEnhancing] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [originalIdea, setOriginalIdea] = useState('');
  const [generatingGoal, setGeneratingGoal] = useState(false);
  const [goalAlternatives, setGoalAlternatives] = useState<string[]>([]);
  const [recommending, setRecommending] = useState(false);

  const [templates, setTemplates] = useState<DramaGenreTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  useEffect(() => {
    setTemplatesLoading(true);
    listDramaGenreTemplates().then(setTemplates).catch(() => {}).finally(() => setTemplatesLoading(false));
  }, []);

  const [form, setForm] = useState<FormState>({
    mainIdea: '', genre: '', targetAudience: '', protagonistFocus: 'female_lead',
    tonePreference: '', audienceTags: [], titleHint: '', mainStoryGoal: '',
    platformTarget: 'generic', aspectRatio: '9:16',
    targetEpisodeDurationSec: 180, plannedMinEpisodes: 60, plannedMaxEpisodes: 100,
    customAudience: '', useCustomAudience: false,
  });

  const effectiveAudience = form.useCustomAudience ? form.customAudience : form.targetAudience;
  const isGenerating = step === 4;
  const formStepCount = STEPS.length;

  const canNext = useCallback(() => {
    if (step === 0) return (form.mainIdea ?? '').trim().length >= 10;
    if (step === 1) return (form.genre ?? '').trim().length > 0 && (effectiveAudience ?? '').trim().length > 0;
    if (step === 2) return true;
    if (step === 3) return true;
    return false;
  }, [step, form, effectiveAudience]);

  const handleEnhance = async () => {
    if ((form.mainIdea ?? '').trim().length < 5) return;
    setEnhancing(true);
    setOriginalIdea(form.mainIdea);
    try {
      const result = await enhanceDramaIdea(form.mainIdea, form.genre || undefined);
      if (result?.enhanced) {
        setForm(prev => ({ ...prev, mainIdea: result.enhanced }));
        setHighlights(result.highlights ?? []);
      }
    } catch { /* keep original */ }
    finally { setEnhancing(false); }
  };

  const handleRevertIdea = () => {
    if (originalIdea) { setForm(prev => ({ ...prev, mainIdea: originalIdea })); setHighlights([]); setOriginalIdea(''); }
  };

  const handleGenerateGoal = async () => {
    if (!form.genre || !effectiveAudience || !form.mainIdea) return;
    setGeneratingGoal(true);
    try {
      const result = await generateDramaGoal(form.mainIdea, form.genre, effectiveAudience);
      if (result?.goal) { setForm(prev => ({ ...prev, mainStoryGoal: result.goal })); setGoalAlternatives(result.alternatives ?? []); }
    } catch { /* keep empty */ }
    finally { setGeneratingGoal(false); }
  };

  const handleRecommendGenreAudience = async () => {
    if (!(form.mainIdea ?? '').trim()) return;
    setRecommending(true);
    try {
      const r = await recommendGenreAndAudience(form.mainIdea);
      const tpl = templates.find(t => t.displayName === r.genreDisplayName);
      const audienceTags = AUDIENCE_PRESETS.find(a => a.label === r.targetAudience)?.tags ?? [];
      setForm(prev => ({
        ...prev, genre: r.genreDisplayName, genreTemplateId: tpl?.id ?? prev.genreTemplateId,
        platformTarget: r.platformTarget as FormState['platformTarget'],
        targetAudience: r.targetAudience, audienceTags,
        protagonistFocus: r.protagonistFocus as FormState['protagonistFocus'],
      }));
      message.success('已根据创意智能推荐');
    } catch { message.error('推荐失败'); }
    finally { setRecommending(false); }
  };

  const handleSubmit = async () => {
    const isRetry = !!(genError && failedDramaIdRef.current);
    setStep(4);
    setLoading(true);
    setGenProgress(0);
    if (!isRetry) setGenError(null);
    setGenSteps(GEN_STEPS.map(s => ({ ...s, done: false })));

    const params: CreateDramaParams = {
      mainIdea: form.mainIdea, genre: form.genre, targetAudience: effectiveAudience,
      protagonistFocus: form.protagonistFocus, tonePreference: form.tonePreference || undefined,
      audienceTags: form.audienceTags?.length ? form.audienceTags : undefined,
      titleHint: form.titleHint || undefined, mainStoryGoal: form.mainStoryGoal || undefined,
      platformTarget: form.platformTarget, aspectRatio: form.aspectRatio,
      targetEpisodeDurationSec: form.targetEpisodeDurationSec,
      plannedMinEpisodes: form.plannedMinEpisodes, plannedMaxEpisodes: form.plannedMaxEpisodes,
      genreTemplateId: form.genreTemplateId || undefined,
    };

    const STALE_MS = 600_000;
    let staleTimer!: ReturnType<typeof setTimeout>;
    let dramaId: string | undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    const touchStale = () => { clearTimeout(staleTimer); staleTimer = setTimeout(() => controller.abort(), STALE_MS); };

    try {
      if (isRetry) {
        dramaId = failedDramaIdRef.current!;
        await retryCreateDrama(dramaId);
        setGenError(null);
      } else {
        failedDramaIdRef.current = null;
        const res = await createDrama(params);
        dramaId = res.dramaId;
      }
      touchStale();

      const response = await fetch(getCreateDramaSseUrl(dramaId), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        clearTimeout(staleTimer);
        const poll = async () => {
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 3000));
            try {
              const d = await getDrama(dramaId) as any;
              if (d?.state?.seed) {
                setGenSteps(prev => prev.map(s => ({ ...s, done: true })));
                setGenProgress(100);
                message.success('短剧创建成功');
                setTimeout(() => history.push(`/novel/drama/${dramaId}`), 600);
                return;
              }
            } catch { /* retry */ }
          }
          failedDramaIdRef.current = dramaId ?? null;
          setGenError('创建超时');
          setLoading(false);
        };
        poll();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        touchStale();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload._type === 'heartbeat') continue;
            if (payload.error) { clearTimeout(staleTimer); failedDramaIdRef.current = dramaId; setGenError(payload.message ?? '创建失败'); setLoading(false); return; }

            const idx = payload.stepIndex ?? -1;
            const progress = payload.totalSteps > 0 ? Math.round(((idx + (payload.done ? 1 : 0.5)) / payload.totalSteps) * 100) : 0;
            setGenProgress(progress);

            if (idx >= 0) {
              setGenSteps(prev => prev.map((s, i) => {
                if (i < idx) return { ...s, done: true };
                if (i === idx) return { ...s, done: payload.done ?? false };
                return s;
              }));
            }

            if (payload.done && payload.step === 'create_4') {
              clearTimeout(staleTimer);
              failedDramaIdRef.current = null;
              setGenProgress(100);
              message.success('短剧创建成功');
              setTimeout(() => history.push(`/novel/drama/${dramaId}`), 600);
              return;
            }
          } catch { /* skip malformed */ }
        }
      }

      clearTimeout(staleTimer);
      failedDramaIdRef.current = null;
      setGenProgress(100);
      setGenSteps(prev => prev.map(s => ({ ...s, done: true })));
      message.success('短剧创建成功');
      setTimeout(() => history.push(`/novel/drama/${dramaId}`), 600);
    } catch (error: any) {
      clearTimeout(staleTimer!);
      if (dramaId) failedDramaIdRef.current = dramaId;
      const errMsg = error?.message || '创建失败';
      message.error(errMsg);
      setGenError(errMsg);
      setLoading(false);
    }
  };

  const goBack = () => {
    if (isGenerating) return;
    if (step > 0) setStep(step - 1);
    else history.push('/novel');
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5 -ml-2" onClick={goBack} disabled={loading}>
        <ArrowLeft className="h-4 w-4" />{step > 0 && !isGenerating ? '上一步' : '返回书架'}
      </Button>

      {!isGenerating && (
        <div className="hidden sm:block mb-6">
          <div className="flex items-center">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              return (
                <React.Fragment key={s.title}>
                  <button type="button" className={cn('flex items-center gap-2.5 transition-all shrink-0', i < step && 'cursor-pointer group', i > step && 'cursor-default')} onClick={() => i < step && setStep(i)} disabled={i > step}>
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-all duration-300', i < step ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : i === step ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/20 shadow-md shadow-primary/20' : 'bg-muted text-muted-foreground')}>
                      {i < step ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                    </div>
                    <div className="hidden md:block text-left">
                      <p className={cn('text-sm font-semibold leading-tight', i === step ? 'text-foreground' : i < step ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground')}>{s.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{s.desc}</p>
                    </div>
                  </button>
                  {i < STEPS.length - 1 && <div className="flex-1 mx-3 md:mx-4"><div className={cn('h-0.5 rounded-full transition-colors duration-300', i < step ? 'bg-primary/60' : 'bg-border')} /></div>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {!isGenerating && (
        <div className="sm:hidden mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 text-white font-bold text-sm shadow-sm shrink-0">{step + 1}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{STEPS[step]?.title}</p>
              <p className="text-xs text-muted-foreground">{STEPS[step]?.desc}</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{step + 1}/{formStepCount}</span>
          </div>
          <div className="mt-3 flex gap-1">
            {Array.from({ length: formStepCount }).map((_, i) => (
              <div key={i} className={cn('h-1 flex-1 rounded-full transition-all duration-300', i <= step ? 'bg-violet-500' : 'bg-muted')} />
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Core Idea */}
      {step === 0 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">你的短剧灵感是什么？</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">越具体越好：人物背景、核心冲突、身份反差。AI 会基于此构建完整的短剧世界。</p>
          </div>
          <Card className="border-primary/15 bg-primary/5">
            <CardContent className="p-4 text-sm">
              <div className="flex items-start gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" /><div><p className="font-medium text-foreground">这一步做什么？</p><p className="mt-1 text-muted-foreground">用一段话描述你的短剧故事梗概，AI 会据此生成世界观、角色和剧情。建议包含：<strong>人物身份</strong>（如隐藏身份）、<strong>核心冲突</strong>（如被羞辱/背叛）、<strong>爽点反转</strong>（如身份揭晓、打脸复仇）。</p></div></div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Label>核心创意</Label>
            <Textarea placeholder="例如：隐瞒首富独女身份下嫁三年做牛做马，被婆婆羞辱净身出户。暴雨夜她登上劳斯莱斯，老管家：大小姐玩够了吗？老爷喊您回家继承千亿集团。归来后她令前夫家族高攀不起..." className="min-h-[140px] text-sm resize-none" disabled={enhancing} value={form.mainIdea} onChange={(e) => { setForm({ ...form, mainIdea: e.target.value }); if (highlights.length > 0) { setHighlights([]); setOriginalIdea(''); } }} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{(form.mainIdea ?? '').length} 字 · 建议至少 20 字</p>
              <div className="flex items-center gap-1.5 shrink-0">
                {originalIdea && <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={handleRevertIdea}><ArrowLeft className="h-3 w-3" />还原</Button>}
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={(form.mainIdea ?? '').trim().length < 5 || enhancing} onClick={handleEnhance}>
                  {enhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {enhancing ? 'AI 优化中...' : 'AI 美化创意'}
                </Button>
              </div>
            </div>
          </div>

          {highlights.length > 0 && (
            <Card className="border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-white to-teal-50/50 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:via-background dark:to-teal-950/20">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">AI 创意增强</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0">{highlights.length} 项优化</Badge>
                </div>
                <div className="space-y-2.5">
                  {highlights.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}>
                      <span className="shrink-0 mt-[3px] flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/10 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{i + 1}</span>
                      <p className="text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">{h}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 2: Genre & Audience */}
      {step === 1 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">选择题材与目标观众</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">根据上一步的创意，选择最匹配的题材和受众，AI 会据此调整爽点设计、节奏和风格。</p>
          </div>
          <Card className="border-primary/15 bg-primary/5">
            <CardContent className="p-4 text-sm">
              <div className="flex items-start gap-2"><Users className="h-4 w-4 text-primary shrink-0 mt-0.5" /><div><p className="font-medium text-foreground">如何选择？</p><p className="mt-1 text-muted-foreground"><strong>题材</strong>：选与创意最贴合的（如豪门逆袭→都市/霸总，宫斗权谋→宫斗）。<strong>平台</strong>：抖音/快手节奏更快，ReelShort 偏海外。<strong>观众</strong>：决定爽点侧重（女性向偏情感打脸，男性向偏权谋战力）。<strong>叙事聚焦</strong>：女主向=以女主视角为主，双主角=男女戏份均衡。</p><Button variant="outline" size="sm" className="mt-3 gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={!(form.mainIdea ?? '').trim() || recommending} onClick={handleRecommendGenreAudience}>{recommending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{recommending ? 'AI 推荐中...' : 'AI 智能推荐'}</Button></div></div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div><Label>短剧题材</Label><p className="text-xs text-muted-foreground mt-0.5">选与创意最匹配的，点击卡片即可</p></div>
              <button type="button" className="text-xs text-primary hover:underline shrink-0" onClick={() => history.push('/novel/templates')}>管理题材模板</button>
            </div>
            {templatesLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" />加载题材模板...</div>
            ) : templates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {templates.map(t => (
                  <button key={t.id} type="button" className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all hover:border-primary/50',
                    form.genreTemplateId === t.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                  )} onClick={() => setForm({ ...form, genre: t.displayName, genreTemplateId: t.id })}>
                    <span className="text-lg">{GENRE_ICONS[t.genreKey] ?? '📝'}</span>
                    <span className="text-xs font-medium">{t.displayName}</span>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</span>
                    {!t.isSystem && <span className="text-[9px] text-primary/60">自定义</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <p>暂无题材模板，请先去<button type="button" className="text-primary hover:underline mx-1" onClick={() => history.push('/novel/templates')}>题材模板管理</button>添加</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div><Label>目标平台</Label><p className="text-xs text-muted-foreground mt-0.5">不同平台用户偏好不同，影响节奏和风格</p></div>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_PRESETS.map(p => (
                <Badge key={p.value} variant={form.platformTarget === p.value ? 'default' : 'outline'}
                  className={cn('cursor-pointer px-3 py-1.5 text-xs', form.platformTarget === p.value && 'ring-2 ring-primary/20')}
                  onClick={() => setForm({ ...form, platformTarget: p.value })}
                >{p.label}</Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div><Label>目标观众</Label><p className="text-xs text-muted-foreground mt-0.5">决定剧情走向和爽点设计，选主受众即可</p></div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_PRESETS.map(a => (
                <Badge key={a.label} variant={form.targetAudience === a.label ? 'default' : 'outline'}
                  className={cn('cursor-pointer px-3 py-1.5 text-xs', form.targetAudience === a.label && 'ring-2 ring-primary/20')}
                  onClick={() => setForm({ ...form, targetAudience: a.label, audienceTags: a.tags })}
                >{a.label}</Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div><Label>叙事聚焦</Label><p className="text-xs text-muted-foreground mt-0.5">决定主角视角和叙事重心</p></div>
            <div className="grid grid-cols-4 gap-2">
              {PROTAGONIST_FOCUS.map(opt => (
                <button key={opt.value} type="button" className={cn(
                  'rounded-lg border p-2 text-center text-xs font-medium transition-all',
                  form.protagonistFocus === opt.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, protagonistFocus: opt.value })}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Goal & Title */}
      {step === 2 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Target className="h-6 w-6 text-primary shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold">主线目标与剧名</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground pl-9">核心冲突是贯穿全剧的驱动力，可以自己写，也可以让 AI 根据前面的信息帮你生成。</p>
          </div>
          <div className="space-y-2">
            <Label>核心冲突（可选）</Label>
            <Textarea placeholder="例如：女主揭露豪门家族的真相..." className="min-h-[100px] text-sm resize-none" value={form.mainStoryGoal} onChange={(e) => { setForm({ ...form, mainStoryGoal: e.target.value }); if (goalAlternatives.length > 0) setGoalAlternatives([]); }} />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={generatingGoal} onClick={handleGenerateGoal}>
                {generatingGoal ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generatingGoal ? 'AI 生成中...' : 'AI 生成目标'}
              </Button>
            </div>
          </div>

          {goalAlternatives.length > 0 && (
            <Card className="border-primary/15 bg-gradient-to-br from-primary/3 to-transparent">
              <CardContent className="p-3.5 sm:p-4 space-y-2">
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><p className="text-xs font-semibold text-foreground">AI 备选方案（点击替换）</p></div>
                <div className="space-y-1.5">
                  {goalAlternatives.map((alt, i) => (
                    <button type="button" key={i} className="w-full text-left rounded-lg border border-border bg-background/70 px-3 py-2.5 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground" onClick={() => { setForm(prev => ({ ...prev, mainStoryGoal: alt })); setGoalAlternatives([]); }}>{alt}</button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label>剧名灵感（可选）</Label>
            <Input placeholder="如「闪婚后，陆总每天求复合」" value={form.titleHint} onChange={(e) => setForm({ ...form, titleHint: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>调性偏好（可选）</Label>
            <Input placeholder="如：爽快反转、虐中带甜" value={form.tonePreference ?? ''} onChange={(e) => setForm({ ...form, tonePreference: e.target.value })} />
          </div>
        </div>
      )}

      {/* Step 4: Scale Config */}
      {step === 3 && (
        <div className="animate-fade-in space-y-5">
          <h2 className="text-xl sm:text-2xl font-bold">规模配置</h2>
          <div className="space-y-3">
            <Label>每集目标时长</Label>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_PRESETS.map(d => (
                <button key={d.value} type="button" className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all',
                  form.targetEpisodeDurationSec === d.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, targetEpisodeDurationSec: d.value })}>
                  <span className="text-lg font-bold">{d.label}</span>
                  <span className="text-[11px] text-muted-foreground">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label>总集数规模</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCALE_PRESETS.map(s => (
                <button key={s.label} type="button" className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all',
                  form.plannedMinEpisodes === s.min && form.plannedMaxEpisodes === s.max ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, plannedMinEpisodes: s.min, plannedMaxEpisodes: s.max })}>
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="text-[11px] text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <Card className="border-primary/15 bg-gradient-to-br from-primary/3 to-transparent">
            <CardContent className="p-4 space-y-2.5 text-sm">
              <div className="flex items-center gap-2 mb-3"><Film className="h-4 w-4 text-primary" /><span className="font-semibold">创建摘要</span></div>
              {[
                { label: '创意', value: form.mainIdea.slice(0, 60) + (form.mainIdea.length > 60 ? '...' : ''), clamp: true },
                { label: '题材', value: form.genre || '—' },
                { label: '平台', value: PLATFORM_PRESETS.find(p => p.value === form.platformTarget)?.label || '通用' },
                { label: '观众', value: effectiveAudience || '—' },
                { label: '冲突', value: form.mainStoryGoal || '—', clamp: true },
                { label: '时长', value: `${(form.targetEpisodeDurationSec ?? 180) / 60} 分钟/集` },
                { label: '集数', value: `${form.plannedMinEpisodes}-${form.plannedMaxEpisodes} 集` },
              ].map(({ label, value, clamp }) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="shrink-0 w-12 text-primary/80 font-semibold text-xs">{label}</span>
                  <span className={cn('text-muted-foreground', clamp && 'line-clamp-2')}>{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generating */}
      {isGenerating && (
        <div className="animate-fade-in flex flex-col items-center py-10 space-y-6">
          <Film className="h-16 w-16 text-violet-500 animate-pulse" />
          <div className="text-center">
            <h2 className="text-xl sm:text-2xl font-bold">AI 正在构建你的短剧</h2>
            <p className="mt-2 text-sm text-muted-foreground">正在为「{form.genre}」题材构建世界观和编剧手册，这通常需要 1-3 分钟...</p>
          </div>

          <div className="w-full max-w-md space-y-4 px-4">
            {genError ? (
              <div className="flex flex-col items-center space-y-4 pt-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40"><AlertTriangle className="h-6 w-6 text-red-500" /></div>
                <p className="text-center text-sm text-red-600 dark:text-red-400">{genError}</p>
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" onClick={() => { setGenError(null); setStep(3); }}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />返回修改</Button>
                  <Button size="sm" onClick={handleSubmit}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />重试</Button>
                </div>
              </div>
            ) : (
              <>
                <Progress value={genProgress} className="h-2" />
                <p className="text-center text-sm text-muted-foreground">{Math.round(genProgress)}%</p>
                <div className="space-y-3 pt-4">
                  {genSteps.map((gs, i) => {
                    const isActive = !gs.done && (i === 0 || genSteps[i - 1]?.done);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        {gs.done ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50"><Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /></div>
                        ) : isActive ? (
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : (
                          <div className="h-6 w-6 rounded-full border-2 border-muted" />
                        )}
                        <span className={cn('text-sm', gs.done ? 'text-foreground font-medium' : isActive ? 'text-foreground' : 'text-muted-foreground')}>{gs.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Navigation — Desktop */}
      {!isGenerating && (
        <>
          <div className="mt-8 hidden sm:flex justify-between items-center">
            <div>{step > 0 && <Button variant="ghost" size="lg" className="gap-2 text-muted-foreground hover:text-foreground" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" />上一步</Button>}</div>
            {step === formStepCount - 1 ? (
              <Button size="lg" className="gap-2" disabled={!canNext() || loading} onClick={handleSubmit}><Sparkles className="h-4 w-4" />开始创建</Button>
            ) : (
              <Button size="lg" className="gap-2" disabled={!canNext()} onClick={() => setStep(step + 1)}>下一步<ArrowRight className="h-4 w-4" /></Button>
            )}
          </div>

          {/* Navigation — Mobile: fixed bottom */}
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur-lg px-4 py-3 sm:hidden">
            <div className="flex gap-2">
              {step > 0 && <Button variant="outline" size="lg" className="gap-1" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /></Button>}
              {step === formStepCount - 1 ? (
                <Button size="lg" className="flex-1 gap-2" disabled={!canNext() || loading} onClick={handleSubmit}><Sparkles className="h-4 w-4" />开始创建</Button>
              ) : (
                <Button size="lg" className="flex-1 gap-2" disabled={!canNext()} onClick={() => setStep(step + 1)}>下一步<ArrowRight className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CreateDrama;
