/**
 * 编剧 Agent — 根据 EpisodeIntent + 上下文生成本集剧本（EpisodeScript）。
 * 剧本由多个场景（ScriptScene）组成，每场景含台词+动作+情绪标注。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeScriptSchema, EpisodeScript, DramaState, EpisodeIntent, DramaContinuityCheck,
} from '../schemas/drama-state.schemas';

const scriptOutputSchema = z.object({ script: episodeScriptSchema });

@Injectable()
export class ScriptwriterAgent {
  constructor(private readonly llm: LlmService) {}

  async write(
    state: DramaState, intent: EpisodeIntent, continuity: DramaContinuityCheck,
  ): Promise<EpisodeScript> {
    const profile = state.promptProfile;
    const guide = profile?.scriptwriterGuide;
    const charMap = state.characters.map(c =>
      `${c.characterId}(${c.name}): 性格=${c.voiceProfile.speakingStyle}, 口癖="${c.voiceProfile.catchphrase}"`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-scriptwriter',
      schema: scriptOutputSchema,
      systemPrompt: `${guide?.coreIdentity ?? '你是一位短剧编剧，擅长用最少的台词传递最大的信息量。'}

=== 编剧铁律 ===
${guide?.genreRules?.map((r, i) => `${i + 1}. ${r}`).join('\n') ?? '1. 每场戏必须有冲突或信息推进\n2. 台词简短有力，单句不超过15字\n3. 禁止大段心理描写'}

=== 台词风格 ===
${guide?.dialogueGuide ?? '简短有力，关键信息用表情+一句话传递。禁止长独白。'}

=== 节奏指南 ===
${guide?.pacingGuide ?? '每场戏20-60秒，全集3-6个场景。'}

=== 视觉叙事 ===
${guide?.visualNarrativeGuide ?? '优先用画面叙事，一个眼神胜过三句解释。'}

=== 禁止模式 ===
${guide?.forbiddenPatterns?.join('、') ?? '禁止连续误会推剧情、禁止无脑虐主'}

=== 场景结构 ===
- 每个 scene 有明确的 purpose（hook_opening/conflict/revelation/emotional/action/confrontation/romantic/transition/climax/cliffhanger）
- dialogues 数组：每条对话含 characterId + text + parenthetical（括号注释如"冷笑""握紧拳头"）
- actions 数组：每条动作描写，characterId 为空表示环境动作
- emotionalEntry/emotionalExit：场景情绪入口和出口
- sceneId 格式：ep{N}_sc{M}

所有输出简体中文。`,

      userPrompt: `第 ${intent.episodeNumber} 集剧本创作：

=== 集级意图 ===
目标：${intent.goals.join('；')}
情绪方向：${intent.emotionDirection}
钩子方向：${intent.hookDirection}
上集衔接：${intent.carryoverFromLastEpisode}
是否付费集：${intent.isPaywallEpisode ? '是（必须在最关键时刻结束）' : '否'}
目标时长：${intent.durationTargetSec} 秒

=== 出场角色 ===
${intent.activeCharacters.map(c => `${c.characterId}: ${c.role} | 情绪=${c.emotionalState}${c.costumeOverride ? ` | 服饰=${c.costumeOverride}` : ''}`).join('\n')}

=== 角色说话风格 ===
${charMap}

=== 连续性注入 ===
${continuity.contextInjections.join('\n') || '（无特殊注意事项）'}
${continuity.warnings.length > 0 ? `⚠️ 连续性警告：${continuity.warnings.map(w => w.description).join('；')}` : ''}

=== 使用场景 ===
${intent.locationIds.map(id => {
  const loc = state.locations.find(l => l.locationId === id);
  return loc ? `${id}(${loc.name}): ${loc.description.slice(0, 50)}...` : id;
}).join('\n')}

请创作本集完整剧本。每个场景的 sceneId 用 ep${intent.episodeNumber}_sc1, ep${intent.episodeNumber}_sc2... 格式。`,
      temperature: 0.65,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const script = typeof root.script === 'object' && root.script ? root.script : root;
    return episodeScriptSchema.parse(script);
  }
}
