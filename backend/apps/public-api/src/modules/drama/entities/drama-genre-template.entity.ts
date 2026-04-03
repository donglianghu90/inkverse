/** 短剧题材模板 — 系统预置 + 用户自定义，为种子分析与编剧手册提供题材基线 */
import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * 题材生产引导数据——存储在 profileJson.productionGuidance 中。
 * 替代 drama-playbook.ts 各 prompt builder 中的 isHistorical/isBiopic/isMystery 硬编码分支。
 * prompt builder 直接注入这些字段，无需再靠关键词猜测题材类型。
 */
export interface GenreProductionGuidance {
  /** 题材分类标志，决定哪些特殊分支被激活 */
  flags: {
    isHistorical: boolean;   // 历史/古装类（古装、宫斗、穿越、历史剧、传记剧）
    isBiopic: boolean;       // 传记剧（需遵守史实约束）
    isMystery: boolean;      // 悬疑/推理类
    isFantasy: boolean;      // 神话/仙侠/奇幻/玄幻类
  };
  /** 男主颜值/外形公式，直接替换 buildVisualAssetDesignerSystemPrompt 中的题材颜值列表 */
  maleLeadFormula: string;
  /** 女主颜值/外形公式 */
  femaleLeadFormula: string;
  /** 核心循环描述（每 X 集一个循环，爽点类型），注入 buildSeedAnalyzerSystemPrompt */
  coreLoopBlock: string;
  /** 冲突设计原则，注入 buildSeedAnalyzerSystemPrompt */
  conflictBlock: string;
  /** 台词/旁白/动作侧重规则，注入 buildSeedAnalyzerSystemPrompt（替代 isBiopic 三元）*/
  narrativeModeTip: string;
  /** 核心矛盾举例，注入 buildSeedAnalyzerSystemPrompt（替代 isBiopic 举例三元）*/
  coreConflictExample: string;
  /** 付费卡点设计说明，注入 buildSeedAnalyzerSystemPrompt（替代 isBiopic 付费三元）*/
  paywallTip: string;
  /** 反派设计原则，注入 buildSeedAnalyzerSystemPrompt（替代 isBiopic 反派三元）*/
  antagonistTip: string;
  /** 历史/传记/神话题材特殊规则块，注入 buildSeedAnalyzerSystemPrompt（非此类题材为空）*/
  historicalConstraint?: string;
  /** 分集标题举例，注入 buildSeriesDirectorSystemPrompt（替代 isBiopic 标题三元）*/
  episodeTitleExample?: string;
  /** 全剧段落骨架参考，注入 buildSeriesDirectorSystemPrompt（%totalEp% 为占位符） */
  arcStructureHint: string;
  /** 付费卡点策略，注入 buildSeriesDirectorSystemPrompt 和 buildStrategySystemPrompt */
  paywallStrategyHint: string;
  /** 叙事契约示例句，注入 buildStrategySystemPrompt */
  contractHint: string;
  /** 悬念钩子类型参考，注入 buildStrategySystemPrompt */
  hookTypesHint: string;
  /** 调性护栏，注入 buildStrategySystemPrompt */
  toneHint: string;
  /** 免费集策略示例，注入 buildStrategySystemPrompt freeEpisodeStrategy 字段（替代 isBiopic 三元） */
  freeEpisodeHint?: string;
  /** 题材特有的额外规则（如历史剧禁止编造史实），注入相关 prompt */
  specialRules?: string;
}

export interface DramaSeedHints {
  catharsisPresets?: string[]; // 推荐爽点类型（打脸/逆袭/真相揭露/甜蜜反转）
  conflictPatterns?: string[]; // 核心冲突模式（身份反差/阶级对立/家族秘密）
  paywallStrategyHints?: string; // 付费卡点策略提示
  platformDefaults?: { platformTarget?: string; aspectRatio?: string; durationSec?: number };
  visualStyleHints?: string; // 视觉风格提示（滤镜/色调/氛围）
  dialogueStyleHints?: string; // 台词风格提示
}

/**
 * 题材 Profiler 专属示例数据 — 存储于 profileJson.profilerExamples。
 * 替代 drama-playbook 中的 GENRE_PROFILER_EXAMPLES 硬编码。
 */
export interface GenreProfilerExamples {
  genreName: string;
  segmentPrinciples: string;
  emotionBeatTable: string;
  rhythmTemplate: string;
}

