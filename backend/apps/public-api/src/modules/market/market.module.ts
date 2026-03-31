/** MarketModule — 市场数据（爬虫 + 调度 + API），从 DramaModule 独立出来 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MarketDramaEntity } from '../drama/entities/market-drama.entity';
import { MarketController } from '../drama/market/market.controller';
import { MarketDataService } from '../drama/market/market-data.service';
import { MarketSchedulerService } from '../drama/market/market-scheduler.service';
import { DouyinDramaCrawler } from '../drama/market/crawlers/douyin-drama.crawler';
import { HongguoDramaCrawler } from '../drama/market/crawlers/hongguo-drama.crawler';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketDramaEntity]),
    ScheduleModule.forRoot(),
  ],
  controllers: [MarketController],
  providers: [
    MarketDataService,
    MarketSchedulerService,
    DouyinDramaCrawler,
    HongguoDramaCrawler,
  ],
  exports: [MarketDataService],
})
export class MarketModule {}
