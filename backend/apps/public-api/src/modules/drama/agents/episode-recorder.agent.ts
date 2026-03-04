/**
 * 知识记录员 — 本集生成完毕后，提取知识记录（lore record）用于后续集的上下文。
 * 包含：剧情摘要、角色状态变化、秘密更新、闪回候选标注。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeLoreRecordSchema, EpisodeLoreRecord, EpisodeStoryboard, EpisodeScript, DramaState,
} from '../schemas/drama-state.schemas';
import { buildEpisodeRecorderSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const recorderOutputSchema = z.object({ record: episodeLoreRecordSchema });

@Injectable()
export class EpisodeRecorderAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async record(
    state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard,
    cliffhangerSummary: string,
  ): Promise<EpisodeLoreRecord> {
    const raw = await this.llm.generateStructured({
      taskName: 'drama-episode-recorder',
      schema: recorderOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'episode-recorder', buildEpisodeRecorderSystemPrompt()),

      userPrompt: `记录第 ${script.episodeNumber} 集知识：

本集剧本场景：
${script.scenes.map(s => `[${s.purpose}] ${s.objective} — 角色:${s.presentCharacterIds.join(',')} 情绪:${s.emotionalEntry}→${s.emotionalExit}`).join('\n')}

本集分镜数：${storyboard?.shots?.length ?? 0}
本集总时长：${storyboard?.totalEstimatedDurationSec ?? 0}秒

本集悬念：${cliffhangerSummary}
上集悬念：${state.lastCliffhanger || '无'}

已知秘密：
${state.secretLedger.filter(s => !s.resolved).map(s => `"${s.secret}" 知情:${s.knownBy.join(',')} 隐瞒:${s.hiddenFrom.join(',')}`).join('\n') || '（无）'}

请提取完整的知识记录。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const record = typeof root.record === 'object' && root.record ? root.record : root;
    return episodeLoreRecordSchema.parse(record);
  }
}
