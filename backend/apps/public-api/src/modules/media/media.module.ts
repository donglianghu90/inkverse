/** 媒体生成模块 — Provider + 音频资源 + 视频合成 + 任务管理 + 本地存储 + 渲染配置 + Prompt优化 + 后处理 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaJobEntity } from './entities/media-job.entity';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { KieAiCallbackService } from './providers/kieai/kieai-callback.service';
import { KieAiPollingService } from './providers/kieai/kieai-polling.service';
import { MediaJobService } from './media-job.service';
import { MediaService } from './media.service';
import { MediaTraceLoggerService } from './media-trace-logger.service';
import { AudioResourceService } from './audio-resource.service';
import { VideoComposerService } from './video-composer.service';
import { LocalStorageService } from './local-storage.service';
import { RenderingProfileService } from './rendering/rendering-profile.service';
import { PromptOptimizerService } from './prompt-optimizer.service';
import { VideoPostProcessorService } from './video-post-processor.service';
import { MediaController, MediaPublicController } from './media.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MediaJobEntity])],
  controllers: [MediaPublicController, MediaController],
  providers: [KieAiCallbackService, KieAiPollingService, ProviderRegistryService, MediaJobService, MediaTraceLoggerService, MediaService, AudioResourceService, VideoComposerService, LocalStorageService, RenderingProfileService, PromptOptimizerService, VideoPostProcessorService],
  exports: [MediaService, MediaJobService, ProviderRegistryService, AudioResourceService, VideoComposerService, LocalStorageService, RenderingProfileService, PromptOptimizerService, VideoPostProcessorService, KieAiCallbackService, KieAiPollingService],
})
export class MediaModule {}
