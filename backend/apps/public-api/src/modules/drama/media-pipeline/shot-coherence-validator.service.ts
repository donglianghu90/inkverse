/** 镜头连贯性验证器 — 检测相邻 Shot 间视觉一致性、角色外观漂移、场景跳变 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { z } from 'zod';
import { EpisodeEntity } from '../entities/episode.entity';
import { DramaEntity } from '../entities/drama.entity';
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
    const mediaMap = (episode.shotMediaMap ?? {}) as Record<string, ShotMediaEntry>;

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
        if (charA.costumeOverride !== charB.costumeOverride && charA.costumeOverride && charB.costumeOverride) {
          issues.push(`角色 ${cid} 同场景内服饰描述不一致`);
          score -= 0.15;
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
        const cb = shotB.characters.find(c => c.characterId === ca.characterId)!;
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
    const EMOTION_GROUPS: Record<string, string[]> = {
      positive: ['happy', 'excited', 'joyful', 'loving', 'sweet', 'satisfied', 'proud', 'relieved',
                 '开心', '兴奋', '喜悦', '甜蜜', '满意', '骄傲', '欣慰'],
      negative: ['angry', 'furious', 'sad', 'grieving', 'terrified', 'desperate', 'disgusted',
                 '愤怒', '悲伤', '恐惧', '绝望', '厌恶'],
      neutral: ['calm', 'composed', 'thoughtful', 'curious', 'surprised',
                '平静', '沉思', '好奇', '惊讶'],
    };
    const groupA = Object.entries(EMOTION_GROUPS).find(([, v]) => v.some(e => a.toLowerCase().includes(e)))?.[0] ?? 'unknown';
    const groupB = Object.entries(EMOTION_GROUPS).find(([, v]) => v.some(e => b.toLowerCase().includes(e)))?.[0] ?? 'unknown';
    return groupA !== 'unknown' && groupB !== 'unknown' && groupA !== groupB
      && !(groupA === 'neutral' || groupB === 'neutral');
  }

  private isBadAxisJump(a: string, b: string): boolean {
    if (a === b) return false;
    const AXIS_CONFLICTS = new Map([
      ['over_shoulder', new Set(['pov', 'bird_eye'])],
      ['pov', new Set(['bird_eye', 'extreme_wide', 'over_shoulder'])],
      ['low_angle', new Set(['high_angle'])],
      ['high_angle', new Set(['low_angle'])],
    ]);
    return AXIS_CONFLICTS.get(a)?.has(b) === true;
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
}
