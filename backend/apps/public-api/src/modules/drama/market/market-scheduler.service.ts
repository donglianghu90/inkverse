import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MarketDataService } from './market-data.service';

@Injectable()
export class MarketSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MarketSchedulerService.name);
  private initialCrawlDone = false;

  constructor(private readonly marketData: MarketDataService) {}

  async onModuleInit() {
    setTimeout(() => this.runInitialCrawl(), 10_000);
  }

  private async runInitialCrawl() {
    if (this.initialCrawlDone) return;
    this.initialCrawlDone = true;
    try {
      const hasData = await this.marketData.hasRecentData(7);
      if (hasData) {
        this.logger.log('Market data is fresh (< 7 days), skipping initial crawl');
        return;
      }
      this.logger.log('No recent market data, running initial crawl...');
      const result = await this.marketData.runFullCrawl();
      this.logger.log(`Initial crawl done: inserted=${result.inserted}, updated=${result.updated}`);
    } catch (e: any) {
      this.logger.error(`Initial crawl failed: ${e.message}`);
    }
  }

  /**
   * Weekly crawl: every Monday at 06:00 AM.
   */
  @Cron('0 6 * * 1')
  async weeklyCrawl() {
    this.logger.log('Starting scheduled weekly market crawl...');
    try {
      const result = await this.marketData.runFullCrawl();
      this.logger.log(
        `Weekly crawl completed: inserted=${result.inserted}, updated=${result.updated}, errors=${result.errors.length}`,
      );
      if (result.errors.length > 0) {
        this.logger.warn(`Crawl errors: ${result.errors.slice(0, 5).join('; ')}`);
      }
    } catch (e: any) {
      this.logger.error(`Weekly crawl failed: ${e.message}`);
    }
  }
}
