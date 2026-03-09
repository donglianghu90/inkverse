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
import { DramaCalibrationService } from '../drama-calibration.service';

const intentOutputSchema = z.object({ intent: episodeIntentSchema });

@Injectable()
export class EpisodeDirectorAgent {
  constructor(
    private readonly llm: LlmService,
    private readonly promptService: DramaPromptTemplateService,
    private readonly calibration: DramaCalibrationService,
  ) {}

  async direct(state: DramaState, synopsis: EpisodeSynopsis, contextInjections?: string[]): Promise<EpisodeIntent> {
    const epNum = synopsis.episodeNumber;
    const recentSummaries = state.episodeSummaries.slice(-5).map(s => `E${s.episodeNumber}: ${s.summary}`).join('\n');
    const chars = state.characters.map(c => `${c.characterId}(${c.name}): ${c.defaultCostume}${c.variations?.length ? ` [变体:${c.variations.map(v => v.name).join(',')}]` : ''}`).join('\n');
    const nameToId = new Map(state.characters.map(c => [c.name, c.characterId]));
    const mappedKeyChars = synopsis.keyCharacterIds.map(k => nameToId.get(k) ?? k);

    // 质量弱项分析：从最近3集的维度评分中提取具体改进方向
    const qualityFeedback = this.calibration.extractWeakDimensionFeedback(state.kpiHistory.slice(-3), 'action');

    // 多巴胺调度提示：告知导演当前观众"爽感亏欠"程度（知识模式下跳过）
    const dopa = state.dopamineSchedule;
    const dopaHint = dopa ? (() => {
      const lines: string[] = [];
      if (dopa.episodesSinceMajor >= 4) lines.push(`⚡ 已连续 ${dopa.episodesSinceMajor} 集无重大爽感释放（打脸/反转/高潮），本集必须安排一个 major 级爽点`);
      else if (dopa.episodesSinceMajor >= 2) lines.push(`注意：距上次重大爽点已 ${dopa.episodesSinceMajor} 集，本集可积累张力，下1-2集需爆发`);
      if (dopa.episodesSinceMinor >= 2) lines.push(`⚠ 已连续 ${dopa.episodesSinceMinor} 集无小爽感，本集至少需要 1 个 minor 级满足感`);
      return lines.length ? `\n=== 观众多巴胺状态 ===\n${lines.join('\n')}` : '';
    })() : '';

    // 付费前预热提示：让导演知道即将到来的付费卡点，提前积累张力（知识模式下跳过）
    const paywalls = state.seriesOutline?.paywallEpisodes ?? [];
    const nextPaywall = paywalls.find(p => p >= epNum);
    const prePaywallHint = (() => {
      
      if (!nextPaywall) return '';
      const dist = nextPaywall - epNum;
      if (dist === 0) return '';
      if (dist === 1) return `\n🔥 下一集（E${nextPaywall}）是付费卡点：本集必须把张力拉到顶点，让观众在结尾时不得不付费解锁。`;
      if (dist === 2) return `\n📈 E${nextPaywall} 是付费卡点（还差2集）：本集开始升温，埋入关键矛盾伏笔，让观众感到"事情要爆了"。`;
      return '';
    })();

    const raw = await this.llm.generateStructured({
      taskName: 'drama-episode-director',
      schema: intentOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'episode-director', buildEpisodeDirectorSystemPrompt({ maxPresentPerEpisode: state.strategy?.characterBudget?.maxPresentPerEpisode, genreArchetype: state.promptProfile?.genreArchetype })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: epNum },
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
${state.strategy?.coreNarrativeContract ? `叙事契约：${state.strategy.coreNarrativeContract}` : ''}${dopaHint}

${qualityFeedback ? `=== 质量反馈（前几集弱项，规划意图时务必针对性加强） ===\n${qualityFeedback}` : ''}
${this.calibration.buildCalibrationHint(state)}
可用角色：\n${chars}
可用场景：${state.locations.map(l => `${l.locationId}(${l.name})`).join('、')}
${contextInjections?.length ? `\n连续性约束（必须遵守）：\n${contextInjections.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}
${prePaywallHint}
请生成本集的详细意图。activeCharacters 中的 characterId 必须使用上面"可用角色"中的 characterId。
${state.isSeriesFinale ? `\n🏁 【大结局模式】这是全剧最后一集！\n- 本集必须解决所有核心矛盾，给观众完整的叙事闭合\n- hookDirection 改为"余韵式结尾"——不留悬念，而是给观众值得回味的画面/台词\n- 所有主要角色的情感弧线在本集收束\n- 最后2-3个主镜设计为"终章仪式感"——慢节奏、大画面、重要台词\n- 禁止使用 cliffhanger 类悬念` : ''}
额外要求：
1. masterShotPlan 至少输出 6 条，按叙事顺序排列。
2. 每条主镜都要满足“一镜一动作”，actionVerb 必须是单动词（如 reveal/confront/strike/turn）。
3. minDurSec <= maxDurSec，且建议落在 1.5-8 秒区间。`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const intent = typeof root.intent === 'object' && root.intent ? root.intent : root;
    const parsed = episodeIntentSchema.parse(intent);
    return this.ensureMasterShotPlan(parsed, synopsis);
  }

  private ensureMasterShotPlan(intent: EpisodeIntent, synopsis: EpisodeSynopsis): EpisodeIntent {
    const current = (intent.masterShotPlan ?? []).filter((s) => s.beatId && s.actionVerb);
    const minCount = 6;
    if (current.length >= minCount) return intent;

    const baseGoals = intent.goals.length
      ? intent.goals
      : [synopsis.coreConflict, synopsis.cliffhanger, intent.hookDirection].filter(Boolean);
    const fallbackSize = Math.max(minCount, Math.min(10, baseGoals.length || minCount));
    const fillerVerbs = ['reveal', 'confront', 'turn', 'pause', 'strike', 'hold', 'discover', 'react'];
    const fallback = Array.from({ length: fallbackSize }).map((_, i) => {
      const goal = baseGoals[i] ?? baseGoals[baseGoals.length - 1] ?? `${synopsis.title}关键节点${i + 1}`;
      const verb = fillerVerbs[i % fillerVerbs.length];
      const isEnding = i === fallbackSize - 1;
      return {
        beatId: `ep${intent.episodeNumber}_beat_${i + 1}`,
        visualGoal: goal,
        emotionGoal: isEnding ? intent.hookDirection : intent.emotionDirection,
        actionVerb: verb,
        minDurSec: isEnding ? 1.5 : 2,
        maxDurSec: isEnding ? 4 : 6,
      };
    });
    return { ...intent, masterShotPlan: current.length ? [...current, ...fallback.slice(current.length)] : fallback };
  }
}
