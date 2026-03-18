/**
 * 测试市场爬虫执行
 *
 * 使用方式:
 *   pnpm exec ts-node -r tsconfig-paths/register scripts/test-market-crawl.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/public-api/src/app.module';
import { MarketDataService } from '../apps/public-api/src/modules/drama/market/market-data.service';

async function main() {
  console.log('🚀 启动 Nest 应用...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const marketData = app.get(MarketDataService);

  console.log('📡 开始执行市场爬虫 (douyin + hongguo-hot + hongguo-sina)...\n');

  const start = Date.now();
  const result = await marketData.runFullCrawl();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('\n📊 爬取结果:');
  console.log(`   插入: ${result.inserted}`);
  console.log(`   更新: ${result.updated}`);
  console.log(`   错误数: ${result.errors.length}`);
  console.log(`   耗时: ${elapsed}s`);

  if (result.errors.length > 0) {
    console.log('\n❌ 错误详情 (前10条):');
    result.errors.slice(0, 10).forEach((e, i) => console.log(`   ${i + 1}. ${e}`));
  }

  // 获取 snapshot 检查各平台数据量
  const snapshot = await marketData.getSnapshot();
  console.log('\n📈 当前快照 (按平台):');
  console.log('   platforms:', snapshot.platforms);
  console.log('   totalEntries:', snapshot.totalEntries);

  await app.close();
  console.log('\n✅ 完成');
}

main().catch((e) => {
  console.error('❌ 执行失败:', e);
  process.exit(1);
});
