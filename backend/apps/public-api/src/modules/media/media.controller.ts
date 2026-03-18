/** 媒体生成 REST API — 图片/视频生成、任务查询 */
import { Controller, Post, Get, Delete, Body, Param, Query, Req, UseGuards, Logger, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '@packages/common/guards';
import { Public } from '@packages/common/guards';
import { MediaService } from './media.service';
import { KieAiCallbackService, KieAiTaskData } from './providers/kieai/kieai-callback.service';

class KieAiCallbackDto {
  code: number;
  msg?: string;
  data: KieAiTaskData;
}

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

/** 无需鉴权的公开端点（供第三方回调调用） */
@Public()
@Controller('media')
export class MediaPublicController {
  private readonly logger = new Logger('MediaPublicController');

  constructor(private readonly kieAiCallbackService: KieAiCallbackService) {}

  /**
   * Kie.ai 任务完成回调。
   * URL 示例：http://your-domain.com/media/kieai/callback
   * 始终返回 200，避免 kie.ai 重试。
   */
  @Post('kieai/callback')
  @HttpCode(200)
  handleKieAiCallback(@Body() body: KieAiCallbackDto) {
    const data = body?.data;
    if (!data?.taskId) {
      this.logger.warn(`Kie.ai callback: 缺少 taskId，payload=${JSON.stringify(body)?.slice(0, 300)}`);
      return { ok: false, reason: 'missing taskId' };
    }

    this.logger.log(`Kie.ai callback: taskId=${data.taskId} state=${data.state} model=${data.model ?? '-'}`);
    const handled = this.kieAiCallbackService.complete(data.taskId, data);
    return { ok: true, handled };
  }
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  private readonly logger = new Logger('MediaController');

  constructor(
    private readonly mediaService: MediaService,
    private readonly kieAiCallbackService: KieAiCallbackService,
  ) {}

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

  /** 查看当前 Kie.ai 等待中的任务数（调试用） */
  @Get('kieai/pending')
  getKieAiPending() {
    return { pendingCount: this.kieAiCallbackService.pendingCount };
  }
}
