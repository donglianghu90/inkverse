/**
 * PromptProfiler Agent — 开书时生成题材定制化的写作手册。
 *
 * 用现有的玄幻 Profile 作为 few-shot example，
 * 让 AI 按照同样的深度和结构为任何题材生成适配的 Profile。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  BookPromptProfile,
  bookPromptProfileSchema,
} from '../schemas/novel-state.schemas';
import {
  XIANXIA_REFERENCE_PROFILE,
  formatProfileAsExample,
} from '../prompting/reference-profiles';

interface ProfileInput {
  genre: string;
  targetAudience: string;
  mainIdea: string;
  tone: string;
  mainStoryGoal?: string;
  targetChapterWordCount?: number;
  plannedTotalChapters?: { min: number; max: number };
}

@Injectable()
export class PromptProfilerAgent {
  constructor(private readonly llm: LlmService) {}

  async generate(input: ProfileInput): Promise<BookPromptProfile> {
    const referenceExample = formatProfileAsExample(XIANXIA_REFERENCE_PROFILE);

    return this.llm.generateStructured({
      taskName: 'prompt-profiler',
      schema: bookPromptProfileSchema,
      tags: ['setup', 'profile'],
      systemPrompt: `你是一位资深的网文编辑总监，同时精通各类网文题材的写作规律。

你的任务是为一本新书生成一份完整的"写作手册"（BookPromptProfile）。
这份手册会被 AI 写手、AI 审阅员等角色在整个创作过程中持续使用。

以下是一份"玄幻/仙侠"题材的参考范例——它展示了手册应有的深度和细节水平：

${referenceExample}

---

你需要为用户指定的题材生成一份同等质量的手册。核心要求：

1.【写手身份 coreIdentity】
  - 用一段话定义这个题材的理想写手形象。
  - 不是泛泛的"你是一个好作者"，而是要有题材特色。

2.【题材专属规则 genreRules】
  - 这个题材独有的写作规则，至少 5 条。
  - 范例中的"宗门等级互动"换成你的题材对应的规则。
  - 这些规则应该是具体可执行的，不是空泛的"写好角色"。

3.【节奏指南 pacingGuide】
  - 这个题材的理想节奏是什么样的？
  - 多少章一个小高潮？什么时候该加速/减速？

4.【对话指南 dialogueGuide】
  - 这个题材的角色说话应该是什么风格？
  - 不同身份的角色说话有什么差异？

5.【正反例 craftExamples】
  - 至少 4 组"坏写法→好写法"的对比。
  - 示例必须匹配这个题材的场景和语境——不要用玄幻场景写言情手册。
  - 每组都要有明确的规则总结。

6.【爽感类型 satisfactionTypes】
  - 这个题材的读者觉得什么时刻最"爽"？
  - 不是通用的，是题材特有的——言情的"爽"和玄幻完全不同。
  - 至少 5 种，按重要性排序。

7.【钩子类型 hookTypes】
  - 这个题材适合用什么样的章末钩子？
  - 至少 5 种，附具体描述。

8.【套话黑名单 clichePatterns】
  - 这个题材最容易出现的 AI 套话/陈词滥调。
  - 不是通用的"与此同时"，而是题材特有的套话。
  - 至少 8 个。

9.【评审校准 reviewerCalibration】
  - dimensionWeights: 这个题材哪些维度更重要？
    · 言情 → characterDepth 权重高；玄幻 → engagement 权重高
  - genreSpecificChecks: 审阅时特别需要检查的项目。
  - scoringAnchors: 在这个题材中，9-10分/5-6分/0-4分分别是什么感觉？

10.【世界观配置 worldProfile】
  - organizationTypes: 这个题材有什么类型的组织？
  - powerSystemApplicable: 是否需要力量体系？
  - goldenFingerApplicable: 是否需要"金手指"（主角特殊能力）？
  - commitmentTypes: 角色之间会产生什么类型的承诺？
  - characterRelationEmphasis: 人际关系的重心在哪？`,

      userPrompt: `请为以下设定生成完整的 BookPromptProfile：

题材类型：${input.genre}
目标读者：${input.targetAudience}
核心创意：${input.mainIdea}
调性：${input.tone}
${input.mainStoryGoal ? `主线目标：${input.mainStoryGoal}` : ''}
规模：每章约 ${input.targetChapterWordCount ?? 3000} 字，计划 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章

请生成完整的 BookPromptProfile JSON。
- generatedForGenre 和 generatedForAudience 填写你对这个题材和读者的理解。
- 所有内容必须适配上述题材，不要照搬玄幻范例的内容。
- 正反例要用这个题材的场景。
- 套话黑名单要是这个题材特有的。
- 如果这个题材不需要力量体系或金手指，powerSystemApplicable/goldenFingerApplicable 设为 false。`,

      temperature: 0.6,
    });
  }
}
