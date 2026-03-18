import { Controller, Get, Post, Query } from '@nestjs/common';
import { MarketDataService } from './market-data.service';

@Controller('drama/market')
export class MarketController {
  constructor(private readonly marketData: MarketDataService) {}

  @Get('snapshot')
  async getSnapshot(@Query('date') date?: string) {
    return this.marketData.getSnapshot(date);
  }

  @Get('trends')
  async getTrends(@Query('days') days?: string) {
    return this.marketData.getGenreTrends(days ? parseInt(days, 10) : 7);
  }

  @Get('recommended-genres')
  async getRecommendedGenres() {
    return this.marketData.getRecommendedGenres();
  }

  @Get('creation-recommendations')
  async getCreationRecommendations() {
    return this.marketData.getCreationRecommendations();
  }

  @Get('entries')
  async listEntries(
    @Query('platform') platform?: string,
    @Query('genre') genre?: string,
    @Query('limit') limit?: string,
    @Query('days') days?: string,
  ) {
    return this.marketData.listEntries({
      platform,
      genre,
      limit: limit ? parseInt(limit, 10) : undefined,
      days: days ? parseInt(days, 10) : undefined,
    });
  }

  @Post('crawl')
  async triggerCrawl() {
    return this.marketData.runFullCrawl();
  }
}
