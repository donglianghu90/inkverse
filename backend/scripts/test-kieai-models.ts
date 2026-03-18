/**
 * Kie.ai 全模型可用性测试
 *
 * 覆盖：
 *   nano-banana-pro  (T2I + I2I，image_input)
 *   nano-banana-2    (T2I + I2I，image_input，google_search)
 *   flux-2/flex-text-to-image  (T2I)
 *   flux-2/pro-image-to-image  (I2I，input_urls)
 *
 * 运行：
 *   cd backend
 *   npx ts-node scripts/test-kieai-models.ts
 */
import axios, { AxiosInstance } from 'axios';

const API_KEY  = '6a81ea574f07f9dac8863d9df4ae0f69';
const BASE_URL = 'https://api.kie.ai';

// 用于 I2I 测试的公开参考图（aiquickdraw 官方示例）
const REF_IMAGE_URL = 'https://static.aiquickdraw.com/tools/example/1772164675129_TZfXY2Sn.png';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS  = 120_000;

const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
});

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface TaskData {
  taskId: string;
  model: string;
  state: string;
  resultJson?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  costTime?: number;
  completeTime?: number;
}

// ── 核心工具 ──────────────────────────────────────────────────────────────────

async function createTask(model: string, input: Record<string, unknown>): Promise<string> {
  const res = await http.post<{ code: number; msg?: string; data?: { taskId: string } }>(
    '/api/v1/jobs/createTask',
    { model, input },
  );
  if (res.data.code !== 200 || !res.data.data?.taskId) {
    throw new Error(`createTask 失败: code=${res.data.code} msg=${res.data.msg}`);
  }
  return res.data.data.taskId;
}

async function pollForResult(taskId: string): Promise<TaskData> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let data: { code: number; msg?: string; data?: TaskData };
    try {
      const resp = await http.get('/api/v1/jobs/recordInfo', { params: { taskId } });
      data = resp.data;
    } catch (err: any) {
      process.stdout.write('?');
      continue;
    }
    if (data.code !== 200 || !data.data) {
      process.stdout.write('!');
      continue;
    }
    const task = data.data;
    if (task.state === 'success') { process.stdout.write('\n'); return task; }
    if (task.state === 'fail') {
      process.stdout.write('\n');
      throw new Error(`任务失败: failCode=${task.failCode} failMsg=${task.failMsg}`);
    }
    process.stdout.write(task.state === 'generating' ? '▸' : '·');
  }
  process.stdout.write('\n');
  throw new Error(`轮询超时 (${POLL_TIMEOUT_MS / 1000}s)`);
}

function parseResultUrls(task: TaskData): string[] {
  if (!task.resultJson) return [];
  try { return (JSON.parse(task.resultJson) as any).resultUrls ?? []; }
  catch { return []; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── 单个测试用例 ──────────────────────────────────────────────────────────────

interface TestCase {
  label: string;
  model: string;
  input: Record<string, unknown>;
}

async function runCase(tc: TestCase, idx: number, total: number): Promise<boolean> {
  const prefix = `[${idx}/${total}]`;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`${prefix} ${tc.label}`);
  console.log(`  model : ${tc.model}`);
  console.log(`  input : ${JSON.stringify(tc.input).slice(0, 120)}…`);

  const t0 = Date.now();
  try {
    process.stdout.write('  提交任务… ');
    const taskId = await createTask(tc.model, tc.input);
    console.log(`taskId=${taskId}`);

    process.stdout.write('  轮询中  ');
    const result = await pollForResult(taskId);
    const urls = parseResultUrls(result);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (urls.length === 0) {
      console.log(`⚠️  成功但无图片 URL (${elapsed}s)  costTime=${result.costTime}ms`);
      return false;
    }
    console.log(`✅  成功 (${elapsed}s 总耗时 / ${result.costTime}ms 生成)  返回 ${urls.length} 张`);
    urls.forEach((u, i) => console.log(`   [${i + 1}] ${u}`));
    return true;
  } catch (err: any) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`❌  失败 (${elapsed}s): ${err.message}`);
    return false;
  }
}

// ── 测试用例集 ────────────────────────────────────────────────────────────────

