/** 媒体质量关卡 — 生成后质量评估 + 自动重试 + golden Shot 多候选选优 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../novel/llm/llm.service';
import { z } from 'zod';

export interface QualityAssessment {
  score: number;
  pass: boolean;
  issues: string[];
  faceConsistencyScore?: number;
}

export interface QualityGateOptions {
  maxAttempts: number;
  minScore: number;
  qualityTier: 'golden' | 'standard' | 'filler';
  prompt: string;
  characterRefs?: string[];
}

export interface QualityGateResult {
  imageUrl: string;
  score: number;
  attempts: number;
  assessment: QualityAssessment;
}

const TIER_CONFIG: Record<string, { maxAttempts: number; minScore: number; candidateCount: number }> = {
  golden: { maxAttempts: 3, minScore: 6, candidateCount: 2 },
  standard: { maxAttempts: 2, minScore: 4, candidateCount: 1 },
  filler: { maxAttempts: 1, minScore: 0, candidateCount: 1 },
};

const assessmentSchema = z.object({
  aestheticScore: z.number().min(0).max(10),
  promptAdherence: z.number().min(0).max(10),
  technicalQuality: z.number().min(0).max(10),
  faceConsistency: z.number().min(0).max(10).optional(),
  issues: z.array(z.string()),
});

@Injectable()
export class MediaQualityGateService {
  private readonly logger = new Logger('MediaQualityGate');

  constructor(private readonly llm: LlmService) {}

  /** 评估单张图片质量（使用 LLM 视觉能力看图打分） */
  async assessImage(imageUrl: string, opts: {
    prompt: string;
    qualityTier: string;
    characterRefs?: string[];
  }): Promise<QualityAssessment> {
    if (!imageUrl) return { score: 0, pass: false, issues: ['empty image URL'] };

    try {
      const imageUrls = [imageUrl, ...(opts.characterRefs ?? [])].filter(Boolean);
      const result = await this.llm.generateStructured({
        taskName: 'media-quality-assessment',
        schema: assessmentSchema,
        systemPrompt: `你是一位AI生成图片质量评估专家。请仔细观察提供的图片，评估维度：
1. aestheticScore (0-10): 构图、色彩、光影的美学品质
2. promptAdherence (0-10): 图片内容与提示词的吻合度
3. technicalQuality (0-10): 清晰度、无伪影、无畸变（关注面部/手指畸变）
4. faceConsistency (0-10, 仅有人物时): 面部是否自然、无变形、五官完整；如有角色参考图，评估面部是否与参考一致
5. issues: 发现的具体问题列表

严格评分：6分=合格，8分=优秀，<5分=有明显缺陷。
AI生成图常见问题：多余手指、面部扭曲、文字水印、比例失调、背景穿模。`,
        userPrompt: `请观察图片并评估质量。第一张图是待评估的AI生成图。${opts.characterRefs?.length ? `后续图片是角色参考图，请对比面部一致性。` : ''}

原始提示词：${opts.prompt.slice(0, 300)}

请输出评估结果（JSON）。`,
        imageUrls,
        temperature: 0.2,
      });

      const scores = [result.aestheticScore, result.promptAdherence, result.technicalQuality];
      if (result.faceConsistency !== undefined) scores.push(result.faceConsistency);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const tierCfg = TIER_CONFIG[opts.qualityTier] ?? TIER_CONFIG.standard;

      return {
        score: Math.round(avgScore * 10) / 10,
        pass: avgScore >= tierCfg.minScore,
        issues: result.issues ?? [],
        faceConsistencyScore: result.faceConsistency,
      };
    } catch (err) {
      this.logger.warn(`质量评估失败，默认通过: ${(err as Error).message}`);
      return { score: 5, pass: true, issues: ['assessment_failed'] };
    }
  }

  /** 带质量关卡的图片生成：不合格自动重试，golden Shot 多候选选优 */
  async generateWithQualityGate(
    genFn: () => Promise<string>,
    opts: QualityGateOptions,
  ): Promise<QualityGateResult> {
    const tierCfg = TIER_CONFIG[opts.qualityTier] ?? TIER_CONFIG.standard;
    const maxAttempts = opts.maxAttempts ?? tierCfg.maxAttempts;
    const minScore = opts.minScore ?? tierCfg.minScore;

    if (opts.qualityTier === 'filler') {
      const imageUrl = await genFn();
      return { imageUrl, score: 5, attempts: 1, assessment: { score: 5, pass: true, issues: [] } };
    }

    let bestResult: QualityGateResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const imageUrl = await genFn();
        if (!imageUrl) continue;

        const assessment = await this.assessImage(imageUrl, {
          prompt: opts.prompt,
          qualityTier: opts.qualityTier,
          characterRefs: opts.characterRefs,
        });

        const result: QualityGateResult = { imageUrl, score: assessment.score, attempts: attempt, assessment };

        if (assessment.pass && assessment.score >= minScore) {
          this.logger.debug(`质量通过: score=${assessment.score} attempt=${attempt}/${maxAttempts}`);
          return result;
        }

        if (!bestResult || assessment.score > bestResult.score) bestResult = result;

        if (attempt < maxAttempts) {
          this.logger.debug(`质量不达标(${assessment.score}<${minScore})，重试 ${attempt + 1}/${maxAttempts}`);
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

  /** 获取指定质量层级的默认配置 */
  getTierConfig(tier: string): { maxAttempts: number; minScore: number; candidateCount: number } {
    return TIER_CONFIG[tier] ?? TIER_CONFIG.standard;
  }
}
