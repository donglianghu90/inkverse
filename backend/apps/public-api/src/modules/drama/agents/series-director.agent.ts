/**
 * 总导演 Agent — 根据种子规划全剧大纲 + 每集概要（含付费卡点标记）。
 * 产出：SeriesOutline（totalPlannedEpisodes + episodes[] + paywallEpisodes[]）
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { seriesOutlineSchema, SeriesOutline, DramaSeed } from '../schemas/drama-state.schemas';

const directorOutputSchema = z.object({ outline: seriesOutlineSchema });

@Injectable()
export class SeriesDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  async plan(seed: DramaSeed): Promise<SeriesOutline> {
    const epMin = seed.plannedTotalEpisodes.min;
    const epMax = seed.plannedTotalEpisodes.max;
    const targetEp = Math.round((epMin + epMax) / 2);
    const durSec = seed.targetEpisodeDurationSec;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-series-director',
      schema: directorOutputSchema,
      systemPrompt: `你是一位短剧总导演，擅长设计让观众追完全剧的"剧情过山车"。你的任务是将故事种子转化为完整的分集大纲。

=== 分集规划铁律 ===
1. 总集数：${targetEp} 集（浮动范围 ${epMin}-${epMax}），每集约 ${durSec} 秒
2. 前3集 = 生死线：第1集必须在开场15秒内建立核心冲突，第3集结尾必须有第一个大反转
3. 第8-15集之间设置第一个付费卡点（isPaywall=true）：必须卡在"观众最不能停下来"的位置
4. 之后每5-8集设置一个付费卡点，每个卡点都是悬念/反转的巅峰
5. 最后5集 = 终极高潮+大结局，节奏最密，反转最猛

=== 段落结构 ===
全剧分为4-6个段落（arcSegmentId标注），每段有独立的核心矛盾：
- 段落1（第1-15集）：建立+第一个大冲突+身份反差初露
- 段落2（第16-30集）：矛盾升级+新角色介入+第一次大反击
- 段落3（第31-50集）：全面对抗+真相碎片+关系裂变
- 段落4（第51-70集）：终极反转+最大危机+所有暗线汇聚
- 段落5（第71-${targetEp}集）：最终反击+大结局
（以上仅为参考，按实际剧情调整）

=== 每集概要要求 ===
每集必须包含：
- title：简短有力的集标题（如"打脸时刻""真相大白"）
- coreConflict：本集核心冲突（一句话，如"男主在宴会上被前妻当众羞辱"）
- cliffhanger：集末悬念（一句话，如"女主看到了不该看到的照片"）
- emotionalArc：情绪弧线（如"隐忍→爆发→留悬念"）
- keyCharacterIds：本集关键角色（用角色名，后续系统会映射为ID）
- estimatedDurationSec：预估时长（控制在 ${Math.round(durSec * 0.8)}-${Math.round(durSec * 1.2)} 秒）
- isPaywall：是否为付费卡点集
- paywallReason：如果是付费集，说明为什么卡在这里（如"身份即将揭露的前一刻"）

=== 节奏控制 ===
- 冲突密度曲线：不能一直高强度（观众疲劳），也不能平淡超过2集（观众流失）
- 节奏模式：2-3集紧张 → 1集缓冲（甜蜜/搞笑/日常）→ 再2-3集紧张 → 大爆发
- 每个段落结尾集必须是高潮集，为下个段落的付费卡点服务

所有输出简体中文。`,

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

要求：
1. outline.totalPlannedEpisodes = ${targetEp}
2. outline.episodes 数组包含全部 ${targetEp} 集的概要
3. outline.paywallEpisodes 列出所有付费卡点集号
4. outline.mainStoryGoal 一句话概括主线目标
5. outline.endingDirection 模糊的结局方向（允许后续调整）
6. 确保前3集足够抓人，付费卡点足够致命，结局足够震撼`,
      temperature: 0.5,
    });

    return this.normalize(raw as Record<string, unknown>, seed, targetEp);
  }

  private normalize(raw: Record<string, unknown>, seed: DramaSeed, targetEp: number): SeriesOutline {
    const root = this.obj(raw);
    const outlineRaw = this.obj(root.outline ?? root);
    const episodesRaw = Array.isArray(outlineRaw.episodes) ? outlineRaw.episodes : [];

    const episodes = episodesRaw.map((ep, idx) => {
      const e = this.obj(ep);
      return {
        episodeNumber: typeof e.episodeNumber === 'number' ? e.episodeNumber : idx + 1,
        title: this.str(e.title) || `第${idx + 1}集`,
        coreConflict: this.str(e.coreConflict) || `第${idx + 1}集核心冲突`,
        cliffhanger: this.str(e.cliffhanger) || '',
        emotionalArc: this.str(e.emotionalArc) || '',
        keyCharacterIds: Array.isArray(e.keyCharacterIds) ? e.keyCharacterIds.map(String) : [],
        estimatedDurationSec: typeof e.estimatedDurationSec === 'number' ? e.estimatedDurationSec : seed.targetEpisodeDurationSec,
        isPaywall: !!e.isPaywall,
        paywallReason: this.str(e.paywallReason),
        arcSegmentId: this.str(e.arcSegmentId),
      };
    });

    while (episodes.length < targetEp) {
      const n = episodes.length + 1;
      episodes.push({
        episodeNumber: n, title: `第${n}集`, coreConflict: '待规划',
        cliffhanger: '', emotionalArc: '', keyCharacterIds: [],
        estimatedDurationSec: seed.targetEpisodeDurationSec,
        isPaywall: false, paywallReason: '', arcSegmentId: '',
      });
    }

    const paywallEpisodes = Array.isArray(outlineRaw.paywallEpisodes)
      ? outlineRaw.paywallEpisodes.filter((n): n is number => typeof n === 'number')
      : episodes.filter(e => e.isPaywall).map(e => e.episodeNumber);

    return seriesOutlineSchema.parse({
      totalPlannedEpisodes: targetEp,
      mainStoryGoal: this.str(outlineRaw.mainStoryGoal) || seed.coreConflict,
      endingDirection: this.str(outlineRaw.endingDirection) || '主角完成逆袭，真相大白',
      episodes,
      paywallEpisodes,
    });
  }

  private obj(v: unknown): Record<string, unknown> { return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}; }
  private str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
}
