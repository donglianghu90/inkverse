/**
 * 诊断 Sina 文章解析 - 检查正文提取和正则匹配
 */
import axios from 'axios';
import * as cheerio from 'cheerio';

const URL = 'https://www.sina.cn/news/detail/5263638508080012.html';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';

async function main() {
  console.log('📄 Fetching Sina article...\n');
  const resp = await axios.get(URL, {
    timeout: 15000,
    headers: { 'User-Agent': UA },
    responseType: 'text',
  });

  const $ = cheerio.load(resp.data);

  // 1. 检查各选择器能提取到多少文字
  const selectors = ['article', '.article-body', '.content', 'body', 'main', '#artibody'];
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    console.log(`Selector "${sel}": ${text.length} chars`);
    if (text.length > 0 && text.length < 500) console.log(`   Sample: ${text.slice(0, 200)}...`);
  }

  // 2. 用当前逻辑提取的全文
  const text = $('article, .article-body, .content, body').text();
  console.log(`\n当前逻辑提取的 text 长度: ${text.length}`);

  // 3. 搜索是否包含《》格式的剧名
  const guillemetMatches = text.match(/《[^》]+》/g);
  console.log(`\n《剧名》匹配数: ${guillemetMatches?.length ?? 0}`);
  if (guillemetMatches?.length) {
    console.log('   前 10 个:', guillemetMatches.slice(0, 10));
  }

  // 4. 搜索「热度」关键词
  const hotIndex = text.indexOf('热度');
  console.log(`\n"热度" 出现位置: ${hotIndex >= 0 ? hotIndex : '未找到'}`);
  if (hotIndex >= 0) {
    console.log('   上下文:', text.slice(Math.max(0, hotIndex - 50), hotIndex + 80));
  }

  // 5. 测试当前正则
  const patterns = [
    /《(.+?)》.*?热度[：:]?\s*(\d+(?:\.\d+)?)\s*万?/g,
    /(?:第?\d+[.、]?\s*)《(.+?)》/g,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const p = new RegExp(patterns[i].source, patterns[i].flags);
    let match;
    const matches: string[] = [];
    while ((match = p.exec(text)) !== null) matches.push(match[0]);
    console.log(`\nPattern ${i + 1} 匹配数: ${matches.length}`);
    if (matches.length > 0) console.log('   前 5 个:', matches.slice(0, 5));
  }

  // 6. 看看页面主要结构
  console.log('\n--- 页面结构 ---');
  const bodyText = $('body').text();
  const hasHot = bodyText.includes('热播') || bodyText.includes('热度');
  console.log(`body 包含 热播/热度: ${hasHot}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
