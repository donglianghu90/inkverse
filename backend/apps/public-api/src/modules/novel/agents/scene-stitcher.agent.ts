/** 场景缝合师 — 智能缝合：逐缝分析、节奏对比、感官桥接、首尾优化、冗余去重。 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  ChapterScenePlan,
  SceneContract,
  SceneDraft,
  StoryState,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  PROSE_CRAFT_PLAYBOOK,
  buildStyleDNA,
  buildWritingLessonsHint,
  buildCompactContextProse,
  UNIFIED_AGENT_MAX_CHARACTERS,
} from '../prompting/novel-playbook';
import { buildAudiencePromptBlock } from '../prompting/audience-directive';

const PACE_CN: Record<string, string> = {
  slow_burn: '慢热', steady: '稳健', accelerating: '加速', breakneck: '极速', stillness: '静谧',
};

@Injectable()
export class SceneStitcherAgent {
  constructor(private readonly llm: LlmService) {}

  async stitch(
    state: StoryState,
    intent: ChapterIntent,
    scenePlan: ChapterScenePlan,
    sceneDrafts: SceneDraft[],
    additionalSystemPrompt?: string,
    playbooks?: Record<string, string>,
  ): Promise<ChapterDraft> {
    const profile = state.bookPromptProfile;
    const isLiterary = state.seed.writingMode === 'literary';
    const sorted = [...sceneDrafts].sort((a, b) => a.sceneIndex - b.sceneIndex);
    const rawConcat = sorted.map((d, i) => `【场景${i + 1}】\n${d.content}`).join('\n\n');
    const storyContext = buildCompactContextProse(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 4,
      maxOpenThreads: 6,
      maxTimelineEvents: 6,
    });

    const seamAnalysis = this.analyzeSeams(scenePlan.scenes, sorted);
    const redundancies = this.detectRedundancies(sorted);
    const rhythmContrast = this.buildRhythmContrastGuide(scenePlan.scenes);

    const result = await this.llm.generateStructured({
      taskName: 'scene-stitcher',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'stitch'],
      metadata: {
        userId: state.userId,
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
        sceneCount: sceneDrafts.length,
      },
      systemPrompt: `${playbooks?.['agent:scene-stitcher:role'] ?? (isLiterary
        ? `你是一位精通节奏和过渡的${profile.generatedForGenre}小说缝合大师。你收到了由不同场景组成的章节素材，需要缝合为一个浑然一体的完整章节，同时保持文学质感和叙事实验性。`
        : `你是一位精通节奏和过渡的${profile.generatedForGenre}网文缝合大师。你收到了由不同场景组成的章节素材，需要缝合为一个浑然一体的完整章节——读者不应感觉到"这里有拼接痕迹"。`)}

=== 核心使命（优先级从高到低）===
${playbooks?.['agent:scene-stitcher:core_mission'] ?? (isLiterary
  ? `1. 首段质感开篇：第一段建立本章基调——可以是感官、氛围、内心独白或安静的动作，必须有"文学质感"。\n2. 尾段余韵收束：最后一段可以是悬念、安静意象、未说完的话、一个回味的细节，不强制在最高点收尾。\n3. 逐缝过渡：用感官桥接、时间推移或因果链。\n4. 节奏对比：过渡段体现节奏转换。\n5. 情绪弧线验证。\n6. 冗余去重。\n7. 感官连续性。`
  : `1. 首段黄金钩子：第一段（≤100字）必须让读者无法放下。承接上章悬念，用异常/反问/感官冲击开场。\n2. 尾段悬崖收尾：最后一段必须在最紧张/最意外的时刻戛然而止。\n3. 逐缝过渡：用感官桥接、时间推移或因果链。\n4. 节奏对比：过渡段体现节奏转换。\n5. 情绪弧线验证。\n6. 冗余去重。\n7. 感官连续性。`)}
整章情绪曲线目标：${scenePlan.overallEmotionalArc}

=== 纪律 ===
${playbooks?.['agent:scene-stitcher:discipline'] ?? (isLiterary
  ? '- 保留每个场景的核心内容和精彩段落。\n- 过渡段2-4句，作用是"桥梁"。\n- 可以微调措辞让全章统一，但不改变事件和角色行为。\n- 章节标题要有意境或暗示性，不必有冲突感。\n- 只输出完整中文章节正文。'
  : '- 保留每个场景的核心内容和精彩段落。\n- 过渡段2-4句，作用是"桥梁"。\n- 可以微调措辞让全章统一，但不改变事件和角色行为。\n- 章节标题要有冲突感和吸引力。\n- 只输出完整中文章节正文。')}
- 字数目标：${intent.wordCountRange.min}-${intent.wordCountRange.max}字。

${buildAudiencePromptBlock(state)}
${playbooks?.['__bookStrategy'] ?? ''}
${playbooks?.['__policySlice'] ?? ''}

${playbooks?.['PROSE_CRAFT_PLAYBOOK'] ?? PROSE_CRAFT_PLAYBOOK}
${state.styleAnchor ? '\n' + buildStyleDNA(state.styleAnchor) : ''}
${buildWritingLessonsHint(state.writingLessons ?? [], ['prose', 'pacing', 'structure'])}
${additionalSystemPrompt ? '\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `章节情绪弧线：${scenePlan.overallEmotionalArc}
钩子策略：${scenePlan.hookStrategy}

=== 逐缝过渡指南 ===
${seamAnalysis}

${rhythmContrast}

${redundancies ? `=== 冗余警告（必须改写去重）===\n${redundancies}\n` : ''}故事上下文（验证角色称呼/时间连续性）：
${storyContext}

场景素材（按顺序）：
${rawConcat}

请输出缝合后的完整章节（chapterNumber=${intent.chapterNumber}）。
重点关注：${isLiterary
  ? '① 首段质感 ② 尾段余韵 ③ 每个接缝的自然过渡 ④ 节奏对比 ⑤ 冗余去重。'
  : '① 首段钩子 ② 尾段悬崖 ③ 每个接缝的自然过渡 ④ 节奏对比 ⑤ 冗余去重。'}`,
      temperature: isLiterary ? 0.58 : 0.52,
    });
    result.chapterNumber = intent.chapterNumber;
    return result;
  }

  /** 分析每个场景接缝，生成具体过渡策略。 */
  private analyzeSeams(scenes: SceneContract[], drafts: SceneDraft[]): string {
    if (scenes.length <= 1) return '';
    const lines: string[] = [];
    for (let i = 0; i < scenes.length - 1; i++) {
      const from = scenes[i];
      const to = scenes[i + 1];
      const fromDraft = drafts.find((d) => d.sceneIndex === from.sceneIndex);
      const fromEnd = fromDraft?.content.slice(-200) ?? '';

      const povChange = from.povCharacterId !== to.povCharacterId;
      const locChange = from.locationId !== to.locationId;
      const paceShift = from.paceDirective !== to.paceDirective;
      const emotionJump = from.emotionalExit !== to.emotionalEntry;
      const sensory = from.sensoryEndState;

      const hints: string[] = [];
      if (to.isParallel) {
        hints.push(`⚠ 并行时间线：场景${i + 1}和场景${i + 2}同时发生于不同地点/视角，使用"与此同时""另一边"或环境切换做过渡，不要暗示时间先后`);
      }
      if (povChange) hints.push(`视角切换(${from.povCharacterId}→${to.povCharacterId})：用环境做桥，如"远处另一个人也看到了…"`);
      if (locChange) hints.push(`地点转移：用时间推移或感官切换过渡，不要硬切`);
      if (paceShift) hints.push(`节奏从${PACE_CN[from.paceDirective] ?? from.paceDirective}→${PACE_CN[to.paceDirective] ?? to.paceDirective}：过渡段体现节奏变化`);
      if (emotionJump) hints.push(`情绪从「${from.emotionalExit}」→「${to.emotionalEntry}」：过渡段做情绪桥接`);
      if (sensory?.ambientSound) hints.push(`环境音延续：${sensory.ambientSound}`);
      if (sensory?.dominantSense) hints.push(`感官延续：${sensory.dominantSense}`);
      if (sensory?.weather) hints.push(`天气/光线：${sensory.weather}${sensory.timeOfDay ? '，' + sensory.timeOfDay : ''}`);
      if (to.subtext) hints.push(`下一场景潜台词层：${to.subtext}（过渡时注意不要破坏潜台词留白）`);
      if (hints.length === 0) hints.push(`自然衔接：${from.transitionHint}`);

      lines.push(`[缝${i + 1}] 场景${i + 1}(${from.purpose})→场景${i + 2}(${to.purpose})：\n  ${hints.join('\n  ')}${fromEnd ? `\n  前场景结尾：「${fromEnd.slice(-100)}」` : ''}`);
    }
    return lines.join('\n');
  }

  /** 检测相邻场景的冗余描写。 */
  private detectRedundancies(drafts: SceneDraft[]): string {
    const warnings: string[] = [];
    for (let i = 0; i < drafts.length - 1; i++) {
      const a = drafts[i].content;
      const b = drafts[i + 1].content;
      const aSentences = a.split(/[。！？]/).filter((s) => s.trim().length > 10).slice(-5);
      const bSentences = b.split(/[。！？]/).filter((s) => s.trim().length > 10).slice(0, 5);
      for (const as of aSentences) {
        for (const bs of bSentences) {
          const overlap = this.jaccard(as.trim(), bs.trim());
          if (overlap > 0.4) warnings.push(`场景${i + 1}尾部↔场景${i + 2}开头相似度高：「${as.trim().slice(0, 30)}…」vs「${bs.trim().slice(0, 30)}…」`);
        }
      }
      const aStart = a.split(/[。！？]/)[0]?.trim().slice(0, 5) ?? '';
      const bStart = b.split(/[。！？]/)[0]?.trim().slice(0, 5) ?? '';
      if (aStart && bStart && aStart === bStart) warnings.push(`场景${i + 1}和场景${i + 2}开头句式相同（"${aStart}…"），改写使其各有特色`);
    }
    return warnings.join('\n');
  }

  /** 构建节奏对比指南。 */
  private buildRhythmContrastGuide(scenes: SceneContract[]): string {
    if (scenes.length <= 1) return '';
    const lines: string[] = ['=== 节奏对比（相邻场景节奏应有反差）==='];
    const paceEnergy: Record<string, number> = { stillness: 1, slow_burn: 2, steady: 3, accelerating: 4, breakneck: 5 };
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const energy = paceEnergy[s.paceDirective] ?? 3;
      const bar = '█'.repeat(energy) + '░'.repeat(5 - energy);
      lines.push(`  场景${i + 1}(${s.purpose})：${bar} ${PACE_CN[s.paceDirective] ?? s.paceDirective} → 情绪「${s.emotionalEntry}」→「${s.emotionalExit}」`);
    }
    const consecutive = [];
    for (let i = 0; i < scenes.length - 1; i++) {
      if (scenes[i].paceDirective === scenes[i + 1].paceDirective) consecutive.push(i);
    }
    if (consecutive.length > 0) lines.push(`⚠ 场景${consecutive.map((i) => `${i + 1}-${i + 2}`).join('、')}节奏相同，过渡时刻意制造对比`);
    return lines.join('\n');
  }

  /** 简易字符级 Jaccard 相似度。 */
  private jaccard(a: string, b: string): number {
    const sa = new Set(a.split(''));
    const sb = new Set(b.split(''));
    const inter = [...sa].filter((c) => sb.has(c)).length;
    const union = new Set([...sa, ...sb]).size;
    return union === 0 ? 0 : inter / union;
  }
}