/** 段落导演专属指南 — 注入 buildArcDirectorSystemPrompt */
export interface GenreArcDirectorGuide {
  /** 题材专属段落规划原则，替代"通用都市/霸总"默认说明 */
  genreSegmentPrinciples?: string | null;
  /** 题材专属角色弧线设计，替代"通用都市/霸总"默认说明 */
  characterArcPrinciples?: string | null;
  /** 题材专属冲突密度节奏，替代"通用都市/霸总"默认模板 */
  conflictRhythm?: string | null;
}

/** 集导演专属指南 — 注入 buildEpisodeDirectorSystemPrompt */
export interface GenreEpisodeDirectorGuide {
  /** 题材专属情绪节拍示例（表格格式），替代"通用现代都市"示例 */
  emotionBeatExample?: string | null;
  /** 题材专属张力曲线补充说明 */
  tensionCurveNotes?: string | null;
  /** 题材专属集末钩子模式 */
  hookPatterns?: string | null;
}

/** 节奏分析师专属指南 — 注入 buildPacingAnalyzerSystemPrompt */
export interface GenrePacingAnalyzerGuide {
  /** 题材专属理想节奏模板，评估时以此为参照 */
  genreRhythmTemplate?: string | null;
  /** 题材专属节奏快/慢判断指标，补充通用标准 */
  paceIndicators?: string | null;
}

/**
 * 题材 genreArchetype 预置值 — 存储于 profileJson.genreArchetypePreset。
 * 所有字段均为题材确定值，Profiler LLM 无需推断，直接采用。
 * adaptationNotes 为注入所有下游 Agent system prompt 的题材生产规则基线文本。
 */
export interface GenreArchetypePreset {
  narrativeArc: 'conflict_resolution' | 'life_journey' | 'mystery_reveal' | 'quest' | 'rise_and_fall';
  narrationRatio: number;
  factConstraint: 'none' | 'inspired_by' | 'period_accurate';
  hookMechanism: 'plot_cliffhanger' | 'revelation' | 'emotional_peak' | 'mystery' | 'curiosity';
  conflictType: 'interpersonal' | 'fate_vs_will' | 'good_vs_evil' | 'internal' | 'society';
  characterEvolution: 'costume_only' | 'age_progression' | 'power_level' | 'relationship' | 'status';
  visualTone: 'glamorous' | 'gritty' | 'ethereal' | 'period' | 'dark' | 'whimsical' | 'epic';
  /** 题材生产规则基线，注入所有下游 Agent system prompt，替代 if-else 硬编码分支 */
  adaptationNotes: string;
}

/**
 * 各 Agent 专属灵魂生成指引 — 存储于 profileJson.agentSoulPrompts。
 * 告知 Profiler 如何为本题材的每个下游 Agent 生成高质量的专属灵魂视图（soulViews）。
 * 这些指引是「编剧哲学」层面的精华，直接决定生成短剧的题材纯度。
 *
 * 注意：这些字段是「生成指引」（给 Profiler 看的），而非「prompt 模板」（给 Agent 看的）。
 * 实际写入 basePromptSnapshot 的内容由 DramaPromptBakerService 烘焙，用户编辑的是已烘焙的完整 prompt。
 */
export interface GenreAgentSoulPrompts {
  /**
   * 编剧核心身份定位（用于 soulViews.scriptwriter.coreIdentity）。
   * 告诉 Profiler：本题材的编剧 coreIdentity 应该强调什么独特视角。
   * 示例（霸总）："精通权力美学与情感积压"
   * 示例（战神）："精通能力觉醒节奏与爽点爆发"
   */
  scriptwriterCoreIdentityHint?: string;

  /**
   * 编剧铁律生成指引（影响 soulViews.scriptwriter.genreRules 的生成方向）。
   * 列出本题材编剧铁律必须覆盖的核心维度（Profiler 参考这些维度生成 genreRules）。
   */
  scriptwriterGenreRulesHint?: string[];

  /**
   * 台词风格指引（影响 soulViews.scriptwriter.dialogueGuide）。
   * 本题材台词的核心语言特征（Profiler 生成 dialogueGuide 时参考）。
   */
  dialogueStyleHint?: string;

  /**
   * 段落导演适配指引（影响 soulViews.arcDirector 的生成内容）。
   * 告知 Profiler 本题材的段落感来自哪里、冲突密度节奏如何。
   */
  arcDirectorAdaptationHint?: string;

  /**
   * 集导演适配指引（影响 soulViews.episodeDirector 的生成内容）。
   * 本题材单集情绪曲线的典型模式（Profiler 生成时参考）。
   */
  episodeDirectorAdaptationHint?: string;