const T2I_PROMPT = 'A young East Asian woman in ancient Chinese court dress, cinematic portrait, warm lighting, 8K quality';
const I2I_PROMPT = 'Change the outfit to a modern casual style, maintain same person';

const CASES: TestCase[] = [
  // ① nano-banana-pro T2I
  {
    label: 'nano-banana-pro · T2I (文生图)',
    model: 'nano-banana-pro',
    input: { prompt: T2I_PROMPT, aspect_ratio: '2:3', resolution: '1K', output_format: 'jpg' },
  },
  // ② nano-banana-pro I2I
  {
    label: 'nano-banana-pro · I2I (图生图，image_input)',
    model: 'nano-banana-pro',
    input: {
      prompt: I2I_PROMPT, image_input: [REF_IMAGE_URL],
      aspect_ratio: 'auto', resolution: '1K', output_format: 'jpg',
    },
  },
  // ③ nano-banana-2 T2I
  {
    label: 'nano-banana-2 · T2I (文生图)',
    model: 'nano-banana-2',
    input: { prompt: T2I_PROMPT, aspect_ratio: '2:3', resolution: '1K', output_format: 'jpg', google_search: false },
  },
  // ④ nano-banana-2 T2I + google_search
  {
    label: 'nano-banana-2 · T2I + google_search=true',
    model: 'nano-banana-2',
    input: { prompt: 'Latest fashion trends 2025 outfit, editorial photography', aspect_ratio: '1:1', resolution: '1K', output_format: 'jpg', google_search: true },
  },
  // ⑤ nano-banana-2 I2I
  {
    label: 'nano-banana-2 · I2I (图生图，image_input，最多14张)',
    model: 'nano-banana-2',
    input: {
      prompt: I2I_PROMPT, image_input: [REF_IMAGE_URL],
      aspect_ratio: 'auto', resolution: '1K', output_format: 'jpg', google_search: false,
    },
  },
  // ⑥ flux-2/flex-text-to-image T2I
  {
    label: 'flux-2/flex-text-to-image · T2I (文生图)',
    model: 'flux-2/flex-text-to-image',
    input: { prompt: T2I_PROMPT, aspect_ratio: '2:3', resolution: '1K' },
  },
  // ⑦ flux-2/flex-text-to-image 带文字渲染
  {
    label: 'flux-2/flex-text-to-image · 文字渲染测试',
    model: 'flux-2/flex-text-to-image',
    input: {
      prompt: 'A movie poster with the text `INKVERSE` in bold golden letters, dark cinematic background, professional design',
      aspect_ratio: '3:2', resolution: '1K',
    },
  },
  // ⑧ flux-2/pro-image-to-image I2I (input_urls)
  {
    label: 'flux-2/pro-image-to-image · I2I (图生图，input_urls)',
    model: 'flux-2/pro-image-to-image',
    input: {
      prompt: I2I_PROMPT, input_urls: [REF_IMAGE_URL],
      aspect_ratio: 'auto', resolution: '1K',
    },
  },
];

// ── 主入口 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(64));
  console.log(' Kie.ai 全模型可用性测试');
  console.log('='.repeat(64));
  console.log(`API Key : ${API_KEY.slice(0, 8)}…`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`参考图  : ${REF_IMAGE_URL}`);
  console.log(`轮询间隔: ${POLL_INTERVAL_MS / 1000}s  超时: ${POLL_TIMEOUT_MS / 1000}s`);
  console.log('图例: ·=waiting/queuing  ▸=generating  ?=请求失败(重试)  !=响应异常(重试)');

  const results: { label: string; ok: boolean }[] = [];

  for (let i = 0; i < CASES.length; i++) {
    const tc = CASES[i];
    const ok = await runCase(tc, i + 1, CASES.length);
    results.push({ label: tc.label, ok });
  }

  // ── 汇总 ──────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(64)}`);
  console.log(' 测试汇总');
  console.log('='.repeat(64));
  const passed = results.filter(r => r.ok).length;
  results.forEach(r => console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label}`));
  console.log(`\n通过 ${passed}/${results.length} 个测试用例`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { console.error('\n脚本异常:', err); process.exit(1); });
