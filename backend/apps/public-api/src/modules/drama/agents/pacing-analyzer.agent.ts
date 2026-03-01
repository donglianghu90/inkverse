/**
 * 节奏分析师 — 分析分镜板的节奏曲线，检查是否有拖沓/过密/情绪跳跃。
 * 主要检查镜头时长分布、情绪密度、BGM节奏是否匹配。产出节奏建议（非必修，辅助优化）。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { EpisodeStoryboard, DramaState } from '../schemas/drama-state.schemas';

const pacingResultSchema = z.object({
  overallPacing: z.enum(['too_slow', 'slightly_slow', 'good', 'slightly_fast', 'too_fast']),
  score: z.number().min(0).max(10),
  segments: z.array(z.object({
    shotRange: z.string(), // "shot0-shot5"
    verdict: z.enum(['drag', 'ok', 'rush']),
    suggestion: z.string(),
  })),
  emotionalCurve: z.string(), // 一句话描述情绪曲线走势
  recommendations: z.array(z.string()),
});

export type PacingResult = z.infer<typeof pacingResultSchema>;

@Injectable()
export class PacingAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(state: DramaState, storyboard: EpisodeStoryboard): Promise<PacingResult> {
    const shotSummary = storyboard.shots.map(s =>
      `shot${s.shotIndex}: ${s.estimatedDurationSec}s ${s.camera.angle}/${s.camera.movement} ${s.dialogue ? '🗣' : '🔇'} ${s.audio.bgm?.mood ?? 'no_bgm'}(${s.audio.bgm?.intensity ?? 0})`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-pacing-analyzer',
      schema: pacingResultSchema,
      systemPrompt: `你是短剧节奏分析师。分析分镜板的节奏曲线，给出评估和建议。

=== 节奏判断标准 ===
- 连续3个Shot以上无对话无动作 = drag（拖沓）
- 连续5个Shot以上都是1-2秒快切 = rush（过密，观众看不清）
- BGM从高强度突然变低而没有剧情缓冲 = 情绪跳跃
- 全集高强度占比超过60% = 观众疲劳
- 全集低强度占比超过50% = 可能流失

=== 理想节奏模式 ===
开场（15%）：快节奏抓人
铺垫（20%）：中节奏建立
上升（25%）：逐渐加速
高潮（25%）：最快节奏
落幕+钩子（15%）：短暂缓冲后留悬念`,

      userPrompt: `分析第 ${storyboard.episodeNumber} 集节奏：

总时长：${storyboard.totalEstimatedDurationSec}秒
Shot数：${storyboard.shots.length}

逐Shot摘要：
${shotSummary}

请给出节奏分析。`,
      temperature: 0.3,
    });

    return pacingResultSchema.parse(raw);
  }
}
