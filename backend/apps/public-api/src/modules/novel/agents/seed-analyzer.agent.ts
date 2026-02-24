/**
 * 种子分析角色：
 * 从用户的核心创意中提取故事种子 + 粗大纲。
 * 这是开书时唯一的 LLM 调用——极轻量。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { z } from 'zod';
import {
  storySeedSchema,
  roughOutlineSchema,
  StorySeed,
  RoughOutline,
} from '../schemas/novel-v2.schemas';
import { WRITING_SOUL_PLAYBOOK } from '../prompting/novel-playbook-v2';

interface SeedAnalysisInput {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  titleHint?: string;
  mainStoryGoal?: string;
  targetChapterWordCount?: number;
  plannedTotalChapters?: { min: number; max: number };
}

const seedAnalysisOutputSchema = z.object({
  seed: storySeedSchema,
  outline: roughOutlineSchema,
});

type SeedAnalysisOutput = z.infer<typeof seedAnalysisOutputSchema>;

@Injectable()
export class SeedAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(input: SeedAnalysisInput): Promise<SeedAnalysisOutput> {
    return this.llm.generateStructured({
      taskName: 'seed-analyzer',
      schema: seedAnalysisOutputSchema,
      systemPrompt: `你是一位资深的网文策划，同时也是一位读者心理专家。
你的任务不只是"提炼创意"，而是设计一本能让读者上瘾的长篇网文。

关键原则：
- 这是一部长篇网文——计划 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章，每章约 ${input.targetChapterWordCount ?? 3000} 字，总字数约 ${Math.round(((input.plannedTotalChapters?.min ?? 500) + (input.plannedTotalChapters?.max ?? 800)) / 2 * (input.targetChapterWordCount ?? 3000) / 10000)}万字。
- 故事种子是"方向"，不是"规范"。后续写作可以偏离。
- 粗大纲需要覆盖开局→发展→高潮→结局，节点数量应匹配总章数规模。
  · 500-800 章的长篇，大纲应有 8-15 个大阶段节点，每个阶段跨度 40-100 章。
  · 每个阶段的 tentativeChapterRange 要明确（如 "1-50", "51-120"）。
- 主角概念只需要姓名、处境、核心渴望、性格特征——不需要完整档案。
- 红线是绝对不能做的事（如：主角不能死、不能有种族歧视内容等）。
- 所有输出使用简体中文。

长篇规划特别注意：
- 世界观深度要能支撑 ${input.plannedTotalChapters?.min ?? 500}+ 章——需要多个地域/势力/力量层级。
- 主线冲突要有足够的"升级空间"——从小舞台到大舞台，逐步扩展。
- 金手指的进化路径要有足够阶段——每 80-120 章左右应有一次重大升级。
- 反派/对手要有梯度——不能一开始就打终极boss。
- 概念评估时要额外考虑"这个世界观能不能支撑 500+ 章不枯竭"。

读者画像设计（readerPersona——极其重要）：
你必须精确建模目标读者：
- demographics: 年龄、性别、生活状态（如"18-25岁男性大学生/初入职场"）
- dailyFrustrations: 2-3个他们每天面对的真实痛苦（如"被领导PUA"、"考试压力"、"感情不顺"）
- coreFantasy: 一句话概括他们的白日梦（如"如果我有超能力/如果我回到过去"）
- projectionAnchor: 主角身上让读者产生"这就是我"感觉的锚点（如"普通出身但不甘平庸"）
- emotionalNeeds: 这本书满足读者的哪些情感需求
- triggerScenes: 2-3个能让这群读者忍不住拍大腿/红眼眶的场景类型（如"被人小看后翻盘"、"发现父亲一直在默默守护"）

金手指设计（goldenFinger——决定书能不能活过第一卷）：
- 金手指必须独特——不能是"系统+面板"的老套路（除非有创新变化）
- 金手指必须有限制——全能的金手指没有张力
- 金手指必须可进化——随着故事发展解锁新能力
- name: 金手指的名字
- concept: 一句话解释它是什么
- uniqueness: 它和同类网文的金手指有什么不同
- limitations: 使用限制和代价
- evolutionPath: 至少2个进化阶段
- hiddenDepth: 金手指背后的秘密（后期揭晓，可以是剧情大转折的种子）

概念评估（conceptEvaluation——你必须自我审视）：
生成完概念后，以一个资深编辑的眼光打分：
- hookScore: 第一章能不能抓住读者？（0-10）
- uniquenessScore: 和市面上的书相比有多不同？（0-10）
- marketFitScore: 目标读者群有多大？（0-10）
- projectionScore: 读者能不能代入主角？（0-10）
- overallViability: 综合判断（weak/passable/strong/exceptional）
- strengthNotes: 概念的亮点
- weaknessNotes: 概念的弱点（必须诚实）
- suggestions: 如果要更好，可以怎么改进

如果 overallViability 是 weak，你应该主动调整概念直到至少是 passable。
如果 hookScore < 6，你必须重新设计开局。

${WRITING_SOUL_PLAYBOOK}`,
      userPrompt: `请分析这个创意并生成故事种子与粗大纲：

核心创意：${input.mainIdea}
类型：${input.genre}
目标读者：${input.targetAudience}
${input.titleHint ? `书名提示：${input.titleHint}` : ''}
${input.mainStoryGoal ? `长期主线目标：${input.mainStoryGoal}` : ''}
规模：每章约 ${input.targetChapterWordCount ?? 3000} 字，计划 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章

要求：
1. seed.title 是一个有吸引力的书名（如有 titleHint 请参考）
2. seed.logline 是一句话梗概，要有冲突感和吸引力——这一句话决定读者点不点开
3. seed.protagonistConcept 只需基本轮廓，但必须让读者想代入
4. seed.redLines 列出 3-5 条绝对不能违反的底线
5. seed.targetChapterWordCount 设为 ${input.targetChapterWordCount ?? 3000}
6. seed.plannedTotalChapters 设为 { min: ${input.plannedTotalChapters?.min ?? 500}, max: ${input.plannedTotalChapters?.max ?? 800} }
7. seed.readerPersona 精确建模目标读者的心理画像
8. seed.goldenFinger 设计一个独特的、有限制的、可进化的金手指——进化阶段数量要匹配总章数（500-800章至少需要 5-8 个进化阶段）
9. seed.conceptEvaluation 诚实评估这个概念的商业潜力，特别评估"世界观深度是否够支撑 ${input.plannedTotalChapters?.min ?? 500}+ 章"
10. outline.points 包含 8-15 个故事阶段节点（匹配 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章的规模），每个标明阶段和暂定章节范围
11. outline.estimatedTotalChapters 设为你估算的合理总章数
12. outline.endingDirection 只给一个模糊的结局方向，允许后续调整
13. 如果你评估出来概念偏弱（hookScore < 6 或 overallViability = weak），主动在生成中调整优化`,
      temperature: 0.6,
    });
  }
}
