/**
 * 段落导演 — 管理段落进度 + 按需展开骨架集概要。
 * planOrRefresh: 规划/复用段落。expandEpisodeSynopses: 将骨架集补充为详细概要。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  arcSegmentSchema, ArcSegment, DramaState, EpisodeSynopsis, episodeSynopsisSchema,
} from '../../schemas/drama-state.schemas';
import { buildArcDirectorSystemPrompt, buildArcExpansionSystemPrompt, buildUserPromptConstraintsTail } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

const arcOutputSchema = z.object({ segment: arcSegmentSchema });
const expansionOutputSchema = z.object({ episodes: z.array(episodeSynopsisSchema) });

@Injectable()
export class ArcDirectorAgent {
  private readonly logger = new Logger(ArcDirectorAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async planOrRefresh(state: DramaState, episodeNumber: number): Promise<ArcSegment> {
    const current = state.currentArcSegment;
    if (current && episodeNumber <= current.endEpisode && current.status === 'active') return current;

    const recentSummaries = state.episodeSummaries.slice(-5).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');

    // P0-1 fix: 注入总导演的 detailedEpisodes 作为硬约束，防止段落导演覆写大纲
    const outlineEpisodes = state.seriesOutline?.episodes ?? [];
    const relevantEpisodes = outlineEpisodes.filter(
      ep => ep.episodeNumber >= episodeNumber && ep.coreConflict && ep.coreConflict !== '待展开',
    );
    const detailedEpisodesBlock = relevantEpisodes.length > 0
      ? `\n\n===== 总导演已有的详细分集大纲（硬约束，段落规划必须与此对齐） =====\n${relevantEpisodes.slice(0, 20).map(ep =>
        `E${ep.episodeNumber}「${ep.title}」：${ep.coreConflict}（情绪弧线：${ep.emotionalArc}，悬念：${ep.cliffhanger}）`,
      ).join('\n')}\n⚠️ 以上分集大纲已由总导演确定，段落规划的 startEpisode/endEpisode 范围和 coreConflict 必须覆盖并兼容这些集的内容，不得重新发明故事线。\n=====`
      : '';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-arc-director',
      schema: arcOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'arc-director', buildArcDirectorSystemPrompt({ genreArchetype: state.promptProfile?.genreArchetype, genreRules: state.promptProfile?.scriptwriterGuide?.genreRules, redLines: state.seed.redLines, arcDirectorGuide: state.promptProfile?.arcDirectorGuide ?? undefined })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber },
      userPrompt: `当前状态：
全剧标题：${state.seed.title}
已生成集数：${episodeNumber - 1}
全剧计划：${state.seriesOutline?.totalPlannedEpisodes ?? '未知'} 集
已完成段落数：${state.arcSegments.length}
${current ? `上一段落：${current.segmentTitle}（${current.startEpisode}-${current.endEpisode}集，矛盾：${current.coreConflict}）` : '尚无段落'}
最近剧情：\n${recentSummaries || '（暂无）'}
${state.storySoFar ? `全局剧情概要：\n${state.storySoFar.slice(0, 800)}` : ''}
上集悬念：${state.lastCliffhanger || '无'}
主角：${state.seed.protagonistConcept.name}
角色列表：${state.characters.map(c => c.name).join('、')}${detailedEpisodesBlock}

请为第 ${episodeNumber} 集开始的新段落做规划。segmentId 格式：arc_${state.arcSegments.length + 1}${buildUserPromptConstraintsTail({ redLines: state.seed.redLines })}`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const seg = typeof root.segment === 'object' && root.segment ? root.segment : root;
    const parsed = arcSegmentSchema.parse(seg);
    const expectedId = `arc_${state.arcSegments.length + 1}`;
    if (parsed.segmentId !== expectedId) {
      this.logger.warn(`segmentId 格式修正：「${parsed.segmentId}」→「${expectedId}」`);
      parsed.segmentId = expectedId;
    }
    return parsed;
  }

  /** 将骨架集（coreConflict='待展开'）展开为详细概要 */
  async expandEpisodeSynopses(state: DramaState, segment: ArcSegment, episodeNumbers: number[]): Promise<EpisodeSynopsis[]> {
    if (!episodeNumbers.length) return [];
    this.logger.log(`展开骨架集 E${episodeNumbers[0]}-E${episodeNumbers[episodeNumbers.length - 1]}`);
    const recentSummaries = state.episodeSummaries.slice(-5).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');
    const paywallSet = new Set(state.seriesOutline?.paywallEpisodes ?? []);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-arc-director',
      schema: expansionOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'arc-director', buildArcExpansionSystemPrompt({ genreArchetype: state.promptProfile?.genreArchetype, genreRules: state.promptProfile?.scriptwriterGuide?.genreRules, redLines: state.seed.redLines })),
      metadata: { dramaId: state.dramaId, userId: state.userId },
      userPrompt: `请为以下骨架集补充详细概要：

全剧：${state.seed.title}（${state.seed.genre}）
核心矛盾：${state.seed.coreConflict}
当前段落：${segment.segmentTitle}（E${segment.startEpisode}-E${segment.endEpisode}，矛盾：${segment.coreConflict}，情感主题：${segment.emotionalTheme}）
高潮集：E${segment.climaxEpisode}
角色目标：${segment.characterGoals.map(g => `${g.characterId}:${g.startState}→${g.endState}`).join('；')}

需展开集号：${episodeNumbers.join(',')}
其中付费集：${episodeNumbers.filter(n => paywallSet.has(n)).join(',') || '无'}

${state.storySoFar ? `全局概要：\n${state.storySoFar.slice(0, 600)}` : ''}
最近剧情：\n${recentSummaries || '（暂无）'}
上集悬念：${state.lastCliffhanger || '无'}
可用角色：${state.characters.map(c => `${c.characterId}(${c.name})`).join('、')}

每集必须包含：title/coreConflict/cliffhanger/emotionalArc/keyCharacterIds/estimatedDurationSec=${state.seed.targetEpisodeDurationSec}${buildUserPromptConstraintsTail({ redLines: state.seed.redLines })}`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const eps = Array.isArray(root.episodes) ? root.episodes : [];
    return eps.map((e: any, i: number) => {
      const epNum = episodeNumbers[i] ?? (typeof e.episodeNumber === 'number' ? e.episodeNumber : episodeNumbers[0] + i);
      return episodeSynopsisSchema.parse({ ...e, episodeNumber: epNum, isPaywall: paywallSet.has(epNum) || !!e.isPaywall });
    });
  }
}
