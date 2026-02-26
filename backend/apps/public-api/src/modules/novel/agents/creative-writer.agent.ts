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
  SceneContract,
  SceneDraft,
  sceneDraftSchema,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import {
  buildFirstChaptersPlaybook,
  CHAPTER_TYPE_TEMPLATES,
  THREAD_AWARENESS_PLAYBOOK,
  buildCompactContextProse,
  buildKpiTrendHints,
  buildStyleDNA,
  buildCharacterVoiceMatrix,
  buildWritingLessonsHint,
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
    if (beat) {
      const typeMap: Record<string, 'setup' | 'rising' | 'climax' | 'relief'> = {
        setup: 'setup', escalation: 'rising', twist: 'climax',
        climax: 'climax', aftermath: 'relief', transition: 'relief',
      };
      const type = typeMap[beat.role] ?? 'general';
      const temperature = Math.min(0.95, 0.75 + beat.tensionLevel * 0.02); // tensionLevel 1→0.77, 5→0.85, 10→0.95
      return { type, temperature };
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

    // ── 第一层：铁律 ──
    blocks.push(`=== 铁律（违反即失败）===
1. 禁止出场角色绝对不出现（死亡/退场/休眠）。
2. 开头承接上章场景、语气和情绪。
3. 结尾必须有让读者翻下一章的驱动力。
4. 字数在意图范围内。
5. 只输出中文小说正文，禁止元叙述/提纲/数据。`);

    // ── 第二层：本书灵魂（深层文风DNA） ──
    if (state.styleAnchor) {
      blocks.push(buildStyleDNA(state.styleAnchor, chapterType));
    } else if (profile.styleReferenceTexts?.length) {
      const soul: string[] = ['=== 文风参考 ==='];
      profile.styleReferenceTexts.slice(0, 2).forEach((t) => soul.push(`「${t.slice(0, 200)}」`));
      blocks.push(soul.join('\n'));
    }
    const soul: string[] = [profile.writerGuide.coreIdentity];
    soul.push('你的使命是"创作故事"而非"执行任务"。意图给方向，铁律是安全边界，边界内你拥有充分的创作自由——好的意外比严格执行计划更有价值。');
    soul.push(`题材核心：${profile.writerGuide.genreRules.slice(0, 3).join('；')}`);
    soul.push(`节奏：${profile.writerGuide.pacingGuide}`);
    soul.push(`对话：${profile.writerGuide.dialogueGuide}，调性：${profile.writerGuide.toneGuide}`);
    soul.push('写作直觉：写"他感到XX"时停下改成动作和感官；每句对话至少完成两个任务；紧张短句平静长句长短交替像呼吸');
    blocks.push(soul.join('\n'));

    // ── 第三层：本章技法 ──
    const template = CHAPTER_TYPE_TEMPLATES[chapterType];
    if (template) blocks.push(template);
    if (intent.chapterNumber <= 3) blocks.push(buildFirstChaptersPlaybook(profile.worldProfile?.goldenFingerApplicable));
    if (profile.writerGuide.craftExamples.length > 0) {
      blocks.push(`=== 正反例 ===\n${profile.writerGuide.craftExamples.slice(0, 2).map((e) => `坏：${e.bad} → 好：${e.good}`).join('\n')}`);
    }

    // ── 限制 ──
    const limits: string[] = [];
    if ((state.factions ?? []).length > 0) limits.push('角色行为符合所属势力规矩和等级');
    if ((state.activeCommitments ?? []).length > 0) limits.push('已立承诺影响角色行动选择');
    if (state.goldenFinger && profile.worldProfile.goldenFingerApplicable) limits.push('金手指使用必须有限制和代价');
    const clicheNames = profile.clichePatterns.filter((c) => c.maxPerChapter <= 1).map((c) => `"${c.pattern}"`).slice(0, 8);
    if (clicheNames.length > 0) limits.push(`反套话（每个最多1次）：${clicheNames.join('、')}`);
    limits.push('杀死AI味：角色不要对自己情绪过于自知，事件不要过于顺滑，对话允许停顿和词不达意');
    blocks.push(limits.join('\n'));
    blocks.push(THREAD_AWARENESS_PLAYBOOK);

    const kpiHints = buildKpiTrendHints(state);
    if (kpiHints.length > 0) blocks.push(kpiHints.join('\n'));

    const lessonsHint = buildWritingLessonsHint(state.writingLessons ?? [], ['prose', 'dialogue', 'character', 'emotion']);
    if (lessonsHint) blocks.push(lessonsHint);

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
      if (rg.preserveParagraphs?.length) {
        lines.push(`精确手术：以下段落写得好，尽量保留原貌，只重写有问题的部分：`);
        rg.preserveParagraphs.forEach((p) => lines.push(`  ★ 第${p.index + 1}段（${p.reason}）`));
        lines.push(`重写策略：保留优秀段落，只对有问题的段落用全新角度重构。`);
      } else {
        lines.push(`重写策略：用全新角度重新构思，同时保留优点、规避已知问题。`);
      }
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

  /** 场景级写作 — 每个场景独立生成，精度远高于整章一次性生成。 */
  async writeScene(
    state: StoryState,
    intent: ChapterIntent,
    scene: SceneContract,
    previousText?: string, // 上一场景结尾 或 上一章结尾
    additionalSystemPrompt?: string,
    continuityInjections?: string[],
  ): Promise<SceneDraft> {
    const profile = state.bookPromptProfile;
    const { temperature } = this.resolveChapterType(intent, state);

    const detailCtx = await this.detailContext.buildWriterDetailContext(state.bookId, state, intent);
    const charMap = new Map(state.characters.map((c) => [c.id, c]));
    const povChar = charMap.get(scene.povCharacterId);
    const presentChars = scene.presentCharacterIds.map((id) => charMap.get(id)).filter(Boolean);

    const voiceMatrix = buildCharacterVoiceMatrix(state, scene.presentCharacterIds);
    const voiceSnippets = voiceMatrix || presentChars
      .filter((c) => c!.voice?.speechPattern)
      .map((c) => `${c!.name}：${c!.voice!.speechPattern}${c!.voice!.verbalTics?.length ? '，口头禅-' + c!.voice!.verbalTics.join('/') : ''}`)
      .join('\n');

    const psychSnippets = presentChars
      .filter((c) => c!.psychology)
      .map((c) => {
        const p = c!.psychology!;
        const parts = [`${c!.name}(${p.emotionalBaseline})`];
        if (p.currentMood) parts.push(`当前:${p.currentMood}`);
        if (p.innerConflict) parts.push(`矛盾:${p.innerConflict.tension}`);
        if (p.decisionPattern) parts.push(`决策:${p.decisionPattern}`);
        const unresolvedEmotions = (p.emotionalMemories ?? []).filter((e) => e.unresolved).slice(-2);
        if (unresolvedEmotions.length) parts.push(`未消化:${unresolvedEmotions.map((e) => `${e.emotion}(ch${e.chapterNumber})`).join(',')}`);
        const interactionWithPresent = (p.interactionPatterns ?? [])
          .filter((ip) => scene.presentCharacterIds.includes(ip.targetCharacterId));
        if (interactionWithPresent.length) parts.push(`互动:${interactionWithPresent.map((ip) => ip.pattern).join(';')}`);
        return parts.join(' | ');
      })
      .join('\n');

    const PACE_LABEL: Record<string, string> = {
      slow_burn: '慢热——长句为主，细节丰富，感官堆叠', steady: '稳健——中等段落，信息密度均衡',
      accelerating: '加速——段落渐短，冲突升级', breakneck: '极速——短句断句，画面切换，零废话',
      stillness: '静谧——留白为王，沉默比语言更有力',
    };
    const PURPOSE_HINT: Record<string, string> = {
      hook_opening: '承接上章+第一段就抛出微钩子', conflict: '冲突升级，每段都有动作推进或关系变化',
      revelation: '信息揭露——用旁人反应衬托冲击力', emotional: '角色内心，用动作和环境映射情绪，禁止直述',
      action: '战斗/动作，短句+断句+画面感', dialogue_driven: '对话推进，潜台词+权力差异+沉默也是对话',
      transition: '快速过渡+暗线推进，不能水', climax: '张力最高点，旁观者阶梯震惊+金句',
      cliffhanger: '悬崖收尾——最紧张时刻戛然而止',
    };

    let systemPrompt = `你是一位才华横溢的${profile.generatedForGenre}网文作者。你正在写第${intent.chapterNumber}章的第${scene.sceneIndex + 1}个场景。

=== 铁律 ===
1. 只输出本场景正文（中文），禁止标题/编号/元叙述。
2. 视角：${povChar?.name ?? scene.povCharacterId}——所有描写必须从此角色的感官和认知出发。
3. 字数硬约束：${Math.round(scene.estimatedWords * 0.85)}-${Math.round(scene.estimatedWords * 1.1)}字。超过${Math.round(scene.estimatedWords * 1.15)}字会严重影响全章节奏，宁可精炼也不要注水。

=== 本场景使命 ===
- 类型：${scene.purpose}（${PURPOSE_HINT[scene.purpose] ?? ''}）
- 目标：${scene.objective}
- 冲突/张力：${scene.conflict}
- 转折：${scene.turningPoint}
- 节奏：${PACE_LABEL[scene.paceDirective] ?? scene.paceDirective}
- 情绪：从「${scene.emotionalEntry}」→「${scene.emotionalExit}」

=== 灵魂层 ===
${state.styleAnchor ? buildStyleDNA(state.styleAnchor, scene.purpose) : `${profile.writerGuide.coreIdentity}\n${profile.writerGuide.pacingGuide}\n${profile.writerGuide.dialogueGuide}`}
写作直觉：写"他感到XX"时停下改成动作和感官；每句对话至少完成两个任务；紧张短句平静长句长短交替像呼吸。

=== 反AI味 ===
${[...profile.clichePatterns.filter((c) => c.maxPerChapter <= 1).slice(0, 6).map((c) => `"${c.pattern}"`), ...(state.styleAnchor?.antiPatterns ?? []).map((a) => `"${a}"`)].join('、')}——每个最多出现1次。
角色不要对自己情绪过于自知，事件不要过于顺滑，对话允许停顿和词不达意。
${scene.characterMoment ? `\n=== 角色深度时刻 ===\n${charMap.get(scene.characterMoment.characterId)?.name ?? scene.characterMoment.characterId}：${scene.characterMoment.hint}` : ''}`;

    if (detailCtx?.trim()) systemPrompt += `\n\n=== 人物细节记忆 ===\n${detailCtx}`;
    if (additionalSystemPrompt) systemPrompt += `\n\n=== 作者补充指示 ===\n${additionalSystemPrompt}`;

    let userPrompt = '';
    if (previousText) userPrompt += `上文结尾（精确承接场景、语气和情绪）：\n「${previousText.slice(-800)}」\n\n`;
    if (voiceSnippets) userPrompt += `${voiceMatrix ? voiceSnippets : '在场角色声音档案：\n' + voiceSnippets}\n\n`;
    if (psychSnippets) userPrompt += `角色心理状态（影响行为和决策）：\n${psychSnippets}\n\n`;

    const dialogueMatrix = presentChars.flatMap((c) => {
      const psych = c!.psychology;
      const voice = c!.voice;
      const pairs: string[] = [];
      if (voice?.defaultDialogueStrategy) {
        const ds = voice.defaultDialogueStrategy;
        pairs.push(`${c!.name}[默认]：谎言=${ds.liePattern}，情绪泄露=${ds.emotionalLeakage}${ds.deflectionStyle ? '，回避方式=' + ds.deflectionStyle : ''}${ds.humorStyle ? '，幽默=' + ds.humorStyle : ''}`);
      }
      (psych?.interactionPatterns ?? [])
        .filter((ip) => scene.presentCharacterIds.includes(ip.targetCharacterId))
        .forEach((ip) => {
          const target = charMap.get(ip.targetCharacterId);
          const ds = ip.dialogueStrategy;
          pairs.push(`${c!.name}→${target?.name ?? ip.targetCharacterId}：${ip.pattern}(${ip.chemistryType})，权力=${ds?.powerDynamic ?? 'equal'}${ds?.subtextLayer ? '，潜台词=' + ds.subtextLayer : ''}${ds?.avoidTopics?.length ? '，回避话题=' + ds.avoidTopics.join('/') : ''}${ds?.triggerTopics?.length ? '，地雷话题=' + ds.triggerTopics.join('/') : ''}${ds?.silencePattern ? '，沉默=' + ds.silencePattern : ''}`);
        });
      return pairs;
    });
    if (dialogueMatrix.length) userPrompt += `对话策略矩阵（潜台词层，必须遵循）：\n${dialogueMatrix.join('\n')}\n\n`;

    const knowledgeBoundary = presentChars.filter((c) => c!.knowledgeState?.knownFacts?.length || c!.knowledgeState?.falseBeliefs?.length || c!.knowledgeState?.blindSpots?.length).map((c) => {
      const ks = c!.knowledgeState!;
      const parts = [`${c!.name}的知识边界：`];
      const secrets = (ks.knownFacts ?? []).filter((f) => f.isSecret);
      if (secrets.length) parts.push(`  秘密(不可泄露)：${secrets.map((f) => f.content.slice(0, 30)).join('；')}`);
      if (ks.falseBeliefs?.length) parts.push(`  错误认知(必须体现)：${ks.falseBeliefs.map((f) => f.wrongBelief.slice(0, 30)).join('；')}`);
      if (ks.blindSpots?.length) parts.push(`  盲区(完全不知)：${ks.blindSpots.join('、')}`);
      return parts.join('\n');
    });
    if (knowledgeBoundary.length) userPrompt += `⚠ 角色知识图谱（信息隔离，严禁违反）：\n${knowledgeBoundary.join('\n')}\n\n`;

    if (scene.transitionHint && scene.sceneIndex > 0) userPrompt += `过渡提示：${scene.transitionHint}\n\n`;
    if (continuityInjections?.length) userPrompt += `连续性提醒：\n${continuityInjections.map((c) => `⚠ ${c}`).join('\n')}\n\n`;

    const fs = state.feedbackState;
    if (fs?.lastAnalysis && fs.confidence !== 'none') {
      const a = fs.lastAnalysis;
      const lines: string[] = [];
      if (a.bookLevel.neverAgain.length) lines.push(`绝对禁止（读者红线）：${a.bookLevel.neverAgain.join('；')}`);
      const charPop = a.bookLevel.characterPopularity.filter((cp) => scene.presentCharacterIds.some((id) => cp.characterId === id));
      if (charPop.length) lines.push(`角色人气：${charPop.map((cp) => `${cp.characterName}(${cp.score > 0 ? '受欢迎' : '不受欢迎'},${cp.trend}): ${cp.keyFeedback.slice(0, 30)}`).join('；')}`);
      if (lines.length) userPrompt += `读者反馈红线（必须遵守neverAgain，人气仅参考）：\n${lines.join('\n')}\n\n`;
    }

    userPrompt += `现在请写第${scene.sceneIndex + 1}场景（${Math.round(scene.estimatedWords * 0.85)}-${Math.round(scene.estimatedWords * 1.1)}字，硬上限${Math.round(scene.estimatedWords * 1.15)}字）。只输出正文。`;

    return this.llm.generateStructured({
      taskName: 'scene-writer',
      schema: sceneDraftSchema,
      tags: ['workflow', 'chapter', 'scene', 'draft'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
        sceneIndex: scene.sceneIndex,
        sceneId: scene.sceneId,
        purpose: scene.purpose,
      },
      systemPrompt,
      userPrompt,
      temperature: Math.min(temperature + 0.08, 0.95),
    });
  }
}
