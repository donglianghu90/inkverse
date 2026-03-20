/**
 * 节奏分析师 — 分析分镜板的节奏曲线，检查是否有拖沓/过密/情绪跳跃。
 * 主要检查镜头时长分布、情绪密度、BGM节奏是否匹配。产出节奏建议（非必修，辅助优化）。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import { EpisodeStoryboard, DramaState } from '../../schemas/drama-state.schemas';
import { buildPacingAnalyzerSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

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
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async analyze(state: DramaState, storyboard: EpisodeStoryboard): Promise<PacingResult> {
    const shots = storyboard?.shots ?? [];
    if (!shots.length) return { overallPacing: 'good', score: 7, segments: [], emotionalCurve: '无数据', recommendations: [] };
    const shotSummary = shots.map(s =>
      `shot${s.shotIndex}: ${s.estimatedDurationSec}s ${s.camera?.shotSize}+${s.camera?.cameraAngle}/${s.camera?.movement} ${s.dialogue ? '🗣' : '🔇'} ${s.audio?.bgm?.mood ?? 'no_bgm'}(${s.audio?.bgm?.intensity ?? 0})`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-pacing-analyzer',
      schema: pacingResultSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'pacing-analyzer', buildPacingAnalyzerSystemPrompt({
        genreArchetype: state.promptProfile?.genreArchetype,
        genreRules: state.promptProfile?.scriptwriterGuide?.genreRules,
        pacingAnalyzerGuide: state.promptProfile?.pacingAnalyzerGuide ?? undefined,
      })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: storyboard.episodeNumber },
      userPrompt: `分析第 ${storyboard.episodeNumber} 集节奏：

总时长：${storyboard.totalEstimatedDurationSec}秒
Shot数：${shots.length}

逐Shot摘要：
${shotSummary}

请给出节奏分析。`,
      temperature: 0.3,
    });

    return pacingResultSchema.parse(raw);
  }
}
