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
import { buildScriptEditorSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const editorOutputSchema = z.object({ storyboard: episodeStoryboardSchema });

@Injectable()
export class ScriptEditorAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async fix(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    priorityIssues?: Array<{ category: string; severity: string; description: string; suggestedFix: string }>,
  ): Promise<EpisodeStoryboard> {
    const issueList = priorityIssues?.length ? priorityIssues : review.issuesFound.filter(i => i.severity === 'critical' || i.severity === 'moderate');
    const issues = issueList.map(i => `[${i.severity}/${i.category}] ${i.description} → 建议：${i.suggestedFix}`).join('\n');
    if (!issues) return storyboard;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-editor',
      schema: editorOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'script-editor', buildScriptEditorSystemPrompt({ contentMode: state.contentMode })),

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
