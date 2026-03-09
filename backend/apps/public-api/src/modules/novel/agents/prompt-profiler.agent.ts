/**
 * PromptProfiler Agent — 开书时生成题材定制化的写作手册。
 *
 * 用现有的玄幻 Profile 作为 few-shot example，
 * 让 AI 按照同样的深度和结构为任何题材生成适配的 Profile。
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import {
  BookPromptProfile,
  bookPromptProfileSchema,
} from '../schemas/novel-state.schemas';
import {
  XIANXIA_REFERENCE_PROFILE,
  ROMANCE_REFERENCE_PROFILE,
  MYSTERY_REFERENCE_PROFILE,
  formatProfileAsExample,
} from '../prompting/reference-profiles';
import {
  URBAN_REFERENCE_PROFILE, HISTORICAL_REFERENCE_PROFILE,
  WESTERN_FANTASY_REFERENCE_PROFILE, SCI_FI_REFERENCE_PROFILE,
  WUXIA_REFERENCE_PROFILE, MILITARY_REFERENCE_PROFILE,
  HORROR_REFERENCE_PROFILE, SUPERNATURAL_REFERENCE_PROFILE,
  ADVENTURE_REFERENCE_PROFILE, GAME_REFERENCE_PROFILE,
  ESPORTS_REFERENCE_PROFILE, VRMMO_REFERENCE_PROFILE,
  SPORTS_REFERENCE_PROFILE, SUPERPOWER_REFERENCE_PROFILE,
  LIGHT_NOVEL_REFERENCE_PROFILE, POST_APOCALYPTIC_REFERENCE_PROFILE,
  SUSPENSE_THRILLER_REFERENCE_PROFILE, INFINITE_FLOW_REFERENCE_PROFILE,
  XUANHUAN_REFERENCE_PROFILE, URBAN_ROMANCE_REFERENCE_PROFILE, ANCIENT_ROMANCE_REFERENCE_PROFILE,
  EPIC_REFERENCE_PROFILE, FANTASY_ROMANCE_REFERENCE_PROFILE,
  CHILDREN_REFERENCE_PROFILE,
} from '../prompting/genre-reference-profiles';

export interface ProfileInput {
  genre: string;
  targetAudience: string;
  mainIdea: string;
  tone?: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  writingMode?: 'commercial' | 'literary';
  mainStoryGoal?: string;
  userId?: string;
  targetChapterWordCount?: number;
  plannedTotalChapters?: { min: number; max: number };
  referenceProfile?: BookPromptProfile;
}

const GENRE_KEYWORDS: Array<{ profile: BookPromptProfile; keywords: string[] }> = [
  { profile: XUANHUAN_REFERENCE_PROFILE, keywords: ['玄幻', '高武', '异界', '御兽', '退婚流', 'xuanhuan'] },
  { profile: INFINITE_FLOW_REFERENCE_PROFILE, keywords: ['无限流', '主神空间', '轮回', '副本', 'infinite-flow'] },
  { profile: LIGHT_NOVEL_REFERENCE_PROFILE, keywords: ['轻小说', '二次元', '轻改', 'light-novel'] },
  { profile: POST_APOCALYPTIC_REFERENCE_PROFILE, keywords: ['末世危机', '末世', '废土', 'post-apocalyptic', '丧尸'] },
  { profile: SUSPENSE_THRILLER_REFERENCE_PROFILE, keywords: ['悬疑惊悚', '心理惊悚', '连环杀手', 'suspense-thriller'] },
  { profile: ESPORTS_REFERENCE_PROFILE, keywords: ['电子竞技', '电竞', 'esports', '职业联赛'] },
  { profile: VRMMO_REFERENCE_PROFILE, keywords: ['虚拟网游', '全息网游', 'vrmmo', 'mmo', '网游'] },
  { profile: URBAN_ROMANCE_REFERENCE_PROFILE, keywords: ['现代言情', '都市言情', '甜宠', '先婚后爱', 'urban-romance'] },
  { profile: ANCIENT_ROMANCE_REFERENCE_PROFILE, keywords: ['古代言情', '宅斗', '宫斗', '重生复仇', 'ancient-romance'] },
  { profile: URBAN_REFERENCE_PROFILE, keywords: ['都市', '现实', '职场', '商战', '白领', '都市生活', '社会', '现代'] },
  { profile: HISTORICAL_REFERENCE_PROFILE, keywords: ['历史', '朝堂', '权谋', '宫廷', '三国', '架空历史', '古代', '王朝'] },
  { profile: WUXIA_REFERENCE_PROFILE, keywords: ['武侠', '江湖', '侠客', '门派', '武林', '刀剑', '新武侠'] },
  { profile: MILITARY_REFERENCE_PROFILE, keywords: ['军事', '战争', '军旅', '谍战', '抗战', '特种兵', '军人'] },
  { profile: WESTERN_FANTASY_REFERENCE_PROFILE, keywords: ['西幻', '西方奇幻', '魔法', '精灵', '矮人', '龙', '中世纪', 'dnd'] },
  { profile: SCI_FI_REFERENCE_PROFILE, keywords: ['科幻', '太空', '赛博朋克', '末日', '废土', '机甲', '星际', 'ai', '外星'] },
  { profile: HORROR_REFERENCE_PROFILE, keywords: ['恐怖', 'horror', '惊悚', '克苏鲁', '哥特', '丧尸'] },
  { profile: SUPERNATURAL_REFERENCE_PROFILE, keywords: ['灵异', '超自然', '鬼', '通灵', '道士', '驱邪', '风水', '阴阳'] },
  { profile: ADVENTURE_REFERENCE_PROFILE, keywords: ['冒险', '探险', '盗墓', '寻宝', '考古', '荒野求生', '地下城'] },
  { profile: GAME_REFERENCE_PROFILE, keywords: ['游戏', '电竞', '网游', '虚拟现实', 'vr', 'mmo', '直播'] },
  { profile: SPORTS_REFERENCE_PROFILE, keywords: ['体育', '竞技', '篮球', '足球', '拳击', '赛车', '格斗'] },
  { profile: SUPERPOWER_REFERENCE_PROFILE, keywords: ['超能力', '异能', '觉醒', '变异', '超英', '能力者'] },
  { profile: EPIC_REFERENCE_PROFILE, keywords: ['史诗', '传奇', '群像', '王朝', '文明', '多线'] },
  { profile: FANTASY_ROMANCE_REFERENCE_PROFILE, keywords: ['幻想言情', '仙恋', '神话爱情', '跨界恋爱', '前世今生', '人妖恋', '仙凡恋', 'fantasy-romance'] },
  { profile: CHILDREN_REFERENCE_PROFILE, keywords: ['儿童', '少儿', '童话', '少年', '成长', '校园冒险'] },
  { profile: ROMANCE_REFERENCE_PROFILE, keywords: ['言情', '恋爱', '青春', '甜宠', 'romance', '婚恋', '暗恋', '总裁', '豪门', '先婚后爱'] },
  { profile: MYSTERY_REFERENCE_PROFILE, keywords: ['悬疑', '推理', '侦探', '刑侦', '犯罪', '谋杀', 'mystery', '探案', '破案', '密室'] },
  { profile: XIANXIA_REFERENCE_PROFILE, keywords: ['仙侠', '修仙', '飞升', '宗门', '渡劫', '凡人流', 'xianxia'] },
];

@Injectable()
export class PromptProfilerAgent {
  constructor(private readonly llm: LlmService) {}

  private selectReference(genre: string): BookPromptProfile { // 根据题材关键词匹配最接近的参考Profile，无匹配时默认玄幻
    const g = genre.toLowerCase();
    for (const { profile, keywords } of GENRE_KEYWORDS) {
      if (keywords.some((kw) => g.includes(kw))) return profile;
    }
    return XIANXIA_REFERENCE_PROFILE;
  }

  async generate(input: ProfileInput): Promise<BookPromptProfile> {
    const bestRef = input.referenceProfile ?? this.selectReference(input.genre); // DB 模板优先，硬编码兜底
    const referenceExample = formatProfileAsExample(bestRef);

    const raw = await this.llm.generateStructured({
      taskName: 'prompt-profiler',
      schema: bookPromptProfileSchema,
      tags: ['setup', 'profile'],
      metadata: { userId: input.userId ?? '' },
      systemPrompt: `${input.writingMode === 'literary'
        ? '你是一位兼具文学素养与编辑经验的创作顾问，精通各类题材的写作规律和文学创新。'
        : '你是一位资深的网文编辑总监，同时精通各类网文题材的写作规律。'}

你的任务是为一本新书生成一份完整的"写作手册"（BookPromptProfile）。
这份手册会被 AI 写手、AI 审阅员等角色在整个创作过程中持续使用。

以下是一份"${bestRef.generatedForGenre}"题材的参考范例——它展示了手册应有的深度和细节水平：

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
  - 描述这个题材的理想节奏"感觉"和原则。
  - ⚠️ 禁止写死绝对章数间隔（如"每3-5章一个高潮"）——不同规模的小说（100章 vs 600章）需要完全不同的间隔。
  - 用描述性语言说明节奏模式（如"铺垫不宜太长，尽快给小爽点"而非"不超过2章"），具体的爽感/满足间隔由 IntentAgent 根据实时状态动态决定。
  - 说明什么时候该加速/减速，以及长短篇的节奏差异。

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
  - 禁止设置硬性分数上限（例如"不超过8.5"）。反虚高应通过"证据门槛"实现：8+必须有可引用证据，9+必须达到题材标杆说明。

10.【世界观配置 worldProfile】
  - organizationTypes: 这个题材有什么类型的组织？
  - powerSystemApplicable: 是否需要力量体系？
  - goldenFingerApplicable: 是否需要"金手指"（主角特殊能力）？
  - commitmentTypes: 角色之间会产生什么类型的承诺？
  - characterRelationEmphasis: 人际关系的重心在哪？

11.【文风参考文本 styleReferenceTexts】
  - 写2-3段"理想文风"的示范文本（每段150-200字）。
  - 这些文本不是故事内容，而是展示这本书应该有的"质感"——句式节奏、用词习惯、描写密度。
  - Writer会把这些当作"模仿这种感觉"的参考。
  - 要匹配题材和调性——玄幻的冷峻和言情的细腻是完全不同的。

12.【章节类型模板 chapterTypeTemplates】
  - 为 climax/setup/rising/relief 四种章节类型各写一段题材定制的写作模板。
  - 每个模板描述该章节类型在此题材中的结构、技法和节奏要求。
  - 示例：玄幻的高潮章强调"旁观者阶梯式震惊"，悬疑的高潮章强调"线索瀑布式串联+认知翻转"，言情的高潮章强调"情感临界点+角色内心决堤"。
  - 格式：JSON Record<string, string>，key 为 climax/setup/rising/relief。

13.【首章策略 firstChaptersStrategy】
  - 一段话描述前3章的特殊策略——这个题材如何在开头抓住读者。
  - 示例：玄幻强调"100字内建立不公+暗示金手指"，悬疑强调"第一章结尾必须出现核心谜团"，言情强调"第一章建立男女主化学反应"。

14.【观众反应写法 audienceReactionGuide】
  - 一段话描述此题材中如何写"关键时刻的周围人反应"来放大读者体验。
  - 不是所有题材都靠"旁观者阶梯式震惊"：悬疑靠"不同知情者的异常行为"，言情靠"闺蜜/朋友的侧面烘托"。
${input.writingMode === 'literary' ? `
=== 文学探索模式额外指引 ===
本书采用文学探索模式，生成手册时请注意：
- satisfactionTypes：除"爽感"外，增加"洞察感""美学体验""情感共鸣""认知颠覆"等文学层面的满足类型。
- hookTypes：除悬念/冲突类钩子外，增加"安静共鸣""意象余韵""开放问题""认知位移"等文学结尾类型。
- pacingGuide：允许长时间慢节奏和内省段落，节奏服务于主题深度而非追更欲。
- reviewerCalibration.dimensionWeights：originality 权重设为 1.5（商业模式为 0），hookStrength 可适当降低。
- chapterTypeTemplates：除 climax/setup/rising/relief 外，增加 introspective/fragmentary/atmospheric 三种实验章型模板。
- clichePatterns：增加对"过于工整的结构""套路化的情节转折""AI式的完美结局"等更深层套路的警示。` : ''}`,

      userPrompt: `请为以下设定生成完整的 BookPromptProfile：

题材类型：${input.genre}
目标读者：${input.targetAudience}
核心创意：${input.mainIdea}
调性：${input.tonePreference || input.tone || '请根据题材与创意自动推断'}
${input.protagonistFocus ? `叙事聚焦：${input.protagonistFocus}（${{ female_lead: '女主视角优先，细腻情感为主轴', male_lead: '男主视角优先，爽感进阶为主轴', dual_lead: '双主角平衡推进，互动张力为核心', ensemble: '群像叙事，多视角交织' }[input.protagonistFocus]})` : ''}
${input.audienceTags?.length ? `受众标签：${input.audienceTags.join('、')}（写作手册的风格/节奏/爽感定义应匹配此受众群体）` : ''}
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
    return bookPromptProfileSchema.parse(this.coerceProfile(raw, bestRef));
  }

  /** 根据题材 + 已生成的 Profile 定制所有可编辑 agent section + 7 个 playbook。locked section 保持默认。 */
  async generateAgentSections(genre: string, profile: BookPromptProfile, baseRuleAtoms?: import('../schemas/rule-engine.schemas').RuleAtom[]): Promise<{
    sections: Array<{ agentId: string; key: string; content: string }>;
    ruleAtoms?: import('../schemas/rule-engine.schemas').RuleAtom[];
  }> {
    const sectionEntrySchema = z.object({ agentId: z.string(), key: z.string(), content: z.string() });
    const playbookEntrySchema = z.object({ name: z.string(), content: z.string() });
    const outputSchema = z.object({
      sections: z.array(sectionEntrySchema),
      playbooks: z.array(playbookEntrySchema),
    });

    const EDITABLE_SECTIONS = [
      { agentId: 'intent', key: 'role', label: '角色定义', hint: '策划师人设，需匹配题材特色' },
      { agentId: 'intent', key: 'core_questions', label: '核心问题', hint: '设定章节方向时的3个灵魂问题，不同题材核心驱动力不同' },
      { agentId: 'intent', key: 'principles', label: '原则', hint: '章节策划原则，需反映题材特有的节奏和冲突模式' },
      { agentId: 'intent', key: 'suspense_rules', label: '悬念规则', hint: '悬念管理策略，不同题材悬念类型不同' },
      { agentId: 'intent', key: 'data_intuition', label: '数据直觉', hint: '如何利用KPI数据指导策划' },
      { agentId: 'scene-planner', key: 'role', label: '角色定义', hint: '场景导演人设' },
      { agentId: 'scene-planner', key: 'principles', label: '核心原则', hint: '场景拆分原则，需匹配题材节奏' },
      { agentId: 'scene-planner', key: 'purpose_guide', label: '目的选择指南', hint: '场景类型指南，不同题材侧重的场景类型不同' },
      { agentId: 'scene-planner', key: 'transition_hint', label: '过渡提示', hint: '场景过渡技法' },
      { agentId: 'scene-planner', key: 'scene_count_guide', label: '场景数量指南', hint: '按章节类型给出场景数量和字数配比建议' },
      { agentId: 'scene-planner', key: 'sensory_bridge', label: '感官桥接', hint: '感官连续性规则' },
      { agentId: 'creative-writer', key: 'writing_soul', label: '写作灵魂', hint: '创作哲学，需匹配题材的核心追求' },
      { agentId: 'creative-writer', key: 'writing_instinct', label: '写作直觉', hint: '写作时的直觉检查清单，不同题材侧重点不同' },
      { agentId: 'scene-stitcher', key: 'role', label: '角色定义', hint: '缝合大师人设' },
      { agentId: 'scene-stitcher', key: 'core_mission', label: '核心使命', hint: '缝合章节时的核心任务清单' },
      { agentId: 'scene-stitcher', key: 'discipline', label: '纪律', hint: '缝合纪律' },
      { agentId: 'reviewer', key: 'role', label: '角色定义', hint: '审阅者人设，需匹配题材读者期待' },
      { agentId: 'reviewer', key: 'experience_anchors', label: '体验级评分锚点', hint: '翻页欲/可记忆性/沉浸度的定义，不同题材"好"的体验不同' },
      { agentId: 'reviewer', key: 'anti_inflation', label: '反虚高铁律', hint: '评分锚定标准' },
      { agentId: 'reviewer', key: 'critical_triggers', label: 'Critical级触发条件', hint: '标记为critical的具体情况列表，不同题材critical门槛不同' },
      { agentId: 'editor', key: 'role', label: '角色定义', hint: '编辑人设' },
      { agentId: 'editor', key: 'surgery', label: '外科手术', hint: '编辑修复策略' },
      { agentId: 'editor', key: 'active_improve', label: '主动提升', hint: '主动提升重点，不同题材提升方向不同' },
      { agentId: 'editor', key: 'rhythm_surgery', label: '节奏手术', hint: '段落长度/句式节奏调整策略' },
      { agentId: 'editor', key: 'dialogue_cleanup', label: '对话清洗', hint: '废话标签/复述/潜台词检查策略' },
      { agentId: 'editor', key: 'golden_zone', label: '黄金区域强化', hint: '开头100字和结尾200字的改写策略' },
      { agentId: 'hook-crafter', key: 'role', label: '角色定义', hint: '钩子工匠人设' },
      { agentId: 'hook-crafter', key: 'basic_techniques', label: '基础钩子技法', hint: '5种基础钩子，需匹配题材特有的钩子类型' },
      { agentId: 'hook-crafter', key: 'advanced_techniques', label: '高阶钩子技法', hint: '5种高阶钩子，需匹配题材' },
      { agentId: 'arc-director', key: 'role', label: '角色定义', hint: '卷级导演人设' },
      { agentId: 'arc-director', key: 'discipline', label: '纪律', hint: '执行纪律' },
      { agentId: 'arc-planner', key: 'structure', label: '四幕结构', hint: '卷级四幕结构描述，需适配题材特点' },
      { agentId: 'arc-planner', key: 'pacing', label: '节奏规则', hint: '爽感循环和呼吸节奏，需匹配题材节奏' },
      { agentId: 'arc-planner', key: 'emotion_theme', label: '情感主题', hint: '情感主题规划，需匹配题材的情感核心' },
      { agentId: 'arc-planner', key: 'satisfaction', label: '爽感类型', hint: '题材特有的爽感类型定义' },
      { agentId: 'volume-director', key: 'volume_structure', label: '卷结构精髓', hint: '大卷结构参考，需匹配题材特色' },
      { agentId: 'volume-director', key: 'innovation', label: '新鲜感引擎', hint: '叙事创新技法推荐，需匹配题材' },
      { agentId: 'volume-director', key: 'mini_arc_rules', label: 'MiniArc规则', hint: 'MiniArc槽位规则' },
      { agentId: 'volume-foreshadowing', key: 'design_principles', label: '伏笔设计原则', hint: '伏笔设计风格，需匹配题材' },
      { agentId: 'volume-foreshadowing', key: 'embedding', label: '嵌入指导', hint: '伏笔嵌入方式，需匹配题材语境' },
      { agentId: 'style-anchoring', key: 'analysis_dimensions', label: '分析维度', hint: '文风分析维度，不同题材侧重不同' },
    ];

    const sectionList = EDITABLE_SECTIONS.map((s) => `- ${s.agentId}:${s.key}（${s.label}）— ${s.hint}`).join('\n');

    const PLAYBOOK_SPECS = [
      { name: 'PROSE_CRAFT_PLAYBOOK', label: '文笔技法', wordRange: '800-1500', hint: '展示而非讲述、对白技法、句式节奏、感官叠加、环境映射情绪、留白术、旁观者烘托、金句意识、杀死AI味 —— 所有正反例和示范场景必须匹配题材语境' },
      { name: 'WRITING_SOUL_PLAYBOOK', label: '写作灵魂', wordRange: '200-500', hint: '简体中文、代入感、情绪先行、角色行为从性格流出、不完美原则 —— 根据题材调整优先级和表述' },
      { name: 'CHARACTER_ARC_PLAYBOOK', label: '角色弧线', wordRange: '200-500', hint: '矛盾内核、成长规则、关系化学反应 —— 根据题材调整角色深度重点' },
      { name: 'EDITOR_DISCIPLINE_PLAYBOOK', label: '编辑纪律', wordRange: '200-500', hint: '修复策略+主动提升职责 —— 根据题材调整提升方向' },
      { name: 'REVIEWER_RUBRIC_PLAYBOOK', label: '评审标尺', wordRange: '100-300', hint: '0-10分各档描述 —— 用题材特有的体验锚定每一档（如言情9分=CP化学反应强烈，悬疑9分=线索链完美闭合）' },
      { name: 'CONTINUITY_BASELINE_PLAYBOOK', label: '连续性底线', wordRange: '50-200', hint: '角色一致性、死亡/退场规则、空间位移合理性 —— 根据题材补充特有规则' },
      { name: 'THREAD_AWARENESS_PLAYBOOK', label: '伏线意识', wordRange: '50-200', hint: '伏线管理策略 —— 不同题材伏线类型不同（悬疑重线索链，言情重情感暗线）' },
    ];
    const playbookList = PLAYBOOK_SPECS.map((p) => `- ${p.name}（${p.label}，${p.wordRange}字）— ${p.hint}`).join('\n');

    // 若有题材定制 RuleAtom 基础版，按 outputKey 分组拼成参考文本
    let basePlaybookRef = '';
    if (baseRuleAtoms?.length) {
      const grouped = new Map<string, string[]>();
      for (const atom of baseRuleAtoms) {
        const list = grouped.get(atom.outputKey) ?? [];
        list.push(atom.title ? `【${atom.title}】\n${atom.content}` : atom.content);
        grouped.set(atom.outputKey, list);
      }
      const entries = [...grouped.entries()].map(([k, parts]) => `--- ${k} ---\n${parts.join('\n\n')}`).join('\n\n');
      basePlaybookRef = `\n=== 题材 Playbook 参考基础（在此基础上优化，保留精华，修正不足） ===\n${entries}\n`;
    }

    const result = await this.llm.generateStructured({
      taskName: 'agent-section-generator',
      schema: outputSchema,
      tags: ['setup', 'agent-sections', 'playbooks'],
      systemPrompt: `你是一位资深网文系统架构师。你需要为一本「${genre}」题材的网文，定制所有 AI Agent 的工作指令和写作规则手册。

这本书的写作手册摘要：
- 写手人设：${profile.writerGuide?.coreIdentity?.slice(0, 200) ?? '未生成'}
- 题材规则：${profile.writerGuide?.genreRules?.slice(0, 3)?.join('；') ?? '未生成'}
- 节奏：${profile.writerGuide?.pacingGuide?.slice(0, 150) ?? '未生成'}
- 对话：${profile.writerGuide?.dialogueGuide?.slice(0, 150) ?? '未生成'}
- 核心爽感：${profile.satisfactionTypes.slice(0, 3).map((s) => s.label).join('、')}
- 核心钩子：${profile.hookTypes.slice(0, 3).map((h) => h.label).join('、')}
${basePlaybookRef}
=== 第一部分：Agent Section（${EDITABLE_SECTIONS.length} 个） ===
${sectionList}

=== 第二部分：Playbook 写作规则（${PLAYBOOK_SPECS.length} 个） ===
${playbookList}

=== 定制原则 ===
1. 所有内容必须为「${genre}」题材量身定制——不是通用模板套上题材名。
2. 用具体可执行的指令。比如不要写"注意节奏"，要写"对话占比维持 40-55%，情感交锋段落每句不超过15字"。
3. Agent section 每个控制在 50-300 字。
4. 每个 Playbook 严格遵守括号中标注的字数范围——不要凑数也不要超标。
5. PROSE_CRAFT_PLAYBOOK 最重要——9 个技法全部保留，"展示而非讲述"的正反例必须用题材场景，"旁观者烘托"要换成题材最自然的衬托方式，"杀死AI味"黑名单要加题材特有套话。
6. 若已提供"题材 Playbook 参考基础"，在其基础上优化而非从零重写——保留好的正反例和题材术语。

=== 三层分工（严格遵守，禁止重复） ===
BookPromptProfile（已生成，你能看到摘要）定义的是「写什么」：题材规则、受众画像、爽感类型、钩子类型、章节模板。
Agent Section 定义的是「怎么工作」：该角色的判断标准、执行流程、检查清单。不要重述题材规则，而是写方法论。
  ❌ "言情要注重CP化学反应"（这是 Profile 的活）
  ✅ "每个场景检查：两人肢体语言是否有渐进变化？对话是否有潜台词层？分离前是否埋下重逢期待？"
Playbook 定义的是「质量标准」：通用写作技法在该题材下的正反例。不要重述题材规则或执行流程，而是写「好的长什么样、坏的长什么样」。
  ❌ "要有CP化学反应"（重述 Profile）
  ❌ "检查肢体语言变化"（重述 Agent Section）
  ✅ "展示而非讲述——❌'她爱上了他' ✅'她发现自己不自觉地在人群中寻找那个背影'"`,
      userPrompt: `题材：${genre}
目标读者：${profile.generatedForAudience}

请同时生成：
1. sections 数组（${EDITABLE_SECTIONS.length} 项，每项 agentId + key + content）
2. playbooks 数组（${PLAYBOOK_SPECS.length} 项，每项 name + content）`,
      temperature: 0.5,
    });

    const playbookMap: Record<string, string> = {};
    for (const p of result.playbooks) { if (p.name && p.content?.trim()) playbookMap[p.name] = p.content; }
    // 将 AI 生成的 playbook 文本转为 RuleAtom[]
    const { parsePlaybookTextToAtoms } = await import('../prompting/default-rule-atoms');
    const { CATEGORY_TO_OUTPUT_KEY } = await import('../schemas/rule-engine.schemas');
    const OUTPUT_KEY_TO_CAT = Object.fromEntries(Object.entries(CATEGORY_TO_OUTPUT_KEY).map(([c, k]) => [k, c]));
    const AGENT_MAP: Record<string, string[]> = {
      PROSE_CRAFT_PLAYBOOK: ['creative-writer', 'scene-stitcher', 'reviewer', 'editor'],
      WRITING_SOUL_PLAYBOOK: ['creative-writer'], CHARACTER_ARC_PLAYBOOK: ['creative-writer', 'reviewer'],
      EDITOR_DISCIPLINE_PLAYBOOK: ['editor'], REVIEWER_RUBRIC_PLAYBOOK: ['reviewer'],
      CONTINUITY_BASELINE_PLAYBOOK: ['reviewer', 'editor'],
      THREAD_AWARENESS_PLAYBOOK: ['creative-writer', 'intent', 'scene-planner'],
    };
    const ruleAtoms: import('../schemas/rule-engine.schemas').RuleAtom[] = [];
    for (const [key, text] of Object.entries(playbookMap)) {
      const cat = OUTPUT_KEY_TO_CAT[key] as any;
      if (!cat || !text?.trim()) continue;
      ruleAtoms.push(...parsePlaybookTextToAtoms(text, cat, key, AGENT_MAP[key] ?? ['creative-writer'], 'genre'));
    }
    return { sections: result.sections as Array<{ agentId: string; key: string; content: string }>, ruleAtoms };
  }

  private coerceProfile(raw: any, ref: BookPromptProfile): any { // Gemini结构化输出可能将object[]退化为string[]，需强制转型
    const typed = (a: any[], fb: any[]) => !Array.isArray(a) || !a.length ? fb : typeof a[0] === 'string' ? a.map((s: string, i: number) => ({ id: `t${i}`, label: s.slice(0, 50), description: s })) : a;
    const cliche = (a: any[], fb: any[]) => !Array.isArray(a) || !a.length ? fb : typeof a[0] === 'string' ? a.map((s: string) => ({ pattern: s, maxPerChapter: 1 })) : a;
    const rrc = raw.reviewerCalibration ?? {};
    const rc = { ...ref.reviewerCalibration, ...rrc, dimensionWeights: { ...ref.reviewerCalibration.dimensionWeights, ...(rrc.dimensionWeights ?? {}) }, scoringAnchors: { ...ref.reviewerCalibration.scoringAnchors, ...(rrc.scoringAnchors ?? {}) } };
    return { ...ref, ...raw, writerGuide: raw.writerGuide ?? ref.writerGuide, satisfactionTypes: typed(raw.satisfactionTypes, ref.satisfactionTypes), hookTypes: typed(raw.hookTypes, ref.hookTypes), clichePatterns: cliche(raw.clichePatterns, ref.clichePatterns), reviewerCalibration: rc, worldProfile: raw.worldProfile ?? ref.worldProfile };
  }
}
