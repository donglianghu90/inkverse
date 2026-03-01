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
  namingConventionSchema,
  StorySeed,
  RoughOutline,
  NamingConvention,
} from '../schemas/novel-state.schemas';
import { WRITING_SOUL_PLAYBOOK } from '../prompting/novel-playbook';

export interface SeedAnalysisInput {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'; // 主角叙事聚焦
  tonePreference?: string; // 调性偏好
  audienceTags?: string[]; // 受众标签
  titleHint?: string;
  mainStoryGoal?: string;
  targetChapterWordCount?: number;
  plannedTotalChapters?: { min: number; max: number };
  seedHints?: { // 来自 DB 模板的题材定制提示
    coreLoopPatterns?: string[];
    goldenFingerGuidance?: string;
    worldBuildingDirectives?: string;
    namingDefaults?: {
      personNameStyle?: string;
      locationNameStyle?: string;
      abilityNameStyle?: string;
      factionNameStyle?: string;
      itemNameStyle?: string;
      examples?: {
        personNames?: string[];
        locationNames?: string[];
        abilityNames?: string[];
        factionNames?: string[];
      };
      taboos?: string[];
    };
  };
}

const seedAnalysisOutputSchema = z.object({
  seed: storySeedSchema,
  outline: roughOutlineSchema,
  namingConvention: namingConventionSchema,
});

type SeedAnalysisOutput = z.infer<typeof seedAnalysisOutputSchema> & { namingConvention?: NamingConvention };
type OutlinePhase = 'opening' | 'development' | 'climax' | 'resolution';

