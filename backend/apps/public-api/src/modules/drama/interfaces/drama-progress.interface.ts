/** 短剧进度 — 事件契约与状态 */

export type DramaRunType = 'create' | 'episode' | 'media' | 'images';
export type DramaTerminalStatus = 'success' | 'failed' | 'paused';

export interface DramaProgressEvent {
  _type: 'progress';
  dramaId: string;
  runType: DramaRunType;
  episodeNumber?: number;
  step: string;
  stepKey?: string;
  nodeId?: string;
  stepIndex: number;
  totalSteps: number;
  message: string;
  done: boolean;
  skipped?: boolean;
  skipReason?: string;
  terminal: boolean;
  terminalStatus?: DramaTerminalStatus;
  error?: string;
}

export interface DramaGenerationStatus {
  generating: boolean;
  startedAt: number | null;
  lastStep: string | null;
  progress: number;
}
