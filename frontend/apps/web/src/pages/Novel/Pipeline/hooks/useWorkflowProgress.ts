/** 实时工作流进度 Hook — 纯监听 SSE，不触发生成，映射到拓扑节点状态 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getProgressSSEUrl, getGenerationStatus, type GenerationProgressEvent, type NodeStatus } from '@/services/novel';

export interface NodeState {
  status: NodeStatus;
  message?: string;
  durationMs?: number;
  loopAttempt?: number;
  score?: number;
}

const STEP_NODE_MAP: Record<string, string> = {
  'arc-director': 'arc-director',
  'intent': 'intent',
  'continuity-check': 'continuity-guard',
  'scene-plan': 'scene-planner',
  'scene-write': 'creative-writer',
  'scene-stitch': 'scene-stitcher',
  'writing': 'creative-writer',
  'review': 'reviewer',
  'edit': 'editor',
  'hook': 'hook-crafter',
  'record': 'recorder-fork',
};

export function useWorkflowProgress(bookId?: string) {
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [isIdle, setIsIdle] = useState(false); // 无任务在跑时为 true
  const [lastEvent, setLastEvent] = useState<GenerationProgressEvent | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const startListening = useCallback(async () => {
    if (!bookId || esRef.current) return;
    const status = await getGenerationStatus(bookId);
    if (!status.generating) { setIsIdle(true); return; }
    setIsIdle(false);
    const es = new EventSource(getProgressSSEUrl(bookId));
    esRef.current = es;
    setIsRunning(true);

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as GenerationProgressEvent & { idle?: boolean; reconnected?: boolean };
        if (evt.idle) { setIsIdle(true); setIsRunning(false); es.close(); esRef.current = null; return; }
        if (evt.reconnected) return;
        setLastEvent(evt);
        const nodeId = evt.nodeId ?? STEP_NODE_MAP[evt.step];
        if (nodeId) {
          setNodeStates((prev) => {
            const isComplete = evt.message?.includes('完成') || evt.message?.includes('跳过');
            const isSkipped = evt.skipped || evt.message?.includes('跳过');
            return { ...prev, [nodeId]: { status: isSkipped ? 'skipped' : isComplete ? 'completed' : 'running', message: evt.message, durationMs: evt.durationMs, loopAttempt: evt.loopAttempt, score: evt.score } };
          });
        }
        if (evt.done || evt.error) { setIsRunning(false); es.close(); esRef.current = null; }
      } catch { /* ignore */ }
    };

    es.onerror = () => { setIsRunning(false); es.close(); esRef.current = null; };
  }, [bookId]);

  const stopListening = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setIsRunning(false);
    setIsIdle(false);
  }, []);

  const resetStates = useCallback(() => { setNodeStates({}); setLastEvent(null); setIsIdle(false); }, []);

  useEffect(() => () => { esRef.current?.close(); }, []);

  return { nodeStates, isRunning, isIdle, lastEvent, startListening, stopListening, resetStates };
}
