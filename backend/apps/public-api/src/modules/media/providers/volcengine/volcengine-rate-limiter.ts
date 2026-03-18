/**
 * 火山引擎图片生成 全局共享滑动窗口限速器
 * 所有 VolcengineImageProvider 实例的请求共享同一配额：20 req / 10s
 */

const VOLCENGINE_RATE_LIMIT_MAX    = 20;
const VOLCENGINE_RATE_LIMIT_WINDOW = 10_000;

const _timestamps: number[] = [];

export async function volcengineImageRateLimitAcquire(): Promise<void> {
  while (true) {
    const now = Date.now();
    while (_timestamps.length > 0 && now - _timestamps[0] >= VOLCENGINE_RATE_LIMIT_WINDOW) {
      _timestamps.shift();
    }
    if (_timestamps.length < VOLCENGINE_RATE_LIMIT_MAX) {
      _timestamps.push(now);
      return;
    }
    const waitMs = VOLCENGINE_RATE_LIMIT_WINDOW - (now - _timestamps[0]) + 10;
    await new Promise<void>(r => setTimeout(r, waitMs));
  }
}
