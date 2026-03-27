/**
 * 视觉资产 Prompt 共享工具函数。
 * 解决 DramaService 与 MediaOrchestratorService 逻辑重复的问题，
 * 两个 Service 均引用此模块，避免循环依赖又保证逻辑一致。
 */
import type { DramaState } from '../schemas/drama-state.schemas';

// ═══ 风格桶检测 ═══

/**
 * 从 visualStyle 推断视觉风格桶。
 * 匹配 GenerationPolicyService.detectStyleBucket 的行为。
 */
export function detectStyleBucket(vs?: DramaState['visualStyle']): string {
  const text = [
    vs?.overallAesthetic ?? '', vs?.renderTechnique ?? '',
    vs?.textureStyle ?? '', vs?.referenceStyle ?? '',
  ].join(' ').toLowerCase();
  if (/定格|粘土|毛毡|纸艺|stop.?motion|clay/.test(text)) return 'stop_motion';
  if (/\b3d\b|cg\b|npr|pixar|迪士尼|赛璐璐/.test(text)) return 'three_d';
  if (/真人|写实|实拍|live.?action|photoreal/.test(text)) return 'live_action';
  if (/\b2d\b|动漫|漫画|手绘|水墨|像素|anime/.test(text)) return 'two_d';
  return 'generic';
}

// ═══ 风格前缀构建 ═══

/**
 * 构建 T2I 风格前缀字符串。
 *
 * Character portrait 优先级：
 *   1. characterStylePrompt（角色专用，仅时代+渲染，无场景条件词）
 *   2. styleReferencePrompt（全局风格）
 *   3. Fallback：overallAesthetic + renderTechnique + referenceStyle
 *
 * Scene / location / style_guide 路径：
 *   1. styleReferencePrompt
 *   2. Fallback：全量 6 字段拼接
 */
export function buildAssetStylePrefix(
  vs?: DramaState['visualStyle'],
  shotType: 'character' | 'location' | 'style_guide' = 'location',
): string | undefined {
  if (!vs) return undefined;

  if (shotType === 'character') {
    const charRef = (vs.characterStylePrompt ?? '').trim();
    if (charRef) return charRef + ', ';
    const styleRef = (vs.styleReferencePrompt ?? '').trim();
    if (styleRef) return styleRef + ', ';
    const parts = [vs.overallAesthetic, vs.renderTechnique, vs.referenceStyle]
      .filter(Boolean).map((p) => (p ?? '').trim()).filter(Boolean);
    return parts.length ? parts.join(', ') + ', ' : undefined;
  }

  // location / style_guide：优先 styleReferencePrompt，回退全量字段
  const styleRef = (vs.styleReferencePrompt ?? '').trim();
  if (styleRef) return styleRef + ', ';
  const parts = [vs.overallAesthetic, vs.renderTechnique, vs.textureStyle, vs.colorGrading, vs.lightingStyle, vs.referenceStyle]
    .filter(Boolean).map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') + ', ' : undefined;
}

// ═══ 参考图视角更新 ═══

export interface ReferenceImageEntry {
  viewAngle: string;
  imageUrl: string;
}

/**
 * 在参考图列表中按 viewAngle 插入或更新图片 URL。
 * 主 URL（referenceImageUrl）自动跟踪 face_front（角色）或 establishing（场景）。
 */
export function upsertReferenceByView(
  asset: { referenceImageUrl?: string; referenceImages?: ReferenceImageEntry[] },
  viewAngle: string,
  imageUrl: string,
): { referenceImageUrl: string; referenceImages: ReferenceImageEntry[] } {
  const nextRefImages = [...(asset.referenceImages ?? [])];
  const idx = nextRefImages.findIndex((item) => item.viewAngle === viewAngle);
  if (idx >= 0) nextRefImages[idx] = { viewAngle, imageUrl };
  else nextRefImages.push({ viewAngle, imageUrl });

  // 主 URL 取 face_front（角色）或 establishing（场景），不存在则保留原值
  const primaryView = nextRefImages.find((item) => item.viewAngle === 'face_front')?.imageUrl
    || nextRefImages.find((item) => item.viewAngle === 'establishing')?.imageUrl;
  const isPrimaryView = viewAngle === 'face_front' || viewAngle === 'establishing';
  const nextPrimary = isPrimaryView ? imageUrl : (primaryView || asset.referenceImageUrl || imageUrl);

  return { referenceImageUrl: nextPrimary, referenceImages: nextRefImages };
}
