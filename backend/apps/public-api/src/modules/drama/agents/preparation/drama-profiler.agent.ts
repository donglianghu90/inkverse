/**
 * 短剧编剧手册生成器 — 根据种子+视觉资产生成编剧手册（promptProfile）。
 * 编剧手册指导后续所有 Agent 的风格/规则/审核维度。
 *
 * 生成完成后自动派生 soulViews（per-agent 本剧灵魂视图），供 DramaPromptBakerService
 * 烘焙 basePromptSnapshot 时使用。soulViews 不需要额外 LLM 调用——从现有字段组合派生。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../novel/llm/llm.service';
import { z } from 'zod';
import {
  dramaPromptProfileSchema, DramaPromptProfile,
  DramaSeed, SeriesOutline, VisualStyleGuide,
} from '../../schemas/drama-state.schemas';
import { buildProfilerSystemPrompt } from '../../prompting/drama-playbook';
import { GENRE_TEMPLATES } from '../../prompting/drama-genre-data';

/**
 * 从已解析的 profile 派生 soulViews。
 * soulViews 是各 Agent 的「本剧专属灵魂视图」——超出题材模板基线的本剧个性化规则。
 * - scriptwriter soul：直接来自 scriptwriterGuide（Profiler 的核心 LLM 输出）。
 * - arcDirector soul：来自 adaptationNotes + arcDirectorGuide 拼合，作为附加块注入 arc-director。
 * - episodeDirector soul：来自 adaptationNotes + episodeDirectorGuide 关键规则。
 * - pacingAnalyzer soul：来自 pacingAnalyzerGuide 中模板未覆盖的节奏规则。
 * - hookCrafter soul：来自 adaptationNotes，传递本剧悬念偏好。
 */
function deriveSoulViews(profile: DramaPromptProfile): NonNullable<DramaPromptProfile['soulViews']> {
  const guide = profile.scriptwriterGuide;
  const archetype = profile.genreArchetype;
  const arcGuide = profile.arcDirectorGuide;
  const epGuide = profile.episodeDirectorGuide;
  const pacingGuide = profile.pacingAnalyzerGuide;

  const adaptationNotes = archetype?.adaptationNotes?.trim() ?? '';

  // arcDirector soul = adaptationNotes（本剧适配规则）+ arcDirectorGuide 已填充的专属原则
  const arcParts = [
    adaptationNotes,
    arcGuide?.genreSegmentPrinciples?.trim() ?? '',
    arcGuide?.characterArcPrinciples?.trim() ?? '',
    arcGuide?.conflictRhythm?.trim() ?? '',
  ].filter(Boolean);

  // episodeDirector soul = adaptationNotes + 集导演专属情绪/张力/钩子规则
  const epParts = [
    adaptationNotes,
    epGuide?.tensionCurveNotes?.trim() ?? '',
    epGuide?.hookPatterns ? `【题材集末钩子模式】\n${epGuide.hookPatterns}` : '',
  ].filter(Boolean);

  // pacingAnalyzer soul = 题材节奏模板（告知分析师何为「正常节奏」）
  const pacingParts = [
    pacingGuide?.genreRhythmTemplate?.trim() ?? '',
    pacingGuide?.paceIndicators?.trim() ?? '',
  ].filter(Boolean);

  return {
    scriptwriter: {
      coreIdentity: guide.coreIdentity ?? '',
      genreRules: guide.genreRules ?? [],
      dialogueGuide: guide.dialogueGuide ?? '',
      pacingGuide: guide.pacingGuide ?? '',
      visualNarrativeGuide: guide.visualNarrativeGuide ?? '',
      forbiddenPatterns: guide.forbiddenPatterns ?? [],
    },
    arcDirector: arcParts.join('\n\n'),
    episodeDirector: epParts.join('\n\n'),
    pacingAnalyzer: pacingParts.length ? pacingParts.join('\n\n') : undefined,
    hookCrafter: adaptationNotes || undefined,
    // 优先保留 LLM 针对本剧生成的专属连续性检查（来自 PROFILER_SOUL_DEFAULT 中的生成要求）。
    // 题材级通用检查由 reviewerCalibration.genreSpecificChecks 承载，两者在 drama-prompt-baker
    // 中合并注入 continuity-guard，各司其职。
    continuityGuardChecks: profile.soulViews?.continuityGuardChecks ?? [],
  };
}

const profilerOutputSchema = z.object({ profile: dramaPromptProfileSchema });

/** 题材模板中需要覆盖 LLM 输出的固定字段子集 */
type TemplateProfileOverride = Partial<Pick<DramaPromptProfile,
  | 'cameraStyleGuide' | 'audioStyleGuide' | 'reviewerCalibration' | 'genreArchetype'
  | 'arcDirectorGuide' | 'episodeDirectorGuide' | 'pacingAnalyzerGuide'
>>;

