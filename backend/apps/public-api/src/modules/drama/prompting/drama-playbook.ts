/**
 * Drama Playbook — 所有 Agent System Prompt 的构建入口。
 *
 * 架构原则：
 *   - 14 个预配置题材的 8 个 pipeline agent 提示词（storyboard / arc / episode / audio /
 *     reviewer / pacing / continuity / hook）均为 WYSIWYG：题材专属内容直接内联在
 *     genres/*.prompts.ts 中，不依赖 BASE 模板拼接。每集仅剩少量 per-drama {{}} 占位符。
 *   - _custom 题材使用 BASE 模板（drama-agent-system-prompts.ts），所有 {{}} 占位符
 *     由 Profiler 运行时生成数据后，在 DramaPromptBakerService 调用 build* 函数时填充。
 *   - scriptwriter / dialogue-coach / script-editor / episode-recorder 所有题材共用
 *     BASE 模板（这 4 个 agent 的核心逻辑跨题材一致，per-drama 差异通过 soulViews 注入）。
 *   - 本文件每个 buildXxx 函数的职责：
 *     ① getTemplate(agentId, genreKey) 查找题材模板（WYSIWYG 或 BASE）
 *     ② 从 ctx 参数构建 per-drama 变量 map
 *     ③ resolveTemplate(template, vars) 填充运行时值（多余变量会被忽略）
 */

import type { GenreArchetype } from '../schemas/drama-state.schemas';
import type { GenreProductionGuidance } from '../entities/drama-genre-template.entity';
import type { VisualStyleGuide } from '../entities/drama-visual-style-template.entity';
import {
  DRAMA_LANG_RULE,
  DRAMA_T2I_LANG_RULE,
  resolveTemplate,
  // creation-stage templates
  SEED_ANALYZER_TEMPLATE,
  SERIES_DIRECTOR_CREATION_TEMPLATE,
  VISUAL_ASSET_DESIGNER_TEMPLATE,
  PROFILER_TEMPLATE,
  STRATEGY_TEMPLATE,
  ARC_EXPANSION_TEMPLATE,
  HISTORICAL_CONSTRAINT_NOTE,
  DEFAULT_MALE_LEAD_FORMULA,
  DEFAULT_FEMALE_LEAD_FORMULA,
  // pipeline agent simple config defaults
  DEFAULT_SFX_DENSITY,
  DEFAULT_SILENCE_USAGE,
  DEFAULT_VOICE_ACTING_STYLE,
  // runtime context templates
  PURPOSE_DIRECTIVE_TEMPLATES,
  PURPOSE_OVERRIDE_FORMAT,
  SCENE_CONTEXT_CONSTRAINTS,
  SCENE_CONTEXT_HOOK,
  SCENE_CONTEXT_EMOTION_DIRECTION,
  EMOTION_BEAT_ALIGNMENT_RULES,
  AUDIO_CONTEXT_HEADER,
  AUDIO_CONTEXT_FOOTER,
  HOOK_CONSTRAINT_TEMPLATE,
  // profiler section constants
  PROFILER_CORE_IDENTITY_WITH_GUIDE,
  PROFILER_CORE_IDENTITY_DEFAULT,
  PROFILER_CAMERA_PRECONFIGURED,
  PROFILER_CAMERA_GENERATE,
  PROFILER_AUDIO_PRECONFIGURED,
  PROFILER_AUDIO_GENERATE,
  PROFILER_REVIEWER_PRECONFIGURED,
  PROFILER_REVIEWER_GENERATE,
  PROFILER_ARC_PRECONFIGURED,
  PROFILER_ARC_GENERATE,
  PROFILER_EPISODE_PRECONFIGURED,
  PROFILER_EPISODE_GENERATE,
  PROFILER_PACING_PRECONFIGURED,
  PROFILER_PACING_GENERATE,
  PROFILER_SOUL_HEADER,
  PROFILER_SOUL_DEFAULT,
  buildCamTechSection,
} from './drama-agent-system-prompts';
import { GENRE_TEMPLATES } from './drama-genre-data';
import { CHARACTER_INTENSITY_PROGRESSION, FIRST_EPISODE_CONSTRAINTS } from './shared-blocks';

// ─── User Prompt 尾部强制约束块 ─────────────────────────────────────────────

/**
 * 构建 User Prompt 尾部的强制约束块（redLines + genreRules + continuityWarnings）。
 *
 * 设计原理（Lost in the Middle 效应对策）：
 *   大模型对长 context 的注意力呈 U 型曲线——开头和结尾关注度最高，中间指令最易被忽略。
 *   将 redLines、genreRules、continuityWarnings 等不可违反的硬约束放在 User Prompt 最末尾
 *   （紧挨输出指令前），利用 "近因效应（Recency Bias）" 最大化模型遵循率。
 *   同时 Deterministic Checker 在下游进行结构兜底，形成语义+规则双保险。
 */
