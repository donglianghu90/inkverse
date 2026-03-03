/**
 * 集导演 — 根据大纲+段落+上下文+质量反馈生成 EpisodeIntent，决定本集方向。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeIntentSchema, EpisodeIntent, DramaState, EpisodeSynopsis,
} from '../schemas/drama-state.schemas';
import { buildEpisodeDirectorSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const intentOutputSchema = z.object({ intent: episodeIntentSchema });

@Injectable()
export class EpisodeDirectorAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async direct(state: DramaState, synopsis: EpisodeSynopsis, contextInjections?: string[]): Promise<EpisodeIntent> {
    const epNum = synopsis.episodeNumber;
    const recentSummaries = state.episodeSummaries.slice(-5).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');
    const chars = state.characters.map(c => `${c.characterId}(${c.name}): ${c.defaultCostume}${c.variations?.length ? ` [变体:${c.variations.map(v => v.name).join(',')}]` : ''}`).join('\n');
    const nameToId = new Map(state.characters.map(c => [c.name, c.characterId]));
    const mappedKeyChars = synopsis.keyCharacterIds.map(k => nameToId.get(k) ?? k);

    // 质量弱项分析：从最近3集的维度评分中提取具体改进方向
    const qualityFeedback = this.extractQualityFeedback(state.kpiHistory.slice(-3));

    const raw = await this.llm.generateStructured({
      taskName: 'drama-episode-director',
      schema: intentOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'episode-director', buildEpisodeDirectorSystemPrompt({ maxPresentPerEpisode: state.strategy?.characterBudget?.maxPresentPerEpisode })),
      userPrompt: `本集信息：
第 ${epNum} 集：${synopsis.title}
核心冲突：${synopsis.coreConflict}
集末悬念：${synopsis.cliffhanger}
情绪弧线：${synopsis.emotionalArc}
关键角色ID：${mappedKeyChars.join('、')}
是否付费集：${synopsis.isPaywall ? '是' : '否'}
${synopsis.isPaywall ? `付费原因：${synopsis.paywallReason}` : ''}

上下文：
上集悬念：${state.lastCliffhanger || '无（第一集）'}
最近剧情：\n${recentSummaries || '（第一集，无前情）'}
${state.storySoFar ? `全局概要：\n${state.storySoFar.slice(0, 600)}` : ''}
${state.currentArcSegment ? `当前段落：${state.currentArcSegment.segmentTitle}（矛盾：${state.currentArcSegment.coreConflict}，情感主题：${state.currentArcSegment.emotionalTheme}）` : ''}
${state.strategy?.coreNarrativeContract ? `叙事契约：${state.strategy.coreNarrativeContract}` : ''}

${qualityFeedback ? `=== 质量反馈（前几集弱项，规划意图时务必针对性加强） ===\n${qualityFeedback}` : ''}

可用角色：\n${chars}
可用场景：${state.locations.map(l => `${l.locationId}(${l.name})`).join('、')}
${contextInjections?.length ? `\n连续性约束（必须遵守）：\n${contextInjections.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}

请生成本集的详细意图。activeCharacters 中的 characterId 必须使用上面"可用角色"中的 characterId。`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const intent = typeof root.intent === 'object' && root.intent ? root.intent : root;
    return episodeIntentSchema.parse(intent);
  }

  /** 从最近KPI中提取持续弱项维度，生成集导演级改进指令 */
  private extractQualityFeedback(kpiHistory: Array<{ episodeNumber?: number; overallScore?: number; dimensions?: Record<string, number> }>): string {
    if (!kpiHistory.length) return '';
    const dimSums: Record<string, { total: number; count: number }> = {};
    kpiHistory.forEach(k => Object.entries(k.dimensions ?? {}).forEach(([dim, score]) => {
      if (!dimSums[dim]) dimSums[dim] = { total: 0, count: 0 };
      dimSums[dim].total += score; dimSums[dim].count++;
    }));
    const weakOnes = Object.entries(dimSums)
      .map(([dim, { total, count }]) => ({ dim, avg: total / count }))
      .filter(d => d.avg < 7)
      .sort((a, b) => a.avg - b.avg);
    if (!weakOnes.length) return '';
    const actionMap: Record<string, string> = {
      visualImpact: '规划更多视觉冲击场景（特写、对比、空间转换）',
      dialogueNaturalness: '减少台词密度，增加动作叙事，台词更口语化',
      pacing: '调整场景节奏，避免信息密度均匀化，制造快慢交替',
      hookStrength: '设计更强的集末悬念，考虑信息差/反转/新危机',
      consistency: '注意与前集的情节衔接和角色行为一致性',
      emotionalImpact: '增加情感爆发点，用沉默/表情/环境渲染情绪',
    };
    return weakOnes.map(w =>
      `⚠ ${w.dim} 平均${w.avg.toFixed(1)}分 → ${actionMap[w.dim] || '请针对性提升'}`,
    ).join('\n');
  }
}
