/**
 * 集导演 — 根据大纲概要 + 段落规划 + 上下文，生成本集的详细意图（EpisodeIntent）。
 * EpisodeIntent 是后续编剧、分镜导演的输入。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeIntentSchema, EpisodeIntent, DramaState, EpisodeSynopsis,
} from '../schemas/drama-state.schemas';

const intentOutputSchema = z.object({ intent: episodeIntentSchema });

@Injectable()
export class EpisodeDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  async direct(state: DramaState, synopsis: EpisodeSynopsis): Promise<EpisodeIntent> {
    const epNum = synopsis.episodeNumber;
    const recentSummaries = state.episodeSummaries.slice(-3).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');
    const chars = state.characters.map(c => `${c.characterId}(${c.name}): ${c.defaultCostume}`).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-episode-director',
      schema: intentOutputSchema,
      systemPrompt: `你是短剧集导演。你的任务是根据大纲概要将本集细化为具体的"集级意图"（EpisodeIntent），为编剧提供精确指令。

=== Intent 要求 ===
1. goals：本集必须完成的3-5个目标（按优先级排序）
2. emotionDirection：本集总体情绪走向（如"从日常甜蜜到震惊发现"）
3. hookDirection：集末钩子方向（必须具体，如"女主在书房发现了一张照片"）
4. carryoverFromLastEpisode：上集遗留的情绪/悬念如何衔接
5. activeCharacters：本集出场角色（含本集服饰、情绪基调、角色定位）
   - costumeOverride 为空则使用默认服饰
   - 每集出场角色不超过 ${state.strategy?.characterBudget?.maxPresentPerEpisode ?? 4} 人
6. locationIds：本集使用的场景ID
7. durationTargetSec：目标时长

所有输出简体中文。`,

      userPrompt: `本集信息：
第 ${epNum} 集：${synopsis.title}
核心冲突：${synopsis.coreConflict}
集末悬念：${synopsis.cliffhanger}
情绪弧线：${synopsis.emotionalArc}
关键角色：${synopsis.keyCharacterIds.join('、')}
是否付费集：${synopsis.isPaywall ? '是' : '否'}
${synopsis.isPaywall ? `付费原因：${synopsis.paywallReason}` : ''}

上下文：
上集悬念：${state.lastCliffhanger || '无（第一集）'}
最近剧情：\n${recentSummaries || '（第一集，无前情）'}
${state.currentArcSegment ? `当前段落：${state.currentArcSegment.segmentTitle}（矛盾：${state.currentArcSegment.coreConflict}）` : ''}

可用角色：\n${chars}
可用场景：${state.locations.map(l => `${l.locationId}(${l.name})`).join('、')}

请生成本集的详细意图。`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const intent = typeof root.intent === 'object' && root.intent ? root.intent : root;
    return episodeIntentSchema.parse(intent);
  }
}
