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
import { buildContinuityGuardSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const checkOutputSchema = z.object({ check: dramaContinuityCheckSchema });

@Injectable()
export class ContinuityGuardAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async verify(state: DramaState, intent: EpisodeIntent): Promise<DramaContinuityCheck> {
    const secrets = state.secretLedger.filter(s => !s.resolved).map(s =>
      `[${s.id}] "${s.secret}" — 知情者:${s.knownBy.join(',')} 隐瞒对象:${s.hiddenFrom.join(',')}`
    ).join('\n');
    const recentLore = state.episodeSummaries.slice(-5);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-continuity-guard',
      schema: checkOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'continuity-guard', buildContinuityGuardSystemPrompt()),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: intent.episodeNumber },
      userPrompt: `第 ${intent.episodeNumber} 集连续性检查：

本集意图：
- 目标：${intent.goals.join('；')}
- 出场角色：${intent.activeCharacters.map(c => `${c.characterId}(${c.role}/${c.emotionalState})`).join('、')}
- 情绪方向：${intent.emotionDirection}

已知秘密（未揭露）：
${secrets || '（无）'}

最近5集摘要：
${recentLore.map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n') || '（无前情）'}
${state.storySoFar ? `\n全局概要：${state.storySoFar.slice(0, 400)}` : ''}

上集悬念：${state.lastCliffhanger || '无'}

角色身份档案：
${state.characters.map(c => `${c.characterId}(${c.name}): 面部=${c.faceDescription} 默认服饰=${c.defaultCostume}${c.variations?.length ? ` 变体=[${c.variations.map(v => v.variationId).join(',')}]` : ''}`).join('\n')}

角色命名约束：
- 现有角色名：${state.characters.map(c => c.name).join('、') || '（无）'}
- 检查错名/改名未交代、称呼无因漂移、以及新旧角色重名或近似名混淆
- 角色命名应简短好记，不要在同一阶段引入发音或字形高度相似的人名

请检查并返回结果。`,
      temperature: 0.2,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const check = typeof root.check === 'object' && root.check ? root.check : root;
    return dramaContinuityCheckSchema.parse(check);
  }
}
