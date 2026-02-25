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
  StoryState,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  WRITING_SOUL_PLAYBOOK,
  PROSE_CRAFT_PLAYBOOK,
  CHAPTER_RHYTHM_PLAYBOOK,
  CONTINUITY_BASELINE_PLAYBOOK,
  CHARACTER_ARC_PLAYBOOK,
  FIRST_CHAPTERS_PLAYBOOK,
  CHAPTER_TYPE_TEMPLATES,
  buildCompactContextProse,
  buildKpiTrendHints,
} from '../prompting/novel-playbook';
import { MiniArcChapterBeat } from '../schemas/novel-state.schemas';
import { DetailContextService } from '../detail-context.service';

@Injectable()
export class CreativeWriterAgent {
  constructor(
    private readonly llm: LlmService,
    private readonly detailContext: DetailContextService,
  ) {}

  private resolveChapterType(
    intent: ChapterIntent,
    state: StoryState,
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
    state: StoryState,
  ): MiniArcChapterBeat | undefined {
    if (!state.currentArc?.chapterBeats) return undefined;
    return state.currentArc.chapterBeats.find(
      (b) => b.chapterNumber === intent.chapterNumber,
    );
  }

  private buildDynamicRules(
    chapterType: string,
    state: StoryState,
    intent: ChapterIntent,
  ): string {
    const profile = state.bookPromptProfile;
    const blocks: string[] = [];

    // ── Layer 1: Identity & Creative Freedom ──
    blocks.push(profile.writerGuide.coreIdentity + `\n你的使命不是"执行任务"，而是"创作故事"。意图给你方向，但你有完全的创作自由。好的意外比严格执行计划更重要。`);

    // ── Layer 2: Iron Rules (5 conditions, never violate) ──
    blocks.push(`=== 铁律（违反任何一条即为失败） ===
1. 禁止出场的角色绝对不能出现（死亡/退场/休眠角色）。
2. 开头必须承接上章（如果有的话）。
3. 结尾必须有让读者想看下一章的钩子。
4. 字数必须在意图给定的范围内。
5. 只输出小说正文，不得输出结构化数据/提纲/说明。`);

    // ── Layer 3: Chapter Type Template (the most actionable writing guide) ──
    const template = CHAPTER_TYPE_TEMPLATES[chapterType];
    if (template) {
      blocks.push(template);
    }

    if (intent.chapterNumber <= 3) blocks.push(FIRST_CHAPTERS_PLAYBOOK);

    // ── Layer 4: Core Craft (prose technique + soul) ──
    blocks.push(WRITING_SOUL_PLAYBOOK);
    blocks.push(PROSE_CRAFT_PLAYBOOK);
    blocks.push(CHAPTER_RHYTHM_PLAYBOOK);

    // ── Layer 5: Genre-specific rules (from profile) ──
    blocks.push(`=== 题材规则 ===\n${profile.writerGuide.genreRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n节奏：${profile.writerGuide.pacingGuide}\n对话：${profile.writerGuide.dialogueGuide}\n调性：${profile.writerGuide.toneGuide}`);

    // Genre-specific craft examples (only those NOT already in PROSE_CRAFT_PLAYBOOK)
    if (profile.writerGuide.craftExamples.length > 0) {
      const exLines = profile.writerGuide.craftExamples
        .slice(0, 3)
        .map((e) => `坏：${e.bad} → 好：${e.good}（${e.rule}）`);
      blocks.push(`=== 本题材正反例 ===\n${exLines.join('\n')}`);
    }

    // ── Layer 6: Consistency guardrails (compact) ──
    const guardrails: string[] = [CONTINUITY_BASELINE_PLAYBOOK];
    if (state.styleAnchor) {
      const povLabel: Record<string, string> = {
        first_person: '第一人称', third_person_limited: '第三人称限制视角',
        third_person_omniscient: '第三人称全知视角', multi_pov: '多视角',
      };
      guardrails.push(`文风：${state.styleAnchor.narrativeVoice}，节奏：${state.styleAnchor.pacePreference}，对话：${state.styleAnchor.dialogueStyle}${state.styleAnchor.pov ? '，视角：' + (povLabel[state.styleAnchor.pov] ?? state.styleAnchor.pov) : ''}`);
    }
    if ((state.factions ?? []).length > 0) guardrails.push('势力：角色行为必须符合所属势力的规矩和等级。');
    if ((state.activeCommitments ?? []).length > 0) guardrails.push('承诺：角色不能"失忆"——已立的承诺影响行动和选择。');
    if (state.goldenFinger && profile.worldProfile.goldenFingerApplicable) {
      guardrails.push('金手指：每次使用都应有惊喜感，但必须有限制和代价。');
    }

    const clicheNames = profile.clichePatterns
      .filter((c) => c.maxPerChapter <= 1)
      .map((c) => `"${c.pattern}"`)
      .slice(0, 8);
    if (clicheNames.length > 0) {
      guardrails.push(`反套话：以下每个最多出现1次——${clicheNames.join('、')}`);
    }
    blocks.push(`=== 一致性与限制 ===\n${guardrails.join('\n')}`);

    // ── Layer 7: Character depth (compact) ──
    blocks.push(CHARACTER_ARC_PLAYBOOK);

    // ── Dynamic hints ──
    const kpiHints = buildKpiTrendHints(state);
    if (kpiHints.length > 0) blocks.push(kpiHints.join('\n'));

    return blocks.join('\n\n');
  }

