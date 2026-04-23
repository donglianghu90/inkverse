/** 镜头连贯性验证器 — 检测相邻 Shot 间视觉一致性、角色外观漂移、场景跳变 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { z } from 'zod';
import { EpisodeEntity } from '../entities/episode.entity';
import { DramaEntity } from '../entities/drama.entity';
import { ShotMediaEntity } from '../entities/shot-media.entity';
import { DramaState, Shot, EpisodeStoryboard } from '../schemas/drama-state.schemas';
import { LlmService } from '../../llm/llm.service';
import type { ShotMediaEntry } from '../interfaces';

export interface CoherencePair {
  shotA: string;
  shotB: string;
  sameScene: boolean;
  score: number;
  issues: string[];
}

export interface CoherenceReport {
  shotPairs: CoherencePair[];
  flaggedShots: string[];
  overallScore: number;
  checkedAt: string;
  vlmChecked?: boolean;
}

const SAME_SCENE_MIN_SCORE = 0.6;
const CROSS_SCENE_MIN_SCORE = 0.3;

@Injectable()
export class ShotCoherenceValidatorService {
  private readonly logger = new Logger('ShotCoherenceValidator');

  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(ShotMediaEntity) private readonly shotMediaRepo: Repository<ShotMediaEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @Optional() private readonly llm?: LlmService,
  ) {}

  /**
   * 验证整集镜头连贯性：
   * 1. 相邻 Shot 同一 sceneId → 背景/光影/角色服饰应高度一致
   * 2. 跨场景 Shot → 角色面部应一致，背景可变化
   * 3. 标记不一致的 Shot 以供重新生成
   * @param enableVlm 启用 VLM 视觉比对（quality 模式专用，额外调用 LLM 视觉能力）
   */
  async validateEpisodeCoherence(dramaId: string, episodeNumber: number, enableVlm = false): Promise<CoherenceReport> {
    const episode = await this.episodeRepo.findOne({ where: { dramaId, episodeNumber } });
    if (!episode?.storyboard) return this.emptyReport();

    const drama = await this.dramaRepo.findOne({ where: { id: dramaId } });
    if (!drama) return this.emptyReport();

    const state = drama.state as unknown as DramaState;
    const storyboard = episode.storyboard as unknown as EpisodeStoryboard;
    const shots = storyboard?.shots ?? [];
    const mediaList = await this.shotMediaRepo.find({ where: { episodeId: episode.id } });
    const mediaMap = Object.fromEntries(mediaList.map(m => [m.shotId, m])) as Record<string, ShotMediaEntry>;

    if (shots.length < 2) return this.emptyReport();

    const pairs: CoherencePair[] = [];
    const flaggedSet = new Set<string>();

    for (let i = 0; i < shots.length - 1; i++) {
      const shotA = shots[i];
      const shotB = shots[i + 1];
      if (shotA.isPreview || shotB.isPreview) continue;

      const imgA = mediaMap[shotA.shotId]?.imageUrl;
      const imgB = mediaMap[shotB.shotId]?.imageUrl;
      if (!imgA || !imgB) continue;

      const sameScene = shotA.sceneId === shotB.sceneId;
      const pair = this.evaluatePair(shotA, shotB, sameScene, state);

      // VLM 视觉比对增强：仅对同场景相邻 Shot 且元数据检查未发现问题时执行
      if (enableVlm && sameScene && pair.score >= SAME_SCENE_MIN_SCORE && this.llm) {
        const vlmResult = await this.vlmVisualCheck(imgA, imgB, shotA, shotB, state);
        if (vlmResult) {
          pair.issues.push(...vlmResult.issues);
          pair.score = Math.max(0, pair.score - vlmResult.penalty);
        }
      }

      pairs.push(pair);

      const threshold = sameScene ? SAME_SCENE_MIN_SCORE : CROSS_SCENE_MIN_SCORE;
      if (pair.score < threshold) {
        flaggedSet.add(pair.shotB);
        this.logger.debug(`连贯性低: ${pair.shotA}→${pair.shotB} score=${pair.score} (${sameScene ? '同场景' : '跨场景'})`);
      }
    }

    const overallScore = pairs.length > 0
      ? Math.round((pairs.reduce((s, p) => s + p.score, 0) / pairs.length) * 100) / 100
      : 1;

    const report: CoherenceReport = {
      shotPairs: pairs,
      flaggedShots: [...flaggedSet],
      overallScore,
      checkedAt: new Date().toISOString(),
      vlmChecked: enableVlm && !!this.llm,
    };

    this.logger.log(
      `E${episodeNumber} 连贯性检查: ${pairs.length} pairs | overall=${overallScore} | flagged=${flaggedSet.size}${enableVlm ? ' | VLM=on' : ''}`,
    );
    return report;
  }

  /**
   * VLM 视觉比对：使用 LLM 视觉能力比较两张相邻 Shot 图片的一致性。
   * 仅检测人类肉眼可见的不一致（面部漂移、服饰突变、光影反转），忽略构图/景别变化（这是正常的）。
   * 成本控制：单次调用 ≈ 500 tokens，仅在 quality 模式启用。
   */
  private async vlmVisualCheck(
    imgUrlA: string, imgUrlB: string,
    shotA: Shot, shotB: Shot,
    state: DramaState,
  ): Promise<{ issues: string[]; penalty: number } | null> {
    if (!this.llm) return null;
    try {
      const commonChars = (shotA.characters ?? [])
        .filter(ca => (shotB.characters ?? []).some(cb => cb.characterId === ca.characterId))
        .map(c => state.characters?.find(ch => ch.characterId === c.characterId)?.name ?? c.characterId);

      const vlmSchema = z.object({
        issues: z.array(z.string()),
        severity: z.enum(['none', 'minor', 'major']),
      });

      const result = await this.llm.generateStructured({
        taskName: 'vlm-coherence-check',
        schema: vlmSchema,
        metadata: { dramaId: state.dramaId },
        systemPrompt: `你是一位短剧视觉质检员。比较两张相邻镜头的图片，检测以下不一致问题：
1. 同一角色的面部特征是否一致（五官、肤色、年龄感）
2. 同一角色的服饰是否一致（颜色、款式、配饰）
3. 背景环境是否一致（同场景应保持一致）
4. 光影方向是否一致

忽略以下正常变化：景别/角度不同、表情不同、人物位置不同。
如果没有发现问题，issues 为空数组，severity 为 "none"。`,
        userPrompt: `两张相邻镜头来自同一场景（${shotA.sceneId}）。
共同出场角色：${commonChars.join('、') || '无'}
镜头A：${shotA.visualPrompt?.slice(0, 100) ?? ''}
镜头B：${shotB.visualPrompt?.slice(0, 100) ?? ''}

请比较两张图片的视觉一致性。`,
        imageUrls: [imgUrlA, imgUrlB],
        temperature: 0.1,
      });

      if (!result.issues?.length || result.severity === 'none') return null;

      const penalty = result.severity === 'major' ? 0.3 : 0.15;
      return {
        issues: result.issues.map((i: string) => `[VLM] ${i}`),
        penalty,
      };
    } catch (err) {
      this.logger.debug(`VLM 比对跳过: ${(err as Error).message}`);
      return null;
    }
  }

  /** 基于元数据的结构化连贯性评估（不依赖视觉模型，纯逻辑分析） */
  private evaluatePair(shotA: Shot, shotB: Shot, sameScene: boolean, state: DramaState): CoherencePair {
    const issues: string[] = [];
    let score = 1.0;

    if (sameScene) {
      const charsA = new Set((shotA.characters ?? []).map(c => c.characterId));
      const charsB = new Set((shotB.characters ?? []).map(c => c.characterId));
      const commonChars = [...charsA].filter(c => charsB.has(c));

      for (const cid of commonChars) {
        const charA = (shotA.characters ?? []).find(c => c.characterId === cid)!;
        const charB = (shotB.characters ?? []).find(c => c.characterId === cid)!;
        const varA = shotA.characterVariationIds?.[cid];
        const varB = shotB.characterVariationIds?.[cid];
        if (varA !== varB) {
          issues.push(`角色 ${cid} 同场景内服饰变体不一致: ${varA ?? 'default'} → ${varB ?? 'default'}`);
          score -= 0.3;
        }
        // BUG-09 fix: 空 costumeOverride 代表用 defaultCostume，
        // 若一方有覆盖而另一方无，视为潜在服饰不一致（轻度扣分）
        if (charA.costumeOverride !== charB.costumeOverride) {
          if (charA.costumeOverride && charB.costumeOverride) {
            // 双方都非空但不同 → 明确不一致
            issues.push(`角色 ${cid} 同场景内服饰描述不一致`);
            score -= 0.15;
          } else if (charA.costumeOverride || charB.costumeOverride) {
            // 一方有 costumeOverride，一方无（用 default）→ 可能有服饰变化
            issues.push(`角色 ${cid} 同场景内服饰描述不对称（一方使用 defaultCostume，另一方有覆盖）`);
            score -= 0.08;
          }
        }

        // BUG-06 fix: 检测角色朝向（facing）180° 跳变
        const facingA = charA.facing ?? '';
        const facingB = charB.facing ?? '';
        if (facingA && facingB && this.isBadFacingJump(facingA, facingB)) {
          issues.push(`角色 ${cid} 朝向跳变: "${facingA}" → "${facingB}"（同场景禁止无过渡的180°翻转）`);
          score -= 0.2;
        }
      }

      if (shotA.isFlashback !== shotB.isFlashback) {
        // flashback 与非 flashback 相邻是正常的，不扣分但标记
      }
    }

    const emotionA = shotA.characters[0]?.emotion ?? '';
    const emotionB = shotB.characters[0]?.emotion ?? '';
    if (emotionA && emotionB && this.isEmotionJump(emotionA, emotionB) && sameScene) {
      issues.push(`情绪跳变: "${emotionA}" → "${emotionB}"（同场景内应有过渡）`);
      score -= 0.2;
    }

    if (sameScene && shotA.camera && shotB.camera) {
      const angleA = `${shotA.camera.shotSize}+${shotA.camera.cameraAngle}`;
      const angleB = `${shotB.camera.shotSize}+${shotB.camera.cameraAngle}`;
      if (this.isBadAxisJump(shotA.camera.cameraAngle, shotB.camera.cameraAngle)) {
        issues.push(`镜头轴线跳跃: ${angleA} → ${angleB}`);
        score -= 0.15;
      }
    }

    const promptA = shotA.visualPrompt?.toLowerCase() ?? '';
    const promptB = shotB.visualPrompt?.toLowerCase() ?? '';
    // BUG-05 fix: 检测签名道具持握状态跳变
    if (sameScene) {
      const propIssue = this.detectPropStateJump(shotA, shotB, state);
      if (propIssue) {
        issues.push(propIssue);
        score -= 0.25;
      }
    }

    if (sameScene) {
      const simScore = this.promptSimilarity(promptA, promptB);
      if (simScore < 0.3) {
        issues.push(`同场景视觉描述差异过大 (similarity=${simScore.toFixed(2)})`);
        score -= 0.2;
      }
    }

    if (!sameScene) {
      const sharedChars = shotA.characters
        .filter(ca => shotB.characters.some(cb => cb.characterId === ca.characterId));
      for (const ca of sharedChars) {
        const charDef = state.characters?.find(c => c.characterId === ca.characterId);
        if (charDef?.faceReferencePrompt) {
          const hasFaceA = promptA.includes(charDef.faceReferencePrompt.toLowerCase().slice(0, 20));
          const hasFaceB = promptB.includes(charDef.faceReferencePrompt.toLowerCase().slice(0, 20));
          if (hasFaceA !== hasFaceB) {
            issues.push(`角色 ${ca.characterId} 面部描述在相邻镜头中不一致`);
            score -= 0.15;
          }
        }
      }
    }

    return {
      shotA: shotA.shotId,
      shotB: shotB.shotId,
      sameScene,
      score: Math.max(0, Math.round(score * 100) / 100),
      issues,
    };
  }

  private isEmotionJump(a: string, b: string): boolean {
    // BUG-08 fix: 扩展情绪分组到5组，补充中文情绪词，提升跳变检出率
    const EMOTION_GROUPS: Record<string, string[]> = {
      // 正面情绪（温暖/喜悦/满足）
      positive: [
        'happy', 'joyful', 'loving', 'sweet', 'satisfied', 'proud', 'relieved', 'grateful',
        'touched', 'warm', 'blissful',
        '开心', '喜悦', '甜蜜', '满意', '骄傲', '欣慰', '感激', '温暖', '幸福', '快乐',
      ],
      // 激动情绪（兴奋/愤怒/激烈）
      intense: [
        'excited', 'furious', 'angry', 'passionate', 'fierce', 'enraged', 'outraged',
        '兴奋', '愤怒', '激动', '狂怒', '激烈', '爆发', '怒火',
      ],
      // 痛苦情绪（悲伤/绝望/崩溃）
      pain: [
        'sad', 'grieving', 'desperate', 'heartbroken', 'devastated', 'crying', 'sobbing',
        'broken', 'miserable',
        '悲伤', '绝望', '崩溃', '痛苦', '哭泣', '心碎', '哀伤', '无助',
      ],
      // 恐惧情绪（害怕/惊恐/不安）
      fear: [
        'terrified', 'scared', 'horrified', 'panicked', 'anxious', 'nervous', 'dread',
        '恐惧', '害怕', '惊恐', '慌张', '不安', '焦虑', '紧张',
      ],
      // 中性/平静
      neutral: [
        'calm', 'composed', 'thoughtful', 'curious', 'confused', 'surprised',
        '平静', '沉思', '好奇', '困惑', '惊讶', '若有所思', '淡然',
      ],
    };
    const aL = a.toLowerCase();
    const bL = b.toLowerCase();
    const groupA = Object.entries(EMOTION_GROUPS).find(([, v]) => v.some(e => aL.includes(e)))?.[0] ?? 'unknown';
    const groupB = Object.entries(EMOTION_GROUPS).find(([, v]) => v.some(e => bL.includes(e)))?.[0] ?? 'unknown';
    if (groupA === 'unknown' || groupB === 'unknown' || groupA === groupB) return false;
    // neutral→任何情绪 或 任何情绪→neutral 不算跳变（neutral 是过渡态）
    if (groupA === 'neutral' || groupB === 'neutral') return false;
    // 其他组之间的切换均视为情绪跳变
    return true;
  }

  private isBadAxisJump(a: string, b: string): boolean {
    if (a === b) return false;
    // BUG-11 fix: 补充缺失的非法轴线切换对
    const AXIS_CONFLICTS = new Map([
      ['over_shoulder', new Set(['pov', 'bird_eye', 'worm_eye'])],
      ['pov', new Set(['bird_eye', 'extreme_wide', 'over_shoulder', 'worm_eye'])],
      ['low_angle', new Set(['high_angle', 'bird_eye'])],
      ['high_angle', new Set(['low_angle', 'worm_eye'])],
      // front ↔ back_of_head：180° 真实翻转，观众空间感断裂
      ['front', new Set(['back_of_head'])],
      ['back_of_head', new Set(['front', 'pov'])],
      // side_profile → pov：侧面突然变主观视角，空间跳跃感强
      ['side_profile', new Set(['pov', 'bird_eye'])],
      // worm_eye ↔ bird_eye：两极对立，同场景极少合法
      ['worm_eye', new Set(['bird_eye', 'high_angle'])],
      ['bird_eye', new Set(['worm_eye', 'pov'])],
    ]);
    return AXIS_CONFLICTS.get(a)?.has(b) === true;
  }

  /**
   * BUG-06 fix: 检测角色朝向（facing）的非法跳变。
   * 同场景内，从「背对」到「正面朝镜头」是空间感断裂，除非有中间过渡 shot。
   */
  private isBadFacingJump(a: string, b: string): boolean {
    if (a === b) return false;
    // facing_away → facing_camera：背对到正面，需要有转身过渡
    // facing_left → facing_right（及反向）：180度横向翻转，违反180°轴线法则
    const BAD_FACING_JUMPS = new Map([
      ['facing_away', new Set(['facing_camera', 'facing_left', 'facing_right'])],
      ['facing_camera', new Set(['facing_away'])],
      ['facing_left', new Set(['facing_right'])],
      ['facing_right', new Set(['facing_left'])],
    ]);
    return BAD_FACING_JUMPS.get(a)?.has(b) === true;
  }

  /**
   * BUG-05 fix: 检测道具/武器持握状态跳变。
   * 优先使用结构化状态机 (propGripStates)，兼容旧数据回退词汇扫描。
   */
  private detectPropStateJump(shotA: Shot, shotB: Shot, state: DramaState): string | null {
    // 优先使用结构化状态机 (State Machine)
    if (shotA.propGripStates || shotB.propGripStates) {
      const statesA = shotA.propGripStates ?? {};
      const statesB = shotB.propGripStates ?? {};
      for (const [propId, stateB] of Object.entries(statesB)) {
        const stateA = statesA[propId] ?? 'hidden';
        if ((stateA === 'hidden' || stateA === 'at_waist') && (stateB === 'in_hand' || stateB === 'pointing')) {
          const propName = state.signatureProps?.find(p => p.propId === propId)?.name ?? propId;
          return `道具状态跳变：${propName} 从「${stateA}」直接变为「${stateB}」，缺少过渡动作`;
        }
      }
      return null;
    }

    // 兼容旧数据：基于字符串文本对比
    const lastFrameA = (shotA.lastFramePrompt ?? shotA.visualPrompt ?? '').toLowerCase();
    const firstFrameB = (shotB.firstFramePrompt ?? shotB.visualPrompt ?? '').toLowerCase();

    // 从签名道具清单中提取道具关键词
    const propKeywords = (state.signatureProps ?? [])
      .flatMap(p => [
        ...p.name.split(/[\s/，,]+/),
        ...p.visualPrompt.split(/[\s,]+/).filter(t => t.length > 2).slice(0, 3),
      ])
      .map(k => k.toLowerCase().trim())
      .filter(k => k.length > 1);

    if (!propKeywords.length) return null;

    // 「收纳/不可见」状态词
    const HELD_AWAY = ['sheathed', 'at waist', 'hanging', 'slung', 'strapped', 'holstered',
      'not visible', 'hidden', 'tucked', '收', '鞘', '腰间', '背负'];
    // 「手持/出鞘/攻击」状态词
    const IN_HAND = ['in hand', 'drawn', 'unsheathed', 'raised', 'pointed', 'gripped',
      'brandishing', 'wielding', 'holding', 'swing', 'slash', 'thrust',
      'hand near', 'reaching for', '握', '举', '拔出', '持', '挥', '指向'];

    const hasAnyPropWord = (text: string) => propKeywords.some(k => text.includes(k));

    // 检查 lastFrameA 和 firstFrameB 中是否有签名道具词
    if (!hasAnyPropWord(lastFrameA) && !hasAnyPropWord(firstFrameB)) return null;

    const aIsHeldAway = HELD_AWAY.some(w => lastFrameA.includes(w));
    const bIsInHand = IN_HAND.some(w => firstFrameB.includes(w));
    const aIsEmpty = !IN_HAND.some(w => lastFrameA.includes(w)) && !hasAnyPropWord(lastFrameA);

    if ((aIsHeldAway || aIsEmpty) && bIsInHand) {
      // 找出具体是哪个道具
      const matchedProp = (state.signatureProps ?? []).find(p =>
        firstFrameB.includes(p.name.toLowerCase()) ||
        firstFrameB.includes(p.visualPrompt.split(/[\s,]+/)[0]?.toLowerCase() ?? '')
      );
      const propName = matchedProp?.name ?? '签名道具';
      return `道具状态跳变：${propName} 从「${aIsHeldAway ? '收纳/挂腰' : '不可见'}」直接变为「手持/出鞘」，缺少过渡 Shot`;
    }

    return null;
  }

  /** 简单 token 重叠相似度 */
  private promptSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.split(/[\s,]+/).filter(t => t.length > 2));
    const tokensB = new Set(b.split(/[\s,]+/).filter(t => t.length > 2));
    if (!tokensA.size || !tokensB.size) return 0;
    const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
    return intersection / Math.max(tokensA.size, tokensB.size);
  }

  private emptyReport(): CoherenceReport {
    return { shotPairs: [], flaggedShots: [], overallScore: 1, checkedAt: new Date().toISOString() };
  }

  /**
   * Error Backpropagation: 重写被判定为不连贯的 Shot
   * 根据检测出的 issues 让 LLM 面壁思过，重新生成正确的 prompt 文本，破除死锁悖论。
   */
  async rewriteFlaggedShotPrompt(shot: Shot, state: DramaState, issues: string[]): Promise<Shot> {
    if (!this.llm) return shot;
    try {
      const rewriteSchema = z.object({
        firstFramePrompt: z.string(),
        lastFramePrompt: z.string().optional(),
        thoughtProcess: z.string()
      });
      const result = await this.llm.generateStructured({
        taskName: 'prompt-rewriter',
        schema: rewriteSchema,
        metadata: { dramaId: state.dramaId },
        systemPrompt: `You are an expert T2I prompt fixer for cinematic storyboards.
The given shot generated continuity or coherence errors when compared to the previous shot.
Your job is to REWRITE the firstFramePrompt (and lastFramePrompt if necessary) to fix the listed issues.
Ensure you follow the strict positioning, facing, and prop-grip rules. Output ONLY visually descriptive prompt language for the prompt fields. Do not hallucinate axes or facings that contradict the requirements.`,
        userPrompt: `Shot ID: ${shot.shotId}
Original firstFramePrompt: ${shot.firstFramePrompt || shot.visualPrompt}
Original lastFramePrompt: ${shot.lastFramePrompt || 'N/A'}
Issues detected:
${issues.map(i => '- ' + i).join('\n')}

Analyze why it failed based on the issues, then write the fixed prompts. Ensure all issues are resolved.`,
        temperature: 0.3,
      });

      return {
        ...shot,
        firstFramePrompt: result.firstFramePrompt,
        lastFramePrompt: result.lastFramePrompt ?? shot.lastFramePrompt,
      };
    } catch (e) {
      this.logger.warn(`Failed to rewrite prompt for ${shot.shotId}: ${(e as Error).message}`);
      return shot;
    }
  }
}
