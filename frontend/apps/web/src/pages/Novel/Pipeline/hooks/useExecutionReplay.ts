/** 历史执行回放 Hook — 加载执行记录映射到拓扑节点状态 */
import { useState, useCallback } from 'react';
import { getChapterExecution, listExecutions, type WorkflowExecution, type NodeStatus } from '@/services/novel';
import type { NodeState } from './useWorkflowProgress';

export function useExecutionReplay(bookId?: string) {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [currentExec, setCurrentExec] = useState<WorkflowExecution | null>(null);
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [loading, setLoading] = useState(false);

  const loadExecutions = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try { setExecutions(await listExecutions(bookId)); } finally { setLoading(false); }
  }, [bookId]);

  const loadChapterExecution = useCallback(async (chapterNumber: number) => {
    if (!bookId) return;
    setLoading(true);
    try {
      const exec = await getChapterExecution(bookId, chapterNumber);
      if (exec) { setCurrentExec(exec); applyExecution(exec); }
    } finally { setLoading(false); }
  }, [bookId]);

  const selectExecution = useCallback((exec: WorkflowExecution) => {
    setCurrentExec(exec);
    applyExecution(exec);
  }, []);

  const clearReplay = useCallback(() => { setCurrentExec(null); setNodeStates({}); }, []);

  function applyExecution(exec: WorkflowExecution) {
    const states: Record<string, NodeState> = {};
    for (const node of exec.nodes) {
      states[node.nodeId] = {
        status: node.status,
        message: node.skippedReason ?? node.errorMessage,
        durationMs: node.durationMs,
        loopAttempt: node.loopAttempt,
        score: node.score,
      };
    }
    setNodeStates(states);
  }

  return { executions, currentExec, nodeStates, loading, loadExecutions, loadChapterExecution, selectExecution, clearReplay };
}
