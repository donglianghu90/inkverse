/** Run 运行时 — 事件契约 */

export type RunEventType =
  | 'run.start' | 'step.start' | 'step.chunk' | 'step.complete' | 'step.error'
  | 'run.complete' | 'run.error' | 'run.canceled';

export interface AppendEventInput {
  runId: string;
  eventType: RunEventType;
  stepKey?: string;
  attempt?: number;
  payload?: Record<string, unknown>;
}
