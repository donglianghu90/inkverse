/** 短剧进度 — 事件契约与状态 */

export type DramaRunType = 'create' | 'episode' | 'media' | 'images' | 'assets';
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
  /** 附加业务数据，供前端按 _type/stepKey 解析（如新角色引入警告） */
  data?: Record<string, unknown>;
}

export interface DramaGenerationStatus {
  generating: boolean;
  startedAt: number | null;
  lastStep: string | null;
  progress: number;
}