@Injectable()
export class SeedAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(input: SeedAnalysisInput): Promise<SeedAnalysisOutput> {
    const raw = await this.llm.generateStructured({
      taskName: 'seed-analyzer',
      schema: seedAnalysisOutputSchema,
      systemPrompt: `你是一位资深网文策划+读者心理专家。你的目标是设计一个让读者欲罢不能的故事引擎——核心循环、情感锚点和节奏呼吸缺一不可。

=== 核心原则 ===
- 长篇网文（${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800}章，每章约${input.targetChapterWordCount ?? 3000}字，总约${Math.round(((input.plannedTotalChapters?.min ?? 500) + (input.plannedTotalChapters?.max ?? 800)) / 2 * (input.targetChapterWordCount ?? 3000) / 10000)}万字）
- 故事种子是"方向"不是"规范"，后续可偏离
- 粗大纲阶段数和每阶段章数必须匹配总章数规模（如50章→3-5阶段每阶段10-17章，200章→5-8阶段每阶段25-40章，600章→8-15阶段每阶段40-100章）
- 所有输出简体中文

=== 核心循环设计（最重要——决定书能不能追下去） ===
每本成功的长篇网文都有一个让读者上瘾的"核心循环"。你必须根据题材设计它。
常见核心循环模式（根据题材选择最合适的，也可混合）：
- 逆袭式（热血/爽文）：被小看→积蓄→关键爆发→震惊众人→更大的舞台→再被小看…
- 解谜式（悬疑/探险）：发现异常→追查→更大谜团→碎片答案→世界观扩大…
- 情感式（言情/群像）：误解→接近→摩擦→心动→外部阻碍→更深的纠葛…
- 博弈式（权谋/商战）：布局→试探→对手反击→绝境→翻盘→更大的棋局…
- 成长式（日常/青春）：挑战→挣扎→小突破→新认知→更大挑战…
- 收集式（修仙/游戏/宝可梦）：探索新地图→发现资源→收集/掌控→强化→更大世界的门打开…
- 势力式（商战/政治/国战）：建立据点→扩张→遭遇强敌→应对/联盟→格局跃升…
- 双线式（灵异/穿越/平行世界）：现实事件→异世界事件→两线交汇→认知重塑→新的分裂…
- 恐惧式（恐怖/惊悚）：日常平静→微妙异常→恐惧升级→短暂安全→更深层的不安…
- 竞技式（体育/电竞）：训练瓶颈→发现对手→备战磨合→关键对决→新的赛季/目标…
${input.seedHints?.coreLoopPatterns?.length ? `- ${input.seedHints.coreLoopPatterns.map((p) => `【题材定制】${p}`).join('\n- ')}` : ''}
- 核心循环的关键：每次重复都有变化，但读者每次都期待"这次会怎样"。
- 你要明确定义：
  1) 循环的起点状态（主角面临什么处境）
  2) 循环的上升路径（如何积蓄势能）
  3) 循环的爆发点（读者获得满足感的瞬间）
  4) 循环的重置机制（如何让主角回到新的起点但更高一层）

=== 情感锚点设计 ===
主角的核心优势/能力不只是"工具"，它必须承载情感：
- 核心优势的来源/代价要和角色的核心情感挂钩（继承自亡者→思念、偷来的机会→愧疚、代价是某种牺牲→恐惧）
- 每次使用核心优势时，读者不只感到满足，还感到一丝情绪波动

=== 大纲的情感主题 ===
每个大阶段节点除了剧情描述，还要有"情感主题"：
- 例：第一阶段（1-50章）→ 情感主题："孤独者找到归属"
- 例：第二阶段（51-120章）→ 情感主题："信任被背叛后的重建"
- 这样每个阶段不只有剧情推进，还有情感成长弧。

=== 世界观深度 ===
- 世界观要能支撑 ${input.plannedTotalChapters?.min ?? 500}+ 章——多个地域/势力/力量层级
- 主线冲突有足够"升级空间"——从小舞台到大舞台
- 反派/对手有梯度——不能一开始打终极boss
${input.seedHints?.worldBuildingDirectives ? `- 【题材定制】${input.seedHints.worldBuildingDirectives}` : ''}

=== 命名哲学（按题材差异化） ===
命名不是贴标签，而是种下一粒会发芽的种子。不同题材，"成长"的载体完全不同：

【玄幻/修仙/武侠】
- 名字本身承载汉字意象（五行/自然/境界），象征多层次
- 成长载体：境界称号+外号叠加，名字不变但名号越堆越重
- nameGrowthArc：同一个名字，不同阶段旁人如何震惊于这三个字
- 示例："陈尘"→初期被嘲笑的"尘埃"→中期"震了天榜的陈尘"→终期"不敢直呼的存在"
- namingConvention：二/三字古风汉名含五行/自然意象，禁英文名/现代词

【言情/都市言情】
- 名字本身可以普通，成长不靠名字象征，靠关键人物如何称呼你的亲密度变化
- 成长载体：称呼亲密度弧线（"陆小姐"→"程程"→"老婆"）
- nameGrowthArc：storyPhase 对应感情阶段，interpretation 写称呼变化
- namingConvention：现代两三字常用名，禁古风生僻字

【历史/权谋/古代】
- 名/字/号三层系统，谁有资格叫你哪个名字本身就是权力象征
- 成长载体：官职爵位变化（被直呼名→被称字→无人敢称名）
- nameGrowthArc：每阶段圈子+称谓变化，皇帝赐字是最高荣誉

【悬疑/推理/惊悚】
- 名字可以是谜本身：真实身份 vs 假名，身份剥洋葱就是弧线
- 成长载体：代号→别名→真名揭露的戏剧冲击
- nameGrowthArc：每阶段读者对"这个人是谁"的认知层次

【西幻/奇幻】
- 命名规律比象征更重要：同一文明名字要有音韵一致性（精灵/矮人/人类各不同）
- 成长载体：冠名/封号（"Arthur" → "Arthur the Dragonslayer"）

【科幻】
- 可中可西，或代号/编号，"从编号到被人记住名字"本身就是弧线
- 成长载体：军衔/职称，或从无名到有名

【战争/军事】
- 命名强调系统感与职业感：军衔、代号、战区名、作战单位要统一风格
- 成长载体：军衔晋升与战功称号变化（士兵→班长→连长/王牌指挥官）

【无限流/规则怪谈/恐怖】
- 命名优先"可记忆的代号"：副本名、规则名、组织名要短而锋利
- 成长载体：从被规则追杀的编号者到能反向制定规则的人

【末世危机/废土】
- 命名要有生存语感：据点名、物资体系名、灾难等级名要一眼可懂
- 成长载体：从幸存者标签到据点领袖/秩序制定者

【电竞/体育/虚拟网游】
- 命名强调可传播性：ID/外号/战术名要便于读者记忆与讨论
- 成长载体：青训/路人王→首发/主力→冠军称号或历史级ID

【轻小说/二次元】
- 命名允许轻巧和梗感，但必须避免过度中二导致出戏
- 成长载体：从玩梗式人设到被读者真正共情的角色标签

通用原则：
- 配角/反派名要有两面性，不过于直白（"夺命"太露，"谢玄机"有层次）
- 牺牲型配角名可含离/别/逝意象，预埋悲剧而读者不自知
- nameGrowthArc 阶段数 = outline.points 阶段数，每阶段必须有情感转变
- seed.protagonistConcept.nameRationale：说明命名出发点（一句话，说清楚为什么叫这个名字）
- namingConvention 需输出 personNameStyle/locationNameStyle/abilityNameStyle/factionNameStyle/taboos/examples
${input.seedHints?.namingDefaults ? `- 【系统题材模板命名默认值（优先遵循）】${JSON.stringify(input.seedHints.namingDefaults)}` : ''}

=== 读者画像（readerPersona） ===
精确建模目标读者：demographics、dailyFrustrations、coreFantasy、projectionAnchor、emotionalNeeds、triggerScenes
- projectionAnchor 最关键：主角身上什么特质让读者觉得"这就是我想成为的人"

=== 核心优势设计（金手指/特殊能力/独特资源） ===
- 根据题材决定是否需要"金手指"：玄幻/科幻通常需要，言情/现实题材可设为null
- 如果需要：独特、有限制、可进化，避免老套模式
- evolutionPath 阶段数匹配总章数（每100-150章约1个进化阶段）
- hiddenDepth：背后的秘密，后期可成为剧情大转折种子
${input.seedHints?.goldenFingerGuidance ? `- 【题材定制】${input.seedHints.goldenFingerGuidance}` : ''}

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
${input.protagonistFocus ? `叙事聚焦：${input.protagonistFocus}（${({ female_lead: '女主视角优先', male_lead: '男主视角优先', dual_lead: '双主角平衡', ensemble: '群像叙事' })[input.protagonistFocus]})` : ''}
${input.tonePreference ? `调性偏好：${input.tonePreference}` : ''}
${input.audienceTags?.length ? `受众标签：${input.audienceTags.join('、')}` : ''}
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
11. outline.points 包含合理数量的故事阶段节点（匹配 ${input.plannedTotalChapters?.min ?? 500}-${input.plannedTotalChapters?.max ?? 800} 章的规模，每阶段约占总章数的8%-15%），每个标明阶段和暂定章节范围
12. outline.estimatedTotalChapters 设为你估算的合理总章数
13. outline.estimatedVolumes 根据总章数和故事结构估算合理卷数（参考：50章→1卷，100章→2卷，200章→3卷，400章→4卷，600章→5卷，1000章→6-8卷）
14. outline.endingDirection 只给一个模糊的结局方向，允许后续调整
15. 如果你评估出来概念偏弱（hookScore < 6 或 overallViability = weak），主动在生成中调整优化
16. seed.protagonistConcept.nameRationale：一句话说明命名出发点（为什么叫这个名字，与题材/主题/性格/命运的关联）
17. seed.protagonistConcept.nameGrowthArc：阶段数与 outline.points 数量相同，每阶段 interpretation + selfPerception 必须有情感转变，按题材选择合适的成长载体（玄幻=震慑感变化，言情=称呼亲密度，历史=官职称谓，悬疑=身份认知）
18. namingConvention：输出完整的命名规范，包含 personNameStyle/locationNameStyle/abilityNameStyle（如有）/factionNameStyle（如有）/taboos/examples（至少3个人名示例和2个地名示例）`,
      temperature: 0.6,
    });
    return this.normalizeAndValidate(raw as Record<string, unknown>, input);
  }

  private normalizeAndValidate(raw: Record<string, unknown>, input: SeedAnalysisInput): SeedAnalysisOutput {
    const root = this.asRecord(raw);
    const seedRaw = this.asRecord(root.seed);
    const outlineRaw = this.asRecord(root.outline);
    const namingRaw = this.asRecord(root.namingConvention);

    const plannedMin = this.asInt(seedRaw.plannedTotalChapters, 'min')
      ?? input.plannedTotalChapters?.min
      ?? 500;
    const plannedMax = this.asInt(seedRaw.plannedTotalChapters, 'max')
      ?? input.plannedTotalChapters?.max
      ?? 800;
    const targetWords = this.asNumber(seedRaw.targetChapterWordCount) ?? input.targetChapterWordCount ?? 3000;

    const protagonistRaw = this.asRecord(seedRaw.protagonistConcept);
    const gfRaw = this.asRecord(seedRaw.goldenFinger);
    const ceRaw = this.asRecord(seedRaw.conceptEvaluation);
    const thematicRaw = this.asRecord(seedRaw.thematicCore);
    const rpRaw = this.asRecord(seedRaw.readerPersona);

    const normalized: Record<string, unknown> = {
      seed: {
        ...seedRaw,
        title: this.asString(seedRaw.title) || input.titleHint || '未命名作品',
        genre: this.asString(seedRaw.genre) || input.genre,
        targetAudience: this.asString(seedRaw.targetAudience) || input.targetAudience,
        logline: this.asString(seedRaw.logline) || input.mainIdea,
        protagonistConcept: {
          name: this.asString(protagonistRaw.name) || '未命名主角',
          nameRationale: this.asString(protagonistRaw.nameRationale) || undefined,
          nameGrowthArc: this.normalizeNameGrowthArc(protagonistRaw.nameGrowthArc),
          situation: this.asString(protagonistRaw.situation) || input.mainIdea.slice(0, 80),
          coreDesire: this.asString(protagonistRaw.coreDesire) || input.mainStoryGoal || '在冲突中活下来并找到答案',
          personality: this.asString(protagonistRaw.personality) || '坚韧且谨慎',
        },
        tone: this.asString(seedRaw.tone) || '紧张、克制、具画面感',
        coreConflictDirection: this.asString(seedRaw.coreConflictDirection) || input.mainStoryGoal || '在不断升级的冲突中逼近真相',
        redLines: this.normalizeStringArray(seedRaw.redLines, ['禁止流水账', '禁止设定自相矛盾', '禁止角色工具化']),
        targetChapterWordCount: targetWords,
        plannedTotalChapters: { min: plannedMin, max: Math.max(plannedMin, plannedMax) },
        readerPersona: this.normalizeReaderPersona(rpRaw),
        goldenFinger: this.normalizeGoldenFinger(gfRaw),
        conceptEvaluation: this.normalizeConceptEvaluation(ceRaw),
        thematicCore: this.normalizeThematicCore(thematicRaw),
      },
      outline: this.normalizeOutline(outlineRaw, plannedMin, plannedMax),
      namingConvention: this.normalizeNamingConvention(namingRaw, input.genre, input.seedHints?.namingDefaults),
    };

    return seedAnalysisOutputSchema.parse(normalized);
  }

  private normalizeOutline(outlineRaw: Record<string, unknown>, plannedMin: number, plannedMax: number): Record<string, unknown> {
    const pointsRaw = Array.isArray(outlineRaw.points) ? outlineRaw.points : [];
    const points = pointsRaw.map((p, idx, arr) => {
      const pr = this.asRecord(p);
      const description = this.asString(pr.description)
        || [this.asString(pr.title), this.asString(pr.plotSummary)].filter(Boolean).join('：')
        || `阶段${idx + 1}推进`;
      const tentativeChapterRange = this.asString(pr.tentativeChapterRange)
        || this.asString(pr.chapterRange)
        || `${Math.max(1, Math.floor(((plannedMin + plannedMax) / 2) * (idx / Math.max(arr.length, 1)))) + 1}-${Math.max(1, Math.floor(((plannedMin + plannedMax) / 2) * ((idx + 1) / Math.max(arr.length, 1))))}`;
      return {
        phase: this.normalizePhase(pr.phase, idx, arr.length),
        description,
        tentativeChapterRange,
      };
    });

    const fallbackPhases: OutlinePhase[] = ['opening', 'development', 'climax', 'resolution'];
    while (points.length < 4) {
      points.push({
        phase: fallbackPhases[points.length],
        description: `阶段${points.length + 1}推进`,
        tentativeChapterRange: '待定',
      });
    }

    const estimatedTotalChapters = this.asNumber(outlineRaw.estimatedTotalChapters)
      ?? Math.round((plannedMin + plannedMax) / 2);
    const normalized: Record<string, unknown> = {
      points,
      endingDirection: this.asString(outlineRaw.endingDirection) || '在主角完成核心目标后留下可延展余韵',
      estimatedTotalChapters,
    };
    const estimatedVolumes = this.asNumber(outlineRaw.estimatedVolumes);
    if (estimatedVolumes) normalized.estimatedVolumes = estimatedVolumes;
    return normalized;
  }

  private normalizePhase(raw: unknown, idx: number, total: number): OutlinePhase {
    if (raw === 'opening' || raw === 'development' || raw === 'climax' || raw === 'resolution') return raw;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n <= 1) return 'opening';
    if (Number.isFinite(n) && n >= Math.max(2, total)) return 'resolution';
    if (Number.isFinite(n) && n >= Math.max(2, total - 1)) return 'climax';
    if (total <= 1) return 'opening';
    if (idx === 0) return 'opening';
    if (idx >= total - 1) return 'resolution';
    if (idx === total - 2) return 'climax';
    return 'development';
  }

  private normalizeReaderPersona(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(raw).length === 0) return undefined;
    return {
      demographics: this.asString(raw.demographics) || '网文读者',
      dailyFrustrations: this.normalizeStringArray(raw.dailyFrustrations, ['现实压力大，需要情绪出口']),
      coreFantasy: this.asString(raw.coreFantasy) || '在高压处境中掌控命运',
      projectionAnchor: this.asString(raw.projectionAnchor) || '主角在逆境中的主动性',
      emotionalNeeds: this.normalizeEmotionalNeeds(raw.emotionalNeeds),
      triggerScenes: this.normalizeStringArray(raw.triggerScenes, ['关键线索被揭示的瞬间']),
    };
  }

  private normalizeGoldenFinger(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(raw).length === 0) return undefined;
    const evolutionPathRaw = Array.isArray(raw.evolutionPath) ? raw.evolutionPath : [];
    const evolutionPath = evolutionPathRaw.map((item, idx) => {
      const r = this.asRecord(item);
      if (typeof item === 'string') {
        return { stage: `阶段${idx + 1}`, description: item, newCapability: item };
      }
      return {
        stage: this.asString(r.stage) || `阶段${idx + 1}`,
        unlockedAtChapter: this.asNumber(r.unlockedAtChapter),
        description: this.asString(r.description) || this.asString(r.detail) || `阶段${idx + 1}能力强化`,
        newCapability: this.asString(r.newCapability) || this.asString(r.description) || `阶段${idx + 1}新增能力`,
      };
    });
    return {
      name: this.asString(raw.name) || '核心优势',
      concept: this.asString(raw.concept) || this.asString(raw.name) || '关键能力',
      uniqueness: this.asString(raw.uniqueness) || '具备独特代价与边界',
      currentStage: this.asString(raw.currentStage) || '初始阶段',
      evolutionPath,
      limitations: this.normalizeStringArray(raw.limitations, []),
      hiddenDepth: this.asString(raw.hiddenDepth) || undefined,
    };
  }

  private normalizeConceptEvaluation(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(raw).length === 0) return undefined;
    return {
      hookScore: this.clampScore(this.asNumber(raw.hookScore), 7),
      uniquenessScore: this.clampScore(this.asNumber(raw.uniquenessScore), 7),
      marketFitScore: this.clampScore(this.asNumber(raw.marketFitScore), 7),
      projectionScore: this.clampScore(this.asNumber(raw.projectionScore), 7),
      overallViability: this.normalizeViability(raw.overallViability),
      strengthNotes: this.normalizeStringArray(raw.strengthNotes, ['核心冲突具备持续升级空间']),
      weaknessNotes: this.normalizeStringArray(raw.weaknessNotes, ['需持续强化角色情感锚点']),
      suggestions: this.normalizeStringArray(raw.suggestions, ['每卷明确阶段目标并抬升代价']),
    };
  }

  private normalizeThematicCore(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    if (Object.keys(raw).length === 0) return undefined;
    return {
      centralQuestion: this.asString(raw.centralQuestion) || '人在代价面前如何选择',
      thematicProgression: this.normalizeStringArray(raw.thematicProgression, ['代价出现', '选择升级', '自我重构']),
      recurringMotif: this.asString(raw.recurringMotif) || undefined,
    };
  }

  private normalizeViability(v: unknown): 'weak' | 'passable' | 'strong' | 'exceptional' {
    if (v === 'weak' || v === 'passable' || v === 'strong' || v === 'exceptional') return v;
    return 'strong';
  }

  private clampScore(v: number | undefined, fallback: number): number {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.max(0, Math.min(10, n));
  }

  private normalizeStringArray(value: unknown, fallback: string[]): string[] {
    if (Array.isArray(value)) {
      const arr = value.map((v) => this.asString(v)).filter(Boolean);
      return arr.length ? arr : fallback;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[，,；;、\n]/).map((s) => s.trim()).filter(Boolean);
    }
    return fallback;
  }

  private normalizeEmotionalNeeds(value: unknown): string[] {
    const allowed = new Set([
      'power_fantasy', 'romantic_fulfillment', 'intellectual_superiority', 'justice_served',
      'found_family', 'escape_mundane', 'underdog_triumph', 'mystery_solving', 'survival_thrill',
    ]);
    const raw = this.normalizeStringArray(value, []);
    const mapped = raw.map((item) => {
      if (allowed.has(item)) return item;
      const t = item.toLowerCase();
      if (t.includes('解谜') || t.includes('推理') || t.includes('谜团')) return 'mystery_solving';
      if (t.includes('智力') || t.includes('智商') || t.includes('优越')) return 'intellectual_superiority';
      if (t.includes('正义') || t.includes('复仇') || t.includes('公道')) return 'justice_served';
      if (t.includes('家') || t.includes('同伴') || t.includes('归属')) return 'found_family';
      if (t.includes('逆袭') || t.includes('翻盘') || t.includes('成长')) return 'underdog_triumph';
      if (t.includes('爱情') || t.includes('恋爱') || t.includes('情感')) return 'romantic_fulfillment';
      if (t.includes('生存') || t.includes('惊险') || t.includes('恐惧')) return 'survival_thrill';
      if (t.includes('逃离') || t.includes('放松') || t.includes('解压')) return 'escape_mundane';
      if (t.includes('掌控') || t.includes('变强') || t.includes('力量')) return 'power_fantasy';
      return '';
    }).filter(Boolean);
    const dedup = [...new Set(mapped)];
    return dedup.length ? dedup : ['mystery_solving'];
  }

  private normalizeNameGrowthArc(value: unknown): Array<{ storyPhase: string; interpretation: string; selfPerception: string }> | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    const result = value.map((item) => {
      const r = this.asRecord(item);
      return {
        storyPhase: this.asString(r.storyPhase) || this.asString(r.phase) || '阶段',
        interpretation: this.asString(r.interpretation) || this.asString(r.externalView) || '',
        selfPerception: this.asString(r.selfPerception) || this.asString(r.internalView) || '',
      };
    }).filter((a) => a.interpretation || a.selfPerception);
    return result.length ? result : undefined;
  }

  private normalizeNamingConvention(
    raw: Record<string, unknown>,
    genre: string,
    templateDefaults?: NonNullable<SeedAnalysisInput['seedHints']>['namingDefaults'],
  ): Record<string, unknown> | undefined {
    const fallback = this.genreNamingFallback(genre);
    const defaults = this.asRecord(templateDefaults ?? {});
    const defaultExamples = this.asRecord(defaults.examples);
    if (Object.keys(raw).length === 0 && Object.keys(defaults).length === 0) return fallback;
    const examplesRaw = this.asRecord(raw.examples);
    return {
      personNameStyle: this.asString(defaults.personNameStyle) || this.asString(raw.personNameStyle) || fallback.personNameStyle,
      locationNameStyle: this.asString(defaults.locationNameStyle) || this.asString(raw.locationNameStyle) || fallback.locationNameStyle,
      abilityNameStyle: this.asString(defaults.abilityNameStyle) || this.asString(raw.abilityNameStyle) || undefined,
      factionNameStyle: this.asString(defaults.factionNameStyle) || this.asString(raw.factionNameStyle) || undefined,
      itemNameStyle: this.asString(defaults.itemNameStyle) || this.asString(raw.itemNameStyle) || undefined,
      examples: {
        personNames: this.normalizeStringArray(defaultExamples.personNames ?? examplesRaw.personNames ?? raw.personNameExamples, fallback.examples.personNames),
        locationNames: this.normalizeStringArray(defaultExamples.locationNames ?? examplesRaw.locationNames ?? raw.locationNameExamples, fallback.examples.locationNames),
        abilityNames: this.normalizeStringArray(defaultExamples.abilityNames ?? examplesRaw.abilityNames ?? raw.abilityNameExamples, []),
        factionNames: this.normalizeStringArray(defaultExamples.factionNames ?? examplesRaw.factionNames ?? raw.factionNameExamples, []),
      },
      taboos: this.normalizeStringArray(defaults.taboos ?? raw.taboos, []),
    };
  }

  private genreNamingFallback(genre: string): {
    personNameStyle: string;
    locationNameStyle: string;
    examples: { personNames: string[]; locationNames: string[] };
  } {
    const g = genre.toLowerCase();
    if (/(玄幻|仙侠|修仙|武侠|xianxia|xuanhuan|wuxia)/.test(g)) {
      return {
        personNameStyle: '二到三字中文名，优先自然/五行意象，避免现代英文拼写',
        locationNameStyle: '地貌+方位或意象组合（如“北陵”“落霞谷”）',
        examples: { personNames: ['凌霜', '顾长歌', '沈青岚'], locationNames: ['落霞谷', '北陵城'] },
      };
    }
    if (/(西方奇幻|western-fantasy|奇幻|fantasy)/.test(g)) {
      return {
        personNameStyle: '可中可西但需同文明音韵统一（人类/精灵/矮人命名规则分层）',
        locationNameStyle: '王国/城邦/遗迹命名统一语系，避免中西混搭突兀',
        examples: { personNames: ['Arthur Vale', 'Elyra', 'Thorne'], locationNames: ['Silverkeep', 'Ashen Vale'] },
      };
    }
    if (/(科幻|sci-fi|scifi|赛博|机甲|星际)/.test(g)) {
      return {
        personNameStyle: '姓名/代号并存，允许编号或呼号，保持组织体系一致',
        locationNameStyle: '空间站/殖民地/舰队基地命名，突出科技感与层级',
        examples: { personNames: ['林序-07', '韩霁', 'Kestrel'], locationNames: ['天枢轨道站', 'C-12殖民环'] },
      };
    }
    if (/(战争\/军事|军事|military|战争|谍战|特种兵)/.test(g)) {
      return {
        personNameStyle: '简洁有辨识度，结合军衔/代号/呼号，避免花哨',
        locationNameStyle: '战区/防线/据点命名，强调方位与战术语义',
        examples: { personNames: ['周烈', '“灰狼”沈拓', '顾砚'], locationNames: ['北境三号防线', '青岚前进基地'] },
      };
    }
    if (/(无限流|infinite-flow|规则怪谈|恐怖|灵异|悬疑惊悚|suspense-thriller|horror|supernatural)/.test(g)) {
      return {
        personNameStyle: '优先短名/代号，便于高压副本中快速识别与记忆',
        locationNameStyle: '副本/禁区/规则场命名短促明确，带危险提示感',
        examples: { personNames: ['许岚', '“白鸦”', '周祁'], locationNames: ['第四病栋', '雾港12号站'] },
      };
    }
    if (/(末世危机|post-apocalyptic|末世|废土)/.test(g)) {
      return {
        personNameStyle: '生存语感优先，可带绰号但不过度中二',
        locationNameStyle: '避难所/据点/污染区命名一眼可懂',
        examples: { personNames: ['沈砾', '“扳手”阿川', '林昼'], locationNames: ['黎明避难所', '黑雨污染区'] },
      };
    }
    if (/(电子竞技|虚拟网游|体育竞技|esports|vrmmo|sports|game)/.test(g)) {
      return {
        personNameStyle: '本名+ID双轨命名，ID需短、好读、可传播',
        locationNameStyle: '赛场/俱乐部/服务器地名，强调赛事与运营语境',
        examples: { personNames: ['陈临(ID:Lin)', '苏禾(ID:Hex)', '宋野(ID:Apex)'], locationNames: ['星环联赛主舞台', '曙光一区'] },
      };
    }
    if (/(轻小说|light-novel|二次元)/.test(g)) {
      return {
        personNameStyle: '轻巧顺口、可带一点梗感，但避免过度夸张',
        locationNameStyle: '校园/社团/街区命名可爱且清晰，保持日常感',
        examples: { personNames: ['白川悠', '林可奈', '顾时雨'], locationNames: ['樱丘学园', '银杏商店街'] },
      };
    }
    if (/(冒险\/探险|adventure|冒险|探险|盗墓|寻宝)/.test(g)) {
      return {
        personNameStyle: '短而硬朗、便于队内称呼，绰号可体现技能分工',
        locationNameStyle: '遗迹/禁区/海域/山脉命名应突出地理风险与未知感',
        examples: { personNames: ['顾野', '“罗盘”林策', '唐砾'], locationNames: ['黑帆海沟', '沉星遗迹'] },
      };
    }
    if (/(超能力\/异能|superpower|异能|超能力|觉醒|学院)/.test(g)) {
      return {
        personNameStyle: '现代名为主，可配能力代号，避免中二堆词',
        locationNameStyle: '学院/研究所/管控区命名需体现制度与阵营差异',
        examples: { personNames: ['季衡', '宁初', '代号“棱镜”'], locationNames: ['新曜异能学院', '第七收容区'] },
      };
    }
    if (/(史诗\/传奇|epic|史诗|传奇|群像|王朝兴衰)/.test(g)) {
      return {
        personNameStyle: '可采用名/姓/称号并行体系，主角群命名要区分文明来源',
        locationNameStyle: '帝国/城邦/古战场命名强调历史纵深与地缘格局',
        examples: { personNames: ['阿列斯·维恩', '裴烬', '“北境之狮”岑岳'], locationNames: ['赤曜帝国', '白霜长垣'] },
      };
    }
    if (/(儿童\/少儿文学|children|儿童|少儿|童话)/.test(g)) {
      return {
        personNameStyle: '亲切易读、发音明快，避免生僻字与过复杂称号',
        locationNameStyle: '场景名应具画面感与温暖想象，便于低龄读者记忆',
        examples: { personNames: ['小满', '豆豆', '安安'], locationNames: ['彩虹镇', '风铃森林'] },
      };
    }
    if (/(古代言情|ancient-romance|古代|宫斗|宅斗)/.test(g)) {
      return {
        personNameStyle: '古风中文名，可结合名/字/号体系，避免现代口语化命名',
        locationNameStyle: '府邸/州郡/宫苑命名，符合古代礼制与地理语感',
        examples: { personNames: ['沈清辞', '裴砚之', '谢明昭'], locationNames: ['长乐宫', '临安侯府'] },
      };
    }
    if (/(幻想言情|fantasy-romance|仙侠恋|神魔恋)/.test(g)) {
      return {
        personNameStyle: '古风与幻想混合命名，保留诗性与宿命感',
        locationNameStyle: '仙域/神域/秘境命名，强调唯美与层级',
        examples: { personNames: ['姬扶月', '谢无咎', '云照晚'], locationNames: ['太初天阙', '忘川镜海'] },
      };
    }
    if (/(现代言情|urban-romance|言情|都市|romance)/.test(g)) {
      return {
        personNameStyle: '现代常见中文名，简洁顺口，避免古风生僻字',
        locationNameStyle: '现代城市/街区/地标命名，贴近现实语境',
        examples: { personNames: ['程予安', '陆知夏', '周言'], locationNames: ['滨江公寓', '临江路'] },
      };
    }
    if (/(历史|权谋|古代)/.test(g)) {
      return {
        personNameStyle: '古代语感中文名，可结合名/字/号体系',
        locationNameStyle: '州郡城池/关隘风格命名，符合古代政区语感',
        examples: { personNames: ['谢玄机', '裴慎', '柳明昭'], locationNames: ['青州', '雁门关'] },
      };
    }
    return {
      personNameStyle: '符合题材语境且易记的人名，避免突兀跨风格命名',
      locationNameStyle: '与世界观语境一致的地名，保持同一文明命名规律',
      examples: { personNames: ['林湛', '许未央', '顾遥'], locationNames: ['旧港区', '灰塔城'] },
    };
  }

  private asRecord(v: unknown): Record<string, unknown> {
    return (typeof v === 'object' && v !== null) ? v as Record<string, unknown> : {};
  }

  private asString(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  private asNumber(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  private asInt(v: unknown, key: string): number | undefined {
    const r = this.asRecord(v);
    const n = Number(r[key]);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  }
}
