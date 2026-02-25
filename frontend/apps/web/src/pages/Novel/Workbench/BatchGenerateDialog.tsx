import React, { useState } from 'react';
import { Loader2, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateChaptersBatch, type BatchGenerateResult } from '@/services/novel';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookId: string;
  onDone: () => void;
}

export const BatchGenerateDialog: React.FC<Props> = ({ open, onOpenChange, bookId, onDone }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchGenerateResult | null>(null);
  const [config, setConfig] = useState({
    chapterCount: 5,
    maxRepairRounds: 2,
    minQualityScore: 7,
    minOverallScore: 7,
  });

  const formatStopReason = (reason: string | null): string | null => {
    if (!reason) return null;
    const match = reason.match(/_at_chapter_(\d+)$/);
    if (match?.[1]) {
      const chapter = match[1];
      return `第 ${chapter} 章未达质量阈值`;
    }
    return reason;
  };

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const payload = {
        ...config,
        minQualityScore: Math.max(config.minQualityScore, 7),
        minOverallScore: Math.max(config.minOverallScore, 7),
      };
      const res = await generateChaptersBatch(bookId, payload);
      setResult(res);
    } catch {
      // errorHandler in app.tsx already shows message
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (result) {
      onDone();
      setResult(null);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            批量生成章节
          </DialogTitle>
          <DialogDescription>
            连续生成多个章节，AI 会自动保持故事连贯性。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
              <div>
                <p className="font-medium text-emerald-900">
                  生成完成 — {result.generatedChapters}/{result.requestedChapters} 章
                </p>
                {formatStopReason(result.stopReason) && (
                  <p className="text-sm text-emerald-700 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    提前停止: {formatStopReason(result.stopReason)}
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {result.chapters.map((ch) => {
                const qualityScore = ch.qualityScore ?? ch.overallScore;
                const pass =
                  qualityScore >= config.minQualityScore &&
                  ch.overallScore >= config.minOverallScore;
                return (
                  <div key={ch.chapterNumber} className="flex items-center justify-between text-sm px-2 py-1.5 rounded hover:bg-muted">
                    <span>第 {ch.chapterNumber} 章 · {ch.title}</span>
                    <span className={`tabular-nums font-medium ${pass ? 'text-emerald-600' : 'text-amber-600'}`}>
                      写作 {qualityScore.toFixed(1)} / 综合 {ch.overallScore.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>完成</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label htmlFor="chapterCount">生成章节数</Label>
                <Input
                  id="chapterCount"
                  type="number"
                  min={1}
                  max={50}
                  value={config.chapterCount}
                  onChange={(e) => setConfig({ ...config, chapterCount: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">最多一次生成 50 章</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxRepairRounds">每章最大修复轮数</Label>
                <Input
                  id="maxRepairRounds"
                  type="number"
                  min={1}
                  max={8}
                  value={config.maxRepairRounds}
                  onChange={(e) => setConfig({ ...config, maxRepairRounds: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">越高越稳，但生成耗时会增加</p>
              </div>

              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <Label>质量门控（固定开启）</Label>
                <p className="text-xs text-muted-foreground">任一章节低于阈值即自动停止本次批量生成</p>
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

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={loading} className="gap-2">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    开始生成 {config.chapterCount} 章
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
