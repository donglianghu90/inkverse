/**
 * 台词教练 — 润色剧本中的台词，确保每个角色的说话风格与voiceProfile一致。
 * 输入：EpisodeScript + CharacterIdentity[]，输出：润色后的 EpisodeScript。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeScriptSchema, EpisodeScript, CharacterIdentity, DramaPromptProfile,
} from '../schemas/drama-state.schemas';

const coachOutputSchema = z.object({ script: episodeScriptSchema });

@Injectable()
export class DialogueCoachAgent {
  constructor(private readonly llm: LlmService) {}

  async polish(
    script: EpisodeScript, characters: CharacterIdentity[], profile?: DramaPromptProfile,
  ): Promise<EpisodeScript> {
    const charVoices = characters.map(c =>
      `${c.characterId}(${c.name}): 音色=${c.voiceProfile.timbre}, 风格=${c.voiceProfile.speakingStyle}, 口癖="${c.voiceProfile.catchphrase}", 语速=${c.voiceProfile.speed}`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-dialogue-coach',
      schema: coachOutputSchema,
      systemPrompt: `你是短剧台词教练。你的任务是润色剧本中的台词，确保：

1. 每个角色的台词风格与其 voiceProfile 严格一致
   - 霸总说话简短有力，不解释不废话
   - 白莲花柔声细语但暗藏锋芒
   - 闺蜜说话直接爽快
2. 台词短且有力：单句不超过15个字（除了关键独白）
3. 潜台词比明说更好：不直接说"我喜欢你"，用行为暗示
4. 每个角色的口癖自然融入（不是每句都加，而是关键时刻使用）
5. parenthetical（括号注释）要精准，指导演员/TTS表演
6. 保持剧本结构不变，只润色对话内容和 parenthetical

${profile?.scriptwriterGuide?.dialogueGuide ?? ''}`,

      userPrompt: `请润色第 ${script.episodeNumber} 集的台词：

角色配音档案：
${charVoices}

当前剧本（需润色台词）：
${JSON.stringify(script, null, 0)}

要求：返回完整的润色后剧本，保持 scenes 结构不变，只优化 dialogues 中的 text 和 parenthetical。`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const s = typeof root.script === 'object' && root.script ? root.script : root;
    return episodeScriptSchema.parse(s);
  }
}
