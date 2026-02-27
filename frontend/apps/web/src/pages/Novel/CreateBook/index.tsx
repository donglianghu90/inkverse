import React, { useState, useCallback, useRef, useEffect } from 'react';
import { history } from '@umijs/max';
import { message } from 'antd';
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
  Clock,
  ChevronDown,
} from 'lucide-react';
import worldCreatingImg from '@/assets/illustrations/world-creating.png';
import creativeInspirationImg from '@/assets/illustrations/creative-inspiration.png';
import profileCompleteImg from '@/assets/illustrations/profile-complete.png';
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
  createBookSession,
  createBookSseUrl,
  type CreateBookParams,
  type BookPromptProfile,
} from '@/services/novel';
import { getToken } from '@/services/auth';
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

const SERIALIZATION_PRESETS = [
  { label: '日更 3 章', runEveryDays: 1, chaptersPerRun: 3, desc: '起点推荐期 / 番茄进阶全勤', emoji: '🔥' },
  { label: '日更 2 章', runEveryDays: 1, chaptersPerRun: 2, desc: '起点/番茄基础全勤线', emoji: '📝' },
  { label: '日更 1 章', runEveryDays: 1, chaptersPerRun: 1, desc: '精品打磨，稳定输出', emoji: '✨' },
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
  const [showSerialAdvanced, setShowSerialAdvanced] = useState(false);

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
    autoSerializationEnabled: true,
    autoSerializationDailyStartTime: '08:00',
    autoSerializationRunEveryDays: 1,
    autoSerializationChaptersPerRun: 3,
    autoSerializationMaxRepairRounds: 2,
    autoSerializationMinQualityScore: 7,
    autoSerializationMinOverallScore: 7,
    customGenre: '',
    customAudience: '',
    useCustomGenre: false,
    useCustomAudience: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<{ key: string; fingerprint: string } | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

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
      autoSerializationEnabled: form.autoSerializationEnabled,
      autoSerializationDailyStartTime: form.autoSerializationDailyStartTime,
      autoSerializationRunEveryDays: form.autoSerializationRunEveryDays,
      autoSerializationChaptersPerRun: form.autoSerializationChaptersPerRun,
      autoSerializationMaxRepairRounds: form.autoSerializationMaxRepairRounds,
      autoSerializationMinQualityScore: form.autoSerializationMinQualityScore,
      autoSerializationMinOverallScore: form.autoSerializationMinOverallScore,
    };

    const STEP_PROGRESS: Record<string, number> = {
      seed: 20,
      profile: 60,
      init: 85,
      done: 100,
    };

    const controller = new AbortController();
    abortRef.current = controller;
    const STALE_MS = 600_000; // LLM调用可能超过5分钟，增大至10分钟
    let staleTimer!: ReturnType<typeof setTimeout>;
    const touchStale = () => { clearTimeout(staleTimer); staleTimer = setTimeout(() => controller.abort(), STALE_MS); };
    let streamError: string | null = null;
    const fingerprint = JSON.stringify(params);
    const idempotencyKey = sessionRef.current?.fingerprint === fingerprint
      ? sessionRef.current.key
      : (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    sessionRef.current = { key: idempotencyKey, fingerprint };

    try {
      const session = await createBookSession(params, idempotencyKey);
      if (session.status === 'completed' && session.result) {
        clearTimeout(staleTimer);
        setGenProgress(100);
        setGenSteps((prev) => prev.map((s) => ({ ...s, done: true })));
        setCreatedBookId(session.result.bookId);
        setGeneratedProfile(session.result.bookPromptProfile);
        setTimeout(() => { setStep(5); setLoading(false); }, 600);
        return;
      }
      if (session.status === 'failed') {
        throw new Error(session.error || '创建失败');
      }

      touchStale();
      const response = await fetch(createBookSseUrl(session.progressChannel), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error('创建失败');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotResult = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        touchStale();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());

            if (payload._type === 'result') {
              gotResult = true;
              clearTimeout(staleTimer);
              setGenProgress(100);
              setGenSteps((prev) => prev.map((s) => ({ ...s, done: true })));
              setCreatedBookId(payload.result.bookId);
              setGeneratedProfile(payload.result.bookPromptProfile);
              setTimeout(() => { setStep(5); setLoading(false); }, 600);
              return;
            }

            if (payload.error) {
              streamError = payload.error;
              break;
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
            // skip malformed JSON
          }
        }
        if (streamError) break;
      }
      clearTimeout(staleTimer);
      if (!gotResult && !streamError) {
        throw new Error('创建结果未返回');
      }
      if (streamError) throw new Error(streamError);
    } catch (error: any) {
      clearTimeout(staleTimer!);
      message.error(streamError || error?.message || '创建连接中断，请重试');
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
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <img src={creativeInspirationImg} alt="" className="w-36 sm:w-44 h-auto pointer-events-none select-none shrink-0 drop-shadow-sm" draggable={false} />
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">你的故事核心创意是什么？</h2>
              <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
                描述你脑中的故事灵感，越具体越好。AI 会基于此构建完整的世界观和定制化写作手册。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mainIdea">核心创意</Label>
            <Textarea
              id="mainIdea"
              placeholder="例如：一个少年在末世废墟中发现了通往平行世界的钥匙，每个平行世界都有不同的物理法则和文明形态..."
              className="min-h-[140px] sm:min-h-[160px] text-sm sm:text-base resize-none"
              disabled={enhancing}
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
            <Card className="relative overflow-hidden border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-white to-teal-50/50 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:via-background dark:to-teal-950/20">
              <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,rgba(16,185,129,0.04)_50%,transparent_75%)] bg-[length:200%_100%] animate-shimmer pointer-events-none" />
              <CardContent className="relative p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                    <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm font-semibold leading-5 text-emerald-800 dark:text-emerald-300">AI 创意增强</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0">
                    {highlights.length} 项优化
                  </Badge>
                </div>
                <div className="space-y-2.5">
                  {highlights.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}>
                      <span className="shrink-0 mt-[3px] flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/10 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{i + 1}</span>
                      <p className="text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">
                        {h.includes('：') ? (<><span className="font-semibold text-emerald-900 dark:text-emerald-200">{h.split('：')[0]}：</span>{h.split('：').slice(1).join('：')}</>) : h}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {highlights.length === 0 && (
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5 overflow-hidden">
              <CardContent className="flex items-start gap-3 p-3.5 sm:p-4 relative">
                <div className="absolute -right-4 -top-4 w-20 h-20 bg-primary/5 rounded-full blur-2xl" />
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

          <Card className="border-primary/10 bg-gradient-to-br from-primary/3 to-transparent overflow-hidden">
            <CardContent className="flex items-start gap-3 p-3.5 sm:p-4 relative">
              <div className="absolute -left-4 -bottom-4 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
              <BookOpen className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">为什么这很重要？</p>
                <p>AI 会根据你的选择生成一份完整的<strong className="text-foreground">写作手册</strong>——包含这个题材专属的写作规则、正反例对比、章末钩子类型、套话黑名单、评审标准等。不同题材的手册完全不同。</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Story Goal + Title */}
      {step === 2 && (
        <div className="animate-fade-in space-y-5 sm:space-y-6">
          <div className="relative">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-gradient-to-br from-primary/8 to-violet-500/8 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-center gap-3 mb-2">
              <Target className="h-6 w-6 text-primary shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold">定义故事的终极主线目标</h2>
            </div>
            <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground pl-9">
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
            <Card className="border-primary/15 bg-gradient-to-br from-primary/3 to-transparent">
              <CardContent className="p-3.5 sm:p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold text-foreground">AI 备选方案（点击替换）</p>
                </div>
                <div className="space-y-1.5">
                  {goalAlternatives.map((alt, i) => (
                    <button
                      key={i}
                      className="w-full text-left rounded-lg border border-border bg-background/70 px-3 py-2.5 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground active:scale-[0.99]"
                      onClick={() => {
                        setForm((prev) => ({ ...prev, mainStoryGoal: alt }));
                        setGoalAlternatives([]);
                      }}
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
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

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="space-y-4 p-3.5 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">自动连载</p>
                    <p className="text-xs text-muted-foreground">按设定节奏自动生成并质检章节</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant={form.autoSerializationEnabled ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setForm({ ...form, autoSerializationEnabled: !form.autoSerializationEnabled })}
                >
                  {form.autoSerializationEnabled ? '已开启' : '已关闭'}
                </Button>
              </div>

              {form.autoSerializationEnabled ? (
                (() => {
                  const isCustom = !SERIALIZATION_PRESETS.some(
                    (p) => p.runEveryDays === form.autoSerializationRunEveryDays && p.chaptersPerRun === form.autoSerializationChaptersPerRun,
                  );
                  const dailyRate = (form.autoSerializationChaptersPerRun ?? 3) / Math.max(1, form.autoSerializationRunEveryDays ?? 1);
                  return <>
                    <div className="grid grid-cols-3 gap-2">
                      {SERIALIZATION_PRESETS.map((preset) => {
                        const selected =
                          form.autoSerializationRunEveryDays === preset.runEveryDays &&
                          form.autoSerializationChaptersPerRun === preset.chaptersPerRun;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            className={cn(
                              'rounded-xl border p-3 text-center transition-all hover:border-primary/50',
                              selected
                                ? 'border-primary bg-background shadow-sm ring-2 ring-primary/20'
                                : 'border-border bg-background/60',
                            )}
                            onClick={() => setForm({
                              ...form,
                              autoSerializationRunEveryDays: preset.runEveryDays,
                              autoSerializationChaptersPerRun: preset.chaptersPerRun,
                            })}
                          >
                            <span className="text-xl leading-none">{preset.emoji}</span>
                            <p className="text-sm font-semibold mt-1.5">{preset.label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{preset.desc}</p>
                          </button>
                        );
                      })}
                    </div>

                    {isCustom && (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-400/50 text-amber-600 bg-amber-50">
                          自定义
                        </Badge>
                        <span className="text-muted-foreground">
                          每 {form.autoSerializationRunEveryDays} 天更新 {form.autoSerializationChaptersPerRun} 章 · 点击上方卡片可恢复预设
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-background/80 border px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-muted-foreground text-xs">触发时间</span>
                        <Input
                          type="time"
                          className="h-7 w-[6.5rem] text-sm px-2"
                          value={form.autoSerializationDailyStartTime}
                          onChange={(e) => setForm({ ...form, autoSerializationDailyStartTime: e.target.value })}
                        />
                      </div>
                      <div className="h-4 w-px bg-border hidden sm:block" />
                      <div className="flex items-center gap-1 text-sm h-7">
                        <span>预计日均</span>
                        <span className="font-semibold text-primary">{dailyRate.toFixed(1)}</span>
                        <span>章/天</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowSerialAdvanced((v) => !v)}
                    >
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSerialAdvanced && 'rotate-180')} />
                      高级设置
                    </button>

                    {showSerialAdvanced && (
                      <div className="space-y-3 rounded-lg border bg-background/50 p-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">更新频率（天）</Label>
                            <Input
                              type="number"
                              min={1}
                              max={14}
                              className="h-8 text-sm"
                              value={form.autoSerializationRunEveryDays}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isNaN(v)) setForm({ ...form, autoSerializationRunEveryDays: Math.min(14, Math.max(1, v)) });
                              }}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">每次生成章数</Label>
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              className="h-8 text-sm"
                              value={form.autoSerializationChaptersPerRun}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isNaN(v)) setForm({ ...form, autoSerializationChaptersPerRun: Math.min(50, Math.max(1, v)) });
                              }}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">自动修复轮次</Label>
                            <Input
                              type="number"
                              min={1}
                              max={8}
                              className="h-8 text-sm"
                              value={form.autoSerializationMaxRepairRounds}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isNaN(v)) setForm({ ...form, autoSerializationMaxRepairRounds: Math.min(8, Math.max(1, v)) });
                              }}
                            />
                            <p className="text-[11px] text-muted-foreground leading-tight">质量不达标时自动重写的最大次数</p>
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          修改频率或章数后，上方预设会自动取消选中；点击预设卡片可快速恢复
                        </p>
                      </div>
                    )}
                  </>;
                })()
              ) : (
                <p className="text-xs text-muted-foreground">
                  关闭后将不自动更新，可在工作台手动开启。
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-gradient-to-br from-primary/3 via-transparent to-violet-500/3 overflow-hidden">
            <CardContent className="p-3.5 sm:p-4 relative">
              <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-2.5 mb-3.5">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 shrink-0">
                  <BookOpen className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-sm font-semibold leading-none">创作摘要</span>
              </div>
              <div className="space-y-2.5 text-sm">
                {[
                  { label: '创意', value: form.mainIdea || '—', clamp: true },
                  { label: '类型', value: effectiveGenre || '—' },
                  { label: '受众', value: effectiveAudience || '—' },
                  { label: '目标', value: form.mainStoryGoal || '—', clamp: true },
                  {
                    label: '规模',
                    value: `${form.targetChapterWordCount?.toLocaleString()} 字/章 × ${form.plannedMinChapters}-${form.plannedMaxChapters} 章 ≈ ${(((form.plannedMinChapters ?? 500) + (form.plannedMaxChapters ?? 800)) / 2 * (form.targetChapterWordCount ?? 3000) / 10000).toFixed(0)} 万字`,
                  },
                  {
                    label: '连载',
                    value: form.autoSerializationEnabled
                      ? `${form.autoSerializationRunEveryDays} 天 ${form.autoSerializationChaptersPerRun} 章（${form.autoSerializationDailyStartTime}）`
                      : '创建后不自动连载',
                  },
                ].map(({ label, value, clamp }) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <span className="shrink-0 w-14 sm:w-16 text-primary/80 font-semibold text-xs uppercase tracking-wider">{label}</span>
                    <span className={cn('text-muted-foreground', clamp && 'line-clamp-2')}>{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generating */}
      {isGenerating && (
        <div className="animate-fade-in flex flex-col items-center py-6 sm:py-10 space-y-5 sm:space-y-6">
          <img src={worldCreatingImg} alt="" className="w-56 sm:w-72 h-auto pointer-events-none select-none" draggable={false} />

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
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <img src={profileCompleteImg} alt="" className="w-28 sm:w-36 h-auto pointer-events-none select-none shrink-0 drop-shadow-sm" draggable={false} />
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">审阅 AI 生成的写作手册</h2>
              <p className="mt-1.5 sm:mt-2 text-sm sm:text-base text-muted-foreground">
                这是 AI 为「{effectiveGenre}」题材生成的专属写作手册。你可以根据自己的理解调整任何内容，
                所有修改将直接影响后续章节的写作风格和质量评审标准。
              </p>
            </div>
          </div>

          <Card className="border-amber-200/60 bg-gradient-to-r from-amber-50/50 to-orange-50/30 dark:from-amber-950/30 dark:to-orange-950/20 dark:border-amber-900/60">
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
