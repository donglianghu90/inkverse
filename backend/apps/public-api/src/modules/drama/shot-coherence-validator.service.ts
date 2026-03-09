/** 镜头连贯性验证器 — 检测相邻 Shot 间视觉一致性、角色外观漂移、场景跳变 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { EpisodeEntity } from './entities/episode.entity';
import { DramaEntity } from './entities/drama.entity';
import { DramaState, Shot, EpisodeStoryboard } from './schemas/drama-state.schemas';
import { ShotMediaEntry } from './media-orchestrator.service';

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
}

const SAME_SCENE_MIN_SCORE = 0.6;
const CROSS_SCENE_MIN_SCORE = 0.3;

@Injectable()
export class ShotCoherenceValidatorService {
  private readonly logger = new Logger('ShotCoherenceValidator');

  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
  ) {}

  /**
   * 验证整集镜头连贯性：
   * 1. 相邻 Shot 同一 sceneId → 背景/光影/角色服饰应高度一致
   * 2. 跨场景 Shot → 角色面部应一致，背景可变化
   * 3. 标记不一致的 Shot 以供重新生成
   */
  async validateEpisodeCoherence(dramaId: string, episodeNumber: number): Promise<CoherenceReport> {
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
    };

    this.logger.log(
      `E${episodeNumber} 连贯性检查: ${pairs.length} pairs | overall=${overallScore} | flagged=${flaggedSet.size}`,
    );
    return report;
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
      const angleA = shotA.camera.angle;
      const angleB = shotB.camera.angle;
      if (this.isBadAxisJump(angleA, angleB)) {
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
