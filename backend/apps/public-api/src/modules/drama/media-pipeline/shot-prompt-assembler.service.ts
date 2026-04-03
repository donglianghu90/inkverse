import { Injectable, Logger } from '@nestjs/common';
import type { Shot, DramaState, CharacterIdentity } from '../schemas/drama-state.schemas';
import { PromptOptimizerService } from '../../media/prompt-optimizer.service';

export interface AssembleOpts {
  stylePrefix: string;
  maxTokens: number;
  provider: string;
  batchLighting?: string;
  /** 场景设计师输出的 visualPrompt（建筑/材质/空间描述），程序化注入 T2I */
  sceneVisualPrompt?: string;
}

import { PromptCompilerService } from './prompt-compiler.service';

/**
 * 景别分组 — 决定 prompt block 排列顺序（注意力前置原则）
 *
 * CLIP/T5 编码器对 prompt 前段 token 赋予更高注意力权重。
 * 因此画面中最大的视觉主体必须出现在 prompt 前 30 token 内：
 *  - 特写/中景 → 人物占画面 >50%，identity 在前
 *  - 全景/远景 → 环境占画面 >80%，scene 在前，identity 简化
 */
const CLOSE_SHOTS = new Set(['close_up', 'extreme_close_up', 'medium_close_up']);
const WIDE_SHOTS = new Set(['wide', 'extreme_wide', 'medium_wide']);

@Injectable()
export class ShotPromptAssemblerService {
  private readonly logger = new Logger('ShotPromptAssembler');

  constructor(private readonly promptCompiler: PromptCompilerService) {}

  /**
   * 组装或编译最终呈现的 T2I Prompt。
   *
   * 设计原则：
   * 1. Camera hints 由 PromptOptimizer 统一注入（FRAMING_SCALE_HINTS + ANGLE_PERSPECTIVE_HINTS），
   *    本层 **不再** 生成 cameraBlock，避免双重注入浪费 token。
   * 2. ambientPopulation 由 PromptOptimizer L326 注入，本层不拼接。
   * 3. Block 顺序遵循 CLIP 注意力前置原则：画面主体在前。
   * 4. 角色 identity 使用自然英语描述，不使用 [bracket] 语法（避免 CLIP 误解析为降权）。
   */
  async assembleT2iPrompt(shot: Shot, state: DramaState, sceneContent: string, opts: AssembleOpts): Promise<string> {
    const charMap = new Map((state.characters || []).map(c => [c.characterId, c])) as Map<string, CharacterIdentity>;
    
    // Extracted raw materials
    const identityBlock = this.buildIdentityBlock(shot, state, charMap);
    const styleBlock = (opts.stylePrefix ?? '').trim();
    const sceneVisualBlock = (opts.sceneVisualPrompt ?? '').trim();
    const lightingBlock = (opts.batchLighting ?? '').trim();
    
    const shotType = shot.shotType || 'character';
    const shotSize = shot.camera?.shotSize ?? '';
    const cameraAngle = shot.camera?.cameraAngle ?? '';
    const isInsert = shotType === 'insert';
    const isWide = WIDE_SHOTS.has(shotSize) || cameraAngle === 'bird_eye';

    // Compile the prompt via LLM structure builder
    const compiledPrompt = await this.promptCompiler.compile({
      shotType,
      shotSize,
      cameraAngle,
      identity_frozen: isInsert || isWide ? undefined : identityBlock,
      costume: undefined, // Already baked into identityBlock via buildIdentityBlock above
      action_scene: sceneContent.trim(),
      environment: sceneVisualBlock,
      lighting: lightingBlock,
      style: styleBlock,
      characters_brief: isWide && !isInsert ? [this.buildSimplifiedIdentity(shot, charMap)] : undefined,
      object: isInsert ? sceneContent.trim() : undefined,
    });
    
    return compiledPrompt;
  }

