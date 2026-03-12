/** 场景规划师 — 将章节意图拆分为可独立执行的场景契约（数量随章节类型动态调整）。 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import {
  ChapterIntent,
  ChapterScenePlan,
  StoryState,
  ArcDirectorDirective,
  chapterScenePlanSchema,
} from '../../schemas/novel-state.schemas';
import {
  THREAD_AWARENESS_PLAYBOOK,
  buildCompactContextProse,
  buildKpiTrendHints,
  UNIFIED_AGENT_MAX_CHARACTERS,
} from '../../prompting/novel-playbook';
import { mapBeatRoleToChapterType } from '../../prompting/chapter-type.utils';
import { buildAudiencePromptBlock } from '../../prompting/audience-directive';

@Injectable()
export class ScenePlannerAgent {
  private readonly logger = new Logger(ScenePlannerAgent.name);
  private static readonly DEFAULT_FOCUS_MOMENT_HINT = '在关键动作或对话里暴露该角色当下真实立场与代价感';
  private static readonly COMMERCIAL_SCENE_COUNT_GUIDE: Record<string, string> = {
    setup: '- setup（铺垫章）：3-4场景，信息密度均匀，最后场景必须抛出悬念',
    rising: '- rising（升温章）：3-4场景，均匀分配，每场景推进一层冲突',
    climax: '- climax（高潮章）：4-5场景，铺垫15%→升温25%→爆发35%→余波15%→钩子10%',
    relief: '- relief（缓冲章）：2-3场景即可，场景更长更沉浸，侧重角色深度和日常质感',
    general: '- general（通用章）：3-4场景，灵活分配',
  };
  private static readonly LITERARY_SCENE_COUNT_GUIDE: Record<string, string> = {
    setup: '- setup：3-4场景，铺垫信息与情绪暗流并行',
    rising: '- rising：3-4场景，逐层升压，冲突或心理张力递进',
    climax: '- climax：4-5场景，爆发后保留余韵与代价',
    relief: '- relief：2-3场景，慢节奏恢复与关系深化',
    introspective: '- introspective（内省章）：1-3场景，允许整章单场景聚焦内心世界',
    fragmentary: '- fragmentary（碎片章）：4-8个短场景（碎片），每个200-500字',
    atmospheric: '- atmospheric（氛围章）：2-3场景，节奏极慢，感官密度高',
    general: '- general：2-4场景，灵活分配',
  };
  private static readonly CHAPTER_PURPOSE_GUIDE: Record<string, string> = {
    setup: '推荐 purpose 组合：hook_opening → revelation/dialogue_driven → emotional/transition → cliffhanger。\n重点是建立问题与预期，不急于兑现终局答案。',
    rising: '推荐 purpose 组合：hook_opening → conflict/action → revelation/emotional → climax/cliffhanger。\n每个场景都要有冲突增量或代价增量。',
    climax: '推荐 purpose 组合：hook_opening(短) → conflict/action → climax（核心爆发）→ emotional/revelation（余波）→ cliffhanger。\n核心是正面碰撞与后果落地。',
    relief: '推荐 purpose 组合：transition/emotional → dialogue_driven/revelation → cliffhanger（轻钩子）。\n重点是修复情绪、深化关系、暗线前推。',
    introspective: '推荐 purpose 组合：introspection/emotional 为主，可少量 transition。\n核心是内在冲突与认知变化，不强制外部大事件。',
    fragmentary: '推荐 purpose 组合：fragmentary 短场景串联，可混合 revelation/emotional。\n每个碎片必须提供一块拼图。',
    atmospheric: '推荐 purpose 组合：atmospheric + emotional，少量 thematic。\n氛围与感官是叙事主体，动作推进从属于情绪波纹。',
    general: '推荐 purpose 组合：hook_opening → conflict/revelation → emotional/transition → cliffhanger。',
  };

  constructor(private readonly llm: LlmService) {}

  private resolveChapterType(state: StoryState, intent: ChapterIntent): string {
    const beatRole = state.currentArc?.chapterBeats?.find((b) => b.chapterNumber === intent.chapterNumber)?.role;
    return mapBeatRoleToChapterType(beatRole) ?? 'general';
  }

  private buildSceneCountGuide(
    chapterType: string,
    writingMode: StoryState['seed']['writingMode'],
    rawGuide?: string,
  ): string {
    const source = (rawGuide ?? '').trim();
    if (source.length > 0) {
      const aliasMap: Record<string, string[]> = {
        setup: ['setup'],
        rising: ['rising', 'escalation'],
        climax: ['climax', 'twist'],
        relief: ['relief', 'aftermath', 'transition'],
        introspective: ['introspective', 'introspection'],
        fragmentary: ['fragmentary'],
        atmospheric: ['atmospheric'],
        general: ['general'],
      };
      const aliases = aliasMap[chapterType] ?? [chapterType];
      const lines = source.split('\n');
      const intro: string[] = [];
      const selected: string[] = [];
      let sawBullet = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('-')) {
          sawBullet = true;
          const lower = trimmed.toLowerCase();
          if (aliases.some((a) => lower.includes(a.toLowerCase()))) selected.push(line);
        } else if (!sawBullet) {
          intro.push(line);
        }
      }
      if (selected.length > 0) return [...intro, ...selected].join('\n');
    }
    const table = writingMode === 'literary'
      ? ScenePlannerAgent.LITERARY_SCENE_COUNT_GUIDE
      : ScenePlannerAgent.COMMERCIAL_SCENE_COUNT_GUIDE;
    return [
      '根据当前章节类型动态调整（只执行当前章型）：',
      table[chapterType] ?? table.general,
    ].join('\n');
  }

  private buildPurposeGuide(chapterType: string, rawGuide?: string): string {
    const source = (rawGuide ?? '').trim();
    if (source.length > 0) return source;
    return ScenePlannerAgent.CHAPTER_PURPOSE_GUIDE[chapterType] ?? ScenePlannerAgent.CHAPTER_PURPOSE_GUIDE.general;
  }

  async plan(
    state: StoryState,
    intent: ChapterIntent,
    arcDirective?: ArcDirectorDirective,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterScenePlan> {
    const proseContext = buildCompactContextProse(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 4,
      maxOpenThreads: 8,
      maxTimelineEvents: 10,
    });

    const totalWords = intent.wordCountRange.max;
    const kpiHints = buildKpiTrendHints(state);
    const profile = state.bookPromptProfile;
    const chapterType = this.resolveChapterType(state, intent);
    const sceneCountGuide = playbooks?.['CHAPTER_TYPE_SCENE_PLAN_PLAYBOOK']?.trim()
      || this.buildSceneCountGuide(chapterType, state.seed.writingMode, playbooks?.['agent:scene-planner:scene_count_guide']);
    const purposeGuide = playbooks?.['CHAPTER_TYPE_SCENE_PURPOSE_PLAYBOOK']?.trim()
      || this.buildPurposeGuide(chapterType, playbooks?.['agent:scene-planner:purpose_guide']);

    const voiceHints = state.characters
      .filter((c) => intent.characterAvailability.activeCharacterIds.includes(c.id) && c.voice?.speechPattern)
      .slice(0, 5)
      .map((c) => `${c.name}: ${c.voice!.speechPattern}`)
      .join('；');

    const gapHints = ((state.informationLedger ?? { activeGaps: [] }).activeGaps)
      .slice(0, 3)
      .map((g) => `[${g.type}] ${g.secret}（${g.knownBy.join(',')}知道，${g.unknownTo.join(',')}不知道）`)
      .join('\n');

    const plan = await this.llm.generateStructured({
      taskName: 'scene-planner',
      schema: chapterScenePlanSchema,
      tags: ['workflow', 'chapter', 'scene-plan'],
      metadata: { userId: state.userId, bookId: state.bookId, chapterNumber: intent.chapterNumber, chapterType },
      systemPrompt: `${playbooks?.['agent:scene-planner:role'] ?? (state.seed.writingMode === 'literary'
        ? '你是一位兼具文学敏感度与场景感的导演。你的任务是把"章节意图"拆成场景，每个场景有明确的叙事/情感/主题任务——可以是外部冲突，也可以是内在探索。'
        : '你是一位擅长场景拆分的网文导演。你的任务是把"章节意图"拆成独立场景，每个场景有明确的叙事任务。')}

=== 核心原则 ===
${playbooks?.['agent:scene-planner:principles'] ?? '1. 每个场景是一个"微型故事"——有自己的入口情绪、冲突、转折、出口情绪。\n2. 场景之间的情绪变化构成章内弧线——不能平坦，要有起伏。\n3. 第一场景必须承接上章钩子+建立本章张力。最后一场景必须制造下章驱动力。\n4. 视角(POV)切换要有意义——切到另一个角色是为了利用信息差或展示不同立场。'}

=== 当前章节类型 ===
${chapterType}

=== 场景数量指南 ===
${sceneCountGuide}

=== 场景分配策略（字数硬约束）===
- 全章总字数硬上限 ${totalWords}字，所有场景 estimatedWords 之和必须 ≤ ${totalWords}
- 分配比例：高潮/核心场景35-40%，其他场景均分余量，过渡场景≤15%
- 禁止每个场景都分1000+字——这会导致总字数爆炸
- 3场景时单场景上限约 ${Math.round(totalWords * 0.45)}字，4场景约 ${Math.round(totalWords * 0.35)}字
- 优先安排角色内心场景（不是"发展角色"，是"展示他面对XX时的真实反应"）和对话驱动场景——但具体是否需要取决于本章意图，纯动作/纯悬疑章节可以例外
- 高潮章可以有1个"战斗/动作"场景，用 breakneck 节奏

=== purpose 选择指南 ===
${purposeGuide}

=== transitionHint ===
${playbooks?.['agent:scene-planner:transition_hint'] ?? '好的过渡：用环境描写做视角切换、因果链、时间推移自然嵌入行动。\n坏的过渡：硬切，读者感觉被强行拖走。'}

=== 感官桥接（sensoryEndState）===
${playbooks?.['agent:scene-planner:sensory_bridge'] ?? '每个场景结束时描述感官状态：timeOfDay, weather, ambientSound, dominantSense。确保场景过渡时感官连续。'}

=== 伏线分配 ===
每个场景可以顺带处理1-2条伏线（touch/advance/payoff/seed），总量不超过意图中的maxNewThreads限制。

=== 场景细节要求 ===
- subtext (潜台词)：角色表面在做什么，内心真正在想什么，或者话语背后的真实意图。制造张力。
- sensoryAnchors (感官锚定)：提供1-3个具体的感官细节（如"生锈的铁腥味"、"刺骨的寒风"），逼迫Writer进行具体描写，消除AI味。
- isParallel (并发生成)：如果本场景与上一场景是两条平行的故事线（如双线叙事、不同地点的同时发生），设为 true，系统将并发生成它们以提升速度。否则设为 false。

${profile.writerGuide.genreRules.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n')}
${buildAudiencePromptBlock(state)}
${playbooks?.['__bookStrategy'] ?? ''}
${playbooks?.['__policySlice'] ?? ''}
${playbooks?.['THREAD_AWARENESS_PLAYBOOK'] ?? THREAD_AWARENESS_PLAYBOOK}
${kpiHints.length > 0 ? '\n动态提示：\n' + kpiHints.join('\n') : ''}${additionalSystemPrompt ? '\n\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `故事上下文：
${proseContext}

本章意图（第${intent.chapterNumber}章）：
- 目标：${intent.goals.join('；')}
- 情绪方向：${intent.emotionDirection}
- 承接上章：${intent.carryoverFromLastChapter}
- 钩子方向：${intent.hookDirection}
- 总字数：${intent.wordCountRange.min}-${intent.wordCountRange.max}
- 伏线：新坑不超过${intent.threadGuidance.maxNewThreads}条。${intent.threadGuidance.advice}
- 可用角色：${intent.characterAvailability.activeCharacterIds.join(',')}
- 禁止出场：${intent.characterAvailability.blockedCharacterIds.join(',') || '无'}
${intent.characterArcGuidance.arcHints.length > 0 ? `- 角色弧线：${intent.characterArcGuidance.arcHints.map((h) => `${h.characterName}[${h.priority}]: ${h.hint}`).join('；')}` : ''}
${voiceHints ? `- 角色声音：${voiceHints}` : ''}
${gapHints ? `\n信息差：\n${gapHints}` : ''}
${arcDirective ? `\n卷级指令：阶段=${arcDirective.arcStage}，使命=${arcDirective.chapterMission}，节奏=${arcDirective.pacingDirective || '无'}` : ''}
${(() => {
  const fs = state.feedbackState;
  if (!fs?.lastAnalysis || fs.confidence === 'none' || fs.confidence === 'stale') return '';
  const a = fs.lastAnalysis;
  const lines: string[] = [];
  const prefs = a.bookLevel.sceneTypePreferences.filter((p) => p.preference === 'love' || p.preference === 'like');
  const avoid = a.bookLevel.sceneTypePreferences.filter((p) => p.preference === 'dislike' || p.preference === 'hate');
  if (prefs.length) lines.push(`读者偏好场景类型（参考）：${prefs.map((p) => p.sceneType).join('、')}`);
  if (avoid.length) lines.push(`读者不喜欢的场景类型（参考）：${avoid.map((p) => p.sceneType).join('、')}`);
  if (a.arcLevel.pacingVerdict !== 'good') lines.push(`读者对节奏的反馈：${a.arcLevel.pacingVerdict}（仅供参考，以叙事使命为准）`);
  return lines.length ? '\n读者反馈参考（不可牺牲叙事完整性迎合）：\n' + lines.join('\n') : '';
})()}

请根据章节类型拆分为合理数量的场景（参考场景数量指南），每个场景的 sceneId 格式为 "s_章号_序号"（如 s_${intent.chapterNumber}_0）。
overallEmotionalArc 要描述读者情绪变化曲线（如"好奇→紧张→震惊→沉默→期待"）。
hookStrategy 要具体说明末场景如何制造钩子。`,
      temperature: 0.5,
    });
    return this.enforceHardConstraints(state, intent, plan, playbooks);
  }

  private enforceHardConstraints(
    state: StoryState,
    intent: ChapterIntent,
    plan: ChapterScenePlan,
    playbooks?: Record<string, string>,
  ): ChapterScenePlan {
    const focusMomentHint = playbooks?.['agent:scene-planner:focus_moment_hint'] ?? ScenePlannerAgent.DEFAULT_FOCUS_MOMENT_HINT;
    const activeIds = new Set(intent.characterAvailability.activeCharacterIds ?? []);
    const blockedIds = new Set(intent.characterAvailability.blockedCharacterIds ?? []);
    const strategyMax = state.bookStrategy?.threadPolicy?.maxNewThreadsPerChapter;
    const maxSeeds = Math.max(
      0,
      Math.min(intent.threadGuidance.maxNewThreads, typeof strategyMax === 'number' ? strategyMax : intent.threadGuidance.maxNewThreads),
    );
    const preferredActions = new Set(state.bookStrategy?.threadPolicy?.preferredActions ?? []);
    const coreFocus = (state.bookStrategy?.characterFocusPolicy?.coreCharacterIds ?? []).filter((id) => activeIds.has(id));
    const supportFocus = (state.bookStrategy?.characterFocusPolicy?.supportCharacterIds ?? []).filter((id) => activeIds.has(id));
    const focusCandidates = [...coreFocus, ...supportFocus, ...Array.from(activeIds)];

    const mentionOnlyIds = new Set(
      state.characters.filter((c) => c.status.lifecycleStatus === 'fading' && c.status.maxSceneRole === 'mention_only').map((c) => c.id),
    );
    let seedCount = 0;
    const scenes = plan.scenes.map((scene) => {
      const present = scene.presentCharacterIds.filter((id) => activeIds.has(id) && !blockedIds.has(id) && !mentionOnlyIds.has(id));
      let pov = scene.povCharacterId;
      if (!activeIds.has(pov) || blockedIds.has(pov)) pov = present[0] ?? intent.characterAvailability.activeCharacterIds[0] ?? scene.povCharacterId;
      const normalizedPresent = present.length > 0 ? present : [pov];
      const threadActions = scene.threadActions
        .filter((t) => {
          if (t.action !== 'seed') return true;
          if (seedCount >= maxSeeds) return false;
          seedCount += 1;
          return true;
        })
        .map((t) => (preferredActions.size > 0 && !preferredActions.has(t.action) && t.action !== 'seed'
          ? { ...t, action: 'touch' as const }
          : t));
      const characterMoment = scene.characterMoment
        ? (activeIds.has(scene.characterMoment.characterId) && !blockedIds.has(scene.characterMoment.characterId)
            ? scene.characterMoment
            : { ...scene.characterMoment, characterId: pov })
        : undefined;
      return { ...scene, povCharacterId: pov, presentCharacterIds: normalizedPresent, threadActions, characterMoment };
    });

    const minMoments = Math.max(0, Math.min(3, state.bookStrategy?.characterFocusPolicy?.minCharacterMomentPerChapter ?? 0));
    let currentMoments = scenes.filter((s) => !!s.characterMoment).length;
    if (minMoments > currentMoments && focusCandidates.length > 0) {
      for (const scene of scenes) {
        if (currentMoments >= minMoments) break;
        if (scene.characterMoment) continue;
        const characterId = focusCandidates[currentMoments % focusCandidates.length];
        scene.characterMoment = {
          characterId,
          type: 'inner_test',
          hint: focusMomentHint,
        };
        currentMoments += 1;
      }
      this.logger.log(
        `[Chapter ${intent.chapterNumber}] scene-plan 角色聚焦补齐：${currentMoments}/${minMoments}`,
      );
    }
    if (seedCount > maxSeeds) {
      this.logger.warn(`[Chapter ${intent.chapterNumber}] scene-plan seed 超限，已钳制为 ${maxSeeds}`);
    }
    const maxPresent = state.bookStrategy?.characterBudget?.maxPresentPerChapter ?? 6;
    const allPresentIds = new Set(scenes.flatMap((s) => s.presentCharacterIds));
    if (allPresentIds.size > maxPresent) {
      const IMP_RANK: Record<string, number> = { core: 40, major: 30, minor: 20, cameo: 10 };
      const povSet = new Set(scenes.map((s) => s.povCharacterId));
      const ranked = [...allPresentIds].sort((a, b) => {
        const ap = povSet.has(a) ? 100 : 0;
        const bp = povSet.has(b) ? 100 : 0;
        const ai = IMP_RANK[state.characters.find((c) => c.id === a)?.status.narrativeImportance ?? ''] ?? 15;
        const bi = IMP_RANK[state.characters.find((c) => c.id === b)?.status.narrativeImportance ?? ''] ?? 15;
        return (bp + bi) - (ap + ai);
      });
      const keepSet = new Set(ranked.slice(0, maxPresent));
      for (const sc of scenes) {
        sc.presentCharacterIds = sc.presentCharacterIds.filter((id) => keepSet.has(id) || id === sc.povCharacterId);
      }
      this.logger.warn(`[Chapter ${intent.chapterNumber}] scene-plan 角色${allPresentIds.size}→${maxPresent}，裁剪${ranked.slice(maxPresent).join(',')}`);
    }
    const totalEstimated = scenes.reduce((s, sc) => s + sc.estimatedWords, 0);
    const hardMax = intent.wordCountRange.max * 1.2;
    if (totalEstimated > hardMax) {
      const ratio = intent.wordCountRange.max / Math.max(1, totalEstimated);
      this.logger.warn(`[Chapter ${intent.chapterNumber}] scene-plan 总字数${totalEstimated}超上限${hardMax}，按比例${ratio.toFixed(2)}x缩减`);
      for (const sc of scenes) sc.estimatedWords = Math.round(sc.estimatedWords * ratio);
    }
    return { ...plan, scenes };
  }
}
