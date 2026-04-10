/**
 * DramaVisualAssetService — 视觉资产管理（从 DramaService 提取）
 * 覆盖：参考图生成/重生/精修/变体/redesign/视觉圣经
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { DramaVisualStyleTemplateEntity, VisualStyleGuide, VisualPromptGuidance } from '../template/entities/drama-visual-style-template.entity';
import { DramaEntity } from './entities/drama.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaState, PropAsset, SignatureProp } from './schemas/drama-state.schemas';
import { LlmService } from '../llm/llm.service';
import { MediaService } from '../media/media.service';
import { RenderingProfileService } from '../media/rendering/rendering-profile.service';
import {
  CHARACTER_VIEW_ANGLES, CharacterViewAngle, buildViewAnglePrompt, assembleT2iPrompt, ageToT2IPhrase,
  LOCATION_VIEW_ANGLES, LocationViewAngle, buildLocationViewPrompt,
} from '../media/rendering/rendering-profile';
import {
  detectStyleBucket as detectStyleBucketUtil,
  buildAssetStylePrefix as buildAssetStylePrefixUtil,
  upsertReferenceByView as upsertReferenceByViewUtil,
} from './utils/asset-prompt.utils';
import { PromptOptimizerService } from '../media/prompt-optimizer.service';
import { ImageProviderRouterService } from './media-pipeline/image-provider-router.service';
import { PromptCompilerService } from './media-pipeline/prompt-compiler.service';
import { DramaStateStore } from './drama-state-store.service';

type RefineSyncScope = 'single' | 'group' | 'all';
type RefineStrength = 'light' | 'balanced' | 'strong';

@Injectable()
export class DramaVisualAssetService {
  private readonly logger = new Logger('DramaVisualAsset');

  private static readonly CHAR_IMAGE_SIZE = '2:3';
  private static readonly SCENE_IMAGE_SIZE = '3:2';
  private static readonly PROP_IMAGE_SIZE = '1:1';

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(VisualAssetEntity) private readonly visualAssetRepo: Repository<VisualAssetEntity>,
    private readonly llm: LlmService,
    private readonly mediaService: MediaService,
    private readonly renderingProfileService: RenderingProfileService,
    private readonly promptOptimizer: PromptOptimizerService,
    private readonly promptCompiler: PromptCompilerService,
    private readonly imageRouter: ImageProviderRouterService,
    private readonly stateStore: DramaStateStore,
  ) {}

  private async rewritePromptByUserFeedback(
    currentPrompt: string,
    userFeedback: string,
    assetType: 'character' | 'location' | 'prop' | string,
    dramaId: string,
    dramaState?: Record<string, any>,
    userId?: string,
  ): Promise<string> {
    const schema = z.object({ revisedPrompt: z.string() });
    const subjectLabel = assetType === 'character' ? 'character portrait' : assetType === 'location' ? 'scene/location image' : 'prop image';

    const vs = dramaState?.visualStyle ?? {};
    const styleCtx = [
      dramaState?.title ? `Drama title: ${dramaState.title}` : '',
      dramaState?.genre ? `Genre: ${dramaState.genre}` : '',
      vs.overallAesthetic ? `Overall aesthetic: ${vs.overallAesthetic}` : '',
      vs.renderTechnique ? `Render technique: ${vs.renderTechnique}` : '',
      vs.colorGrading ? `Color grading: ${vs.colorGrading}` : '',
      vs.lightingStyle ? `Lighting style: ${vs.lightingStyle}` : '',
      vs.styleReferencePrompt ? `Style reference: ${vs.styleReferencePrompt}` : '',
    ].filter(Boolean).join('\n');

    try {
      const result = await this.llm.generateStructured({
        taskName: 'refine-prompt-rewrite',
        schema,
        metadata: { dramaId, userId },
        systemPrompt: `You are an expert image prompt engineer for a cinematic AI drama platform. Your job is to rewrite an existing T2I image prompt based on user feedback, while staying true to the drama's visual style.

Rules:
- Output ONLY English prompt keywords/phrases suitable for T2I image generation
- No Chinese characters, no explanations, no JSON wrappers
- Preserve the core identity/composition/content that the user did NOT complain about
- Address the user's complaint or request by adjusting or replacing only the relevant parts
- The rewritten prompt MUST remain consistent with the drama's overall visual style and genre
- Keep the rewritten prompt concise (under 120 words)`,
        userPrompt: `Drama visual context:
${styleCtx || '(no style context available)'}

Current ${subjectLabel} prompt:
"${currentPrompt}"

User feedback (may be in Chinese or English):
"${userFeedback}"

Rewrite the prompt to address the user's feedback while keeping everything else intact and consistent with the drama's visual style.`,
        temperature: 0.3,
      });
      const revised = schema.parse(result).revisedPrompt.trim();
      return revised || currentPrompt;
    } catch {
      // 降级：保留原 prompt，过滤中文后追加剩余 ASCII 片段
      const asciiHint = userFeedback.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？、""''【】《》]/g, '').trim();
      return asciiHint ? `${currentPrompt}, ${asciiHint}` : currentPrompt;
    }
  }

  private optimizeAssetPrompt(
    rawPrompt: string,
    shotType: 'character' | 'location' | 'style_guide' | 'prop',
    stylePrefix?: string,
    provider?: string,
    styleBucket?: string,
  ): { prompt: string; negativePrompt: string } {
    const profile = this.renderingProfileService.getImageProfile();
    const optimized = this.promptOptimizer.optimizeForT2I(rawPrompt, profile.negativePrompt.defaultValue, {
      shotType,
      qualityTier: 'golden',
      provider,
      styleBucket,
    });
    return { prompt: assembleT2iPrompt(optimized.prompt, profile, { stylePrefix }), negativePrompt: optimized.negativePrompt };
  }

  /**
   * 真人实拍路径安全网：清洗 visualStyle 中因 LLM 直译中文「水墨晕染」而产生的绘画类词汇。
   *
   * 背景：用户用「水墨晕染美感」描述真人剧视觉，LLM 会在 styleReferencePrompt、textureStyle 等
   * 字段里写入 ink-wash / painterly / brush stroke，导致场景图出现国画感，与写实人物图风格分裂。
   * 此方法在 LLM 生成完成后对字符串做最终替换，是提示词层面管控的最后一道保险。
   *
   * 仅对真人实拍类 styleKey（live_action、period_live、hk_film、retro_wuxia、western_film）生效，
   * 水墨/插画类模板不做清洗。
   */
  /**
   * 真人实拍路径安全网：清洗 visualStyle 及 locations 中因 LLM 直译中文「水墨晕染」而产生的绘画类词汇。
   *
   * 背景：用户用「水墨晕染美感」描述真人剧，LLM 会在 styleReferencePrompt、location.visualPrompt 等
   * 字段写入 ink-wash / painterly / brush stroke，导致场景图出现国画感，与写实人物图风格分裂。
   *
   * 仅对真人实拍类 styleKey 生效，水墨/插画类模板不做清洗。
   */
  sanitizeLiveActionVisualStyle(
    vs: Record<string, unknown>,
    styleKey?: string,
    locations?: Array<Record<string, unknown>>,
  ): void {
    const liveActionStyles = new Set(['live_action', 'period_live', 'hk_film', 'retro_wuxia', 'western_film']);
    const isLiveAction = styleKey
      ? liveActionStyles.has(styleKey)
      : /live.?action|photorealistic|真实摄影|实拍|period drama/i.test(
          [(vs['renderTechnique'] ?? ''), (vs['overallAesthetic'] ?? '')].join(' ')
        );
    if (!isLiveAction) return;

    // 绘画类词 → 等效影视词 替换表
    const replacements: Array<[RegExp, string]> = [
      [/\bink[-\s]?wash\b/gi, 'natural cinematic'],
      [/\bsumi[-\s]?e\b/gi, 'film photography'],
      [/\bpainterly\b/gi, 'photorealistic'],
      [/\bbrush\s?stroke\b/gi, 'film grain'],
      [/\bwatercolor\s?(?:painting|wash|style)?\b/gi, 'soft color grading'],
      [/\billustration\s?(?:style|quality)?\b/gi, 'cinematic photography'],
      [/\bink\s?painting\b/gi, 'film photography'],
    ];

    const applyReplacements = (val: string): string => {
      for (const [pattern, replacement] of replacements) {
        val = val.replace(pattern, replacement);
      }
      return val;
    };

    // 清洗 visualStyle 全局字段
    for (const field of ['styleReferencePrompt', 'renderTechnique', 'textureStyle', 'referenceStyle']) {
      if (typeof vs[field] === 'string') vs[field] = applyReplacements(vs[field] as string);
    }

    // 清洗每个场景的 visualPrompt
    // 这是关键：LLM 在山野/自然场景中极易写 "ink-wash painting aesthetic"，
    // 使场景图与写实人物图产生风格分裂
    if (locations?.length) {
      for (const loc of locations) {
        if (typeof loc['visualPrompt'] === 'string') {
          loc['visualPrompt'] = applyReplacements(loc['visualPrompt'] as string);
        }
      }
    }
  }

  /**
   * 从 visualStyle 推断视觉风格桶（与 GenerationPolicyService.detectStyleBucket 保持一致）。
   * 避免注入额外依赖，简单字符串匹配即可。
   */
  detectStyleBucket(vs?: DramaState['visualStyle']): string {
    return detectStyleBucketUtil(vs);
  }

  /**
   * 为 flux-2/pro-image-to-image 构建变换帧式（transformation-focused）角度提示词。
   * 该模型接受参考图作为身份锚点，因此提示词聚焦"变换到什么角度/姿态"而非重复描述人脸。
   */
  private buildI2IViewAnglePrompt(
    ch: { defaultCostume?: string; defaultCostumePrompt?: string; bodyType?: string; bodyTypePrompt?: string },
    viewAngle: string,
  ): string {
    const costume = ch.defaultCostumePrompt || ch.defaultCostume || '';
    const body = ch.bodyTypePrompt || ch.bodyType || '';
    const costumeClause = costume ? `, wearing ${costume}` : '';
    const bodyClause = body ? `, ${body} build` : '';
    switch (viewAngle) {
      case 'face_three_quarter':
        return `Same person as reference photo, three quarter view portrait, slightly turned face${costumeClause}, consistent face and hair identity, neutral background`;
      case 'upper_body_front':
        return `Same person as reference photo, upper body portrait, facing forward${costumeClause}${bodyClause}, consistent identity, neutral background`;
      case 'full_body_front':
        return `Same person as reference photo, full body standing portrait, facing forward${costumeClause}${bodyClause}, neutral studio background, consistent identity`;
      case 'side_profile':
        return `Same person as reference photo, strict side profile, facing left${costumeClause}, consistent hair and facial features, neutral background`;
      case 'back_view':
        return `Same person as reference photo, back view${costumeClause}${bodyClause}, neutral background`;
      case 'face_happy':
        return `Same person as reference photo, front-facing portrait, happy expression, genuine slight smile, pleased and warm, subtle not exaggerated${costumeClause}, consistent facial bone structure, same face identity, no face drift, neutral background`;
      case 'face_angry':
        return `Same person as reference photo, front-facing portrait, angry expression, furrowed brows, sharp stern gaze, controlled tension in eyes, not distorted${costumeClause}, consistent facial bone structure, same face identity, no face drift, neutral background`;
      default:
        return `Same person as reference photo, ${viewAngle} view${costumeClause}, consistent identity`;
    }
  }

  /**
   * 构建 T2I 风格前缀。
   *
   * Character portrait 优先级：
   *   1. characterStylePrompt（角色专用前缀，仅含时代+渲染，无场景条件词）
   *   2. styleReferencePrompt（全局风格，通常无条件词）
   *   3. Fallback：overallAesthetic + renderTechnique + referenceStyle
   *      （排除 colorGrading / lightingStyle，避免"for X scenes / for interiors"等
   *       多条件描述同时出现互相矛盾，且不适用于中性背景的角色定妆参考图）
   *
   * Scene / location 路径：
   *   1. styleReferencePrompt
   *   2. Fallback：全量 6 字段拼接
   */
  /**
   * 某视角是否已有可用的参考图 URL。
   * 批量「生成全部参考图」时用于跳过已生成项，避免重复计费；单资产重生仍走专用接口。
   * 兼容仅写入 referenceImageUrl、未写入对应 referenceImages 行的历史数据。
   */
  private referenceViewFilled(
    asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages' | 'assetType'>,
    viewAngle: string,
  ): boolean {
    const fromList = asset.referenceImages?.find((r) => r.viewAngle === viewAngle)?.imageUrl?.trim();
    if (fromList) return true;
    if (!asset.referenceImageUrl?.trim()) return false;
    if (viewAngle === 'face_front' && asset.assetType === 'character') {
      return !asset.referenceImages?.some((r) => r.viewAngle === 'face_front');
    }
    if (viewAngle === 'establishing' && asset.assetType === 'location') {
      return !asset.referenceImages?.some((r) => r.viewAngle === 'establishing');
    }
    if (viewAngle === 'style_master' && asset.assetType === 'style_guide') {
      return !asset.referenceImages?.some((r) => r.viewAngle === 'style_master');
    }
    if (viewAngle === 'product_shot' && asset.assetType === 'prop') {
      return !asset.referenceImages?.some((r) => r.viewAngle === 'product_shot');
    }
    return false;
  }

  buildAssetStylePrefix(vs?: DramaState['visualStyle'], shotType: 'character' | 'location' | 'style_guide' = 'location'): string | undefined {
    return buildAssetStylePrefixUtil(vs, shotType);
  }

  async generateReferenceImages(
    dramaId: string, assets: VisualAssetEntity[],
    characters: DramaState['characters'], locations: DramaState['locations'],
    visualStyle?: DramaState['visualStyle'],
    userId?: string,
  ): Promise<void> {
    const profile = this.renderingProfileService.getImageProfile();
    const charAssets = assets.filter(a => a.assetType === 'character');
    const locAssets = assets.filter(a => a.assetType === 'location');
    const styleAssets = assets.filter(a => a.assetType === 'style_guide');
    const propAssets = assets.filter(a => a.assetType === 'prop');

    // ═══ Phase 1: face_front + 场景参考图（并发） ═══
    // 角色 portrait 前缀不含 colorGrading/lightingStyle（避免场景条件词污染中性背景）
    const charStylePrefix = this.buildAssetStylePrefix(visualStyle, 'character');
    const sceneStylePrefix = this.buildAssetStylePrefix(visualStyle, 'location');
    const assetStyleBucket = this.detectStyleBucket(visualStyle);
    const phase1Tasks = [
      ...charAssets.map(asset => async () => {
        if (await this.stateStore.isCancelled(dramaId)) return;
        const ch = characters.find(c => c.characterId === asset.refId);
        if (!ch) return;
        if (!ch.faceReferencePrompt?.trim()) {
          // faceReferencePrompt 必须是英文 T2I 提示词，中文字段（faceDescription 等）不能替代
          // 根因：建剧时 LLM 遗漏了该字段，需重新设计该角色或重跑建剧流程
          this.logger.error(`[Phase1] 跳过 ${ch.name}(${asset.refId})：faceReferencePrompt 为空，无法生成参考图。请重新创建短剧或检查 LLM 输出`);
          return;
        }
        if (this.referenceViewFilled(asset, 'face_front')) return;
        try {
          this.logger.log(`[Phase1] face_front: ${ch.name}(${asset.refId})`);
          const faceRoute = this.imageRouter.routeCharacterFace(DramaVisualAssetService.CHAR_IMAGE_SIZE);
          // Phase 1 面部定妆照：补充年龄、发型、服饰、体型、背景和朝向 prompt
          // 始终从 age 字段推导（ageToT2IPhrase 取范围最小值），agePrompt 仅作兜底
          const agePhrase = ageToT2IPhrase((ch as any).age) || (ch as any).agePrompt?.trim() || '';
          // Use pre-compiled referenceImagePrompt if available (skips one LLM call),
          // otherwise fall back to PromptCompiler for backward compatibility
          let compiledPrompt: string;
          if ((ch as any).referenceImagePrompt?.trim()) {
            compiledPrompt = (ch as any).referenceImagePrompt.trim();
            this.logger.log(`[Phase1] Using pre-compiled referenceImagePrompt for ${ch.name}`);
          } else {
            compiledPrompt = await this.promptCompiler.compile({
              shotType: 'character',
              face: ch.faceReferencePrompt,
              age: agePhrase,
              hair: ch.hairStylePrompt || ch.hairStyle,
              costume: ch.defaultCostumePrompt,
              body: (ch as any).bodyTypePrompt || (ch as any).bodyType,
              style: charStylePrefix,
            });
          }
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(compiledPrompt, 'character', undefined, faceRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaVisualAssetService.CHAR_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'character_image', refId: asset.refId, userId,
            ...faceRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(asset, 'face_front', result.images[0].url);
            asset.referenceImageUrl = updated.referenceImageUrl;
            asset.referenceImages = updated.referenceImages;
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) {
          this.logger.error(`[Phase1] face_front 生成失败，该角色将跳过多视角生成: ${ch.name}(${asset.refId}) — ${(err as Error).message}`);
        }
      }),
      ...locAssets.map(asset => async () => {
        if (await this.stateStore.isCancelled(dramaId)) return;
        const loc = locations.find(l => l.locationId === asset.refId);
        if (!loc?.visualPrompt) {
          this.logger.warn(`[Phase1] 场景 ${asset.refId} 缺少 visualPrompt，跳过参考图生成`);
          return;
        }
        if (this.referenceViewFilled(asset, 'establishing')) return;
        try {
          this.logger.log(`[Phase1] establishing: ${loc.name}(${asset.refId})`);
          // Use pre-compiled referenceImagePrompt if available (skips one LLM call),
          // otherwise fall back to PromptCompiler
          let compiledPrompt: string;
          if ((loc as any).referenceImagePrompt?.trim()) {
            compiledPrompt = (loc as any).referenceImagePrompt.trim();
            this.logger.log(`[Phase1] Using pre-compiled referenceImagePrompt for ${loc.name}`);
          } else {
            compiledPrompt = await this.promptCompiler.compile({
              shotType: 'location',
              view_angle: 'establishing',
              architecture: loc.visualPrompt,
              lighting: (loc as any).lightingDefault,
              color_tone: (loc as any).colorTone,
              style: sceneStylePrefix,
            });
          }
          const locRoute = this.imageRouter.routeLocation(DramaVisualAssetService.SCENE_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(compiledPrompt, 'location', undefined, locRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaVisualAssetService.SCENE_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'location_image', refId: asset.refId, userId,
            ...locRoute,
          });
          if (result.images?.[0]?.url) {
            const updated = this.upsertReferenceByView(asset, 'establishing', result.images[0].url);
            asset.referenceImageUrl = updated.referenceImageUrl;
            asset.referenceImages = updated.referenceImages;
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.error(`[Phase1] 场景参考图生成失败: ${loc.name}(${asset.refId}) — ${(err as Error).message}`); }
      }),
      ...styleAssets.map(asset => async () => {
        if (await this.stateStore.isCancelled(dramaId)) return;
        if (this.referenceViewFilled(asset, 'style_master')) return;
        const style = asset.data as Record<string, unknown>;
        // 优先使用视觉设计师生成的纯英文 styleReferencePrompt，避免中英混杂降低 T2I 质量
        const styleRefPrompt = String(style.styleReferencePrompt ?? '').trim();
        let rawPrompt: string;
        if (styleRefPrompt && !/[\u4e00-\u9fff]/.test(styleRefPrompt)) {
          // 使用纯英文的 styleReferencePrompt
          rawPrompt = `${styleRefPrompt}, concept art mood board, consistent style sheet`;
        } else {
          // 回退：从各字段中过滤出英文部分（移除中文）
          const parts = [
            String(style.overallAesthetic ?? ''),
            String(style.renderTechnique ?? ''),
            String(style.textureStyle ?? ''),
            String(style.colorGrading ?? ''),
            String(style.lightingStyle ?? ''),
            String(style.referenceStyle ?? ''),
          ].map(p => p.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufa2f]+/g, ' ').replace(/[，。！？、：；""''（）【】《》]/g, ' ').trim())
           .filter(Boolean);
          if (!parts.length) return;
          rawPrompt = `${parts.join(', ')}, concept art mood board, consistent style sheet`;
        }
        try {
          this.logger.log(`[Phase1] 风格参考图: ${asset.refId}`);
          const styleRoute = this.imageRouter.routeStyleGuide(DramaVisualAssetService.SCENE_IMAGE_SIZE);
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'style_guide', undefined, styleRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt,
            size: DramaVisualAssetService.SCENE_IMAGE_SIZE,
            count: 1,
            dramaId,
            assetType: 'style_guide_image',
            refId: asset.refId,
            userId,
            ...styleRoute,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            asset.referenceImages = [{ viewAngle: 'style_master', imageUrl: result.images[0].url }];
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`风格参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
      // Prop reference images (product-shot style, 1:1 square)
      // Note: NO style prefix — prop visualPrompt already specifies "white background, studio lighting"
      // which conflicts with drama's cinematic style prefix.
      ...propAssets.map(asset => async () => {
        if (await this.stateStore.isCancelled(dramaId)) return;
        const propData = asset.data as Record<string, unknown>;
        const rawPrompt = String(propData.visualPrompt ?? '').trim();
        if (!rawPrompt) return;
        if (this.referenceViewFilled(asset, 'product_shot')) return;
        try {
          this.logger.log(`[Phase1] prop: ${asset.name}(${asset.refId})`);
          const propRoute = this.imageRouter.routeProp(DramaVisualAssetService.PROP_IMAGE_SIZE);
          // Use pre-compiled referenceImagePrompt if available (skips one LLM call)
          let compiledPrompt: string;
          const propRefPrompt = (propData as any).referenceImagePrompt?.trim();
          if (propRefPrompt) {
            compiledPrompt = propRefPrompt;
            this.logger.log(`[Phase1] Using pre-compiled referenceImagePrompt for prop ${asset.name}`);
          } else {
            compiledPrompt = await this.promptCompiler.compile({
              shotType: 'prop',
              object: rawPrompt,
            });
          }
          const { prompt, negativePrompt } = this.optimizeAssetPrompt(compiledPrompt, 'prop', undefined, propRoute.provider, assetStyleBucket);
          const result = await this.mediaService.generateImage({
            prompt, negativePrompt, size: DramaVisualAssetService.PROP_IMAGE_SIZE, count: 1,
            dramaId, assetType: 'prop_image', refId: asset.refId, userId,
            ...propRoute,
          });
          if (result.images?.[0]?.url) {
            asset.referenceImageUrl = result.images[0].url;
            asset.referenceImages = [{ viewAngle: 'product_shot', imageUrl: result.images[0].url }];
            await this.visualAssetRepo.update(asset.id, {
              referenceImageUrl: asset.referenceImageUrl,
              referenceImages: asset.referenceImages,
            });
          }
        } catch (err) { this.logger.warn(`道具参考图失败: ${asset.refId} — ${(err as Error).message}`); }
      }),
    ];
    await this.runConcurrent(phase1Tasks, 3);

    // Phase 2 / 2b（多视角链式生成）已移除 — 多视角参考图改为逐集按需生成

    // ═══ Phase 3: 角色外观变体参考图 ═══
    // 已迁移至媒体编排器懒加载：按需在 generateEpisodeMedia/generateEpisodeImages 中生成。
    // 此处不再提前批量生成，避免生成未使用的变体图（浪费成本）并确保变体图与剧情语境匹配。
  }

  /** 重新生成单个角色外观变体参考图 */
  async regenerateVariationImage(
    dramaId: string,
    assetId: string,
    variationId: string,
    userId?: string,
  ): Promise<VisualAssetEntity> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    if (asset.assetType !== 'character') throw new Error('仅角色资产支持变体重生');

    const charData = asset.data as Record<string, unknown>;
    const variations = (charData.variations ?? []) as Array<Record<string, unknown>>;
    const variation = variations.find((v) => v.variationId === variationId);
    if (!variation) throw new NotFoundException(`变体 ${variationId} 不存在`);

    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    const vs = (drama?.state as any)?.visualStyle as DramaState['visualStyle'] | undefined;
    const stylePrefix = this.buildAssetStylePrefix(vs, 'character');
    const styleBucket = this.detectStyleBucket(vs);

    const baseImg = asset.referenceImageUrl;
    const refImages = baseImg ? [{ url: baseImg, weight: 0.6 }] : [];

    const rawPrompt = [
      String(charData.faceReferencePrompt ?? ''),
      String(charData.hairStylePrompt ?? charData.hairStyle ?? ''),
      String(charData.bodyTypePrompt ?? charData.bodyType ?? ''),
      String(variation.visualPromptOverride ?? ''),
      'same person as reference',
    ].filter(Boolean).join(', ');

    const varRoute = this.imageRouter.routeCharacterVariation(DramaVisualAssetService.CHAR_IMAGE_SIZE);
    const { prompt, negativePrompt } = this.optimizeAssetPrompt(rawPrompt, 'character', stylePrefix, varRoute.provider, styleBucket);

    const result = await this.mediaService.generateImage({
      prompt, negativePrompt,
      size: DramaVisualAssetService.CHAR_IMAGE_SIZE, count: 1, referenceImages: refImages,
      dramaId, assetType: 'character_variation', refId: `${charData.characterId}_${variationId}`, userId,
      ...varRoute,
    });

    const imageUrl = result.images?.[0]?.url ?? '';
    if (!imageUrl) throw new Error('变体图片生成结果为空');

    variation.referenceImageUrl = imageUrl;
    const updatedData = { ...charData, variations };
    await this.visualAssetRepo.update(asset.id, { data: updatedData });

    // 同步更新 drama.state.characters[].variations[].referenceImageUrl，确保媒体编排器读 state 时能感知新 URL
    if (drama) {
      const stateObj = drama.state as unknown as DramaState;
      const stateChar = stateObj.characters?.find(c => c.characterId === String(charData.characterId ?? ''));
      const stateVariation = stateChar?.variations?.find(v => v.variationId === variationId);
      if (stateVariation) {
        stateVariation.referenceImageUrl = imageUrl;
        await this.dramaRepo.save(drama);
      }
    }

    this.logger.log(`变体参考图重生完成: ${charData.characterId}/${variationId}`);

    return (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
  }

  private normalizeCharacterViewAngle(viewAngle?: string): CharacterViewAngle {
    const v = String(viewAngle ?? '').trim();
    return (CHARACTER_VIEW_ANGLES as readonly string[]).includes(v) ? (v as CharacterViewAngle) : 'face_front';
  }

  private normalizeLocationViewAngle(viewAngle?: string): LocationViewAngle {
    const v = String(viewAngle ?? '').trim();
    return (LOCATION_VIEW_ANGLES as readonly string[]).includes(v) ? (v as LocationViewAngle) : 'establishing';
  }

  private normalizeRefineScope(scope?: string): RefineSyncScope {
    if (scope === 'single' || scope === 'group' || scope === 'all') return scope;
    return 'group';
  }

  private normalizeRefineStrength(strength?: string): RefineStrength {
    if (strength === 'light' || strength === 'balanced' || strength === 'strong') return strength;
    return 'balanced';
  }

  private resolveRefineStrengthHint(strength: RefineStrength): string {
    if (strength === 'light') return 'small conservative adjustment, keep identity and composition stable';
    if (strength === 'strong') return 'large visual change allowed, still keep core identity';
    return 'balanced adjustment on target elements, keep key identity consistent';
  }

  private resolveCharacterSizeByView(viewAngle: CharacterViewAngle): string {
    if (viewAngle === 'full_body_front' || viewAngle === 'back_view') return '9:16';
    return DramaVisualAssetService.CHAR_IMAGE_SIZE;
  }

  private resolveAssetPrompt(asset: VisualAssetEntity, viewAngle?: string): string {
    const data = (asset.data ?? {}) as Record<string, unknown>;
    if (asset.assetType === 'character') {
      const fallback = String(data.faceReferencePrompt || '').trim();
      try {
        return buildViewAnglePrompt(data as any, (viewAngle ?? 'face_front') as CharacterViewAngle) || fallback;
      } catch {
        return fallback;
      }
    }
    if (asset.assetType === 'location') {
      const locView = this.normalizeLocationViewAngle(viewAngle);
      const locPrompt = buildLocationViewPrompt(data as any, locView);
      return locPrompt || String(data.visualPrompt || '').trim();
    }
    if (asset.assetType === 'prop') {
      // Prefer referenceImagePrompt (full product-photography prompt) for re-generation,
      // fall back to bare visualPrompt (gene fragment) if not present
      return String(data.referenceImagePrompt || data.visualPrompt || '').trim();
    }
    return [
      String(data.overallAesthetic ?? ''),
      String(data.renderTechnique ?? ''),
      String(data.textureStyle ?? ''),
      String(data.colorGrading ?? ''),
      String(data.lightingStyle ?? ''),
      String(data.referenceStyle ?? ''),
    ].map((p) => p.trim()).filter(Boolean).join(', ');
  }

  private collectAssetRefs(asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages'>): Array<{ url: string; weight: number }> {
    const refs: Array<{ url: string; weight: number }> = [];
    if (asset.referenceImageUrl) refs.push({ url: asset.referenceImageUrl, weight: 0.6 });
    for (const ref of asset.referenceImages ?? []) {
      if (!ref?.imageUrl) continue;
      if (refs.some((item) => item.url === ref.imageUrl)) continue;
      refs.push({ url: ref.imageUrl, weight: 0.5 });
      if (refs.length >= 3) break;
    }
    return refs;
  }

  private upsertReferenceByView(
    asset: Pick<VisualAssetEntity, 'referenceImageUrl' | 'referenceImages'>,
    viewAngle: string,
    imageUrl: string,
  ): { referenceImageUrl: string; referenceImages: Array<{ viewAngle: string; imageUrl: string }> } {
    return upsertReferenceByViewUtil(asset, viewAngle, imageUrl);
  }

  private resolveAffectedCharacterViews(targetView: CharacterViewAngle, scope: RefineSyncScope): CharacterViewAngle[] {
    if (scope === 'single') return [targetView];
    if (scope === 'all' || targetView === 'face_front') {
      return [...CHARACTER_VIEW_ANGLES];
    }
    const faceGroup: CharacterViewAngle[] = ['face_three_quarter', 'side_profile', 'back_view'];
    const framingGroup: CharacterViewAngle[] = ['upper_body_front', 'full_body_front'];
    if (faceGroup.includes(targetView)) {
      return faceGroup;
    }
    if (framingGroup.includes(targetView)) {
      return framingGroup;
    }
    return [targetView];
  }

  /**
   * 批量生成一个短剧的所有参考图（角色定妆照 + 场景图 + 风格图）。
   * 供创建完成后、工作台手动触发，不阻塞创建流程。
   */
  async generateAllVisualAssets(dramaId: string, userId?: string): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    if (!state?.characters?.length) throw new Error(`短剧 ${dramaId} 尚未完成创建，无法生成参考图`);
    const assets = await this.visualAssetRepo.find({ where: { dramaId } });
    await this.generateReferenceImages(dramaId, assets, state.characters, state.locations ?? [], state.visualStyle, userId);
    await this.refreshVisualBible(dramaId);
  }

  /**
   * 用 LLM 重新生成指定角色的 faceReferencePrompt（及相关英文 T2I 字段）。
   * 适用于建剧时 LLM 遗漏/截断导致字段为空，不需要重新跑整个建剧流程。
   */
  async redesignCharacterFacePrompt(dramaId: string, characterId: string, userId?: string): Promise<{ characterId: string; name: string; faceReferencePrompt: string }> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const char = state.characters?.find(c => c.characterId === characterId);
    if (!char) throw new NotFoundException(`角色 ${characterId} 不存在`);

    const vs = state.visualStyle;
    const facePromptRule = (state as any).visualBible?.facePromptRule
      ?? vs?.facePromptRule
      ?? 'faceReferencePrompt 必须以【渲染风格词 + 角色身份词】开头，先锚定风格，再描述五官。只写纯粹的外观基因词（3-5个），不含镜头/背景词。';

    const repairSchema = z.object({
      faceReferencePrompt: z.string().min(1),
      bodyTypePrompt: z.string().default(''),
      hairStylePrompt: z.string().default(''),
      defaultCostumePrompt: z.string().default(''),
    });

    const styleCtx = vs
      ? `美学风格：${vs.overallAesthetic ?? ''}, 调色：${vs.colorGrading ?? ''}, 光影：${vs.lightingStyle ?? ''}, 渲染：${vs.renderTechnique ?? ''}`
      : '风格未知';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-repair-character-face-prompt',
      schema: repairSchema,
      metadata: { dramaId, userId },
      systemPrompt: `你是短剧视觉总监，负责为角色生成精准的英文 T2I 面部提示词。
全剧视觉风格：${styleCtx}
faceReferencePrompt 规则：${facePromptRule}
只输出英文 T2I 提示词，不要输出中文解释。`,
      userPrompt: `请为以下角色生成 faceReferencePrompt：
角色名：${char.name}
角色定位：${char.role}
面部描述（中文）：${char.faceDescription ?? '未知'}
肤色：${char.skinTone ?? ''}
体型：${char.bodyType ?? ''}
发型：${char.hairStyle ?? ''}
服饰：${char.defaultCostume ?? ''}
标志特征：${char.distinguishingFeatures ?? ''}`,
      temperature: 0.3,
    });

    const repaired = repairSchema.parse(raw);

    // 更新 state.characters
    char.faceReferencePrompt = repaired.faceReferencePrompt;
    if (repaired.bodyTypePrompt) char.bodyTypePrompt = repaired.bodyTypePrompt;
    if (repaired.hairStylePrompt) char.hairStylePrompt = repaired.hairStylePrompt;
    if (repaired.defaultCostumePrompt) char.defaultCostumePrompt = repaired.defaultCostumePrompt;
    drama.state = state as unknown as Record<string, unknown>;
    await this.dramaRepo.save(drama);

    this.logger.log(`[RepairFacePrompt] ${char.name}(${characterId}) 修复完成: "${repaired.faceReferencePrompt.slice(0, 80)}..."`);
    return { characterId, name: char.name, faceReferencePrompt: repaired.faceReferencePrompt };
  }

  /**
   * 手动 patch 指定角色的字段（前端手动编辑 faceReferencePrompt 等）。
   * 只允许修改安全字段，不允许改 characterId / role / scope。
   */
  async patchCharacter(
    dramaId: string,
    characterId: string,
    patch: Partial<Pick<DramaState['characters'][number], 'faceReferencePrompt' | 'faceDescription' | 'bodyTypePrompt' | 'hairStylePrompt' | 'defaultCostumePrompt' | 'defaultCostume' | 'distinguishingFeatures'>>,
  ): Promise<{ characterId: string; name: string }> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const char = state.characters?.find(c => c.characterId === characterId);
    if (!char) throw new NotFoundException(`角色 ${characterId} 不存在`);

    const allowed: Array<keyof typeof patch> = [
      'faceReferencePrompt', 'faceDescription', 'bodyTypePrompt',
      'hairStylePrompt', 'defaultCostumePrompt', 'defaultCostume', 'distinguishingFeatures',
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) (char as any)[key] = patch[key];
    }

    drama.state = state as unknown as Record<string, unknown>;
    await this.dramaRepo.save(drama);
    this.logger.log(`[PatchCharacter] ${char.name}(${characterId}) 字段已更新: ${Object.keys(patch).join(', ')}`);
    return { characterId, name: char.name };
  }

  /** 从 DB 重新加载最新资产图片 URL，刷新 drama.state.visualBible */
  private async refreshVisualBible(dramaId: string): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const assets = await this.visualAssetRepo.find({ where: { dramaId } });
    state.visualBible = this.buildVisualBible(state.characters, state.visualStyle, state.promptProfile, assets);
    drama.state = state as unknown as Record<string, unknown>;
    await this.dramaRepo.save(drama);
  }

  /** 重新生成单个视觉资产的参考图（角色/场景均支持按视角重生） */
  async regenerateAssetImage(
    dramaId: string,
    assetId: string,
    userId?: string,
    opts?: { viewAngle?: string },
  ): Promise<VisualAssetEntity> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    const isChar = asset.assetType === 'character';
    const isLoc = asset.assetType === 'location';
    const isProp = asset.assetType === 'prop';
    const targetView = isChar
      ? this.normalizeCharacterViewAngle(opts?.viewAngle)
      : isLoc
        ? this.normalizeLocationViewAngle(opts?.viewAngle)
        : isProp
          ? 'product_shot'
          : 'establishing';
    const prompt = this.resolveAssetPrompt(asset, targetView);
    if (!prompt) throw new Error(`资产 ${assetId} 缺少生成提示词`);
    const size = isChar
      ? this.resolveCharacterSizeByView(targetView as CharacterViewAngle)
      : isProp
        ? DramaVisualAssetService.PROP_IMAGE_SIZE
        : DramaVisualAssetService.SCENE_IMAGE_SIZE;
    const nonCharShotType = asset.assetType === 'style_guide' ? 'style_guide' : (asset.assetType === 'prop' ? 'prop' : 'location');
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    const vs = (drama?.state as any)?.visualStyle;
    const regenStyleBucket = this.detectStyleBucket(vs);
    const stylePrefix = isProp ? undefined : this.buildAssetStylePrefix(vs, isChar ? 'character' : (nonCharShotType as any));
    // 按资产类型选择最优模型路由
    const route = isChar
      ? (targetView === 'face_front'
        ? this.imageRouter.routeCharacterFace(size)
        : this.imageRouter.routeCharacterViewAngle(size))
      : (isProp)
        ? this.imageRouter.routeProp(size)
        : (isLoc)
          ? this.imageRouter.routeLocation(size)
          : {};
    const optimized = this.optimizeAssetPrompt(prompt, isChar ? 'character' : nonCharShotType as any, stylePrefix, route.provider, regenStyleBucket);
    // 主视角/道具：从零生成，不传参考图
    const isPrimaryView = (isChar && targetView === 'face_front') || (isLoc && targetView === 'establishing') || isProp;
    const refs = isPrimaryView ? [] : this.collectAssetRefs(asset);
    const result = await this.mediaService.generateImage({
      prompt: optimized.prompt,
      negativePrompt: optimized.negativePrompt,
      size,
      count: 1,
      referenceImages: refs,
      dramaId,
      assetType: `${asset.assetType}_image`,
      refId: asset.refId,
      userId,
      ...route,
    });
    const imageUrl = result.images?.[0]?.url ?? '';
    if (!imageUrl) throw new Error('重新生成结果为空');
    if (isChar) {
      // 懒加载：直接在已有视角上 upsert，不重建空槽
      const updated = this.upsertReferenceByView(
        { referenceImageUrl: asset.referenceImageUrl, referenceImages: asset.referenceImages ?? [] },
        targetView,
        imageUrl,
      );
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: updated.referenceImageUrl,
        referenceImages: updated.referenceImages,
      });
    } else if (isLoc) {
      // 懒加载：直接在已有视角上 upsert，不重建空槽
      const updated = this.upsertReferenceByView(
        { referenceImageUrl: asset.referenceImageUrl, referenceImages: asset.referenceImages ?? [] },
        targetView,
        imageUrl,
      );
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: updated.referenceImageUrl,
        referenceImages: updated.referenceImages,
      });
    } else if (isProp) {
      await this.visualAssetRepo.update(asset.id, {
        referenceImageUrl: imageUrl,
        referenceImages: [{ viewAngle: 'product_shot', imageUrl }],
      });
    } else {
      await this.visualAssetRepo.update(asset.id, { referenceImageUrl: imageUrl });
    }
    const refreshed = (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
    // 后台异步刷新 visualBible，确保集数生成时能引用最新角色参考图（不阻塞响应）
    setImmediate(() => this.refreshVisualBible(dramaId).catch((e) => this.logger.warn(`refreshVisualBible failed: ${e?.message}`)));
    return refreshed;
  }

  /** 图生图精修：支持按视角与同步范围进行角色联动 */
  async refineAssetImage(
    dramaId: string,
    assetId: string,
    input: {
      instruction: string;
      viewAngle?: string;
      syncScope?: RefineSyncScope;
      strength?: RefineStrength;
      preserveIdentity?: boolean;
      userId?: string;
    },
  ): Promise<{ asset: VisualAssetEntity; affectedViews: string[] }> {
    const asset = await this.visualAssetRepo.findOne({ where: { id: assetId, dramaId } });
    if (!asset) throw new NotFoundException(`视觉资产 ${assetId} 不存在`);
    const rawInstruction = String(input.instruction || '').trim();
    if (!rawInstruction) throw new Error('请输入修改要求');
    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    const dramaState = (drama?.state ?? {}) as any;
    const regenStyleBucket = this.detectStyleBucket(dramaState?.visualStyle);
    const isChar = asset.assetType === 'character';
    const isLoc = asset.assetType === 'location';
    const isProp = asset.assetType === 'prop';
    const targetView = isChar
      ? this.normalizeCharacterViewAngle(input.viewAngle)
      : isLoc
        ? this.normalizeLocationViewAngle(input.viewAngle)
        : isProp
          ? 'product_shot'
          : 'establishing';
    const syncScope = this.normalizeRefineScope(input.syncScope);
    const strength = this.normalizeRefineStrength(input.strength);
    const preserveIdentity = input.preserveIdentity ?? true;
    const strengthHint = this.resolveRefineStrengthHint(strength);
    // Props have only one view (product_shot), no multi-view sync needed
    const affectedViews = isChar
      ? this.resolveAffectedCharacterViews(targetView as CharacterViewAngle, syncScope)
      : [targetView];
    const targetViews = affectedViews;
    let nextPrimary = asset.referenceImageUrl;
    let nextRefs = [...(asset.referenceImages ?? [])];
    let successCount = 0;

    for (const view of targetViews) {
      const basePrompt = this.resolveAssetPrompt({
        ...asset,
        referenceImageUrl: nextPrimary,
        referenceImages: nextRefs,
      } as VisualAssetEntity, view);
      if (!basePrompt) continue;
      // LLM 结合剧集风格上下文 + 当前 basePrompt + 用户反馈，输出修正后的完整提示词
      const rewrittenPrompt = await this.rewritePromptByUserFeedback(basePrompt, rawInstruction, asset.assetType, dramaId, dramaState, input.userId);
      this.logger.log(`[RefineAsset][${view}] prompt rewritten: "${basePrompt.slice(0, 60)}..." → "${rewrittenPrompt.slice(0, 60)}..."`);
      const identityHint = isChar && preserveIdentity ? 'keep same identity, face structure, hairstyle and body profile' : '';
      const locationHint = isLoc ? 'keep same location, maintain spatial layout and architectural details' : '';
      const propHint = isProp ? 'keep same object, maintain shape and material details' : '';
      const prompt = [
        rewrittenPrompt,
        strengthHint,
        identityHint,
        locationHint,
        propHint,
      ].filter(Boolean).join(', ');
      const refineSize = isChar
        ? this.resolveCharacterSizeByView(view as CharacterViewAngle)
        : isProp
          ? DramaVisualAssetService.PROP_IMAGE_SIZE
          : DramaVisualAssetService.SCENE_IMAGE_SIZE;
      const refineRoute = this.imageRouter.routeRefinement(refineSize);
      const refineShotType = isChar ? 'character' : (asset.assetType === 'style_guide' ? 'style_guide' : 'location');
      const optimized = this.optimizeAssetPrompt(prompt, refineShotType, undefined, refineRoute.provider, regenStyleBucket);
      const refs = this.collectAssetRefs({ referenceImageUrl: nextPrimary, referenceImages: nextRefs });
      const result = await this.mediaService.generateImage({
        prompt: optimized.prompt,
        negativePrompt: optimized.negativePrompt,
        size: refineSize,
        count: 1,
        referenceImages: refs,
        dramaId,
        assetType: `${asset.assetType}_refine`,
        refId: asset.refId,
        userId: input.userId,
        ...refineRoute,
      });
      const imageUrl = result.images?.[0]?.url ?? '';
      if (!imageUrl) continue;
      successCount += 1;
      if (isChar || isLoc) {
        const viewUpdated = this.upsertReferenceByView({ referenceImageUrl: nextPrimary, referenceImages: nextRefs }, view, imageUrl);
        nextPrimary = viewUpdated.referenceImageUrl;
        nextRefs = viewUpdated.referenceImages;
      } else if (isProp) {
        nextPrimary = imageUrl;
        nextRefs = [{ viewAngle: 'product_shot', imageUrl }];
      } else {
        nextPrimary = imageUrl;
      }
    }

    if (!successCount) throw new Error('精修失败，未产出图片');
    await this.visualAssetRepo.update(asset.id, {
      referenceImageUrl: nextPrimary,
      ...((isChar || isLoc || isProp) ? { referenceImages: nextRefs } : {}),
    });
    const updated = (await this.visualAssetRepo.findOne({ where: { id: asset.id } })) ?? asset;
    // 后台异步刷新 visualBible，确保集数生成时能引用最新角色参考图（不阻塞响应）
    setImmediate(() => this.refreshVisualBible(dramaId).catch((e) => this.logger.warn(`refreshVisualBible failed: ${e?.message}`)));
    return { asset: updated, affectedViews };
  }

  buildVisualBible(
    characters: DramaState['characters'],
    visualStyle: DramaState['visualStyle'] | undefined,
    promptProfile: DramaState['promptProfile'] | undefined,
    visualAssets: Array<Partial<VisualAssetEntity>>,
  ): NonNullable<DramaState['visualBible']> {
    const charAssetMap = new Map(
      visualAssets
        .filter((a) => a.assetType === 'character' && a.refId)
        .map((a) => [a.refId!, a]),
    );
    const locAssetMap = new Map(
      visualAssets
        .filter((a) => a.assetType === 'location' && a.refId)
        .map((a) => [a.refId!, a]),
    );
    const styleAsset = visualAssets.find((a) => a.assetType === 'style_guide');

    const identityPack = (characters ?? []).map((c) => {
      const asset = charAssetMap.get(c.characterId);
      const refs = Array.isArray(asset?.referenceImages) ? asset!.referenceImages! : [];
      const faceFront = refs.find((r) => r.viewAngle === 'face_front')?.imageUrl || asset?.referenceImageUrl || '';
      const face34 = refs.find((r) => r.viewAngle === 'face_three_quarter')?.imageUrl || '';
      const upperOrFull = refs.find((r) => r.viewAngle === 'upper_body_front')?.imageUrl
        || refs.find((r) => r.viewAngle === 'full_body_front')?.imageUrl
        || '';
      return {
        characterId: c.characterId,
        faceDna: c.faceDescription,
        anchorImages: { faceFront, face34, upperOrFull },
        variationPolicy: c.variations?.length
          ? `allow:${c.variations.map(v => v.variationId).join(',')}`
          : 'allow:default_only',
      };
    });

    const styleTokens = [
      visualStyle?.overallAesthetic,
      visualStyle?.renderTechnique,
      visualStyle?.textureStyle,
      visualStyle?.colorGrading,
      visualStyle?.lightingStyle,
      visualStyle?.referenceStyle,
    ].filter(Boolean) as string[];

    const styleRefImages = [
      styleAsset?.referenceImageUrl ?? '',
      ...(Array.isArray(styleAsset?.referenceImages) ? styleAsset!.referenceImages!.map((r) => r.imageUrl) : []),
    ].filter(Boolean);

    const preferredAngles = promptProfile?.cameraStyleGuide?.preferredAngles ?? [];
    const movementPolicy = promptProfile?.cameraStyleGuide?.signatureTechniques ?? [];
    const transitionStyle = promptProfile?.cameraStyleGuide?.transitionStyle
      ? [promptProfile.cameraStyleGuide.transitionStyle]
      : [];

    const scenePack = Array.from(locAssetMap.entries()).map(([locationId, asset]) => {
      const refs = Array.isArray(asset?.referenceImages) ? asset!.referenceImages! : [];
      return {
        locationId,
        anchorImages: {
          establishing: refs.find((r) => r.viewAngle === 'establishing')?.imageUrl || asset?.referenceImageUrl || '',
          interiorMedium: refs.find((r) => r.viewAngle === 'interior_medium')?.imageUrl || '',
          detailClose: refs.find((r) => r.viewAngle === 'detail_close')?.imageUrl || '',
        },
      };
    });

    return {
      version: `vb_${Date.now()}`,
      identityPack,
      scenePack,
      stylePack: {
        styleTokens,
        styleRefImages,
        colorLutHint: visualStyle?.colorGrading ?? '',
      },
      cameraPack: {
        preferredAngles,
        movementPolicy: [...movementPolicy, ...transitionStyle],
        continuityRules: [
          'same_scene_keep_axis',
          'avoid_abrupt_scale_jump',
          'emotion_peak_allow_fast_motion_only',
        ],
      },
    };
  }

  /** 简单并发控制器：限并发跑一组 async 任务 */
  private async runConcurrent(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
    let idx = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }));
  }
}
