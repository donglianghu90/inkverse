/** 短剧视觉风格模板 — 系统预置 + 用户自定义，为视觉资产设计师提供风格基线 */
import { Entity, Column, PrimaryGeneratedColumn, Index, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/** 视觉风格指南（与 VisualStyleGuide schema 保持一致） */
export interface VisualStyleGuide {
  overallAesthetic: string;    // 整体美学风格（如"电影质感""韩剧滤镜""高饱和度"）
  colorGrading: string;        // 调色风格
  lightingStyle: string;       // 光影风格
  era: string;                 // 时代背景（contemporary/ancient/future）
  renderTechnique?: string;    // 渲染技术（如"3D NPR赛璐璐""写实CG""定格动画"）
  textureStyle?: string;       // 材质质感（如"胶片颗粒""水彩晕染""像素块"）
  referenceStyle?: string;     // 参考风格/作品（如"吉卜力""新海诚""港片黄金时代"）
  styleReferencePrompt?: string; // 纯英文 T2I 提示词（用于风格参考图与场景图）
  /**
   * 角色定妆参考图专用 T2I 风格前缀（英文）。
   * 仅含时代背景 + 渲染技术 + 材质，**不含** colorGrading / lightingStyle 等场景条件词。
   * 缺省时系统回退至 styleReferencePrompt。
   */
  characterStylePrompt?: string;
  /** 该风格的 faceReferencePrompt 写法规范，直接注入视觉资产设计师 system prompt。 */
  facePromptRule?: string;
  /**
   * 本风格的场景 visualPrompt 写法引导（示例 + 约束），注入视觉资产设计师 system prompt。
   * 纯文本，无变量占位符。内容涵盖场景 visualPrompt 英文示例 + textureStyle 关键词要求/禁用词。
   */
  scenePromptGuidance?: string;
  /**
   * 本风格驱动的编剧台词风格引导，注入 buildScriptwriterSystemPrompt。
   * 替代 drama-playbook.ts 中按 overallAesthetic 关键词 if-else 匹配的 styleDialogueTone 逻辑。
   * 纯文本，涵盖：台词外放/克制程度、情绪表达方式、禁止的台词模式、拟声词/金句使用规范。
   */
  scriptDialogueGuide?: string;
  /**
   * 本风格驱动的集导演镜头风格提示，注入 buildEpisodeDirectorSystemPrompt masterShotPlan 段。
   * 替代 drama-playbook.ts 中按 overallAesthetic 关键词 if-else 匹配的 shotStyleHint 逻辑。
   * 纯文本，涵盖：偏好景别/角度组合、情绪高潮时的镜头策略、特有场景的摄影惯例。
   */
  shotStyleGuide?: string;
}

/** 提示词创作引导 */
export interface VisualPromptGuidance {
  positiveKeywords?: string[]; // 推荐正向关键词（T2I prompt）
  negativeKeywords?: string[]; // 避免关键词
  characterStyle?: string;     // 角色/人物风格描述
  backgroundStyle?: string;    // 背景/场景风格描述
}

@Entity('drama_visual_style_templates')
@Unique('uq_drama_vis_tpl_user_style', ['userId', 'styleKey'])
export class DramaVisualStyleTemplateEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id: string;

  @Index('idx_drama_vis_tpl_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 64, nullable: true })
  userId: string | null; // null = 系统种子模板

  @Column({ name: 'style_key', type: 'varchar', length: 100 })
  styleKey: string; // 唯一 key，如 live_action / 2d_anime / 3d_fantasy

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName: string;

  @Column({ name: 'description', type: 'text', default: '' })
  description: string;

  /** 大类分组：真人 / 2D动画 / 3D动画 / 定格动画 / 中国传统 */
  @Column({ name: 'style_category', type: 'varchar', length: 50, default: 'live_action' })
  styleCategory: 'live_action' | '2d_animation' | '3d_animation' | 'stop_motion' | 'chinese_traditional' | '2d_art';

  /** 风格标签（显示用，如"写实""奇幻""高饱和"） */
  @Column({ name: 'tags', type: 'jsonb', default: '[]' })
  tags: string[];

  /** 核心视觉风格规格（直接对应 VisualStyleGuide） */
  @Column({ name: 'visual_guide', type: 'jsonb', default: '{}' })
  visualGuide: VisualStyleGuide;

  @Column({ name: 'cover_url', type: 'varchar', length: 500, nullable: true })
  coverUrl: string | null;

  /** T2I 创作引导 */
  @Column({ name: 'prompt_guidance', type: 'jsonb', nullable: true })
  promptGuidance: VisualPromptGuidance | null;

  /** 适配的题材类型（如 ['古装', '武侠', '奇幻']） */
  @Column({ name: 'genre_compatibility', type: 'jsonb', default: '[]' })
  genreCompatibility: string[];

  /** 适合受众（如 ['女性向', '18-35岁']） */
  @Column({ name: 'audience_tags', type: 'jsonb', default: '[]' })
  audienceTags: string[];

  /** 推荐平台 */
  @Column({ name: 'platform_tags', type: 'jsonb', default: '[]' })
  platformTags: string[];

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
