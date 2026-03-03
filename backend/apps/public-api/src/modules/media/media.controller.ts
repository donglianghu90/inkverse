/** 媒体生成 REST API — 图片/视频生成、任务查询 */
import { Controller, Post, Get, Delete, Body, Param, Query, Req, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '@packages/common/guards';
import { MediaService } from './media.service';

class GenerateImageDto {
  prompt: string;
  size?: string;
  count?: number;
  negativePrompt?: string;
  referenceImages?: Array<{ url?: string; base64?: string }>;
  provider?: string;
  dramaId?: string;
  assetType?: string;
  refId?: string;
}

class SubmitVideoDto {
  prompt: string;
  duration?: number;
  quality?: '480p' | '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16' | '1:1';
  referenceImages?: Array<{ url: string; role?: string }>;
  generateAudio?: boolean;
  provider?: string;
  dramaId?: string;
  assetType?: string;
  refId?: string;
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  private readonly logger = new Logger('MediaController');

  constructor(private readonly mediaService: MediaService) {}

  @Get('providers')
  listProviders() { return this.mediaService.listProviders(); }

  @Post('image/generate')
  async generateImage(@Body() dto: GenerateImageDto, @Req() req: any) {
    return this.mediaService.generateImage({ ...dto, userId: req.user?.userId });
  }

  @Post('video/submit')
  async submitVideo(@Body() dto: SubmitVideoDto, @Req() req: any) {
    return this.mediaService.submitVideo({
      ...dto,
      referenceImages: dto.referenceImages?.map(r => ({ url: r.url, role: r.role as any })),
      userId: req.user?.userId,
    });
  }

  @Get('video/:jobId')
  async queryVideo(@Param('jobId') jobId: string) {
    return this.mediaService.queryVideoJob(jobId);
  }

  @Delete('video/:jobId')
  async cancelVideo(@Param('jobId') jobId: string) {
    await this.mediaService.cancelVideoJob(jobId);
    return { success: true };
  }

  @Get('jobs')
  async listJobs(@Query('dramaId') dramaId: string) {
    if (!dramaId) return [];
    return this.mediaService.listJobsByDrama(dramaId);
  }
}
