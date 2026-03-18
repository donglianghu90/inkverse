/**
 * 短剧编剧手册生成器 — 根据种子+视觉资产生成编剧手册（promptProfile）。
 * 编剧手册指导后续所有 Agent 的风格/规则/审核维度。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../novel/llm/llm.service';
import { z } from 'zod';
import {
  dramaPromptProfileSchema, DramaPromptProfile,
  DramaSeed, SeriesOutline, VisualStyleGuide,
} from '../../schemas/drama-state.schemas';
import { buildProfilerSystemPrompt } from '../../prompting/drama-playbook';

const profilerOutputSchema = z.object({ profile: dramaPromptProfileSchema });

/** 题材模板中需要覆盖 LLM 输出的固定字段子集 */
type TemplateProfileOverride = Partial<Pick<DramaPromptProfile,
  'cameraStyleGuide' | 'audioStyleGuide' | 'reviewerCalibration' | 'genreArchetype'
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
  ): Promise<DramaPromptProfile> {
    const arcSummary = outline?.episodes
      ? (() => {
          const paywallEps = outline.paywallEpisodes ?? [];
          const total = outline.totalPlannedEpisodes;
          return `总集数：${total} | 付费卡点：第${paywallEps.slice(0, 5).join('/')}集`;
        })()
      : '';

    let sysPrompt = buildProfilerSystemPrompt();
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

    if (!templateProfile || Object.keys(templateProfile).length === 0) {
      return llmResult;
    }

    // 将题材模板的固定字段深度合并到 LLM 输出上（模板字段优先级更高）
    const tpl = templateProfile as TemplateProfileOverride;
    return {
      ...llmResult,
      ...(tpl.genreArchetype ? { genreArchetype: tpl.genreArchetype } : {}),
      cameraStyleGuide: {
        ...llmResult.cameraStyleGuide,
        ...(tpl.cameraStyleGuide ?? {}),
      },
      audioStyleGuide: {
        ...llmResult.audioStyleGuide,
        ...(tpl.audioStyleGuide ?? {}),
      },
      reviewerCalibration: {
        ...llmResult.reviewerCalibration,
        dimensionWeights: tpl.reviewerCalibration?.dimensionWeights
          ?? llmResult.reviewerCalibration.dimensionWeights,
        genreSpecificChecks: tpl.reviewerCalibration?.genreSpecificChecks?.length
          ? tpl.reviewerCalibration.genreSpecificChecks
          : llmResult.reviewerCalibration.genreSpecificChecks,
      },
    };
  }
}
