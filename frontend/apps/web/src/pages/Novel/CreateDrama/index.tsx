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
  createDrama, getDrama, getCreateDramaSseUrl, listDramaGenreTemplates,
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
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

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

  const canNext = useCallback(() => {
    if (step === 0) return (form.mainIdea ?? '').trim().length >= 10;
    if (step === 1) return (form.genre ?? '').trim().length > 0 && (effectiveAudience ?? '').trim().length > 0;
    if (step === 2) return true;
    if (step === 3) return true;
    return false;
  }, [step, form, effectiveAudience]);

  const handleSubmit = async () => {
    setStep(4);
    setLoading(true);
    setGenProgress(0);
    setGenError(null);
    setGenSteps(GEN_STEPS.map(s => ({ ...s, done: false })));

    const params: CreateDramaParams = {
      mainIdea: form.mainIdea, genre: form.genre, targetAudience: effectiveAudience,
      protagonistFocus: form.protagonistFocus, tonePreference: form.tonePreference || undefined,
      audienceTags: form.audienceTags?.length ? form.audienceTags : undefined,
      titleHint: form.titleHint || undefined, mainStoryGoal: form.mainStoryGoal || undefined,
      platformTarget: form.platformTarget, aspectRatio: form.aspectRatio,
      targetEpisodeDurationSec: form.targetEpisodeDurationSec,
      plannedMinEpisodes: form.plannedMinEpisodes, plannedMaxEpisodes: form.plannedMaxEpisodes,
    };

    try {
      const res = await createDrama(params);
      const dramaId = res.dramaId;

      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch(getCreateDramaSseUrl(dramaId), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
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
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload._type === 'heartbeat') continue;
            if (payload.error) { setGenError(payload.message ?? '创建失败'); setLoading(false); return; }

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
              setGenProgress(100);
              message.success('短剧创建成功');
              setTimeout(() => history.push(`/novel/drama/${dramaId}`), 600);
              return;
            }
          } catch { /* skip malformed */ }
        }
      }

      setGenProgress(100);
      setGenSteps(prev => prev.map(s => ({ ...s, done: true })));
      message.success('短剧创建成功');
      setTimeout(() => history.push(`/novel/drama/${dramaId}`), 600);
    } catch (error: any) {
      const errMsg = error?.message || '创建失败';
      message.error(errMsg);
      setGenError(errMsg);
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5 -ml-2" onClick={() => isGenerating ? undefined : step > 0 ? setStep(step - 1) : history.push('/novel')} disabled={loading}>
        <ArrowLeft className="h-4 w-4" />{step > 0 && !isGenerating ? '上一步' : '返回书架'}
      </Button>

      {!isGenerating && (
        <div className="flex items-center gap-2 mb-6">
          <Film className="h-5 w-5 text-violet-500" />
          <span className="text-sm font-medium text-violet-500">创建短剧</span>
          <span className="text-xs text-muted-foreground ml-2">{step + 1}/{STEPS.length}</span>
        </div>
      )}

      {/* Step 1: Core Idea */}
      {step === 0 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">你的短剧灵感是什么？</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">越具体越好：人物背景、核心冲突、身份反差。</p>
          </div>
          <div className="space-y-2">
            <Label>核心创意</Label>
            <Textarea placeholder="例如：女主被豪门婆婆羞辱扫地出门，三年后带着亿万身家和双胞胎华丽回归..." className="min-h-[140px] text-sm resize-none" value={form.mainIdea} onChange={(e) => setForm({ ...form, mainIdea: e.target.value })} />
            <p className="text-xs text-muted-foreground">{(form.mainIdea ?? '').length} 字 · 建议至少 20 字</p>
          </div>
        </div>
      )}

      {/* Step 2: Genre & Audience — 使用题材模板 */}
      {step === 1 && (
        <div className="animate-fade-in space-y-5">
          <h2 className="text-xl sm:text-2xl font-bold">选择题材与目标观众</h2>

          <div className="space-y-3">
            <Label>短剧题材</Label>
            {templatesLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" />加载题材模板...</div>
            ) : templates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {templates.map(t => (
                  <button key={t.id} type="button" className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all hover:border-primary/50',
                    form.genre === t.displayName ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                  )} onClick={() => setForm({ ...form, genre: t.displayName })}>
                    <span className="text-lg">{GENRE_ICONS[t.genreKey] ?? '📝'}</span>
                    <span className="text-xs font-medium">{t.displayName}</span>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</span>
                    {!t.isSystem && <span className="text-[9px] text-primary/60">自定义</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4">暂无题材模板</p>
            )}
          </div>

          <div className="space-y-3">
            <Label>目标平台</Label>
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
            <Label>目标观众</Label>
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
            <Label>叙事聚焦</Label>
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
          <h2 className="text-xl sm:text-2xl font-bold">主线目标与剧名</h2>
          <div className="space-y-2">
            <Label>核心冲突（可选）</Label>
            <Textarea placeholder="例如：女主揭露豪门家族的真相..." className="min-h-[100px] text-sm resize-none" value={form.mainStoryGoal} onChange={(e) => setForm({ ...form, mainStoryGoal: e.target.value })} />
          </div>
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
                { label: '创意', value: form.mainIdea.slice(0, 60) + (form.mainIdea.length > 60 ? '...' : '') },
                { label: '题材', value: form.genre || '—' },
                { label: '平台', value: PLATFORM_PRESETS.find(p => p.value === form.platformTarget)?.label || '通用' },
                { label: '观众', value: effectiveAudience || '—' },
                { label: '时长', value: `${(form.targetEpisodeDurationSec ?? 180) / 60} 分钟/集` },
                { label: '集数', value: `${form.plannedMinEpisodes}-${form.plannedMaxEpisodes} 集` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="shrink-0 w-12 text-primary/80 font-semibold text-xs">{label}</span>
                  <span className="text-muted-foreground">{value}</span>
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
            <p className="mt-2 text-sm text-muted-foreground">正在为「{form.genre}」题材构建世界观和编剧手册...</p>
          </div>

          <div className="w-full max-w-md space-y-4 px-4">
            {genError ? (
              <div className="flex flex-col items-center space-y-4 pt-2">
                <AlertTriangle className="h-12 w-12 text-red-500" />
                <p className="text-center text-sm text-red-600">{genError}</p>
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
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50"><Check className="h-3.5 w-3.5 text-emerald-600" /></div>
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

      {/* Navigation */}
      {!isGenerating && (
        <div className="mt-8 flex justify-between items-center">
          <div>{step > 0 && <Button variant="ghost" size="lg" className="gap-2" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" />上一步</Button>}</div>
          {step === STEPS.length - 1 ? (
            <Button size="lg" className="gap-2" disabled={!canNext() || loading} onClick={handleSubmit}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? '创建中...' : '开始创建'}
            </Button>
          ) : (
            <Button size="lg" className="gap-2" disabled={!canNext()} onClick={() => setStep(step + 1)}>
              下一步<ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default CreateDrama;
