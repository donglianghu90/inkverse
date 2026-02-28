/** 场景规划师 — 将章节意图拆分为可独立执行的场景契约（数量随章节类型动态调整）。 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  ChapterScenePlan,
  StoryState,
  ArcDirectorDirective,
  chapterScenePlanSchema,
} from '../schemas/novel-state.schemas';
import { THREAD_AWARENESS_PLAYBOOK, buildCompactContextProse, buildKpiTrendHints } from '../prompting/novel-playbook';

@Injectable()
export class ScenePlannerAgent {
  constructor(private readonly llm: LlmService) {}

  async plan(
    state: StoryState,
    intent: ChapterIntent,
    arcDirective?: ArcDirectorDirective,
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterScenePlan> {
    const proseContext = buildCompactContextProse(state, {
      maxCharacters: 10,
      maxChapterSummaries: 4,
      maxOpenThreads: 8,
      maxTimelineEvents: 10,
    });

    const totalWords = intent.wordCountRange.max;
    const kpiHints = buildKpiTrendHints(state);
    const profile = state.bookPromptProfile;

    const voiceHints = state.characters
      .filter((c) => intent.characterAvailability.activeCharacterIds.includes(c.id) && c.voice?.speechPattern)
      .slice(0, 5)
      .map((c) => `${c.name}: ${c.voice!.speechPattern}`)
      .join('；');

    const gapHints = ((state.informationLedger ?? { activeGaps: [] }).activeGaps)
      .slice(0, 3)
      .map((g) => `[${g.type}] ${g.secret}（${g.knownBy.join(',')}知道，${g.unknownTo.join(',')}不知道）`)
      .join('\n');

    return this.llm.generateStructured({
      taskName: 'scene-planner',
      schema: chapterScenePlanSchema,
      tags: ['workflow', 'chapter', 'scene-plan'],
      metadata: { bookId: state.bookId, chapterNumber: intent.chapterNumber },
      systemPrompt: `${playbooks?.['agent:scene-planner:role'] ?? '你是一位擅长场景拆分的网文导演。你的任务是把"章节意图"拆成独立场景，每个场景有明确的叙事任务。'}

=== 核心原则 ===
${playbooks?.['agent:scene-planner:principles'] ?? '1. 每个场景是一个"微型故事"——有自己的入口情绪、冲突、转折、出口情绪。\n2. 场景之间的情绪变化构成章内弧线——不能平坦，要有起伏。\n3. 第一场景必须承接上章钩子+建立本章张力。最后一场景必须制造下章驱动力。\n4. 视角(POV)切换要有意义——切到另一个角色是为了利用信息差或展示不同立场。'}

=== 场景数量指南 ===
${playbooks?.['agent:scene-planner:scene_count_guide'] ?? '根据章节类型动态调整场景数量和字数配比：\n- climax（高潮章）：4-5场景，铺垫15%→升温25%→爆发35%→余波15%→钩子10%\n- rising（升温章）：3-4场景，均匀分配，每场景推进一层冲突\n- setup（铺垫章）：3-4场景，信息密度均匀，最后场景必须抛出悬念\n- relief（缓冲章）：2-3场景即可，场景更长更沉浸，侧重角色深度和日常质感\n- general（通用章）：3-4场景，灵活分配'}

=== 场景分配策略（字数硬约束）===
- 全章总字数硬上限 ${totalWords}字，所有场景 estimatedWords 之和必须 ≤ ${totalWords}
- 分配比例：高潮/核心场景35-40%，其他场景均分余量，过渡场景≤15%
- 禁止每个场景都分1000+字——这会导致总字数爆炸
- 3场景时单场景上限约 ${Math.round(totalWords * 0.45)}字，4场景约 ${Math.round(totalWords * 0.35)}字
- 优先安排角色内心场景（不是"发展角色"，是"展示他面对XX时的真实反应"）和对话驱动场景——但具体是否需要取决于本章意图，纯动作/纯悬疑章节可以例外
- 高潮章可以有1个"战斗/动作"场景，用 breakneck 节奏

=== purpose 选择指南 ===
${playbooks?.['agent:scene-planner:purpose_guide'] ?? 'hook_opening: 仅第一场景。承接上章+建立悬念。\nconflict/action: 推进主线冲突。\nrevelation: 揭露新信息/真相。\nemotional: 角色内心戏/关系深化。\ndialogue_driven: 对话推进+角色塑造。\ntransition: 时空转换/暗线推进。\nclimax: 本章高潮。\ncliffhanger: 仅最后场景。'}

=== transitionHint ===
${playbooks?.['agent:scene-planner:transition_hint'] ?? '好的过渡：用环境描写做视角切换、因果链、时间推移自然嵌入行动。\n坏的过渡：硬切，读者感觉被强行拖走。'}

=== 感官桥接（sensoryEndState）===
${playbooks?.['agent:scene-planner:sensory_bridge'] ?? '每个场景结束时描述感官状态：timeOfDay, weather, ambientSound, dominantSense。确保场景过渡时感官连续。'}

=== 伏线分配 ===
每个场景可以顺带处理1-2条伏线（touch/advance/payoff/seed），总量不超过意图中的maxNewThreads限制。

${profile.writerGuide.genreRules.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n')}
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
  }
}
