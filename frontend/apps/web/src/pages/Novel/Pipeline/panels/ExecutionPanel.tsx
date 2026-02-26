import { X, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorkflowExecution } from '@/services/novel';

interface Props {
  executions: WorkflowExecution[];
  currentExec: WorkflowExecution | null;
  loading: boolean;
  onSelect: (exec: WorkflowExecution) => void;
  onClear: () => void;
}

const STATUS_ICON = { completed: CheckCircle2, failed: XCircle, running: Loader2 };
const STATUS_COLOR = { completed: 'text-emerald-500', failed: 'text-red-500', running: 'text-blue-500 animate-spin' };

function formatDuration(ms: number) {
  return ms > 60000 ? `${(ms / 60000).toFixed(1)}min` : ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ExecutionPanel({ executions, currentExec, loading, onSelect, onClear }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="text-sm font-bold">执行历史</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}><X className="h-4 w-4" /></Button>
      </div>
      {currentExec && (
        <div className="mx-4 mt-3 rounded-lg border bg-primary/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span>第 {currentExec.chapterNumber} 章</span>
            <span className={cn('text-[10px]', STATUS_COLOR[currentExec.status])}>{currentExec.status === 'completed' ? '成功' : currentExec.status === 'failed' ? '失败' : '运行中'}</span>
          </div>
          {currentExec.summary && (
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <p>总耗时: {formatDuration(currentExec.summary.totalDurationMs)}</p>
              <p>循环轮数: {currentExec.summary.totalLoopAttempts}</p>
              {currentExec.summary.finalScore != null && <p>最终分数: {currentExec.summary.finalScore}</p>}
              <p>执行节点: {currentExec.summary.nodeCount}</p>
              {currentExec.summary.failedNodes.length > 0 && <p className="text-red-500">失败: {currentExec.summary.failedNodes.join(', ')}</p>}
            </div>
          )}
          <Button variant="ghost" size="sm" className="h-6 text-[10px] w-full" onClick={onClear}>清除回放</Button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!loading && executions.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">暂无执行记录</p>}
        {executions.map((exec) => {
          const Icon = STATUS_ICON[exec.status];
          const isActive = currentExec?.id === exec.id;
          return (
            <button
              key={exec.id}
              className={cn('w-full text-left rounded-lg border p-2.5 transition-all hover:bg-accent/30', isActive && 'ring-2 ring-primary bg-primary/5')}
              onClick={() => onSelect(exec)}
            >
              <div className="flex items-center gap-2">
                <Icon className={cn('h-3.5 w-3.5 shrink-0', STATUS_COLOR[exec.status])} />
                <span className="text-xs font-medium">第 {exec.chapterNumber} 章</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {new Date(exec.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {exec.summary && (
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>{formatDuration(exec.summary.totalDurationMs)}</span>
                  {exec.summary.finalScore != null && <><span>·</span><span>分数 {exec.summary.finalScore}</span></>}
                  <span>·</span><span>{exec.summary.totalLoopAttempts}轮</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
