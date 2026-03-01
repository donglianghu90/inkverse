/**
 * 剧本精修 Agent — 根据 Review 中的 issuesFound 对分镜板进行定向修复。
 * 只修复被标记的问题，不做多余改动。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeStoryboardSchema, EpisodeStoryboard, EpisodeReview, DramaState,
} from '../schemas/drama-state.schemas';

const editorOutputSchema = z.object({ storyboard: episodeStoryboardSchema });

@Injectable()
export class ScriptEditorAgent {
  constructor(private readonly llm: LlmService) {}

  async fix(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
  ): Promise<EpisodeStoryboard> {
    const issues = review.issuesFound
      .filter(i => i.severity === 'critical' || i.severity === 'moderate')
      .map(i => `[${i.severity}/${i.category}] ${i.description} → 建议：${i.suggestedFix}`)
      .join('\n');

    if (!issues) return storyboard; // 无需修复

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-editor',
      schema: editorOutputSchema,
      systemPrompt: `你是短剧剧本精修编辑。你的唯一任务是修复审核中发现的问题。

=== 修复原则 ===
1. 只修复被标记的问题，不做"顺便优化"
2. 修复时保持与整体风格一致
3. 如果修复涉及台词变化，确保角色说话风格不变
4. 如果修复涉及镜头调整，确保 visualPrompt 同步更新
5. 修复后的 shot 总时长偏差不超过原来的 ±10%

所有输出简体中文（visualPrompt 保持英文）。`,

      userPrompt: `修复第 ${storyboard.episodeNumber} 集分镜板：

=== 需要修复的问题 ===
${issues}

=== 当前分镜板 ===
${JSON.stringify(storyboard, null, 0)}

请返回修复后的完整分镜板。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sb = typeof root.storyboard === 'object' && root.storyboard ? root.storyboard : root;
    return episodeStoryboardSchema.parse(sb);
  }
}
