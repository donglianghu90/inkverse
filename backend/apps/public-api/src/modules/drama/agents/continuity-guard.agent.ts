/**
 * 连续性守卫 — 在编剧动笔前检查本集意图是否与已有剧情矛盾。
 * 产出：pass/block + 上下文注入（contextInjections 供编剧参考）。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  dramaContinuityCheckSchema, DramaContinuityCheck, DramaState, EpisodeIntent,
} from '../schemas/drama-state.schemas';

const checkOutputSchema = z.object({ check: dramaContinuityCheckSchema });

@Injectable()
export class ContinuityGuardAgent {
  constructor(private readonly llm: LlmService) {}

  async verify(state: DramaState, intent: EpisodeIntent): Promise<DramaContinuityCheck> {
    const secrets = state.secretLedger.filter(s => !s.resolved).map(s =>
      `[${s.id}] "${s.secret}" — 知情者:${s.knownBy.join(',')} 隐瞒对象:${s.hiddenFrom.join(',')}`
    ).join('\n');
    const recentLore = state.episodeSummaries.slice(-3);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-continuity-guard',
      schema: checkOutputSchema,
      systemPrompt: `你是短剧连续性守卫。你的职责是在编剧动笔前检查本集意图是否会产生连续性问题。

=== 检查维度 ===
1. character_appearance_mismatch：角色外貌是否与锁定的面部描述矛盾
2. location_continuity_break：场景描述是否与已建立的场景矛盾
3. costume_inconsistency：服饰是否在不该变化时变了
4. emotion_jump：情绪是否有不合理的跳跃（上集末尾大哭，本集开头突然开心）
5. timeline_violation：时间线是否矛盾
6. secret_leak：尚未揭露的秘密是否被不知情的角色知道了
7. dead_character_active：已退场角色是否不合理地出现
8. relationship_contradiction：角色关系是否与已建立的矛盾

severity = 'warning'（可以继续但需注意）或 'block'（必须修正才能继续）
contextInjections = 编剧需要知道的上下文信息（如"陆子轩目前不知道林婉清的真实身份"）`,

      userPrompt: `第 ${intent.episodeNumber} 集连续性检查：

本集意图：
- 目标：${intent.goals.join('；')}
- 出场角色：${intent.activeCharacters.map(c => `${c.characterId}(${c.role}/${c.emotionalState})`).join('、')}
- 情绪方向：${intent.emotionDirection}

已知秘密（未揭露）：
${secrets || '（无）'}

最近3集摘要：
${recentLore.map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n') || '（无前情）'}

上集悬念：${state.lastCliffhanger || '无'}

角色身份档案：
${state.characters.map(c => `${c.characterId}(${c.name}): 面部=${c.faceDescription.slice(0, 30)}... 默认服饰=${c.defaultCostume}`).join('\n')}

请检查并返回结果。`,
      temperature: 0.2,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const check = typeof root.check === 'object' && root.check ? root.check : root;
    return dramaContinuityCheckSchema.parse(check);
  }
}
