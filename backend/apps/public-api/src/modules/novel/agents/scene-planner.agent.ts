/** 场景规划师 — 将章节意图拆分为3-5个可独立执行的场景契约。 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  ChapterScenePlan,
  StoryState,
  ArcDirectorDirective,
  chapterScenePlanSchema,
} from '../schemas/novel-state.schemas';
import { buildCompactContextProse, buildKpiTrendHints } from '../prompting/novel-playbook';

@Injectable()
export class ScenePlannerAgent {
  constructor(private readonly llm: LlmService) {}

  async plan(
    state: StoryState,
    intent: ChapterIntent,
    arcDirective?: ArcDirectorDirective,
    additionalSystemPrompt?: string,
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
      systemPrompt: `你是一位擅长场景拆分的网文导演。你的任务是把"章节意图"拆成3-5个独立场景，每个场景有明确的叙事任务。

=== 核心原则 ===
1. 每个场景是一个"微型故事"——有自己的入口情绪、冲突、转折、出口情绪。
2. 场景之间的情绪变化构成章内弧线——不能平坦，要有起伏。
3. 第一场景必须承接上章钩子+建立本章张力。最后一场景必须制造下章驱动力。
4. 视角(POV)切换要有意义——切到另一个角色是为了利用信息差或展示不同立场。

=== 场景分配策略 ===
- 总字数 ~${totalWords}字，按场景重要度分配（高潮场景可占40%，过渡场景15%）
- 至少1个场景聚焦角色内心（不是"发展角色"，是"展示他面对XX时的真实反应"）
- 至少1个场景有对话驱动的冲突（对话是推进关系和揭露信息的最高效工具）
- 高潮章可以有1个"战斗/动作"场景，用 breakneck 节奏

=== purpose 选择指南 ===
- hook_opening: 仅第一场景。承接上章+建立本章悬念。
- conflict/action: 推进主线冲突。
- revelation: 揭露新信息/真相（爽感来源）。
- emotional: 角色内心戏/关系深化（猫腻式安静力量）。
- dialogue_driven: 对话推进+角色塑造+信息传递。
- transition: 时空转换/暗线推进（最短，但要埋线索）。
- climax: 本章高潮——张力最高点。
- cliffhanger: 仅最后场景。制造无法抗拒的翻页冲动。

=== transitionHint ===
描述"这个场景结束后如何自然地引出下一个场景"。好的过渡：
- 用环境描写做视角切换（"远处山巅，另一个人也在看着同一片天空"）
- 用因果链（场景A的结果触发场景B）
- 用时间推移（"三个时辰后"但要自然嵌入行动中）
坏的过渡：硬切，读者感觉被强行拖走。

=== 感官桥接（sensoryEndState）===
每个场景结束时，填写 sensoryEndState 描述当时的感官状态：
- timeOfDay: 结束时的时间段（如"黄昏""深夜"）
- weather: 天气/光线（如"雨后的空气""昏暗的烛光"）
- ambientSound: 环境音（如"远处鸦群归巢""兵刃撞击的余音"）
- dominantSense: 主导感官（如"空气中的血腥味""地面的震颤"）
这些信息会传递给缝合师，确保场景过渡时感官连续。

=== 伏线分配 ===
每个场景可以顺带处理1-2条伏线（touch/advance/payoff/seed），总量不超过意图中的maxNewThreads限制。

${profile.writerGuide.genreRules.slice(0, 3).map((r, i) => `${i + 1}. ${r}`).join('\n')}
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

请拆分为3-5个场景，每个场景的 sceneId 格式为 "s_章号_序号"（如 s_${intent.chapterNumber}_0）。
overallEmotionalArc 要描述读者情绪变化曲线（如"好奇→紧张→震惊→沉默→期待"）。
hookStrategy 要具体说明末场景如何制造钩子。`,
      temperature: 0.5,
    });
  }
}
