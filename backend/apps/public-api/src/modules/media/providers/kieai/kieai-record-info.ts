/**
 * Kie.ai Market 统一任务查询：GET /api/v1/jobs/recordInfo?taskId=
 * 适用于 Seedream / Grok / Kling / Sora 等 createTask 提交的任务。
 */
import { Logger } from '@nestjs/common';
import { VideoTaskResult, VideoTaskStatus } from '../../interfaces/media-provider.interface';
import { KieAiTaskData } from './kieai-callback.service';

export interface KieAiRecordInfoResponse {
  code: number;
  msg?: string;
  /** 文档标为必填；旧响应可能省略 */
  success?: boolean;
  data?: KieAiTaskData;
}

/** POST /api/v1/jobs/createTask 通用外层结构（Market 视频模型） */
export interface KieAiCreateTaskResponse {
  code: number;
  msg?: string;
  data?: { taskId: string };
}

const STATE_MAP: Record<string, VideoTaskStatus> = {
  waiting: 'pending',
  queuing: 'pending',
  generating: 'processing',
  success: 'completed',
  fail: 'failed',
};

/** 无 data 时建议继续轮询的 HTTP 业务码 */
export const KIE_AI_RECORD_INFO_RETRY_CODES = new Set([429, 455, 500]);

/** 无 data 时应终止并视为失败 */
export const KIE_AI_RECORD_INFO_FAIL_CODES = new Set([401, 402, 404, 422, 501, 505]);

function parseKieAiVideoResultJson(resultJson: string): { videoUrl?: string; coverUrl?: string } {
  const parsed = JSON.parse(resultJson) as {
    resultUrls?: string[];
    videoUrl?: string;
    url?: string;
    coverUrl?: string;
  };
  return {
    videoUrl: parsed.resultUrls?.[0] ?? parsed.videoUrl ?? parsed.url,
    coverUrl: parsed.coverUrl,
  };
}

/**
 * 将 recordInfo JSON 转为 VideoTaskResult。
 * 有 data 时以 data.state 为准；无 data 时按 code 区分失败 vs 继续轮询。
 */
export function videoTaskResultFromKieAiRecordInfo(
  envelope: KieAiRecordInfoResponse,
  ctx: { providerTaskId: string; provider: string; model: string },
  logger?: Pick<Logger, 'warn'>,
): VideoTaskResult {
  const { providerTaskId, provider, model } = ctx;
  const topMsg = envelope.msg?.trim();

  if (envelope.success === false && !envelope.data) {
    return {
      providerTaskId,
      status: 'failed',
      provider,
      model,
      error: topMsg || 'Kie.ai recordInfo success=false',
      raw: envelope,
    };
  }

  if (envelope.data) {
    const task = envelope.data;
    const status = STATE_MAP[task.state] ?? 'processing';
    let videoUrl: string | undefined;
    let coverUrl: string | undefined;

    if (task.state === 'success' && task.resultJson) {
      try {
        const p = parseKieAiVideoResultJson(task.resultJson);
        videoUrl = p.videoUrl;
        coverUrl = p.coverUrl;
      } catch {
        logger?.warn(
          `Kie.ai resultJson 解析失败: taskId=${providerTaskId} raw=${task.resultJson?.slice(0, 200)}`,
        );
      }
    }

    return {
      providerTaskId,
      status,
      provider,
      model,
      videoUrl,
      coverUrl,
      error: task.state === 'fail' ? (task.failMsg ?? undefined) : undefined,
      raw: task,
    };
  }

  if (KIE_AI_RECORD_INFO_RETRY_CODES.has(envelope.code)) {
    return {
      providerTaskId,
      status: 'processing',
      provider,
      model,
      raw: envelope,
    };
  }

  if (KIE_AI_RECORD_INFO_FAIL_CODES.has(envelope.code)) {
    return {
      providerTaskId,
      status: 'failed',
      provider,
      model,
      error: topMsg || `Kie.ai recordInfo code=${envelope.code}`,
      raw: envelope,
    };
  }

  if (envelope.code === 200) {
    logger?.warn(`Kie.ai recordInfo code=200 但缺少 data: taskId=${providerTaskId}`);
  } else {
    logger?.warn(
      `Kie.ai recordInfo 未识别 code=${envelope.code} 且无 data: taskId=${providerTaskId} msg=${topMsg}`,
    );
  }

  return {
    providerTaskId,
    status: 'processing',
    provider,
    model,
    raw: envelope,
  };
}
