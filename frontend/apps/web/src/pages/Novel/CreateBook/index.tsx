import React, { useState, useCallback } from 'react';
import { history } from '@umijs/max';
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  BookOpen,
  Users,
  Target,
  Loader2,
  Check,
  Settings2,
  FileEdit,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  enhanceIdea,
  generateStoryGoal,
  updateBookProfile,
  createBookSseUrl,
  type CreateBookParams,
  type BookPromptProfile,
} from '@/services/novel';
import ProfileEditor from '../ProfileEditor';

const GENRE_PRESETS = [
  { value: '玄幻', icon: '🌌', desc: '异界修炼、升级打怪' },
  { value: '科幻', icon: '🚀', desc: '未来科技、星际冒险' },
  { value: '都市', icon: '🏙️', desc: '现代都市、商战情感' },
  { value: '悬疑', icon: '🔍', desc: '推理解谜、烧脑剧情' },
  { value: '武侠', icon: '⚔️', desc: '江湖恩怨、武林纷争' },
  { value: '历史', icon: '📜', desc: '穿越架空、宫廷权谋' },
  { value: '仙侠', icon: '🏔️', desc: '修仙问道、飞升渡劫' },
  { value: '末世', icon: '💀', desc: '废土求生、丧尸危机' },
  { value: '言情', icon: '💕', desc: '爱情故事、甜蜜虐恋' },
  { value: '奇幻', icon: '🐉', desc: '魔法世界、史诗冒险' },
  { value: '游戏', icon: '🎮', desc: '虚拟现实、游戏世界' },
  { value: '军事', icon: '🎖️', desc: '战争风云、铁血军旅' },
];

const AUDIENCE_PRESETS = [
  '18-25 岁男性网文读者',
  '18-25 岁女性网文读者',
  '25-35 岁男性读者',
  '25-35 岁女性读者',
  '全年龄向',
];

const WORD_COUNT_PRESETS = [
  { value: 2000, label: '2000 字/章', desc: '轻快节奏' },
  { value: 3000, label: '3000 字/章', desc: '标准长度' },
  { value: 4000, label: '4000 字/章', desc: '充实内容' },
  { value: 5000, label: '5000 字/章', desc: '长篇细腻' },
];

const SCALE_PRESETS = [
  { min: 100, max: 300, label: '中篇 (100-300 章)', desc: '约 30-90 万字' },
  { min: 300, max: 500, label: '长篇 (300-500 章)', desc: '约 90-150 万字' },
  { min: 500, max: 800, label: '超长篇 (500-800 章)', desc: '约 150-240 万字' },
];

const FORM_STEPS = [
  { title: '核心创意', icon: Sparkles, desc: '描述你的故事灵感' },
  { title: '类型与受众', icon: Users, desc: '选择类型和目标读者' },
  { title: '主线目标', icon: Target, desc: '定义目标和书名' },
  { title: '规模配置', icon: Settings2, desc: '字数和章节设置' },
];

interface FormState extends CreateBookParams {
  customGenre: string;
  customAudience: string;
  useCustomGenre: boolean;
  useCustomAudience: boolean;
}

