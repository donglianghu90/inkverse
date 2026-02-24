import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  latestKpi: { qualityScore: number; overallScore: number } | null;
}

function scoreColor(score: number): string {
  if (score >= 8.5) return 'text-emerald-600 bg-emerald-500';
  if (score >= 7) return 'text-amber-600 bg-amber-500';
  return 'text-red-500 bg-red-500';
}

export const QualityDashboard: React.FC<Props> = ({ latestKpi }) => {
  if (!latestKpi) {
    return (
      <div className="flex flex-col items-center py-8 text-muted-foreground text-sm gap-2">
        <p>暂无质量数据</p>
        <p className="text-xs">生成章节后将显示评分</p>
      </div>
    );
  }

  const scores = [
    { label: '写作质量', score: latestKpi.qualityScore },
    { label: '综合评分', score: latestKpi.overallScore },
  ];

  const avgScore = (latestKpi.qualityScore + latestKpi.overallScore) / 2;

  return (
    <div className="space-y-5">
      {/* Overall Score */}
      <div className="text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">综合质量评分</p>
        <p className={cn('text-3xl font-bold tabular-nums', scoreColor(avgScore).split(' ')[0])}>
          {avgScore.toFixed(1)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">最近一章</p>
      </div>

      {/* Score Bars */}
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

      {/* Gate Summary */}
      <div className="rounded-lg border p-3 space-y-2">
        <p className="text-xs font-medium">评分说明</p>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>· 写作质量：文笔、节奏、对白等维度</p>
          <p>· 综合评分：包含连续性、角色一致性等</p>
          <p>· 8.5+ 优秀 / 7.0+ 良好 / 7.0以下 需改进</p>
        </div>
      </div>
    </div>
  );
};
