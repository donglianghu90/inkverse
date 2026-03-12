#!/usr/bin/env ts-node
/**
 * 测试火山引擎方舟 doubao-seedream-5-0-260128 图片生成模型
 * 用法: cd backend && npx ts-node -r tsconfig-paths/register scripts/test-volcengine-seedream.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const CONFIG = {
  apiKey: '147874c6-cd91-49cc-952b-3496164d793b',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedream-5-0-260128',
  timeoutMs: 120_000,
};

async function main() {
  console.log('=== 火山引擎 Seedream 5 图片生成测试 ===');
  console.log(`模型: ${CONFIG.model}`);
  console.log(`Base URL: ${CONFIG.baseUrl}`);
  console.log('');

  const payload = {
    model: CONFIG.model,
    prompt: '一只可爱的橘猫坐在窗台上，阳光洒在它身上，写实风格，高清',
    size: '2k',  // Seedream 5: 2k | 3k | WIDTHxHEIGHT (≥3,686,400 像素)
    n: 1,
    watermark: false,
    response_format: 'url',
  };

  console.log('请求参数:', JSON.stringify(payload, null, 2));
  console.log('正在调用 API...');

  const t0 = Date.now();
  try {
    const res = await axios.post(
      `${CONFIG.baseUrl}/images/generations`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${CONFIG.apiKey}`,
        },
        timeout: CONFIG.timeoutMs,
      }
    );

    const duration = Date.now() - t0;
    console.log(`\n✅ 成功! 耗时 ${duration}ms`);
    console.log('响应:', JSON.stringify(res.data, null, 2));

    const data = res.data?.data || [];
    if (data.length > 0 && data[0].url) {
      console.log(`\n图片 URL: ${data[0].url}`);
      if (data[0].revised_prompt) {
        console.log(`优化后提示词: ${data[0].revised_prompt}`);
      }
    }
  } catch (err: any) {
    const duration = Date.now() - t0;
    console.error(`\n❌ 失败! 耗时 ${duration}ms`);
    const status = err?.response?.status;
    const errorData = err?.response?.data;
    console.error('状态码:', status);
    console.error('错误:', errorData?.error || err?.message);
    if (errorData) {
      console.error('完整响应:', JSON.stringify(errorData, null, 2));
    }
    process.exit(1);
  }
}

main();
