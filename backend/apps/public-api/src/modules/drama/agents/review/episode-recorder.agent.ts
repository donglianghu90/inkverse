/**
 * 知识记录员 — 本集生成完毕后，提取知识记录（lore record）用于后续集的上下文。
 * 包含：剧情摘要、角色状态变化、秘密更新、闪回候选标注。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  episodeLoreRecordSchema, EpisodeLoreRecord, EpisodeStoryboard, EpisodeScript, DramaState,
} from '../../schemas/drama-state.schemas';
import { buildEpisodeRecorderSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';


const recorderOutputSchema = z.object({ record: episodeLoreRecordSchema });

@Injectable()
export class EpisodeRecorderAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async record(
    state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard,
    cliffhangerSummary: string,
  ): Promise<EpisodeLoreRecord> {
    const raw = await this.llm.generateStructured({
      taskName: DRAMA_AGENT_REGISTRY.EPISODE_RECORDER.key,
      schema: recorderOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'episode-recorder', buildEpisodeRecorderSystemPrompt({
        genreArchetype: state.promptProfile?.genreArchetype,
        genreRules: state.promptProfile?.scriptwriterGuide?.genreRules,
      })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: script.episodeNumber },
      userPrompt: `记录第 ${script.episodeNumber} 集知识：

本集剧本场景（含关键台词，用于准确记录信息揭露和角色状态变化）：
${script.scenes.map(s => {
  const keyDialogues = (s.dialogues ?? []).slice(0, 5).map(d => `  ${d.characterId}: "${d.text}"`).join('\n');
  const dialogueBlock = keyDialogues ? `\n  关键台词:\n${keyDialogues}` : '';
  return `[${s.purpose}] ${s.objective}\n  转折点: ${s.turningPoint}\n  角色:${s.presentCharacterIds.join(',')} 情绪:${s.emotionalEntry}→${s.emotionalExit}${dialogueBlock}`;
}).join('\n---\n')}

本集分镜数：${storyboard?.shots?.length ?? 0}
本集总时长：${storyboard?.totalEstimatedDurationSec ?? 0}秒

本集悬念：${cliffhangerSummary}
上集悬念：${state.lastCliffhanger || '无'}

已知秘密（记录员必须精准判断哪些秘密在本集台词/转折中被揭露）：
${state.secretLedger.filter(s => !s.resolved).map(s => `[${s.id}] "${s.secret}" 知情:${s.knownBy.join(',')} 隐瞒:${s.hiddenFrom.join(',')}`).join('\n') || '（无）'}

请提取完整的知识记录。如果本集中某个秘密已经被揭露/解决，请在 resolvedSecretIds 中填写对应的秘密 id。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const record = typeof root.record === 'object' && root.record ? root.record : root;
    return episodeLoreRecordSchema.parse(record);
  }
}