  /**
   * 构建角色 Identity Block — 详细版（用于特写/中景人物主导镜头）
   *
   * 使用自然英语描述而非 [bracket] 语法：
   *  - SD/SDXL CLIP 中 [] 被解析为降权修饰符（0.9x），与增强 identity 的意图相反
   *  - FLUX T5 中 [] 作为普通字符浪费 2 token
   */
  private buildIdentityBlock(shot: Shot, state: DramaState, charMap: Map<string, CharacterIdentity>): string {
    const charIds = (shot.characters || []).map(c => c.characterId);
    if (!charIds.length) return '';

    const shotSize = shot.camera?.shotSize;
    const cameraAngle = shot.camera?.cameraAngle;
    
    const isCloseUp = CLOSE_SHOTS.has(shotSize ?? '');
    const isMedium = ['medium', 'medium_close_up'].includes(shotSize ?? '');
    
    const needsProfileScrub = ['side_profile'].includes(cameraAngle ?? '');
    const needsBackScrub = ['back_of_head', 'over_shoulder'].includes(cameraAngle ?? '');

    const fragments = charIds.map(cid => {
      const c = charMap.get(cid);
      if (!c) return '';
      const vid = shot.characterVariationIds?.[cid];
      const variation = vid ? c.variations?.find(v => v.variationId === vid) : null;
      const costume = variation?.visualPromptOverride || c.defaultCostumePrompt || c.defaultCostume;
      const hair = c.hairStylePrompt || c.hairStyle;
      
      let facePrompt = c.faceReferencePrompt || '';
      
      // 视角干预（脱离正面凝视）
      if (needsProfileScrub || needsBackScrub) {
        facePrompt = facePrompt
          .replace(/front-facing,\s*looking at camera,?\s*/gi, '')
          .replace(/looking at camera,?\s*/gi, '')
          .replace(/front-facing,?\s*/gi, '')
          .trim();
      }
      if (needsBackScrub) {
        facePrompt = facePrompt
          .replace(/eyes sharply in focus,\s*clear iris detail,?\s*/gi, '')
          .replace(/clear iris detail,?\s*/gi, '')
          .trim();
      }

      // 📌 动态 Level of Detail (LoD) 根据景别增减角色信息密度
      const parts: (string | undefined)[] = [];
      if (isCloseUp) {
        // 特写：强调面部 + 发型（肩颈可见），裁剪服装以防模型注意力分散
        parts.push(facePrompt, hair);
      } else if (isMedium) {
        // 中景：脸 + 发型 + 服装（最完整的角色表现）
        parts.push(facePrompt, hair, costume);
      } else {
        // 近全景 (medium_wide 不在 WIDE_SHOTS 中)：脸 + 发型 + 服装
        parts.push(facePrompt, hair, costume);
      }
          
      const filtered = parts.filter(Boolean);
      // 自然英语格式，不用方括号
      return filtered.join(', ');
    }).filter(Boolean);

    // 签名道具（仅非远景时附加）
    const sigProps = state.signatureProps || [];
    if (shotSize && !WIDE_SHOTS.has(shotSize)) {
      const matchedProps: string[] = [];
      for (const cid of charIds) {
        for (const p of sigProps) {
          if (!p.visualPrompt?.trim() || !p.characterOwner) continue;
          if (p.characterOwner === cid || charMap.get(cid)?.name === p.characterOwner) {
            if (!matchedProps.includes(p.visualPrompt.trim())) {
              matchedProps.push(p.visualPrompt.trim());
            }
          }
        }
      }
      fragments.push(...matchedProps.slice(0, 2));
    }
    
    return fragments.join(', ');
  }

  /**
   * 构建简化版角色描述 — 用于全景/远景镜头
   *
   * 全景中人物仅占画面 <5%，详细的面部描述不仅浪费 token，
   * 还会误导模型将人物放大以满足面部细节需求。
   * 仅保留：轮廓标识（服装颜色/类型 + 发型颜色）
   */
  private buildSimplifiedIdentity(shot: Shot, charMap: Map<string, CharacterIdentity>): string {
    const charIds = (shot.characters || []).map(c => c.characterId);
    if (!charIds.length) return '';

    const fragments = charIds.map(cid => {
      const c = charMap.get(cid);
      if (!c) return '';
      const vid = shot.characterVariationIds?.[cid];
      const variation = vid ? c.variations?.find(v => v.variationId === vid) : null;
      const costume = variation?.visualPromptOverride || c.defaultCostumePrompt || c.defaultCostume;
      // 全景只需要轮廓级描述：服装 + 概略身份
      const brief = costume ? `a figure in ${costume}` : `a figure`;
      return brief;
    }).filter(Boolean);
    
    return fragments.length ? `small distant ${fragments.join(' and ')}` : '';
  }
}
