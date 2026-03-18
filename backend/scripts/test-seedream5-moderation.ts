/**
 * 诊断脚本：测试 doubao-seedream-5-0-260128 是否真的不通，还是特定参数触发了内容审核
 *
 * 运行：
 *   cd backend
 *   npx ts-node -e "$(cat scripts/test-seedream5-moderation.ts)" 2>&1
 *   # 或
 *   npx ts-node scripts/test-seedream5-moderation.ts
 */
import axios from 'axios';

const API_KEY  = '147874c6-cd91-49cc-952b-3496164d793b';
const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const MODEL_5  = 'doubao-seedream-5-0-260128';
const MODEL_45 = 'doubao-seedream-4-5-251128';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 60_000,
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
});

async function call(label: string, payload: Record<string, unknown>): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`【${label}】`);
  console.log(`model=${payload.model}  size=${payload.size}  refImages=${payload.image ? 1 : 0}`);
  console.log(`prompt (前100): ${String(payload.prompt).slice(0, 100)}`);
  const t0 = Date.now();
  try {
    const res = await http.post('/images/generations', payload);
    const ms = Date.now() - t0;
    const urls: string[] = (res.data?.data ?? []).map((d: any) => d.url ?? '');
    console.log(`✅  成功 (${ms}ms)  返回 ${urls.length} 张`);
    urls.forEach((u, i) => console.log(`   [${i + 1}] ${u.slice(0, 80)}...`));
  } catch (err: any) {
    const ms = Date.now() - t0;
    const errMsg = err?.response?.data?.error?.message ?? err.message ?? '(unknown)';
    const status = err?.response?.status ?? 'N/A';
    console.log(`❌  失败 (${ms}ms)  HTTP ${status}`);
    console.log(`   错误: ${errMsg}`);
  }
}

// ── 测试用例 ──────────────────────────────────────────────────────

/** 1. 纯文生图 — 完全中性 prompt，验证 5.0 是否连通 */
const NEUTRAL_PROMPT = 'a beautiful landscape with mountains and river, photorealistic, 8k';

/** 2. 实际失败的 prompt（从日志提取）*/
const ACTUAL_PROMPT = `真人古装风格，中国古典历史质感，水墨晕染般的自然美感，悲壮苍凉与浪漫交织, realistic cinematic photography, 8k resolution, highly detailed, 丝绸与粗麻质感对比，微妙的胶片颗粒，水墨晕染边缘, 柔和暖金调为主，辅以水墨青灰调，高对比度突出历史厚重感, wearing tattered and weathered coarse gray linen clothes, messy unbound long hair, weathered face with dirt, holding a bamboo staff, tragic but unyielding atmosphere, same person as reference, handsome ancient Chinese man, sharp facial features, sword-shaped eyebrows, piercing and slightly drunken eyes, high nose bridge, light stubble on jawline, slightly tanned skin, rebellious expression, high quality`;

/** 3. 去掉敏感词后的 prompt */
const CLEANED_PROMPT = `真人古装风格，中国古典历史质感，写实电影摄影美学, realistic cinematic photography, 8k resolution, highly detailed, 柔和暖金调, wearing gray linen robe, ancient Chinese man, strong and determined expression, cinematic composition, dramatic atmosphere`;

async function main() {
  console.log('='.repeat(60));
  console.log('Seedream 5.0 连通性 & 内容审核 诊断');
  console.log('='.repeat(60));

  // 1. 5.0 纯文生图 — 中性 prompt（最基础连通测试）
  await call('5.0 纯文生图 · 中性 prompt', {
    model: MODEL_5, prompt: NEUTRAL_PROMPT, size: '1664x2496', n: 1, response_format: 'url', watermark: false,
  });

  // 2. 4.5 纯文生图 — 中性 prompt（基准对照）
  await call('4.5 纯文生图 · 中性 prompt', {
    model: MODEL_45, prompt: NEUTRAL_PROMPT, size: '1664x2496', n: 1, response_format: 'url', watermark: false,
  });

  // 3. 5.0 纯文生图 — 实际失败的 prompt（无参考图，复现原始错误）
  await call('5.0 纯文生图 · 实际 prompt（无参考图）', {
    model: MODEL_5, prompt: ACTUAL_PROMPT, size: '1664x2496', n: 1, response_format: 'url', watermark: false,
  });

  // 4. 5.0 纯文生图 — 清理后的 prompt（去掉疑似触发词）
  await call('5.0 纯文生图 · 清理后 prompt（无参考图）', {
    model: MODEL_5, prompt: CLEANED_PROMPT, size: '1664x2496', n: 1, response_format: 'url', watermark: false,
  });

  // 5. 4.5 纯文生图 — 实际 prompt（对照：4.5 是否也能通过）
  await call('4.5 纯文生图 · 实际 prompt（无参考图）', {
    model: MODEL_45, prompt: ACTUAL_PROMPT, size: '1664x2496', n: 1, response_format: 'url', watermark: false,
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log('诊断完成');
  console.log('判断逻辑:');
  console.log('  - 若 [1] 成功 & [3] 失败 → 5.0 内容审核更严，是 prompt 中特定词触发');
  console.log('  - 若 [1] 也失败           → 5.0 账号未开通/接口问题');
  console.log('  - 若 [3] 失败 & [4] 成功  → 确认是 prompt 敏感词（悲壮/叛逆/微醺等）');
  console.log('  - 若 [3] 失败 & [5] 成功  → 同 prompt 4.5 过了，确认 5.0 审核更严');
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1); });