  /**
   * 悬念工匠指引（影响 soulViews.hookCrafter 的生成内容）。
   * 本题材最有效的悬念类型和设计思路（Profiler 生成时参考）。
   */
  hookCrafterHint?: string;
}

/**
 * 题材完整配置 — profileJson 的完整结构。
 * 每个题材 = 一个 JSON 初始化数据，统一存储在用户表/短剧表中。
 */
export interface GenreFullProfile {
  productionGuidance?: GenreProductionGuidance;
  profilerGuide?: string;
  profilerExamples?: GenreProfilerExamples;
  /** genreArchetype 题材确定值预置，Profiler agent merge 时直接采用，无需 LLM 推断 */
  genreArchetypePreset?: GenreArchetypePreset;
  /**
   * buildProfilerSystemPrompt Section 0 的完整文本，直接注入提示词。
   * 已知题材：包含预置的枚举值 + adaptationNotes 基线，告知 LLM 直接输出这些值。
   * 自定义题材（_custom）：包含枚举可选值描述，让 LLM 自行推断。
   * 代码不做任何条件判断，直接读取此字段。
   */
  profilerArchetypeSection?: string;
  cameraStyleGuide?: Record<string, unknown>;
  audioStyleGuide?: Record<string, unknown>;
  reviewerCalibration?: Record<string, unknown>;
  arcDirectorGuide?: GenreArcDirectorGuide;
  episodeDirectorGuide?: GenreEpisodeDirectorGuide;
  pacingAnalyzerGuide?: GenrePacingAnalyzerGuide;
  /**
   * 各 Agent 专属灵魂生成指引。
   * 注入 Profiler 的 system prompt，引导其为本题材生成高质量的 soulViews（per-agent 灵魂视图）。
   * Baker 烘焙时使用这些 soul views 填充各 Agent 的 basePromptSnapshot。
   */
  agentSoulPrompts?: GenreAgentSoulPrompts;
  /**
   * 每个 pipeline agent 的完整 system prompt 模板（含 {{variable}} 占位符）。
   * Baker 在建剧完成后通过变量替换生成 basePromptSnapshot，用户可在创作工坊直接编辑烘焙后的完整 prompt。
   *
   * key = pipeline nodeId（如 'arc-director' / 'scriptwriter' / 'storyboard-director'）。
   * value = 完整 prompt 模板字符串，支持以下占位符（由 Baker 的 resolveTemplate 负责替换）：
   *   - 编剧手册变量（来自 DramaPromptProfile）
   *   - 策略变量（来自 DramaStrategy）
   *   - 视觉风格变量（来自 VisualStyleGuide）
   *
   * 未指定的 agent 回退到 _custom 题材的默认模板（BASE_AGENT_SYSTEM_PROMPTS）。
   */
  agentSystemPrompts?: Record<string, string>;
  /** 题材专属场景类型指令（climax/confrontation/revelation/romantic/action/cliffhanger/transition） */
  purposeDirectiveTemplates?: Record<string, string>;

}

@Entity('drama_genre_templates')
@Unique('uq_drama_genre_tpl_user_genre', ['userId', 'genreKey'])
export class DramaGenreTemplateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Index('idx_drama_genre_tpl_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 64, nullable: true })
  userId: string | null; // null = 系统种子模板

  @Column({ name: 'genre_key', type: 'varchar', length: 100 })
  genreKey: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description: string;

  @Column({ name: 'genre_keywords', type: 'jsonb', default: '[]' })
  genreKeywords: string[];

  @Column({ name: 'profile_json', type: 'jsonb', default: '{}' })
  profileJson: Record<string, unknown>; // DramaPromptProfile 的种子数据

  @Column({ name: 'seed_hints', type: 'jsonb', nullable: true })
  seedHints: DramaSeedHints | null;

  @Column({ name: 'audience_tags', type: 'jsonb', default: '[]' })
  audienceTags: string[];

  @Column({ name: 'protagonist_focus_tags', type: 'jsonb', default: '[]' })
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;

  @Column({ name: 'tone_tags', type: 'jsonb', default: '[]' })
  toneTags: string[];

  @Column({ name: 'platform_tags', type: 'jsonb', default: '[]' })
  platformTags: string[]; // douyin/kuaishou/reelshort/dramabox

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ name: 'parent_template_id', type: 'uuid', nullable: true })
  parentTemplateId: string | null;

  @Column({ name: 'system_version', type: 'int', default: 1 })
  systemVersion: number;

  @Column({ name: 'synced_system_version', type: 'int', default: 0 })
  syncedSystemVersion: number;

  @Column({ name: 'is_user_modified', type: 'boolean', default: false })
  isUserModified: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
