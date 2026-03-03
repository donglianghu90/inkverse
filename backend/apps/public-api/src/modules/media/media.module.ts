/** 媒体生成模块 — Provider + 音频资源 + 视频合成 + 任务管理 + 本地存储 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaJobEntity } from './entities/media-job.entity';
import { ProviderRegistryService } from './providers/provider-registry.service';
import { MediaJobService } from './media-job.service';
import { MediaService } from './media.service';
import { AudioResourceService } from './audio-resource.service';
import { VideoComposerService } from './video-composer.service';
import { LocalStorageService } from './local-storage.service';
import { MediaController } from './media.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MediaJobEntity])],
  controllers: [MediaController],
  providers: [ProviderRegistryService, MediaJobService, MediaService, AudioResourceService, VideoComposerService, LocalStorageService],
  exports: [MediaService, MediaJobService, ProviderRegistryService, AudioResourceService, VideoComposerService, LocalStorageService],
})
export class MediaModule {}
