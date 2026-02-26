import React, { useState, useEffect } from 'react';
import { Clock, Loader2, Play, Power, PowerOff, Save, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  getAutoSerialization,
  configureAutoSerialization,
  enableAutoSerialization,
  disableAutoSerialization,
  runAutoSerializationNow,
} from '@/services/novel';

const SERIALIZATION_PRESETS = [
  { label: '日更 3 章', runEveryDays: 1, chaptersPerRun: 3, desc: '起点推荐期 / 番茄进阶全勤', emoji: '🔥' },
  { label: '日更 2 章', runEveryDays: 1, chaptersPerRun: 2, desc: '起点/番茄基础全勤线', emoji: '📝' },
  { label: '日更 1 章', runEveryDays: 1, chaptersPerRun: 1, desc: '精品打磨，稳定输出', emoji: '✨' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
}

export const AutoSerializationPanel: React.FC<Props> = ({ open, onOpenChange, bookId }) => {
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasConfig, setHasConfig] = useState(false);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [intervention, setIntervention] = useState<{
    required: boolean;
    expired: boolean;
    reason: string | null;
    failingChapterNumber: number | null;
    markerChapterNumber: number | null;
    markerChapterNumbers: number[];
    consecutiveLowQualityRuns: number;
    threshold: number;
    expiresAt: string | null;
  } | null>(null);

  const [config, setConfig] = useState({
    dailyStartTime: '08:00',
    runEveryDays: 1,
    chaptersPerRun: 3,
    maxRepairRounds: 2,
    minQualityScore: 7,
    minOverallScore: 7,
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      setIntervention(null);
      try {
        const res = await getAutoSerialization(bookId);
        if (res) {
          setHasConfig(true);
          setEnabled(res.enabled);
          setNextRunAt(res.scheduler.nextRunAt);
          setIntervention(res.intervention ?? null);
          setConfig({
            dailyStartTime: res.dailyStartTime,
            runEveryDays: res.runEveryDays ?? 1,
            chaptersPerRun: res.chaptersPerRun,
            maxRepairRounds: res.qualityPolicy.maxRepairRounds,
            minQualityScore: Math.max(res.qualityPolicy.minQualityScore, 7),
            minOverallScore: Math.max(res.qualityPolicy.minOverallScore, 7),
          });
        }
      } catch {
        // no config yet
      } finally {
        setLoading(false);
      }
    })();
  }, [open, bookId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...config,
        minQualityScore: Math.max(config.minQualityScore, 7),
        minOverallScore: Math.max(config.minOverallScore, 7),
      };
      const res = await configureAutoSerialization(bookId, payload);
      setEnabled(res.enabled);
      setHasConfig(true);
      setNextRunAt(res.scheduler.nextRunAt);
      setIntervention(res.intervention ?? null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      await runAutoSerializationNow(bookId);
    } finally {
      setRunningNow(false);
    }
  };

  const handleToggle = async () => {
    try {
      if (enabled) {
        const res = await disableAutoSerialization(bookId);
        setEnabled(res.enabled);
        setNextRunAt(res.scheduler.nextRunAt);
        setIntervention(res.intervention ?? null);
      } else {
        const res = await enableAutoSerialization(bookId);
        setEnabled(res.enabled);
        setNextRunAt(res.scheduler.nextRunAt);
        setIntervention(res.intervention ?? null);
      }
    } catch {
      // errorHandler in app.tsx shows message
    }
  };
  const markerChapterNumbers = intervention?.markerChapterNumbers ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            自动连载配置
          </DialogTitle>
          <DialogDescription>
            设置按周期自动生成章节（支持每 N 天执行）。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Status */}
            {hasConfig && (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${enabled ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">
                      {enabled ? '连载中' : '已暂停'}
                    </span>
                    {enabled && (
                      <Badge variant="success" className="text-xs">运行中</Badge>
                    )}
                  </div>
                  <Button
                    variant={enabled ? 'destructive' : 'default'}
                    size="sm"
                    className="gap-1"
                    onClick={handleToggle}
                  >
                    {enabled ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                    {enabled ? '停用' : '启用'}
                  </Button>
                </div>
                {nextRunAt && enabled && (
                  <p className="text-xs text-muted-foreground px-1">
                    下次运行: {new Date(nextRunAt).toLocaleString('zh-CN')}
                  </p>
                )}
                {intervention?.required ? (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700">
                    <p className="font-medium">已触发人工介入</p>
                    <p className="mt-1">
                      连续低分 {intervention.consecutiveLowQualityRuns}/{intervention.threshold} 次。
                      {intervention.failingChapterNumber
                        ? ` 问题章节：第 ${intervention.failingChapterNumber} 章。`
                        : ''}
                    </p>
                    {intervention.reason ? <p className="mt-1">{intervention.reason}</p> : null}
                    {intervention.expiresAt ? (
                      <p className="mt-1">有效期至：{new Date(intervention.expiresAt).toLocaleString('zh-CN')}</p>
                    ) : null}
                  </div>
                ) : null}
                {!intervention?.required && markerChapterNumbers.length > 0 ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700">
                    <p className="font-medium">人工介入提醒已过期</p>
                    <p className="mt-1">
                      已保留问题章节标记：第 {markerChapterNumbers.join('、第 ')} 章。
                    </p>
                  </div>
                ) : null}
                <Separator />
              </>
            )}

            {/* Preset cards */}
            {(() => {
              const isCustom = !SERIALIZATION_PRESETS.some(
                (p) => p.runEveryDays === config.runEveryDays && p.chaptersPerRun === config.chaptersPerRun,
              );
              return <>
                <div className="grid grid-cols-3 gap-2">
                  {SERIALIZATION_PRESETS.map((preset) => {
                    const selected = config.runEveryDays === preset.runEveryDays && config.chaptersPerRun === preset.chaptersPerRun;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        className={cn(
                          'rounded-xl border p-2.5 text-center transition-all hover:border-primary/50',
                          selected ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/20' : 'border-border bg-background/60',
                        )}
                        onClick={() => setConfig({ ...config, runEveryDays: preset.runEveryDays, chaptersPerRun: preset.chaptersPerRun })}
                      >
                        <span className="text-lg leading-none">{preset.emoji}</span>
                        <p className="text-sm font-semibold mt-1">{preset.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{preset.desc}</p>
                      </button>
                    );
                  })}
                </div>
                {isCustom && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-[11px] px-1.5 py-0 border-amber-400/50 text-amber-600 bg-amber-50">自定义</Badge>
                    <span className="text-muted-foreground">
                      每 {config.runEveryDays} 天更新 {config.chaptersPerRun} 章 · 点击上方卡片可恢复预设
                    </span>
                  </div>
                )}
              </>;
            })()}

            {/* Trigger time */}
            <div className="space-y-2">
              <Label htmlFor="dailyTime">触发时间</Label>
              <Input
                id="dailyTime"
                type="time"
                value={config.dailyStartTime}
                onChange={(e) => setConfig({ ...config, dailyStartTime: e.target.value })}
              />
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')} />
              高级设置
            </button>

            {showAdvanced && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">更新频率（天）</Label>
                    <Input
                      type="number"
                      min={1}
                      max={14}
                      className="h-8 text-sm"
                      value={config.runEveryDays}
                      onChange={(e) => setConfig({ ...config, runEveryDays: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">每次生成章数</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      className="h-8 text-sm"
                      value={config.chaptersPerRun}
                      onChange={(e) => setConfig({ ...config, chaptersPerRun: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">自动修复轮次</Label>
                    <Input
                      type="number"
                      min={1}
                      max={8}
                      className="h-8 text-sm"
                      value={config.maxRepairRounds}
                      onChange={(e) => setConfig({ ...config, maxRepairRounds: Number(e.target.value) })}
                    />
                    <p className="text-[11px] text-muted-foreground leading-tight">质量不达标时自动重写的最大次数</p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">修改频率或章数后，上方预设会自动取消选中</p>
              </div>
            )}

            <Separator />

            {/* Quality Guards */}
            <div className="space-y-4">
              <p className="text-sm font-medium">质量守卫</p>
              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <Label>质量门控（固定开启）</Label>
                <p className="text-xs text-muted-foreground">任一章节低于阈值即自动停止当次连载任务</p>
              </div>

              <div className="grid grid-cols-1 gap-3 border-l-2 border-primary/20 pl-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">最低写作质量分</Label>
                  <Input
                    type="number"
                    min={7}
                    max={10}
                    step={0.5}
                    value={config.minQualityScore}
                    onChange={(e) => setConfig({ ...config, minQualityScore: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">最低综合评分</Label>
                  <Input
                    type="number"
                    min={7}
                    max={10}
                    step={0.5}
                    value={config.minOverallScore}
                    onChange={(e) => setConfig({ ...config, minOverallScore: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {hasConfig && enabled && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={handleRunNow}
              disabled={runningNow}
            >
              {runningNow ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              立即执行一次
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || loading} className="gap-1.5">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
