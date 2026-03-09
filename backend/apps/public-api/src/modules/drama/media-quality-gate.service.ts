/** 媒体质量关卡 — 生成后质量评估 + 自动重试 + golden Shot 多候选选优 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../novel/llm/llm.service';
import { z } from 'zod';

export interface QualityAssessment {
  score: number;
  pass: boolean;
  issues: string[];
  faceConsistencyScore?: number;
  styleConsistencyScore?: number;
  readabilityScore?: number;
  recommendedFix?: QualityFixType;
  failReasons?: QualityFixType[];
}

export interface QualityGateOptions {
  maxAttempts: number;
  minScore: number;
  qualityTier: 'golden' | 'standard' | 'filler';
  prompt: string;
  characterRefs?: string[];
  styleRefs?: string[];
  candidateCount?: number;
  dramaId?: string;
  userId?: string;
}

export interface QualityGateResult {
  imageUrl: string;
  score: number;
  attempts: number;
  assessment: QualityAssessment;
}

export type QualityFixType = 'identity' | 'style' | 'camera' | 'motion';

const TIER_CONFIG: Record<string, { maxAttempts: number; minScore: number; candidateCount: number }> = {
  golden: { maxAttempts: 3, minScore: 7.5, candidateCount: 2 },
  standard: { maxAttempts: 2, minScore: 4, candidateCount: 1 },
  filler: { maxAttempts: 1, minScore: 0, candidateCount: 1 },
};

const qualityFixSchema = z.enum(['identity', 'style', 'camera', 'motion']);

const assessmentSchema = z.object({
  aestheticScore: z.number().min(0).max(10),
  promptAdherence: z.number().min(0).max(10),
  technicalQuality: z.number().min(0).max(10),
  faceConsistency: z.number().min(0).max(10).optional(),
  styleConsistency: z.number().min(0).max(10).optional(),
  readabilityScore: z.number().min(0).max(10).optional(),
  issues: z.array(z.string()),
  failReasons: z.array(qualityFixSchema).default([]),
  recommendedFix: qualityFixSchema.optional(),
});

@Injectable()
export class MediaQualityGateService {
  private readonly logger = new Logger('MediaQualityGate');
  private assessmentErrorCount = 0;

  constructor(private readonly llm: LlmService) {}

  private async assessImage(imageUrl: string, opts: {
    prompt: string;
    qualityTier: string;
    characterRefs?: string[];
    styleRefs?: string[];
    dramaId?: string;
    userId?: string;
  }): Promise<QualityAssessment> {
    if (!imageUrl) return { score: 0, pass: false, issues: ['empty image URL'] };

    try {
      const imageUrls = [imageUrl, ...(opts.characterRefs ?? []), ...(opts.styleRefs ?? [])].filter(Boolean);
      const result = await this.llm.generateStructured({
        taskName: 'media-quality-assessment',
        schema: assessmentSchema,
        metadata: { dramaId: opts.dramaId, userId: opts.userId },
        systemPrompt: `你是一位AI生成图片质量评估专家。请仔细观察提供的图片，评估维度：
1. aestheticScore (0-10): 构图、色彩、光影的美学品质
2. promptAdherence (0-10): 图片内容与提示词的吻合度
3. technicalQuality (0-10): 清晰度、无伪影、无畸变（关注面部/手指畸变）
4. faceConsistency (0-10, 仅有人物时): 面部是否自然、无变形、五官完整；如有角色参考图，评估面部是否与参考一致
5. styleConsistency (0-10, 有风格参考图时): 与风格参考图的调色、材质、光影一致性
6. readabilityScore (0-10): 构图可读性、主体是否明确、镜头信息是否清晰
7. issues: 发现的具体问题列表
8. failReasons: 从 [identity, style, camera, motion] 中选择问题归因（可多选）
9. recommendedFix: 从 [identity, style, camera, motion] 中选一个最优先修复项

严格评分：6分=合格，8分=优秀，<5分=有明显缺陷。
AI生成图常见问题：多余手指、面部扭曲、文字水印、比例失调、背景穿模。`,
        userPrompt: `请观察图片并评估质量。第一张图是待评估的AI生成图。${opts.characterRefs?.length ? `后续图片中包含角色参考图，请对比面部一致性。` : ''}${opts.styleRefs?.length ? `后续图片中包含风格参考图，请评估风格一致性。` : ''}

原始提示词：${opts.prompt.slice(0, 300)}

请输出评估结果（JSON），failReasons/recommendedFix 必须使用固定枚举。`,
        imageUrls,
        temperature: 0.2,
      });

      const scores = [result.aestheticScore, result.promptAdherence, result.technicalQuality];
      if (result.faceConsistency !== undefined) scores.push(result.faceConsistency);
      if (result.styleConsistency !== undefined) scores.push(result.styleConsistency);
      if (result.readabilityScore !== undefined) scores.push(result.readabilityScore);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const tierCfg = TIER_CONFIG[opts.qualityTier] ?? TIER_CONFIG.standard;
      const inferredReasons = this.inferFixReasons({
        issues: result.issues,
        faceConsistency: result.faceConsistency,
        styleConsistency: result.styleConsistency,
        readabilityScore: result.readabilityScore,
      });
      const failReasons = this.normalizeFixReasons(result.failReasons, inferredReasons);
      const recommendedFix = this.resolveRecommendedFix(result.recommendedFix, failReasons);

      return {
        score: Math.round(avgScore * 10) / 10,
        pass: avgScore >= tierCfg.minScore,
        issues: result.issues ?? [],
        faceConsistencyScore: result.faceConsistency,
        styleConsistencyScore: result.styleConsistency,
        readabilityScore: result.readabilityScore,
        failReasons,
        recommendedFix,
      };
    } catch (err) {
      this.assessmentErrorCount++;
      if (this.assessmentErrorCount >= 3) {
        this.logger.error(`质量评估连续失败${this.assessmentErrorCount}次，熔断: ${(err as Error).message}`);
      } else {
        this.logger.warn(`质量评估失败(${this.assessmentErrorCount}/3)，降级通过: ${(err as Error).message}`);
      }
      return { score: 4, pass: true, issues: ['assessment_failed'] };
    }
  }

  /** 带质量关卡的图片生成：不合格自动重试，golden Shot 多候选选优 */
  async generateWithQualityGate(
    genFn: (prevAssessment?: QualityAssessment) => Promise<string>,
    opts: QualityGateOptions,
  ): Promise<QualityGateResult> {
    const tierCfg = TIER_CONFIG[opts.qualityTier] ?? TIER_CONFIG.standard;
    const maxAttempts = opts.maxAttempts ?? tierCfg.maxAttempts;
    const minScore = opts.minScore ?? tierCfg.minScore;
    const candidateCount = Math.max(1, Math.min(4, opts.candidateCount ?? tierCfg.candidateCount));

    if (opts.qualityTier === 'filler') {
      const imageUrl = await genFn();
      return { imageUrl, score: 5, attempts: 1, assessment: { score: 5, pass: true, issues: [] } };
    }

    let bestResult: QualityGateResult | null = null;
    let lastAssessment: QualityAssessment | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let bestInAttempt: QualityGateResult | null = null;
        for (let i = 0; i < candidateCount; i++) {
          const imageUrl = await genFn(attempt > 1 ? lastAssessment : undefined);
          if (!imageUrl) continue;
          const assessment = await this.assessImage(imageUrl, {
            prompt: opts.prompt,
            qualityTier: opts.qualityTier,
            characterRefs: opts.characterRefs,
            styleRefs: opts.styleRefs,
            dramaId: opts.dramaId,
            userId: opts.userId,
          });
          const candidate: QualityGateResult = { imageUrl, score: assessment.score, attempts: attempt, assessment };
          if (!bestInAttempt || candidate.score > bestInAttempt.score) bestInAttempt = candidate;
        }
        if (!bestInAttempt) continue;

        lastAssessment = bestInAttempt.assessment;

        if (bestInAttempt.score >= minScore) {
          this.logger.debug(
            `质量通过: score=${bestInAttempt.score} attempt=${attempt}/${maxAttempts} candidates=${candidateCount}`,
          );
          return bestInAttempt;
        }

        if (!bestResult || bestInAttempt.score > bestResult.score) bestResult = bestInAttempt;

        if (attempt < maxAttempts) {
          this.logger.debug(
            `质量不达标(${bestInAttempt.score}<${minScore})，重试 ${attempt + 1}/${maxAttempts} fix=${lastAssessment.recommendedFix ?? 'none'}`,
          );
        }
      } catch (err) {
        this.logger.warn(`生成尝试${attempt}失败: ${(err as Error).message}`);
      }
    }

    if (bestResult) {
      this.logger.debug(`所有尝试完成，使用最佳结果: score=${bestResult.score} attempts=${bestResult.attempts}`);
      return bestResult;
    }

    const fallbackUrl = await genFn();
    return { imageUrl: fallbackUrl, score: 0, attempts: maxAttempts + 1, assessment: { score: 0, pass: false, issues: ['all attempts failed'] } };
  }

  private normalizeFixReasons(
    reasons: QualityFixType[] | undefined,
    fallback: QualityFixType[],
  ): QualityFixType[] {
    const merged = [...(reasons ?? []), ...fallback];
    const deduped: QualityFixType[] = [];
    for (const r of merged) {
      if (!deduped.includes(r)) deduped.push(r);
    }
    return deduped.slice(0, 3);
  }

  private resolveRecommendedFix(
    recommendedFix: QualityFixType | undefined,
    failReasons: QualityFixType[],
  ): QualityFixType | undefined {
    if (recommendedFix) return recommendedFix;
    return failReasons[0];
  }

  private inferFixReasons(input: {
    issues?: string[];
    faceConsistency?: number;
    styleConsistency?: number;
    readabilityScore?: number;
  }): QualityFixType[] {
    const out: QualityFixType[] = [];
    const push = (x: QualityFixType) => { if (!out.includes(x)) out.push(x); };
    if (typeof input.faceConsistency === 'number' && input.faceConsistency < 6) push('identity');
    if (typeof input.styleConsistency === 'number' && input.styleConsistency < 6) push('style');
    if (typeof input.readabilityScore === 'number' && input.readabilityScore < 6) push('camera');

    const text = (input.issues ?? []).join(' ').toLowerCase();
    if (/(face|五官|人脸|头部|身份|character)/.test(text)) push('identity');
    if (/(style|风格|色调|材质|光影|配色)/.test(text)) push('style');
    if (/(camera|构图|景别|视角|镜头|主体不清|读不清)/.test(text)) push('camera');
    if (/(motion|动作|动态|拖影|模糊|抖动)/.test(text)) push('motion');
    return out.slice(0, 3);
  }
}
