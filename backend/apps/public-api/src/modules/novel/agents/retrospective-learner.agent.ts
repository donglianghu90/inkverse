/** 回顾式学习Agent — 弧结束后分析KPI/审阅数据，提炼可复用的写作教训。 */
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import {
  StoryState, WritingLesson,
  retrospectiveLessonsOutputSchema, RetrospectiveLessonsOutput,
} from '../schemas/novel-state.schemas';
import { generationKpiSchema } from '../schemas/novel.schemas';

type GenerationKpi = z.infer<typeof generationKpiSchema>;

@Injectable()
export class RetrospectiveLearnerAgent {
  private readonly logger = new Logger(RetrospectiveLearnerAgent.name);
  constructor(private readonly llm: LlmService) {}

  /** 弧结束后执行回顾分析，返回新教训列表。 */
  async analyze(state: StoryState, arcId: string, arcChapterRange: [number, number]): Promise<WritingLesson[]> {
    const [start, end] = arcChapterRange;
    const arcKpis = (state.kpiHistory ?? []).filter((_, i) => { // 按章节索引近似匹配
      const ch = i + 1;
      return ch >= start && ch <= end;
    });
    if (arcKpis.length < 3) return []; // 数据不足

    const stats = this.computeStats(arcKpis);
    const acceptance = state.completedArcAcceptanceReports?.find((r) => r.arcId === arcId);
    const arc = state.completedArcs?.find((a) => a.arcId === arcId) ?? state.currentArc;
    const existingLessons = state.writingLessons ?? [];

    const result = await this.llm.generateStructured({
      taskName: 'retrospective-learner',
      schema: retrospectiveLessonsOutputSchema,
      tags: ['workflow', 'maintenance', 'retrospective'],
      metadata: { userId: state.userId, bookId: state.bookId, arcId },
      systemPrompt: `你是一位数据驱动的写作教练。你收到了一个已完成弧的质量数据，需要从中提炼可复用的"写作教训"。

=== 分析原则 ===
1. 只提炼有数据支撑的教训——不要凭空猜测
2. insight 要具体：不能是"要写好对话"，而是"当场景角色≥4人时，声音辨识度下降"
3. actionable 要可执行：不能是"注意节奏"，而是"高张力连续不超过2章"
4. 关注维度间的相关性：如 pacing 高分时 engagement 是否也高？hookStrength 低时是否导致下一章得分下滑？
5. 区分趋势性问题和偶发问题：连续3章某维度低分 vs 单章异常

=== 教训类别 ===
- pacing: 节奏相关（如紧张/缓冲比例、字数与质量的关系）
- dialogue: 对话相关（如群戏声音辨识、对话密度）
- character: 角色相关（如角色深度得分规律、声音一致性）
- worldbuilding: 世界观相关（如信息密度、设定融入方式）
- hook: 钩子相关（如不同类型钩子的得分、章末悬念效果）
- prose: 文笔相关（如AI味检测规律、展示vs讲述）
- structure: 结构相关（如弧结构效果、场景数与质量关系）
- emotion: 情感相关（如情感高潮时机、情绪过渡效果）

=== 已有教训（避免重复）===
${existingLessons.length > 0 ? existingLessons.map((l) => `[${l.category}] ${l.insight}`).join('\n') : '（暂无）'}
如果新发现验证了已有教训（如同类问题再次出现），不要重复输出，但在 bestPractices 中提及。

=== 输出要求 ===
- lessons: 3-8条新教训（不要与已有教训重复）
- bestPractices: 2-4条本弧值得复用的做法
- antiPatterns: 1-3条本弧应避免的做法`,
      userPrompt: `弧信息：
- arcId: ${arcId}
- 标题: ${arc?.arcTitle ?? '未知'}
- 类型: ${arc?.arcType ?? '未知'}
- 章节范围: ${start}-${end}（共${end - start + 1}章）
- 叙事技法: ${arc?.narrativeTechnique ?? 'linear'}

质量统计（基于${arcKpis.length}章数据）：
${JSON.stringify(stats, null, 2)}

弧验收报告：
${acceptance ? JSON.stringify({
  总体通过: acceptance.overallPass,
  目标完成度: acceptance.goalCompletionScore,
  伏线回收率: acceptance.mustPayoffCompletionScore,
  张力解决率: acceptance.readerTensionResolutionScore,
  未回收伏线: acceptance.missingPayoffThreadIds,
  总结: acceptance.summary,
}, null, 2) : '（无验收报告）'}

${state.feedbackState?.lastAnalysis ? `读者反馈概况：\n- 核心问题: ${state.feedbackState.lastAnalysis.bookLevel.coreIssues.map((i) => i.suggestion).join('；') || '无'}\n- 永久红线: ${state.feedbackState.lastAnalysis.bookLevel.neverAgain.join('；') || '无'}` : ''}

请从数据中提炼写作教训。`,
      temperature: 0.3,
    });

    const chapterNumber = state.chapterCursor - 1;
    return result.lessons.map((l, i) => ({
      id: `lesson_${arcId}_${i + 1}`,
      sourceArcId: arcId,
      category: l.category,
      insight: l.insight,
      actionable: l.actionable,
      confidence: l.confidence,
      sourceEvidence: l.evidence,
      createdAtChapter: chapterNumber,
    }));
  }

