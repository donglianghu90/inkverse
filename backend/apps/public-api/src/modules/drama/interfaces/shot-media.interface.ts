/** 分镜媒体条目 — 单 Shot 的媒体生成结果契约 */

export interface ShotMediaEntry {
  shotId?: string;
  videoUrl?: string;
  videoJobId?: string;
  /** 实际使用的视频 Provider（用于合成阶段计算时长约束） */
  videoProvider?: string;
  ttsUrl?: string;
  sfxUrl?: string;
  sfxJobId?: string;
  sfxStatus?: string;
  sfxPrompt?: string;
  imageUrl?: string;
  /** 首帧图片生成失败的错误信息（供前端展示） */
  imageError?: string;
  lastFrameImageUrl?: string;
  /** 尾帧图片生成失败的错误信息（供前端展示） */
  lastFrameError?: string;
  status: string;
  kenBurnsFallback?: boolean;
  t2iPrompt?: string;
  t2iNegativePrompt?: string;
  lastFrameT2iPrompt?: string;
  /** 视频质量检查发现的问题（ffprobe 结构性检测） */
  videoQcIssues?: string[];
  qc?: {
    identityScore?: number;
    styleScore?: number;
    readabilityScore?: number;
    score?: number;
    passed?: boolean;
    attempts?: number;
    issues?: string[];
    failReasons?: Array<'identity' | 'style' | 'camera' | 'motion'>;
    recommendedFix?: 'identity' | 'style' | 'camera' | 'motion';
  };
}
