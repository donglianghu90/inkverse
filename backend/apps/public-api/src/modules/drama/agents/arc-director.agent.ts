/**
 * 段落导演 — 管理当前段落（Arc Segment）的进度，决定何时开新段落。
 * 在每集开始前调用，确保当前段落规划存在且有效。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  arcSegmentSchema, ArcSegment, DramaState, DramaSeed, SeriesOutline,
} from '../schemas/drama-state.schemas';

const arcOutputSchema = z.object({ segment: arcSegmentSchema });

@Injectable()
export class ArcDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  async planOrRefresh(state: DramaState, episodeNumber: number): Promise<ArcSegment> {
    const current = state.currentArcSegment;
    if (current && episodeNumber <= current.endEpisode && current.status === 'active') return current;

    const recentSummaries = state.episodeSummaries.slice(-5).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');
    const raw = await this.llm.generateStructured({
      taskName: 'drama-arc-director',
      schema: arcOutputSchema,
      systemPrompt: `你是短剧段落导演。你的任务是为接下来的10-20集规划一个段落（Arc Segment）。
段落有明确的核心矛盾、情感主题和高潮集。每个段落就像一个"小赛季"。

=== 段落规划原则 ===
1. 段落长度：10-20集，按剧情密度调整
2. 每段落有独立的核心矛盾（不是全剧主线的重复，而是主线的一个维度）
3. 角色的情感弧线要在段落内有闭合（从startState到endState）
4. climaxEpisode = 本段落的高潮集，通常在段落后1/3处
5. 如果有前面段落的数据，确保故事推进而非重复

所有输出简体中文。`,

      userPrompt: `当前状态：
全剧标题：${state.seed.title}
已生成集数：${episodeNumber - 1}
全剧计划：${state.seriesOutline?.totalPlannedEpisodes ?? '未知'} 集
已完成段落数：${state.arcSegments.length}
${current ? `上一段落：${current.segmentTitle}（${current.startEpisode}-${current.endEpisode}集，矛盾：${current.coreConflict}）` : '尚无段落'}
最近剧情：\n${recentSummaries || '（暂无）'}
上集悬念：${state.lastCliffhanger || '无'}
主角：${state.seed.protagonistConcept.name}
角色列表：${state.characters.map(c => c.name).join('、')}

请为第 ${episodeNumber} 集开始的新段落做规划。segmentId 格式：arc_${state.arcSegments.length + 1}`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const seg = typeof root.segment === 'object' && root.segment ? root.segment : root;
    return arcSegmentSchema.parse(seg);
  }
}
