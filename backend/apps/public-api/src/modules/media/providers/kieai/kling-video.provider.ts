/** Kling 3.0 视频生成 Provider (via kie.ai API)
 *
 *  API 基础信息：
 *    提交: POST /api/v1/jobs/createTask  { model: "kling-3.0/video", input: {...} }
 *    查询: GET  /api/v1/jobs/recordInfo  ?taskId=xxx
 *    鉴权: Bearer {kieai.apiKey}（与图片 Provider 共享同一 apiKey）
 *
 *  核心能力：
 *    · I2V（首帧/尾帧）→ image_urls[0/1]（多镜头模式仅支持首帧）
 *    · 角色元素参考（kling_elements，2-4 张）→ prompt 中用 @element_name 引用
 *      对应 VideoGenerationRequest.referenceImages 的 role:'character' 字段
 *    · mode: 'pro'(1080p) / 'std'(720p)
 *    · duration: 3-15 秒（字符串）
 *    · multi_shots: false=单镜头；true=多镜头，via extra.multi_prompt
 *      多镜头时各段时长精确受控（1-12s/段，最多5段），总时长=各段之和，无需后期裁剪。
 *      多镜头时 sound 强制 false（短剧有独立 TTS 流程）。
 */
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  VideoProvider, VideoCapability,
  VideoGenerationRequest, VideoSubmitResult,
  VideoTaskResult,
} from '../../interfaces/media-provider.interface';
import {
  KieAiCreateTaskResponse,
  KieAiRecordInfoResponse,
  videoTaskResultFromKieAiRecordInfo,
} from './kieai-record-info';
import { kieAiRateLimitAcquireQuery, kieAiRateLimitAcquireSubmit } from './kieai-rate-limiter';

export interface KlingVideoConfig {
  apiKey: string;
  baseUrl: string;
  /** 回调地址（可选），线上部署时配置 */
  callBackUrl?: string;
  /** 'std'=720p / 'pro'=1080p，默认 'pro' */
  defaultMode?: 'std' | 'pro';
  /** 默认时长（秒），范围 3-15，默认 5 */
  defaultDuration?: number;
  /** 是否生成同步音效，默认 false（短剧有独立配音流程） */
  defaultSound?: boolean;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 将 VideoGenerationRequest.quality 或 extra.mode 解析为 Kling mode 字符串
 *  quality 映射：1080p → pro(¥1.00)，720p → std(¥0.50)
 */
function resolveMode(
  req: VideoGenerationRequest,
  defaultMode: 'std' | 'pro',
): 'std' | 'pro' {
  if (req.extra?.mode === 'std' || req.extra?.mode === 'pro') return req.extra.mode as 'std' | 'pro';
  if (req.quality === '1080p') return 'pro';
  if (req.quality === '720p') return 'std';
  return defaultMode;
}

/** 时长安全转换为 Kling 接受的字符串（3-15 整数） */
function clampDuration(sec: number | undefined, def: number): string {
  const n = Math.round(sec ?? def);
  return String(Math.min(15, Math.max(3, n)));
}

/** 将宽高比字符串规范化为 Kling 支持的枚举 */
function resolveAspectRatio(ar?: string): '16:9' | '9:16' | '1:1' {
  if (ar === '9:16') return '9:16';
  if (ar === '1:1') return '1:1';
  return '16:9';
}

// ─── Provider 实现 ─────────────────────────────────────────────────────────────

export class KlingVideoProvider implements VideoProvider {
  readonly name = 'kling';
  readonly capabilities: ReadonlySet<VideoCapability> = new Set<VideoCapability>(['t2v', 'i2v', 'multi-ref']);
  private readonly logger = new Logger('KlingVideo');
  private readonly http: AxiosInstance;
  private readonly cfg: Required<KlingVideoConfig>;

  constructor(config: KlingVideoConfig) {
    this.cfg = {
      apiKey:          config.apiKey,
      baseUrl:         config.baseUrl,
      callBackUrl:     config.callBackUrl ?? '',
      defaultMode:     config.defaultMode ?? 'pro',
      defaultDuration: config.defaultDuration ?? 5,
      defaultSound:    config.defaultSound ?? false,
    };
    this.http = axios.create({
      baseURL: this.cfg.baseUrl,
      timeout: 30_000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
    });
  }

