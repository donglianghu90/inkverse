/**
 * 诊断 Hongguo 相关 API 为何返回空数据
 *
 * 使用: pnpm run test:market-crawl 同目录下运行
 *   pnpm exec ts-node -r tsconfig-paths/register scripts/diagnose-hongguo-apis.ts
 */
import axios from 'axios';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

async function diagnose(url: string, name: string, options?: { responseType?: 'json' | 'text' }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📡 ${name}`);
  console.log(`   URL: ${url}`);
  console.log('='.repeat(60));

  try {
    const resp = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      responseType: options?.responseType ?? 'json',
      validateStatus: () => true, // 不抛出非 2xx
    });

    console.log(`   HTTP Status: ${resp.status} ${resp.statusText}`);
    console.log(`   Content-Type: ${resp.headers['content-type']}`);

    const data = resp.data;

    if (typeof data === 'string') {
      console.log(`   Response type: string, length: ${data.length}`);
      console.log(`   First 500 chars: ${data.slice(0, 500)}`);
      if (data.includes('<!DOCTYPE') || data.includes('<html')) {
        console.log('   ⚠️ 返回的是 HTML 而非 JSON，可能被重定向到登录/错误页');
      }
      return;
    }

    if (typeof data === 'object') {
      console.log(`   Response type: object`);
      console.log(`   Keys: ${Object.keys(data).join(', ')}`);

      if (data.code !== undefined) console.log(`   code: ${data.code}`);
      if (data.msg !== undefined) console.log(`   msg: ${data.msg}`);

      const list = data.data ?? data.list ?? data.result;
      if (list !== undefined) {
        console.log(`   List type: ${Array.isArray(list) ? 'array' : typeof list}`);
        if (Array.isArray(list)) {
          console.log(`   List length: ${list.length}`);
          if (list.length > 0) {
            console.log(`   First item keys: ${Object.keys(list[0]).join(', ')}`);
            console.log(`   First item sample:`, JSON.stringify(list[0]).slice(0, 200));
          }
        } else {
          console.log(`   List value:`, JSON.stringify(list).slice(0, 300));
        }
      } else {
        console.log(`   No data/list/result found. Full response:`, JSON.stringify(data).slice(0, 800));
      }
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
    if (e.code) console.log(`   Code: ${e.code}`);
    if (e.response) {
      console.log(`   Response status: ${e.response.status}`);
      console.log(`   Response data (first 300): ${JSON.stringify(e.response.data).slice(0, 300)}`);
    }
  }
}

async function main() {
  console.log('\n🔍 Hongguo API 诊断开始\n');

  // 1. rmdj 热门短剧 API
  await diagnose('https://api.aa1.cn/api/rmdj/', 'Hongguo-hot (rmdj 热门短剧)');

  // 2. 文档页 - 看能否获取到真实 API 地址
  await diagnose(
    'https://api.aa1.cn/doc/rmdj.html',
    'Doc page (rmdj 文档)',
    { responseType: 'text' },
  );

  // 3. yingshi 影视 API
  await diagnose('https://api.aa1.cn/api/yingshi/', 'Hongguo-video (yingshi 影视)');

  // 4. Sina 文章
  await diagnose(
    'https://www.sina.cn/news/detail/5263638508080012.html',
    'Sina article (新浪热榜文章)',
    { responseType: 'text' },
  );

  console.log('\n✅ 诊断完成\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
