/**
 * 执笔人角色（步骤 2）：
 * 核心创作引擎——有方向但有创作自由。
 * 允许在写作过程中"发现"计划外的精彩内容。
 * 接收角色弧线指引，写出有深度的角色时刻。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  StoryStateV2,
} from '../schemas/novel-v2.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  WRITING_SOUL_PLAYBOOK,
  PROSE_CRAFT_PLAYBOOK,
  CHAPTER_RHYTHM_V2_PLAYBOOK,
  CONTINUITY_BASELINE_PLAYBOOK,
  THREAD_AWARENESS_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  FIRST_CHAPTERS_V2_PLAYBOOK,
  buildCompactContextV2,
  buildCompactContextProse,
  buildIntentContext,
  buildKpiTrendHintsV2,
} from '../prompting/novel-playbook-v2';
import { MiniArcChapterBeat } from '../schemas/novel-v2.schemas';

@Injectable()
export class CreativeWriterAgent {
  constructor(private readonly llm: LlmService) {}

  private resolveChapterType(
    intent: ChapterIntent,
    state: StoryStateV2,
  ): { type: 'setup' | 'rising' | 'climax' | 'relief' | 'general'; temperature: number } {
    const beat = this.findCurrentBeat(intent, state);
    if (beat?.role) {
      const map: Record<string, { type: 'setup' | 'rising' | 'climax' | 'relief'; temperature: number }> = {
        setup: { type: 'setup', temperature: 0.80 },
        escalation: { type: 'rising', temperature: 0.82 },
        twist: { type: 'climax', temperature: 0.88 },
        climax: { type: 'climax', temperature: 0.90 },
        aftermath: { type: 'relief', temperature: 0.78 },
        transition: { type: 'relief', temperature: 0.78 },
      };
      return map[beat.role] ?? { type: 'general', temperature: 0.85 };
    }
    return { type: 'general', temperature: 0.85 };
  }

  private findCurrentBeat(
    intent: ChapterIntent,
    state: StoryStateV2,
  ): MiniArcChapterBeat | undefined {
    if (!state.currentArc?.chapterBeats) return undefined;
    return state.currentArc.chapterBeats.find(
      (b) => b.chapterNumber === intent.chapterNumber,
    );
  }

  private buildDynamicRules(
    chapterType: string,
    state: StoryStateV2,
    intent: ChapterIntent,
  ): string {
    const profile = state.bookPromptProfile;
    const blocks: string[] = [];

    // Tier 2: Profile-driven identity & rules
    blocks.push(profile.writerGuide.coreIdentity + `\n你的使命不是"执行任务"，而是"创作故事"。意图给你方向，但你有完全的创作自由。好的意外比严格执行计划更重要。`);

    // Tier 1: Universal hard rules (never change)
    blocks.push(`=== 不可违反的硬规则 ===
- 禁止出场的角色绝对不能出现（死亡/退场/休眠角色）。
- 开头必须承接上章（如果有的话）。
- 结尾必须有让读者想看下一章的钩子。
- 字数必须在意图给定的范围内。
- 不得输出结构化数据、提纲或说明文字，只输出小说正文。`);

    // Tier 1: Universal craft rules
    blocks.push(PROSE_CRAFT_PLAYBOOK);
    blocks.push(WRITING_SOUL_PLAYBOOK);

    // Tier 2: Profile-driven genre-specific craft examples
    if (profile.writerGuide.craftExamples.length > 0) {
      const exLines = profile.writerGuide.craftExamples.map(
        (e) => `坏：${e.bad}\n好：${e.good}\n规则：${e.rule}`,
      );
      blocks.push(`=== 本题材写作正反例 ===\n${exLines.join('\n\n')}`);
    }

    // Tier 2: Profile-driven genre rules
    blocks.push(`=== 题材专属规则 ===\n${profile.writerGuide.genreRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);

    // Tier 2: Profile-driven pacing & dialogue
    blocks.push(`=== 节奏指南 ===\n${profile.writerGuide.pacingGuide}`);
    blocks.push(`=== 对话指南 ===\n${profile.writerGuide.dialogueGuide}`);
    blocks.push(`=== 调性 ===\n${profile.writerGuide.toneGuide}`);

    // Tier 1: Universal chapter type rules (structure is universal, but the rules are generic enough)
    if (chapterType === 'setup') {
      blocks.push(`=== 铺垫章重点 ===
- 本章核心任务是"勾起好奇"，不是"说明信息"。
- 多埋线索，少给答案。新角色登场要有悬念。`);
    } else if (chapterType === 'climax') {
      blocks.push(`=== 高潮章重点 ===
- 本章必须有一个让读者拍桌叫好的大场面或大揭露。
- 节奏要快：短句、断句、动作密集。
- 爽感要有层次：先小爽、再中爽、最后炸裂。`);
    } else if (chapterType === 'relief') {
      blocks.push(`=== 过渡章重点 ===
- 可以轻松写，但仍需推进一条暗线。
- 适合写角色间的日常互动和感情基础。
- 暗示下一场风暴——让读者在轻松中隐隐感到不安。`);
    } else if (chapterType === 'rising') {
      blocks.push(`=== 升温章重点 ===
- 矛盾加剧但不爆发——像弹簧被越压越紧。
- 适合展示角色的内心挣扎和两难抉择。`);
    }

    if (intent.chapterNumber <= 3) blocks.push(FIRST_CHAPTERS_V2_PLAYBOOK);

    // Tier 1: Universal style/POV rules
    if (state.styleAnchor) {
      blocks.push(`=== 文风一致性 ===
- 叙事腔调、节奏偏好、对话风格必须与文风锚点一致。`);
      if (state.styleAnchor.pov) {
        const povLabel: Record<string, string> = {
          first_person: '第一人称',
          third_person_limited: '第三人称限制视角',
          third_person_omniscient: '第三人称全知视角',
          multi_pov: '多视角',
        };
        blocks.push(`=== 叙事视角 ===\n当前视角：${povLabel[state.styleAnchor.pov] ?? state.styleAnchor.pov}${
          state.styleAnchor.pov === 'third_person_limited' ? '\n- 只能描写视角角色看到/听到/想到的内容。' : ''
        }${state.styleAnchor.povSwitchRules ? `\n视角切换规则：${state.styleAnchor.povSwitchRules}` : ''}`);
      }
    }

    // Tier 1: Universal continuity rules (always apply)
    if ((state.factions ?? []).length > 0) {
      blocks.push(`=== 势力规则 ===
- 角色行为必须符合其所属势力的规矩和等级。
- 提到势力时名称/类型必须与势力表一致。`);
    }

    if ((state.activeCommitments ?? []).length > 0) {
      blocks.push(`=== 角色承诺 ===
- 角色不能"失忆"——承诺影响行动和选择。
- 承诺浮现应由情境自然触发。`);
    }

    // Tier 2: Profile-conditional — only if genre uses golden finger
    if (state.goldenFinger && profile.worldProfile.goldenFingerApplicable) {
      blocks.push(`=== 金手指 ===
- 每次使用都应让读者感到惊喜，但必须有限制和代价。
- 定期暗示未解锁的更深层能力。`);
    }

    if (state.seed.readerPersona) {
      blocks.push(`=== 读者代入 ===\n${profile.worldProfile.characterRelationEmphasis}`);
    }

    // Tier 2: Profile-driven anti-cliche
    const clicheNames = profile.clichePatterns
      .filter((c) => c.maxPerChapter <= 1)
      .map((c) => `"${c.pattern}"`)
      .slice(0, 8);
    if (clicheNames.length > 0 || (state.recentDistinctivePhrases ?? []).length > 0) {
      blocks.push(`=== 反重复 ===
- 以下表达本章每个最多出现1次：${clicheNames.join('、')}
- 上下文中的"禁用表达"列表中的表达本章不得使用。
- 每个重要场景的描写方式必须有变化。`);
    }

    // Tier 1: Universal structural rules
    blocks.push(CHAPTER_RHYTHM_V2_PLAYBOOK);
    blocks.push(CONTINUITY_BASELINE_PLAYBOOK);
    blocks.push(THREAD_AWARENESS_PLAYBOOK);
    blocks.push(CHARACTER_ARC_PLAYBOOK);

    const kpiHints = buildKpiTrendHintsV2(state);
    if (kpiHints.length > 0) blocks.push('动态质量提示：\n' + kpiHints.join('\n'));

    return blocks.join('\n\n');
  }

  async write(
    state: StoryStateV2,
    intent: ChapterIntent,
    previousChapterEnding?: string,
    additionalSystemPrompt?: string,
  ): Promise<ChapterDraft> {
    const proseContext = buildCompactContextProse(state, {
      maxCharacters: 8,
      maxChapterSummaries: 4,
      maxOpenThreads: 8,
      maxTimelineEvents: 10,
    });
    const intentCtx = buildIntentContext(intent);
    const { type: chapterType, temperature } = this.resolveChapterType(intent, state);
    const systemPrompt = this.buildDynamicRules(chapterType, state, intent) +
      (additionalSystemPrompt ? `\n\n=== 作者补充指示 ===\n${additionalSystemPrompt}` : '');

    const arcHints = intent.characterArcGuidance.arcHints;
    const mustHints = arcHints.filter((h) => h.priority === 'must');
    const shouldHints = arcHints.filter((h) => h.priority === 'should');

    let arcSection = '';
    if (arcHints.length > 0) {
      const lines: string[] = [];
      if (mustHints.length > 0) {
        lines.push('本章必须包含的角色深度时刻：');
        mustHints.forEach((h) => lines.push(`  - ${h.characterName}：${h.hint}`));
      }
      if (shouldHints.length > 0) {
        lines.push('建议包含的角色时刻（非强制）：');
        shouldHints.forEach((h) => lines.push(`  - ${h.characterName}：${h.hint}`));
      }
      if (intent.characterArcGuidance.emotionalLogicNotes) {
        lines.push(`情绪逻辑提醒：${intent.characterArcGuidance.emotionalLogicNotes}`);
      }
      arcSection = lines.join('\n');
    }

    const voiceProfiles = state.characters
      .filter((c) => c.voice?.speechPattern)
      .map((c) => `${c.name}：说话风格-${c.voice!.speechPattern}${c.voice!.verbalTics?.length ? '，口头禅-' + c.voice!.verbalTics.join('/') : ''}`)
      .join('\n');
    const voiceSection = voiceProfiles.length > 0
      ? `\n角色声音档案（写对白时必须遵循，遮住名字应能猜出是谁说的）：\n${voiceProfiles}`
      : '';

    const gapSection = (() => {
      const gaps = (state.informationLedger ?? { activeGaps: [] }).activeGaps;
      if (gaps.length === 0) return '';
      return '\n\n当前信息差（利用但不点破）：\n' + gaps
        .map((g) => `- [${g.type}] ${g.secret}（${g.knownBy.join(',')}知道，${g.unknownTo.join(',')}不知道）`)
        .join('\n');
    })();

    return this.llm.generateStructured({
      taskName: 'creative-writer',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'draft'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
        lastHook: state.lastHook,
        chapterType,
      },
      systemPrompt,
      userPrompt: `故事上下文：
${proseContext}

本章意图：
${JSON.stringify(intentCtx, null, 2)}
${previousChapterEnding ? `\n上一章结尾原文（你必须精确承接这段文字的场景、语气和情绪）：\n「${previousChapterEnding}」\n` : ''}
创作指引：
- 文风要贴合 ${state.seed.targetAudience} 的中文网文阅读习惯。
- 章节标题要有冲突感和吸引力，禁止"第X章"模板标题。
- 开头承接：${intent.carryoverFromLastChapter}
- 伏线指引：新坑不超过 ${intent.threadGuidance.maxNewThreads} 条；${intent.threadGuidance.advice}
- 正文字数：${intent.wordCountRange.min}-${intent.wordCountRange.max} 字。
- 钩子方向：${intent.hookDirection}
${ arcSection ? `\n角色弧线要求：\n${arcSection}` : ''}${voiceSection}${gapSection}

请输出完整中文章节正文。`,
      temperature,
    });
  }
}
