/**
 * 总导演 Agent — 分段式全剧大纲规划。首段（15集）详细，后续骨架，由 ArcDirector 按需展开。
 * 产出：SeriesOutline（totalPlannedEpisodes + episodes[] + paywallEpisodes[]）
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { seriesOutlineSchema, SeriesOutline, DramaSeed, episodeSynopsisSchema } from '../schemas/drama-state.schemas';
import { buildSeriesDirectorSystemPrompt } from '../prompting/drama-playbook';

const DETAIL_SEGMENT = 15; // 首段详细规划集数

const segmentedOutputSchema = z.object({
  mainStoryGoal: z.string(),
  endingDirection: z.string(),
  arcOverview: z.array(z.object({ segmentTitle: z.string(), startEp: z.number(), endEp: z.number(), coreConflict: z.string(), paywallEpisodes: z.array(z.number()).default([]) })),
  detailedEpisodes: z.array(episodeSynopsisSchema),
  paywallEpisodes: z.array(z.number()).default([]),
});

@Injectable()
export class SeriesDirectorAgent {
  private readonly logger = new Logger(SeriesDirectorAgent.name);
  constructor(private readonly llm: LlmService) {}

  async plan(seed: DramaSeed): Promise<SeriesOutline> {
    const epMin = seed.plannedTotalEpisodes.min;
    const epMax = seed.plannedTotalEpisodes.max;
    const targetEp = Math.round((epMin + epMax) / 2);
    const durSec = seed.targetEpisodeDurationSec;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-series-director',
      schema: segmentedOutputSchema,
      systemPrompt: buildSeriesDirectorSystemPrompt({ targetEp, epMin, epMax, durSec }),
      userPrompt: `请根据以下短剧种子规划全剧大纲：

剧名：${seed.title}
题材：${seed.genre}
梗概：${seed.logline}
核心矛盾：${seed.coreConflict}
爽点类型：${seed.catharsisType}
主角：${seed.protagonistConcept.name} — ${seed.protagonistConcept.situation}（性格：${seed.protagonistConcept.personality}，致命弱点：${seed.protagonistConcept.fatalFlaw}）
${seed.antagonistConcept ? `反派：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}（与主角关系：${seed.antagonistConcept.relationship}）` : ''}
调性：${seed.tone}
底线：${seed.redLines.join('；')}

=== 分段式规划 ===
1. arcOverview：全剧分4-6个段落（含 segmentTitle/startEp/endEp/coreConflict/paywallEpisodes）
2. detailedEpisodes：仅输出前 ${DETAIL_SEGMENT} 集的详细概要（后续段落由段落导演按需展开）
3. paywallEpisodes：全剧付费卡点集号列表
4. mainStoryGoal + endingDirection
5. 确保前3集足够抓人，首段节奏紧凑，付费卡点设计致命`,
      temperature: 0.5,
    });

    return this.normalize(raw as Record<string, unknown>, seed, targetEp);
  }

  private normalize(raw: Record<string, unknown>, seed: DramaSeed, targetEp: number): SeriesOutline {
    const root = this.obj(raw);
    const detailed = (Array.isArray(root.detailedEpisodes) ? root.detailedEpisodes : Array.isArray(root.episodes) ? root.episodes : []) as any[];
    const arcOverview = (Array.isArray(root.arcOverview) ? root.arcOverview : []) as any[];

    const episodes = detailed.slice(0, DETAIL_SEGMENT).map((ep: any, idx: number) => {
      const e = this.obj(ep);
      return {
        episodeNumber: typeof e.episodeNumber === 'number' ? e.episodeNumber : idx + 1,
        title: this.str(e.title) || `第${idx + 1}集`,
        coreConflict: this.str(e.coreConflict) || `第${idx + 1}集核心冲突`,
        cliffhanger: this.str(e.cliffhanger) || '',
        emotionalArc: this.str(e.emotionalArc) || '',
        keyCharacterIds: Array.isArray(e.keyCharacterIds) ? e.keyCharacterIds.map(String) : [],
        estimatedDurationSec: typeof e.estimatedDurationSec === 'number' ? e.estimatedDurationSec : seed.targetEpisodeDurationSec,
        isPaywall: !!e.isPaywall, paywallReason: this.str(e.paywallReason), arcSegmentId: this.str(e.arcSegmentId),
      };
    });

    // 后续集填充骨架（由 ArcDirector 按需展开）
    const allPw = new Set<number>(); // 从 arcOverview 收集 paywall
    arcOverview.forEach((seg: any) => (Array.isArray(seg.paywallEpisodes) ? seg.paywallEpisodes : []).forEach((n: number) => allPw.add(n)));
    while (episodes.length < targetEp) {
      const n = episodes.length + 1;
      const seg = arcOverview.find((s: any) => n >= (s.startEp ?? 0) && n <= (s.endEp ?? 999));
      episodes.push({
        episodeNumber: n, title: seg ? `${this.str(seg.segmentTitle)}-${n}` : `第${n}集`,
        coreConflict: '待展开', cliffhanger: '', emotionalArc: '',
        keyCharacterIds: [], estimatedDurationSec: seed.targetEpisodeDurationSec,
        isPaywall: allPw.has(n), paywallReason: '', arcSegmentId: this.str(seg?.segmentTitle ?? ''),
      });
    }

    const paywallEpisodes = Array.isArray(root.paywallEpisodes)
      ? (root.paywallEpisodes as any[]).filter((n): n is number => typeof n === 'number')
      : [...allPw, ...episodes.filter(e => e.isPaywall).map(e => e.episodeNumber)];

    this.logger.log(`大纲规划完成: ${targetEp}集 | 详细${Math.min(detailed.length, DETAIL_SEGMENT)}集 | 段落${arcOverview.length}个 | 付费点${paywallEpisodes.length}个`);
    return seriesOutlineSchema.parse({
      totalPlannedEpisodes: targetEp,
      mainStoryGoal: this.str(root.mainStoryGoal) || seed.coreConflict,
      endingDirection: this.str(root.endingDirection) || '主角完成逆袭，真相大白',
      episodes, paywallEpisodes: [...new Set(paywallEpisodes)],
    });
  }

  private obj(v: unknown): Record<string, unknown> { return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}; }
  private str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
}
