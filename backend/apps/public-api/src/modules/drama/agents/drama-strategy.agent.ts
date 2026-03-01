/**
 * 短剧策略师 — 生成全剧策略（付费卡点策略、前3集策略、角色预算、悬念节奏）。
 * 会在创建时首次生成，每个段落结束时可刷新。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { dramaStrategySchema, DramaStrategy, DramaSeed, SeriesOutline } from '../schemas/drama-state.schemas';

const strategyOutputSchema = z.object({ strategy: dramaStrategySchema });

@Injectable()
export class DramaStrategyAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(seed: DramaSeed, outline: SeriesOutline): Promise<DramaStrategy> {
    const raw = await this.llm.generateStructured({
      taskName: 'drama-strategy',
      schema: strategyOutputSchema,
      systemPrompt: `你是一位短剧商业策略师，精通观众留存与付费转化。你的任务是为短剧制定运营级策略。

=== 策略维度 ===
1. coreNarrativeContract：本剧与观众的"叙事契约"（一句话，如"只要你追下去，每5集就有一次大反转"）
2. toneGuardrails：调性护栏（如"允许虐但不允许窒息感超过2集""禁止无底线恶搞"）
3. paywallStrategy：
   - firstPaywallEpisode：第一个付费卡点集号（通常8-15集）
   - paywallInterval：后续付费间隔（3-8集）
   - paywallHookIntensity：付费集悬念强度（high/extreme）
   - freeEpisodeStrategy：免费集如何吸引付费（如"免费集展示爽感，付费集才揭真相"）
4. first3EpisodesStrategy：前3集生死线策略（精确到秒：开场如何抓人、第几秒出现核心冲突、第3集结尾如何勾住观众）
5. hookCadencePolicy：悬念节奏策略
   - preferredTypes：偏好的悬念类型（如["身份揭露","真相碎片","关系反转","新敌出现"]）
   - avoidRecentRepeatWindow：最近N集内不重复同类型悬念
   - urgencyBias：紧迫感倾向（conservative/balanced/aggressive）
6. characterBudget：角色出场预算
   - maxPresentPerEpisode：每集最多出场角色数（短剧通常3-4人）
   - maxNewPerSegment：每段落最多引入新角色数

所有输出简体中文。`,

      userPrompt: `请为以下短剧制定策略：

剧名：${seed.title}（${seed.genre}）
核心矛盾：${seed.coreConflict}
爽点类型：${seed.catharsisType}
总集数：${outline.totalPlannedEpisodes}
付费卡点集号：[${outline.paywallEpisodes.join(', ')}]
前3集概要：${outline.episodes.slice(0, 3).map(e => `第${e.episodeNumber}集：${e.coreConflict}`).join('；')}

要求：生成完整的 strategy 对象。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const s = typeof root.strategy === 'object' && root.strategy ? root.strategy : root;
    return dramaStrategySchema.parse(s);
  }
}