  /** 强化已有教训的置信度——如果新数据再次验证旧教训。 */
  reinforceLessons(lessons: WritingLesson[], newOutput: RetrospectiveLessonsOutput): WritingLesson[] {
    const confirmed = new Set(newOutput.bestPractices.flatMap((bp) =>
      lessons.filter((l) => bp.includes(l.insight.slice(0, 20)) || bp.includes(l.actionable.slice(0, 20))).map((l) => l.id),
    ));
    return lessons.map((l) => {
      if (!confirmed.has(l.id)) return l;
      const next = l.confidence === 'tentative' ? 'confirmed' as const : l.confidence === 'confirmed' ? 'strong' as const : l.confidence;
      return next !== l.confidence ? { ...l, confidence: next } : l;
    });
  }

  private computeStats(kpis: GenerationKpi[]): Record<string, unknown> {
    const n = kpis.length;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
    const scores = kpis.map((k) => k.overallScore);
    const qualityScores = kpis.map((k) => k.qualityScore);
    const hardPassRate = kpis.filter((k) => k.hardPass).length / n;
    const juryPassRate = kpis.filter((k) => k.juryPass).length / n;
    const continuityPassRate = kpis.filter((k) => k.continuityPass).length / n;

    const lowScoreStreak = this.maxConsecutive(scores, (s) => s < 6);
    const highScoreStreak = this.maxConsecutive(scores, (s) => s >= 8);
    const trend = scores.length >= 4 ? (avg(scores.slice(-3)) - avg(scores.slice(0, 3))) : 0;

    return {
      章数: n,
      平均总分: +avg(scores).toFixed(2),
      平均文笔分: +avg(qualityScores).toFixed(2),
      硬通过率: +(hardPassRate * 100).toFixed(1) + '%',
      评审通过率: +(juryPassRate * 100).toFixed(1) + '%',
      连续性通过率: +(continuityPassRate * 100).toFixed(1) + '%',
      最长低分连续: lowScoreStreak,
      最长高分连续: highScoreStreak,
      得分趋势: trend > 0.3 ? '上升' : trend < -0.3 ? '下降' : '平稳',
      最高分: Math.max(...scores),
      最低分: Math.min(...scores),
    };
  }

  private maxConsecutive(arr: number[], predicate: (v: number) => boolean): number {
    let max = 0, cur = 0;
    for (const v of arr) { if (predicate(v)) { cur++; max = Math.max(max, cur); } else cur = 0; }
    return max;
  }
}