export function buildUserPromptConstraintsTail(ctx: {
  redLines?: string[];
  genreRules?: string[];
  continuityWarnings?: string[];
}): string {
  const parts: string[] = [];

  if (ctx.genreRules?.length) {
    parts.push(`=== 本剧题材铁律（必须遵守）===\n${ctx.genreRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  }

  if (ctx.continuityWarnings?.length) {
    parts.push(`⚠️ 连续性警告（本次创作必须遵守以下修正建议）：\n${ctx.continuityWarnings.join('\n')}`);
  }

  if (ctx.redLines?.length) {
    parts.push(
      `🚨🚨🚨 === 不可违反的底线（RedLines）=== 🚨🚨🚨\n` +
      `以下是本剧的绝对禁区，任何输出都不得违反：\n` +
      `${ctx.redLines.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}\n` +
      `违反以上任何一条将导致整集作废重做。\n` +
      `🚨🚨🚨 ========================== 🚨🚨🚨`
    );
  }

  if (!parts.length) return '';
  return '\n\n' + parts.join('\n\n');
}

// re-export for backward compatibility
export { DRAMA_LANG_RULE } from './drama-agent-system-prompts';
export const DRAMA_ZH_RULE = '所有输出简体中文。';

// ─── 模板查找 ───────────────────────────────────────────────────────────────

function getTemplate(agentId: string, genreKey?: string): string {
  const entry = genreKey ? GENRE_TEMPLATES[genreKey] : undefined;
  const tpl = entry?.profile?.agentSystemPrompts?.[agentId];
  return tpl ?? GENRE_TEMPLATES['_custom']?.profile?.agentSystemPrompts?.[agentId] ?? '';
}

/**
 * 预配置题材（boss / sweet / biography / ... ）的模板是 WYSIWYG：题材规则已内联。
 * 此函数用于在 buildXxx 中判断是否应跳过 genreRules / adaptationNotes 等变量注入，
 * 避免 Profiler 生成的规则与模板内置规则重复出现（浪费 ~1500-2000 tokens/调用）。
 */
function isWysiwygGenre(genreKey?: string): boolean {
  return !!genreKey && genreKey !== '_custom';
}

// ─── 共享变量构建器 ─────────────────────────────────────────────────────────

function genreRulesBlock(rules?: string[], label?: string): string {
  if (!rules?.length) return '';
  const heading = label ?? '本剧题材铁律';
  return `\n=== ${heading} ===\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
}

/** 将 seed.redLines 格式化为不可违反的硬约束块，注入到所有下游 agent system prompt */
function redLinesBlock(redLines?: string[]): string {
  if (!redLines?.length) return '';
  return `\n\n🚫🚫🚫 === 不可违反的底线（RedLines）=== 🚫🚫🚫\n以下是本剧的绝对禁区，任何输出都不得违反：\n${redLines.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}\n违反以上任何一条将导致整集作废重做。\n🚫🚫🚫 ========================== 🚫🚫🚫`;
}

function adaptationBlock(ga?: GenreArchetype): string {
  if (!ga?.adaptationNotes) return '';
  return `\n=== 题材适配规则 ===\n${ga.adaptationNotes}\n`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 创建阶段 Agent（不写入 basePromptSnapshot，建剧流程中一次性使用）
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. Seed Analyzer ───
export function buildSeedAnalyzerSystemPrompt(ctx: {
  epMin: number; epMax: number; durSec: number; genre?: string;
  genreGuidance?: GenreProductionGuidance;
}): string {
  const { epMin, epMax, durSec } = ctx;
  const g = ctx.genreGuidance;
  return resolveTemplate(SEED_ANALYZER_TEMPLATE, {
    epMin: String(epMin),
    epMax: String(epMax),
    durSec: String(durSec),
    durMin: String(Math.round(durSec / 60)),
    narrativeModeTip: g?.narrativeModeTip ?? '',
    coreConflictExample: g?.coreConflictExample ?? '',
    coreLoopBlock: g?.coreLoopBlock ?? '',
    conflictBlock: g?.conflictBlock ?? '',
    paywallTip: g?.paywallTip ?? '',
    antagonistTip: g?.antagonistTip ?? '',
    historicalConstraint: g?.historicalConstraint ?? '',
  });
}

// ─── 2. Series Director ───
export function buildSeriesDirectorSystemPrompt(ctx: {
  targetEp: number; epMin: number; epMax: number; durSec: number;
  genre?: string;
  genreGuidance?: GenreProductionGuidance;
}): string {
  const { targetEp, epMin, epMax, durSec } = ctx;
  const g = ctx.genreGuidance;

  const arcStructureHint = g?.arcStructureHint ?? '';

  return resolveTemplate(SERIES_DIRECTOR_CREATION_TEMPLATE, {
    targetEp: String(targetEp),
    epMin: String(epMin),
    epMax: String(epMax),
    durSec: String(durSec),
    paywallHint: g?.paywallStrategyHint ?? '',
    arcStructureHint,
    episodeTitleExample: g?.episodeTitleExample ?? '',
    durSecMin: String(Math.round(durSec * 0.8)),
    durSecMax: String(Math.round(durSec * 1.2)),
    historicalConstraint: g?.historicalConstraint ? HISTORICAL_CONSTRAINT_NOTE : '',
  });
}

// ─── 3. Visual Asset Designer ───
export function buildVisualAssetDesignerSystemPrompt(
  _visualStyle?: string,
  styleGuide?: Pick<VisualStyleGuide, 'facePromptRule' | 'scenePromptGuidance'>,
  genreGuidance?: Pick<GenreProductionGuidance, 'maleLeadFormula' | 'femaleLeadFormula'>,
): string {
  const maleFormula = genreGuidance?.maleLeadFormula
    ? `=== 本剧题材主角颜值定向 ===\n短剧有极强的类型视觉语言——观众在开头3秒靠主角外形判断"这是不是我要看的剧"。\n\n**本剧男主颜值要求：** ${genreGuidance.maleLeadFormula}\n\n**本剧女主颜值要求：** ${genreGuidance.femaleLeadFormula ?? DEFAULT_FEMALE_LEAD_FORMULA}\n\n⚠️ 以上是本剧的颜值铁律，角色设计必须精准命中，不可用通用帅气/漂亮模糊处理。`
    : `=== 主角颜值定向 ===\n短剧有极强的类型视觉语言——主角颜值必须精准命中题材审美预期，不可用通用帅气/漂亮模糊处理。根据本剧题材和目标受众，设计符合该类型短剧市场惯例的外形定位。`;
  const femaleFormula = '';

  const faceDedup = `\n⚠️ faceReferencePrompt 禁止包含全局风格词（如 cinematic / 4K / photorealistic / masterpiece / ultra-detailed / award-winning / live-action photography 等），这些词已由系统 styleReferencePrompt 统一注入。在 faceReferencePrompt 中重复写会浪费 token 预算。faceReferencePrompt 只写面部五官+年龄+表情+肤色描述。`;
  const visualStyleDesc = styleGuide?.facePromptRule
    ? `=== faceReferencePrompt 规则 ===\n${styleGuide.facePromptRule}\n${faceDedup}\n\n${styleGuide.scenePromptGuidance ? `=== 本剧场景 visualPrompt 写法规范 ===\n${styleGuide.scenePromptGuidance}\n\n` : ''}`
    : '';

  return resolveTemplate(VISUAL_ASSET_DESIGNER_TEMPLATE, {
    visualStyleDesc,
    maleFormula,
    femaleFormula,
  });
}

// ─── 4. Profiler ───
export function buildProfilerSystemPrompt(
  genreKey?: string,
  _templateProfile?: Record<string, unknown>,
): string {
  const entry = genreKey ? GENRE_TEMPLATES[genreKey] : undefined;
  const profile = entry?.profile;

  const genreGuideBlock = profile?.profilerGuide
    ? `=== 题材专家身份 ===\n${profile.profilerGuide}\n\n`
    : '';
  const genreNameLock = genreKey && genreKey !== '_custom'
    ? `\n⚠️ 你正在为【${entry?.displayName ?? genreKey}】题材生成编剧手册。\n`
    : '';

  const hasCam = !!profile?.cameraStyleGuide;
  const hasAudio = !!profile?.audioStyleGuide;
  const hasReviewer = !!profile?.reviewerCalibration;
  const hasArc = !!profile?.arcDirectorGuide;
  const hasEpisode = !!profile?.episodeDirectorGuide;
  const hasPacing = !!profile?.pacingAnalyzerGuide;

  const templateFieldsNote = (hasCam || hasAudio || hasReviewer || hasArc || hasEpisode || hasPacing)
    ? '\n⚠️ 以下部分字段已由题材模板预配置，你只需输出空对象或 null。详见各字段说明。\n'
    : '';

  const archetypeSection = `0. genreArchetype：题材原型参数\n   请根据种子的题材特征选择值。adaptationNotes 为【必填】纯文本。`;
  const coreIdentityHint = profile?.profilerGuide ? PROFILER_CORE_IDENTITY_WITH_GUIDE : PROFILER_CORE_IDENTITY_DEFAULT;
  const cameraSection = hasCam ? PROFILER_CAMERA_PRECONFIGURED : PROFILER_CAMERA_GENERATE;
  const audioSection = hasAudio ? PROFILER_AUDIO_PRECONFIGURED : PROFILER_AUDIO_GENERATE;
  const reviewerSection = hasReviewer ? PROFILER_REVIEWER_PRECONFIGURED : PROFILER_REVIEWER_GENERATE;
  const arcSection = hasArc ? PROFILER_ARC_PRECONFIGURED : PROFILER_ARC_GENERATE;
  const episodeSection = hasEpisode ? PROFILER_EPISODE_PRECONFIGURED : PROFILER_EPISODE_GENERATE;
  const pacingSection = hasPacing ? PROFILER_PACING_PRECONFIGURED : PROFILER_PACING_GENERATE;

  // soulViews section
  const agentSoulPrompts = profile?.agentSoulPrompts;
  let soulSection: string;
  if (agentSoulPrompts) {
    const lines = [PROFILER_SOUL_HEADER];
    for (const [key, guide] of Object.entries(agentSoulPrompts)) {
      lines.push(`- soulViews.${key}：${guide}`);
    }
    soulSection = lines.join('\n');
  } else {
    soulSection = PROFILER_SOUL_DEFAULT;
  }

  return resolveTemplate(PROFILER_TEMPLATE, {
    genreGuideBlock,
    genreNameLock,
    templateFieldsNote,
    archetypeSection,
    coreIdentityHint,
    cameraSection,
    audioSection,
    reviewerSection,
    arcSection,
    episodeSection,
    pacingSection,
    soulSection,
  });
}

// ─── 5. Strategy ───
export function buildStrategySystemPrompt(ctx?: {
  genreGuidance?: GenreProductionGuidance;
}): string {
  const g = ctx?.genreGuidance;
  return resolveTemplate(STRATEGY_TEMPLATE, {
    contractHint: g?.contractHint ?? '',
    toneHint: g?.toneHint ?? '',
    paywallHint: g?.paywallStrategyHint
      ? `   ${g.paywallStrategyHint}`
      : `   - firstPaywallEpisode：第一个付费卡点集号（通常8-15集）\n   - paywallInterval：后续付费间隔（3-8集）`,
    hookTypesHint: g?.hookTypesHint ?? '',
    freeEpHint: g?.freeEpisodeHint ?? '',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pipeline Agent 函数（12 个，写入 basePromptSnapshot）
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 6. Arc Director ───
export function buildArcDirectorSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  redLines?: string[];
  arcDirectorGuide?: { genreSegmentPrinciples?: string; characterArcPrinciples?: string; conflictRhythm?: string };
}, genreKey?: string): string {
  const template = getTemplate('arc-director', genreKey);
  const wysiwyg = isWysiwygGenre(genreKey);
  // redLines 和 genreRules 已迁移至 User Prompt 尾部注入（Lost-in-the-Middle 对策），此处不再拼接
  return resolveTemplate(template, {
    arcPrinciples: ctx?.arcDirectorGuide?.genreSegmentPrinciples?.trim() || '',
    characterArcPrinciples: ctx?.arcDirectorGuide?.characterArcPrinciples?.trim() || '',
    conflictRhythm: ctx?.arcDirectorGuide?.conflictRhythm?.trim() || '',
    genreRules: wysiwyg ? '' : genreRulesBlock(ctx?.genreRules, '本剧题材铁律（段落规划必须遵守）'),
    adaptationNotes: wysiwyg ? '' : adaptationBlock(ctx?.genreArchetype),
  }) + CHARACTER_INTENSITY_PROGRESSION;
}

// ─── 6.5 Arc Expansion ───
export function buildArcExpansionSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  redLines?: string[];
}, genreKey?: string): string {
  // redLines 已迁移至 User Prompt 尾部注入（Lost-in-the-Middle 对策）
  return resolveTemplate(ARC_EXPANSION_TEMPLATE, {
    genreRules: genreRulesBlock(ctx?.genreRules, '本剧题材铁律（集级概要必须遵守）'),
    adaptationNotes: adaptationBlock(ctx?.genreArchetype),
  });
}

// ─── 7. Episode Director ───
export function buildEpisodeDirectorSystemPrompt(ctx?: {
  maxPresentPerEpisode?: number;
  genreArchetype?: GenreArchetype;
  visualStyle?: { overallAesthetic?: string; colorGrading?: string; lightingStyle?: string; renderTechnique?: string; shotStyleGuide?: string };
  genreRules?: string[];
  redLines?: string[];
  episodeDirectorGuide?: { emotionBeatExample?: string; tensionCurveNotes?: string; hookPatterns?: string };
}, genreKey?: string): string {
  const template = getTemplate('episode-director', genreKey);
  const wysiwyg = isWysiwygGenre(genreKey);
  const epGuide = ctx?.episodeDirectorGuide;
  const shotStyleHint = ctx?.visualStyle?.shotStyleGuide ?? '';
  // redLines 和 genreRules 已迁移至 User Prompt 尾部注入（Lost-in-the-Middle 对策）
  return resolveTemplate(template, {
    maxChars: String(ctx?.maxPresentPerEpisode ?? 4),
    // WYSIWYG 模板已内联情绪节拍示例/张力曲线/钩子模式，Profiler 生成的仅作 _custom 回退
    emotionBeatSection: wysiwyg ? '' : (epGuide?.emotionBeatExample?.trim() || ''),
    tensionCurveSection: wysiwyg ? '' : (epGuide?.tensionCurveNotes?.trim()
      ? `\n【题材专属张力曲线补充】\n${epGuide.tensionCurveNotes.trim()}\n`
      : ''),
    hookPatternsSection: wysiwyg ? '' : (epGuide?.hookPatterns?.trim()
      ? `\n=== 题材专属集末钩子模式 ===\n${epGuide.hookPatterns.trim()}\n`
      : ''),
    shotStyleSection: shotStyleHint ? `\n=== 本剧镜头风格指导 ===\n${shotStyleHint}` : '',
    genreRules: wysiwyg ? '' : genreRulesBlock(ctx?.genreRules, '本剧题材铁律（规划意图时必须遵守）'),
    adaptationNotes: wysiwyg ? '' : adaptationBlock(ctx?.genreArchetype),
  }) + FIRST_EPISODE_CONSTRAINTS;
}

// ─── 8. Continuity Guard ───
export function buildContinuityGuardSystemPrompt(ctx?: {
  genreSpecificChecks?: string[];
}, genreKey?: string): string {
  const template = getTemplate('continuity-guard', genreKey);
  const wysiwyg = isWysiwygGenre(genreKey);
  const checks = ctx?.genreSpecificChecks;
  return resolveTemplate(template, {
    // WYSIWYG 模板已内联题材专项检查，Profiler 生成的仅作 _custom 回退
    genreSpecificChecks: wysiwyg ? '' : (checks?.length
      ? `\n=== 题材专项检查 ===\n${checks.map((c, i) => `${13 + i}. ${c}`).join('\n')}\n`
      : ''),
  });
}

// ─── 9. Scriptwriter ───
export function buildScriptwriterSystemPrompt(ctx: {
  guide?: { coreIdentity?: string; genreRules?: string[]; dialogueGuide?: string; pacingGuide?: string; visualNarrativeGuide?: string; forbiddenPatterns?: string[] };
  visualStyle?: { overallAesthetic?: string; colorGrading?: string; lightingStyle?: string; renderTechnique?: string; textureStyle?: string; referenceStyle?: string; scriptDialogueGuide?: string };
  genreArchetype?: GenreArchetype;
}, genreKey?: string): string {
  const { guide, visualStyle } = ctx;
  const template = getTemplate('scriptwriter', genreKey);
  const styleDialogueTone = visualStyle?.scriptDialogueGuide ?? '';
  return resolveTemplate(template, {
    coreIdentity: guide?.coreIdentity ?? '',
    styleDialogueTone: styleDialogueTone ? `=== 视觉风格驱动的台词风格 ===\n${styleDialogueTone}\n` : '',
    genreRules: guide?.genreRules?.map((r, i) => `${i + 1}. ${r}`).join('\n') ?? '',
    dialogueGuide: guide?.dialogueGuide ?? '',
    pacingGuide: guide?.pacingGuide ?? '',
    visualNarrativeGuide: guide?.visualNarrativeGuide ?? '',
    forbiddenPatterns: guide?.forbiddenPatterns?.join('、') ?? '',
    adaptationNotes: adaptationBlock(ctx.genreArchetype),
  });
}

// ─── 10. Dialogue Coach ───
export function buildDialogueCoachSystemPrompt(ctx?: {
  dialogueGuide?: string;
  adaptationNotes?: string;
}, genreKey?: string): string {
  const template = getTemplate('dialogue-coach', genreKey);
  return resolveTemplate(template, {
    dialogueGuide: ctx?.dialogueGuide?.trim() || '',
    adaptationSection: ctx?.adaptationNotes
      ? `\n=== 本剧台词适配规则（题材专属，最高优先级）===\n${ctx.adaptationNotes}\n`
      : '',
  });
}

// ─── 11. Storyboard Director（Static: 基底模板，不含场景级动态上下文）───
export function buildStoryboardDirectorStaticPrompt(ctx?: {
  camGuide?: {
    preferredAngles?: string[];
    signatureTechniques?: string[];
    transitionStyle?: string;
    cinematographyDirective?: string | null;
    genreEmotionNotes?: string;
    genreIdentity?: string;
    genreCoreRules?: string;
    genreNarrativePrinciples?: string;
    colorPalette?: string;
  };
  visualStyle?: { overallAesthetic?: string; colorGrading?: string; lightingStyle?: string; renderTechnique?: string; textureStyle?: string; referenceStyle?: string };
  /** 视频模型能力档案，用于注入时长/Prompt约束 */
  videoModelProfile?: {
    displayName: string;
    minDurationSec: number;
    maxDurationSec: number;
    sweetSpotSec: number;
    promptStyleHint: string;
    strengthHint: string;
    constraintHint: string;
  };
}, genreKey?: string): string {
  const template = getTemplate('storyboard-director', genreKey);
  const cam = ctx?.camGuide;
  const vs = ctx?.visualStyle;
  const vmp = ctx?.videoModelProfile;

  const visualStyleSection = vs
    ? `美学：${vs.overallAesthetic ?? ''} | 调色：${vs.colorGrading ?? ''} | 光影：${vs.lightingStyle ?? ''}${vs.renderTechnique ? ` | 渲染：${vs.renderTechnique}` : ''}${vs.textureStyle ? ` | 材质：${vs.textureStyle}` : ''}${vs.referenceStyle ? ` | 参考：${vs.referenceStyle}` : ''}`
    : '';

  const videoModelSection = vmp
    ? [
        `本剧使用 ${vmp.displayName} 视频生成模型。`,
        `- 模型能力：${vmp.strengthHint}`,
        `- ${vmp.constraintHint}`,
        `- 推荐每个Shot时长 ${vmp.sweetSpotSec} 秒（允许范围 ${vmp.minDurationSec}-${vmp.maxDurationSec} 秒）`,
        `- Prompt 风格：${vmp.promptStyleHint}`,
      ].join('\n')
    : '- 每个Shot时长建议5-8秒（黄金镜头/高潮可至10-12秒）';

  return resolveTemplate(template, {
    genreIdentity: cam?.genreIdentity?.trim() || '',
    camTechSection: buildCamTechSection(cam),
    genreCoreRulesSection: cam?.genreCoreRules?.trim()
      ? `=== 【题材分镜核心原则】===\n${cam.genreCoreRules.trim()}\n`
      : '',
    genreEmotionSection: cam?.genreEmotionNotes?.trim()
      ? `【本题材专属情绪-运镜映射（优先使用）】\n${cam.genreEmotionNotes.trim()}\n\n【通用参考表】\n`
      : '',
    genreNarrativePrinciplesSection: cam?.genreNarrativePrinciples?.trim()
      ? `=== 【题材叙事镜头思维】===\n${cam.genreNarrativePrinciples.trim()}\n`
      : '',
    colorPaletteSection: cam?.colorPalette?.trim()
      ? `=== 【题材色彩调性】===\n${cam.colorPalette.trim()}\n请在 firstFramePrompt / lastFramePrompt 的光线与色彩描述中优先使用上述调性。\n`
      : '',
    visualStyleSection,
    videoModelSection,
  });
}

/** 场景级动态上下文（运行时注入，不写入 basePromptSnapshot） */
export function buildStoryboardSceneContext(ctx: {
  camGuide?: { genrePurposeDirectives?: Record<string, string> };
  maxShots: number;
  targetDur: number;
  scenePurpose?: string;
  isLastScene?: boolean;
  intentEmotionDirection?: string;
  hookDirection?: string;
  emotionBeats?: readonly { beatId?: string; startPct?: number; endPct?: number; emotion?: string; intensity?: number; trigger?: string }[];
}): string {
  const { maxShots, targetDur, scenePurpose, isLastScene, intentEmotionDirection, hookDirection, emotionBeats } = ctx;
  const parts: string[] = [];

  // purpose directive
  const genreOverride = scenePurpose ? ctx.camGuide?.genrePurposeDirectives?.[scenePurpose] : undefined;
  if (genreOverride) {
    const GOLDEN = ['climax', 'confrontation', 'revelation', 'cliffhanger'];
    const qt = GOLDEN.includes(scenePurpose!) ? 'golden' : (scenePurpose === 'transition' ? 'filler' : 'standard');
    const label = { climax: '高潮', confrontation: '对峙', revelation: '揭秘', cliffhanger: '悬念收尾', romantic: '情感', action: '动作', transition: '过场' }[scenePurpose!] ?? scenePurpose;
    parts.push(resolveTemplate(PURPOSE_OVERRIDE_FORMAT, { purposeLabel: label!, genrePurposeOverride: genreOverride, qualityTier: qt }));
  } else if (scenePurpose) {
    parts.push(PURPOSE_DIRECTIVE_TEMPLATES[scenePurpose] ?? PURPOSE_DIRECTIVE_TEMPLATES['_default']);
  }

  // hook direction for last scene
  if (isLastScene && hookDirection) {
    parts.push(resolveTemplate(SCENE_CONTEXT_HOOK, { hookDirection }));
  }

  // intent emotion direction
  if (intentEmotionDirection) {
    parts.push(resolveTemplate(SCENE_CONTEXT_EMOTION_DIRECTION, { intentEmotionDirection }));
  }

  // emotion beats
  if (emotionBeats?.length) {
    const beatLines = emotionBeats.map(eb =>
      `- [${eb.beatId ?? ''}] ${Math.round((eb.startPct ?? 0) * 100)}%-${Math.round((eb.endPct ?? 0) * 100)}% | ${eb.emotion ?? ''} (强度${eb.intensity ?? 0}) | 触发：${eb.trigger ?? ''}`
    ).join('\n');
    parts.push(`=== 秒级情绪节拍（本场景对应的情绪曲线段）===\n${beatLines}\n\n${EMOTION_BEAT_ALIGNMENT_RULES}`);
  }

  // constraints
  parts.push(resolveTemplate(SCENE_CONTEXT_CONSTRAINTS, { maxShots: String(maxShots), targetDur: String(targetDur) }));

  return parts.join('\n\n');
}

// ─── 12. Audio Director（Static: 基底模板）───
export function buildAudioDirectorStaticPrompt(ctx?: {
  audioGuide?: {
    bgmMoodPreferences?: string[];
    sfxDensity?: string;
    silenceUsage?: string;
    voiceActingStyle?: string;
    genreBrandingDirective?: string | null;
  };
}, genreKey?: string): string {
  const template = getTemplate('audio-director', genreKey);
  const ag = ctx?.audioGuide;
  return resolveTemplate(template, {
    genreBrandingSection: ag?.genreBrandingDirective
      ? `=== 题材专属音频品牌 ===\n${ag.genreBrandingDirective}\n`
      : '',
    bgmMoodPreferences: ag?.bgmMoodPreferences?.length
      ? `BGM偏好：${ag.bgmMoodPreferences.join('、')}\n`
      : '',
    sfxDensity: ag?.sfxDensity ?? DEFAULT_SFX_DENSITY,
    silenceUsage: ag?.silenceUsage ?? DEFAULT_SILENCE_USAGE,
    voiceActingStyle: ag?.voiceActingStyle ?? DEFAULT_VOICE_ACTING_STYLE,
  });
}

/** 集级情绪节拍上下文（运行时注入） */
export function buildAudioEpisodeContext(ctx: {
  emotionBeats?: readonly { beatId?: string; startPct?: number; endPct?: number; emotion?: string; intensity?: number; trigger?: string }[];
}): string {
  if (!ctx.emotionBeats?.length) return '';
  const beatLines = ctx.emotionBeats.map(eb =>
    `- [${eb.beatId ?? ''}] ${Math.round((eb.startPct ?? 0) * 100)}%-${Math.round((eb.endPct ?? 0) * 100)}% | ${eb.emotion ?? ''} (强度${eb.intensity ?? 0}) | ${eb.trigger ?? ''}`
  ).join('\n');
  return `${AUDIO_CONTEXT_HEADER}\n${beatLines}\n${AUDIO_CONTEXT_FOOTER}`;
}

// ─── 13. Script Reviewer ───
export function buildScriptReviewerSystemPrompt(ctx?: {
  weights?: Record<string, number>;
  genreChecks?: string[];
  dialogueGuide?: string;
}, genreKey?: string): string {
  const template = getTemplate('script-reviewer', genreKey);
  const dw = ctx?.weights;
  return resolveTemplate(template, {
    wt_visualImpact: String(dw?.visualImpact ?? 1.2),
    wt_dialogueNaturalness: String(dw?.dialogueNaturalness ?? 1.2),
    wt_pacing: String(dw?.pacing ?? 1.0),
    wt_hookStrength: String(dw?.hookStrength ?? 1.3),
    wt_consistency: String(dw?.consistency ?? 1.0),
    wt_emotionalImpact: String(dw?.emotionalImpact ?? 1.0),
    dialogueStyleHint: ctx?.dialogueGuide?.trim()
      ? ctx.dialogueGuide.trim().slice(0, 60) + '…'
      : '',
    genreChecksSection: ctx?.genreChecks?.length
      ? `\n=== 题材专项检查 ===\n${ctx.genreChecks.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n`
      : '',
  });
}

// ─── 14. Script Editor ───
export function buildScriptEditorSystemPrompt(ctx?: {
  dialogueGuide?: string;
}, genreKey?: string): string {
  const template = getTemplate('script-editor', genreKey);
  return resolveTemplate(template, {
    dialogueStyleHint: ctx?.dialogueGuide?.trim()
      ? ctx.dialogueGuide.trim().slice(0, 80)
      : '',
  });
}

// ─── 15. Pacing Analyzer ───
export function buildPacingAnalyzerSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  pacingAnalyzerGuide?: { genreRhythmTemplate?: string; paceIndicators?: string };
}, genreKey?: string): string {
  const template = getTemplate('pacing-analyzer', genreKey);
  const wysiwyg = isWysiwygGenre(genreKey);
  const pg = ctx?.pacingAnalyzerGuide;
  return resolveTemplate(template, {
    paceIndicatorsBlock: wysiwyg ? '' : (pg?.paceIndicators?.trim() || ''),
    genreRhythmBlock: wysiwyg ? '' : (pg?.genreRhythmTemplate?.trim()
      ? `\n【题材专属理想节奏模板】\n${pg.genreRhythmTemplate.trim()}\n`
      : ''),
    adaptationNotes: wysiwyg ? '' : adaptationBlock(ctx?.genreArchetype),
    genreRules: wysiwyg ? '' : genreRulesBlock(ctx?.genreRules, '本剧题材铁律（节奏评估必须结合这些规则）'),
  });
}

