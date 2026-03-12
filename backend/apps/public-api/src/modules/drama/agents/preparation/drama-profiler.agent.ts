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

@Injectable()
export class DramaProfilerAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(seed: DramaSeed, visualStyle?: VisualStyleGuide, outline?: SeriesOutline, dramaId?: string, userId?: string): Promise<DramaPromptProfile> {
    const arcSummary = outline?.episodes
      ? (() => {
          const paywallEps = outline.paywallEpisodes ?? [];
          const total = outline.totalPlannedEpisodes;
          return `总集数：${total} | 付费卡点：第${paywallEps.slice(0, 5).join('/')}集`;
        })()
      : '';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-profiler',
      schema: profilerOutputSchema,
      systemPrompt: buildProfilerSystemPrompt(),
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
    return dramaPromptProfileSchema.parse(p);
  }
}
