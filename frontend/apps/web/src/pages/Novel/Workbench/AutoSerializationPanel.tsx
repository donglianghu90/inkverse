import React, { useState, useEffect } from 'react';
import { Clock, Loader2, Play, Power, PowerOff, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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

  const [config, setConfig] = useState({
    dailyStartTime: '08:00',
    chaptersPerRun: 3,
    maxRepairRounds: 2,
    minQualityScore: 7,
    minOverallScore: 7,
  });

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const res = await getAutoSerialization(bookId);
        if (res) {
          setHasConfig(true);
          setEnabled(res.enabled);
          setNextRunAt(res.scheduler.nextRunAt);
          setConfig({
            dailyStartTime: res.dailyStartTime,
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
      } else {
        const res = await enableAutoSerialization(bookId);
        setEnabled(res.enabled);
        setNextRunAt(res.scheduler.nextRunAt);
      }
    } catch {
      // errorHandler in app.tsx shows message
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            自动连载配置
          </DialogTitle>
          <DialogDescription>
            设置每日定时自动生成章节，保持稳定更新节奏。
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
                <Separator />
              </>
            )}

            {/* Schedule Config */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dailyTime">每日生成时间</Label>
                <Input
                  id="dailyTime"
                  type="time"
                  value={config.dailyStartTime}
                  onChange={(e) => setConfig({ ...config, dailyStartTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chaptersPerRun">每次生成章数</Label>
                <Input
                  id="chaptersPerRun"
                  type="number"
                  min={1}
                  max={50}
                  value={config.chaptersPerRun}
                  onChange={(e) => setConfig({ ...config, chaptersPerRun: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="autoRepair">最大修复轮次</Label>
              <Input
                id="autoRepair"
                type="number"
                min={1}
                max={8}
                value={config.maxRepairRounds}
                onChange={(e) => setConfig({ ...config, maxRepairRounds: Number(e.target.value) })}
              />
            </div>

            <Separator />

            {/* Quality Guards */}
            <div className="space-y-4">
              <p className="text-sm font-medium">质量守卫</p>
              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <Label>质量门控（固定开启）</Label>
                <p className="text-xs text-muted-foreground">任一章节低于阈值即自动停止当次连载任务</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pl-4 border-l-2 border-primary/20">
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
