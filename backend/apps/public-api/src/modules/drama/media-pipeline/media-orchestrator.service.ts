/** 媒体编排器 — 支持关键帧插值(首尾帧)、并发T2I/I2V、角色变体参考图、渲染配置驱动、质量关卡、连贯性校验 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@packages/modules';
import { EpisodeEntity, EpisodeMediaStatus } from '../entities/episode.entity';
import { VisualAssetEntity } from '../entities/visual-asset.entity';
import { DramaEntity } from '../entities/drama.entity';
import { DramaState, Shot, EpisodeStoryboard } from '../schemas/drama-state.schemas';
import { MediaService } from '../../media/media.service';
import { ProviderRegistryService } from '../../media/providers/provider-registry.service';
import { AudioResourceService } from '../../media/audio-resource.service';
import { VideoComposerService } from '../../media/video-composer.service';
import type { ComposeShotInput } from '../../media/interfaces';
import { LocalStorageService } from '../../media/local-storage.service';
import { DramaProgressService } from '../drama-progress.service';
import { RenderingProfileService } from '../../media/rendering/rendering-profile.service';
import {
  RenderingProfile, RefImageCandidate, CharacterImageSet, CharacterViewAngle,
  selectRefImages, selectBestCharacterView, buildCameraHint, assembleT2iPrompt,
} from '../../media/rendering/rendering-profile';
import { PromptOptimizerService } from '../../media/prompt-optimizer.service';
import { MediaQualityGateService, QualityAssessment } from './media-quality-gate.service';
import { ShotCoherenceValidatorService } from './shot-coherence-validator.service';
import { EmotionMediaMapperService } from './emotion-media-mapper.service';
import { GenerationPolicyService } from './generation-policy.service';
import { ImageProviderRouterService } from './image-provider-router.service';
import type { DramaGenerationMode, DramaStyleBucket } from '../interfaces';
import type { ShotMediaEntry } from '../interfaces';

@Injectable()
export class MediaOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger('MediaOrchestrator');
  private t2iMaxConcurrency = 3;
  private t2iNextSlotAt = 0; // 令牌槽：下一次允许提交的时间戳(ms)
  private acquireT2iSlot: () => Promise<void> = () => Promise.resolve();
  private static readonly LIVE_ACTION_NEGATIVE_EXTRA = [
    'painting', 'illustration', 'watercolor painting', 'ink painting',
    'comic panel', 'storyboard panel', 'split screen', 'grid layout',
    'collage', 'diptych', 'triptych',
  ].join(', ');
  private skipImageGen = false;
  private profile!: RenderingProfile;

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
    private readonly renderingProfileService: RenderingProfileService,
    private readonly promptOptimizer: PromptOptimizerService,
    private readonly qualityGate: MediaQualityGateService,
    private readonly coherenceValidator: ShotCoherenceValidatorService,
    private readonly emotionMapper: EmotionMediaMapperService,
    private readonly generationPolicy: GenerationPolicyService,
    private readonly imageRouter: ImageProviderRouterService,
  ) {}

  async onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const pipeline = (media.pipeline ?? {}) as Record<string, unknown>;
    this.skipImageGen = String(pipeline.skipImageGeneration) === 'true';
    if (pipeline.t2iMaxConcurrency) this.t2iMaxConcurrency = Number(pipeline.t2iMaxConcurrency);
    const t2iIntervalMs = Number(pipeline.t2iIntervalMs) || 3000;
    this.acquireT2iSlot = async () => {
      const waitMs = this.t2iNextSlotAt - Date.now();
      this.t2iNextSlotAt = Math.max(Date.now(), this.t2iNextSlotAt) + t2iIntervalMs;
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
    };
    this.profile = this.renderingProfileService.getImageProfile();
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

  /** 按当前模型的 RenderingProfile 组装 T2I prompt */
  private assemblePrompt(raw: string, camera?: { shotSize?: string; shotSizeEnd?: string | null; cameraAngle?: string; composition?: string; depthOfField?: string }, stylePrefix?: string, useEndSize = false): string {
    const effectiveCamera = useEndSize && camera?.shotSizeEnd
      ? { ...camera, shotSize: camera.shotSizeEnd }
      : camera;
    return assembleT2iPrompt(raw, this.profile, { cameraHint: buildCameraHint(effectiveCamera), stylePrefix });
  }

  /** 构建 T2I 风格前缀：优先 styleReferencePrompt；回退用 overallAesthetic 等拼接（playbook 要求这些字段为英文，直接拼接） */
  private buildT2iStylePrefix(vs?: DramaState['visualStyle']): string | undefined {
    if (!vs) return undefined;
    const styleRef = (vs.styleReferencePrompt ?? '').trim();
    if (styleRef) return styleRef + ', ';
    const parts = [vs.overallAesthetic, vs.renderTechnique, vs.textureStyle, vs.colorGrading, vs.lightingStyle, vs.referenceStyle]
      .filter(Boolean)
      .map((p) => (p ?? '').trim())
      .filter(Boolean);
    return parts.length ? parts.join(', ') + ', ' : undefined;
  }

  /** 根据画幅比例返回 Seedream 5.0 宽高比（volcengine-image 会转换为合法像素尺寸） */
  private static resolveImageSize(aspectRatio: string): string {
    const supported = ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3'];
    return supported.includes(aspectRatio) ? aspectRatio : '16:9';
  }

  /** 按当前模型决定是否使用 negative prompt */
  private get negPrompt(): string | undefined {
    const np = this.profile.negativePrompt;
    return np.supported ? np.defaultValue : undefined;
  }

  private mergeNegativePrompt(base?: string, extra?: string): string | undefined {
    const parts = [base ?? '', extra ?? '']
      .flatMap((chunk) => chunk.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return undefined;
    return [...new Set(parts.map((p) => p.toLowerCase()))]
      .map((token) => parts.find((p) => p.toLowerCase() === token)!)
      .join(', ');
  }

  private buildEpisodeNegativePrompt(styleBucket: DramaStyleBucket): string | undefined {
    if (styleBucket !== 'live_action') return this.negPrompt;
    return this.mergeNegativePrompt(this.negPrompt, MediaOrchestratorService.LIVE_ACTION_NEGATIVE_EXTRA);
  }

  /** 完整单集媒体生成流水线（首帧+尾帧→视频→TTS→FFmpeg） */
  async generateEpisodeMedia(dramaId: string, episodeNumber: number): Promise<{ mediaStatus: EpisodeMediaStatus; shotMediaMap: Record<string, ShotMediaEntry>; videoUrl?: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode) throw new Error(`E${episodeNumber} 不存在`);
    if (!episode.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const userId = drama.userId;
    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shots: Shot[] = storyboard?.shots ?? [];
    const reviewRiskShotIds = this.extractReviewRiskShotIds(episode.review);
    const orderedShots = this.orderShotsForProduction(shots, reviewRiskShotIds);
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    // P5: 用 minorRolePool 中已有的参考图补充 charImageMap（零成本，跨集复用）
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1: 跨集常驻场景参考图
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);
    const episodeNegPrompt = this.buildEpisodeNegativePrompt(mediaPolicy.styleBucket);
    const flashbackVideoMap = await this.buildFlashbackVideoMap(dramaId, shots);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = MediaOrchestratorService.resolveImageSize(aspectRatio);
    const t2iStylePrefix = this.buildT2iStylePrefix(state.visualStyle);
    this.logger.log(
      `[policy] E${episodeNumber} mode=${mediaPolicy.mode} style=${mediaPolicy.styleBucket} ` +
      `t2i=${mediaPolicy.t2iConcurrency} i2v=${mediaPolicy.i2vConcurrency} ` +
      `retry=${mediaPolicy.maxMediaRetries} gate=${mediaPolicy.enableQualityGate ? 'on' : 'off'} ` +
      `coherence=${mediaPolicy.enableCoherenceValidation ? 'on' : 'off'}`,
    );
    this.logShotOrder(`E${episodeNumber}`, orderedShots);
    const withMediaRetry = <T>(fn: () => Promise<T>, label: string) =>
      this.withRetry(fn, label, mediaPolicy.maxMediaRetries, mediaPolicy.retryBaseDelayMs);

    const raw = episode.shotMediaMap ?? {};
    const shotMediaMap: Record<string, ShotMediaEntry> = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, { ...v, status: v.status ?? 'unknown' }]),
    );

    const hasT2I = !this.skipImageGen;
    const totalPhases = (hasT2I ? shots.length * 2 : 0) + shots.length * 2 + 1; // 首帧+尾帧+视频+TTS+合成
    let phaseOff = 0;
    const emit = (i: number, msg: string, done = false) =>
      this.progressService.emit({ dramaId, runType: 'media', episodeNumber, step: `media_${i}`, stepIndex: i, totalSteps: totalPhases, message: msg, done });

    try {
      const scriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
      const sceneMap = new Map(scriptScenes.map(s => [s.sceneId, s]));
      const shotMediaParamsCache = new Map<string, ReturnType<EmotionMediaMapperService['mapShotToMediaParams']>>();
      for (const shot of shots) {
        shotMediaParamsCache.set(shot.shotId, this.emotionMapper.mapShotToMediaParams(shot, sceneMap.get(shot.sceneId)));
      }

      if (hasT2I) {
        // ═══ Phase 0: T2I 首帧 + 尾帧（并发池） ═══
        await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
        const sceneCache = new Map<string, string>();
        // B3: 用持久化的常驻场景图预填充，避免跨集重复生成背景
        for (const [locationId, imageUrl] of locationImageMap) {
          sceneCache.set(locationId, imageUrl);
        }
        const prevFrameCache = new Map<number, string>();
        let frameDirty = 0;
        const flushFirstFrames = async (force = false) => {
          frameDirty++;
          if (force || frameDirty >= mediaPolicy.dbFlushEvery) {
            await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
            frameDirty = 0;
          }
        };

        await this.runConcurrent(orderedShots, Math.min(mediaPolicy.t2iConcurrency, this.t2iMaxConcurrency), async (shot, i) => {
          const sid = shot.shotId;
          if (shot.isFlashback || shot.isPreview) { emit(phaseOff + i, `${sid} 跳过T2I`, true); return; }

          const mediaParams = shotMediaParamsCache.get(sid);
          const emotionColorHint = mediaParams?.colorGrade;
          const shotPolicy = this.resolveShotRunPolicy(shot, mediaPolicy.mode, mediaPolicy.styleBucket);
          // 在 Shot 级别预先确定 Provider，首帧/尾帧保持一致
          const shotRoute = this.imageRouter.routeShot({
            qualityTier: shot.qualityTier,
            shotSize: shot.camera?.shotSize,
            cameraAngle: shot.camera?.cameraAngle,
            isGolden: shot.isPreview || shot.qualityTier === 'golden',
            size: imgSize,
          });

          if (!shotMediaMap[sid]?.imageUrl) {
            try {
              emit(phaseOff + i, `${sid} 首帧生成中...`);
              const styleLockedPrompt = this.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
              const rawPrompt = this.assemblePrompt(styleLockedPrompt, shot.camera, t2iStylePrefix, false);
              const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
                shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                qualityTier: shot.qualityTier ?? 'standard',
                shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint,
                routeProfile: shotPolicy.routeProfile,
                provider: shotRoute.provider,
              });
              const refs = this.buildRefImages(
                shot,
                charImageMap,
                variationImageMap,
                characterAnchorMap,
                styleRefImages,
                sceneCache,
                prevFrameCache,
                'first',
              );

              const tier = this.normalizeQualityTier(shot.qualityTier);
              const shouldUseQualityGate = this.shouldUseQualityGate(
                mediaPolicy.enableQualityGate,
                tier,
                shotPolicy.gateMaxAttempts,
                shotPolicy.candidateCount,
              );
              const genFn = async (prevAssessment?: QualityAssessment) => {
                const fixHint = prevAssessment?.recommendedFix;
                const retryNeg = fixHint ? this.buildFixNegativeHint(fixHint, prevAssessment?.issues) : '';
                const effectiveNeg = retryNeg ? [optimized.negativePrompt, retryNeg].filter(Boolean).join(', ') : (optimized.negativePrompt || undefined);
                const res = await withMediaRetry(async () => {
                  await this.acquireT2iSlot();
                  return this.mediaService.generateImage({
                    prompt: optimized.prompt, negativePrompt: effectiveNeg,
                    size: imgSize, count: 1, referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: sid, userId, episodeNumber,
                    ...shotRoute,
                  });
                }, `${sid} 首帧`);
                return res.images?.[0]?.url ?? '';
              };

              let imgUrl: string;
              let gateQc: ShotMediaEntry['qc'] | undefined;
              if (shouldUseQualityGate) {
                const characterRefs = this.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
                const gateResult = await this.qualityGate.generateWithQualityGate(genFn, {
                  maxAttempts: shotPolicy.gateMaxAttempts,
                  minScore: shotPolicy.gateMinScore,
                  qualityTier: tier, prompt: optimized.prompt,
                  characterRefs,
                  styleRefs: styleRefImages,
                  candidateCount: shotPolicy.candidateCount,
                  dramaId, userId, episodeNumber,
                });
                imgUrl = gateResult.imageUrl;
                gateQc = {
                  identityScore: gateResult.assessment.faceConsistencyScore,
                  styleScore: gateResult.assessment.styleConsistencyScore,
                  readabilityScore: gateResult.assessment.readabilityScore,
                  score: gateResult.score,
                  passed: gateResult.score >= shotPolicy.gateMinScore,
                  attempts: gateResult.attempts,
                  issues: gateResult.assessment.issues,
                  failReasons: gateResult.assessment.failReasons,
                  recommendedFix: gateResult.assessment.recommendedFix,
                };
                if (gateResult.attempts > 1) this.logger.log(`${sid} 质量关卡: score=${gateResult.score} attempts=${gateResult.attempts}`);
              } else {
                imgUrl = await genFn();
              }

              if (imgUrl) {
                shotMediaMap[sid] = {
                  ...shotMediaMap[sid],
                  imageUrl: imgUrl,
                  status: shotMediaMap[sid]?.status ?? 'image_done',
                  qc: gateQc ?? shotMediaMap[sid]?.qc,
                  t2iPrompt: optimized.prompt,
                  t2iNegativePrompt: optimized.negativePrompt || undefined,
                };
                if (shot.sceneId && !sceneCache.has(shot.sceneId)) {
                  sceneCache.set(shot.sceneId, imgUrl);
                  // B2: isRecurring 场景第一次生成时，持久化到 VisualAssetEntity 供后续集复用
                  if (!locationImageMap.has(shot.sceneId)) {
                    const loc = state.locations?.find(l => l.locationId === shot.sceneId);
                    if (loc?.isRecurring) {
                      locationImageMap.set(shot.sceneId, imgUrl);
                      this.saveLocationImage(dramaId, shot.sceneId, loc.name, imgUrl).catch(e =>
                        this.logger.warn(`场景图持久化失败 ${shot.sceneId}: ${(e as Error).message}`));
                    }
                  }
                }
                prevFrameCache.set(shot.shotIndex, imgUrl);
                try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, sid)); } catch {}
              }
              emit(phaseOff + i, `${sid} 首帧完成`, true);
            } catch (err) { this.logger.warn(`${sid} 首帧失败: ${(err as Error).message}`); }
          } else {
            if (shot.sceneId && !sceneCache.has(shot.sceneId)) sceneCache.set(shot.sceneId, shotMediaMap[sid].imageUrl!);
            prevFrameCache.set(shot.shotIndex, shotMediaMap[sid].imageUrl!);
          }

          if (shot.lastFramePrompt && !shotMediaMap[sid]?.lastFrameImageUrl) {
            try {
              emit(phaseOff + orderedShots.length + i, `${sid} 尾帧生成中...`);
              const lastRefs = this.buildRefImages(
                shot,
                charImageMap,
                variationImageMap,
                characterAnchorMap,
                styleRefImages,
                sceneCache,
                prevFrameCache,
                'last',
              );
              const styleLockedLastPrompt = this.applyStyleLockPrompt(shot.lastFramePrompt!, shot, state);
              const rawLastPrompt = this.assemblePrompt(styleLockedLastPrompt, shot.camera, t2iStylePrefix, true);
              const optLast = this.promptOptimizer.optimizeForT2I(rawLastPrompt, episodeNegPrompt ?? '', {
                shotType: 'last_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                qualityTier: shot.qualityTier ?? 'standard', emotionColorHint,
                shotSize: shot.camera?.shotSizeEnd ?? shot.camera?.shotSize,
                cameraAngle: shot.camera?.cameraAngle,
                routeProfile: shotPolicy.routeProfile,
                provider: shotRoute.provider,
              });
              const res = await withMediaRetry(async () => {
                await this.acquireT2iSlot();
                return this.mediaService.generateImage({
                  prompt: optLast.prompt, negativePrompt: optLast.negativePrompt || undefined,
                  size: imgSize, count: 1, referenceImages: lastRefs, dramaId, assetType: 'shot_last_frame', refId: `${sid}_last`, userId, episodeNumber,
                  ...shotRoute,
                });
              }, `${sid} 尾帧`);
              const lastUrl = res.images?.[0]?.url ?? '';
              if (lastUrl) shotMediaMap[sid] = { ...shotMediaMap[sid], lastFrameImageUrl: lastUrl, lastFrameT2iPrompt: optLast.prompt };
              emit(phaseOff + orderedShots.length + i, `${sid} 尾帧完成`, true);
            } catch (err) { this.logger.warn(`${sid} 尾帧失败: ${(err as Error).message}`); }
          }
          await flushFirstFrames();
        });
        await flushFirstFrames(true);
        // P5: T2I 完成后，将池角色的最佳生成图写回 minorRolePool（内存操作，由 updateDramaState 统一落库）
        await this.updatePoolReferenceImages(state, shots, shotMediaMap);
        phaseOff += shots.length * 2;
      }

      // ═══ Phase 0.5: 镜头连贯性验证 + 自动重生成 flagged shots ═══
      if (hasT2I && mediaPolicy.enableCoherenceValidation) {
        try {
          await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
          const coherence = await this.coherenceValidator.validateEpisodeCoherence(dramaId, episodeNumber);
          if (coherence.flaggedShots.length > 0) {
            this.logger.warn(`E${episodeNumber} 连贯性标记 ${coherence.flaggedShots.length} 个Shot，自动重生成: ${coherence.flaggedShots.join(', ')}`);
            const flaggedSet = new Set(coherence.flaggedShots);
            const sceneCache = new Map<string, string>();
            const prevFrameCache = new Map<number, string>();
            for (const s of shots) {
              if (shotMediaMap[s.shotId]?.imageUrl && !flaggedSet.has(s.shotId)) {
                prevFrameCache.set(s.shotIndex, shotMediaMap[s.shotId].imageUrl!);
                if (s.sceneId && !sceneCache.has(s.sceneId)) sceneCache.set(s.sceneId, shotMediaMap[s.shotId].imageUrl!);
              }
            }
            const flaggedShots = this.orderShotsForProduction(shots.filter(s => flaggedSet.has(s.shotId)), reviewRiskShotIds);
            for (const shot of flaggedShots) {
              const sid = shot.shotId;
              const shotPolicy = this.resolveShotRunPolicy(shot, mediaPolicy.mode, mediaPolicy.styleBucket);
              try {
                const mediaParams = shotMediaParamsCache.get(sid);
                const regenRoute = this.imageRouter.routeShot({
                  qualityTier: shot.qualityTier, shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle,
                  isGolden: shot.isPreview || shot.qualityTier === 'golden', size: imgSize,
                });
                const styleLockedPrompt = this.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
                const rawPrompt = this.assemblePrompt(styleLockedPrompt, shot.camera, t2iStylePrefix, false);
                const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
                  shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                  qualityTier: shot.qualityTier ?? 'standard',
                  shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams?.colorGrade,
                  routeProfile: shotPolicy.routeProfile,
                  provider: regenRoute.provider,
                });
                const refs = this.buildRefImages(
                  shot,
                  charImageMap,
                  variationImageMap,
                  characterAnchorMap,
                  styleRefImages,
                  sceneCache,
                  prevFrameCache,
                  'first',
                );
                const res = await withMediaRetry(async () => {
                  await this.acquireT2iSlot();
                  return this.mediaService.generateImage({
                    prompt: optimized.prompt, negativePrompt: optimized.negativePrompt || undefined,
                    size: imgSize, count: 1, referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: `${sid}_regen`, userId, episodeNumber,
                    ...regenRoute,
                  });
                }, `${sid} 连贯性重生成`);
                const newUrl = res.images?.[0]?.url ?? '';
                if (newUrl) {
                  shotMediaMap[sid] = { ...shotMediaMap[sid], imageUrl: newUrl, status: 'image_done', t2iPrompt: optimized.prompt, t2iNegativePrompt: optimized.negativePrompt || undefined };
                  prevFrameCache.set(shot.shotIndex, newUrl);
                  if (shot.sceneId) sceneCache.set(shot.sceneId, newUrl);
                  this.logger.log(`${sid} 连贯性重生成完成`);
                }
              } catch (err) { this.logger.warn(`${sid} 连贯性重生成失败: ${(err as Error).message}`); }
            }
            await this.updateMedia(episode.id, 'generating_first_frames', shotMediaMap);
          }
        } catch (err) { this.logger.warn(`连贯性验证降级: ${(err as Error).message}`); }
      }

      // ═══ Phase 1: I2V / T2V 视频生成（镜头运动 + 情绪色调 + 动态分辨率） ═══
      await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);
      let videoSubmitDirty = 0;
      const flushVideoSubmit = async (force = false) => {
        videoSubmitDirty++;
        if (force || videoSubmitDirty >= mediaPolicy.dbFlushEvery) {
          await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);
          videoSubmitDirty = 0;
        }
      };
      await this.runConcurrent(orderedShots, mediaPolicy.i2vConcurrency, async (shot, i) => {
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
          const lastFrame = shotMediaMap[sid]?.lastFrameImageUrl;
          if (lastFrame) refImages.push({ url: lastFrame, role: 'last_frame' });
          this.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap).forEach(url => refImages.push({ url, role: 'character' }));
          styleRefImages.slice(0, 1).forEach((url) => refImages.push({ url, role: 'style' }));

          const mediaParams = shotMediaParamsCache.get(sid);
          const shotPolicy = this.resolveShotRunPolicy(shot, mediaPolicy.mode, mediaPolicy.styleBucket);
          const styleLockedVideoPrompt = this.applyStyleLockPrompt(shot.visualPrompt, shot, state);
          const optVideo = this.promptOptimizer.optimizeForT2V(styleLockedVideoPrompt, {
            duration: shot.estimatedDurationSec,
            hasFirstFrame: !!firstFrame,
            hasLastFrame: !!lastFrame,
            specialTechnique: shot.specialTechnique ?? undefined,
            cameraMovement: shot.camera?.movement,
            shotSize: shot.camera?.shotSize,
            cameraAngle: shot.camera?.cameraAngle,
            emotionColorHint: mediaParams?.colorGrade,
            routeProfile: shotPolicy.routeProfile,
          });

          const videoQuality = shotPolicy.videoQuality;
          const sub = await withMediaRetry(() => this.mediaService.submitVideo({
            prompt: optVideo.prompt,
            duration: Math.min(Math.max(Math.round(shot.estimatedDurationSec), 2), 10),
            quality: videoQuality, aspectRatio: aspectRatio as any,
            referenceImages: refImages, dramaId, assetType: 'shot_video', refId: sid, userId, episodeNumber,
          }), `${sid} 视频`);
          shotMediaMap[sid] = { ...shotMediaMap[sid], videoJobId: sub.jobId, status: 'submitted' };
          await flushVideoSubmit();
        } catch (err) {
          this.logger.error(`${sid} 视频提交失败: ${(err as Error).message}`);
          const fallbackImage = shotMediaMap[sid]?.imageUrl;
          if (fallbackImage) {
            this.logger.warn(`${sid} I2V降级: 使用首帧 Ken Burns 代替视频`);
            shotMediaMap[sid] = { ...shotMediaMap[sid], videoUrl: fallbackImage, status: 'completed', kenBurnsFallback: true };
          } else {
            shotMediaMap[sid] = { ...shotMediaMap[sid], status: 'failed' };
          }
          await flushVideoSubmit();
        }
      });
      await flushVideoSubmit(true);
      await this.awaitVideoJobs(shotMediaMap, orderedShots, dramaId, episode.id, phaseOff, emit);
      phaseOff += shots.length;

      // ═══ Phase 2: TTS 语音合成（EmotionMediaMapper 驱动速度/音量 + 时长同步） ═══
      const ttsDurations = new Map<string, number>();
      let ttsOk = false;
      try { this.registry.getTtsProvider(); ttsOk = true; } catch {}
      if (ttsOk) {
        const TTS_MAX_RETRIES = 2;
        const FALLBACK_VOICE_ID = '';
        const voiceMap = new Map(state.characters?.map(c => [c.characterId, c.voiceProfile]) ?? []);
        for (let i = 0; i < orderedShots.length; i++) {
          const shot = orderedShots[i];
          if (!shot.dialogue?.text || shot.isPreview) continue;
          if (shotMediaMap[shot.shotId]?.ttsUrl) continue;
          const voice = voiceMap.get(shot.dialogue.characterId);
          const mediaParams = shotMediaParamsCache.get(shot.shotId);
          const baseSpeed = SPEED_MAP[voice?.speed ?? 'normal'] ?? 1.0;
          const ttsSpeed = baseSpeed * (mediaParams?.ttsSpeedMultiplier ?? 1.0);
          emit(phaseOff + i, `${shot.shotId} TTS...`);
          const outPath = this.storage.ttsOutputPath(dramaId, shot.shotId);

          let ttsSuccess = false;
          for (let attempt = 0; attempt <= TTS_MAX_RETRIES && !ttsSuccess; attempt++) {
            const useVoiceId = attempt <= TTS_MAX_RETRIES - 1
              ? (voice?.ttsVoiceId || '')
              : (FALLBACK_VOICE_ID || voice?.ttsVoiceId || '');
            try {
              const ttsRes = await this.mediaService.synthesizeTtsToFile({
                request: {
                  text: shot.dialogue.text, voiceId: useVoiceId,
                  speed: ttsSpeed, emotion: mediaParams?.ttsEmotion || shot.dialogue.emotion,
                  extra: { volume: shot.dialogue.volume, volumeMultiplier: mediaParams?.ttsVolumeMultiplier },
                },
                outputPath: outPath,
                dramaId, userId, episodeNumber: episode.episodeNumber,
              });
              shotMediaMap[shot.shotId] = { ...shotMediaMap[shot.shotId], ttsUrl: ttsRes.audioUrl };
              if (ttsRes.durationSeconds > 0) ttsDurations.set(shot.shotId, ttsRes.durationSeconds);
              ttsSuccess = true;
              emit(phaseOff + i, `${shot.shotId} TTS完成`, true);
            } catch (err) {
              if (attempt < TTS_MAX_RETRIES) {
                this.logger.warn(`${shot.shotId} TTS第${attempt + 1}次失败，重试: ${(err as Error).message}`);
              } else {
                this.logger.warn(`${shot.shotId} TTS最终失败(${TTS_MAX_RETRIES + 1}次尝试): ${(err as Error).message}`);
              }
            }
          }
        }
      } else { this.logger.warn('TTS Provider 未配置，跳过语音合成'); }
      await this.updateMedia(episode.id, 'generating_videos', shotMediaMap);

      // ═══ Phase 3: FFmpeg 合成（TTS 时长同步 + per-shot 后处理参数） ═══
      let videoUrl = '';
      if (this.composer.isAvailable()) {
        try {
          emit(totalPhases - 1, '合成完整单集视频...');
          await this.updateMedia(episode.id, 'compositing', shotMediaMap);
          const composeShots: ComposeShotInput[] = shots.filter(s => shotMediaMap[s.shotId]?.videoUrl).map(s => {
            const mp = shotMediaParamsCache.get(s.shotId);
            const ttsDur = ttsDurations.get(s.shotId);
            let effectiveDuration = s.estimatedDurationSec;
            let speedFactor = mp?.speedFactor ?? 1.0;
            if (ttsDur && ttsDur > effectiveDuration * 1.1) {
              const ratio = ttsDur / effectiveDuration;
              if (ratio <= 1.5) {
                speedFactor = speedFactor / ratio;
                effectiveDuration = ttsDur;
                this.logger.debug(`${s.shotId} 视频减速 ${ratio.toFixed(2)}x 以匹配 TTS (${ttsDur.toFixed(1)}s > ${s.estimatedDurationSec}s)`);
              } else {
                effectiveDuration = ttsDur;
                this.logger.debug(`${s.shotId} TTS过长(${ttsDur.toFixed(1)}s)，保持原速但扩展时长`);
              }
            }
            return {
              shotId: s.shotId, videoPath: shotMediaMap[s.shotId].videoUrl!,
              ttsAudioPath: shotMediaMap[s.shotId]?.ttsUrl, durationSec: effectiveDuration,
              transition: s.transitionToNext ?? 'cut',
              transitionDurationSec: mp?.transitionDurationSec,
              subtitle: s.subtitle ? { text: s.subtitle.text, style: s.subtitle.style ?? 'normal' } : undefined,
              bgmPath: s.audio?.bgm?.mood ? (this.audioResource.resolveBgm(s.audio.bgm.mood) ?? undefined) : undefined,
              bgmIntensity: (s.audio?.bgm?.intensity ?? 0.3) * (mp?.bgmVolumeMultiplier ?? 1.0),
              bgmAction: s.audio?.bgm?.action,
              sfxPaths: s.audio?.sfx?.map(fx => this.audioResource.resolveSfx(fx.sound)).filter(Boolean) as string[],
              ambiencePath: s.audio?.ambience ? (this.audioResource.resolveAmbience(s.audio.ambience) ?? undefined) : undefined,
              postProcess: mp ? {
                colorGrade: mp.colorGrade,
                speedFactor,
                stabilize: mp.stabilize,
                kenBurns: shotMediaMap[s.shotId]?.kenBurnsFallback ? { direction: 'zoom_in' as const, zoomFactor: 1.1 } : mp.kenBurns,
                specialTechnique: s.specialTechnique ?? undefined,
              } : shotMediaMap[s.shotId]?.kenBurnsFallback ? {
                kenBurns: { direction: 'zoom_in' as const, zoomFactor: 1.1 },
              } : undefined,
            };
          });
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

  /**
   * 单镜图片生成 — 仅生成指定 Shot 的首帧图，同步返回 imageUrl。
   * 用于制作台"逐 Shot 手动触发"场景；前端等待 HTTP 响应即可，无需 SSE。
   */
  async generateShotImage(dramaId: string, episodeNumber: number, shotId: string): Promise<{ imageUrl: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shot = storyboard.shots?.find((s: Shot) => s.shotId === shotId);
    if (!shot) throw new Error(`Shot ${shotId} 不存在`);

    if (this.skipImageGen) {
      this.logger.warn(`[skipImageGen] ${shotId} 跳过图片生成`);
      return { imageUrl: '' };
    }

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const userId = drama.userId;
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);
    const episodeNegPrompt = this.buildEpisodeNegativePrompt(mediaPolicy.styleBucket);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = MediaOrchestratorService.resolveImageSize(aspectRatio);

    const charImageMap = await this.buildCharacterImageMap(dramaId);
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);

    // 用已有媒体填充场景 & 前帧缓存，以保持视觉连贯性
    const raw = episode.shotMediaMap ?? {};
    const sceneCache = new Map<string, string>();
    // B3: 先用持久化场景图预填充（跨集一致性），再用当集已有图片覆盖
    for (const [locationId, imageUrl] of locationImageMap) {
      sceneCache.set(locationId, imageUrl);
    }
    const prevFrameCache = new Map<number, string>();
    for (const s of storyboard.shots ?? []) {
      if (s.shotIndex < shot.shotIndex && raw[s.shotId]?.imageUrl) {
        prevFrameCache.set(s.shotIndex, raw[s.shotId].imageUrl!);
        if (s.sceneId && !sceneCache.has(s.sceneId)) sceneCache.set(s.sceneId, raw[s.shotId].imageUrl!);
      }
    }

    const scriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
    const sceneForShot = scriptScenes.find(s => s.sceneId === shot.sceneId);
    const t2iStylePrefix = this.buildT2iStylePrefix(state.visualStyle);
    const mediaParams = this.emotionMapper.mapShotToMediaParams(shot, sceneForShot);
    const shotPolicy = this.resolveShotRunPolicy(shot, mediaPolicy.mode, mediaPolicy.styleBucket);
    const singleShotRoute = this.imageRouter.routeShot({
      qualityTier: shot.qualityTier,
      shotSize: shot.camera?.shotSize,
      cameraAngle: shot.camera?.cameraAngle,
      isGolden: shot.isPreview || shot.qualityTier === 'golden',
      size: imgSize,
    });
    const styleLockedPrompt = this.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
    const rawPrompt = this.assemblePrompt(styleLockedPrompt, shot.camera, t2iStylePrefix, false);
    const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
      shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
      qualityTier: shot.qualityTier ?? 'standard',
      shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams.colorGrade,
      routeProfile: shotPolicy.routeProfile,
      provider: singleShotRoute.provider,
    });
    const refs = this.buildRefImages(
      shot,
      charImageMap,
      variationImageMap,
      characterAnchorMap,
      styleRefImages,
      sceneCache,
      prevFrameCache,
      'first',
    );
    const genFn = async () => {
      const res = await this.withRetry(
        async () => {
          await this.acquireT2iSlot();
          return this.mediaService.generateImage({
            prompt: optimized.prompt, negativePrompt: optimized.negativePrompt || undefined, size: imgSize, count: 1,
            referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: shotId, userId, episodeNumber,
            ...singleShotRoute,
          });
        },
        `${shotId} 图片`,
        mediaPolicy.maxMediaRetries,
        mediaPolicy.retryBaseDelayMs,
      );
      return res.images?.[0]?.url ?? '';
    };
    const tier = this.normalizeQualityTier(shot.qualityTier);
    const shouldUseQualityGate = this.shouldUseQualityGate(
      mediaPolicy.enableQualityGate,
      tier,
      shotPolicy.gateMaxAttempts,
      shotPolicy.candidateCount,
    );

    let imgUrl = '';
    let gateQc: ShotMediaEntry['qc'] | undefined;
    if (shouldUseQualityGate) {
      const characterRefs = this.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
      const gateResult = await this.qualityGate.generateWithQualityGate(genFn, {
        maxAttempts: shotPolicy.gateMaxAttempts,
        minScore: shotPolicy.gateMinScore,
        qualityTier: tier,
        prompt: optimized.prompt,
        characterRefs,
        styleRefs: styleRefImages,
        candidateCount: shotPolicy.candidateCount,
        dramaId, userId, episodeNumber,
      });
      imgUrl = gateResult.imageUrl;
      gateQc = {
        identityScore: gateResult.assessment.faceConsistencyScore,
        styleScore: gateResult.assessment.styleConsistencyScore,
        readabilityScore: gateResult.assessment.readabilityScore,
        score: gateResult.score,
        passed: gateResult.score >= shotPolicy.gateMinScore,
        attempts: gateResult.attempts,
        issues: gateResult.assessment.issues,
        failReasons: gateResult.assessment.failReasons,
        recommendedFix: gateResult.assessment.recommendedFix,
      };
    } else {
      imgUrl = await genFn();
    }

    if (imgUrl) {
      const newMap = {
        ...raw,
        [shotId]: {
          ...raw[shotId],
          imageUrl: imgUrl,
          status: 'image_done',
          qc: gateQc ?? raw[shotId]?.qc,
          t2iPrompt: optimized.prompt,
          t2iNegativePrompt: optimized.negativePrompt || undefined,
        },
      };
      await this.episodeRepo.update(episode.id, { shotMediaMap: newMap });
      try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, shotId)); } catch {}
      this.logger.log(`[ShotImage] ${shotId} → ${imgUrl}`);
    }
    return { imageUrl: imgUrl };
  }

  /**
   * 批量图片生成（仅 Phase 0: T2I 首帧）— 不生成视频，用于制作台"批量生成全部图片"。
   * 通过 DramaProgressService 推送 phase='images' 的 SSE 事件。
   */
  async generateEpisodeImages(dramaId: string, episodeNumber: number): Promise<void> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const userId = drama.userId;
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);
    const episodeNegPrompt = this.buildEpisodeNegativePrompt(mediaPolicy.styleBucket);
    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shots: Shot[] = storyboard?.shots ?? [];
    const reviewRiskShotIds = this.extractReviewRiskShotIds(episode.review);
    const orderedShots = this.orderShotsForProduction(shots, reviewRiskShotIds);
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = MediaOrchestratorService.resolveImageSize(aspectRatio);
    const t2iStylePrefix = this.buildT2iStylePrefix(state.visualStyle);
    const imgScriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
    const imgSceneMap = new Map(imgScriptScenes.map(s => [s.sceneId, s]));

    const raw = episode.shotMediaMap ?? {};
    const shotMediaMap: Record<string, ShotMediaEntry> = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, { ...v, status: v.status ?? 'unknown' }]),
    );

    const sceneCache = new Map<string, string>();
    // B3: 用持久化的常驻场景图预填充
    for (const [locationId, imageUrl] of locationImageMap) {
      sceneCache.set(locationId, imageUrl);
    }
    const prevFrameCache = new Map<number, string>();
    const needsGen = orderedShots.filter(s => !s.isFlashback && !s.isPreview && !shotMediaMap[s.shotId]?.imageUrl);
    const totalSteps = needsGen.length;
    let done = 0;

    const emit = (msg: string, isDone = false) =>
      this.progressService.emit({ dramaId, runType: 'images', episodeNumber, step: `img_batch`, stepIndex: done, totalSteps, message: msg, done: isDone });

    emit(`开始生成 ${totalSteps} 张分镜图...`);
    this.logger.log(
      `[policy] images E${episodeNumber} mode=${mediaPolicy.mode} style=${mediaPolicy.styleBucket} ` +
      `t2i=${mediaPolicy.t2iConcurrency} retry=${mediaPolicy.maxMediaRetries}`,
    );
    this.logShotOrder(`E${episodeNumber} images`, needsGen);

    // Pre-fill caches from existing media (在 locationImageMap 之后，优先用当集已生成图片覆盖场景缓存)
    for (const s of shots) {
      if (shotMediaMap[s.shotId]?.imageUrl) {
        prevFrameCache.set(s.shotIndex, shotMediaMap[s.shotId].imageUrl!);
        if (s.sceneId && !sceneCache.has(s.sceneId)) sceneCache.set(s.sceneId, shotMediaMap[s.shotId].imageUrl!);
      }
    }

    if (this.skipImageGen) {
      emit(`skipImageGen: 跳过图片生成`, true);
      return;
    }

    let imageDirty = 0;
    const flushImages = async (force = false) => {
      imageDirty++;
      if (force || imageDirty >= mediaPolicy.dbFlushEvery) {
        await this.episodeRepo.update(episode.id, { shotMediaMap });
        imageDirty = 0;
      }
    };

    await this.runConcurrent(needsGen, Math.min(mediaPolicy.t2iConcurrency, this.t2iMaxConcurrency), async (shot) => {
      const sid = shot.shotId;
      const shotPolicy = this.resolveShotRunPolicy(shot, mediaPolicy.mode, mediaPolicy.styleBucket);
      try {
        emit(`${sid} 生成中...`);
        const batchShotRoute = this.imageRouter.routeShot({
          qualityTier: shot.qualityTier, shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle,
          isGolden: shot.isPreview || shot.qualityTier === 'golden', size: imgSize,
        });
        const mediaParams = this.emotionMapper.mapShotToMediaParams(shot, imgSceneMap.get(shot.sceneId));
        const styleLockedPrompt = this.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
        const rawPrompt = this.assemblePrompt(styleLockedPrompt, shot.camera, t2iStylePrefix, false);
        const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
          shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
          qualityTier: shot.qualityTier ?? 'standard',
          shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams.colorGrade,
          routeProfile: shotPolicy.routeProfile,
          provider: batchShotRoute.provider,
        });
        const refs = this.buildRefImages(
          shot,
          charImageMap,
          variationImageMap,
          characterAnchorMap,
          styleRefImages,
          sceneCache,
          prevFrameCache,
          'first',
        );
        const genFn = async () => {
          const res = await this.withRetry(
            async () => {
              await this.acquireT2iSlot();
              return this.mediaService.generateImage({
                prompt: optimized.prompt, negativePrompt: optimized.negativePrompt || undefined,
                size: imgSize, count: 1, referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: sid, userId, episodeNumber,
                ...batchShotRoute,
              });
            },
            `${sid} 图片`,
            mediaPolicy.maxMediaRetries,
            mediaPolicy.retryBaseDelayMs,
          );
          return res.images?.[0]?.url ?? '';
        };
        const tier = this.normalizeQualityTier(shot.qualityTier);
        const shouldUseQualityGate = this.shouldUseQualityGate(
          mediaPolicy.enableQualityGate,
          tier,
          shotPolicy.gateMaxAttempts,
          shotPolicy.candidateCount,
        );
        let imgUrl = '';
        let gateQc: ShotMediaEntry['qc'] | undefined;
        if (shouldUseQualityGate) {
          const characterRefs = this.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
          const gateResult = await this.qualityGate.generateWithQualityGate(genFn, {
            maxAttempts: shotPolicy.gateMaxAttempts,
            minScore: shotPolicy.gateMinScore,
            qualityTier: tier,
            prompt: optimized.prompt,
            characterRefs,
            styleRefs: styleRefImages,
            candidateCount: shotPolicy.candidateCount,
            dramaId, userId, episodeNumber,
          });
          imgUrl = gateResult.imageUrl;
          gateQc = {
            identityScore: gateResult.assessment.faceConsistencyScore,
            styleScore: gateResult.assessment.styleConsistencyScore,
            readabilityScore: gateResult.assessment.readabilityScore,
            score: gateResult.score,
            passed: gateResult.score >= shotPolicy.gateMinScore,
            attempts: gateResult.attempts,
            issues: gateResult.assessment.issues,
            failReasons: gateResult.assessment.failReasons,
            recommendedFix: gateResult.assessment.recommendedFix,
          };
        } else {
          imgUrl = await genFn();
        }
        if (imgUrl) {
          shotMediaMap[sid] = {
            ...shotMediaMap[sid],
            imageUrl: imgUrl,
            status: 'image_done',
            qc: gateQc ?? shotMediaMap[sid]?.qc,
            t2iPrompt: optimized.prompt,
            t2iNegativePrompt: optimized.negativePrompt || undefined,
          };
          if (shot.sceneId && !sceneCache.has(shot.sceneId)) {
            sceneCache.set(shot.sceneId, imgUrl);
            // B2: isRecurring 场景持久化
            if (!locationImageMap.has(shot.sceneId)) {
              const loc = state.locations?.find(l => l.locationId === shot.sceneId);
              if (loc?.isRecurring) {
                locationImageMap.set(shot.sceneId, imgUrl);
                this.saveLocationImage(dramaId, shot.sceneId, loc.name, imgUrl).catch(e =>
                  this.logger.warn(`场景图持久化失败 ${shot.sceneId}: ${(e as Error).message}`));
              }
            }
          }
          prevFrameCache.set(shot.shotIndex, imgUrl);
          try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, sid)); } catch {}
        }
        done++;
        emit(`${sid} 完成 (${done}/${totalSteps})`, done >= totalSteps);
      } catch (err) {
        this.logger.warn(`${sid} 图片失败: ${(err as Error).message}`);
        emit(`${sid} 失败: ${(err as Error).message}`);
      }
      await flushImages();
    });

    await flushImages(true);
    await this.episodeRepo.update(episode.id, { shotMediaMap });
    this.logger.log(`E${episodeNumber} 图片阶段完成: ${Object.values(shotMediaMap).filter(v => v.imageUrl).length}/${shots.length}`);
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

  private orderShotsForProduction(shots: Shot[], riskShotIds?: Set<string>): Shot[] {
    return [...shots].sort((a, b) => this.compareShotPriority(a, b, riskShotIds));
  }

  private compareShotPriority(a: Shot, b: Shot, riskShotIds?: Set<string>): number {
    const riskDiff = Number(riskShotIds?.has(b.shotId)) - Number(riskShotIds?.has(a.shotId));
    if (riskDiff !== 0) return riskDiff;

    const regenDiff = this.priorityScore(b.regenPriority) - this.priorityScore(a.regenPriority);
    if (regenDiff !== 0) return regenDiff;

    const masterDiff = Number(b.isMasterShot) - Number(a.isMasterShot);
    if (masterDiff !== 0) return masterDiff;

    const tierDiff = this.qualityTierScore(b.qualityTier) - this.qualityTierScore(a.qualityTier);
    if (tierDiff !== 0) return tierDiff;

    const typeDiff = this.shotTypeScore(b.shotType) - this.shotTypeScore(a.shotType);
    if (typeDiff !== 0) return typeDiff;

    return a.shotIndex - b.shotIndex;
  }

  private extractReviewRiskShotIds(review: unknown): Set<string> {
    const root = (review && typeof review === 'object') ? (review as Record<string, unknown>) : {};
    const ids = new Set<string>();
    const pick = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const shotId = (item as Record<string, unknown>).shotId;
        if (typeof shotId === 'string' && shotId.trim()) ids.add(shotId);
      }
    };
    pick(root.consistencyRiskShots);
    pick(root.cameraReadabilityRiskShots);
    return ids;
  }

  private priorityScore(priority?: Shot['regenPriority']): number {
    if (priority === 'high') return 3;
    if (priority === 'low') return 1;
    return 2;
  }

  private qualityTierScore(tier?: Shot['qualityTier']): number {
    if (tier === 'golden') return 3;
    if (tier === 'filler') return 1;
    return 2;
  }

  private shotTypeScore(shotType?: Shot['shotType']): number {
    if (shotType === 'action') return 3;
    if (shotType === 'dialogue') return 3;
    if (shotType === 'wide') return 2;
    if (shotType === 'portrait') return 2;
    if (shotType === 'insert') return 1;
    return 2;
  }

  private logShotOrder(tag: string, shots: Shot[]): void {
    if (!shots.length) return;
    const top = shots.slice(0, 10).map((s) => {
      const master = s.isMasterShot ? '*' : '';
      return `${s.shotId}[${s.regenPriority || 'medium'}${master}/${s.qualityTier || 'standard'}]`;
    }).join(', ');
    this.logger.log(`[scheduler] ${tag} order(top${Math.min(10, shots.length)}): ${top}`);
  }

  private buildCharacterAnchorMap(state: DramaState): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const pack of state.visualBible?.identityPack ?? []) {
      const urls = [pack.anchorImages?.faceFront, pack.anchorImages?.face34, pack.anchorImages?.upperOrFull]
        .filter((u): u is string => typeof u === 'string' && !!u.trim());
      if (!urls.length) continue;
      map.set(pack.characterId, [...new Set(urls)]);
    }
    return map;
  }

  private resolveLockedCharacterIds(shot: Shot): string[] {
    const ids: string[] = [];
    for (const ref of shot.characterLockRefs ?? []) {
      const id = this.parseCharacterIdFromLockRef(ref);
      if (!id) continue;
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length) return ids;
    for (const c of shot.characters ?? []) {
      if (c?.characterId && !ids.includes(c.characterId)) ids.push(c.characterId);
    }
    return ids;
  }

  private parseCharacterIdFromLockRef(lockRef: string): string | null {
    if (!lockRef) return null;
    if (lockRef.startsWith('character:')) {
      const cid = lockRef.slice('character:'.length).trim();
      return cid || null;
    }
    if (lockRef.startsWith('vb:')) {
      const parts = lockRef.split(':');
      return parts[2]?.trim() || null;
    }
    if (!lockRef.includes(':')) return lockRef.trim() || null;
    return null;
  }

  private applyStyleLockPrompt(basePrompt: string, shot: Shot, state: DramaState): string {
    const styleTokens = this.resolveStyleLockTokens(shot, state);
    if (!styleTokens.length) return basePrompt;
    return this.mergePromptSegments([...styleTokens, basePrompt]);
  }

  private resolveStyleLockTokens(shot: Shot, state: DramaState): string[] {
    const ref = (shot.styleLockRef ?? '').trim();
    const tokens: string[] = [];
    const push = (value: string) => { if (value && !tokens.includes(value)) tokens.push(value); };

    if (ref.startsWith('vb-style:')) {
      for (const t of state.visualBible?.stylePack?.styleTokens ?? []) push(t);
      const lut = state.visualBible?.stylePack?.colorLutHint ?? '';
      if (lut) push(lut);
      return tokens.slice(0, 8);
    }

    if (ref.startsWith('style:')) {
      ref.slice('style:'.length).split('|').map(s => s.trim()).filter(Boolean).forEach(push);
      return tokens.slice(0, 8);
    }

    if (ref) {
      if (ref.includes('|')) ref.split('|').map(s => s.trim()).filter(Boolean).forEach(push);
      else push(ref);
    }
    return tokens.slice(0, 8);
  }

  private mergePromptSegments(chunks: string[]): string {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const chunk of chunks) {
      if (!chunk) continue;
      for (const segment of chunk.split(',').map(s => s.trim()).filter(Boolean)) {
        const key = segment.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(segment);
      }
    }
    return deduped.join(', ');
  }

  // ═══ 动态参考图构建 ═══

  /** 构建参考图候选列表，按镜头角度匹配最佳角色视角 + RenderingProfile 优先级筛选 */
  private buildRefImages(
    shot: Shot, charMap: Map<string, CharacterImageSet>, varMap: Map<string, string>,
    anchorMap: Map<string, string[]>,
    styleRefs: string[],
    sceneCache: Map<string, string>, prevFrameCache: Map<number, string>,
    frameType: 'first' | 'last',
  ): Array<{ url: string; weight: number }> {
    const isCloseUp = ['close_up', 'extreme_close_up', 'medium_close_up'].includes(shot.camera?.shotSize ?? '');
    const charWeight = isCloseUp ? 0.6 : 0.4;
    const lockCharWeight = isCloseUp ? 0.8 : 0.55;
    const sceneWeight = isCloseUp ? 0.2 : 0.4;
    const styleWeight = isCloseUp ? 0.1 : 0.2;

    const candidates: RefImageCandidate[] = [];
    const seenUrls = new Set<string>();
    const pushCandidate = (url: string | undefined, weight: number, role: RefImageCandidate['role']) => {
      if (!url) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      candidates.push({ url, weight, role });
    };

    if (shot.sceneId && sceneCache.has(shot.sceneId)) {
      pushCandidate(sceneCache.get(shot.sceneId), sceneWeight, 'scene');
    }

    const lockedIds = this.resolveLockedCharacterIds(shot);
    for (const cid of lockedIds) {
      const varId = shot.characterVariationIds?.[cid];
      const varUrl = varId ? varMap.get(`${cid}_${varId}`) : undefined;
      if (varUrl) {
        pushCandidate(varUrl, lockCharWeight, 'character_face');
      }
      const anchorUrls = anchorMap.get(cid) ?? [];
      for (const anchorUrl of anchorUrls) {
        pushCandidate(anchorUrl, lockCharWeight, 'character_face');
      }
      const imageSet = charMap.get(cid);
      if (imageSet?.primary) {
        pushCandidate(imageSet.primary, lockCharWeight, 'character_face');
      }
    }

    (shot.characters ?? []).forEach(c => {
      const varId = shot.characterVariationIds?.[c.characterId];
      const varUrl = varId ? varMap.get(`${c.characterId}_${varId}`) : undefined;
      if (varUrl) {
        pushCandidate(varUrl, charWeight, 'character_face');
      } else {
        const imageSet = charMap.get(c.characterId);
        if (imageSet) {
          const availableViews = Object.keys(imageSet.views) as CharacterViewAngle[];
          const bestView = selectBestCharacterView(availableViews, shot.camera?.shotSize, c.position, shot.camera?.cameraAngle);
          const url = imageSet.views[bestView] || imageSet.primary;
          pushCandidate(url, charWeight, 'character_face');
        }
      }
    });
    if (frameType === 'first' && shot.shotIndex > 0 && prevFrameCache.has(shot.shotIndex - 1)) {
      pushCandidate(prevFrameCache.get(shot.shotIndex - 1), 0.15, 'prev_frame');
    }
    if (styleRefs.length) {
      pushCandidate(styleRefs[0], styleWeight, 'style');
    }
    return selectRefImages(candidates, this.profile, shot.camera?.shotSize, shot.camera?.cameraAngle);
  }

  /** 收集角色参考图URL（支持变体 + 多角度） */
  private collectRefImages(
    shot: Shot,
    charMap: Map<string, CharacterImageSet>,
    varMap: Map<string, string>,
    anchorMap: Map<string, string[]>,
  ): string[] {
    const urls: string[] = [];
    const push = (url: string | undefined) => {
      if (!url) return;
      if (urls.includes(url)) return;
      urls.push(url);
    };

    for (const cid of this.resolveLockedCharacterIds(shot)) {
      const varId = shot.characterVariationIds?.[cid];
      if (varId) push(varMap.get(`${cid}_${varId}`));
      (anchorMap.get(cid) ?? []).forEach(push);
      push(charMap.get(cid)?.primary);
    }

    for (const c of shot.characters ?? []) {
      const varId = shot.characterVariationIds?.[c.characterId];
      if (varId) push(varMap.get(`${c.characterId}_${varId}`));
      push(charMap.get(c.characterId)?.primary);
    }

    return urls.slice(0, 4);
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
      } else if (job.status === 'failed') {
        const fb = map[sid]?.imageUrl;
        if (fb) { map[sid] = { ...map[sid], videoUrl: fb, status: 'completed', kenBurnsFallback: true }; this.logger.warn(`${sid} I2V轮询降级: Ken Burns`); }
        else { map[sid] = { ...map[sid], status: 'failed' }; }
        remaining--;
      }
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
          // Video quality gate: basic structural check
          if (vUrl) {
            try {
              const shot = shots.find(s => s.shotId === sid);
              const vqc = await this.qualityGate.assessVideoBasic(vUrl, shot?.estimatedDurationSec);
              if (!vqc.pass) {
                this.logger.warn(`${sid} 视频质量检查不通过: ${vqc.issues.join(', ')}`);
                map[sid] = { ...map[sid], videoQcIssues: vqc.issues };
              }
            } catch (vqcErr) { this.logger.debug(`${sid} 视频质量检查降级: ${(vqcErr as Error).message}`); }
          }
          map[sid] = { ...map[sid], videoUrl: vUrl, status: 'completed' };
          const idx = shots.findIndex(s => s.shotId === sid);
          emit(off + (idx >= 0 ? idx : 0), `${sid} 视频完成`, true);
          if (vUrl) try { await this.storage.downloadToLocal(vUrl, this.storage.resolve(`videos/${dramaId}/${sid}.mp4`)); } catch {}
        } else if (evt.status === 'failed') {
          const fb = map[sid]?.imageUrl;
          if (fb) { map[sid] = { ...map[sid], videoUrl: fb, status: 'completed', kenBurnsFallback: true }; this.logger.warn(`${sid} I2V事件降级: Ken Burns`); }
          else { map[sid] = { ...map[sid], status: 'failed' }; }
        }
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

  private resolveShotRunPolicy(
    shot: Shot,
    mode: DramaGenerationMode,
    styleBucket: DramaStyleBucket,
  ) {
    return this.generationPolicy.resolveShotRunPolicy({
      mode,
      styleBucket,
      shotType: shot.shotType,
      qualityTier: shot.qualityTier,
    });
  }

  private buildFixNegativeHint(fixType: string, issues?: string[]): string {
    const hints: Record<string, string> = {
      identity: 'deformed face, extra fingers, distorted features, wrong character identity, inconsistent face',
      style: 'inconsistent style, wrong color palette, mismatched lighting, different art style',
      camera: 'bad composition, unclear subject, wrong camera angle, cluttered frame',
      motion: 'motion blur, ghosting, afterimage, jitter, distorted movement',
    };
    const base = hints[fixType] ?? '';
    const issueHint = (issues ?? []).slice(0, 2).join(', ');
    return [base, issueHint].filter(Boolean).join(', ');
  }

  private normalizeQualityTier(tier?: Shot['qualityTier']): 'golden' | 'standard' | 'filler' {
    return (tier ?? 'standard') as 'golden' | 'standard' | 'filler';
  }

  private shouldUseQualityGate(
    gateEnabled: boolean,
    tier: 'golden' | 'standard' | 'filler',
    maxAttempts: number,
    candidateCount: number,
  ): boolean {
    if (!gateEnabled || tier === 'filler') return false;
    return maxAttempts > 1 || candidateCount > 1;
  }

  private async withRetry<T>(fn: () => Promise<T>, label: string, maxRetries = 2, baseDelayMs = 2000): Promise<T> {
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

  /** B1: 从 VisualAssetEntity 加载常驻场景的持久化参考图（跨集复用） */
  private async buildLocationImageMap(dramaId: string): Promise<Map<string, string>> {
    const assets = await this.assetRepo.find({ where: { dramaId, assetType: 'location' as any } });
    const map = new Map<string, string>();
    for (const a of assets) {
      if (a.referenceImageUrl) map.set(a.refId, a.referenceImageUrl);
    }
    return map;
  }


  /** B2: 将场景参考图持久化到 VisualAssetEntity，供后续集直接复用 */
  private async saveLocationImage(dramaId: string, locationId: string, name: string, imageUrl: string): Promise<void> {
    const existing = await this.assetRepo.findOne({ where: { dramaId, assetType: 'location' as any, refId: locationId } });
    if (existing) {
      await this.assetRepo.update(existing.id, { referenceImageUrl: imageUrl });
    } else {
      await this.assetRepo.save(this.assetRepo.create({
        dramaId, assetType: 'location' as any, refId: locationId, name,
        data: {}, referenceImageUrl: imageUrl, referenceImages: [],
      }));
    }
    this.logger.log(`[LocationCache] 持久化场景图 ${locationId}(${name}) → ${imageUrl.slice(-40)}`);
  }

  /**
   * P5: T2I 完成后，将池角色的最佳生成图写回 minorRolePool.referenceImageUrl（仅内存修改）。
   * 落库由 EpisodeWorkflowService.updateDramaState 统一完成，避免与 dramaRepo.save 竞争写入。
   */
  private async updatePoolReferenceImages(
    state: DramaState,
    shots: Shot[],
    shotMediaMap: Record<string, ShotMediaEntry>,
  ): Promise<void> {
    const pool = state.minorRolePool;
    if (!pool?.length) return;
    const poolIds = new Set(pool.map(p => p.characterId));
    const bestImages = new Map<string, { url: string; score: number }>();
    for (const shot of shots) {
      const entry = shotMediaMap[shot.shotId];
      if (!entry?.imageUrl) continue;
      const score = entry.qc?.score ?? 5;
      for (const char of shot.characters ?? []) {
        if (!poolIds.has(char.characterId)) continue;
        const current = bestImages.get(char.characterId);
        if (!current || score > current.score) {
          bestImages.set(char.characterId, { url: entry.imageUrl, score });
        }
      }
    }
    if (!bestImages.size) return;
    let updated = false;
    for (const p of pool) {
      const best = bestImages.get(p.characterId);
      if (best && best.score >= 6 && best.url !== p.referenceImageUrl) {
        p.referenceImageUrl = best.url;
        updated = true;
      }
    }
    if (updated) {
      this.logger.log(`[MinorRolePool] 参考图已写入内存（待落库）: ${[...bestImages.keys()].join(', ')}`);
    }
  }

  private async buildCharacterImageMap(dramaId: string): Promise<Map<string, CharacterImageSet>> {
    const assets = await this.assetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    const map = new Map<string, CharacterImageSet>();
    for (const a of assets) {
      if (!a.referenceImageUrl && !(a.referenceImages?.length)) continue;
      const views: Partial<Record<CharacterViewAngle, string>> = {};
      if (a.referenceImages?.length) {
        for (const ri of a.referenceImages) views[ri.viewAngle as CharacterViewAngle] = ri.imageUrl;
      }
      if (!views.face_front && a.referenceImageUrl) views.face_front = a.referenceImageUrl;
      map.set(a.refId, { primary: a.referenceImageUrl || views.face_front || '', views });
    }
    return map;
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

  private async buildStyleRefImages(
    dramaId: string,
    state: DramaState,
    styleBucket?: DramaStyleBucket,
  ): Promise<string[]> {
    const bucket = styleBucket ?? this.generationPolicy.resolveMediaPolicy(state).styleBucket;
    // 真人项目依赖文本风格锁更稳定，禁用 style 参考图可避免“分格/概念板”污染。
    if (bucket === 'live_action') return [];
    const styleAsset = await this.assetRepo.findOne({ where: { dramaId, assetType: 'style_guide' as any } });
    const fromAsset = [
      styleAsset?.referenceImageUrl ?? '',
      ...(styleAsset?.referenceImages ?? []).map((r) => r.imageUrl),
    ].filter(Boolean);
    if (fromAsset.length) return [...new Set(fromAsset)].slice(0, 2);
    const fromBible = state.visualBible?.stylePack?.styleRefImages ?? [];
    return [...new Set(fromBible.filter(Boolean))].slice(0, 2);
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
