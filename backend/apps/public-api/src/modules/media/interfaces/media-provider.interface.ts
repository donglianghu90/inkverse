/** 媒体生成 Provider 抽象层 — 策略模式，新增 Provider 只需实现接口 + 注册即可 */

// ═══ 图片生成 (T2I / I2I) ═══

export type ImageCapability = 't2i' | 'i2i' | 'multi-ref' | 'inpainting' | 'upscale';

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  size?: string; // "1024x1024" | "16:9" | "2K"，各 provider 自行解析
  referenceImages?: Array<{ url?: string; base64?: string; weight?: number }>; // I2I / 多图融合
  count?: number; // 生成数量，默认 1
  seed?: number;
  extra?: Record<string, unknown>; // provider-specific 扩展参数
}

export interface ImageGenerationResult {
  images: Array<{ url: string; width?: number; height?: number; revisedPrompt?: string }>;
  provider: string;
  model: string;
  durationMs: number;
  raw?: unknown; // 原始响应，便于调试
}

export interface ImageProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<ImageCapability>;
  generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

// ═══ 视频生成 (T2V / I2V) — 异步任务模式 ═══

export type VideoCapability = 't2v' | 'i2v' | 'v2v' | 'multi-ref' | 'audio-gen';

export interface VideoGenerationRequest {
  prompt: string;
  duration?: number; // 秒数，默认 5
  quality?: '480p' | '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  referenceImages?: Array<{ url: string; role?: 'first_frame' | 'last_frame' | 'character' | 'style' }>;
  referenceVideos?: Array<{ url: string }>;
  generateAudio?: boolean;
  seed?: number;
  extra?: Record<string, unknown>;
}

export interface VideoSubmitResult {
  providerTaskId: string;
  provider: string;
  model: string;
}

export type VideoTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface VideoTaskResult {
  providerTaskId: string;
  status: VideoTaskStatus;
  videoUrl?: string;
  coverUrl?: string;
  durationSeconds?: number;
  error?: string;
  provider: string;
  model: string;
  raw?: unknown;
}

export interface VideoProvider {
  readonly name: string;
  readonly capabilities: ReadonlySet<VideoCapability>;
  submit(req: VideoGenerationRequest): Promise<VideoSubmitResult>;
  query(providerTaskId: string): Promise<VideoTaskResult>;
  cancel(providerTaskId: string): Promise<void>;
}

// ═══ TTS (Text-to-Speech) — 预留扩展 ═══

export interface TtsRequest {
  text: string;
  voiceId: string;
  speed?: number;
  emotion?: string;
  extra?: Record<string, unknown>;
}

export interface TtsResult {
  audioUrl: string;
  durationSeconds: number;
  provider: string;
  model: string;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;
  synthesizeToFile?(req: TtsRequest, outputPath: string): Promise<TtsResult>; // 写入本地文件，供 FFmpeg 合成
}

// ═══ 统一 Provider 类型标识 ═══

export type MediaProviderType = 'image' | 'video' | 'tts';

export interface MediaProviderMeta {
  type: MediaProviderType;
  name: string;
  displayName: string;
  capabilities: ReadonlySet<string>;
}
