/**
 * 短剧策略师 — 生成全剧策略（付费卡点策略、前3集策略、角色预算、悬念节奏）。
 * 会在创建时首次生成，每个段落结束时可刷新。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { dramaStrategySchema, DramaStrategy, DramaSeed, SeriesOutline } from '../schemas/drama-state.schemas';
import { buildStrategySystemPrompt } from '../prompting/drama-playbook';

const strategyOutputSchema = z.object({ strategy: dramaStrategySchema });

@Injectable()
export class DramaStrategyAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(seed: DramaSeed, outline: SeriesOutline, dramaId?: string, userId?: string): Promise<DramaStrategy> {

    const raw = await this.llm.generateStructured({
      taskName: 'drama-strategy',
      schema: strategyOutputSchema,
      systemPrompt: buildStrategySystemPrompt(),
      metadata: { dramaId, userId },
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
