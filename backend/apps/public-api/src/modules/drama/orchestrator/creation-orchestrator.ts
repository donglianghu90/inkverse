/** 创建流程编排器 — 纯函数，不依赖 NestJS DI，Agent 退化为薄包装 */
import { OrchestratorInput, StepMeta, runWithRetry } from './types';

export interface CreationOrchestratorInput extends OrchestratorInput {
  mainIdea: string; genre: string; targetAudience?: string; titleHint?: string;
  protagonistFocus?: string; tonePreference?: string; audienceTags?: string[];
  mainStoryGoal?: string; targetEpisodeDurationSec?: number;
  plannedEpisodes?: { min: number; max: number };
  seedHints?: Record<string, unknown>;
}

export interface CreationResult {
  seed: Record<string, unknown>; outline: Record<string, unknown>;
  characters: Record<string, unknown>[]; locations: Record<string, unknown>[];
  visualStyle: Record<string, unknown>; promptProfile: Record<string, unknown>; strategy: Record<string, unknown>;
}

const STEPS: Array<{ key: string; title: string }> = [ // 创建流程6步
  { key: 'seed_analyze', title: '种子分析' }, { key: 'outline_plan', title: '大纲规划' },
  { key: 'visual_design', title: '视觉设计' }, { key: 'asset_generate', title: '资产生成' },
  { key: 'profile_generate', title: '编剧手册' }, { key: 'strategy_generate', title: '策略生成' },
];

export async function runCreationOrchestrator(input: CreationOrchestratorInput): Promise<CreationResult> {
  const { runStep, onProgress, onLog } = input;
  const total = STEPS.length;
  const meta = (i: number): StepMeta => ({ stepKey: STEPS[i].key, stepTitle: STEPS[i].title, stepIndex: i, stepTotal: total });

  onProgress?.(meta(0), '种子分析...');
  const seedResult = await runWithRetry(() => runStep(meta(0),
    `分析创意种子:\n创意: ${input.mainIdea}\n题材: ${input.genre}\n目标观众: ${input.targetAudience ?? '通用'}`, 'seed_analyze', 4096));
  onLog?.('种子分析完成');
  onProgress?.(meta(0), '种子分析完成', true);

  onProgress?.(meta(1), '大纲规划...');
  const outlineResult = await runWithRetry(() => runStep(meta(1),
    `基于种子规划全剧大纲:\n${seedResult.text}`, 'outline_plan', 8192));
  onProgress?.(meta(1), '大纲规划完成', true);

  onProgress?.(meta(2), '视觉设计...');
  const visualResult = await runWithRetry(() => runStep(meta(2),
    `设计角色/场景/视觉风格:\n种子:${seedResult.text}\n大纲:${outlineResult.text}`, 'visual_design', 6144));
  onProgress?.(meta(2), '视觉设计完成', true);

  onProgress?.(meta(3), '资产生成...');
  onProgress?.(meta(3), '资产生成完成', true); // 实际图片生成由 Worker 异步处理

  const [profileResult, strategyResult] = await Promise.all([ // Step 4+5 并行
    runWithRetry(() => runStep(meta(4), `生成编剧手册:\n${seedResult.text}`, 'profile_generate', 4096)),
    runWithRetry(() => runStep(meta(5), `生成策略:\n${seedResult.text}\n${outlineResult.text}`, 'strategy_generate', 4096)),
  ]);
  onProgress?.(meta(4), '编剧手册完成', true);
  onProgress?.(meta(5), '策略生成完成', true);

  const visual = safeParseJson(visualResult.text);
  return { // 返回纯数据，由调用方持久化
    seed: safeParseJson(seedResult.text), outline: safeParseJson(outlineResult.text),
    characters: Array.isArray(visual.characters) ? visual.characters as Record<string, unknown>[] : [],
    locations: Array.isArray(visual.locations) ? visual.locations as Record<string, unknown>[] : [],
    visualStyle: (visual.visualStyle as Record<string, unknown>) ?? visual,
    promptProfile: safeParseJson(profileResult.text), strategy: safeParseJson(strategyResult.text),
  };
}

function safeParseJson(text: string): Record<string, unknown> { // JSON 容错解析
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { const m = cleaned.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : { raw: cleaned }; }
}
