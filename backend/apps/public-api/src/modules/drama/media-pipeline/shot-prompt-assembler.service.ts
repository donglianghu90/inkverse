import { Injectable, Logger } from '@nestjs/common';
import type { Shot, DramaState, CharacterIdentity } from '../schemas/drama-state.schemas';

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

// ── P0-2: 运动词黑名单 — 从 firstFramePrompt/lastFramePrompt 中清除，防止 T2I 生成运动模糊 ──
const MOTION_VERB_PATTERNS = [
  /\b(?:walking|running|turning|moving|rushing|flying|falling|stepping|approaching|retreating|leaping|jumping|climbing|crawling|sprinting|dashing|stumbling|strolling|marching|charging)\b/gi,
  /\b(?:walks|runs|turns|moves|rushes|flies|falls|steps|approaches|retreats|leaps|jumps|climbs|crawls|sprints|dashes|stumbles|strolls|marches|charges)\b/gi,
  /\b(?:walk|run|turn|move|rush|fly|fall|step|approach|retreat|leap|jump|climb|crawl|sprint|dash|stumble|stroll|march|charge)\s+(?:toward|towards|away|into|through|across|along|down|up|over|past)\b/gi,
];

// ── P1-7: 场景 visualPrompt 违规词 — LLM 常在场景描述中写入被禁止的构图/镜头/风格关键词 ──
const SCENE_PROMPT_FORBIDDEN_PATTERNS = [
  /\b(?:wide shot|close[- ]?up|medium shot|extreme wide|bird[']?s?[- ]?eye|establishing shot|over[- ]?the[- ]?shoulder|macro shot|aerial view|low angle|high angle|dutch angle|tracking shot|dolly|pan left|pan right|tilt up|tilt down)\b/gi,
  /\b(?:photorealistic|hyperrealistic|cinematic|masterpiece|best quality|ultra detailed|8k|4k uhd|film grain|bokeh|depth of field|shallow dof|lens flare)\b/gi,
];

// ── P1-4: 中文字符检测 — T2I 模型（FLUX/Seedream）对中文理解远不如英文 ──
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
const CHINESE_PUNCT_MAP: Record<string, string> = {
  '\uff0c': ', ', '\u3002': '. ', '\uff1a': ': ', '\uff1b': '; ', '\uff01': '! ', '\uff1f': '? ',
  '\u201c': '"', '\u201d': '"', '\u2018': "'", '\u2019': "'", '\uff08': '(', '\uff09': ')',
  '\u3010': '[', '\u3011': ']', '\u3001': ', ',
};

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
    // P1-7: 清洗场景 visualPrompt 中被禁止的构图/镜头/风格词
    const sceneVisualBlock = ShotPromptAssemblerService.cleanSceneVisualPrompt((opts.sceneVisualPrompt ?? '').trim());
    const lightingBlock = (opts.batchLighting ?? '').trim();
    
    // P0-2: 清洗 sceneContent（firstFramePrompt）中的运动词
    const sanitizedSceneContent = ShotPromptAssemblerService.sanitizeStaticFrame(sceneContent.trim());
    
    const shotType = shot.shotType || 'character';
    const shotSize = shot.camera?.shotSize ?? '';
    const cameraAngle = shot.camera?.cameraAngle ?? '';
    const hasCharacters = (shot.characters ?? []).length > 0;

    // 安全降级：如果 shotType 被 LLM 标记为 insert 但实际上有角色出场，
    // 说明分镜导演误判了镜头类型（如人脸特写被当作道具特写）。
    // 强制走 CHARACTER_DOMINANT 路径，避免 INSERT_PROP 编译器产生 "no people" 幻觉。
    const isInsert = shotType === 'insert' && !hasCharacters;
    if (shotType === 'insert' && hasCharacters) {
      this.logger.warn(
        `[SafetyGuard] Shot ${shot.shotId} shotType=insert 但 characters=[${(shot.characters ?? []).map(c => c.characterId).join(',')}]，` +
        `降级为 CHARACTER_DOMINANT 避免 INSERT_PROP 幻觉`,
      );
    }

    const isWide = WIDE_SHOTS.has(shotSize) || cameraAngle === 'bird_eye';

    // Compile the prompt via LLM structure builder
    const compiledPrompt = await this.promptCompiler.compile({
      shotType: isInsert ? shotType : (isWide ? 'wide' : shotType),
      shotSize,
      cameraAngle,
      identity_frozen: isInsert || isWide ? undefined : identityBlock,
      costume: undefined, // Already baked into identityBlock via buildIdentityBlock above
      action_scene: sanitizedSceneContent,
      environment: sceneVisualBlock,
      lighting: lightingBlock,
      style: styleBlock,
      characters_brief: isWide && !isInsert ? [this.buildSimplifiedIdentity(shot, charMap)] : undefined,
      object: isInsert ? sanitizedSceneContent : undefined,
    });
    
    // P1-4: 最终防线 — 清除编译后 prompt 中残留的中文字符
    return ShotPromptAssemblerService.stripChinese(compiledPrompt);
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

    // 签名道具（仅非远景时附加，且仅当本 Shot 文本中实际提到该道具时才注入）
    // 原来无条件注入会导致：角色「喝茶」镜头里也被追加「持剑」描述，T2I 模型混乱画出武器。
    const sigProps = state.signatureProps || [];
    if (shotSize && !WIDE_SHOTS.has(shotSize)) {
      // 合并 shot 所有文本 + 角色 Actions，用于检测道具是否被当前镜头提及
      const shotText = [
        shot.firstFramePrompt ?? '',
        shot.lastFramePrompt ?? '',
        shot.visualPrompt ?? '',
        ...(shot.characters ?? []).map(c => (c as any).action ?? ''),
      ].join(' ').toLowerCase();

      const matchedProps: string[] = [];
      for (const cid of charIds) {
        for (const p of sigProps) {
          if (!p.visualPrompt?.trim() || !p.characterOwner) continue;
          if (p.characterOwner !== cid && charMap.get(cid)?.name !== p.characterOwner) continue;
          if (matchedProps.includes(p.visualPrompt.trim())) continue;

          // P1-5: 增强道具匹配 — 中文名完整匹配优先，英文要求 2+ token 命中
          // (1) 中文道具名完整匹配（最高置信度）
          const hasChineseName = p.name && /[\u4e00-\u9fff]/.test(p.name);
          if (hasChineseName && shotText.includes(p.name.toLowerCase())) {
            matchedProps.push(p.visualPrompt.trim());
            continue;
          }

          // (2) 英文 token 匹配：从道具名称 + visualPrompt 前5词提取关键词
          const propNameTokens = p.name.split(/[\s,/\u3001\uff0c]+/).filter(k => k.length > 1).map(k => k.toLowerCase());
          const propVisualTokens = p.visualPrompt.split(/[\s,]+/).filter(k => k.length > 3).slice(0, 5).map(k => k.toLowerCase());
          const allTokens = [...new Set([...propNameTokens, ...propVisualTokens])];

          // 短词（<=3字符）使用词边界匹配，防止 "bow" 命中 "elbow"
          let hitCount = 0;
          for (const token of allTokens) {
            if (token.length <= 3) {
              const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              if (new RegExp(`\\b${escaped}\\b`, 'i').test(shotText)) hitCount++;
            } else {
              if (shotText.includes(token)) hitCount++;
            }
          }

          // 需至少 2 个 token 命中才注入（单 token 道具降级为 1）
          const minHits = allTokens.length === 1 ? 1 : 2;
          if (hitCount >= minHits) {
            matchedProps.push(p.visualPrompt.trim());
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

  // ═══════════════════════════════════════════════════════════════
  // Prompt 净化工具方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * P0-2: 静态帧清洗 — 从 firstFramePrompt/lastFramePrompt 中去除运动词。
   * T2I 模型生成静态图像，运动描述会导致模糊/重影伪影。
   * 保留姿态词（standing, sitting, holding）因为它们描述静态状态。
   */
  static sanitizeStaticFrame(prompt: string): string {
    if (!prompt) return prompt;
    let cleaned = prompt;
    for (const pattern of MOTION_VERB_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.replace(/,\s*,+/g, ',').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  }

  /**
   * P1-4: 中文字符净化 — 从最终 T2I prompt 中移除中文字符。
   * FLUX/Seedream 的 T5/CLIP 编码器对中文 token 理解远不如英文。
   */
  static stripChinese(prompt: string): string {
    if (!prompt) return prompt;
    let result = prompt;
    for (const [cn, en] of Object.entries(CHINESE_PUNCT_MAP)) {
      result = result.split(cn).join(en);
    }
    result = result.replace(CHINESE_CHAR_REGEX, '').replace(/\s{2,}/g, ' ').trim();
    return result;
  }

  /**
   * P1-7: 场景 visualPrompt 清洗 — 去除构图/镜头/风格词。
   * VisualAssetDesigner 铁律禁止这些词，但 LLM 不可能 100% 遵守。
   * 此方法作为防御层，避免与 PromptCompiler/PromptOptimizer 的控制冲突。
   */
  static cleanSceneVisualPrompt(prompt: string): string {
    if (!prompt) return prompt;
    let cleaned = prompt;
    for (const pattern of SCENE_PROMPT_FORBIDDEN_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }
    return cleaned.replace(/,\s*,+/g, ',').replace(/\s{2,}/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  }
}
