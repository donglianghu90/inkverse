/**
 * Kie.ai（同一 baseUrl / API Key）— **提交** 与 **查询** 两套完全独立的限速，互不共用额度、不共用实现。
 * 火山 volcengine 等非 Kie Provider 不经过本模块。
 *
 * - **仅提交**：createTask、Veo generate 等「新建任务」→ `kieAiRateLimitAcquireSubmit()`
 * - **仅查询**：recordInfo 等「轮询状态」→ `kieAiRateLimitAcquireQuery()`
 *
 * 出站 Kie HTTP 覆盖清单（排查遗漏时对照）：
 * - 提交：`kieai-image.provider`（createTask）；`kling-video` / `hailuo` / `kling-avatar` / `sora` / `wan-animate`（createTask）；`veo-video`（veo/generate）
 * - 查询：`kieai-polling.service`（recordInfo）；上述视频 Provider 的 `query()`（recordInfo）
 * - 脚本：`backend/scripts/test-kieai-models.ts`（应与线上同样 acquire）
 * - 回调入站 `POST /media/kieai/callback` 无出站查询；`MediaJobService` / `queryVideoJob` 经 Provider.query，不重复在 Job 层 acquire
 *
 * 多进程/多实例：限流状态为 **进程内内存**，多副本并行时各自计数；若需全局统一需 Redis 等。
 */

const _submitTimestamps: number[] = [];
const _queryTimestamps: number[] = [];

let _submitMaxPerWindow = 20;
let _submitWindowMs = 10_000;
let _queryMaxPerWindow = 10;
let _queryWindowMs = 1_000;

async function kieAiAcquireSubmitSlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    while (_submitTimestamps.length > 0 && now - _submitTimestamps[0] >= _submitWindowMs) {
      _submitTimestamps.shift();
    }
    if (_submitTimestamps.length < _submitMaxPerWindow) {
      _submitTimestamps.push(now);
      return;
    }
    const waitMs = _submitWindowMs - (now - _submitTimestamps[0]) + 10;
    await new Promise<void>(r => setTimeout(r, waitMs));
  }
}

async function kieAiAcquireQuerySlot(): Promise<void> {
  while (true) {
    const now = Date.now();
    while (_queryTimestamps.length > 0 && now - _queryTimestamps[0] >= _queryWindowMs) {
      _queryTimestamps.shift();
    }
    if (_queryTimestamps.length < _queryMaxPerWindow) {
      _queryTimestamps.push(now);
      return;
    }
    const waitMs = _queryWindowMs - (now - _queryTimestamps[0]) + 10;
    await new Promise<void>(r => setTimeout(r, waitMs));
  }
}

/**
 * 从 `media.kieai` 读取两套独立配置：
 * - `rateLimit.submit.maxPerWindow` / `rateLimit.submit.windowMs` — 仅影响提交
 * - `rateLimit.query.maxPerWindow` / `rateLimit.query.windowMs` — 仅影响查询
 *
 * 兼容旧键（扁平，已废弃）：`rateLimit.submitMaxPerWindow` 等同 `submit.maxPerWindow` 等。
 */
export function configureKieAiRateLimitsFromConfig(kieai: Record<string, unknown>): void {
  const rl = (kieai.rateLimit ?? {}) as Record<string, unknown>;
  const submit = (rl.submit ?? {}) as Record<string, unknown>;
  const query = (rl.query ?? {}) as Record<string, unknown>;

  const sm = Number(
    submit.maxPerWindow ?? rl.submitMaxPerWindow,
  );
  const sw = Number(
    submit.windowMs ?? rl.submitWindowMs,
  );
  const qm = Number(
    query.maxPerWindow ?? rl.queryMaxPerWindow,
  );
  const qw = Number(
    query.windowMs ?? rl.queryWindowMs,
  );

  if (Number.isFinite(sm) && sm > 0) _submitMaxPerWindow = sm;
  if (Number.isFinite(sw) && sw > 0) _submitWindowMs = sw;
  if (Number.isFinite(qm) && qm > 0) _queryMaxPerWindow = qm;
  if (Number.isFinite(qw) && qw > 0) _queryWindowMs = qw;
}

/** 仅「提交任务」类 HTTP（与查询配额无关） */
export async function kieAiRateLimitAcquireSubmit(): Promise<void> {
  return kieAiAcquireSubmitSlot();
}

/** 仅「查询任务」类 HTTP（与提交配额无关） */
export async function kieAiRateLimitAcquireQuery(): Promise<void> {
  return kieAiAcquireQuerySlot();
}

/** 走 Kie 视频 API 的 Provider.name（与 ProviderRegistry 注册名一致） */
export const KIE_VIDEO_PROVIDER_NAMES = new Set<string>([
  'kling',
  'hailuo',
  'kling-avatar',
  'sora',
  'veo',
  'wan-animate',
]);

export function isKieRateLimitedVideoProvider(providerName: string): boolean {
  return KIE_VIDEO_PROVIDER_NAMES.has(providerName);
}