  async submit(req: VideoGenerationRequest): Promise<VideoSubmitResult> {
    const mode        = resolveMode(req, this.cfg.defaultMode);
    const aspectRatio = resolveAspectRatio(req.aspectRatio);

    // ── 参考图分类 ──────────────────────────────────────────────────────────────
    const firstFrameUrls: string[] = [];
    const lastFrameUrls: string[]  = [];
    const characterUrls: string[]  = [];
    const styleUrls: string[]      = [];

    for (const img of req.referenceImages ?? []) {
      switch (img.role) {
        case 'first_frame': firstFrameUrls.push(img.url); break;
        case 'last_frame':  lastFrameUrls.push(img.url);  break;
        case 'character':   characterUrls.push(img.url);  break;
        case 'style':       styleUrls.push(img.url);      break;
      }
    }

    // ── kling_elements 构建（单/多镜头共用） ────────────────────────────────────
    // Kling 3.0 要求每个 element 提供 2-4 张参考图；最多 3 个 element。
    const elements: Array<{
      name: string;
      description: string;
      element_input_urls: string[];
    }> = [];

    const extraElements = req.extra?.kling_elements as typeof elements | undefined;
    if (extraElements?.length) {
      // 防御：确保每个 element 的 element_input_urls 满足 API 最少 2 张要求
      const validated = extraElements.slice(0, 3).map(el => ({
        ...el,
        element_input_urls: el.element_input_urls.length >= 2
          ? el.element_input_urls.slice(0, 4)
          : [el.element_input_urls[0], el.element_input_urls[0]],
      })).filter(el => el.element_input_urls[0]); // 过滤掉 url 为空的
      elements.push(...validated);
    } else if (characterUrls.length >= 1) {
      const elementUrls = characterUrls.length >= 2
        ? characterUrls.slice(0, 4)
        : [characterUrls[0], characterUrls[0]];
      elements.push({
        name: 'char_ref',
        description: 'character reference',
        element_input_urls: elementUrls,
      });
    }

    if (styleUrls.length >= 2 && elements.length < 3) {
      elements.push({
        name: 'style_ref',
        description: 'visual style reference',
        element_input_urls: styleUrls.slice(0, 4),
      });
    }

    const hasCharRef   = elements.some(e => e.name === 'char_ref');
    const hasStyleRef  = elements.some(e => e.name === 'style_ref');
    // extraElements 为预构建的 per-character elements（由 orchestrator 负责拼装好 @elemName），
    // 此时 provider 不再做自动 @char_ref 追加，避免引用不存在的 element 导致生成失败。
    const hasCustomElements = !!(extraElements?.length);

    // ── 多镜头模式（extra.multi_shots === true）────────────────────────────────
    const isMultiShot = req.extra?.multi_shots === true;
    if (isMultiShot) {
      return this.submitMultiShot(req, mode, aspectRatio, elements, hasCharRef, hasStyleRef, firstFrameUrls, hasCustomElements);
    }

    // ── 单镜头模式 ─────────────────────────────────────────────────────────────
    const duration = clampDuration(req.duration, this.cfg.defaultDuration);
    // 短剧有独立 TTS 流程，所有模式都不输出模型自带音效
    const sound    = false;

    let prompt = req.prompt;
    if (hasCharRef && !prompt.includes('@char_ref'))   prompt = `${prompt} @char_ref`;
    if (hasStyleRef && !prompt.includes('@style_ref')) prompt = `${prompt} @style_ref`;

    const imageUrls: string[] = [];
    if (firstFrameUrls.length) imageUrls.push(firstFrameUrls[0]);
    if (lastFrameUrls.length)  imageUrls.push(lastFrameUrls[0]);

    const input: Record<string, unknown> = {
      prompt,
      sound,
      duration,
      aspect_ratio: aspectRatio,
      mode,
      multi_shots: false,
      multi_prompt: [],
    };
    if (imageUrls.length) input.image_urls     = imageUrls;
    if (elements.length)  input.kling_elements = elements;

    const body: Record<string, unknown> = { model: 'kling-3.0/video', input };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `Kling 单镜头: mode=${mode} dur=${duration}s ratio=${aspectRatio}` +
      (imageUrls.length ? ` i2v=${imageUrls.length}帧` : '') +
      (elements.length  ? ` elements=${elements.length}个` : ''),
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Kling createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }
    this.logger.log(`Kling 单镜头任务已提交: taskId=${res.data.data.taskId}`);
    return { providerTaskId: res.data.data.taskId, provider: this.name, model: 'kling-3.0' };
  }

