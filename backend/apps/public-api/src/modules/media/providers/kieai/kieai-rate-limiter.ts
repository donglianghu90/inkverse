/**
 * Kie.ai 全局共享滑动窗口限速器
 * 所有 KieAI 请求（createTask + recordInfo 轮询）共享 20req/10s 配额
 */

const KIEAI_RATE_LIMIT_MAX    = 20;
const KIEAI_RATE_LIMIT_WINDOW = 10_000;

const _timestamps: number[] = [];

export async function kieAiRateLimitAcquire(): Promise<void> {
  while (true) {
    const now = Date.now();
    while (_timestamps.length > 0 && now - _timestamps[0] >= KIEAI_RATE_LIMIT_WINDOW) {
      _timestamps.shift();
    }
    if (_timestamps.length < KIEAI_RATE_LIMIT_MAX) {
      _timestamps.push(now);
      return;
    }
    const waitMs = KIEAI_RATE_LIMIT_WINDOW - (now - _timestamps[0]) + 10;
    await new Promise<void>(r => setTimeout(r, waitMs));
  }
}
