/** Drama 任务系统类型定义 */
export const DRAMA_TASK_STATUS = { QUEUED: 'queued', PROCESSING: 'processing', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' } as const;
export type DramaTaskStatus = (typeof DRAMA_TASK_STATUS)[keyof typeof DRAMA_TASK_STATUS];

export const DRAMA_TASK_TYPE = { // 按领域分类
  CREATE_DRAMA: 'create_drama', GENERATE_EPISODE: 'generate_episode', // 核心流程
  GENERATE_IMAGE: 'generate_image', GENERATE_VIDEO: 'generate_video', GENERATE_TTS: 'generate_tts', // 媒体生成
  REVIEW_SCRIPT: 'review_script', EDIT_SCRIPT: 'edit_script', // 审查修复
  REGENERATE_ASSET: 'regenerate_asset', // 资产重新生成
} as const;
export type DramaTaskType = (typeof DRAMA_TASK_TYPE)[keyof typeof DRAMA_TASK_TYPE];

export const DRAMA_QUEUE = { TEXT: 'drama-text', IMAGE: 'drama-image', VIDEO: 'drama-video', VOICE: 'drama-voice' } as const;
export type DramaQueueName = (typeof DRAMA_QUEUE)[keyof typeof DRAMA_QUEUE];

export const TASK_TYPE_QUEUE_MAP: Record<DramaTaskType, DramaQueueName> = { // 任务类型→队列映射
  create_drama: DRAMA_QUEUE.TEXT, generate_episode: DRAMA_QUEUE.TEXT,
  generate_image: DRAMA_QUEUE.IMAGE, generate_video: DRAMA_QUEUE.VIDEO, generate_tts: DRAMA_QUEUE.VOICE,
  review_script: DRAMA_QUEUE.TEXT, edit_script: DRAMA_QUEUE.TEXT,
  regenerate_asset: DRAMA_QUEUE.IMAGE,
};

export interface DramaTaskPayload {
  taskId: string;
  type: DramaTaskType;
  dramaId: string;
  userId: string;
  episodeNumber?: number;
  targetType: string; // drama / episode / asset
  targetId: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}

export const TERMINAL_STATUSES = new Set<DramaTaskStatus>(['completed', 'failed', 'cancelled']); // 终态集合
export function isTerminal(status: DramaTaskStatus): boolean { return TERMINAL_STATUSES.has(status); }
