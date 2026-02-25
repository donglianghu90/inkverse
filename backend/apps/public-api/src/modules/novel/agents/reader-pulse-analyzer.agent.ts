/**
 * 读者脉搏分析师：
 * 分析来自发布平台的真实读者评论/吐槽/赞美，
 * 提炼成写作偏好指令注入后续章节。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ReaderFeedback,
  ReaderFeedbackAnalysis,
  StoryState,
  readerFeedbackAnalysisSchema,
} from '../schemas/novel-state.schemas';

@Injectable()
export class ReaderPulseAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(
    state: StoryState,
    feedbacks: ReaderFeedback[],
  ): Promise<ReaderFeedbackAnalysis> {
    const allComments = feedbacks.flatMap((f) =>
      f.comments.map((c) => ({
        chapter: f.chapterNumber,
        content: c.content,
        sentiment: c.sentiment,
        aspect: c.aspect,
      })),
    );

    const metrics = feedbacks
      .filter((f) => f.metrics)
      .map((f) => ({
        chapter: f.chapterNumber,
        readCompletion: f.metrics!.readCompletionRate,
        retention: f.metrics!.retentionRate,
        favorites: f.metrics!.favoriteCount,
        comments: f.metrics!.commentCount,
      }));

    return this.llm.generateStructured({
      taskName: 'reader-pulse-analyzer',
      schema: readerFeedbackAnalysisSchema,
      tags: ['feedback', 'reader'],
      metadata: {
        bookId: state.bookId,
        feedbackChapters: feedbacks.map((f) => f.chapterNumber),
      },
      systemPrompt: `你是一位读者行为分析专家。你的任务是从真实读者的评论中提炼写作改进方向。

分析维度：
1. doMore: 读者明确喜欢、希望看到更多的元素（具体到可执行的写作指令）
2. doLess: 读者不喜欢、希望减少的元素
3. neverAgain: 读者强烈反感、以后绝对不能再出现的元素
4. readerPreferences: 读者偏好画像
   - favoriteCharacters: 最受欢迎的角色
   - favoriteSceneTypes: 最受欢迎的场景类型（如"打脸"、"升级"、"感情戏"）
   - painPoints: 最大的痛点
5. overallSentiment: 整体读者情绪
6. priorityImprovements: 按优先级排列的改进建议（最多5条）

提炼原则：
- 区分"噪音"和"信号"——一两个极端评论不代表多数意见
- 关注反复出现的主题——多人提到的问题是真问题
- 定量指标比感性评论更可靠（完读率、留存率）
- 输出必须是可执行的写作指令，不是抽象建议`,
      userPrompt: `书籍：《${state.seed.title}》（${state.seed.genre}）
当前章节：${state.chapterCursor - 1}

读者评论（${allComments.length}条，来自${feedbacks.length}个章节）：
${JSON.stringify(allComments, null, 2)}

${metrics.length > 0 ? `平台数据指标：\n${JSON.stringify(metrics, null, 2)}` : '暂无平台数据指标'}

请分析并输出读者反馈洞察。`,
      temperature: 0.4,
    });
  }
}
