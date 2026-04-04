import {
  PURPOSE_DIRECTIVE_TEMPLATES,
  PURPOSE_OVERRIDE_FORMAT,
  SCENE_CONTEXT_HOOK,
  SCENE_CONTEXT_EMOTION_DIRECTION,
  SCENE_CONTEXT_CONSTRAINTS,
  HOOK_CONSTRAINT_TEMPLATE,
  AUDIO_CONTEXT_FOOTER,
  AUDIO_CONTEXT_HEADER,
} from './shared.prompts';
import { GenreArchetype } from '../schemas/drama-state.schemas';
import { GenreProductionGuidance } from '../../template/entities/drama-genre-template.entity';
import { VisualStyleGuide } from '../../template/entities/drama-visual-style-template.entity';


export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── User Prompt 尾部强制约束块 ─────────────────────────────────────────────
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

export const DRAMA_ZH_RULE = '所有输出简体中文。';
export const DRAMA_LANG_RULE = DRAMA_ZH_RULE;


// ═══════════════════════════════════════════════════════════════════════════════
// 创建阶段 Agent
// ═══════════════════════════════════════════════════════════════════════════════

export function buildSeedAnalyzerSystemPrompt(ctx: {
  epMin: number; epMax: number; durSec: number; genre?: string;
  genreGuidance?: GenreProductionGuidance;
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildSeriesDirectorSystemPrompt(ctx: {
  targetEp: number; epMin: number; epMax: number; durSec: number;
  genre?: string;
  genreGuidance?: GenreProductionGuidance;
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildVisualAssetDesignerSystemPrompt(
  _visualStyle?: string,
  styleGuide?: Pick<VisualStyleGuide, 'facePromptRule' | 'scenePromptGuidance'>,
  genreGuidance?: Pick<GenreProductionGuidance, 'maleLeadFormula' | 'femaleLeadFormula'>,
  basePrompt?: string,
): string {
  const maleFormula = genreGuidance?.maleLeadFormula
    ? `=== 本剧题材主角颜值定向 ===\n短剧有极强的类型视觉语言——观众在开头3秒靠主角外形判断"这是不是我要看的剧"。\n\n**本剧男主颜值要求：** ${genreGuidance.maleLeadFormula}\n\n**本剧女主颜值要求：** ${genreGuidance.femaleLeadFormula ?? ''}\n\n⚠️ 以上是本剧的颜值铁律，角色设计必须精准命中，不可用通用帅气/漂亮模糊处理。`
    : `=== 主角颜值定向 ===\n短剧有极强的类型视觉语言——主角颜值必须精准命中题材审美预期，不可用通用帅气/漂亮模糊处理。根据本剧题材和目标受众，设计符合该类型短剧市场惯例的外形定位。`;
  const femaleFormula = '';

  const faceDedup = `\n⚠️ faceReferencePrompt 禁止包含全局风格词（如 cinematic / 4K / photorealistic / masterpiece / ultra-detailed / award-winning / live-action photography 等），这些词已由系统 styleReferencePrompt 统一注入。在 faceReferencePrompt 中重复写会浪费 token 预算。faceReferencePrompt 只写面部五官+年龄+表情+肤色描述。`;
  const visualStyleDesc = styleGuide?.facePromptRule
    ? `=== faceReferencePrompt 规则 ===\n${styleGuide.facePromptRule}\n${faceDedup}\n\n${styleGuide.scenePromptGuidance ? `=== 本剧场景 visualPrompt 写法规范 ===\n${styleGuide.scenePromptGuidance}\n\n` : ''}`
    : '';

  const template = basePrompt ?? ''; 
  return resolveTemplate(template, {
    visualStyleDesc,
    maleFormula,
    femaleFormula,
  });
}

export function buildProfilerSystemPrompt(
  basePrompt?: string,
  _templateProfile?: Record<string, unknown>,
): string {
  return basePrompt ?? '';
}

export function buildStrategySystemPrompt(ctx?: {}, basePrompt?: string): string {
  return basePrompt ?? '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pipeline Agent 函数
// ═══════════════════════════════════════════════════════════════════════════════

export function buildArcDirectorSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  redLines?: string[];
  arcDirectorGuide?: { genreSegmentPrinciples?: string; characterArcPrinciples?: string; conflictRhythm?: string };
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildArcExpansionSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  redLines?: string[];
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildEpisodeDirectorSystemPrompt(ctx?: {
  maxPresentPerEpisode?: number;
  genreArchetype?: GenreArchetype;
  visualStyle?: { overallAesthetic?: string; colorGrading?: string; lightingStyle?: string; renderTechnique?: string; shotStyleGuide?: string };
  genreRules?: string[];
  redLines?: string[];
  episodeDirectorGuide?: { emotionBeatExample?: string; tensionCurveNotes?: string; hookPatterns?: string };
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
  const shotStyleHint = ctx?.visualStyle?.shotStyleGuide ?? '';
  return resolveTemplate(template, {
    maxChars: String(ctx?.maxPresentPerEpisode ?? 4),
    shotStyleSection: shotStyleHint ? `\n=== 本剧镜头风格指导 ===\n${shotStyleHint}` : '',
  });
}

export function buildContinuityGuardSystemPrompt(ctx?: {
  genreSpecificChecks?: string[];
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildScriptwriterSystemPrompt(ctx: {
  guide?: { coreIdentity?: string; genreRules?: string[]; dialogueGuide?: string; pacingGuide?: string; visualNarrativeGuide?: string; forbiddenPatterns?: string[] };
  visualStyle?: { overallAesthetic?: string; colorGrading?: string; lightingStyle?: string; renderTechnique?: string; textureStyle?: string; referenceStyle?: string; scriptDialogueGuide?: string };
  genreArchetype?: GenreArchetype;
}, basePrompt?: string): string {
  const { guide, visualStyle } = ctx;
  const template = basePrompt ?? '';
  const styleDialogueTone = visualStyle?.scriptDialogueGuide ?? '';
  return resolveTemplate(template, {
    coreIdentity: guide?.coreIdentity ?? '',
    styleDialogueTone: styleDialogueTone ? `=== 视觉风格驱动的台词风格 ===\n${styleDialogueTone}\n` : '',
    genreRules: guide?.genreRules?.map((r, i) => `${i + 1}. ${r}`).join('\n') ?? '',
    dialogueGuide: guide?.dialogueGuide ?? '',
    pacingGuide: guide?.pacingGuide ?? '',
    visualNarrativeGuide: guide?.visualNarrativeGuide ?? '',
    forbiddenPatterns: guide?.forbiddenPatterns?.join('、') ?? '',
  });
}

export function buildDialogueCoachSystemPrompt(ctx?: {
  dialogueGuide?: string;
  adaptationNotes?: string;
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
  return resolveTemplate(template, {
    dialogueGuide: ctx?.dialogueGuide?.trim() || '',
    adaptationSection: ctx?.adaptationNotes
      ? `\n=== 本剧台词适配规则（题材专属，最高优先级）===\n${ctx.adaptationNotes}\n`
      : '',
  });
}

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
  videoModelProfile?: {
    displayName: string;
    minDurationSec: number;
    maxDurationSec: number;
    sweetSpotSec: number;
    promptStyleHint: string;
    strengthHint: string;
    constraintHint: string;
  };
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
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

  const camTechParts = [];
  if (cam?.preferredAngles?.length) camTechParts.push(`运镜：${cam.preferredAngles.join(', ')}`);
  if (cam?.transitionStyle) camTechParts.push(`转场：${cam.transitionStyle}`);
  if (cam?.cinematographyDirective) camTechParts.push(`光影摄影：${cam.cinematographyDirective}`);
  const camTechSection = camTechParts.length ? `=== 摄影组技术规范 ===\n${camTechParts.join('\n')}\n` : '';

  return resolveTemplate(template, {
    genreIdentity: cam?.genreIdentity?.trim() || '',
    camTechSection,
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

  const genreOverride = scenePurpose ? ctx.camGuide?.genrePurposeDirectives?.[scenePurpose] : undefined;
  if (genreOverride) {
    const GOLDEN = ['climax', 'confrontation', 'revelation', 'cliffhanger'];
    const qt = GOLDEN.includes(scenePurpose!) ? 'golden' : (scenePurpose === 'transition' ? 'filler' : 'standard');
    const label = { climax: '高潮', confrontation: '对峙', revelation: '揭秘', cliffhanger: '悬念收尾', romantic: '情感', action: '动作', transition: '过场' }[scenePurpose!] ?? scenePurpose;
    parts.push(resolveTemplate(PURPOSE_OVERRIDE_FORMAT, { purposeLabel: label!, genrePurposeOverride: genreOverride, qualityTier: qt }));
  } else if (scenePurpose) {
    parts.push(PURPOSE_DIRECTIVE_TEMPLATES[scenePurpose] ?? PURPOSE_DIRECTIVE_TEMPLATES['_default']);
  }

  if (isLastScene && hookDirection) {
    parts.push(resolveTemplate(SCENE_CONTEXT_HOOK, { hookDirection }));
  }

  if (intentEmotionDirection) {
    parts.push(resolveTemplate(SCENE_CONTEXT_EMOTION_DIRECTION, { intentEmotionDirection }));
  }

  if (emotionBeats?.length) {
    const beatLines = emotionBeats.map(eb =>
      `- [${eb.beatId ?? ''}] ${Math.round((eb.startPct ?? 0) * 100)}%-${Math.round((eb.endPct ?? 0) * 100)}% | ${eb.emotion ?? ''} (强度${eb.intensity ?? 0}) | 触发：${eb.trigger ?? ''}`
    ).join('\n');
    parts.push(`=== 秒级情绪节拍（本场景对应的情绪曲线段）===\n${beatLines}`);
  }

  parts.push(resolveTemplate(SCENE_CONTEXT_CONSTRAINTS, { maxShots: String(maxShots), targetDur: String(targetDur) }));
  return parts.join('\n\n');
}

export function buildAudioDirectorStaticPrompt(ctx?: {
  audioGuide?: {
    bgmMoodPreferences?: string[];
    sfxDensity?: string;
    silenceUsage?: string;
    voiceActingStyle?: string;
    genreBrandingDirective?: string | null;
  };
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
  const ag = ctx?.audioGuide;
  return resolveTemplate(template, {
    genreBrandingSection: ag?.genreBrandingDirective
      ? `=== 题材专属音频品牌 ===\n${ag.genreBrandingDirective}\n`
      : '',
    bgmMoodPreferences: ag?.bgmMoodPreferences?.length
      ? `BGM偏好：${ag.bgmMoodPreferences.join('、')}\n`
      : '',
    sfxDensity: ag?.sfxDensity ?? '',
    silenceUsage: ag?.silenceUsage ?? '',
    voiceActingStyle: ag?.voiceActingStyle ?? '',
  });
}

export function buildAudioEpisodeContext(ctx: {
  emotionBeats?: readonly { beatId?: string; startPct?: number; endPct?: number; emotion?: string; intensity?: number; trigger?: string }[];
}): string {
  if (!ctx.emotionBeats?.length) return '';
  const beatLines = ctx.emotionBeats.map(eb =>
    `- [${eb.beatId ?? ''}] ${Math.round((eb.startPct ?? 0) * 100)}%-${Math.round((eb.endPct ?? 0) * 100)}% | ${eb.emotion ?? ''} (强度${eb.intensity ?? 0}) | ${eb.trigger ?? ''}`
  ).join('\n');
  return `${AUDIO_CONTEXT_HEADER}\n${beatLines}\n${AUDIO_CONTEXT_FOOTER}`;
}

export function buildScriptReviewerSystemPrompt(ctx?: {
  weights?: Record<string, number>;
  genreChecks?: string[];
  dialogueGuide?: string;
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
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

export function buildScriptEditorSystemPrompt(ctx?: {
  dialogueGuide?: string;
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
  return resolveTemplate(template, {
    dialogueStyleHint: ctx?.dialogueGuide?.trim()
      ? ctx.dialogueGuide.trim().slice(0, 80)
      : '',
  });
}

export function buildPacingAnalyzerSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
  pacingAnalyzerGuide?: { genreRhythmTemplate?: string; paceIndicators?: string };
}, basePrompt?: string): string {
  return basePrompt ?? '';
}

export function buildHookCrafterStaticPrompt(ctx?: {
  strategy?: { avoidRecentRepeatWindow?: number; preferredTypes?: string[]; urgencyBias?: string };
  genreRules?: string[];
  genreArchetype?: Pick<GenreArchetype, 'adaptationNotes'>;
  extraHookTypes?: string;
}, basePrompt?: string): string {
  const template = basePrompt ?? '';
  const strategy = ctx?.strategy;
  return resolveTemplate(template, {
    extraHookTypes: ctx?.extraHookTypes?.trim()
      ? `\n${ctx.extraHookTypes.trim()}`
      : '',
    avoidRepeatWindow: String(strategy?.avoidRecentRepeatWindow ?? 3),
    preferredTypes: strategy?.preferredTypes?.join('、') || '无特殊偏好',
    urgencyBias: strategy?.urgencyBias ?? 'aggressive',
  });
}

export function buildHookCharacterConstraint(ctx: {
  validCharacterIds?: string[];
}): string {
  if (!ctx.validCharacterIds?.length) return '';
  return resolveTemplate(HOOK_CONSTRAINT_TEMPLATE, {
    characterIds: ctx.validCharacterIds.join(', '),
  });
}

export function buildEpisodeRecorderSystemPrompt(ctx?: {
  genreArchetype?: GenreArchetype;
  genreRules?: string[];
}, basePrompt?: string): string {
  return basePrompt ?? '';
}
