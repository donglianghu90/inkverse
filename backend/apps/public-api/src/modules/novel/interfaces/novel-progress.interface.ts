/** 小说进度 — 事件契约 */

export interface GenerationProgressEvent {
  bookId: string;
  chapterNumber: number;
  step: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  error?: string;
  nodeId?: string;
  loopAttempt?: number;
  score?: number;
  durationMs?: number;
  skipped?: boolean;
  phase?: string;
}

export interface CreateBookResultEvent {
  result?: Record<string, unknown>;
  error?: string;
}

export interface GenerationStatus {
  generating: boolean;
  startedAt: number | null;
  lastStep: string | null;
  progress: number;
}
