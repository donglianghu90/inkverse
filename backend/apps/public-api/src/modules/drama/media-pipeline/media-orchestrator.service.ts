/** 媒体编排器 — 支持关键帧插值(首尾帧)、并发T2I/I2V、角色变体参考图、渲染配置驱动、质量关卡、连贯性校验 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService, OssService } from '@packages/modules';
import { EpisodeEntity, EpisodeMediaStatus } from '../entities/episode.entity';
import { ShotMediaEntity } from '../entities/shot-media.entity';
import { VisualAssetEntity } from '../entities/visual-asset.entity';
import { DramaEntity } from '../entities/drama.entity';
import { DramaState, Shot, EpisodeStoryboard } from '../schemas/drama-state.schemas';
import { MediaService } from '../../media/media.service';
import { ProviderRegistryService } from '../../media/providers/provider-registry.service';
import { AudioResourceService } from '../../media/audio-resource.service';
import { VideoComposerService } from '../../media/video-composer.service';
import { VideoPostProcessorService } from '../../media/video-post-processor.service';
import type { ComposeShotInput } from '../../media/interfaces';
import { LocalStorageService } from '../../media/local-storage.service';
import { DramaProgressService } from '../drama-progress.service';
import { RenderingProfileService } from '../../media/rendering/rendering-profile.service';
import {
  RenderingProfile, RefImageCandidate, CharacterImageSet, CharacterViewAngle,
  selectRefImages, selectBestCharacterView, buildCameraHint, assembleT2iPrompt,
  ageToT2IPhrase, buildLocationViewPrompt, buildViewAnglePrompt,
} from '../../media/rendering/rendering-profile';
import { PromptOptimizerService } from '../../media/prompt-optimizer.service';
import { MediaQualityGateService, QualityAssessment } from './media-quality-gate.service';
import { ShotCoherenceValidatorService } from './shot-coherence-validator.service';
import { EmotionMediaMapperService } from './emotion-media-mapper.service';
import { GenerationPolicyService } from './generation-policy.service';
import { ShotProductionOrderService } from './shot-production-order.service';
import { ShotContextBuilderService } from './shot-context-builder.service';
import { ShotPromptAssemblerService } from './shot-prompt-assembler.service';
import { ImageProviderRouterService } from './image-provider-router.service';
import { VideoProviderRouterService } from './video-provider-router.service';
import type { DramaStyleBucket } from '../interfaces';
import type { ShotMediaEntry } from '../interfaces';
import {
  detectStyleBucket as detectStyleBucketUtil,
  buildAssetStylePrefix as buildAssetStylePrefixUtil,
  upsertReferenceByView as upsertReferenceByViewUtil,
} from '../utils/asset-prompt.utils';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

@Injectable()
export class MediaOrchestratorService implements OnModuleInit {
  private readonly logger = new Logger('MediaOrchestrator');
  private t2iMaxConcurrency = 3;
  private t2iNextSlotAt = 0; // 令牌槽：下一次允许提交的时间戳(ms)
  private acquireT2iSlot: () => Promise<void> = () => Promise.resolve();
  /** 跨集并发防护：记录正在生成中的 variation（key = dramaId_charId_varId） */
  private readonly pendingVariations = new Map<string, Promise<void>>();
  private static readonly LIVE_ACTION_NEGATIVE_EXTRA = [
    'painting', 'illustration', 'watercolor painting', 'ink painting',
    'comic panel', 'storyboard panel', 'split screen', 'grid layout',
    'collage', 'diptych', 'triptych',
  ].join(', ');

  /** Provider 时长约束 — 仅用于提交 clamp 和合成裁剪，不影响路由选型 */
  private static readonly PROVIDER_DURATION: Record<string, { min: number; max: number }> = {
    kling:          { min: 3, max: 15 },
    hailuo:         { min: 6, max: 10 },
    veo:            { min: 4, max: 8 },
    sora:           { min: 10, max: 15 },
    'kling-avatar': { min: 1, max: 60 },
    volcengine:     { min: 5, max: 10 },
  };

  static clampDuration(estimatedSec: number, provider?: string): number {
    const range = MediaOrchestratorService.PROVIDER_DURATION[provider ?? ''] ?? { min: 5, max: 10 };
    // V4-fix: ceil 而非 round — 宁可视频多 0.5s 也不要提前结束（音频可能还没播完）
    return Math.min(Math.max(Math.ceil(estimatedSec), range.min), range.max);
  }

  static getProviderMaxDuration(provider?: string): number {
    return MediaOrchestratorService.PROVIDER_DURATION[provider ?? '']?.max ?? 10;
  }
  private skipImageGen = false;
  /** SFX 生成开关，默认 true（关闭）：当前 SFX 模型不可用（elevenlabs/sound-effect-v2 已下线）。
   * 恢复后在配置里将 media.pipeline.skipSfxGeneration 设为 false 重新开启。 */
  private skipSfxGen = true;
  private profile!: RenderingProfile;
  /** 视频任务等待超时（ms），默认 40 分钟，可通过 media.pipeline.videoAwaitTimeoutMs 配置 */
  private videoAwaitTimeoutMs = 40 * 60 * 1000;

  /**
   * Per-episode 串行锁 — 防止前端同时触发同一集内多个 generateShotImage 请求时，
   * 各请求读到空 DB 快照而导致 refs=0 盲生成。
   * 锁粒度为 episodeId，不同集可以并行；同集内的请求排队执行。
   */
  private readonly episodeLocks = new Map<string, Promise<unknown>>();
  private async withEpisodeLock<T>(episodeId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.episodeLocks.get(episodeId) ?? Promise.resolve();
    const current = prev.then(fn, fn); // 不管前任成功失败都继续
    this.episodeLocks.set(episodeId, current);
    try {
      return await current;
    } finally {
      // 队列清空时移除 key，避免内存泄漏
      if (this.episodeLocks.get(episodeId) === current) {
        this.episodeLocks.delete(episodeId);
      }
    }
  }

  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(ShotMediaEntity) private readonly shotMediaRepo: Repository<ShotMediaEntity>,
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
    private readonly videoRouter: VideoProviderRouterService,
    private readonly shotOrderService: ShotProductionOrderService,
    private readonly shotContextService: ShotContextBuilderService,
    private readonly shotPromptAssembler: ShotPromptAssemblerService,
    private readonly redisService: RedisService,
    private readonly postProcessor: VideoPostProcessorService,
    private readonly ossService: OssService,
  ) {}

  async onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const pipeline = (media.pipeline ?? {}) as Record<string, unknown>;
    this.skipImageGen = String(pipeline.skipImageGeneration) === 'true';
    this.skipSfxGen = String(pipeline.skipSfxGeneration ?? 'true') !== 'false';
    if (this.skipSfxGen) this.logger.warn('SFX 生成已禁用（skipSfxGen=true），如需开启请在配置中将 media.pipeline.skipSfxGeneration 设为 false');
    if (pipeline.t2iMaxConcurrency) this.t2iMaxConcurrency = Number(pipeline.t2iMaxConcurrency);
    if (pipeline.videoAwaitTimeoutMs) this.videoAwaitTimeoutMs = Number(pipeline.videoAwaitTimeoutMs);
    const t2iIntervalMs = Number(pipeline.t2iIntervalMs) || 3000;
    // 全局 Redis 滑动窗口限流器（多 Pod 共享）
    let redis: Redis | null = null;
    try { redis = this.redisService.getOrThrow(); } catch { this.logger.warn('Redis 不可用，T2I 限流降级为内存令牌桶'); }
    if (redis) {
      const windowMs = t2iIntervalMs;
      const maxPerWindow = this.t2iMaxConcurrency;
      this.acquireT2iSlot = async () => {
        const windowKey = `t2i:rate:${Math.floor(Date.now() / windowMs)}`;
        try {
          const count = await redis!.incr(windowKey);
          if (count === 1) await redis!.expire(windowKey, Math.ceil(windowMs / 1000) + 1);
          if (count > maxPerWindow) {
            const sleepMs = windowMs - (Date.now() % windowMs) + 50;
            await new Promise(r => setTimeout(r, sleepMs));
          }
        } catch {
          // Redis 故障时降级为无限流
          this.logger.warn('Redis T2I 限流故障，本次跳过限流');
        }
      };
    } else {
      // 降级为内存令牌桶（单 Pod 有效）
      this.acquireT2iSlot = async () => {
        const waitMs = this.t2iNextSlotAt - Date.now();
        this.t2iNextSlotAt = Math.max(Date.now(), this.t2iNextSlotAt) + t2iIntervalMs;
        if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      };
    }
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
      const mediaList = await this.shotMediaRepo.find({ where: { episodeId: ep.id } });
      const hasActive = mediaList.some(v => v.status === 'submitted' && v.videoJobId);
      if (!hasActive) {
        this.logger.warn(`E${ep.episodeNumber}(${ep.dramaId}) 无活跃任务，标记失败`);
        await this.episodeRepo.update(ep.id, { mediaStatus: 'failed', mediaError: '服务重启恢复: 无活跃任务' });
      }
    }
  }

  /** 按当前模型的 RenderingProfile 组装 T2I prompt（兼容旧 API，已被 assembler 接管核心功能，保留供局部使用或待重构） */
  private assemblePrompt(raw: string, camera?: { shotSize?: string; shotSizeEnd?: string | null; cameraAngle?: string; composition?: string; depthOfField?: string }, stylePrefix?: string, useEndSize = false, lightingHint?: string): string {
    const effectiveCamera = useEndSize && camera?.shotSizeEnd
      ? { ...camera, shotSize: camera.shotSizeEnd }
      : camera;
    // 将场景光线描述追加到 raw prompt 末尾，为 T2I 提供光线锚点
    const withLighting = lightingHint && !raw.toLowerCase().includes(lightingHint.toLowerCase().slice(0, 20))
      ? `${raw}, ${lightingHint}`
      : raw;
    return assembleT2iPrompt(withLighting, this.profile, { cameraHint: buildCameraHint(effectiveCamera), stylePrefix });
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
    const reviewRiskShotIds = this.shotOrderService.extractReviewRiskShotIds(episode.review);
    const orderedShots = this.shotOrderService.orderShotsForProduction(shots, reviewRiskShotIds);
    await this.ensureBaseReferenceImages(dramaId, state, shots, userId);
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    // P5: 用 minorRolePool 中已有的参考图补充 charImageMap（零成本，跨集复用）
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.shotContextService.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    await this.ensureVariationImages(dramaId, state, shots, charImageMap, variationImageMap, userId, episodeNumber);
    // 多视角参考图暂停：当前 T2I provider 不区分参考图角度，Kling elements 做身份锁定不关心角度。
    // 等引入 LoRA/IP-Adapter 后恢复（多视角作为训练集输入才有价值）。
    // await this.ensureMultiViewImages(dramaId, state, shots, charImageMap, userId, episodeNumber);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1: 跨集常驻场景参考图
    const propImageMap = await this.buildPropImageMap(dramaId);         // 签名道具参考图
    const propOwnerMap = this.buildPropOwnerMap(state);                 // 角色→道具归属
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);
    const episodeNegPrompt = this.buildEpisodeNegativePrompt(mediaPolicy.styleBucket);
    const flashbackVideoMap = await this.buildFlashbackVideoMap(dramaId, shots);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = MediaOrchestratorService.resolveImageSize(aspectRatio);
    const t2iStylePrefix = this.buildT2iStylePrefix(state.visualStyle);
    // 场景光线映射：sceneId → lightingDefault（如 "warm lantern glow, dramatic chiaroscuro"）
    const locationLightingMap = new Map<string, string>();
    const ambientPopulationMap = new Map<string, string>();
    for (const loc of state.locations ?? []) {
      if (loc.lightingDefault) locationLightingMap.set(loc.locationId, loc.lightingDefault);
      if (loc.ambientPopulation) ambientPopulationMap.set(loc.locationId, loc.ambientPopulation);
    }
    const dramaGenre = state.seed?.genre;
    this.logger.log(
      `[policy] E${episodeNumber} style=${mediaPolicy.styleBucket} ` +
      `t2i=${mediaPolicy.t2iConcurrency} i2v=${mediaPolicy.i2vConcurrency} ` +
      `retry=${mediaPolicy.maxMediaRetries} gate=${mediaPolicy.enableQualityGate ? 'on' : 'off'} ` +
      `coherence=${mediaPolicy.enableCoherenceValidation ? 'on' : 'off'}`,
    );
    this.shotOrderService.logShotOrder(`E${episodeNumber}`, orderedShots);
    const withMediaRetry = <T>(fn: () => Promise<T>, label: string) =>
      this.withRetry(fn, label, mediaPolicy.maxMediaRetries, mediaPolicy.retryBaseDelayMs);

    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const shotMediaMap: Record<string, ShotMediaEntry> = Object.fromEntries(
      mediaList.map((m) => [m.shotId, { ...(m as unknown as ShotMediaEntry), status: m.status ?? 'unknown' }])
    );

    const hasT2I = !this.skipImageGen;
    const totalPhases = (hasT2I ? shots.length * 2 : 0) + shots.length * 2 + 1; // 首帧+尾帧+视频+TTS+合成
    let phaseOff = 0;
    const emit = (i: number, msg: string, done = false) =>
      this.progressService.emit({ dramaId, runType: 'media', episodeNumber, step: `media_${i}`, stepIndex: i, totalSteps: totalPhases, message: msg, done });

    try {
      const scriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
      const sceneMap = new Map(scriptScenes.map(s => [s.sceneId, s]));
      // ── Bug2 fix: sceneId → locationId 映射，确保 lighting/ambient/visualPrompt 查找用正确的 key ──
      const getLocationId = (sceneId: string): string => sceneMap.get(sceneId)?.locationId || sceneId;
      const getLocationVisualPrompt = (sceneId: string): string | undefined => {
        const locId = getLocationId(sceneId);
        return state.locations?.find(l => l.locationId === locId)?.visualPrompt;
      };
      const shotMediaParamsCache = new Map<string, ReturnType<EmotionMediaMapperService['mapShotToMediaParams']>>();
      for (const shot of shots) {
        shotMediaParamsCache.set(shot.shotId, this.emotionMapper.mapShotToMediaParams(shot, sceneMap.get(shot.sceneId)));
      }

      // 非注册角色临时 anchor：guard_01 等小角色无 charImageMap 档案，
      // 首次 T2I 生成图缓存此处，Phase 0.5 连贯性重生成也可复用，保持外貌一致。
      const tempCharCache = new Map<string, string>();
      // P6: 每角色的 Shot 首帧图收集器（Phase 0 完成后填充，I2V 阶段用于丰富 Kling elements）
      let characterShotImages = new Map<string, string[]>();

      if (hasT2I) {
        // ═══ Phase 0: T2I 首帧 + 尾帧（并发池） ═══
        await this.updateMediaStatus(episode.id, 'generating_first_frames');
        const sceneCache = new Map<string, string>();
        // B3: 用持久化的常驻场景图预填充，避免跨集重复生成背景
        for (const [locationId, imageUrl] of locationImageMap) {
          sceneCache.set(locationId, imageUrl);
        }
        const prevFrameCache = new Map<number, string>();
        // P-F fix 第一层：Phase 0 开始前，将 shotMediaMap 中已有图片预填充到 prevFrameCache
        // 解决续跑场景：之前批次已生成的帧在 prevFrameCache 中缺失，导致后续帧无法获取前帧参考图
        for (const shot of shots) {
          const existingUrl = shotMediaMap[shot.shotId]?.imageUrl;
          if (existingUrl) prevFrameCache.set(shot.shotIndex, existingUrl);
        }
        // 强制使用串行生成 (并发控制为 1)，彻底解决并发导致的帧序列缺失与样式漂移 (Deadlock Paradox)
        await this.runConcurrent(orderedShots, 1, async (shot, i) => {
          const sid = shot.shotId;
          if (shot.isFlashback || shot.isPreview) { emit(phaseOff + i, `${sid} 跳过T2I`, true); return; }

          const mediaParams = shotMediaParamsCache.get(sid);
          const emotionColorHint = mediaParams?.colorGrade;
          const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);
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
              const styleLockedPrompt = this.shotContextService.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
              const rawPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedPrompt, {
                stylePrefix: t2iStylePrefix || '',
                maxTokens: Infinity, provider: shotRoute.provider || '',
                batchLighting: locationLightingMap.get(getLocationId(shot.sceneId)),
                sceneVisualPrompt: getLocationVisualPrompt(shot.sceneId),
              });
              const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
                shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                qualityTier: shot.qualityTier ?? 'standard',
                shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint,
                composition: shot.camera?.composition, depthOfField: shot.camera?.depthOfField,
                specialTechnique: shot.specialTechnique ?? undefined,
                routeProfile: shotPolicy.routeProfile,
                provider: shotRoute.provider,
                ambientPopulation: ambientPopulationMap.get(getLocationId(shot.sceneId)),
              });
              // P-F fix 第二层：并发池中，生成首帧前尝试从 shotMediaMap 回填前一帧
              // 处理「前一帧已被并发 worker 生成完毕写入 shotMediaMap，但 prevFrameCache 还没来得及 set」的窗口期
              if (!prevFrameCache.has(shot.shotIndex - 1) && shot.shotIndex > 0) {
                const prevShot = shots.find(s => s.shotIndex === shot.shotIndex - 1);
                const prevUrl = prevShot ? shotMediaMap[prevShot.shotId]?.imageUrl : undefined;
                if (prevUrl) prevFrameCache.set(shot.shotIndex - 1, prevUrl);
              }
              const refs = this.shotContextService.buildRefImages(
                shot,
                charImageMap,
                variationImageMap,
                characterAnchorMap,
                styleRefImages,
                sceneCache,
                prevFrameCache,
                'first', this.profile,
                tempCharCache,
                propImageMap, propOwnerMap,
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
                const characterRefs = this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
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
                const newEntry = {
                  ...shotMediaMap[sid],
                  imageUrl: imgUrl,
                  status: shotMediaMap[sid]?.status ?? 'image_done',
                  qc: gateQc ?? shotMediaMap[sid]?.qc,
                  t2iPrompt: optimized.prompt,
                  t2iNegativePrompt: optimized.negativePrompt || undefined,
                };
                shotMediaMap[sid] = newEntry;
                // 非注册角色首次出现缓存：guard_01 等无档案小角色，首帧图作为
                // 同集后续镜头的 anchor，避免同一场景内多次出现时长相随机漂移
                for (const c of (shot.characters ?? [])) {
                  if (!charImageMap.has(c.characterId) && !tempCharCache.has(c.characterId)) {
                    tempCharCache.set(c.characterId, imgUrl);
                    this.logger.debug(`[TempCharCache] ${c.characterId} 无档案，以 ${sid} 首帧为临时 anchor`);
                  }
                }
                // S7-fix: 仅 medium_wide/wide/extreme_wide 才写入 sceneCache
                // close_up 系列 + medium 景别均以角色为主体，作为场景参考会污染后续全景 Shot 的构图
                const isCharacterDominantShot = ['close_up', 'extreme_close_up', 'medium_close_up', 'medium'].includes(shot.camera?.shotSize ?? '');
                if (shot.sceneId && !sceneCache.has(shot.sceneId) && !isCharacterDominantShot) {
                  sceneCache.set(shot.sceneId, imgUrl);
                  // B2: isRecurring 场景第一次生成时，持久化到 VisualAssetEntity 供后续集复用
                  const resolvedLocId = getLocationId(shot.sceneId);
                  if (!locationImageMap.has(resolvedLocId)) {
                    const loc = state.locations?.find(l => l.locationId === resolvedLocId);
                    if (loc?.isRecurring) {
                      locationImageMap.set(resolvedLocId, imgUrl);
                      this.saveLocationImage(dramaId, resolvedLocId, loc.name, imgUrl).catch(e =>
                        this.logger.warn(`场景图持久化失败 ${resolvedLocId}: ${(e as Error).message}`));
                    }
                  }
                }
                prevFrameCache.set(shot.shotIndex, imgUrl);
                try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, sid)); } catch {}
              }
              emit(phaseOff + i, `${sid} 首帧完成`, true);
            } catch (err) {
              const errMsg = (err as Error).message;
              this.logger.warn(`${sid} 首帧失败: ${errMsg}`);
              shotMediaMap[sid] = {
                ...shotMediaMap[sid],
                shotId: sid,
                status: 'image_failed',
                imageError: errMsg.slice(0, 500),
              } as ShotMediaEntry;
              await this.shotMediaRepo.upsert({ ...shotMediaMap[sid], episodeId: episode.id, shotId: sid }, ['episodeId', 'shotId']).catch(() => {});
              emit(phaseOff + i, `${sid} 首帧生成失败`, true);
            }
          } else {
            const isCloseUpResumed = ['close_up', 'extreme_close_up', 'medium_close_up', 'medium'].includes(shot.camera?.shotSize ?? '');
            if (shot.sceneId && !sceneCache.has(shot.sceneId) && !isCloseUpResumed) sceneCache.set(shot.sceneId, shotMediaMap[sid].imageUrl!);
            prevFrameCache.set(shot.shotIndex, shotMediaMap[sid].imageUrl!);
          }

          // 组内 Shot 的尾帧不再跳过，独立 Shot 正常生成尾帧。
          const skipLastFrame = false;
          if (shot.lastFramePrompt && !shotMediaMap[sid]?.lastFrameImageUrl && !skipLastFrame) {
            try {
              emit(phaseOff + orderedShots.length + i, `${sid} 尾帧生成中...`);
              const lastRefs = this.shotContextService.buildRefImages(
                shot,
                charImageMap,
                variationImageMap,
                characterAnchorMap,
                styleRefImages,
                sceneCache,
                prevFrameCache,
                'last', this.profile,
                tempCharCache,
                propImageMap, propOwnerMap,
              );
              const styleLockedLastPrompt = this.shotContextService.applyStyleLockPrompt(shot.lastFramePrompt!, shot, state);
              const rawLastPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedLastPrompt, {
                stylePrefix: t2iStylePrefix || '',
                maxTokens: Infinity, provider: shotRoute.provider || '',
                batchLighting: locationLightingMap.get(getLocationId(shot.sceneId)),
                sceneVisualPrompt: getLocationVisualPrompt(shot.sceneId),
              });
              const optLast = this.promptOptimizer.optimizeForT2I(rawLastPrompt, episodeNegPrompt ?? '', {
                shotType: 'last_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                qualityTier: shot.qualityTier ?? 'standard', emotionColorHint,
                shotSize: shot.camera?.shotSizeEnd ?? shot.camera?.shotSize,
                cameraAngle: shot.camera?.cameraAngle,
                composition: shot.camera?.composition, depthOfField: shot.camera?.depthOfField,
                specialTechnique: shot.specialTechnique ?? undefined,
                routeProfile: shotPolicy.routeProfile,
                provider: shotRoute.provider,
                ambientPopulation: ambientPopulationMap.get(getLocationId(shot.sceneId)),
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
              if (lastUrl) {
                const updatedEntry = { ...shotMediaMap[sid], lastFrameImageUrl: lastUrl, lastFrameT2iPrompt: optLast.prompt };
                shotMediaMap[sid] = updatedEntry;
                // 帧链修复：用尾帧覆盖 prevFrameCache，让下一 Shot 的首帧参考本 Shot 的结束状态
                // 影视原则：切镜时观众看到的是「上一镜头最后一帧 → 下一镜头第一帧」，
                // 因此下一 Shot 的首帧必须继承上一 Shot 结束时的角色状态（姿态/道具/表情）。
                prevFrameCache.set(shot.shotIndex, lastUrl);
              }
              emit(phaseOff + orderedShots.length + i, `${sid} 尾帧完成`, true);
            } catch (err) {
              const errMsg = (err as Error).message;
              this.logger.warn(`${sid} 尾帧失败: ${errMsg}`);
              shotMediaMap[sid] = {
                ...shotMediaMap[sid],
                shotId: sid,
                lastFrameError: errMsg.slice(0, 500),
              } as ShotMediaEntry;
              emit(phaseOff + orderedShots.length + i, `${sid} 尾帧生成失败`, true);
            }
          }
        });
        // P5: T2I 完成后，将池角色的最佳生成图写回 minorRolePool（内存操作，由 updateDramaState 统一落库）
        await this.updatePoolReferenceImages(state, shots, shotMediaMap);

        // 立即持久化：将首帧/尾帧图片 URL 写入数据库，确保页面刷新后图片不丢失
        // （此前仅在管线末尾 Phase 4 合成完成后才批量写入，导致中途刷新丢失所有图片）
        await this.pushShotMediaMap(episode.id, shotMediaMap);
        this.logger.log(`E${episodeNumber} Phase 0 T2I 完成，${Object.values(shotMediaMap).filter(m => m.imageUrl).length} 张首帧已持久化`);

        phaseOff += shots.length * 2;
      }

      // P6: 收集每个角色在不同 Shot 中的首帧图 → 丰富 Kling elements 身份数据
      // 放在 if(hasT2I) 外部：断点续传模式（图片已存在）也需要收集，供 I2V 阶段使用。
      {
        const closeUpSizes = new Set(['close_up', 'extreme_close_up', 'medium_close_up', 'medium']);
        const sortedForCharMap = [...orderedShots]
          .filter(s => !s.isFlashback && !s.isPreview && shotMediaMap[s.shotId]?.imageUrl)
          .sort((a, b) => {
            const aClose = closeUpSizes.has(a.camera?.shotSize ?? '') ? 0 : 1;
            const bClose = closeUpSizes.has(b.camera?.shotSize ?? '') ? 0 : 1;
            return aClose - bClose;
          });
        for (const shot of sortedForCharMap) {
          const imgUrl = shotMediaMap[shot.shotId]!.imageUrl!;
          for (const c of shot.characters ?? []) {
            const arr = characterShotImages.get(c.characterId) ?? [];
            if (arr.length < 4 && !arr.includes(imgUrl)) {
              arr.push(imgUrl);
              characterShotImages.set(c.characterId, arr);
            }
          }
        }
        if (characterShotImages.size) {
          this.logger.log(`[CharShotImages] 收集 ${characterShotImages.size} 个角色的 Shot 首帧参考: ${[...characterShotImages.entries()].map(([c, urls]) => `${c}(${urls.length}张)`).join(', ')}`);
        }
      }

      // ═══ Phase 0.5: 镜头连贯性验证 + 自动重生成 flagged shots（最多 2 轮） ═══
      if (hasT2I && mediaPolicy.enableCoherenceValidation) {
        const MAX_COHERENCE_ROUNDS = 2;
        for (let coherenceRound = 0; coherenceRound < MAX_COHERENCE_ROUNDS; coherenceRound++) {
          try {
            await this.updateMediaStatus(episode.id, 'generating_first_frames');
            const coherence = await this.coherenceValidator.validateEpisodeCoherence(dramaId, episodeNumber, mediaPolicy.enableVlmCoherence);
            if (coherence.flaggedShots.length === 0) {
              if (coherenceRound > 0) this.logger.log(`E${episodeNumber} 连贯性验证第${coherenceRound + 1}轮: 全部通过`);
              break; // 全部通过，跳出循环
            }
            this.logger.warn(`E${episodeNumber} 连贯性验证第${coherenceRound + 1}轮: 标记 ${coherence.flaggedShots.length} 个Shot，自动重生成: ${coherence.flaggedShots.join(', ')}`);
            const flaggedSet = new Set(coherence.flaggedShots);
            // P1-10: 每轮重建缓存，确保重生成的帧立即可作为后续 Shot 的参考
            const sceneCache = new Map<string, string>();
            const prevFrameCache = new Map<number, string>();
            for (const s of shots) {
              if (shotMediaMap[s.shotId]?.imageUrl && !flaggedSet.has(s.shotId)) {
                prevFrameCache.set(s.shotIndex, shotMediaMap[s.shotId].imageUrl!);
                if (s.sceneId && !sceneCache.has(s.sceneId)) sceneCache.set(s.sceneId, shotMediaMap[s.shotId].imageUrl!);
              }
            }
            const flaggedShots = this.shotOrderService.orderShotsForProduction(shots.filter(s => flaggedSet.has(s.shotId)), reviewRiskShotIds);
            for (const shot of flaggedShots) {
              const sid = shot.shotId;

              // 错误反向传导 (Error Backpropagation): 重写 Prompt
              // 获取该 Shot 导致的所有冲突 issues 并通过大模型修正 Prompt，防止携带原错词死锁
              const issues = coherence.shotPairs.filter(p => p.shotB === sid).flatMap(p => p.issues);
              if (issues.length > 0) {
                this.logger.warn(`${sid} 因为连贯性问题触发 Prompt 重写: ${issues.join('; ')}`);
                const fixedShot = await this.coherenceValidator.rewriteFlaggedShotPrompt(shot, state, issues);
                shot.firstFramePrompt = fixedShot.firstFramePrompt;
                shot.lastFramePrompt = fixedShot.lastFramePrompt;
                // V2-fix: 同步 visualPrompt，确保视频生成也受益于连贯性修复
                shot.visualPrompt = fixedShot.visualPrompt;
              }

              const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);
              try {
                const mediaParams = shotMediaParamsCache.get(sid);
                const regenRoute = this.imageRouter.routeShot({
                  qualityTier: shot.qualityTier, shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle,
                  isGolden: shot.isPreview || shot.qualityTier === 'golden', size: imgSize,
                });
                const styleLockedPrompt = this.shotContextService.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
                const rawPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedPrompt, {
                  stylePrefix: t2iStylePrefix || '',
                  maxTokens: Infinity, provider: regenRoute.provider || '',
                  batchLighting: locationLightingMap.get(getLocationId(shot.sceneId)),
                  sceneVisualPrompt: getLocationVisualPrompt(shot.sceneId),
                });
                const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
                  shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                  qualityTier: shot.qualityTier ?? 'standard',
                  shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams?.colorGrade,
                  composition: shot.camera?.composition, depthOfField: shot.camera?.depthOfField,
                  specialTechnique: shot.specialTechnique ?? undefined,
                  routeProfile: shotPolicy.routeProfile,
                  provider: regenRoute.provider,
                  ambientPopulation: ambientPopulationMap.get(getLocationId(shot.sceneId)),
                });
                const refs = this.shotContextService.buildRefImages(
                  shot,
                  charImageMap,
                  variationImageMap,
                  characterAnchorMap,
                  styleRefImages,
                  sceneCache,
                  prevFrameCache,
                  'first', this.profile,
                  tempCharCache,
                  propImageMap, propOwnerMap,
                );
                const res = await withMediaRetry(async () => {
                  await this.acquireT2iSlot();
                  return this.mediaService.generateImage({
                    prompt: optimized.prompt, negativePrompt: optimized.negativePrompt || undefined,
                    size: imgSize, count: 1, referenceImages: refs, dramaId, assetType: 'shot_first_frame', refId: `${sid}_regen`, userId, episodeNumber,
                    ...regenRoute,
                  });
                }, `${sid} 连贯性重生成(R${coherenceRound + 1})`);
                const newUrl = res.images?.[0]?.url ?? '';
                if (newUrl) {
                  shotMediaMap[sid] = { ...shotMediaMap[sid], imageUrl: newUrl, status: 'image_done', t2iPrompt: optimized.prompt, t2iNegativePrompt: optimized.negativePrompt || undefined };
                  // P1-10: 立即更新缓存，让同轮后续 flagged shot 能参考已重生成的帧
                  prevFrameCache.set(shot.shotIndex, newUrl);
                  if (shot.sceneId) sceneCache.set(shot.sceneId, newUrl);
                  this.logger.log(`${sid} 连贯性重生成完成(R${coherenceRound + 1})`);
                }

                // V8-fix: 首帧重生成后同步重生成尾帧
                // 影视原则：一个镜头的动作弧线必须内部一致 —— 如果首帧的角色朝向/位置被修正了，
                // 尾帧也必须反映修正后的状态，否则 I2V 在首尾帧间插值时会产生不自然的运动。
                if (shot.lastFramePrompt && newUrl) {
                  try {
                    const lastRefs = this.shotContextService.buildRefImages(
                      shot, charImageMap, variationImageMap, characterAnchorMap,
                      styleRefImages, sceneCache, prevFrameCache,
                      'last', this.profile, tempCharCache, propImageMap, propOwnerMap,
                    );
                    const styleLockedLastPrompt = this.shotContextService.applyStyleLockPrompt(shot.lastFramePrompt, shot, state);
                    const rawLastPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedLastPrompt, {
                      stylePrefix: t2iStylePrefix || '',
                      maxTokens: Infinity, provider: regenRoute.provider || '',
                      batchLighting: locationLightingMap.get(getLocationId(shot.sceneId)),
                      sceneVisualPrompt: getLocationVisualPrompt(shot.sceneId),
                    });
                    const optLast = this.promptOptimizer.optimizeForT2I(rawLastPrompt, episodeNegPrompt ?? '', {
                      shotType: 'last_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
                      qualityTier: shot.qualityTier ?? 'standard', emotionColorHint: mediaParams?.colorGrade,
                      shotSize: shot.camera?.shotSizeEnd ?? shot.camera?.shotSize,
                      cameraAngle: shot.camera?.cameraAngle,
                      composition: shot.camera?.composition, depthOfField: shot.camera?.depthOfField,
                      specialTechnique: shot.specialTechnique ?? undefined,
                      routeProfile: shotPolicy.routeProfile,
                      provider: regenRoute.provider,
                      ambientPopulation: ambientPopulationMap.get(getLocationId(shot.sceneId)),
                    });
                    const lastRes = await withMediaRetry(async () => {
                      await this.acquireT2iSlot();
                      return this.mediaService.generateImage({
                        prompt: optLast.prompt, negativePrompt: optLast.negativePrompt || undefined,
                        size: imgSize, count: 1, referenceImages: lastRefs, dramaId,
                        assetType: 'shot_last_frame', refId: `${sid}_last_regen`, userId, episodeNumber,
                        ...regenRoute,
                      });
                    }, `${sid} 尾帧连贯性重生成(R${coherenceRound + 1})`);
                    const lastUrl = lastRes.images?.[0]?.url ?? '';
                    if (lastUrl) {
                      shotMediaMap[sid] = { ...shotMediaMap[sid], lastFrameImageUrl: lastUrl, lastFrameT2iPrompt: optLast.prompt };
                      // 用尾帧更新 prevFrameCache，让下一 Shot 参考正确的结束状态
                      prevFrameCache.set(shot.shotIndex, lastUrl);
                    }
                  } catch (lastErr) {
                    this.logger.warn(`${sid} 尾帧连贯性重生成失败(R${coherenceRound + 1}): ${(lastErr as Error).message}`);
                  }
                }
              } catch (err) { this.logger.warn(`${sid} 连贯性重生成失败(R${coherenceRound + 1}): ${(err as Error).message}`); }
            }
            await this.updateMediaStatus(episode.id, 'generating_first_frames');
          } catch (err) {
            this.logger.warn(`连贯性验证降级(R${coherenceRound + 1}): ${(err as Error).message}`);
            break; // 验证本身失败则不再重试
          }
        }
      }

      // ═══ Phase 1: I2V / T2V 视频生成 ═══
      await this.updateMediaStatus(episode.id, 'generating_videos');

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
          shotMediaMap[sid] = { ...(shotMediaMap[sid] ?? {}), status: 'generating_video', shotId: sid } as ShotMediaEntry;
          await this.shotMediaRepo.upsert({ ...shotMediaMap[sid], episodeId: episode.id, shotId: sid }, ['episodeId', 'shotId']);

          const refImages: Array<{ url: string; role: 'first_frame' | 'last_frame' | 'character' | 'style' }> = [];
          const firstFrame = shotMediaMap[sid]?.imageUrl;
          if (firstFrame) refImages.push({ url: firstFrame, role: 'first_frame' });
          const lastFrame = shotMediaMap[sid]?.lastFrameImageUrl;
          if (lastFrame) refImages.push({ url: lastFrame, role: 'last_frame' });
          this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap).forEach(url => refImages.push({ url, role: 'character' }));
          // P6: 注入 Shot 首帧图丰富 Kling elements 身份数据（不同角度/表情/场景，零成本）
          const shotCharIds = new Set((shot.characters ?? []).map(c => c.characterId));
          for (const cid of shotCharIds) {
            for (const url of characterShotImages.get(cid) ?? []) {
              if (url !== firstFrame && !refImages.some(r => r.url === url)) {
                refImages.push({ url, role: 'character' });
              }
            }
          }
          styleRefImages.slice(0, 1).forEach((url) => refImages.push({ url, role: 'style' }));

          // P1-1: 前帧锚定 — 用前一 Shot 的尾帧锚定视频连贯性
          // V3-fix: 同场景使用 character 角色追踪（身份+服饰强约束），跨场景仅 style（色调/光影）
          // 影视原则：同场景连续镜头的角色外貌必须一致（同一个演员），跨场景只需色调统一
          if (shot.shotIndex > 0) {
            const prevShot = shots.find(s => s.shotIndex === shot.shotIndex - 1);
            if (prevShot) {
              const prevSid = prevShot.shotId;
              const prevLastFrame = shotMediaMap[prevSid]?.lastFrameImageUrl || shotMediaMap[prevSid]?.imageUrl;
              if (prevLastFrame) {
                const isSameScene = prevShot.sceneId === shot.sceneId;
                refImages.push({ url: prevLastFrame, role: isSameScene ? 'character' : 'style' });
              }
            }
          }

          const mediaParams = shotMediaParamsCache.get(sid);
          const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);

          const styleLockedVideoPrompt = this.shotContextService.applyStyleLockPrompt(shot.visualPrompt, shot, state);
          
          // 锁定使用 Kling 生成并规范时长
          const actualProvider = 'kling';
          const submitDuration = MediaOrchestratorService.clampDuration(shot.estimatedDurationSec, actualProvider);
          const videoQuality = shotPolicy.videoQuality;

          const optVideo = this.promptOptimizer.optimizeForT2V(styleLockedVideoPrompt, {
            provider: actualProvider,
            duration: shot.estimatedDurationSec,
            hasFirstFrame: !!firstFrame,
            hasLastFrame: !!lastFrame,
            specialTechnique: shot.specialTechnique ?? undefined,
            cameraMovement: shot.camera?.movement,
            shotSize: shot.camera?.shotSize,
            cameraAngle: shot.camera?.cameraAngle,
            emotionColorHint: mediaParams?.colorGrade,
            routeProfile: shotPolicy.routeProfile,
            dialogueEmotion: shot.dialogue?.emotion,
            dialoguePace: shot.dialogue?.pace,
            dialogueVolume: shot.dialogue?.volume,
            dramaShotType: shot.shotType,
            shotType: 'shot_video',
          });

          // P7: Kling 3.0 精准多元素引用 (专属生成流)
          let extraParams: Record<string, unknown> | undefined;
          const klingElements: Array<{name: string, description: string, element_input_urls: string[]}> = [];
          const charIds = Array.from(new Set([
              ...this.shotContextService.resolveLockedCharacterIds(shot),
              ...(shot.characters ?? []).map(c => c.characterId)
          ])).slice(0, 3);
          
          const promptTags: string[] = [];
          for (let k = 0; k < charIds.length; k++) {
            const charId = charIds[k];
            const safeName = `char_${charId.replace(/[^a-zA-Z0-9]/g, '')}_${k}`;
            const charUrls = new Set<string>();
            const cmap = charImageMap.get(charId);
            if (cmap?.primary) charUrls.add(cmap.primary);
            (characterAnchorMap.get(charId) ?? []).forEach(u => charUrls.add(u));
            (characterShotImages.get(charId) ?? []).forEach(u => charUrls.add(u));
            
            const urlsArr = Array.from(charUrls).filter(Boolean);
            if (urlsArr.length > 0) {
               klingElements.push({
                 name: safeName, description: 'Character reference',
                 element_input_urls: urlsArr.slice(0, 4)
               });
               promptTags.push(`@${safeName}`);
            }
          }
          if (klingElements.length > 0) {
             extraParams = { kling_elements: klingElements };
             optVideo.prompt += ` ${promptTags.join(' ')}`;
          }

          const sub = await withMediaRetry(() => this.mediaService.submitVideo({
            prompt: optVideo.prompt,
            duration: submitDuration,
            quality: videoQuality, aspectRatio: aspectRatio as any,
            referenceImages: refImages, dramaId, assetType: 'shot_video', refId: sid, userId, episodeNumber,
            provider: actualProvider,
            extra: extraParams,
          }), `${sid} 视频`);
          shotMediaMap[sid] = { ...shotMediaMap[sid], videoJobId: sub.jobId, videoProvider: actualProvider, status: 'submitted' };
          await this.shotMediaRepo.upsert({ ...shotMediaMap[sid], episodeId: episode.id, shotId: sid }, ['episodeId', 'shotId']);
        } catch (err) {
          this.logger.error(`${sid} 视频提交失败: ${(err as Error).message}`);
          const fallbackImage = shotMediaMap[sid]?.imageUrl;
          if (fallbackImage) {
            this.logger.warn(`${sid} I2V降级: 使用首帧 Ken Burns 代替视频`);
            shotMediaMap[sid] = { ...shotMediaMap[sid], videoUrl: fallbackImage, status: 'completed', kenBurnsFallback: true };
          } else {
            shotMediaMap[sid] = { ...shotMediaMap[sid], status: 'failed' };
          }
          await this.shotMediaRepo.upsert({ ...shotMediaMap[sid], episodeId: episode.id, shotId: sid }, ['episodeId', 'shotId']);
        }
      });
      await this.awaitVideoJobs(shotMediaMap, orderedShots, dramaId, episode.id, phaseOff, emit);
      phaseOff += shots.length;

      // ═══ Phase 2: TTS 语音合成 ═══
      const ttsDurations = new Map<string, number>();
      let ttsOk = false;
      try { this.registry.getTtsProvider(); ttsOk = true; } catch {}
      if (ttsOk) {
        const TTS_MAX_RETRIES = 2;
        const FALLBACK_VOICE_ID = 'zh_female_vv_uranus_bigtts'; // Vivi 2.0 通用女声，作为音色不可用时的安全降级
        const NARRATOR_VOICE_ID = 'zh_male_cixingjieshuonan_uranus_bigtts'; // 磁性解说男声 2.0，旁白专用
        const voiceMap = new Map(state.characters?.map(c => [c.characterId, c.voiceProfile]) ?? []);

        const ttsShots = orderedShots.filter(shot =>
          shot.dialogue?.text && !shot.isPreview && !shotMediaMap[shot.shotId]?.ttsUrl
        );

        await this.runConcurrent(ttsShots, 3, async (shot, idx) => {
          const voice = voiceMap.get(shot.dialogue!.characterId);
          const mediaParams = shotMediaParamsCache.get(shot.shotId);
          const baseSpeed = SPEED_MAP[voice?.speed ?? 'normal'] ?? 1.0;
          const ttsSpeed = baseSpeed * (mediaParams?.ttsSpeedMultiplier ?? 1.0) * (mediaParams?.ttsPaceMultiplier ?? 1.0);
          const globalIdx = orderedShots.indexOf(shot);
          emit(phaseOff + globalIdx, `${shot.shotId} TTS...`);
          const outPath = this.storage.ttsOutputPath(dramaId, shot.shotId);

          // 旁白/画外音/内心独白处理
          const isNarrator = shot.dialogue!.characterId === 'narrator' || shot.dialogue!.isVoiceover;
          const isInnerThought = shot.dialogue!.isInnerThought;

          let ttsSuccess = false;
          for (let attempt = 0; attempt <= TTS_MAX_RETRIES && !ttsSuccess; attempt++) {
            let useVoiceId: string;
            if (attempt > TTS_MAX_RETRIES - 1) {
              useVoiceId = FALLBACK_VOICE_ID; // 最后一次尝试使用安全降级音色
            } else if (isNarrator) {
              useVoiceId = NARRATOR_VOICE_ID; // 旁白专用音色
            } else {
              useVoiceId = voice?.ttsVoiceId || '';
            }
            try {
              const ttsRes = await this.mediaService.synthesizeTtsToFile({
                request: {
                  text: shot.dialogue!.text, voiceId: useVoiceId,
                  speed: ttsSpeed,
                  emotion: isNarrator ? 'neutral' : (mediaParams?.ttsEmotion || shot.dialogue!.emotion),
                  extra: {
                    volume: shot.dialogue!.volume,
                    volumeMultiplier: isInnerThought ? (mediaParams?.ttsVolumeMultiplier ?? 1.0) * 0.75 : mediaParams?.ttsVolumeMultiplier,
                    ...(isInnerThought ? { style: 0.3, stability: 0.8 } : {}), // 内心独白：压低风格化 + 提高稳定性，让语气更内救
                  },
                },
                outputPath: outPath,
                dramaId, userId, episodeNumber: episode.episodeNumber,
              });
              shotMediaMap[shot.shotId] = { ...shotMediaMap[shot.shotId], ttsUrl: ttsRes.audioUrl };
              if (ttsRes.durationSeconds > 0) ttsDurations.set(shot.shotId, ttsRes.durationSeconds);
              ttsSuccess = true;
              emit(phaseOff + globalIdx, `${shot.shotId} TTS完成`, true);
            } catch (err) {
              if (attempt < TTS_MAX_RETRIES) {
                this.logger.warn(`${shot.shotId} TTS第${attempt + 1}次失败，重试: ${(err as Error).message}`);
              } else {
                this.logger.warn(`${shot.shotId} TTS最终失败(${TTS_MAX_RETRIES + 1}次尝试): ${(err as Error).message}`);
              }
            }
          }
        });
      } else { this.logger.warn('TTS Provider 未配置，跳过语音合成'); }

      // ═══ Phase 2.5: AI SFX 批量生成（sound-effect-v2，失败自动降级静态） ═══
      // enablePipelineSfx = false 时跳过（sound-effect-v2 暂不可用），恢复后在 generation-policy 中改为 true
      if (mediaPolicy.enablePipelineSfx) {
        let sfxProvider: import('../../media/interfaces/media-provider.interface').AudioProvider | null = null;
        try { sfxProvider = this.registry.getAudioProvider(); } catch {}
        if (sfxProvider && sfxProvider.generateSync) {
          await this.updateMediaStatus(episode.id, 'generating_sfx');
          this.logger.log(`E${episodeNumber} Phase 2.5: AI SFX 批量生成，并发 ${mediaPolicy.sfxConcurrency}`);
          const sfxShots = orderedShots.filter(s => !s.isPreview && (s.audio?.sfx?.length ?? 0) > 0);
          const sfxProviderRef = sfxProvider; // 闭包引用，排除 null 检查
          await this.runConcurrent(sfxShots, mediaPolicy.sfxConcurrency, async (shot) => {
            // 断点续传：本次已有 sfxUrl 则跳过
            if (shotMediaMap[shot.shotId]?.sfxUrl) return;
            const sfxPrompt = this.buildSfxPrompt(shot);
            try {
              const sfxResult = await sfxProviderRef.generateSync!({
                prompt: sfxPrompt,
                duration: Math.min(shot.estimatedDurationSec ?? 5, 22), // SFX v2 最大 22s
              });
              if (sfxResult?.status === 'completed' && sfxResult.audioUrl) {
                shotMediaMap[shot.shotId] = { ...shotMediaMap[shot.shotId], sfxUrl: sfxResult.audioUrl };
                this.logger.debug(`${shot.shotId} AI SFX 完成: ${sfxResult.audioUrl}`);
              } else {
                this.logger.warn(`${shot.shotId} AI SFX 未成功(status=${sfxResult?.status})，降级静态`);
              }
            } catch (sfxErr) {
              // 失败静默降级：compose 阶段会用 audioResource 静态兜底
              this.logger.warn(`${shot.shotId} AI SFX 失败，降级静态: ${(sfxErr as Error).message}`);
            }
          });
          this.logger.log(`E${episodeNumber} Phase 2.5 完成，${sfxShots.length} 个 Shot SFX 处理完毕`);
        } else {
          this.logger.warn('Audio Provider 未配置或不支持 generateSync，跳过 Phase 2.5 AI SFX');
        }
      }

      // ═══ Phase 3: FFmpeg 合成（TTS 时长同步 + per-shot 后处理参数） ═══
      let videoUrl = '';
      if (this.composer.isAvailable()) {
        try {
          emit(totalPhases - 1, '合成完整单集视频...');
          await this.updateMediaStatus(episode.id, 'compositing');
          const composeShots: ComposeShotInput[] = shots.filter(s => shotMediaMap[s.shotId]?.videoUrl).map(s => {
            const mp = shotMediaParamsCache.get(s.shotId);
            const ttsDur = ttsDurations.get(s.shotId);

            // ── 有效时长上限：不能超过该 shot 实际 Provider 的最大视频时长 ──────────
            // 根据 Phase 1 记录的 videoProvider 精确计算，而非按 shotType 猜测。
            // 若分镜意图 > 实际生成上限，compose 时长必须截断，
            // 否则 FFmpeg trimOutSec 超出视频实际长度 → 时间轴缺失 → 音频错位。
            const generatedMaxSec = MediaOrchestratorService.getProviderMaxDuration(shotMediaMap[s.shotId]?.videoProvider);
            let effectiveDuration = Math.min(s.estimatedDurationSec, generatedMaxSec);
            if (effectiveDuration < s.estimatedDurationSec) {
              this.logger.debug(`${s.shotId} 分镜意图${s.estimatedDurationSec}s > 生成上限${generatedMaxSec}s，compose 截为 ${effectiveDuration}s`);
            }

            let speedFactor = mp?.speedFactor ?? 1.0;
            if (ttsDur && ttsDur > effectiveDuration * 1.1) {
              const ratio = ttsDur / effectiveDuration;
              // 核心修复：如果 TTS 极长而生成的视频物理时长不足，若不降低播放速度（speedFactor）去凑齐物理帧，
              // FFmpeg concat 滤镜会在视频流提前 EOF 时截断该分段时长，导致所有后续视频与音频发生灾难性毁灭错位 (A/V Desync)！
              // 故在此执行强制拉长。为防幻灯片效应，软顶（Soft cap）设为最多强制拉到 3 倍慢放。
              const safeRatio = Math.min(ratio, 3.0);
              speedFactor = speedFactor / safeRatio;
              effectiveDuration = ttsDur;
              this.logger.debug(`${s.shotId} 强行减速 ${safeRatio.toFixed(2)}x 匹配TTS (${ttsDur.toFixed(1)}s)，防止音画脱轨`);
            }

            return {
              shotId: s.shotId, videoPath: shotMediaMap[s.shotId].videoUrl!,
              ttsAudioPath: shotMediaMap[s.shotId]?.ttsUrl, durationSec: effectiveDuration,
              // 独立 Shot：沿用原有人工标注或 effectiveDuration。
              trimInSec: s.trimInSec ?? undefined,
              trimOutSec: s.trimOutSec ?? effectiveDuration,
              transition: s.transitionToNext ?? 'cut',
              transitionDurationSec: mp?.transitionDurationSec,
              subtitle: s.subtitle ? {
                text: s.subtitle.text,
                style: s.subtitle.style ?? 'normal',
                characterId: s.subtitle.characterId ?? s.dialogue?.characterId,
                position: s.subtitle.position ?? 'bottom',
                ttsDurationSec: ttsDurations.get(s.shotId),
                karaoke: true,
              } : undefined,
              bgmPath: s.audio?.bgm?.mood ? (this.audioResource.resolveBgm(s.audio.bgm.mood) ?? undefined) : undefined,
              bgmIntensity: (s.audio?.bgm?.intensity ?? 0.3) * (mp?.bgmVolumeMultiplier ?? 1.0),
              bgmAction: s.audio?.bgm?.action,
              sfxPaths: [
                ...(shotMediaMap[s.shotId]?.sfxUrl ? [shotMediaMap[s.shotId].sfxUrl] : []),
                ...(s.audio?.sfx?.map(fx => this.audioResource.resolveSfx(fx.sound)).filter(Boolean) as string[] || [])
              ],
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

      const finalStatus: EpisodeMediaStatus = 'completed';
      await this.pushShotMediaMap(episode.id, shotMediaMap);
      await this.episodeRepo.update(episode.id, { mediaStatus: finalStatus, videoUrl: videoUrl || undefined });
      this.logger.log(`E${episodeNumber} 媒体完成: ${finalStatus} | video=${videoUrl ? 'yes' : 'no'}`);
      return { mediaStatus: finalStatus, shotMediaMap, videoUrl: videoUrl || undefined };
    } catch (err) {
      await this.episodeRepo.update(episode.id, { mediaStatus: 'failed', mediaError: (err as Error).message });
      throw err;
    }
  }

  /**
   * 单镜图片生成 — 仅生成指定 Shot 的首帧图，同步返回 imageUrl。
   * 用于制作台"逐 Shot 手动触发"场景；前端等待 HTTP 响应即可，无需 SSE。
   *
   * 通过 withEpisodeLock 串行化同集请求，保证后生成的 Shot 能读到
   * 前面已写入 DB 的首帧图作为参考，避免 refs=0 盲生成。
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

    // 串行锁：同一集内的图片生成请求排队，确保前帧参考图可用
    return this.withEpisodeLock(episode.id, () => this._doGenerateShotImage(dramaId, episodeNumber, shotId, episode, shot, storyboard));
  }

  /** generateShotImage 内部实现（被 episodeLock 保护） */
  private async _doGenerateShotImage(
    dramaId: string, episodeNumber: number, shotId: string,
    episode: EpisodeEntity, shot: Shot, storyboard: EpisodeStoryboard,
  ): Promise<{ imageUrl: string }> {

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
    const characterAnchorMap = this.shotContextService.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    await this.ensureVariationImages(dramaId, state, [shot], charImageMap, variationImageMap, userId, episodeNumber);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1
    const propImageMap = await this.buildPropImageMap(dramaId);
    const propOwnerMap = this.buildPropOwnerMap(state);
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);

    // 用已有媒体填充场景 & 前帧缓存，以保持视觉连贯性
    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const raw: Record<string, ShotMediaEntry> = Object.fromEntries(mediaList.map(m => [m.shotId, m as unknown as ShotMediaEntry]));
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
    // 场景光线提示（单 shot 模式）—— 通过 sceneId → locationId 映射查找
    const singleLocId = sceneForShot?.locationId || shot.sceneId;
    const singleShotLighting = state.locations?.find(l => l.locationId === singleLocId)?.lightingDefault;
    const singleSceneVisualPrompt = state.locations?.find(l => l.locationId === singleLocId)?.visualPrompt;
    const mediaParams = this.emotionMapper.mapShotToMediaParams(shot, sceneForShot);
    const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);
    const singleShotRoute = this.imageRouter.routeShot({
      qualityTier: shot.qualityTier,
      shotSize: shot.camera?.shotSize,
      cameraAngle: shot.camera?.cameraAngle,
      isGolden: shot.isPreview || shot.qualityTier === 'golden',
      size: imgSize,
    });
    const styleLockedPrompt = this.shotContextService.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
    const rawPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedPrompt, {
      stylePrefix: t2iStylePrefix || '',
      maxTokens: Infinity, provider: singleShotRoute.provider || '',
      batchLighting: singleShotLighting,
      sceneVisualPrompt: singleSceneVisualPrompt,
    });
    const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
      shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
      qualityTier: shot.qualityTier ?? 'standard',
      shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams.colorGrade,
      routeProfile: shotPolicy.routeProfile,
      provider: singleShotRoute.provider,
      ambientPopulation: state.locations?.find(l => l.locationId === singleLocId)?.ambientPopulation,
    });
    const refs = this.shotContextService.buildRefImages(
      shot,
      charImageMap,
      variationImageMap,
      characterAnchorMap,
      styleRefImages,
      sceneCache,
      prevFrameCache,
      'first', this.profile,
      undefined,
      propImageMap, propOwnerMap,
    );
    const existing = (raw[shotId] ?? {}) as Partial<ShotMediaEntry>;
    await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, status: 'generating_image' }, ['episodeId', 'shotId']);

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
    
    try {
      if (shouldUseQualityGate) {
      const characterRefs = this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
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
    } catch (err) {
      await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, status: 'failed' }, ['episodeId', 'shotId']);
      throw err;
    }

    if (imgUrl) {
      // 重新生成图片时，丢弃旧的 video 数据，避免"新图+旧视频"错位
      const updated = {
        ...existing,
        imageUrl: imgUrl,
        status: 'image_done',
        qc: gateQc ?? existing?.qc,
        t2iPrompt: optimized.prompt,
        t2iNegativePrompt: optimized.negativePrompt || undefined,
      };
      await this.shotMediaRepo.upsert({ ...existing, ...updated, shotId, episodeId: episode.id }, ['episodeId', 'shotId']);
      try { await this.storage.downloadToLocal(imgUrl, this.storage.imageOutputPath(dramaId, shotId)); } catch {}
      this.logger.log(`[ShotImage] ${shotId} → ${imgUrl}`);

      // 生成尾帧（如果有描述）
      if (shot.lastFramePrompt) {
        try {
          const isCloseUpResumed = ['close_up', 'extreme_close_up', 'medium_close_up'].includes(shot.camera?.shotSize ?? '');
          if (shot.sceneId && !sceneCache.has(shot.sceneId) && !isCloseUpResumed) sceneCache.set(shot.sceneId, imgUrl);
          prevFrameCache.set(shot.shotIndex, imgUrl);

          const lastRefs = this.shotContextService.buildRefImages(
            shot, charImageMap, variationImageMap, characterAnchorMap, styleRefImages,
            sceneCache, prevFrameCache, 'last', this.profile, undefined, propImageMap, propOwnerMap,
          );
          const styleLockedLastPrompt = this.shotContextService.applyStyleLockPrompt(shot.lastFramePrompt, shot, state);
          const rawLastPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedLastPrompt, {
            stylePrefix: t2iStylePrefix || '', maxTokens: Infinity, provider: singleShotRoute.provider || '',
            batchLighting: singleShotLighting, sceneVisualPrompt: singleSceneVisualPrompt,
          });
          const optLast = this.promptOptimizer.optimizeForT2I(rawLastPrompt, episodeNegPrompt ?? '', {
            shotType: 'last_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
            qualityTier: shot.qualityTier ?? 'standard', emotionColorHint: mediaParams.colorGrade,
            shotSize: shot.camera?.shotSizeEnd ?? shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle,
            composition: shot.camera?.composition, depthOfField: shot.camera?.depthOfField,
            specialTechnique: shot.specialTechnique ?? undefined,
            routeProfile: shotPolicy.routeProfile, provider: singleShotRoute.provider,
            ambientPopulation: state.locations?.find(l => l.locationId === singleLocId)?.ambientPopulation,
          });

          const genLastFn = async () => {
             const res = await this.withRetry(
               async () => {
                 await this.acquireT2iSlot();
                 return this.mediaService.generateImage({
                   prompt: optLast.prompt, negativePrompt: optLast.negativePrompt || undefined,
                   size: imgSize, count: 1, referenceImages: lastRefs, dramaId, assetType: 'shot_last_frame', refId: `${shotId}_last`, userId, episodeNumber,
                   ...singleShotRoute,
                 });
               },
               `${shotId} 尾帧`,
               mediaPolicy.maxMediaRetries,
               mediaPolicy.retryBaseDelayMs,
             );
             return res.images?.[0]?.url ?? '';
          };

          let lastUrl = '';
          if (shouldUseQualityGate) {
            const gateResult = await this.qualityGate.generateWithQualityGate(genLastFn, {
              maxAttempts: shotPolicy.gateMaxAttempts, minScore: shotPolicy.gateMinScore, qualityTier: tier,
              prompt: optLast.prompt, characterRefs: this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap),
              styleRefs: styleRefImages, candidateCount: shotPolicy.candidateCount, dramaId, userId, episodeNumber,
            });
            lastUrl = gateResult.imageUrl;
          } else {
            lastUrl = await genLastFn();
          }

          if (lastUrl) {
            await this.shotMediaRepo.update({ episodeId: episode.id, shotId }, { lastFrameImageUrl: lastUrl, lastFrameT2iPrompt: optLast.prompt });
            try { await this.storage.downloadToLocal(lastUrl, this.storage.imageOutputPath(dramaId, `${shotId}_last`)); } catch {}
            this.logger.log(`[ShotImage] ${shotId} 尾帧 → ${lastUrl}`);
          }
        } catch (err) {
          this.logger.warn(`[ShotImage] ${shotId} 尾帧失败: ${(err as Error).message}`);
        }
      }
    }
    return { imageUrl: imgUrl };
  }

  /** 单镜视频生成（同步 HTTP，适合制作台逐 Shot 手动触发）*/
  async generateShotVideo(dramaId: string, episodeNumber: number, shotId: string): Promise<{ videoUrl: string; status: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shot = storyboard.shots?.find((s: Shot) => s.shotId === shotId);
    if (!shot) throw new Error(`Shot ${shotId} 不存在`);

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const userId = drama.userId;
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';

    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const raw: Record<string, ShotMediaEntry> = Object.fromEntries(mediaList.map(m => [m.shotId, m as unknown as ShotMediaEntry]));
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.shotContextService.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);

    const refImages: Array<{ url: string; role: 'first_frame' | 'last_frame' | 'character' | 'style' }> = [];
    const firstFrame = raw[shotId]?.imageUrl;
    if (!firstFrame) throw new Error(`Shot ${shotId} 尚未生成首帧图片，请先生成图片再生成视频`);
    refImages.push({ url: firstFrame, role: 'first_frame' });
    const lastFrame = raw[shotId]?.lastFrameImageUrl;
    if (lastFrame) refImages.push({ url: lastFrame, role: 'last_frame' });
    this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap).forEach(url => refImages.push({ url, role: 'character' }));
    // P6: 单镜视频重生成也注入 Shot 首帧图丰富 Kling elements
    {
      const allShots: Shot[] = storyboard.shots ?? [];
      const closeUpSizes = new Set(['close_up', 'extreme_close_up', 'medium_close_up', 'medium']);
      const shotCharIds = new Set((shot.characters ?? []).map(c => c.characterId));
      const candidateUrls: string[] = [];
      // 优先特写/近景
      const sorted = [...allShots]
        .filter(s => s.shotId !== shotId && !s.isFlashback && !s.isPreview && raw[s.shotId]?.imageUrl)
        .sort((a, b) => {
          const aClose = closeUpSizes.has(a.camera?.shotSize ?? '') ? 0 : 1;
          const bClose = closeUpSizes.has(b.camera?.shotSize ?? '') ? 0 : 1;
          return aClose - bClose;
        });
      for (const s of sorted) {
        if (candidateUrls.length >= 3) break;
        const hasChar = (s.characters ?? []).some(c => shotCharIds.has(c.characterId));
        if (hasChar) {
          const url = raw[s.shotId]!.imageUrl!;
          if (url !== firstFrame && !refImages.some(r => r.url === url) && !candidateUrls.includes(url)) {
            candidateUrls.push(url);
          }
        }
      }
      candidateUrls.forEach(url => refImages.push({ url, role: 'character' }));
    }
    styleRefImages.slice(0, 1).forEach(url => refImages.push({ url, role: 'style' }));

    const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);
    const styleLockedVideoPrompt = this.shotContextService.applyStyleLockPrompt(shot.visualPrompt, shot, state);
    
    // 锁定使用 Kling 生成并规范时长
    const actualProvider = 'kling';
    const submitDuration = MediaOrchestratorService.clampDuration(shot.estimatedDurationSec, actualProvider);
    const videoQuality = shotPolicy.videoQuality;

    const scriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
    const sceneForShot = scriptScenes.find(s => s.sceneId === shot.sceneId);
    const mediaParams = this.emotionMapper.mapShotToMediaParams(shot, sceneForShot);

    const optVideo = this.promptOptimizer.optimizeForT2V(styleLockedVideoPrompt, {
      provider: actualProvider,
      duration: shot.estimatedDurationSec,
      hasFirstFrame: !!firstFrame,
      hasLastFrame: !!lastFrame,
      specialTechnique: shot.specialTechnique ?? undefined,
      cameraMovement: shot.camera?.movement,
      shotSize: shot.camera?.shotSize,
      cameraAngle: shot.camera?.cameraAngle,
      emotionColorHint: mediaParams?.colorGrade,
      routeProfile: shotPolicy.routeProfile,
      dramaShotType: shot.shotType,
      shotType: 'shot_video',
    });

    const existing = raw[shotId] ?? {};
    await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, status: 'generating_video' }, ['episodeId', 'shotId']);

    // P7: Kling 3.0 精准多元素引用 (专属生成流)
    let extraParams: Record<string, unknown> | undefined;
    const klingElements: Array<{name: string, description: string, element_input_urls: string[]}> = [];
    const charIds = Array.from(new Set([
        ...this.shotContextService.resolveLockedCharacterIds(shot),
        ...(shot.characters ?? []).map(c => c.characterId)
    ])).slice(0, 3);
    
    const promptTags: string[] = [];
    for (let k = 0; k < charIds.length; k++) {
      const charId = charIds[k];
      const safeName = `char_${charId.replace(/[^a-zA-Z0-9]/g, '')}_${k}`;
      const charUrls = new Set<string>();
      const cmap = charImageMap.get(charId);
      if (cmap?.primary) charUrls.add(cmap.primary);
      (characterAnchorMap.get(charId) ?? []).forEach(u => charUrls.add(u));
      
      // 单镜重跑时通过 raw 拿到该角色所有曾参与过的镜头首帧，作为一致性补充图
      for (const s of storyboard.shots ?? []) {
        if (s.shotId !== shotId && (s.characters ?? []).some(c => c.characterId === charId) && raw[s.shotId]?.imageUrl) {
          charUrls.add(raw[s.shotId].imageUrl);
        }
      }
      
      const urlsArr = Array.from(charUrls).filter(Boolean);
      if (urlsArr.length > 0) {
         klingElements.push({
           name: safeName, description: 'Character reference',
           element_input_urls: urlsArr.slice(0, 4)
         });
         promptTags.push(`@${safeName}`);
      }
    }
    if (klingElements.length > 0) {
       extraParams = { kling_elements: klingElements };
       optVideo.prompt += ` ${promptTags.join(' ')}`;
    }

    let videoUrl = '';
    try {
      const sub = await this.withRetry(() => this.mediaService.submitVideo({
        prompt: optVideo.prompt,
        duration: submitDuration,
        quality: videoQuality,
        aspectRatio: aspectRatio as any,
        referenceImages: refImages,
        dramaId, assetType: 'shot_video', refId: shotId, userId, episodeNumber,
        provider: actualProvider,
        extra: extraParams,
      }), `${shotId} 单镜视频`, mediaPolicy.maxMediaRetries, mediaPolicy.retryBaseDelayMs);

      await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, videoJobId: sub.jobId, videoProvider: actualProvider, status: 'submitted' }, ['episodeId', 'shotId']);

      // 等待单个 job 完成
      videoUrl = await new Promise<string>((resolve, reject) => {
      const timeoutMs = this.videoAwaitTimeoutMs;
      const timer = setTimeout(() => {
        this.mediaService.offJobCompleted(handler);
        reject(new Error(`Shot ${shotId} 视频生成超时`));
      }, timeoutMs);

      const handler = async (evt: { jobId: string; status: string; result?: Record<string, unknown> }) => {
        if (evt.jobId !== sub.jobId) return;
        clearTimeout(timer);
        this.mediaService.offJobCompleted(handler);
        if (evt.status === 'completed') {
          resolve((evt.result as any)?.videoUrl ?? '');
        } else {
          const fb = raw[shotId]?.imageUrl ?? '';
          resolve(fb); // 降级：用首帧代替
        }
      };

      // 先补查一次，避免 job 已完成但事件来不及收到
      this.mediaService.findJob(sub.jobId).then(job => {
        if (!job) return;
        if (job.status === 'completed') {
          clearTimeout(timer);
          this.mediaService.offJobCompleted(handler);
          resolve((job.result as any)?.videoUrl ?? '');
        } else if (job.status === 'failed') {
          clearTimeout(timer);
          this.mediaService.offJobCompleted(handler);
          resolve(raw[shotId]?.imageUrl ?? '');
        }
      }).catch(() => {});

      this.mediaService.onJobCompleted(handler);
    });
    } catch (err) {
      await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, status: 'failed' }, ['episodeId', 'shotId']);
      throw err;
    }

    const isFallback = !videoUrl || videoUrl === firstFrame;
    await this.shotMediaRepo.upsert({
      ...existing, shotId, episodeId: episode.id,
      videoUrl: videoUrl || firstFrame, status: 'completed',
      ...(isFallback && !videoUrl ? { kenBurnsFallback: true } : {})
    }, ['episodeId', 'shotId']);
    if (videoUrl) {
      try { await this.storage.downloadToLocal(videoUrl, this.storage.resolve(`videos/${dramaId}/${shotId}.mp4`)); } catch {}
    }
    this.logger.log(`[ShotVideo] ${shotId} → ${videoUrl || '(降级首帧)'}`);
    return { videoUrl: videoUrl || firstFrame || '', status: 'completed' };
  }

  /** 单镜音效生成 (T2A) — 音效生成后自动 FFmpeg mux 到视频 */
  async generateShotSfx(dramaId: string, episodeNumber: number, shotId: string): Promise<{ sfxUrl: string; status: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shot = storyboard.shots?.find((s: Shot) => s.shotId === shotId);
    if (!shot) throw new Error(`Shot ${shotId} 不存在`);

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const raw: Record<string, ShotMediaEntry> = Object.fromEntries(mediaList.map(m => [m.shotId, m as unknown as ShotMediaEntry]));
    const existing = (raw[shotId] ?? {}) as Partial<ShotMediaEntry>;

    const hasDialogue = !!shot.dialogue?.text?.trim();

    // ── 0. 没台词，而且关闭了 SFX，那就直接跳过不用生成 ───────────────────
    if (this.skipSfxGen && !hasDialogue) {
      this.logger.log(`[ShotSfx] ${shotId} 无台词，且 SFX 处于禁用状态，跳过声音生成`);
      return { sfxUrl: '', status: 'skipped' };
    }

    // ── 1. 必须先有视频 ────────────────────────────────────────────────────
    const videoUrl = existing.videoUrl;
    if (!videoUrl) throw new Error(`Shot ${shotId} 尚未生成视频，请先生成视频再生成声音`);

    let finalTtsUrl = '';
    let finalTtsLocalPath = '';

    // ── 2. TTS 生成（如果有台词）────────────────────────────────────────────
    if (hasDialogue) {
      this.logger.log(`[ShotSfx] ${shotId} 开始生成 TTS 配音: ${shot.dialogue!.text.slice(0, 20)}`);
      const state = drama.state as unknown as DramaState;
      const voiceMap = new Map(state.characters?.map(c => [c.characterId, c.voiceProfile]) ?? []);
      const voice = voiceMap.get(shot.dialogue!.characterId);
      const baseSpeed = SPEED_MAP[voice?.speed ?? 'normal'] ?? 1.0;
      const paceMultiplier = { very_slow: 0.75, slow: 0.85, normal: 1.0, fast: 1.15, very_fast: 1.3 }[shot.dialogue!.pace ?? 'normal'] ?? 1.0;
      const outPath = this.storage.ttsOutputPath(dramaId, shot.shotId);

      try {
        const useVoiceId = voice?.ttsVoiceId || '';
        const ttsRes = await this.mediaService.synthesizeTtsToFile({
          request: {
            text: shot.dialogue!.text!, voiceId: useVoiceId,
            speed: baseSpeed * paceMultiplier, emotion: shot.dialogue!.emotion,
            extra: { volume: shot.dialogue!.volume },
          },
          outputPath: outPath,
          dramaId, userId: drama.userId, episodeNumber: episode.episodeNumber,
        });

        let ttsUploadUrl = ttsRes.audioUrl;
        if (this.ossService && fs.existsSync(outPath)) {
          try {
            const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
            const ossPath = `media/audio/${datePrefix}/${dramaId}/tts_${shotId}_${Date.now()}.mp3`;
            const uploadRes = await this.ossService.uploadFile(ossPath, outPath);
            ttsUploadUrl = uploadRes.url;
            this.logger.log(`[ShotSfx] TTS 已推送 OSS: ${ttsUploadUrl}`);
          } catch (e) {
            this.logger.warn(`[ShotSfx] TTS OSS上传失败: ${(e as Error).message}`);
          }
        }

        finalTtsUrl = ttsUploadUrl;
        finalTtsLocalPath = outPath;
        // 先写一次 TTS 库
        await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, ttsUrl: finalTtsUrl } as any, ['episodeId', 'shotId']);
      } catch (err) {
        this.logger.warn(`[ShotSfx] ${shotId} TTS 生成失败: ${(err as Error).message}`);
      }
    }

    // ── 3. 音效/SFX 生成（如果没有 skipSfxGen）──────────────────────────────
    let sfxUrl = '';
    let sfxLocalPath = '';
    let sfxPrompt = '';
    
    if (!this.skipSfxGen) {
      sfxPrompt = this.buildSfxPrompt(shot);
      this.logger.log(`[ShotSfx] ${shotId} 开始 | prompt="${sfxPrompt.slice(0, 80)}..."`);
      await this.shotMediaRepo.upsert(
        { ...existing, shotId, episodeId: episode.id, sfxStatus: 'generating', sfxPrompt } as any,
        ['episodeId', 'shotId'],
      );

      try {
        const sub = await this.withRetry(
          () => this.mediaService.submitAudio({
            prompt: sfxPrompt,
            duration: Math.min(shot.estimatedDurationSec ?? 5, 22),
            referenceVideoUrl: videoUrl,
            dramaId, assetType: 'shot_sfx', refId: shotId, userId: drama.userId, episodeNumber,
          }),
          `${shotId} 单镜音效`, 2, 2000,
        );

        await this.shotMediaRepo.upsert(
          { ...existing, shotId, episodeId: episode.id, sfxJobId: sub.jobId, sfxStatus: 'submitted' } as any,
          ['episodeId', 'shotId'],
        );

        sfxUrl = await new Promise<string>((resolve, reject) => {
          const timeoutMs = 90_000;
          const timer = setTimeout(() => {
            this.mediaService.offJobCompleted(handler);
            reject(new Error(`Shot ${shotId} 音效生成超时`));
          }, timeoutMs);

          const handler = async (evt: { jobId: string; status: string; result?: Record<string, unknown> }) => {
            if (evt.jobId !== sub.jobId) return;
            clearTimeout(timer);
            this.mediaService.offJobCompleted(handler);
            if (evt.status === 'completed') {
              resolve((evt.result as any)?.audioUrl ?? '');
            } else {
              reject(new Error('音效生成失败'));
            }
          };

          this.mediaService.findJob(sub.jobId).then(job => {
            if (!job) return;
            if (job.status === 'completed') {
              clearTimeout(timer);
              this.mediaService.offJobCompleted(handler);
              resolve((job.result as any)?.audioUrl ?? '');
            } else if (job.status === 'failed') {
              clearTimeout(timer);
              this.mediaService.offJobCompleted(handler);
              reject(new Error(job.error || '音效生成失败'));
            }
          }).catch(() => {});

          this.mediaService.onJobCompleted(handler);
        });
      } catch (err) {
        const status = (err as any)?.response?.status ?? (err as any)?.status;
        const is4xx = typeof status === 'number' && status >= 400 && status < 500;
        if (is4xx) {
          this.logger.warn(`[ShotSfx] ${shotId} 音效模型不可用（${status}），跳过音效生成`);
        } else {
          this.logger.warn(`[ShotSfx] AI 音效生成失败，降级静态素材: ${(err as Error).message}`);
          sfxUrl = this.audioResource.resolveSfx((shot as any).audio?.sfx?.[0]?.sound ?? '') ?? '';
        }
      }

      if (sfxUrl) {
        sfxLocalPath = this.storage.resolve(`videos/${dramaId}/${shotId}_sfx.mp3`);
        try {
          if (!sfxUrl.startsWith('http')) {
            if (sfxUrl !== sfxLocalPath && fs.existsSync(sfxUrl)) {
              fs.copyFileSync(sfxUrl, sfxLocalPath);
            }
          } else {
            await this.storage.downloadToLocal(sfxUrl, sfxLocalPath);
          }

          let sfxUploadUrl = sfxUrl;
          if (this.ossService && fs.existsSync(sfxLocalPath)) {
            const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
            const ossPath = `media/audio/${datePrefix}/${dramaId}/sfx_${shotId}_${Date.now()}.mp3`;
            const uploadRes = await this.ossService.uploadFile(ossPath, sfxLocalPath);
            sfxUploadUrl = uploadRes.url;
            this.logger.log(`[ShotSfx] SFX 已推送 OSS: ${sfxUploadUrl}`);
          }
          sfxUrl = sfxUploadUrl;

        } catch (e) {
          this.logger.warn(`[ShotSfx] 音效处理失败: ${(e as Error).message}`);
          sfxLocalPath = '';
        }
      } else {
        await this.shotMediaRepo.upsert({ ...existing, shotId, episodeId: episode.id, sfxStatus: 'unavailable' } as any, ['episodeId', 'shotId']);
      }
    }

    // ── 4. 混合（FFmpeg mux）──────────────────────────────────────────────────
    let videoWithSfxUrl = '';
    const videoLocalPath = this.storage.resolve(`videos/${dramaId}/${shotId}.mp4`);

    if (finalTtsLocalPath || sfxLocalPath) {
      if (!fs.existsSync(videoLocalPath)) {
        try { await this.storage.downloadToLocal(videoUrl, videoLocalPath); } catch {}
      }

      if (fs.existsSync(videoLocalPath)) {
        let currentVideoPath = videoLocalPath;
        try {
          if (finalTtsLocalPath) {
            const tempOutputPath = this.storage.resolve(`videos/${dramaId}/${shotId}_with_tts.mp4`);
            const muxRes = await this.postProcessor.muxVideoWithAudio(currentVideoPath, finalTtsLocalPath, tempOutputPath, 1.0);
            if (fs.existsSync(muxRes.outputPath)) currentVideoPath = muxRes.outputPath;
          }
          if (sfxLocalPath) {
            const tempOutputPath = this.storage.resolve(`videos/${dramaId}/${shotId}_with_sfx.mp4`);
            const muxRes = await this.postProcessor.muxVideoWithAudio(currentVideoPath, sfxLocalPath, tempOutputPath, 1.0);
            if (fs.existsSync(muxRes.outputPath)) currentVideoPath = muxRes.outputPath;
          }

          if (currentVideoPath !== videoLocalPath) {
            videoWithSfxUrl = currentVideoPath;
            this.logger.log(`[ShotSfx] mux 完成: ${path.basename(videoWithSfxUrl)}`);
          }
        } catch (muxErr) {
          this.logger.warn(`[ShotSfx] FFmpeg mux 失败: ${(muxErr as Error).message}`);
        }
      } else {
        this.logger.warn(`[ShotSfx] 本地视频不存在，跳过 mux: ${videoLocalPath}`);
      }
    }

    if (!finalTtsUrl && !sfxUrl) {
      return { sfxUrl: '', status: 'unavailable' };
    }

    // 返回 sfxUrl 让前端试听：优先使用 TTS 配音 url，如果没有才用 sfx
    const returnAudioUrl = finalTtsUrl || sfxUrl;

    // ── 5. 写库 ──────────────────────────────────────────────────────────────
    await this.shotMediaRepo.upsert({
      ...existing, shotId, episodeId: episode.id,
      sfxUrl: returnAudioUrl, sfxStatus: 'completed', 
      ...(sfxPrompt ? { sfxPrompt } : {}),
      ...(videoWithSfxUrl ? { videoWithSfxUrl } : {}),
    } as any, ['episodeId', 'shotId']);

    this.logger.log(`[ShotSfx] ${shotId} 完成 | audio=${returnAudioUrl} | mux=${videoWithSfxUrl || 'skipped'}`);
    return { sfxUrl: returnAudioUrl, status: 'completed' };
  }

  async composeShotPreview(dramaId: string, episodeNumber: number, shotId: string): Promise<{ videoUrl: string; status: string }> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) throw new Error(`E${episodeNumber} 无分镜数据`);

    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shot = storyboard.shots?.find((s: Shot) => s.shotId === shotId);
    if (!shot) throw new Error(`Shot ${shotId} 不存在`);

    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const raw: Record<string, ShotMediaEntry> = Object.fromEntries(mediaList.map(m => [m.shotId, m as unknown as ShotMediaEntry]));
    const entry = raw[shotId];

    if (!entry?.videoUrl) throw new Error(`Shot ${shotId} 尚未生成无声视频，请先生成视频`);
    
    const hasSfx = (shot as any).audio?.sfx?.length > 0;
    const hasBgm = !!(shot as any).audio?.bgm;
    const hasAmbience = !!(shot as any).audio?.ambience;
    if (!entry?.ttsUrl && !entry?.sfxUrl && !hasSfx && !hasBgm && !hasAmbience) {
      throw new Error(`Shot ${shotId} 无任何音频要素配置，无需音画合成`);
    }

    if (!this.composer.isAvailable()) throw new Error('FFmpeg 未就绪，无法合成');

    this.logger.log(`[Preview] 开始单镜合成: ${shotId}`);
    
    let ttsDur = 0;
    if (entry.ttsUrl) {
      try {
        ttsDur = await (this.composer as any).getVideoDuration(entry.ttsUrl);
      } catch (e) {
        this.logger.warn(`获取 TTS 时长失败: ${(e as Error).message}`);
      }
    }

    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const scriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
    const scene = scriptScenes.find(s => s.sceneId === shot.sceneId);
    const mp = this.emotionMapper.mapShotToMediaParams(shot, scene);

    const generatedMaxSec = MediaOrchestratorService.getProviderMaxDuration(entry.videoProvider);
    let effectiveDuration = Math.min(shot.estimatedDurationSec, generatedMaxSec);
    let speedFactor = mp?.speedFactor ?? 1.0;

    if (ttsDur && ttsDur > effectiveDuration * 1.1) {
      const safeRatio = Math.min(ttsDur / effectiveDuration, 3.0);
      speedFactor = speedFactor / safeRatio;
      effectiveDuration = ttsDur;
      this.logger.debug(`[Preview] ${shot.shotId} 减速 ${safeRatio.toFixed(2)}x 匹配TTS (${ttsDur.toFixed(1)}s)`);
    }

    const composeShot: ComposeShotInput = {
      shotId: shot.shotId,
      videoPath: entry.videoUrl,
      ttsAudioPath: entry.ttsUrl,
      durationSec: effectiveDuration,
      trimInSec: shot.trimInSec,
      trimOutSec: shot.trimOutSec ?? effectiveDuration,
      transition: 'cut',
      transitionDurationSec: mp?.transitionDurationSec,
      subtitle: shot.subtitle ? {
        text: shot.subtitle.text,
        style: shot.subtitle.style ?? 'normal',
        characterId: shot.subtitle.characterId ?? shot.dialogue?.characterId,
        position: shot.subtitle.position ?? 'bottom',
        ttsDurationSec: ttsDur || undefined,
        karaoke: true,
      } : undefined,
      bgmPath: (shot as any).audio?.bgm?.mood ? (this.audioResource.resolveBgm((shot as any).audio.bgm.mood) ?? undefined) : undefined,
      bgmIntensity: ((shot as any).audio?.bgm?.intensity ?? 0.3) * (mp?.bgmVolumeMultiplier ?? 1.0),
      bgmAction: (shot as any).audio?.bgm?.action,
      sfxPaths: [
        ...(entry.sfxUrl ? [entry.sfxUrl] : []),
        ...((hasSfx ? (shot as any).audio!.sfx!.map((fx: any) => this.audioResource.resolveSfx(fx.sound)).filter(Boolean) as string[] : []))
      ],
      ambiencePath: hasAmbience ? (this.audioResource.resolveAmbience((shot as any).audio!.ambience!) ?? undefined) : undefined,
      postProcess: mp ? {
        colorGrade: mp.colorGrade,
        speedFactor,
        stabilize: mp.stabilize,
        kenBurns: entry.kenBurnsFallback ? { direction: 'zoom_in' as const, zoomFactor: 1.1 } : mp.kenBurns,
        specialTechnique: shot.specialTechnique ?? undefined,
      } : entry.kenBurnsFallback ? {
        kenBurns: { direction: 'zoom_in' as const, zoomFactor: 1.1 },
      } : undefined,
    };

    const outputPath = this.storage.composedShotOutputPath(dramaId, shotId);
    const aspectRatio = state.audienceDirective?.aspectRatio || '16:9';
    
    const result = await this.composer.compose({ episodeId: episode.id, shots: [composeShot], outputPath, aspectRatio });

    let finalVideoUrl = result.outputPath;
    if (this.ossService) {
      try {
        const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
        const ossPath = `media/videos/${datePrefix}/${dramaId}/${shotId}_composed_${Date.now()}.mp4`;
        const uploadRes = await this.ossService.uploadFile(ossPath, result.outputPath);
        finalVideoUrl = uploadRes.url;
        this.logger.log(`合成视频已推送 OSS: ${finalVideoUrl}`);
      } catch (err) {
        this.logger.warn(`OSS 上传失败，退回本地路径: ${(err as Error).message}`);
      }
    }

    await this.shotMediaRepo.upsert({ ...entry, shotId, episodeId: episode.id, videoUrl: finalVideoUrl } as any, ['episodeId', 'shotId']);
    
    this.logger.log(`[Preview] 单镜合成完毕: ${finalVideoUrl}`);
    return { videoUrl: finalVideoUrl, status: 'completed' };
  }


  /** 根据 Shot 元数据构建用于 SFX 模型的英文音效 prompt（描述听觉，而非画面） */
  private buildSfxPrompt(shot: Shot): string {
    const parts: string[] = [];
    const movement = shot.camera?.movement?.toLowerCase() ?? '';
    if (movement.includes('pan') || movement.includes('dolly')) parts.push('subtle camera movement whoosh');
    if (movement.includes('handheld')) parts.push('slight ambient rumble');

    if (shot.characters?.length) {
      const emotions = shot.characters.map((c: any) => String(c.emotion ?? '')).filter(Boolean);
      if (emotions.some(e => e.includes('cry') || e.includes('sad'))) parts.push('soft sobbing, quiet sniffles');
      if (emotions.some(e => e.includes('angry') || e.includes('rage'))) parts.push('heavy tense breathing');
      if (emotions.some(e => e.includes('surprise') || e.includes('shock'))) parts.push('sharp gasp');
      if (emotions.some(e => e.includes('happy') || e.includes('laugh'))) parts.push('gentle laughter');
    }

    const vp = ((shot as any).sfxPrompt || shot.visualPrompt || '').toLowerCase();
    if (vp.includes('rain'))                              parts.push('rain falling');
    if (vp.includes('thunder'))                           parts.push('distant thunder rumble');
    if (vp.includes('wind') || vp.includes('storm'))      parts.push('wind howling');
    if (vp.includes('door'))                              parts.push('door opening or closing');
    if (vp.includes('forest') || vp.includes('nature'))   parts.push('birds chirping, leaves rustling');
    if (vp.includes('office') || vp.includes('typing'))   parts.push('office ambience, keyboard typing');
    if (vp.includes('street') || vp.includes('city'))     parts.push('city traffic ambience');
    if (vp.includes('restaurant') || vp.includes('cafe')) parts.push('restaurant background noise');
    if (vp.includes('car') || vp.includes('driv'))        parts.push('car engine, road noise');
    if (vp.includes('fight') || vp.includes('battle'))    parts.push('impact sound, whoosh');
    if (vp.includes('sword') || vp.includes('weapon'))    parts.push('sword clashing, metal ring');
    if (vp.includes('night'))                             parts.push('night crickets, quiet ambience');
    if (vp.includes('hospital'))                          parts.push('hospital ambience, soft footsteps');

    if (!parts.length) parts.push('subtle ambient room tone, soft background atmosphere');
    return parts.slice(0, 5).join(', ') + '. cinematic, natural, immersive';
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
    const reviewRiskShotIds = this.shotOrderService.extractReviewRiskShotIds(episode.review);
    const orderedShots = this.shotOrderService.orderShotsForProduction(shots, reviewRiskShotIds);
    const charImageMap = await this.buildCharacterImageMap(dramaId);
    for (const entry of state.minorRolePool ?? []) {
      if (entry.referenceImageUrl && !charImageMap.has(entry.characterId)) {
        charImageMap.set(entry.characterId, { primary: entry.referenceImageUrl, views: { face_front: entry.referenceImageUrl } });
      }
    }
    const characterAnchorMap = this.shotContextService.buildCharacterAnchorMap(state);
    const variationImageMap = await this.buildVariationImageMap(dramaId, state);
    await this.ensureVariationImages(dramaId, state, shots, charImageMap, variationImageMap, userId, episodeNumber);
    const locationImageMap = await this.buildLocationImageMap(dramaId); // B1
    const propImageMap = await this.buildPropImageMap(dramaId);
    const propOwnerMap = this.buildPropOwnerMap(state);
    const styleRefImages = await this.buildStyleRefImages(dramaId, state, mediaPolicy.styleBucket);
    const aspectRatio = state.audienceDirective?.aspectRatio ?? '9:16';
    const imgSize = MediaOrchestratorService.resolveImageSize(aspectRatio);
    const t2iStylePrefix = this.buildT2iStylePrefix(state.visualStyle);
    const imgScriptScenes = ((episode.script as any)?.scenes ?? []) as import('../schemas/drama-state.schemas').ScriptScene[];
    const imgSceneMap = new Map(imgScriptScenes.map(s => [s.sceneId, s]));

    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const shotMediaMap: Record<string, ShotMediaEntry> = Object.fromEntries(
      mediaList.map(m => [m.shotId, m as unknown as ShotMediaEntry])
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
      `[policy] images E${episodeNumber} style=${mediaPolicy.styleBucket} ` +
      `t2i=${mediaPolicy.t2iConcurrency} retry=${mediaPolicy.maxMediaRetries}`,
    );
    this.shotOrderService.logShotOrder(`E${episodeNumber} images`, needsGen);

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

    await this.runConcurrent(needsGen, Math.min(mediaPolicy.t2iConcurrency, this.t2iMaxConcurrency), async (shot) => {
      const sid = shot.shotId;
      const shotPolicy = this.resolveShotRunPolicy(shot, state, mediaPolicy.styleBucket);
      try {
        emit(`${sid} 生成中...`);
        const batchShotRoute = this.imageRouter.routeShot({
          qualityTier: shot.qualityTier, shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle,
          isGolden: shot.isPreview || shot.qualityTier === 'golden', size: imgSize,
        });
        const mediaParams = this.emotionMapper.mapShotToMediaParams(shot, imgSceneMap.get(shot.sceneId));
        const styleLockedPrompt = this.shotContextService.applyStyleLockPrompt(shot.firstFramePrompt || shot.visualPrompt, shot, state);
        const batchLocId = imgSceneMap.get(shot.sceneId)?.locationId || shot.sceneId;
        const batchLighting = state.locations?.find(l => l.locationId === batchLocId)?.lightingDefault;
        const batchSceneVisualPrompt = state.locations?.find(l => l.locationId === batchLocId)?.visualPrompt;
        const rawPrompt = await this.shotPromptAssembler.assembleT2iPrompt(shot, state, styleLockedPrompt, {
          stylePrefix: t2iStylePrefix || '',
          maxTokens: Infinity, provider: batchShotRoute.provider || '',
          batchLighting,
          sceneVisualPrompt: batchSceneVisualPrompt,
        });
        const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, episodeNegPrompt ?? '', {
          shotType: 'first_frame', dramaShotType: shot.shotType, styleBucket: mediaPolicy.styleBucket,
          qualityTier: shot.qualityTier ?? 'standard',
          shotSize: shot.camera?.shotSize, cameraAngle: shot.camera?.cameraAngle, emotionColorHint: mediaParams.colorGrade,
          routeProfile: shotPolicy.routeProfile,
          provider: batchShotRoute.provider,
          ambientPopulation: state.locations?.find(l => l.locationId === batchLocId)?.ambientPopulation,
        });
        const refs = this.shotContextService.buildRefImages(
          shot,
          charImageMap,
          variationImageMap,
          characterAnchorMap,
          styleRefImages,
          sceneCache,
          prevFrameCache,
          'first', this.profile,
          undefined,
          propImageMap, propOwnerMap,
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
          const characterRefs = this.shotContextService.collectRefImages(shot, charImageMap, variationImageMap, characterAnchorMap);
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
          const newEntry = {
            ...shotMediaMap[sid],
            imageUrl: imgUrl,
            status: 'image_done',
            qc: gateQc ?? shotMediaMap[sid]?.qc,
            t2iPrompt: optimized.prompt,
            t2iNegativePrompt: optimized.negativePrompt || undefined,
          };
          shotMediaMap[sid] = newEntry as ShotMediaEntry;
          
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
        this.progressService.emit({ 
          dramaId, runType: 'images', episodeNumber, 
          step: `img_batch`, stepKey: sid, stepIndex: done, totalSteps, 
          message: `${sid} 完成 (${done}/${totalSteps})`, done: done >= totalSteps,
          data: imgUrl ? { imageUrl: imgUrl } : undefined
        });
      } catch (err) {
        this.logger.warn(`${sid} 图片失败: ${(err as Error).message}`);
        emit(`${sid} 失败: ${(err as Error).message}`);
      }
    });

    await this.pushShotMediaMap(episode.id, shotMediaMap);
    this.logger.log(`E${episodeNumber} 图片阶段完成: ${Object.values(shotMediaMap).filter(v => v.imageUrl).length}/${shots.length}`);
  }

  async getMediaStatus(dramaId: string, episodeNumber: number) {
    const ep = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!ep) throw new Error(`E${episodeNumber} 不存在`);
    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: ep.id } });
    const total = mediaList.length;
    return { mediaStatus: ep.mediaStatus, videoUrl: ep.videoUrl, total,
      completed: mediaList.filter(v => v.status === 'completed').length,
      failed: mediaList.filter(v => v.status === 'failed').length, shotMedia: mediaList };
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
        if (fb) {
          map[sid] = { ...map[sid], videoUrl: fb, status: 'completed', kenBurnsFallback: true };
          this.logger.warn(`${sid} I2V轮询降级: Ken Burns`);
        } else {
          map[sid] = { ...map[sid], status: 'failed' };
        }
        remaining--;
      }
    }
    if (remaining <= 0) {
      await this.pushShotMediaMap(epId, map);
      return;
    }

    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { cleanup(); resolve(); }, this.videoAwaitTimeoutMs);
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
          if (fb) {
            map[sid] = { ...map[sid], videoUrl: fb, status: 'completed', kenBurnsFallback: true };
            this.logger.warn(`${sid} I2V事件降级: Ken Burns`);
          } else {
            map[sid] = { ...map[sid], status: 'failed' };
          }
        }
        else return;
        remaining--;
        if (remaining <= 0) { 
          await this.pushShotMediaMap(epId, map);
          cleanup(); resolve(); 
        }
      };
      const cleanup = () => { clearTimeout(timer); this.mediaService.offJobCompleted(handler); };
      this.mediaService.onJobCompleted(handler);
    });
  }

  // ═══ 工具方法 ═══

  private async pushShotMediaMap(episodeId: string, map: Record<string, ShotMediaEntry>): Promise<void> {
    const list = Object.entries(map).map(([shotId, data]) => ({ episodeId, shotId, ...data }));
    await this.shotMediaRepo.upsert(list, ['episodeId', 'shotId']);
  }

  private async updateMediaStatus(
    episodeId: string,
    status: EpisodeMediaStatus,
  ): Promise<void> {
    await this.episodeRepo.update(episodeId, { mediaStatus: status });
  }

  private resolveShotRunPolicy(
    shot: Shot,
    state: Pick<DramaState, 'imageResolution' | 'videoResolution'>,
    styleBucket: DramaStyleBucket,
  ) {
    return this.generationPolicy.resolveShotRunPolicy({
      state,
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
        // 4xx 错误（模型不存在/未授权/参数错误）不重试，直接抛出
        const status = (err as any)?.response?.status ?? (err as any)?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          this.logger.warn(`${label} 遇到 ${status} 不可重试错误，终止重试: ${(err as Error).message}`);
          throw err;
        }
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

  /** 从 VisualAssetEntity 加载签名道具的参考图（propId → imageUrl） */
  private async buildPropImageMap(dramaId: string): Promise<Map<string, string>> {
    const assets = await this.assetRepo.find({ where: { dramaId, assetType: 'prop' as any } });
    const map = new Map<string, string>();
    for (const a of assets) {
      if (a.referenceImageUrl) map.set(a.refId, a.referenceImageUrl);
    }
    return map;
  }

  /** 从 signatureProps 构建角色→道具映射（characterId → propId[]） */
  private buildPropOwnerMap(state: DramaState): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const p of state.signatureProps ?? []) {
      if (!p.visualPrompt?.trim() || !p.characterOwner) continue;
      // characterOwner 可能是 characterId 或 name，需双向匹配
      const owners: string[] = [];
      for (const ch of state.characters ?? []) {
        if (p.characterOwner === ch.characterId || p.characterOwner === ch.name) {
          owners.push(ch.characterId);
        }
      }
      for (const oid of owners) {
        const arr = map.get(oid) ?? [];
        arr.push(p.propId);
        map.set(oid, arr);
      }
    }
    return map;
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

  // ══════════════════════════════════════════════════════════════════════════════
  // Section: 参考图懒加载 — 集生成前自动补齐缺失的角色/场景参考图
  // ══════════════════════════════════════════════════════════════════════════════

  /**
   * 在集媒体生成前，按需生成本集涉及的角色和场景的基础参考图。
   * 仅生成缺失的（referenceImageUrl 为空），已有参考图的直接跳过，跨集复用。
   * 遵循 ensureVariationImages 的懒加载模式。
   */
  private async ensureBaseReferenceImages(
    dramaId: string,
    state: DramaState,
    shots: Shot[],
    userId?: string,
  ): Promise<void> {
    // 收集本集实际引用的角色 ID 和场景 ID
    const neededCharIds = new Set<string>();
    const neededSceneIds = new Set<string>();
    for (const shot of shots) {
      for (const c of shot.characters ?? []) neededCharIds.add(c.characterId);
      if (shot.sceneId) neededSceneIds.add(shot.sceneId);
    }
    if (!neededCharIds.size && !neededSceneIds.size) return;

    // 读取现有资产
    const assets = await this.assetRepo.find({ where: { dramaId } });
    const charAssets = assets.filter(a => a.assetType === ('character' as any) && neededCharIds.has(a.refId));
    const locAssets  = assets.filter(a => a.assetType === ('location'  as any) && neededSceneIds.has(a.refId));

    const missingChars = charAssets.filter(a => !a.referenceImageUrl?.trim());
    const missingLocs  = locAssets.filter( a => !a.referenceImageUrl?.trim());

    if (!missingChars.length && !missingLocs.length) return;
    this.logger.log(
      `[ensureBaseRefs] 本集缺失参考图 — 角色: [${missingChars.map(a => a.refId).join(', ')}]` +
      ` 场景: [${missingLocs.map(a => a.refId).join(', ')}]`,
    );

    const vs = state.visualStyle;
    const styleBucket = this.detectStyleBucketFromVs(vs);
    const charStylePrefix = this.buildAssetStylePrefixLocal(vs, 'character');
    const sceneStylePrefix = this.buildAssetStylePrefixLocal(vs, 'location');
    const CHAR_SIZE  = '2:3';
    const SCENE_SIZE = '3:2';

    // ── 生成缺失的角色 face_front ─────────────────────────────────────────────
    for (const asset of missingChars) {
      const ch = state.characters?.find(c => c.characterId === asset.refId);
      if (!ch?.faceReferencePrompt?.trim()) {
        this.logger.warn(`[ensureBaseRefs] 跳过 ${asset.refId}：faceReferencePrompt 为空`);
        continue;
      }
      try {
        const faceRoute = this.imageRouter.routeCharacterFace(CHAR_SIZE);
        const agePhrase = ageToT2IPhrase((ch as any).age) || (ch as any).agePrompt?.trim() || '';
        const faceParts = [
          ch.faceReferencePrompt,
          agePhrase,
          (ch as any).hairStylePrompt || (ch as any).hairStyle,
          (ch as any).defaultCostumePrompt ? `wearing ${(ch as any).defaultCostumePrompt}` : '',
          (ch as any).bodyTypePrompt || (ch as any).bodyType,
          'front-facing, looking at camera, neutral plain background, character reference sheet portrait',
        ].filter(Boolean).join(', ');
        const { prompt, negativePrompt } = this.optimizeAssetPromptLocal(faceParts, 'character', charStylePrefix, faceRoute.provider, styleBucket);
        const result = await this.mediaService.generateImage({
          prompt, negativePrompt, size: CHAR_SIZE, count: 1,
          dramaId, assetType: 'character_image', refId: asset.refId, userId,
          ...faceRoute,
        });
        const url = result.images?.[0]?.url;
        if (url) {
          const updated = this.upsertRefByViewLocal(asset, 'face_front', url);
          asset.referenceImageUrl = updated.referenceImageUrl;
          asset.referenceImages   = updated.referenceImages;
          await this.assetRepo.update(asset.id, {
            referenceImageUrl: asset.referenceImageUrl,
            referenceImages:   asset.referenceImages,
          });
          this.logger.log(`[ensureBaseRefs] 角色参考图生成完成: ${ch.name}(${asset.refId})`);
        }
      } catch (err) {
        this.logger.warn(`[ensureBaseRefs] 角色参考图生成失败: ${asset.refId} — ${(err as Error).message}`);
      }
    }

    // ── 生成缺失的场景 establishing ──────────────────────────────────────────
    for (const asset of missingLocs) {
      const loc = state.locations?.find(l => l.locationId === asset.refId);
      if (!loc?.visualPrompt) {
        this.logger.warn(`[ensureBaseRefs] 跳过场景 ${asset.refId}：visualPrompt 为空`);
        continue;
      }
      try {
        const locRoute = this.imageRouter.routeLocation(SCENE_SIZE);
        const rawPrompt = buildLocationViewPrompt(loc as any, 'establishing') || loc.visualPrompt;
        const { prompt, negativePrompt } = this.optimizeAssetPromptLocal(rawPrompt, 'location', sceneStylePrefix, locRoute.provider, styleBucket);
        const result = await this.mediaService.generateImage({
          prompt, negativePrompt, size: SCENE_SIZE, count: 1,
          dramaId, assetType: 'location_image', refId: asset.refId, userId,
          ...locRoute,
        });
        const url = result.images?.[0]?.url;
        if (url) {
          const updated = this.upsertRefByViewLocal(asset, 'establishing', url);
          asset.referenceImageUrl = updated.referenceImageUrl;
          asset.referenceImages   = updated.referenceImages;
          await this.assetRepo.update(asset.id, {
            referenceImageUrl: asset.referenceImageUrl,
            referenceImages:   asset.referenceImages,
          });
          this.logger.log(`[ensureBaseRefs] 场景参考图生成完成: ${loc.name}(${asset.refId})`);
        }
      } catch (err) {
        this.logger.warn(`[ensureBaseRefs] 场景参考图生成失败: ${asset.refId} — ${(err as Error).message}`);
      }
    }
  }

  /** 与 DramaService.detectStyleBucket 逻辑保持一致（共享 utility） */
  private detectStyleBucketFromVs(vs?: DramaState['visualStyle']): string {
    return detectStyleBucketUtil(vs);
  }

  /** 与 DramaService.buildAssetStylePrefix 逻辑保持一致（共享 utility） */
  private buildAssetStylePrefixLocal(vs?: DramaState['visualStyle'], type: 'character' | 'location' = 'location'): string | undefined {
    return buildAssetStylePrefixUtil(vs, type);
  }

  /** 与 DramaService.optimizeAssetPrompt 逻辑保持一致 */
  private optimizeAssetPromptLocal(
    rawPrompt: string,
    shotType: 'character' | 'location',
    stylePrefix?: string,
    provider?: string,
    styleBucket?: string,
  ): { prompt: string; negativePrompt: string } {
    const negDefault = this.profile.negativePrompt.defaultValue;
    const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, negDefault, {
      shotType, qualityTier: 'golden', provider, styleBucket,
    });
    return { prompt: assembleT2iPrompt(optimized.prompt, this.profile, { stylePrefix }), negativePrompt: optimized.negativePrompt };
  }

  /** 与 DramaService.upsertReferenceByView 逻辑保持一致（共享 utility） */
  private upsertRefByViewLocal(
    asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages'>,
    viewAngle: string,
    imageUrl: string,
  ): { referenceImageUrl: string; referenceImages: Array<{ viewAngle: string; imageUrl: string }> } {
    return upsertReferenceByViewUtil(asset, viewAngle, imageUrl);
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

  /** 构建角色变体图映射 characterId_variationId → imageUrl
   *  双源合并：state.characters（内存最新）+ asset.data.variations（持久化兜底，处理 regenerateVariationImage 写入路径）。
   *  state 优先，asset.data 仅补充 state 中没有的条目。
   */
  private async buildVariationImageMap(dramaId: string, state: DramaState): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const ch of state.characters ?? []) {
      for (const v of ch.variations ?? []) {
        if (v.referenceImageUrl) map.set(`${ch.characterId}_${v.variationId}`, v.referenceImageUrl);
      }
    }
    // 兜底：从 VisualAssetEntity.data.variations 补充（覆盖 regenerateVariationImage 只写 asset 未同步 state 的情况）
    const charAssets = await this.assetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    for (const asset of charAssets) {
      const assetVariations = ((asset.data as any)?.variations ?? []) as Array<{ variationId?: string; referenceImageUrl?: string }>;
      for (const av of assetVariations) {
        if (!av.variationId || !av.referenceImageUrl) continue;
        const key = `${asset.refId}_${av.variationId}`;
        if (!map.has(key)) map.set(key, av.referenceImageUrl); // state 优先，asset 仅补充缺失项
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

  /**
   * 懒加载角色变体参考图：在媒体生成前，根据 shots 中实际用到的 characterVariationIds 按需生成。
   * 生成成功后写回 variationImageMap（供本次媒体生成使用）并持久化到 VisualAssetEntity + DramaState。
   *
   * 安全保证：
   * - 并发防护：通过 pendingVariations 跨集去重，同一 key 同时只生成一次
   * - 原子写入：持久化前重读 asset.data，避免并发覆盖丢失其他变体的 URL
   * - 无 face 时跳过：新集角色没有 face_front 基础图时不生成变体（缺乏身份锚点）
   * - 静默跳过改 warn：variationId 在角色档案中不存在时明确记录日志
   */
  private async ensureVariationImages(
    dramaId: string,
    state: DramaState,
    shots: Shot[],
    charImageMap: Map<string, CharacterImageSet>,
    variationImageMap: Map<string, string>,
    userId?: string,
    episodeNumber?: number,
  ): Promise<void> {
    // 收集所有 shots 需要但尚未生成的 variation
    const needed = new Map<string, Set<string>>(); // characterId → Set<variationId>
    for (const shot of shots) {
      for (const [charId, varId] of Object.entries(shot.characterVariationIds ?? {})) {
        if (!varId) continue;
        if (variationImageMap.has(`${charId}_${varId}`)) continue;
        if (!needed.has(charId)) needed.set(charId, new Set());
        needed.get(charId)!.add(varId);
      }
    }
    if (!needed.size) return;

    this.logger.log(`[VariationLazy] 需懒加载变体图: ${[...needed.entries()].map(([c, vs]) => `${c}(${[...vs].join(',')})`).join(', ')}`);

    const vs = state.visualStyle;
    const charStylePrefix = vs ? ((vs.characterStylePrompt ?? '').trim() || undefined) : undefined;
    const stylePrefix = charStylePrefix ? charStylePrefix + ', ' : undefined;
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);

    const charAssets = await this.assetRepo.find({ where: { dramaId, assetType: 'character' as any } });
    const assetByCharId = new Map(charAssets.map(a => [a.refId, a]));

    let anyStateUpdated = false;
    for (const [charId, varIds] of needed) {
      const ch = state.characters?.find(c => c.characterId === charId);
      if (!ch) continue;

      const baseImg = charImageMap.get(charId)?.views?.face_front || charImageMap.get(charId)?.primary;
      // 无 face 基础图（新集临时角色）→ 跳过变体生成，缺乏身份锚点会导致面部漂移
      if (!baseImg) {
        this.logger.warn(`[VariationLazy] 跳过 ${charId}：无 face_front 基础图，无法保证变体身份一致性`);
        continue;
      }

      const asset = assetByCharId.get(charId);

      for (const varId of varIds) {
        const key = `${dramaId}_${charId}_${varId}`;

        // 并发防护：若同一 key 已在生成中，等待其完成后读取结果
        const pending = this.pendingVariations.get(key);
        if (pending) {
          this.logger.log(`[VariationLazy] 等待并发生成完成: ${charId}/${varId}`);
          await pending;
          const url = variationImageMap.get(`${charId}_${varId}`);
          if (url) continue; // 已被并发任务填充
        }

        const v = ch.variations?.find(vv => vv.variationId === varId);
        if (!v) {
          // 分镜引用了角色档案中未定义的 variationId，应由 DeterministicChecker 捕获
          this.logger.warn(`[VariationLazy] 跳过 ${charId}/${varId}：角色档案中无此 variationId（分镜可能使用了错误的变体ID）`);
          continue;
        }

        let resolveGen!: () => void;
        const genPromise = new Promise<void>(r => { resolveGen = r; });
        this.pendingVariations.set(key, genPromise);

        try {
          // age/transformation 变体使用 faceOverridePrompt 替代基础面部提示词
          const isAgeBased = (v as any).variationType === 'age' || (v as any).variationType === 'transformation';
          const facePrompt = (isAgeBased && (v as any).faceOverridePrompt)
            ? (v as any).faceOverridePrompt
            : (ch as any).faceReferencePrompt;
          // age 变体降低参考图权重（面部需要改变），transformation 更低
          const refWeight = (v as any).variationType === 'transformation' ? 0.35
            : (v as any).variationType === 'age' ? 0.45
            : 0.6;
          const refImages = [{ url: baseImg, weight: refWeight }];
          const rawPrompt = [
            facePrompt,
            (v as any).ageHint, // age 变体年龄外貌词（如 "elderly, 70 years old, deep wrinkles"）
            (ch as any).hairStylePrompt || (ch as any).hairStyle,
            (ch as any).bodyTypePrompt || (ch as any).bodyType,
            v.visualPromptOverride,
            isAgeBased ? 'same facial bone structure as reference' : 'same person as reference',
          ].filter(Boolean).join(', ');

          const varRoute = this.imageRouter.routeCharacterVariation('2:3');
          const assembled = assembleT2iPrompt(rawPrompt, this.profile, { stylePrefix });
          const optimized = this.promptOptimizer.optimizeForT2I(assembled, this.negPrompt ?? '', {
            shotType: 'character',
            qualityTier: 'golden',
            provider: varRoute.provider,
            styleBucket: mediaPolicy.styleBucket,
          });

          this.logger.log(`[VariationLazy] 生成 ${charId}/${varId} provider=${varRoute.provider ?? 'default'}`);
          const result = await this.mediaService.generateImage({
            prompt: optimized.prompt,
            negativePrompt: optimized.negativePrompt || undefined,
            size: '2:3',
            count: 1,
            referenceImages: refImages,
            dramaId,
            assetType: 'character_variation',
            refId: `${charId}_${varId}`,
            userId,
            episodeNumber,
          });

          const imageUrl = result.images?.[0]?.url ?? '';
          if (imageUrl) {
            variationImageMap.set(`${charId}_${varId}`, imageUrl);
            v.referenceImageUrl = imageUrl;
            anyStateUpdated = true;

            // 原子写入：重读 asset.data 后定点更新，避免并发覆盖其他变体的 URL
            if (asset) {
              const fresh = await this.assetRepo.findOne({ where: { id: asset.id } });
              if (fresh) {
                const freshData = (fresh.data ?? {}) as Record<string, unknown>;
                const freshVars = (freshData.variations ?? []) as Array<Record<string, unknown>>;
                const idx = freshVars.findIndex((fv: any) => fv.variationId === varId);
                if (idx >= 0) freshVars[idx] = { ...freshVars[idx], referenceImageUrl: imageUrl };
                else freshVars.push({ variationId: varId, referenceImageUrl: imageUrl });
                await this.assetRepo.update(asset.id, { data: { ...freshData, variations: freshVars } });
              }
            }
            this.logger.log(`[VariationLazy] 完成 ${charId}/${varId} → ${imageUrl.slice(-40)}`);
          }
        } catch (err) {
          this.logger.warn(`[VariationLazy] 失败 ${charId}/${varId}: ${(err as Error).message}`);
        } finally {
          resolveGen();
          this.pendingVariations.delete(key);
        }
      }
    }

    // 将更新后的 state.characters（含 variation referenceImageUrl）持久化到 drama 状态
    if (anyStateUpdated) {
      await this.dramaRepo.update({ id: dramaId }, { state: state as any });
    }
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
      const ep = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber: epNum }, select: ['id'] });
      if (!ep) continue;
      const mediaList = await this.shotMediaRepo.find({ where: { episodeId: ep.id, shotId: In(sids) } });
      for (const m of mediaList) if (m.videoUrl) result[m.shotId] = m.videoUrl;
    }
    if (globalIds.length) {
      const eps = await this.episodeRepo.find({ where: { dramaId }, select: ['id'] });
      for (const ep of eps) {
        const mediaList = await this.shotMediaRepo.find({ where: { episodeId: ep.id, shotId: In(globalIds) } });
        for (const m of mediaList) if (m.videoUrl && !result[m.shotId]) result[m.shotId] = m.videoUrl;
      }
    }
    return result;
  }

  /**
   * P2 #7：按需生成多视角参考图。
   * 扫描本集 shots 的 cameraAngle/position，识别需要 side_profile 或 back_view 视角但角色缺少该视角参考图的情况，
   * 使用 face_front 为基础通过 I2I 自动生成缺失视角。
   * 仅对 protagonist/antagonist/supporting 角色执行（minor 角色不值得额外生成成本）。
   */
  private async ensureMultiViewImages(
    dramaId: string,
    state: DramaState,
    shots: Shot[],
    charImageMap: Map<string, CharacterImageSet>,
    userId?: string,
    episodeNumber?: number,
  ): Promise<void> {
    // 角度→需要的视角映射
    const ANGLE_TO_VIEW: Record<string, CharacterViewAngle> = {
      side_profile: 'side_profile',
      over_shoulder: 'back_view',
      back_of_head: 'back_view',
    };
    // 收集需要的 (characterId, viewAngle) 组合
    const needed = new Map<string, Set<CharacterViewAngle>>();
    for (const shot of shots) {
      const cameraAngle = shot.camera?.cameraAngle;
      const requiredView = cameraAngle ? ANGLE_TO_VIEW[cameraAngle] : undefined;
      if (!requiredView) continue;

      for (const sc of shot.characters ?? []) {
        // 过肩镜头：前景角色需要 back_view
        if (cameraAngle === 'over_shoulder' && sc.position !== 'foreground') continue;
        const imageSet = charImageMap.get(sc.characterId);
        if (!imageSet) continue;
        if (imageSet.views[requiredView]) continue; // 已有该视角

        // 角色需有定义且有 face_front 基础图（否则 I2I 链无锚点）
        const ch = state.characters?.find(c => c.characterId === sc.characterId);
        if (!ch) continue;

        if (!needed.has(sc.characterId)) needed.set(sc.characterId, new Set());
        needed.get(sc.characterId)!.add(requiredView);
      }
    }
    if (!needed.size) return;

    this.logger.log(`[MultiView] 需补充视角: ${[...needed.entries()].map(([c, vs]) => `${c}(${[...vs].join(',')})`).join(', ')}`);

    const vs = state.visualStyle;
    const charStylePrefix = vs ? ((vs.characterStylePrompt ?? '').trim() || undefined) : undefined;
    const stylePrefix = charStylePrefix ? charStylePrefix + ', ' : undefined;
    const mediaPolicy = this.generationPolicy.resolveMediaPolicy(state);

    for (const [charId, views] of needed) {
      const ch = state.characters?.find(c => c.characterId === charId);
      if (!ch) continue;
      const imageSet = charImageMap.get(charId);
      const baseImg = imageSet?.views?.face_front || imageSet?.primary;
      if (!baseImg) continue;

      for (const viewAngle of views) {
        try {
          const rawPrompt = buildViewAnglePrompt(ch as any, viewAngle);
          const varRoute = this.imageRouter.routeCharacterViewAngle('2:3');
          const assembled = assembleT2iPrompt(rawPrompt, this.profile, { stylePrefix });
          const optimized = this.promptOptimizer.optimizeForT2I(assembled, this.negPrompt ?? '', {
            shotType: 'character',
            qualityTier: 'standard',
            provider: varRoute.provider,
            styleBucket: mediaPolicy.styleBucket,
          });

          this.logger.log(`[MultiView] 生成 ${charId}/${viewAngle}`);
          const result = await this.mediaService.generateImage({
            prompt: optimized.prompt,
            negativePrompt: optimized.negativePrompt || undefined,
            size: '2:3',
            count: 1,
            referenceImages: [{ url: baseImg, weight: this.profile.characterViews.chainReferenceWeight }],
            dramaId,
            assetType: 'character_view',
            refId: `${charId}_${viewAngle}`,
            userId,
            episodeNumber,
          });

          const imageUrl = result.images?.[0]?.url ?? '';
          if (imageUrl) {
            // 更新内存中的 charImageMap
            imageSet!.views[viewAngle] = imageUrl;
            // 持久化到 VisualAssetEntity
            const asset = await this.assetRepo.findOne({ where: { dramaId, assetType: 'character' as any, refId: charId } });
            if (asset) {
              const existingRefs = asset.referenceImages ?? [];
              if (!existingRefs.some(r => r.viewAngle === viewAngle)) {
                existingRefs.push({ viewAngle, imageUrl });
                await this.assetRepo.update(asset.id, { referenceImages: existingRefs });
              }
            }
            this.logger.log(`[MultiView] ✅ ${charId}/${viewAngle} 生成成功`);
          }
        } catch (err) {
          this.logger.warn(`[MultiView] ❌ ${charId}/${viewAngle} 生成失败，跳过: ${(err as Error).message}`);
        }
      }
    }
  }


}

const SPEED_MAP: Record<string, number> = { slow: 0.85, normal: 1.0, fast: 1.2 };