  async write(
    state: StoryState,
    intent: ChapterIntent,
    previousChapterEnding?: string,
    additionalSystemPrompt?: string,
    rewriteGuidance?: import('../schemas/novel-state.schemas').RewriteGuidance,
    continuityInjections?: string[],
  ): Promise<ChapterDraft> {
    const proseContext = buildCompactContextProse(state, {
      maxCharacters: 12,
      maxChapterSummaries: 6,
      maxOpenThreads: 10,
      maxTimelineEvents: 12,
    });
    const { type: chapterType, temperature } = this.resolveChapterType(intent, state);

    // 角色细节记忆（签名动作 + 典型描写），用于提升人物质感一致性。
    const detailCtx = await this.detailContext.buildWriterDetailContext(
      state.bookId,
      state,
      intent,
    );

    let systemPrompt = this.buildDynamicRules(chapterType, state, intent) +
      (additionalSystemPrompt ? `\n\n=== 作者补充指示 ===\n${additionalSystemPrompt}` : '');

    if (detailCtx && detailCtx.trim().length > 0) {
      systemPrompt += `\n\n=== 人物细节记忆（保持动作/神态一致） ===\n${detailCtx}`;
    }

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

    let rewriteSection = '';
    if (rewriteGuidance) {
      const rg = rewriteGuidance;
      const lines: string[] = [
        `\n=== 重写指导（第${rg.attemptNumber}/${rg.maxAttempts}轮，上轮${rg.previousScore}分） ===`,
        `上轮优点（必须保留和加强）：`,
        ...rg.previousStrengths.map((s) => `  ✓ ${s}`),
        `上轮问题（本轮必须修复）：`,
        ...rg.previousIssues.map((i) => `  ✗ [${i.severity}/${i.category}] ${i.description} → ${i.suggestedFix}`),
      ];
      if (rg.repeatedIssues.length > 0) {
        lines.push(`⚠️ 反复出现的问题（最高优先级修复）：`);
        rg.repeatedIssues.forEach((ri) => lines.push(`  ‼ ${ri}`));
      }
      if (rg.specificInstructions) {
        lines.push(`特别指示：${rg.specificInstructions}`);
      }
      lines.push(`重写策略：不是在旧稿上修补，而是用全新的角度重新构思这一章，同时保留优点、规避已知问题。`);
      rewriteSection = lines.join('\n');
    }

    let continuitySection = '';
    if (continuityInjections?.length) {
      continuitySection = `\n=== 连续性提醒 ===\n${continuityInjections.map((c) => `⚠ ${c}`).join('\n')}`;
    }

    return this.llm.generateStructured({
      taskName: 'creative-writer',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'draft'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
        lastHook: state.lastHook,
        chapterType,
        isRewrite: !!rewriteGuidance,
        attemptNumber: rewriteGuidance?.attemptNumber ?? 1,
      },
      systemPrompt,
      userPrompt: `故事上下文：
${proseContext}

本章方向（第${intent.chapterNumber}章）：
- 目标：${intent.goals.join('；')}
- 情绪走向：${intent.emotionDirection}
- 承接上章：${intent.carryoverFromLastChapter}
- 伏线：新坑不超过${intent.threadGuidance.maxNewThreads}条。${intent.threadGuidance.advice}
- 钩子方向：${intent.hookDirection}
- 正文字数：${intent.wordCountRange.min}-${intent.wordCountRange.max}字
${previousChapterEnding ? `\n上一章结尾原文（精确承接场景、语气和情绪）：\n「${previousChapterEnding}」` : ''}
${ arcSection ? `\n角色弧线：\n${arcSection}` : ''}${voiceSection}${gapSection}${rewriteSection}${continuitySection}

创作要求：
- 文风贴合${state.seed.targetAudience}的中文网文阅读习惯。
- 章节标题要有冲突感和吸引力，禁止"第X章"模板标题。
- 输出完整中文章节正文。`,
      temperature,
    });
  }
}