const CreateBook: React.FC = () => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genSteps, setGenSteps] = useState<{ label: string; done: boolean }[]>([]);

  const [enhancing, setEnhancing] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [originalIdea, setOriginalIdea] = useState('');

  const [generatingGoal, setGeneratingGoal] = useState(false);
  const [goalAlternatives, setGoalAlternatives] = useState<string[]>([]);

  const [createdBookId, setCreatedBookId] = useState<string | null>(null);
  const [generatedProfile, setGeneratedProfile] = useState<BookPromptProfile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [form, setForm] = useState<FormState>({
    mainIdea: '',
    genre: '',
    targetAudience: '',
    mainStoryGoal: '',
    titleHint: '',
    targetChapterWordCount: 3000,
    plannedMinChapters: 500,
    plannedMaxChapters: 800,
    customGenre: '',
    customAudience: '',
    useCustomGenre: false,
    useCustomAudience: false,
  });

  const effectiveGenre = form.useCustomGenre ? form.customGenre : form.genre;
  const effectiveAudience = form.useCustomAudience ? form.customAudience : form.targetAudience;
  const formStepCount = FORM_STEPS.length;

  const canNext = useCallback(() => {
    if (step === 0) return (form.mainIdea ?? '').trim().length >= 10;
    if (step === 1) return (effectiveGenre ?? '').trim().length > 0 && (effectiveAudience ?? '').trim().length > 0;
    if (step === 2) return (form.mainStoryGoal ?? '').trim().length >= 5;
    if (step === 3) return true;
    return false;
  }, [step, form, effectiveGenre, effectiveAudience]);

  const handleEnhance = async () => {
    if ((form.mainIdea ?? '').trim().length < 5) return;
    setEnhancing(true);
    setOriginalIdea(form.mainIdea);
    try {
      const result = await enhanceIdea(form.mainIdea, form.genre || undefined);
      if (result?.enhanced) {
        setForm((prev) => ({ ...prev, mainIdea: result.enhanced }));
        setHighlights(result.highlights ?? []);
      }
    } catch {
      // keep original
    } finally {
      setEnhancing(false);
    }
  };

  const handleRevertIdea = () => {
    if (originalIdea) {
      setForm((prev) => ({ ...prev, mainIdea: originalIdea }));
      setHighlights([]);
      setOriginalIdea('');
    }
  };

  const handleGenerateGoal = async () => {
    if (!effectiveGenre || !effectiveAudience || !form.mainIdea) return;
    setGeneratingGoal(true);
    try {
      const result = await generateStoryGoal(form.mainIdea, effectiveGenre, effectiveAudience);
      if (result?.goal) {
        setForm((prev) => ({ ...prev, mainStoryGoal: result.goal }));
        setGoalAlternatives(result.alternatives ?? []);
      }
    } catch {
      // keep empty
    } finally {
      setGeneratingGoal(false);
    }
  };

  const handleSubmit = async () => {
    setStep(4);
    setLoading(true);
    setGenProgress(0);
    setGenSteps([
      { label: '种子创意分析', done: false },
      { label: '生成专属写作手册', done: false },
      { label: '初始化角色与世界', done: false },
      { label: '完成开书', done: false },
    ]);

    const params: CreateBookParams = {
      mainIdea: form.mainIdea,
      genre: effectiveGenre,
      targetAudience: effectiveAudience,
      mainStoryGoal: form.mainStoryGoal,
      titleHint: form.titleHint || undefined,
      targetChapterWordCount: form.targetChapterWordCount,
      plannedMinChapters: form.plannedMinChapters,
      plannedMaxChapters: form.plannedMaxChapters,
    };

    const STEP_PROGRESS: Record<string, number> = {
      seed: 20,
      profile: 60,
      init: 85,
      done: 100,
    };

    try {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) searchParams.set(k, String(v));
      });
      const response = await fetch(`${createBookSseUrl()}?${searchParams.toString()}`, {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) throw new Error('创建失败');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());

            if (payload._type === 'result') {
              setGenProgress(100);
              setGenSteps((prev) => prev.map((s) => ({ ...s, done: true })));
              setCreatedBookId(payload.result.bookId);
              setGeneratedProfile(payload.result.bookPromptProfile);
              setTimeout(() => { setStep(5); setLoading(false); }, 600);
              return;
            }

            if (payload.error) {
              throw new Error(payload.error);
            }

            const progress = STEP_PROGRESS[payload.step] ?? 0;
            setGenProgress(progress);

            const stepIndexMap: Record<string, number> = {
              seed: 0, profile: 1, init: 2, done: 3,
            };
            const idx = stepIndexMap[payload.step] ?? -1;
            if (idx >= 0 && payload.message) {
              setGenSteps((prev) =>
                prev.map((s, i) => {
                  if (i < idx) return { ...s, done: true };
                  if (i === idx) return { label: payload.message, done: payload.done ?? false };
                  return s;
                }),
              );
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      setLoading(false);
      setStep(3);
    }
  };

  const isGenerating = step === 4;
  const isReviewing = step === 5;

  const handleSaveProfile = async () => {
    if (!createdBookId || !generatedProfile) return;
    setSavingProfile(true);
    try {
      await updateBookProfile(createdBookId, generatedProfile);
      history.push(`/novel/book/${createdBookId}`);
    } catch {
      setSavingProfile(false);
    }
  };

  const handleSkipReview = () => {
    if (createdBookId) {
      history.push(`/novel/book/${createdBookId}`);
    }
  };

  const handleStepClick = (targetStep: number) => {
    if (isGenerating || isReviewing) return;
    if (targetStep < step) setStep(targetStep);
  };

  const goBack = () => {
    if (isReviewing || isGenerating) return;
    if (step > 0) setStep(step - 1);
    else history.push('/novel');
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">
      {/* Header: back + step indicator inline */}
      <div className="mb-6 sm:mb-8">
        {/* Back */}
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 gap-1.5 -ml-2"
          onClick={goBack}
          disabled={isGenerating || isReviewing}
        >
          <ArrowLeft className="h-4 w-4" />
          {step > 0 && !isGenerating && !isReviewing ? '上一步' : '返回书架'}
        </Button>

        {/* Step indicator — Desktop: only 4 form steps */}
        {step < formStepCount && (
          <div className="hidden sm:block">
            <div className="flex items-center">
              {FORM_STEPS.map((s, i) => {
                const StepIcon = s.icon;
                return (
                  <React.Fragment key={s.title}>
                    <button
                      className={cn(
                        'flex items-center gap-2.5 transition-all shrink-0',
                        i < step && 'cursor-pointer group',
                        i > step && 'cursor-default',
                      )}
                      onClick={() => handleStepClick(i)}
                      disabled={i > step}
                    >
                      <div
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-all duration-300',
                          i < step
                            ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20 group-hover:shadow-md group-hover:shadow-primary/30'
                            : i === step
                              ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/20 shadow-md shadow-primary/20'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {i < step ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                      </div>
                      <div className="hidden md:block text-left">
                        <p className={cn(
                          'text-sm font-semibold leading-tight',
                          i === step ? 'text-foreground' : i < step ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground',
                        )}>
                          {s.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{s.desc}</p>
                      </div>
                    </button>
                    {i < FORM_STEPS.length - 1 && (
                      <div className="flex-1 mx-3 md:mx-4">
                        <div
                          className={cn(
                            'h-0.5 rounded-full transition-colors duration-300',
                            i < step ? 'bg-primary/60' : 'bg-border',
                          )}
                        />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Step indicator — Mobile: progress bar + current step */}
        {step < formStepCount && (
          <div className="sm:hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm shadow-primary/25 shrink-0">
                {step + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{FORM_STEPS[step]?.title}</p>
                <p className="text-xs text-muted-foreground">{FORM_STEPS[step]?.desc}</p>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {step + 1}/{formStepCount}
              </span>
            </div>
            <div className="mt-3 flex gap-1">
              {Array.from({ length: formStepCount }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1 flex-1 rounded-full transition-all duration-300',
                    i <= step ? 'bg-primary' : 'bg-muted',
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step 1: Core Idea */}
      {step === 0 && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">你的故事核心创意是什么？</h2>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
              描述你脑中的故事灵感，越具体越好。AI 会基于此构建完整的世界观和定制化写作手册。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainIdea">核心创意</Label>
            <Textarea
              id="mainIdea"
              placeholder="例如：一个少年在末世废墟中发现了通往平行世界的钥匙，每个平行世界都有不同的物理法则和文明形态..."
              className="min-h-[140px] sm:min-h-[160px] text-sm sm:text-base resize-none"
              value={form.mainIdea}
              onChange={(e) => {
                setForm({ ...form, mainIdea: e.target.value });
                if (highlights.length > 0) {
                  setHighlights([]);
                  setOriginalIdea('');
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {(form.mainIdea ?? '').length} 字 · 建议至少 20 字以上
              </p>
              <div className="flex items-center gap-1.5 shrink-0">
                {originalIdea && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    onClick={handleRevertIdea}
                  >
                    <ArrowLeft className="h-3 w-3" />
                    还原
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                  disabled={(form.mainIdea ?? '').trim().length < 5 || enhancing}
                  onClick={handleEnhance}
                >
                  {enhancing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {enhancing ? 'AI 优化中...' : 'AI 美化创意'}
                </Button>
              </div>
            </div>
          </div>

          {highlights.length > 0 && (
            <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30">
              <CardContent className="p-3.5 sm:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">AI 已优化你的创意，增强了以下亮点：</p>
                </div>
                <ul className="space-y-1 ml-6">
                  {highlights.map((h, i) => (
                    <li key={i} className="text-sm text-emerald-700 dark:text-emerald-400 list-disc">{h}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {highlights.length === 0 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="flex items-start gap-3 p-3.5 sm:p-4">
                <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">灵感提示</p>
                  <p>写下你的粗略想法，然后点击「AI 美化创意」让 AI 帮你丰富细节、增加冲突和画面感。你可以反复美化直到满意。</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 2: Genre & Audience */}
      {step === 1 && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">选择小说类型和目标读者</h2>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
              AI 会根据题材和读者群体生成专属的写作手册（节奏、对白、爽感类型等全部自适应）。
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>小说类型</Label>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setForm({ ...form, useCustomGenre: !form.useCustomGenre, genre: '' })}
              >
                {form.useCustomGenre ? '选择预设类型' : '自定义类型'}
              </button>
            </div>

            {form.useCustomGenre ? (
              <Input
                placeholder="输入你的小说类型，例如：赛博朋克、克苏鲁、甜宠、系统流..."
                value={form.customGenre}
                onChange={(e) => setForm({ ...form, customGenre: e.target.value })}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {GENRE_PRESETS.map((g) => (
                  <button
                    key={g.value}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-2.5 sm:p-3 text-center transition-all hover:border-primary/50 active:scale-[0.97]',
                      form.genre === g.value
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border',
                    )}
                    onClick={() => setForm({ ...form, genre: g.value })}
                  >
                    <span className="text-lg sm:text-xl">{g.icon}</span>
                    <span className="text-xs sm:text-sm font-medium">{g.value}</span>
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight">{g.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>目标读者</Label>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setForm({ ...form, useCustomAudience: !form.useCustomAudience, targetAudience: '' })}
              >
                {form.useCustomAudience ? '选择预设读者' : '自定义读者'}
              </button>
            </div>

            {form.useCustomAudience ? (
              <Input
                placeholder="描述你的目标读者群体，例如：30-40 岁职场女性、二次元爱好者..."
                value={form.customAudience}
                onChange={(e) => setForm({ ...form, customAudience: e.target.value })}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {AUDIENCE_PRESETS.map((a) => (
                  <Badge
                    key={a}
                    variant={form.targetAudience === a ? 'default' : 'outline'}
                    className={cn(
                      'cursor-pointer px-3 py-1.5 text-xs sm:text-sm transition-all active:scale-[0.97]',
                      form.targetAudience === a && 'ring-2 ring-primary/20',
                    )}
                    onClick={() => setForm({ ...form, targetAudience: a })}
                  >
                    {a}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Card className="border-muted bg-muted/30">
            <CardContent className="flex items-start gap-3 p-3.5 sm:p-4">
              <BookOpen className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">为什么这很重要？</p>
                <p>AI 会根据你的选择生成一份完整的<strong>写作手册</strong>——包含这个题材专属的写作规则、正反例对比、章末钩子类型、套话黑名单、评审标准等。不同题材的手册完全不同。</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Story Goal + Title */}
      {step === 2 && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">定义故事的终极主线目标</h2>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
              主线目标是贯穿全书的核心驱动力，AI 会围绕它规划卷级结构。可以自己写，也可以让 AI 根据前面的信息帮你生成。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainStoryGoal">主线目标</Label>
            <Textarea
              id="mainStoryGoal"
              placeholder="例如：主角突破封印，统一三界，最终揭开世界真相的秘密..."
              className="min-h-[100px] sm:min-h-[120px] text-sm sm:text-base resize-none"
              value={form.mainStoryGoal}
              onChange={(e) => {
                setForm({ ...form, mainStoryGoal: e.target.value });
                if (goalAlternatives.length > 0) setGoalAlternatives([]);
              }}
            />
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
                disabled={generatingGoal}
                onClick={handleGenerateGoal}
              >
                {generatingGoal ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {generatingGoal ? 'AI 生成中...' : 'AI 生成目标'}
              </Button>
            </div>
          </div>

          {goalAlternatives.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">备选方案（点击可替换）：</p>
              <div className="space-y-1.5">
                {goalAlternatives.map((alt, i) => (
                  <button
                    key={i}
                    className="w-full text-left rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground active:scale-[0.99]"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, mainStoryGoal: alt }));
                      setGoalAlternatives([]);
                    }}
                  >
                    {alt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <Label htmlFor="titleHint">书名灵感（可选）</Label>
            <Input
              id="titleHint"
              placeholder="给 AI 一个书名方向，留空则由 AI 自动生成"
              value={form.titleHint}
              onChange={(e) => setForm({ ...form, titleHint: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* Step 4: Scale Configuration */}
      {step === 3 && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">创作规模配置</h2>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
              设置每章字数和总章数规模。这些参数会影响 AI 的节奏规划和大纲深度。
            </p>
          </div>

          <div className="space-y-3">
            <Label>每章目标字数</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WORD_COUNT_PRESETS.map((w) => (
                <button
                  key={w.value}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 sm:p-3 text-center transition-all hover:border-primary/50 active:scale-[0.97]',
                    form.targetChapterWordCount === w.value
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border',
                  )}
                  onClick={() => setForm({ ...form, targetChapterWordCount: w.value })}
                >
                  <span className="text-base sm:text-lg font-bold">{w.value.toLocaleString()}</span>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">{w.desc}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground shrink-0">自定义：</span>
              <Input
                type="number"
                min={1000}
                max={8000}
                className="w-24 h-8 text-sm"
                value={form.targetChapterWordCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setForm({ ...form, targetChapterWordCount: Math.min(8000, Math.max(1000, v)) });
                }}
              />
              <span className="text-xs text-muted-foreground">字/章</span>
            </div>
          </div>

          <div className="space-y-3">
            <Label>总章数规模</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {SCALE_PRESETS.map((s) => {
                const selected = form.plannedMinChapters === s.min && form.plannedMaxChapters === s.max;
                const estWords = `${((s.min * (form.targetChapterWordCount ?? 3000)) / 10000).toFixed(0)}-${((s.max * (form.targetChapterWordCount ?? 3000)) / 10000).toFixed(0)} 万字`;
                return (
                  <button
                    key={s.label}
                    className={cn(
                      'flex flex-col items-start gap-1 rounded-lg border p-3 sm:p-4 text-left transition-all hover:border-primary/50 active:scale-[0.98]',
                      selected
                        ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                        : 'border-border',
                    )}
                    onClick={() => setForm({ ...form, plannedMinChapters: s.min, plannedMaxChapters: s.max })}
                  >
                    <span className="text-sm font-semibold">{s.label}</span>
                    <span className="text-xs text-muted-foreground">约 {estWords}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">自定义范围：</span>
              <Input
                type="number"
                min={50}
                max={2000}
                className="w-20 h-8 text-sm"
                value={form.plannedMinChapters}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setForm({ ...form, plannedMinChapters: Math.min(2000, Math.max(50, v)) });
                }}
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="number"
                min={100}
                max={3000}
                className="w-20 h-8 text-sm"
                value={form.plannedMaxChapters}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setForm({ ...form, plannedMaxChapters: Math.min(3000, Math.max(100, v)) });
                }}
              />
              <span className="text-xs text-muted-foreground">章</span>
            </div>
          </div>

          <Card className="border-muted">
            <CardContent className="p-3.5 sm:p-4">
              <p className="text-sm font-medium mb-3">创作摘要</p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex gap-2">
                  <span className="shrink-0 w-14 sm:w-16 text-foreground font-medium">创意</span>
                  <span className="line-clamp-2">{form.mainIdea || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 w-14 sm:w-16 text-foreground font-medium">类型</span>
                  <span>{effectiveGenre || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 w-14 sm:w-16 text-foreground font-medium">受众</span>
                  <span>{effectiveAudience || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 w-14 sm:w-16 text-foreground font-medium">目标</span>
                  <span className="line-clamp-2">{form.mainStoryGoal || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 w-14 sm:w-16 text-foreground font-medium">规模</span>
                  <span>
                    {form.targetChapterWordCount?.toLocaleString()} 字/章 ×{' '}
                    {form.plannedMinChapters}-{form.plannedMaxChapters} 章
                    {' ≈ '}
                    {(((form.plannedMinChapters ?? 500) + (form.plannedMaxChapters ?? 800)) / 2 * (form.targetChapterWordCount ?? 3000) / 10000).toFixed(0)} 万字
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generating */}
      {isGenerating && (
        <div className="animate-fade-in flex flex-col items-center py-8 sm:py-12 space-y-6 sm:space-y-8">
          <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-8 w-8 sm:h-10 sm:w-10 text-primary animate-pulse" />
          </div>

          <div className="text-center px-2">
            <h2 className="text-xl sm:text-2xl font-bold">AI 正在构建你的小说世界</h2>
            <p className="mt-2 text-sm sm:text-base text-muted-foreground">
              正在为「{effectiveGenre}」题材生成专属写作手册和世界观，这通常需要 1-3 分钟...
            </p>
          </div>

          <div className="w-full max-w-md space-y-4 px-4">
            <Progress value={genProgress} className="h-2" />
            <p className="text-center text-sm text-muted-foreground">
              {Math.round(genProgress)}%
            </p>

            <div className="space-y-3 pt-4">
              {(() => {
                const activeIdx = genSteps.findIndex((s) => !s.done);
                return genSteps.map((gs, i) => {
                  const isActive = i === activeIdx;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      {gs.done ? (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                      ) : isActive ? (
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      ) : (
                        <div className="h-6 w-6 rounded-full border-2 border-muted" />
                      )}
                      <span
                        className={cn(
                          'text-sm',
                          gs.done ? 'text-foreground font-medium' : isActive ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {gs.label}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Review Profile */}
      {isReviewing && generatedProfile && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">审阅 AI 生成的写作手册</h2>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
              这是 AI 为「{effectiveGenre}」题材生成的专属写作手册。你可以根据自己的理解调整任何内容，
              所有修改将直接影响后续章节的写作风格和质量评审标准。
            </p>
          </div>

          <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30">
            <CardContent className="flex items-start gap-3 p-3.5 sm:p-4">
              <FileEdit className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-medium mb-1">手册说明</p>
                <p>
                  手册包含写手身份、题材规则、正反写法示例、爽感和钩子类型定义、套话黑名单、评审权重等。
                  点击各板块标题展开编辑。你也可以跳过此步直接开始创作，后续随时可在工作台中修改。
                </p>
              </div>
            </CardContent>
          </Card>

          <ScrollArea className="max-h-[calc(100vh-420px)]">
            <ProfileEditor
              profile={generatedProfile}
              onChange={setGeneratedProfile}
            />
          </ScrollArea>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              className="w-full sm:w-auto"
              onClick={handleSkipReview}
            >
              跳过，直接开始创作
            </Button>
            <Button
              size="lg"
              className="gap-2 w-full sm:w-auto"
              disabled={savingProfile}
              onClick={handleSaveProfile}
            >
              {savingProfile ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {savingProfile ? '保存中...' : '确认并开始创作'}
            </Button>
          </div>
        </div>
      )}

      {/* Navigation */}
      {!isGenerating && !isReviewing && (
        <>
          {/* Desktop */}
          <div className="mt-8 hidden sm:flex justify-between items-center">
            <div>
              {step > 0 && (
                <Button
                  variant="ghost"
                  size="lg"
                  className="gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft className="h-4 w-4" />
                  上一步
                </Button>
              )}
            </div>
            {step === formStepCount - 1 ? (
              <Button
                size="lg"
                className="gap-2"
                disabled={!canNext() || loading}
                onClick={handleSubmit}
              >
                <Sparkles className="h-4 w-4" />
                开始创建
              </Button>
            ) : (
              <Button
                size="lg"
                className="gap-2"
                disabled={!canNext()}
                onClick={() => setStep(step + 1)}
              >
                下一步
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Mobile: fixed bottom */}
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur-lg px-4 py-3 sm:hidden">
            <div className="flex gap-2">
              {step > 0 && (
                <Button
                  variant="outline"
                  size="lg"
                  className="gap-1"
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              {step === formStepCount - 1 ? (
                <Button
                  size="lg"
                  className="flex-1 gap-2"
                  disabled={!canNext() || loading}
                  onClick={handleSubmit}
                >
                  <Sparkles className="h-4 w-4" />
                  开始创建
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="flex-1 gap-2"
                  disabled={!canNext()}
                  onClick={() => setStep(step + 1)}
                >
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CreateBook;
