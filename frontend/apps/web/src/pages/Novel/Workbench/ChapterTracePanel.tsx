import React, { useMemo } from 'react';
import { AlertCircle, CheckCircle2, Target, ShieldAlert, NotebookPen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ChapterArtifactsView } from '@/services/novel';

interface Props {
  chapterNumber?: number;
  loading: boolean;
  artifacts: ChapterArtifactsView | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : '')).filter(Boolean);
}

function readPayload(
  artifacts: ChapterArtifactsView | null,
  name: string,
): Record<string, unknown> | null {
  const entry = artifacts?.artifacts.find((item) => item.name === name);
  return asRecord(entry?.payload);
}

function scoreTone(score: number | null): {
  text: string;
  border: string;
  bar: string;
} {
  if (score === null) {
    return {
      text: 'text-muted-foreground',
      border: 'border-muted',
      bar: 'bg-muted',
    };
  }
  if (score >= 0.8) {
    return {
      text: 'text-emerald-600',
      border: 'border-emerald-300',
      bar: 'bg-emerald-500',
    };
  }
  if (score >= 0.6) {
    return {
      text: 'text-amber-600',
      border: 'border-amber-300',
      bar: 'bg-amber-500',
    };
  }
  return {
    text: 'text-red-600',
    border: 'border-red-300',
    bar: 'bg-red-500',
  };
}

