/**
 * 短剧编剧手册生成器 — 根据种子+视觉资产生成编剧手册（promptProfile）。
 * 编剧手册指导后续所有 Agent 的风格/规则/审核维度。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  dramaPromptProfileSchema, DramaPromptProfile,
  DramaSeed, VisualStyleGuide,
} from '../schemas/drama-state.schemas';

const profilerOutputSchema = z.object({ profile: dramaPromptProfileSchema });

@Injectable()
export class DramaProfilerAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(seed: DramaSeed, visualStyle?: VisualStyleGuide): Promise<DramaPromptProfile> {
    const raw = await this.llm.generateStructured({
      taskName: 'drama-profiler',
      schema: profilerOutputSchema,
      systemPrompt: `你是一位短剧编剧培训专家。你的任务是根据短剧种子和视觉风格，为整个创作团队生成一份"编剧手册"，确保所有后续Agent输出风格一致。

=== 编剧手册内容 ===
1. scriptwriterGuide：编剧核心指南
   - coreIdentity：编剧人设（如"你是一位擅长霸总反转的编剧，每场戏必须有一个信息量爆炸的瞬间"）
   - genreRules：题材铁律（至少5条，如"每集至少一句金句台词""反派不能突然洗白"）
   - dialogueGuide：台词风格指南（如"简短有力，禁止长独白。关键信息用肢体语言+一句话台词传递"）
   - pacingGuide：节奏指南（如"每场戏不超过40秒，高潮场景可延长到60秒"）
   - visualNarrativeGuide：视觉叙事指南（如"优先用画面传递信息，一个表情变化胜过三句台词"）
   - forbiddenPatterns：禁止模式（如"禁止连续两集都是误会推动剧情""禁止主角被打脸超过3集不反击"）

2. cameraStyleGuide：镜头风格指南
   - preferredAngles：偏好角度（如["close_up","over_shoulder"]用于对话场景）
   - signatureTechniques：标志性手法（如"反转瞬间用慢动作+push_in""打脸moment用dutch_angle"）
   - transitionStyle：转场偏好
   - colorPalette：色彩基调（与视觉风格对齐）

3. audioStyleGuide：音频风格指南
   - bgmMoodPreferences：BGM情绪偏好
   - sfxDensity：音效密度
   - silenceUsage：静默策略（如"揭真相前0.5-1秒静默，制造震撼感"）
   - voiceActingStyle：配音风格（如"自然偏克制，高潮时才允许夸张"）

4. reviewerCalibration：审核维度权重
   - dimensionWeights：各维度权重（视觉冲击力/台词自然度/节奏/悬念/连续性/情感冲击）
   - genreSpecificChecks：题材专项检查（如霸总类："是否有身份反差的戏剧性揭露"）

所有输出简体中文。`,

      userPrompt: `请为以下短剧生成编剧手册：

剧名：${seed.title}
题材：${seed.genre}
目标受众：${seed.targetAudience}
调性：${seed.tone}
核心矛盾：${seed.coreConflict}
爽点类型：${seed.catharsisType}
${visualStyle ? `视觉风格：${visualStyle.overallAesthetic} | 调色：${visualStyle.colorGrading} | 光影：${visualStyle.lightingStyle}` : ''}
底线：${seed.redLines.join('；')}

要求：生成完整且详细的编剧手册。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const p = typeof root.profile === 'object' && root.profile ? root.profile : root;
    return dramaPromptProfileSchema.parse(p);
  }
}
