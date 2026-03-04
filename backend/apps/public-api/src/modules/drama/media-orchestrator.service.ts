/** 媒体编排器 — 支持关键帧插值(首尾帧)、并发T2I/I2V、角色变体参考图、动态权重策略 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@packages/modules';
import { EpisodeEntity, EpisodeMediaStatus } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaEntity } from './entities/drama.entity';
import { DramaState, Shot, EpisodeStoryboard } from './schemas/drama-state.schemas';
import { MediaService } from '../media/media.service';
import { ProviderRegistryService } from '../media/providers/provider-registry.service';
import { AudioResourceService } from '../media/audio-resource.service';
import { VideoComposerService, ComposeShotInput } from '../media/video-composer.service';
import { LocalStorageService } from '../media/local-storage.service';
import { DramaProgressService } from './drama-progress.service';

export interface ShotMediaEntry { videoUrl?: string; videoJobId?: string; ttsUrl?: string; imageUrl?: string; lastFrameImageUrl?: string; status: string }

const T2I_CONCURRENCY = 3; // 同时最多3个T2I请求
const I2V_CONCURRENCY = 2; // 同时最多2个I2V提交
const MAX_MEDIA_RETRIES = 2; // 媒体生成最大重试次数
const RETRY_BASE_DELAY_MS = 2000; // 重试基础延迟(ms)
const DEFAULT_NEGATIVE_PROMPT = 'blurry, low quality, deformed face, extra fingers, watermark, text, logo, bad anatomy, worst quality, jpeg artifacts, duplicate';

/** 从 Shot.camera 提取景别/构图/景深，补充到 T2I prompt 尾部 */
function buildCameraHint(camera?: { angle?: string; composition?: string; depthOfField?: string }): string {
  if (!camera) return '';
  const parts: string[] = [];
  if (camera.angle) parts.push(camera.angle.replace(/_/g, ' '));
  if (camera.composition) parts.push(camera.composition.replace(/_/g, ' '));
  if (camera.depthOfField && camera.depthOfField !== 'medium') parts.push(`${camera.depthOfField} depth of field`);
  return parts.join(', ');
}

/** 拼接 T2I 最终 prompt = 原始 prompt + camera hint */
function enrichT2iPrompt(raw: string, camera?: { angle?: string; composition?: string; depthOfField?: string }): string {
  const hint = buildCameraHint(camera);
  return hint ? `${raw}, ${hint}` : raw;
}