// ─── 16. Hook Crafter（Static: 基底模板）───
export function buildHookCrafterStaticPrompt(ctx?: {
  strategy?: { avoidRecentRepeatWindow?: number; preferredTypes?: string[]; urgencyBias?: string };
  genreRules?: string[];
  genreArchetype?: Pick<GenreArchetype, 'adaptationNotes'>;
  extraHookTypes?: string;
}, genreKey?: string): string {
  const template = getTemplate('hook-crafter', genreKey);
  const wysiwyg = isWysiwygGenre(genreKey);
  const strategy = ctx?.strategy;
  return resolveTemplate(template, {
    extraHookTypes: ctx?.extraHookTypes?.trim()
      ? `\n${ctx.extraHookTypes.trim()}`
      : '',
    genreHookGuidance: wysiwyg ? '' : (ctx?.genreArchetype?.adaptationNotes?.trim()
      ? `\n=== 本剧题材适配规则（悬念设计必须遵循）===\n${ctx.genreArchetype.adaptationNotes.trim()}\n`
      : ''),
    avoidRepeatWindow: String(strategy?.avoidRecentRepeatWindow ?? 3),
    preferredTypes: strategy?.preferredTypes?.join('、') || '无特殊偏好',
    urgencyBias: strategy?.urgencyBias ?? 'aggressive',
    genreRules: wysiwyg ? '' : genreRulesBlock(ctx?.genreRules, '本剧题材铁律（悬念设计必须符合）'),
  });
}

/** 角色 ID 白名单约束（运行时注入） */
export function buildHookCharacterConstraint(ctx: {
  validCharacterIds?: string[];
}): string {
  if (!ctx.validCharacterIds?.length) return '';
  return resolveTemplate(HOOK_CONSTRAINT_TEMPLATE, {
    characterIds: ctx.validCharacterIds.join(', '),
  });
}

// ─── 17. Episode Recorder ───
export function buildEpisodeRecorderSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
}, genreKey?: string): string {
  const template = getTemplate('episode-recorder', genreKey);
  return resolveTemplate(template, {
    adaptationNotes: isWysiwygGenre(genreKey) ? '' : adaptationBlock(ctx?.genreArchetype),
  });
}