@Injectable()
export class DramaProfilerAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(
    seed: DramaSeed,
    visualStyle?: VisualStyleGuide,
    outline?: SeriesOutline,
    dramaId?: string,
    userId?: string,
    /** 题材模板中手工维护的固定字段，覆盖同名 LLM 输出（用户可在前台编辑） */
    templateProfile?: Record<string, unknown>,
    additionalSystemPrompt?: string,
    /** 题材 key（如 "mythology"/"boss"/"warrior"），用于注入题材专属的编剧手册生成上下文 */
    genreKey?: string,
  ): Promise<DramaPromptProfile> {
    const arcSummary = outline?.episodes
      ? (() => {
          const paywallEps = outline.paywallEpisodes ?? [];
          const total = outline.totalPlannedEpisodes;
          return `总集数：${total} | 付费卡点：第${paywallEps.slice(0, 5).join('/')}集`;
        })()
      : '';

    let sysPrompt = buildProfilerSystemPrompt(genreKey, templateProfile);
    if (additionalSystemPrompt?.trim()) sysPrompt += `\n\n=== 补充指令 ===\n${additionalSystemPrompt.trim()}`;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-profiler',
      schema: profilerOutputSchema,
      systemPrompt: sysPrompt,
      metadata: { dramaId, userId },
      userPrompt: `请为以下短剧生成编剧手册：

剧名：${seed.title}
题材：${seed.genre}
目标受众：${seed.targetAudience}
调性：${seed.tone}
核心矛盾：${seed.coreConflict}
爽点类型：${seed.catharsisType}
${visualStyle ? `视觉风格：${visualStyle.overallAesthetic} | 调色：${visualStyle.colorGrading} | 光影：${visualStyle.lightingStyle}` : ''}
底线：${seed.redLines.join('；')}
${arcSummary ? `\n全剧结构参考：${arcSummary}` : ''}

要求：生成完整且详细的编剧手册。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const p = typeof root.profile === 'object' && root.profile ? root.profile : root;
    const llmResult = dramaPromptProfileSchema.parse(p);

    // 优先级：templateProfile（drama 专属）> GENRE_TEMPLATES（题材库默认）> LLM 生成
    const tpl = (templateProfile ?? {}) as TemplateProfileOverride;
    const genre = genreKey ? GENRE_TEMPLATES[genreKey]?.profile : undefined;

    // genreArchetype：drama 专属覆盖 > 题材库预置（枚举值确定，adaptationNotes 取 LLM 版本若更长）> LLM 生成
    const genrePreset = genre?.genreArchetypePreset;
    let resolvedArchetype: TemplateProfileOverride['genreArchetype'] | undefined = tpl.genreArchetype;
    if (!resolvedArchetype && genrePreset) {
      const llmNotes = llmResult.genreArchetype?.adaptationNotes ?? '';
      const presetNotes = genrePreset.adaptationNotes;
      resolvedArchetype = {
        narrativeArc: genrePreset.narrativeArc,
        narrationRatio: genrePreset.narrationRatio,
        factConstraint: genrePreset.factConstraint,
        hookMechanism: genrePreset.hookMechanism,
        conflictType: genrePreset.conflictType,
        characterEvolution: genrePreset.characterEvolution,
        visualTone: genrePreset.visualTone,
        // 若 LLM 在基线上补充了额外内容，使用 LLM 版本；否则用预置基线
        adaptationNotes: llmNotes.length > presetNotes.length ? llmNotes : presetNotes,
      };
    }

    const resolvedCamera = tpl.cameraStyleGuide ?? (genre?.cameraStyleGuide as Record<string, unknown> | undefined);
    const resolvedAudio = tpl.audioStyleGuide ?? (genre?.audioStyleGuide as Record<string, unknown> | undefined);
    const resolvedReviewer = tpl.reviewerCalibration ?? (genre?.reviewerCalibration as TemplateProfileOverride['reviewerCalibration'] | undefined);
    const resolvedArc = tpl.arcDirectorGuide ?? (genre?.arcDirectorGuide as TemplateProfileOverride['arcDirectorGuide'] | undefined);
    const resolvedEpisode = tpl.episodeDirectorGuide ?? (genre?.episodeDirectorGuide as TemplateProfileOverride['episodeDirectorGuide'] | undefined);
    const resolvedPacing = tpl.pacingAnalyzerGuide ?? (genre?.pacingAnalyzerGuide as TemplateProfileOverride['pacingAnalyzerGuide'] | undefined);

    let merged: DramaPromptProfile;

    if (!resolvedArchetype && !resolvedCamera && !resolvedAudio && !resolvedReviewer && !resolvedArc && !resolvedEpisode && !resolvedPacing) {
      merged = llmResult;
    } else {
      merged = {
        ...llmResult,
        ...(resolvedArchetype ? { genreArchetype: resolvedArchetype } : {}),
        cameraStyleGuide: {
          ...llmResult.cameraStyleGuide,
          ...(resolvedCamera ?? {}),
        },
        audioStyleGuide: {
          // 题材模板提供枚举/参数类基线（sfxDensity / silenceUsage / voiceActingStyle / bgmMoodPreferences）
          ...(resolvedAudio ?? {}),
          // LLM 针对本剧生成的 genreBrandingDirective 优先于模板通用版本（剧目专属，不可被题材基线覆盖）
          ...(llmResult.audioStyleGuide?.genreBrandingDirective
            ? { genreBrandingDirective: llmResult.audioStyleGuide.genreBrandingDirective }
            : {}),
        },
        reviewerCalibration: {
          ...llmResult.reviewerCalibration,
          dimensionWeights: resolvedReviewer?.dimensionWeights
            ?? llmResult.reviewerCalibration.dimensionWeights,
          genreSpecificChecks: resolvedReviewer?.genreSpecificChecks?.length
            ? resolvedReviewer.genreSpecificChecks
            : llmResult.reviewerCalibration.genreSpecificChecks,
        },
        ...(resolvedArc ? { arcDirectorGuide: { ...llmResult.arcDirectorGuide, ...resolvedArc } } : {}),
        ...(resolvedEpisode ? { episodeDirectorGuide: { ...llmResult.episodeDirectorGuide, ...resolvedEpisode } } : {}),
        ...(resolvedPacing ? { pacingAnalyzerGuide: { ...llmResult.pacingAnalyzerGuide, ...resolvedPacing } } : {}),
      };
    }

    // 派生 soulViews：从已合并的 profile 中提取各 Agent 的本剧专属灵魂视图。
    // 供 DramaPromptBakerService 在创建完成时烘焙 basePromptSnapshot。
    return { ...merged, soulViews: deriveSoulViews(merged) };
  }
}