@Injectable()
export class MediaOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger('MediaOrchestrator');
  private skipImageGen = false;

  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(VisualAssetEntity) private readonly assetRepo: Repository<VisualAssetEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    private readonly mediaService: MediaService,
    private readonly registry: ProviderRegistryService,
    private readonly audioResource: AudioResourceService,
    private readonly composer: VideoComposerService,
    private readonly storage: LocalStorageService,
    private readonly progressService: DramaProgressService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const pipeline = (media.pipeline ?? {}) as Record<string, unknown>;
    this.skipImageGen = String(pipeline.skipImageGeneration) === 'true';
    await this.recoverPendingEpisodes();
  }

  private async recoverPendingEpisodes(): Promise<void> {
    const stuck = await this.episodeRepo.find({
      where: { mediaStatus: In(['generating_first_frames', 'generating_images', 'generating_videos'] as EpisodeMediaStatus[]) },
    });
    if (!stuck.length) return;
    this.logger.warn(`发现 ${stuck.length} 个未完成媒体任务，执行恢复...`);
    for (const ep of stuck) {
      const map = ep.shotMediaMap ?? {};
      const hasActive = Object.values(map).some(v => v.status === 'submitted' && v.videoJobId);
      if (!hasActive) {
        this.logger.warn(`E${ep.episodeNumber}(${ep.dramaId}) 无活跃任务，标记失败`);
        await this.episodeRepo.update(ep.id, { mediaStatus: 'failed', mediaError: '服务重启恢复: 无活跃任务' });
      }
    }
  }

  /** 完整单集媒体生成流水线（首帧+尾帧→视频→TTS→FFmpeg） */
  async generateEpisodeMedia(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: EpisodeMediaStatus; shotMediaMap: Record<string, ShotMediaEntry>; videoUrl?: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new Error(`E${episodeNumber} 不存在`);
    if (!episode.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shots: Shot[] = storyboard?.shots ?? [];
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    const flashbackVideoMap = await this.buildFlashbackVideoMap(dramaId, shots);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = aspectRatio === '9:16' ? '720x1280' : '1280x720';

    const raw = episode.shotMediaMap ?? {};
    const shotMediaMap: Record<string, ShotMediaEntry> = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, { ...v, status: v.status ?? 'unknown' }]),
    );

    const hasT2I = !this.skipImageGen;
    const totalPhases = (hasT2I ? shots.length * 2 : 0) + shots.length * 2 + 1; // 首帧+尾帧+视频+TTS+合成
    let phaseOff = 0;
    const emit = (i: number, msg: string, done = false) =>
      this.progressService.emit({ dramaId, phase: 'media', episodeNumber, step: `media_${i}`, stepIndex: i, totalSteps: totalPhases, message: msg, done });

    try {
      if (hasT2I) {
        // ═══ Phase 0: T2I 首帧 + 尾帧（并发池） ═══
        await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
        const sceneCache = new Map<string, string>();
        const prevFrameCache = new Map<number, string>(); // shotIndex → 上一Shot的尾帧/首帧图URL

        await this.runConcurrent(shots, T2I_CONCURRENCY, async (shot, i) => {
          const sid = shot.shotId;
          if (shot.isFlashback || shot.isPreview) { emit(phaseOff + i, `${sid} 跳过T2I`, true); return; }

          // 首帧生成
          if (!shotMediaMap[sid]?.imageUrl) {
            try {
              emit(phaseOff + i, `${sid} 首帧生成中...`);
              const prompt = enrichT2iPrompt(shot.firstFramePrompt || shot.visualPrompt, shot.camera);
              const refs = this.buildRefImages(shot, charImageMap, variationImageMap, sceneCache, prevFrameCache, 'first');
              const res = await this.withRetry(() => this.mediaService.generateImage({ prompt, negativePrompt: DEFAULT_NEGATIVE_PROMPT, size: imgSize, count: 1, referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: sid }), `${sid} 首帧`);
              const imgUrl = res.images?.[0]?.url ?? '';
              if (imgUrl) {
                shotMediaMap[sid] = { ...shotMediaMap[sid], imageUrl: imgUrl, status: shotMediaMap[sid]?.status ?? 'image_done' };
                if (shot.sceneId && !sceneCache.has(shot.sceneId)) sceneCache.set(shot.sceneId, imgUrl);
                prevFrameCache.set(shot.shotIndex, imgUrl);
                try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, sid)); } catch {}
              }
              emit(phaseOff + i, `${sid} 首帧完成`, true);
            } catch (err) { this.logger.warn(`${sid} 首帧失败: ${(err as Error).message}`); }
          } else {
            if (shot.sceneId && !sceneCache.has(shot.sceneId)) sceneCache.set(shot.sceneId, shotMediaMap[sid].imageUrl!);
            prevFrameCache.set(shot.shotIndex, shotMediaMap[sid].imageUrl!);
          }

          // 尾帧生成（关键帧插值模式）
          if (shot.lastFramePrompt && !shotMediaMap[sid]?.lastFrameImageUrl) {
            try {
              emit(phaseOff + shots.length + i, `${sid} 尾帧生成中...`);
              const lastRefs = this.buildRefImages(shot, charImageMap, variationImageMap, sceneCache, prevFrameCache, 'last');
              const lastPrompt = enrichT2iPrompt(shot.lastFramePrompt, shot.camera);
              const res = await this.withRetry(() => this.mediaService.generateImage({ prompt: lastPrompt, negativePrompt: DEFAULT_NEGATIVE_PROMPT, size: imgSize, count: 1, referenceImages: lastRefs, dramaId, assetType: 'shot_last_frame', refId: `${sid}_last` }), `${sid} 尾帧`);
              const lastUrl = res.images?.[0]?.url ?? '';
              if (lastUrl) shotMediaMap[sid] = { ...shotMediaMap[sid], lastFrameImageUrl: lastUrl };
              emit(phaseOff + shots.length + i, `${sid} 尾帧完成`, true);
            } catch (err) { this.logger.warn(`${sid} 尾帧失败: ${(err as Error).message}`); }
          }
          await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
        });
        phaseOff += shots.length * 2;
      }

      // ═══ Phase 1: I2V / T2V 视频生成（支持关键帧插值，并发提交） ═══
      await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);
      await this.runConcurrent(shots, I2V_CONCURRENCY, async (shot, i) => {
        const sid = shot.shotId;
        if (shotMediaMap[sid]?.status === 'completed' && shotMediaMap[sid]?.videoUrl) {
          emit(phaseOff + i, `${sid} 视频已完成`, true); return;
        }
        try {
          if (shot.isFlashback && shot.flashbackSourceShotId && flashbackVideoMap[shot.flashbackSourceShotId]) {
            shotMediaMap[sid] = { ...shotMediaMap[sid], videoUrl: flashbackVideoMap[shot.flashbackSourceShotId], status: 'completed' };
            emit(phaseOff + i, `${sid} 闪回复用`, true); return;
          }
          if (shot.isPreview) { shotMediaMap[sid] = { ...shotMediaMap[sid], status: 'skipped_preview' }; emit(phaseOff + i, `${sid} 预览跳过`, true); return; }

          emit(phaseOff + i, `${sid} 视频生成中...`);
          const refImages: Array<{ url: string; role: 'first_frame' | 'last_frame' | 'character' | 'style' }> = [];
          const firstFrame = shotMediaMap[sid]?.imageUrl;
          if (firstFrame) refImages.push({ url: firstFrame, role: 'first_frame' });
          const lastFrame = shotMediaMap[sid]?.lastFrameImageUrl; // 关键帧插值
          if (lastFrame) refImages.push({ url: lastFrame, role: 'last_frame' });
          this.collectRefImages(shot, charImageMap, variationImageMap).forEach(url => refImages.push({ url, role: 'character' }));

          const sub = await this.withRetry(() => this.mediaService.submitVideo({
            prompt: shot.visualPrompt,
            duration: Math.min(Math.max(Math.round(shot.estimatedDurationSec), 2), 10),
            quality: '720p', aspectRatio: aspectRatio as any,
            referenceImages: refImages, dramaId, assetType: 'shot_video', refId: sid,
          }), `${sid} 视频`);
          shotMediaMap[sid] = { ...shotMediaMap[sid], videoJobId: sub.jobId, status: 'submitted' };
          await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);
        } catch (err) {
          this.logger.error(`${sid} 视频提交失败: ${(err as Error).message}`);
          shotMediaMap[sid] = { ...shotMediaMap[sid], status: 'failed' };
        }
      });
      await this.awaitVideoJobs(shotMediaMap, shots, dramaId, episode.id, phaseOff, emit);
      phaseOff += shots.length;

      // ═══ Phase 2: TTS 语音合成 ═══
      let ttsOk = false;
      try { this.registry.getTtsProvider(); ttsOk = true; } catch {}
      if (ttsOk) {
        const voiceMap = new Map(state.characters?.map(c => [c.characterId, c.voiceProfile]) ?? []);
        for (let i = 0; i < shots.length; i++) {
          const shot = shots[i];
          if (!shot.dialogue?.text || shot.isPreview) continue;
          if (shotMediaMap[shot.shotId]?.ttsUrl) continue;
          try {
            const voice = voiceMap.get(shot.dialogue.characterId);
            emit(phaseOff + i, `${shot.shotId} TTS...`);
            const outPath = this.storage.ttsOutputPath(dramaId, shot.shotId);
            const ttsRes = await this.mediaService.synthesizeTtsToFile({
              text: shot.dialogue.text, voiceId: voice?.ttsVoiceId || '',
              speed: SPEED_MAP[voice?.speed ?? 'normal'] ?? 1.0, emotion: shot.dialogue.emotion,
              extra: { volume: shot.dialogue.volume },
            }, outPath);
            shotMediaMap[shot.shotId] = { ...shotMediaMap[shot.shotId], ttsUrl: ttsRes.audioUrl };
            emit(phaseOff + i, `${shot.shotId} TTS完成`, true);
          } catch (err) { this.logger.warn(`${shot.shotId} TTS失败: ${(err as Error).message}`); }
        }
      } else { this.logger.warn('TTS Provider 未配置，跳过语音合成'); }
      await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);

      // ═══ Phase 3: FFmpeg 合成 ═══
      let videoUrl = '';
      if (this.composer.isAvailable()) {
        try {
          emit(totalPhases - 1, '合成完整单集视频...');
          await this.updateMedia(episode.id, 'compositing', shotMediaMap);
          const composeShots: ComposeShotInput[] = shots.filter(s => shotMediaMap[s.shotId]?.videoUrl).map(s => ({
            shotId: s.shotId, videoPath: shotMediaMap[s.shotId].videoUrl!,
            ttsAudioPath: shotMediaMap[s.shotId]?.ttsUrl, durationSec: s.estimatedDurationSec,
            transition: s.transitionToNext ?? 'cut',
            subtitle: s.subtitle ? { text: s.subtitle.text, style: s.subtitle.style ?? 'normal' } : undefined,
            bgmPath: s.audio?.bgm?.mood ? (this.audioResource.resolveBgm(s.audio.bgm.mood) ?? undefined) : undefined,
            bgmIntensity: s.audio?.bgm?.intensity, bgmAction: s.audio?.bgm?.action,
            sfxPaths: s.audio?.sfx?.map(fx => this.audioResource.resolveSfx(fx.sound)).filter(Boolean) as string[],
            ambiencePath: s.audio?.ambience ? (this.audioResource.resolveAmbience(s.audio.ambience) ?? undefined) : undefined,
          }));
          if (composeShots.length > 0) {
            const outputPath = this.storage.videoOutputPath(dramaId, episodeNumber);
            const result = await this.composer.compose({ episodeId: episode.id, shots: composeShots, outputPath, aspectRatio });
            videoUrl = result.outputPath;
            this.logger.log(`E${episodeNumber} 合成完成: ${result.durationSec}s | ${result.fileSizeMb.toFixed(1)}MB`);
          }
          emit(totalPhases - 1, '合成完成', true);
        } catch (err) { this.logger.error(`E${episodeNumber} 合成失败: ${(err as Error).message}`); }
      }

      const done = Object.values(shotMediaMap).filter(v => v.status === 'completed' || v.status === 'skipped_preview').length;
      const finalStatus: EpisodeMediaStatus = done === shots.length ? 'completed' : 'failed';
      await this.episodeRepo.update(episode.id, { mediaStatus: finalStatus, shotMediaMap, videoUrl });
      this.logger.log(`E${episodeNumber} 媒体完成: ${finalStatus} | T2V=${done}/${shots.length} | video=${videoUrl ? 'yes' : 'no'}`);
      return { mediaStatus: finalStatus, shotMediaMap, videoUrl: videoUrl || undefined };
    } catch (err) {
      await this.episodeRepo.update(episode.id, { mediaStatus: 'failed', mediaError: (err as Error).message });
      throw err;
    }
  }

  async getMediaStatus(dramaId: string, episodeNumber: number) {
    const ep = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!ep) throw new Error(`E${episodeNumber} 不存在`);
    const map = ep.shotMediaMap ?? {};
    const total = Object.keys(map).length;
    return { mediaStatus: ep.mediaStatus, videoUrl: ep.videoUrl, total,
      completed: Object.values(map).filter(v => v.status === 'completed').length,
      failed: Object.values(map).filter(v => v.status === 'failed').length, shotMediaMap: map };
  }

  // ═══ 并发执行池 ═══

  private async runConcurrent<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i], i);
      }
    });
    await Promise.all(workers);
  }

  // ═══ 动态参考图构建 ═══

  /** 构建首帧/尾帧T2I的参考图列表（含角色变体+场景缓存+前帧参考） */
  private buildRefImages(
    shot: Shot, charMap: Map<string, string>, varMap: Map<string, string>,
    sceneCache: Map<string, string>, prevFrameCache: Map<number, string>,
    frameType: 'first' | 'last',
  ): Array<{ url: string; weight: number }> {
    const refs: Array<{ url: string; weight: number }> = [];
    const isCloseUp = ['close_up', 'extreme_close_up', 'medium_close_up'].includes(shot.camera?.angle);
    const charWeight = isCloseUp ? 0.6 : 0.4; // 特写镜头增大角色权重
    const sceneWeight = isCloseUp ? 0.2 : 0.4;

    if (shot.sceneId && sceneCache.has(shot.sceneId)) refs.push({ url: sceneCache.get(shot.sceneId)!, weight: sceneWeight });
    (shot.characters ?? []).forEach(c => {
      const varId = shot.characterVariationIds?.[c.characterId]; // 优先使用变体图
      const varUrl = varId ? varMap.get(`${c.characterId}_${varId}`) : undefined;
      const url = varUrl || charMap.get(c.characterId);
      if (url) refs.push({ url, weight: charWeight });
    });
    if (frameType === 'first' && shot.shotIndex > 0 && prevFrameCache.has(shot.shotIndex - 1)) { // 前帧参考
      refs.push({ url: prevFrameCache.get(shot.shotIndex - 1)!, weight: 0.15 });
    }
    return refs.slice(0, 5);
  }

  /** 收集角色参考图URL（支持变体） */
  private collectRefImages(shot: Shot, charMap: Map<string, string>, varMap: Map<string, string>): string[] {
    return [...new Set((shot.characters ?? []).map(c => {
      const varId = shot.characterVariationIds?.[c.characterId];
      return (varId ? varMap.get(`${c.characterId}_${varId}`) : undefined) || charMap.get(c.characterId);
    }).filter(Boolean) as string[])].slice(0, 4);
  }

  // ═══ 事件驱动视频等待 ═══

  private async awaitVideoJobs(map: Record<string, ShotMediaEntry>, shots: Shot[], dramaId: string, epId: string, off: number, emit: (i: number, m: string, d?: boolean) => void): Promise<void> {
    const pending = Object.entries(map).filter(([, v]) => v.status === 'submitted' && v.videoJobId);
    if (!pending.length) return;
    const jobToShot = new Map(pending.map(([sid, v]) => [v.videoJobId!, sid]));
    this.logger.log(`等待 ${pending.length} 个视频任务...`);

    let remaining = pending.length;
    for (const [sid, entry] of pending) { // 补查已完成任务
      const job = await this.mediaService.findJob(entry.videoJobId!);
      if (!job) continue;
      if (job.status === 'completed') {
        const vUrl = (job.result as any)?.videoUrl ?? '';
        map[sid] = { ...map[sid], videoUrl: vUrl, status: 'completed' };
        const idx = shots.findIndex(s => s.shotId === sid);
        emit(off + (idx >= 0 ? idx : 0), `${sid} 视频完成(补查)`, true);
        if (vUrl) try { await this.storage.downloadToLocal(vUrl, this.storage.resolve(`videos/${dramaId}/${sid}.mp4`)); } catch {}
        remaining--;
      } else if (job.status === 'failed') { map[sid] = { ...map[sid], status: 'failed' }; remaining--; }
    }
    if (remaining <= 0) { await this.updateMedia(epId, 'generating_videos', map); return; }
    await this.updateMedia(epId, 'generating_videos', map);

    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { cleanup(); resolve(); }, 30 * 60 * 1000);
      const handler = async (evt: { jobId: string; status: string; result?: Record<string, unknown> }) => {
        const sid = jobToShot.get(evt.jobId);
        if (!sid || map[sid].status === 'completed' || map[sid].status === 'failed') return;
        if (evt.status === 'completed') {
          const vUrl = (evt.result as any)?.videoUrl ?? '';
          map[sid] = { ...map[sid], videoUrl: vUrl, status: 'completed' };
          const idx = shots.findIndex(s => s.shotId === sid);
          emit(off + (idx >= 0 ? idx : 0), `${sid} 视频完成`, true);
          if (vUrl) try { await this.storage.downloadToLocal(vUrl, this.storage.resolve(`videos/${dramaId}/${sid}.mp4`)); } catch {}
        } else if (evt.status === 'failed') { map[sid] = { ...map[sid], status: 'failed' }; }
        else return;
        remaining--;
        await this.updateMedia(epId, 'generating_videos', map);
        if (remaining <= 0) { cleanup(); resolve(); }
      };
      const cleanup = () => { clearTimeout(timer); this.mediaService.offJobCompleted(handler); };
      this.mediaService.onJobCompleted(handler);
    });
  }

  // ═══ 工具方法 ═══

  private async withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = MAX_MEDIA_RETRIES, baseDelayMs = RETRY_BASE_DELAY_MS): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try { return await fn(); } catch (err) {
        if (attempt === maxRetries) throw err;
        const delay = baseDelayMs * Math.pow(2, attempt);
        this.logger.warn(`${label} 失败(${attempt + 1}/${maxRetries + 1})，${delay}ms后重试: ${(err as Error).message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('unreachable');
  }

  private async buildCharacterImageMap(dramaId: string): Promise<Map<string, string>> {
    const assets = await this.assetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    return new Map(assets.filter(a => a.referenceImageUrl).map(a => [a.refId, a.referenceImageUrl]));
  }

  /** 构建角色变体图映射 characterId_variationId → imageUrl */
  private async buildVariationImageMap(dramaId: string, state: DramaState): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const ch of state.characters ?? []) {
      for (const v of ch.variations ?? []) {
        if (v.referenceImageUrl) map.set(`${ch.characterId}_${v.variationId}`, v.referenceImageUrl);
      }
    }
    return map;
  }

  private async buildFlashbackVideoMap(dramaId: string, shots: Shot[]): Promise<Record<string, string>> {
    const fbShots = shots.filter(s => s.isFlashback && s.flashbackSourceShotId);
    if (!fbShots.length) return {};
    const byEp = new Map<number, string[]>(), globalIds: string[] = [];
    for (const s of fbShots) {
      if (s.flashbackSourceEpisode) {
        const arr = byEp.get(s.flashbackSourceEpisode) || [];
        arr.push(s.flashbackSourceShotId!);
        byEp.set(s.flashbackSourceEpisode, arr);
      } else { globalIds.push(s.flashbackSourceShotId!); }
    }
    const result: Record<string, string> = {};
    for (const [epNum, sids] of byEp) {
      const ep = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber: epNum }, select: ['shotMediaMap'] });
      if (!ep?.shotMediaMap) continue;
      for (const sid of sids) if (ep.shotMediaMap[sid]?.videoUrl) result[sid] = ep.shotMediaMap[sid].videoUrl!;
    }
    if (globalIds.length) {
      const eps = await this.episodeRepo.find({ where: { dramaId }, select: ['shotMediaMap'] });
      for (const ep of eps) { if (!ep.shotMediaMap) continue;
        for (const [sid, entry] of Object.entries(ep.shotMediaMap))
          if (globalIds.includes(sid) && entry.videoUrl && !result[sid]) result[sid] = entry.videoUrl;
      }
    }
    return result;
  }

  private async updateMedia(id: string, status: EpisodeMediaStatus, map: Record<string, ShotMediaEntry>): Promise<void> {
    await this.episodeRepo.update(id, { mediaStatus: status, shotMediaMap: map });
  }
}

const SPEED_MAP: Record<string, number> = { slow: 0.85, normal: 1.0, fast: 1.2 };
