/**
 * 集导演 — 根据大纲+段落+上下文+质量反馈生成 EpisodeIntent，决定本集方向。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  episodeIntentSchema, EpisodeIntent, DramaState, EpisodeSynopsis,
} from '../../schemas/drama-state.schemas';
import { buildEpisodeDirectorSystemPrompt, buildUserPromptConstraintsTail } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';
import { DramaCalibrationService } from '../../workflow/drama-calibration.service';
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';


const intentOutputSchema = z.object({ _thoughtProcess: z.string().describe('分析出场角色分配、多巴胺爽点调度逻辑、以及如何铺垫即将到来的付费卡点'), intent: episodeIntentSchema });

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
    // 只向导演展示 series/arc 级别的常驻角色，episode 级临时角色应已在上集归档
    const chars = state.characters
      .filter(c => c.scope !== 'episode')
      .map(c => `${c.characterId}(${c.name}): ${c.defaultCostume}${c.variations?.length ? ` [变体:${c.variations.map(v => v.name).join(',')}]` : ''}`)
      .join('\n');
    // 可复用临时角色池（最近10个，按最后使用集降序）
    const recentPool = [...(state.minorRolePool ?? [])]
      .sort((a, b) => b.lastUsedEpisode - a.lastUsedEpisode)
      .slice(0, 10);
    const poolHint = recentPool.length > 0
      ? `\n可复用的历史临时角色池（若本集情境相符，直接在 activeCharacters 中使用相同 characterId 即可，无需在 proposedNewCharacters 中重新声明）：\n` +
        recentPool.map(p => {
          const face = p.identity.faceDescription?.slice(0, 40) ?? '';
          const costume = p.identity.defaultCostume?.slice(0, 30) ?? '';
          return `- ${p.characterId}(${p.name}): 曾出现于E${p.usedInEpisodes.join('/')}，${face}${costume ? '，' + costume : ''}`;
        }).join('\n')
      : '';
    const nameToId = new Map(state.characters.map(c => [c.name, c.characterId]));
    const mappedKeyChars = synopsis.keyCharacterIds.map(k => nameToId.get(k) ?? k);

    // 新角色外观设计的题材/视觉基准，确保与主角视觉风格一致
    const visualAnchor = (() => {
      const parts: string[] = [];
      if (state.seed?.genre) parts.push(`题材：${state.seed.genre}`);
      const vs = state.visualStyle;
      if (vs?.overallAesthetic) parts.push(`整体美学：${vs.overallAesthetic}`);
      if (vs?.colorGrading) parts.push(`色调：${vs.colorGrading}`);
      if (vs?.lightingStyle) parts.push(`光影：${vs.lightingStyle}`);
      if (vs?.textureStyle) parts.push(`质感：${vs.textureStyle}`);
      const factConstraint = state.promptProfile?.genreArchetype?.factConstraint;
      if (factConstraint === 'period_accurate') parts.push('史实约束：必须符合历史服饰/道具，禁止现代元素');
      else if (factConstraint === 'inspired_by') parts.push('风格约束：以历史为灵感，可有艺术化夸张但不能有现代元素');
      // 取第一个主角的 faceReferencePrompt 作为视觉参考锚点（渲染风格一致）
      const protagonist = state.characters.find(c => c.role === 'protagonist');
      if (protagonist?.faceReferencePrompt) {
        parts.push(`参考渲染风格（与主角一致）：${protagonist.faceReferencePrompt.slice(0, 80)}`);
      }
      return parts.length ? parts.join(' | ') : '';
    })();

    // 质量弱项分析：从最近3集的维度评分中提取具体改进方向
    const qualityFeedback = this.calibration.extractWeakDimensionFeedback(state.kpiHistory.slice(-3), 'action');

    // 多巴胺调度提示：告知导演当前观众"爽感亏欠"程度（知识模式下跳过）
    const dopa = state.dopamineSchedule;
    const dopaHint = dopa ? (() => {
      const lines: string[] = [];
      if (dopa.episodesSinceMajor >= 4) lines.push(`⚡ 已连续 ${dopa.episodesSinceMajor} 集无重大爽感释放（核心情绪高潮/重大冲突释放），本集必须安排一个 major 级高潮点`);
      else if (dopa.episodesSinceMajor >= 2) lines.push(`注意：距上次重大高潮点已 ${dopa.episodesSinceMajor} 集，本集可积累张力，下1-2集需爆发`);
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
      taskName: DRAMA_AGENT_REGISTRY.EPISODE_DIRECTOR.key,
      schema: intentOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'episode-director', buildEpisodeDirectorSystemPrompt({ maxPresentPerEpisode: state.strategy?.characterBudget?.maxPresentPerEpisode, genreArchetype: state.promptProfile?.genreArchetype, visualStyle: state.visualStyle ?? undefined, genreRules: state.promptProfile?.scriptwriterGuide?.genreRules, episodeDirectorGuide: state.promptProfile?.episodeDirectorGuide ?? undefined })),
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
可用角色：\n${chars}${poolHint}
可用场景：${state.locations.map(l => `${l.locationId}(${l.name})`).join('、')}
${contextInjections?.length ? `\n连续性约束（必须遵守）：\n${contextInjections.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : ''}
${prePaywallHint}
请先在 _thoughtProcess 中反思本集的受众多巴胺预期、即将到来的付费卡点铺垫节奏、以及角色的出场调度，再生成本集的详细意图 intent。

=== activeCharacters 选角规则 ===
activeCharacters 包含本集所有出场角色，来源分三类：
① 直接复用：使用"可用角色"列表中已有的 characterId（主角/配角）
② 复用临时角色池：使用"可复用的历史临时角色池"中的 characterId（相同 characterId，无需在 proposedNewCharacters 中重新声明）
③ 声明全新角色：若①②都没有合适的，先在 proposedNewCharacters 中声明，然后同一个 characterId 也必须出现在 activeCharacters 中

=== proposedNewCharacters 填写规范（⚠️ 极其重要）===
${visualAnchor ? `本剧视觉基准（所有新角色的 appearanceHint 必须与此一致）：${visualAnchor}\n` : ''}⚠️ 铁律：所有在本集中有台词的角色（无论重要性）都必须声明在 proposedNewCharacters 中。
包括功能性角色（如考官、守卫、信使、店小二、旁人），哪怕只有一句台词也必须声明。
只有完全无台词的路人背景可以不注册。未注册的角色ID将导致后续配音/生图/分镜系统阻断。

每个全新角色需要：
- characterId：简短英文ID（如 exam_official / guard_01 / waiter），同集内不同角色不能重复
- name：中文角色名（如"主考官""宫门侍卫""街头老者"）
- role：'minor'（功能性角色/群演，无独立剧情线）或 'supporting'（有台词且推动剧情的配角）
- narrativePurpose：该角色在本集的叙事作用（一句话说清楚，如"宣读科举资格，制造体制否定冲突"）
- appearanceHint：【必须包含】面部特征 + 体型 + 服饰三部分，风格须与上方"本剧视觉基准"严格一致，禁止模糊描述（禁止"一个士兵""普通路人"）
- hasDialogue：是否有台词（决定后续是否需要配音设计）
- scope：'episode'（本集临时，不再复用）或 'arc'（段落内可能复用）——默认填 'episode'
${state.isSeriesFinale ? `\n🏁 【大结局模式】这是全剧最后一集！\n- 本集必须解决所有核心矛盾，给观众完整的叙事闭合\n- hookDirection 改为"余韵式结尾"——不留悬念，而是给观众值得回味的画面/台词\n- 所有主要角色的情感弧线在本集收束\n- 最后2-3个主镜设计为"终章仪式感"——慢节奏、大画面、重要台词\n- 禁止使用 cliffhanger 类悬念` : ''}
额外要求：
1. masterShotPlan 至少输出 6 条，按叙事顺序排列。
2. 每条主镜都要满足"一镜一动作"，actionVerb 必须是单动词（如 reveal/confront/strike/turn）。
3. minDurSec <= maxDurSec，且建议落在 1.5-8 秒区间。${buildUserPromptConstraintsTail({ redLines: state.seed.redLines, genreRules: state.promptProfile?.scriptwriterGuide?.genreRules })}`,
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
