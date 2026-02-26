import React from 'react';
import { cn } from '@/lib/utils';
import type { BookTokenUsage } from '@/services/novel';

interface Props {
  latestKpi: { qualityScore: number; overallScore: number } | null;
  tokenUsage?: BookTokenUsage | null;
}

function scoreColor(score: number): string {
  if (score >= 8.5) return 'text-emerald-600 bg-emerald-500';
  if (score >= 7) return 'text-amber-600 bg-amber-500';
  return 'text-red-500 bg-red-500';
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export const QualityDashboard: React.FC<Props> = ({ latestKpi, tokenUsage }) => {
  const hasKpi = !!latestKpi;
  const hasToken = !!tokenUsage && tokenUsage.totalCalls > 0;

  if (!hasKpi && !hasToken) {
    return (
      <div className="flex flex-col items-center py-8 text-muted-foreground text-sm gap-2">
        <p>暂无质量数据</p>
        <p className="text-xs">生成章节后将显示评分</p>
      </div>
    );
  }

  const scores = hasKpi ? [
    { label: '写作质量', score: latestKpi!.qualityScore },
    { label: '综合评分', score: latestKpi!.overallScore },
  ] : [];
  const avgScore = hasKpi ? (latestKpi!.qualityScore + latestKpi!.overallScore) / 2 : 0;
  const chapterCount = hasToken ? tokenUsage!.chapters.filter((c) => c.chapterNumber > 0).length : 0;
  const creationUsage = hasToken ? tokenUsage!.chapters.find((c) => c.chapterNumber === 0) : null;

  return (
    <div className="space-y-5">
      {hasKpi && (
        <>
          <div className="text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">综合质量评分</p>
            <p className={cn('text-3xl font-bold tabular-nums', scoreColor(avgScore).split(' ')[0])}>
              {avgScore.toFixed(1)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">最近一章</p>
          </div>
          <div className="space-y-3">
            {scores.map((item) => {
              const pct = (item.score / 10) * 100;
              const colors = scoreColor(item.score);
              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={cn('font-semibold tabular-nums', colors.split(' ')[0])}>
                      {item.score.toFixed(1)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', colors.split(' ')[1])}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {hasToken && (
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-xs font-medium">Token 消耗统计</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <p className="text-muted-foreground">输入 tokens</p>
              <p className="font-semibold tabular-nums text-blue-600">{fmtTokens(tokenUsage!.totalPromptTokens)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">输出 tokens</p>
              <p className="font-semibold tabular-nums text-violet-600">{fmtTokens(tokenUsage!.totalCompletionTokens)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">总计 tokens</p>
              <p className="font-semibold tabular-nums">{fmtTokens(tokenUsage!.totalTokens)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">估算费用</p>
              <p className="font-semibold tabular-nums text-amber-600">{fmtCost(tokenUsage!.totalCostUsd)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">LLM 调用</p>
              <p className="font-semibold tabular-nums">{tokenUsage!.totalCalls} 次</p>
            </div>
            <div>
              <p className="text-muted-foreground">已统计章节</p>
              <p className="font-semibold tabular-nums">{chapterCount} 章</p>
            </div>
          </div>

          {creationUsage && (
            <div className="border-t pt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground font-medium">初始化（开书）</p>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                <span className="text-blue-600">入 {fmtTokens(creationUsage.promptTokens)}</span>
                <span className="text-violet-600">出 {fmtTokens(creationUsage.completionTokens)}</span>
                <span className="text-amber-600">{fmtCost(creationUsage.estimatedCostUsd)}</span>
              </div>
            </div>
          )}

          {chapterCount > 0 && (
            <div className="border-t pt-2 space-y-1">
              <p className="text-[11px] text-muted-foreground font-medium">每章平均</p>
              <div className="flex items-center gap-3 text-[11px] tabular-nums">
                <span className="text-blue-600">
                  入 {fmtTokens(Math.round(tokenUsage!.chapters.filter((c) => c.chapterNumber > 0).reduce((s, c) => s + c.promptTokens, 0) / chapterCount))}
                </span>
                <span className="text-violet-600">
                  出 {fmtTokens(Math.round(tokenUsage!.chapters.filter((c) => c.chapterNumber > 0).reduce((s, c) => s + c.completionTokens, 0) / chapterCount))}
                </span>
                <span className="text-amber-600">
                  {fmtCost(tokenUsage!.chapters.filter((c) => c.chapterNumber > 0).reduce((s, c) => s + c.estimatedCostUsd, 0) / chapterCount)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {hasKpi && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs font-medium">评分说明</p>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>· 写作质量：文笔、节奏、对白等维度</p>
            <p>· 综合评分：包含连续性、角色一致性等</p>
            <p>· 8.5+ 优秀 / 7.0+ 良好 / 7.0以下 需改进</p>
          </div>
        </div>
      )}
    </div>
  );
};