  /**
   * 多镜头模式提交 — 每个 segment 有独立 prompt 和精确时长（1-12s/段，最多5段）。
   * 总时长 = 各段之和，无需后期裁剪。
   * 多镜头模式仅支持首帧（image_urls[0]），不支持尾帧。
   * sound 强制 false（短剧有独立 TTS 流程）。
   */
  private async submitMultiShot(
    req: VideoGenerationRequest,
    mode: 'std' | 'pro',
    aspectRatio: '16:9' | '9:16' | '1:1',
    elements: Array<{ name: string; description: string; element_input_urls: string[] }>,
    hasCharRef: boolean,
    hasStyleRef: boolean,
    firstFrameUrls: string[],
    hasCustomElements = false,
  ): Promise<VideoSubmitResult> {
    type SegmentInput = { prompt: string; duration: number };
    const rawSegments = (req.extra?.multi_prompt as SegmentInput[] | undefined) ?? [];
    if (!rawSegments.length) throw new Error('Kling multi-shot: extra.multi_prompt 为空');

    // 每段最多 5 段，时长 clamp 到 1-12s
    // hasCustomElements=true 时，orchestrator 已在每段 prompt 中追加了正确的 @elemName，
    // provider 不再自动追加 @char_ref（避免引用不存在的 element）
    const multiPrompt = rawSegments.slice(0, 5).map(seg => {
      let p = seg.prompt ?? '';
      if (!hasCustomElements) {
        if (hasCharRef  && !p.includes('@char_ref'))   p = `${p} @char_ref`;
        if (hasStyleRef && !p.includes('@style_ref'))  p = `${p} @style_ref`;
      }
      return {
        prompt:   p.slice(0, 500),  // API 单段上限
        duration: Math.min(12, Math.max(1, Math.round(seg.duration))),
      };
    });

    // 总时长（整数，clamp 3-15）
    const totalDur = String(Math.min(15, Math.max(3,
      Math.round(multiPrompt.reduce((s, seg) => s + seg.duration, 0)),
    )));

    // 合并 prompt 作为 API required 字段的兜底
    const fallbackPrompt = multiPrompt.map(s => s.prompt).join('. ');

    const input: Record<string, unknown> = {
      prompt:       fallbackPrompt,
      sound:        false,           // 短剧独立 TTS，不输出模型音效
      duration:     totalDur,
      aspect_ratio: aspectRatio,
      mode,
      multi_shots:  true,
      multi_prompt: multiPrompt,
    };
    if (firstFrameUrls.length) input.image_urls    = [firstFrameUrls[0]]; // 多镜头仅支持首帧
    if (elements.length)       input.kling_elements = elements;

    const body: Record<string, unknown> = { model: 'kling-3.0/video', input };
    if (this.cfg.callBackUrl) body.callBackUrl = this.cfg.callBackUrl;

    this.logger.log(
      `Kling 多镜头: mode=${mode} segs=${multiPrompt.length} totalDur=${totalDur}s ratio=${aspectRatio}` +
      (firstFrameUrls.length ? ' i2v=首帧' : '') +
      (elements.length       ? ` elements=${elements.length}个` : ''),
    );

    await kieAiRateLimitAcquireSubmit();
    const res = await this.http.post<KieAiCreateTaskResponse>('/api/v1/jobs/createTask', body);
    if (res.data.code !== 200 || !res.data.data?.taskId) {
      throw new Error(`Kling multi-shot createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
    }
    this.logger.log(`Kling 多镜头任务已提交: taskId=${res.data.data.taskId} segs=${multiPrompt.length}`);
    return { providerTaskId: res.data.data.taskId, provider: this.name, model: 'kling-3.0' };
  }

  async query(providerTaskId: string): Promise<VideoTaskResult> {
    await kieAiRateLimitAcquireQuery();
    const res = await this.http.get<KieAiRecordInfoResponse>(
      '/api/v1/jobs/recordInfo',
      { params: { taskId: providerTaskId } },
    );
    return videoTaskResultFromKieAiRecordInfo(
      res.data,
      { providerTaskId, provider: this.name, model: 'kling-3.0' },
      this.logger,
    );
  }

  async cancel(providerTaskId: string): Promise<void> {
    // Kling 3.0 API 暂未暴露取消接口，记录日志即可
    this.logger.warn(`Kling 暂不支持主动取消: taskId=${providerTaskId}`);
  }
}
