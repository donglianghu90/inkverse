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