export const ChapterTracePanel: React.FC<Props> = ({ chapterNumber, loading, artifacts }) => {
  const derived = useMemo(() => {
    const arc = readPayload(artifacts, 'arc_director');
    const intent = readPayload(artifacts, 'intent');
    const review = readPayload(artifacts, 'review');
    const deterministic = readPayload(artifacts, 'deterministic_check');

    const reviewIssuesRaw = Array.isArray(review?.issuesFound) ? review?.issuesFound : [];
    const reviewIssues = reviewIssuesRaw
      .map((issue) => asRecord(issue))
      .filter((issue): issue is Record<string, unknown> => Boolean(issue))
      .slice(0, 3)
      .map((issue) => ({
        category: typeof issue.category === 'string' ? issue.category : 'other',
        severity: typeof issue.severity === 'string' ? issue.severity : 'minor',
        description: typeof issue.description === 'string' ? issue.description : '',
      }))
      .filter((issue) => issue.description.length > 0);

    const failedChecksRaw = Array.isArray(deterministic?.failedChecks)
      ? deterministic.failedChecks
      : [];
    const failedChecks = failedChecksRaw
      .map((check) => asRecord(check))
      .filter((check): check is Record<string, unknown> => Boolean(check))
      .slice(0, 3)
      .map((check) => ({
        rule: typeof check.rule === 'string' ? check.rule : 'unknown',
        detail: typeof check.detail === 'string' ? check.detail : '',
      }));

    const missingNames = (artifacts?.artifacts ?? [])
      .filter((item) => !item.found)
      .map((item) => item.name);

    return {
      arc,
      intent,
      review,
      deterministic,
      reviewIssues,
      failedChecks,
      missingNames,
      alignment: artifacts?.alignment ?? null,
    };
  }, [artifacts]);

  if (!chapterNumber) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        选择章节后可查看策略回放。
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        正在加载第 {chapterNumber} 章策略回放...
      </div>
    );
  }

  if (!artifacts) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        第 {chapterNumber} 章暂无策略回放数据。
      </div>
    );
  }

  const arcStage =
    typeof derived.arc?.arcStage === 'string' ? derived.arc.arcStage : 'unknown';
  const chapterMission =
    typeof derived.arc?.chapterMission === 'string' ? derived.arc.chapterMission : '';
  const mustHit = toStringArray(derived.arc?.mustHit).slice(0, 3);

  const intentGoals = toStringArray(derived.intent?.goals).slice(0, 3);
  const emotionDirection =
    typeof derived.intent?.emotionDirection === 'string'
      ? derived.intent.emotionDirection
      : '';
  const hookDirection =
    typeof derived.intent?.hookDirection === 'string'
      ? derived.intent.hookDirection
      : '';

  const overallScore =
    typeof derived.review?.overallScore === 'number' ? derived.review.overallScore : null;
  const overallVerdict =
    typeof derived.review?.overallVerdict === 'string'
      ? derived.review.overallVerdict
      : 'unknown';
  const deterministicPass = Boolean(derived.deterministic?.pass);
  const alignment = derived.alignment;
  const overallAlignment = alignment?.overallAlignmentScore ?? null;
  const mustHitMatchRate = alignment?.mustHit?.score ?? null;
  const intentGoalMatchRate = alignment?.intentGoals?.score ?? null;
  const hookMatchRate = alignment?.hookDirection?.matchScore ?? null;
  const remediation = alignment?.remediation ?? null;

  const overallTone = scoreTone(
    overallAlignment !== null ? Math.max(0, Math.min(1, overallAlignment / 100)) : null,
  );
  const mustTone = scoreTone(mustHitMatchRate);
  const goalTone = scoreTone(intentGoalMatchRate);
  const hookTone = scoreTone(hookMatchRate);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">策略回放（第 {chapterNumber} 章）</p>
        {derived.missingNames.length > 0 ? (
          <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-300">
            <AlertCircle className="h-3 w-3" />
            缺失 {derived.missingNames.length} 项
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-600 border-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            数据完整
          </Badge>
        )}
      </div>

      <div className={`rounded-lg border p-3 space-y-2 ${overallTone.border}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium">执行对齐分</p>
          <p className={`text-sm font-semibold tabular-nums ${overallTone.text}`}>
            {overallAlignment !== null ? `${overallAlignment}` : '--'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-[11px] text-muted-foreground">mustHit</p>
            <p className={`text-xs tabular-nums ${mustTone.text}`}>
              {alignment ? `${alignment.mustHit.matched}/${alignment.mustHit.total}` : '--'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">goals</p>
            <p className={`text-xs tabular-nums ${goalTone.text}`}>
              {alignment ? `${alignment.intentGoals.matched}/${alignment.intentGoals.total}` : '--'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">hook</p>
            <p className={`text-xs tabular-nums ${hookTone.text}`}>
              {alignment?.hookDirection ? `${Math.round(alignment.hookDirection.matchScore * 100)}%` : '--'}
            </p>
          </div>
        </div>
      </div>

      {remediation?.shouldRewrite ? (
        <div className={`rounded-lg border p-3 space-y-2 ${
          remediation.severity === 'high'
            ? 'border-red-300'
            : remediation.severity === 'medium'
              ? 'border-amber-300'
              : 'border-emerald-300'
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">自动修复建议</p>
            <Badge variant="outline" className="text-[10px]">
              {remediation.severity.toUpperCase()}
            </Badge>
          </div>
          {remediation.reasons?.length > 0 ? (
            <div className="space-y-1">
              {remediation.reasons.map((reason, idx) => (
                <p key={`${reason}-${idx}`} className="text-xs text-muted-foreground">
                  · {reason}
                </p>
              ))}
            </div>
          ) : null}
          {remediation.suggestedActions?.length > 0 ? (
            <div className="space-y-1">
              {remediation.suggestedActions.map((action, idx) => (
                <p key={`${action}-${idx}`} className="text-xs text-foreground/85">
                  {idx + 1}. {action}
                </p>
              ))}
            </div>
          ) : null}
          {remediation.rewritePrompt ? (
            <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-[11px] leading-relaxed text-muted-foreground">
              {remediation.rewritePrompt}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Target className="h-3.5 w-3.5 text-cyan-600" />
          卷级导演
          <Badge variant="secondary" className="text-[10px]">{arcStage}</Badge>
        </div>
        <p className="text-xs text-foreground/90">{chapterMission || '暂无 chapterMission'}</p>
        {mustHit.length > 0 && (
          <p className="text-xs text-muted-foreground">必须命中：{mustHit.join('；')}</p>
        )}
        {alignment?.mustHit?.items?.length ? (
          <div className="space-y-1 pt-1">
            {alignment.mustHit.items.slice(0, 3).map((item, idx) => (
              <p key={`${item.text}-${idx}`} className={`text-xs ${item.matched ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {item.matched ? '✓' : '·'} {item.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <NotebookPen className="h-3.5 w-3.5 text-blue-600" />
          章节意图
        </div>
        {intentGoals.length > 0 ? (
          <p className="text-xs text-foreground/90">目标：{intentGoals.join('；')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">暂无 goals</p>
        )}
        {emotionDirection && (
          <p className="text-xs text-muted-foreground">情绪：{emotionDirection}</p>
        )}
        {hookDirection && (
          <p className="text-xs text-muted-foreground">钩子：{hookDirection}</p>
        )}
        {alignment?.intentGoals?.items?.length ? (
          <div className="space-y-1 pt-1">
            {alignment.intentGoals.items.slice(0, 3).map((item, idx) => (
              <p key={`${item.text}-${idx}`} className={`text-xs ${item.matched ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {item.matched ? '✓' : '·'} {item.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
            评审结果
          </div>
          <div className="text-xs text-muted-foreground">
            {overallScore !== null ? `分数 ${overallScore.toFixed(1)}` : '无分数'}
          </div>
        </div>
        <p className="text-xs text-foreground/90">裁决：{overallVerdict}</p>
        {derived.reviewIssues.length > 0 ? (
          <div className="space-y-1">
            {derived.reviewIssues.map((issue, idx) => (
              <p key={`${issue.category}-${idx}`} className="text-xs text-muted-foreground">
                [{issue.severity}/{issue.category}] {issue.description}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">未记录主要问题。</p>
        )}
      </div>

      <div className="rounded-lg border p-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">确定性检查</span>
          <Badge
            variant="outline"
            className={deterministicPass
              ? 'text-emerald-600 border-emerald-300'
              : 'text-red-600 border-red-300'}
          >
            {deterministicPass ? 'PASS' : 'FAIL'}
          </Badge>
        </div>
        {derived.failedChecks.length > 0 ? (
          <div className="space-y-1">
            {derived.failedChecks.map((check, idx) => (
              <p key={`${check.rule}-${idx}`} className="text-xs text-muted-foreground">
                {check.rule}{check.detail ? `: ${check.detail}` : ''}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">无失败项。</p>
        )}
      </div>
    </div>
  );
};
