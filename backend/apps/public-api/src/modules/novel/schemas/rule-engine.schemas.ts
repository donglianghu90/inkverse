/** 结构化规则引擎 — RuleAtom 数据模型与 Zod schema */
import { z } from 'zod';

export const RULE_CATEGORIES = ['prose_craft', 'writing_soul', 'character_arc', 'editor_discipline', 'reviewer_rubric', 'continuity_baseline', 'thread_awareness'] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  prose_craft: '文笔技法', writing_soul: '写作灵魂', character_arc: '角色弧线',
  editor_discipline: '编辑纪律', reviewer_rubric: '评审标尺',
  continuity_baseline: '连续性底线', thread_awareness: '伏线意识',
};

export const CATEGORY_TO_OUTPUT_KEY: Record<RuleCategory, string> = {
  prose_craft: 'PROSE_CRAFT_PLAYBOOK', writing_soul: 'WRITING_SOUL_PLAYBOOK',
  character_arc: 'CHARACTER_ARC_PLAYBOOK', editor_discipline: 'EDITOR_DISCIPLINE_PLAYBOOK',
  reviewer_rubric: 'REVIEWER_RUBRIC_PLAYBOOK', continuity_baseline: 'CONTINUITY_BASELINE_PLAYBOOK',
  thread_awareness: 'THREAD_AWARENESS_PLAYBOOK',
};

export const CONDITION_FIELDS = ['chapterType', 'arcStage', 'scenePurpose', 'chapterNumber', 'isFirstThreeChapters'] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const CONDITION_OPS = ['eq', 'in', 'gt', 'lt', 'gte', 'lte'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const ALL_AGENT_IDS = [
  'creative-writer', 'scene-stitcher', 'reviewer', 'editor',
  'intent', 'scene-planner', 'arc-director', 'hook-crafter',
] as const;
export type AgentId = (typeof ALL_AGENT_IDS)[number];

// ── Zod schemas ──
export const ruleConditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(CONDITION_OPS),
  value: z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]),
});

export const RULE_SOURCES = ['system', 'genre', 'user', 'auto_calibration', 'lesson_promoted'] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

export const ruleAtomSchema = z.object({
  id: z.string().min(1),
  category: z.enum(RULE_CATEGORIES),
  title: z.string().min(1),
  content: z.string().min(1),
  priority: z.number().int().min(0).max(100).default(50),
  targetAgents: z.array(z.string()).min(1),
  outputKey: z.string().min(1),
  conditions: z.array(ruleConditionSchema).optional(),
  tags: z.array(z.string()).optional(),
  isEnabled: z.boolean().default(true),
  source: z.enum(RULE_SOURCES).default('system'),
  expiresAfterChapters: z.number().int().min(1).optional(), // auto_calibration 规则过期章数
  createdAtChapter: z.number().int().min(1).optional(), // 创建时的章节号
  hitCount: z.number().int().nonnegative().optional(), // 命中次数（用于衰减/升格判断）
  lastHitChapter: z.number().int().min(1).optional(), // 最近一次命中的章节号
});

export const compileContextSchema = z.object({
  agentId: z.string(),
  chapterNumber: z.number().int().min(1),
  chapterType: z.string().optional(),
  arcStage: z.string().optional(),
  scenePurpose: z.string().optional(),
  isFirstThreeChapters: z.boolean(),
});

// ── TypeScript 接口（从 schema 推导） ──
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAtom = z.infer<typeof ruleAtomSchema>;
export type CompileContext = z.infer<typeof compileContextSchema>;
