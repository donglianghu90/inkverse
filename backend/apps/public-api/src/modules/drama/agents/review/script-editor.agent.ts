/**
 * 剧本精修 Agent — 根据 Review 中的 issuesFound 对分镜板+剧本进行定向修复。
 * 同时接收 script 和 storyboard，修复后同步返回两者以避免数据脱节。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  episodeStoryboardSchema, episodeScriptSchema,
  EpisodeStoryboard, EpisodeScript, EpisodeReview, DramaState,
} from '../../schemas/drama-state.schemas';
import { buildScriptEditorSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

const editorOutputSchema = z.object({
  storyboard: episodeStoryboardSchema,
  script: episodeScriptSchema.optional(),
});

export interface ScriptEditorResult {
  storyboard: EpisodeStoryboard;
  script?: EpisodeScript;
}

@Injectable()
export class ScriptEditorAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async fix(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    priorityIssues?: Array<{ category: string; severity: string; description: string; suggestedFix: string }>,
    script?: EpisodeScript,
  ): Promise<EpisodeStoryboard> {
    const result = await this.fixWithScript(state, storyboard, review, priorityIssues, script);
    return result.storyboard;
  }

  async fixWithScript(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    priorityIssues?: Array<{ category: string; severity: string; description: string; suggestedFix: string }>,
    script?: EpisodeScript,
  ): Promise<ScriptEditorResult> {
    const issueList = priorityIssues?.length ? priorityIssues : review.issuesFound.filter(i => i.severity === 'critical' || i.severity === 'moderate');
    const issues = issueList.map(i => `[${i.severity}/${i.category}] ${i.description} → 建议：${i.suggestedFix}`).join('\n');
    if (!issues) return { storyboard, script };

    const scriptCtx = script ? `\n=== 当前剧本（如修改了分镜中的台词/场景，请同步修改剧本并在 script 字段返回） ===\n${JSON.stringify(script, null, 0)}` : '';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-editor',
      schema: editorOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'script-editor', buildScriptEditorSystemPrompt({ dialogueGuide: state.promptProfile?.scriptwriterGuide?.dialogueGuide })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: storyboard.episodeNumber },
      userPrompt: `修复第 ${storyboard.episodeNumber} 集分镜板：

=== 需要修复的问题 ===
${issues}

=== 当前分镜板 ===
${JSON.stringify(storyboard, null, 0)}
${scriptCtx}

请返回修复后的完整分镜板。如果修改涉及台词或场景结构，请同时返回同步后的 script。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sb = typeof root.storyboard === 'object' && root.storyboard ? root.storyboard : root;
    const editedScript = root.script ? episodeScriptSchema.parse(root.script) : undefined;
    return {
      storyboard: episodeStoryboardSchema.parse(sb),
      script: editedScript,
    };
  }
}
