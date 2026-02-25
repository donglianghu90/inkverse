/**
 * 节奏分析师：
 * 分析章节的节奏结构——句式变化、对话密度、动作密度、情绪弧。
 * 输出可以注入到 Reviewer 或下一轮写作的指导中。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  PacingAnalysis,
  StoryState,
  pacingAnalysisSchema,
} from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';

@Injectable()
export class PacingAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(state: StoryState, draft: ChapterDraft): Promise<PacingAnalysis> {
    return this.llm.generateStructured({
      taskName: 'pacing-analyzer',
      schema: pacingAnalysisSchema,
      tags: ['workflow', 'chapter', 'pacing'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是一位节奏分析专家。像音乐指挥家一样分析叙事的"旋律"。

分析维度：
1. overallPacing: 太慢(大量描写无推进)/刚好(张弛有度)/太快(事件堆砌缺乏呼吸)
2. sentenceLengthVariety: 句式长短变化(0=单调, 10=优秀的长短交替)
3. dialogueToNarrativeRatio: 对话占比(0=纯叙述, 1=纯对话)——网文通常0.3-0.5最佳
4. actionDensity: 动作/事件密度(0=静态, 10=密集)
5. emotionalArcPresent: 本章是否有情绪弧线(从A情绪到B情绪)
6. breathingPointAnalysis: 呼吸节奏分析——
   - 紧张段落后是否有"呼吸点"（幽默/温情/安静的观察）？
   - 呼吸点是否太多（节奏拖沓）或太少（读者喘不过气）？
   - 理想比例：每2-3段紧张内容后有一个呼吸点
7. sceneTransitionQuality: 场景/视角切换质量——
   - 切换是否自然（用环境描写过渡）还是硬切？
   - 切换频率是否合适？
8. informationDensityCurve: 信息密度曲线——
   - 开头信息密度是否太高（劝退）或太低（无聊）？
   - 重要信息是否均匀分布还是集中在某一处？
9. suggestions: 1-3条具体节奏改进建议`,
      userPrompt: `章节正文（${draft.content.length}字）：
${draft.content}`,
      temperature: 0.3,
    });
  }
}
