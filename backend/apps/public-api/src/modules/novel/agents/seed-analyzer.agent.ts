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
} from '../schemas/novel-state.schemas';
import { WRITING_SOUL_PLAYBOOK } from '../prompting/novel-playbook';

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
      systemPrompt: `你是一位资深网文策划+读者心理专家。你不是在"提炼创意"——你是在设计一台上瘾机器。

=== 核心原则 ===
- 长篇网文（${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800}章，每章约${input.targetChapterWordCount ?? 3000}字，总约${Math.round(((input.plannedTotalChapters?.min ?? 500) + (input.plannedTotalChapters?.max ?? 800)) / 2 * (input.targetChapterWordCount ?? 3000) / 10000)}万字）
- 故事种子是"方向"不是"规范"，后续可偏离
- 粗大纲阶段数和每阶段章数必须匹配总章数规模（如50章→3-5阶段每阶段10-17章，200章→5-8阶段每阶段25-40章，600章→8-15阶段每阶段40-100章）
- 所有输出简体中文

=== 核心循环设计（最重要的新增——决定书能不能追下去） ===
每本成功的长篇网文都有一个让读者上瘾的"核心循环"。你必须在种子中明确设计它。
- 天蚕土豆式：被小看→隐忍修炼→关键时刻爆发→震惊众人→更大的舞台→再被小看…
- 猫腻式：发现异常→追查真相→被更大的谜团包围→获得碎片答案→世界观再次扩大…
- 核心循环的关键：每次重复都有变化，但读者每次都期待"这次会怎样爆发"。
- 你要明确定义：
  1) 循环的起点状态（主角面临什么处境）
  2) 循环的上升路径（如何积蓄势能）
  3) 循环的爆发点（读者获得满足感的瞬间）
  4) 循环的重置机制（如何让主角回到新的起点但更高一层）

=== 情感锚点设计 ===
金手指不只是"能力工具"，它必须承载情感：
- 金手指的来源/代价要和角色的核心情感挂钩（继承自亡父→思念、偷来的力量→愧疚、代价是记忆→恐惧）
- 每次使用金手指时，读者不只感到"爽"，还感到一丝情绪波动

=== 大纲的情感主题 ===
每个大阶段节点除了剧情描述，还要有"情感主题"：
- 例：第一阶段（1-50章）→ 情感主题："孤独者找到归属"
- 例：第二阶段（51-120章）→ 情感主题："信任被背叛后的重建"
- 这样每个阶段不只有剧情推进，还有情感成长弧。

=== 世界观深度 ===
- 世界观要能支撑 ${input.plannedTotalChapters?.min ?? 500}+ 章——多个地域/势力/力量层级
- 主线冲突有足够"升级空间"——从小舞台到大舞台
- 反派/对手有梯度——不能一开始打终极boss

=== 读者画像（readerPersona） ===
精确建模目标读者：demographics、dailyFrustrations、coreFantasy、projectionAnchor、emotionalNeeds、triggerScenes
- projectionAnchor 最关键：主角身上什么特质让读者觉得"这就是我想成为的人"

=== 金手指设计 ===
- 独特（不是"系统+面板"老套路）、有限制、可进化
- evolutionPath 阶段数匹配总章数（每100-150章约1个进化阶段）
- hiddenDepth：金手指背后的秘密，后期可成为剧情大转折种子

=== 主题内核（thematicCore，最重要的灵魂） ===
- centralQuestion：这本书的核心命题是什么？不是"主角要变强"，而是"力量让人自由还是孤独？"
- thematicProgression：主题在故事中如何演变？每个阶段的答案都不同。如["代价是值得的","代价太沉重了","代价已经成为我的一部分"]
- recurringMotif：贯穿全书的意象/符号，如"雪"="孤独与纯洁"，"火"="野心与毁灭"
- 好的主题让每个剧情选择有深层意义，差的主题让故事沦为打怪升级

=== 概念自评（conceptEvaluation） ===
hookScore、uniquenessScore、marketFitScore、projectionScore（0-10）
overallViability：weak/passable/strong/exceptional
- 新增 addictionScore：读者读到第10章时有多难放下？（0-10）
- 如果 overallViability = weak 或 hookScore < 6，主动调整

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
8. seed.goldenFinger 设计一个独特的、有限制的、可进化的金手指——进化阶段数量要匹配总章数（每100-150章约1个进化阶段）
9. seed.thematicCore 设计核心命题——不是剧情目标，而是人性命题。thematicProgression 阶段数匹配大纲阶段数。
10. seed.conceptEvaluation 诚实评估这个概念的商业潜力，特别评估"世界观深度是否够支撑 ${input.plannedTotalChapters?.min ?? 500}+ 章"
10. outline.points 包含合理数量的故事阶段节点（匹配 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章的规模，每阶段约占总章数的8%-15%），每个标明阶段和暂定章节范围
11. outline.estimatedTotalChapters 设为你估算的合理总章数
12. outline.estimatedVolumes 根据总章数和故事结构估算合理卷数（参考：50章→1卷，100章→2卷，200章→3卷，400章→4卷，600章→5卷，1000章→6-8卷）
13. outline.endingDirection 只给一个模糊的结局方向，允许后续调整
14. 如果你评估出来概念偏弱（hookScore < 6 或 overallViability = weak），主动在生成中调整优化`,
      temperature: 0.6,
    });
  }
}
