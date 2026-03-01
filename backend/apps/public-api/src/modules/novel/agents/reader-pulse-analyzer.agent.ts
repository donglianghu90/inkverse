/** 读者脉搏分析师：三层过滤（统计去噪→创作意图对齐→数据验证），输出分层采纳建议。 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ReaderFeedback,
  ReaderFeedbackAnalysis,
  StoryState,
  readerFeedbackAnalysisSchema,
} from '../schemas/novel-state.schemas';
import { buildAudiencePromptBlock } from '../prompting/audience-directive';

@Injectable()
export class ReaderPulseAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(state: StoryState, feedbacks: ReaderFeedback[]): Promise<ReaderFeedbackAnalysis> {
    const allComments = feedbacks.flatMap((f) =>
      f.comments.map((c) => ({ ch: f.chapterNumber, ...c })),
    );
    const metrics = feedbacks.filter((f) => f.metrics).map((f) => ({ ch: f.chapterNumber, ...f.metrics! }));
    const editorial = state.editorialPlan;
    const chapterNumber = state.chapterCursor;
    const expiresAfter = chapterNumber + 3;

    return this.llm.generateStructured({
      taskName: 'reader-pulse-analyzer',
      schema: readerFeedbackAnalysisSchema,
      tags: ['feedback', 'reader', 'analysis'],
      metadata: { bookId: state.bookId, feedbackChapters: feedbacks.map((f) => f.chapterNumber) },
      systemPrompt: `你是一位读者行为分析专家 + 编辑顾问。你的任务是从真实读者评论中提炼**分层的、有条件的**写作改进建议。
${state.seed.writingMode === 'literary' ? '\n⚠ 本书为文学探索模式。平台留存/完读率等商业指标仅作参考，不应作为主要决策依据。重点关注对叙事深度、文学品质、情感真实度的反馈。\n' : ''}

=== 核心原则：创作意图 > 读者意见 ===
本书的创作纲领（editorialPlan）是最高优先级：
${editorial ? JSON.stringify(editorial) : '（未设定）'}

读者反馈是参考信号，不是命令。你必须对每条建议做出采纳判定（verdict）：
- adopt：共识强(≥3人提到) + 有数据佐证 + 不冲突editorialPlan → 直接采纳
- conditional：信号够但和创作意图有摩擦 → 有条件采纳，必须附constraints
- observe：信号不足或矛盾 → 先观望，记录趋势
- reject：违背创作意图 / 单人暴论 / 会破坏叙事结构 → 拒绝，但记录reasoning

=== 三层过滤 ===
1. 统计过滤（去噪）：
   - 同一authorId的多条评论只算1个信号源
   - 极端评论（纯骂/纯吹无实质内容）降权
   - 共识阈值：≥3个不同来源提到同一问题才算有效信号
   
2. 创作意图对齐：
   - 和editorialPlan的positioning/narrativePromise/qualityBar对比
   - 冲突项verdict=reject或conditional（不能是adopt）
   - 补充信息（editorialPlan未覆盖的领域）可以adopt

${buildAudiencePromptBlock(state)}
   
3. 数据验证：
   - 有平台指标（完读率、留存率）佐证的信号confidence+0.2
   - 仅有感性评论无数据 → confidence上限0.6
   - 定量下降+定性吐槽=强信号 → confidence≥0.8

=== 三层作用域 ===
每条建议必须归入正确的scope：
- book：文笔风格、永久红线、核心人设问题、场景类型偏好（不过期）
- arc：当前Arc节奏、配角出场、剧情吸引力（MiniArc结束过期）
- chapter：节奏微调、即时修复、悬念满意度（${expiresAfter}章后过期）

=== 防过度讨好 ===
- overallSentiment为positive/very_positive时：减少调整建议数量，别修好的东西
- neverAgain必须是真正的共识红线（≥5人，强烈负面），不是个别人的偏好
- 读者要求和故事整体走向冲突时 → verdict=reject，reasoning说明为什么保留故事走向
- 对每条adopt/conditional建议都必须附constraints，防止矫枉过正`,

      userPrompt: `书籍：《${state.seed.title}》（${state.seed.genre}）
当前章节：${chapterNumber}
当前MiniArc：${(state.currentArc as any)?.label ?? '未知'}

读者评论（${allComments.length}条，来自${feedbacks.length}个章节）：
${JSON.stringify(allComments, null, 2)}

${metrics.length ? `平台数据指标：\n${JSON.stringify(metrics, null, 2)}` : '暂无平台数据指标（所有建议confidence上限0.6）'}

主要角色：${state.characters.slice(0, 10).map((c) => `${c.name}(${c.id})`).join('、')}

请输出三层分析。chapterLevel.expiresAfterChapter=${expiresAfter}。
analyzedChapters=[${feedbacks.map((f) => f.chapterNumber).join(',')}]`,
      temperature: 0.35,
    });
  }
}
