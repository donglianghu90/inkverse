/** 逐集编排器 — 纯函数，13步 Pipeline 的核心逻辑与 IO 解耦 */
import { OrchestratorInput, StepMeta, runWithRetry } from './types';

export interface EpisodeOrchestratorInput extends OrchestratorInput {
  synopsis: Record<string, unknown>; // 该集大纲
  workflowParams: { maxContinuityRetries: number; maxEditRounds: number; enableDialogueCoach: boolean; enablePacingAnalyzer: boolean; enableHookCrafter: boolean };
}

export interface EpisodeResult {
  arcSegment: Record<string, unknown>; intent: Record<string, unknown>; continuity: Record<string, unknown>;
  script: Record<string, unknown>; storyboard: Record<string, unknown>; review: Record<string, unknown>;
  pacing?: Record<string, unknown>; hookResult?: Record<string, unknown>; loreRecord?: Record<string, unknown>;
}

const EP_STEPS: Array<{ key: string; title: string }> = [ // 13步定义
  { key: 'arc_plan', title: '段落规划' }, { key: 'episode_direct', title: '集导演' },
  { key: 'continuity_check', title: '连续性检查' }, { key: 'script_write', title: '编剧创作' },
  { key: 'dialogue_polish', title: '台词润色' }, { key: 'storyboard_direct', title: '分镜生成' },
  { key: 'audio_design', title: '音频设计' }, { key: 'deterministic_check', title: '硬规则校验' },
  { key: 'review', title: '质量审核' }, { key: 'edit', title: '精修' },
  { key: 'pacing_analyze', title: '节奏分析' }, { key: 'hook_craft', title: '悬念设计' },
  { key: 'record', title: '知识记录' },
];

export async function runEpisodeOrchestrator(input: EpisodeOrchestratorInput): Promise<EpisodeResult> {
  const { state, episodeNumber, synopsis, workflowParams: wp, runStep, onProgress, onLog } = input;
  const total = EP_STEPS.length;
  const meta = (i: number): StepMeta => ({ stepKey: EP_STEPS[i].key, stepTitle: EP_STEPS[i].title, stepIndex: i, stepTotal: total });
  const ctx = JSON.stringify({ episodeCursor: state.episodeCursor, lastCliffhanger: state.lastCliffhanger, storySoFar: state.storySoFar?.slice(0, 2000) });

  // Step 0: 段落规划
  onProgress?.(meta(0), '段落规划...');
  const arcResult = await runWithRetry(() => runStep(meta(0), `段落规划 E${episodeNumber}:\n全局状态:${ctx}\n大纲:${JSON.stringify(synopsis)}`, 'arc_plan', 4096));
  onProgress?.(meta(0), '段落规划完成', true);

  // Step 1: 集导演
  onProgress?.(meta(1), '集导演规划...');
  const intentResult = await runWithRetry(() => runStep(meta(1), `集导演 E${episodeNumber}:\n段落:${arcResult.text}\n大纲:${JSON.stringify(synopsis)}`, 'episode_direct', 4096));
  onProgress?.(meta(1), '集导演完成', true);

  // Step 2: 连续性检查（含阻断重试）
  onProgress?.(meta(2), '连续性检查...');
  let continuityResult = await runWithRetry(() => runStep(meta(2), `连续性检查:\nintent:${intentResult.text}\n状态:${ctx}`, 'continuity_check', 2048));
  const contObj = safeJson(continuityResult.text);
  const blocks = ((contObj.warnings ?? []) as any[]).filter((w: any) => w.severity === 'block');
  if (blocks.length > 0) {
    for (let retry = 0; retry < wp.maxContinuityRetries; retry++) {
      onProgress?.(meta(2), `连续性阻断，重试(${retry + 1})...`);
      continuityResult = await runWithRetry(() => runStep(meta(2), `修正连续性阻断:\nblocks:${JSON.stringify(blocks)}\n${intentResult.text}`, 'continuity_check', 2048));
      if (!((safeJson(continuityResult.text).warnings ?? []) as any[]).some((w: any) => w.severity === 'block')) break;
    }
  }
  onProgress?.(meta(2), '连续性检查完成', true);

  // Step 3: 编剧创作
  onProgress?.(meta(3), '编剧创作...');
  const scriptResult = await runWithRetry(() => runStep(meta(3), `编剧创作 E${episodeNumber}:\n${intentResult.text}\n连续性:${continuityResult.text}`, 'script_write', 8192));
  let script = safeJson(scriptResult.text);
  onProgress?.(meta(3), '编剧创作完成', true);

  // Step 4: 台词润色（可选）
  if (wp.enableDialogueCoach) {
    onProgress?.(meta(4), '台词润色...');
    try {
      const polished = await runWithRetry(() => runStep(meta(4), `台词润色:\n${JSON.stringify(script)}`, 'dialogue_polish', 8192));
      script = safeJson(polished.text);
    } catch (e) { onLog?.(`台词润色降级: ${(e as Error).message}`); }
    onProgress?.(meta(4), '台词润色完成', true);
  } else { onProgress?.(meta(4), '台词润色(跳过)', true); }

  // Step 5-6: 分镜 + 音频（可并行优化）
  onProgress?.(meta(5), '分镜生成...');
  const sbResult = await runWithRetry(() => runStep(meta(5), `分镜生成:\n${JSON.stringify(script)}`, 'storyboard_direct', 8192));
  let storyboard = safeJson(sbResult.text);
  onProgress?.(meta(5), '分镜生成完成', true);

  onProgress?.(meta(6), '音频设计...');
  const audioResult = await runWithRetry(() => runStep(meta(6), `音频设计:\n${JSON.stringify(storyboard)}`, 'audio_design', 4096));
  storyboard = { ...storyboard, ...safeJson(audioResult.text) };
  onProgress?.(meta(6), '音频设计完成', true);

  // Step 7: 硬规则校验（本地计算，不需要 LLM）
  onProgress?.(meta(7), '硬规则校验...');
  onProgress?.(meta(7), '硬规则校验完成', true); // 由调用方执行 DeterministicChecker

  // Step 8-9: 审核 + 精修循环
  onProgress?.(meta(8), '质量审核...');
  const reviewResult = await runWithRetry(() => runStep(meta(8), `质量审核:\n剧本:${JSON.stringify(script)}\n分镜:${JSON.stringify(storyboard)}`, 'review', 4096));
  let review = safeJson(reviewResult.text);
  onProgress?.(meta(8), '质量审核完成', true);

  for (let round = 0; round < wp.maxEditRounds && review.overallVerdict === 'needs_edit'; round++) {
    onProgress?.(meta(9), `精修第${round + 1}轮...`);
    const editResult = await runWithRetry(() => runStep(meta(9), `精修:\n审核:${JSON.stringify(review)}\n分镜:${JSON.stringify(storyboard)}`, 'edit', 8192));
    storyboard = safeJson(editResult.text);
    const reReview = await runWithRetry(() => runStep(meta(8), `复审:\n${JSON.stringify(script)}\n${JSON.stringify(storyboard)}`, 'review', 4096));
    review = safeJson(reReview.text);
  }
  onProgress?.(meta(9), '精修完成', true);

  // Step 10-12: 节奏分析 / 悬念 / 记录（可选）
  let pacing: Record<string, unknown> | undefined, hookResult: Record<string, unknown> | undefined;
  if (wp.enablePacingAnalyzer) {
    onProgress?.(meta(10), '节奏分析...');
    try { const pr = await runWithRetry(() => runStep(meta(10), `节奏分析:\n${JSON.stringify(storyboard)}`, 'pacing_analyze', 2048)); pacing = safeJson(pr.text); }
    catch (e) { onLog?.(`节奏分析降级: ${(e as Error).message}`); }
    onProgress?.(meta(10), '节奏分析完成', true);
  } else { onProgress?.(meta(10), '节奏分析(跳过)', true); }

  if (wp.enableHookCrafter) {
    onProgress?.(meta(11), '悬念设计...');
    try { const hr = await runWithRetry(() => runStep(meta(11), `悬念设计:\n${JSON.stringify(storyboard)}`, 'hook_craft', 2048)); hookResult = safeJson(hr.text); }
    catch (e) { onLog?.(`悬念设计降级: ${(e as Error).message}`); }
    onProgress?.(meta(11), '悬念设计完成', true);
  } else { onProgress?.(meta(11), '悬念设计(跳过)', true); }

  onProgress?.(meta(12), '知识记录...');
  const loreResult = await runWithRetry(() => runStep(meta(12), `知识记录:\n剧本:${JSON.stringify(script)}\n分镜:${JSON.stringify(storyboard)}`, 'record', 4096));
  onProgress?.(meta(12), '知识记录完成', true);

  return {
    arcSegment: safeJson(arcResult.text), intent: safeJson(intentResult.text),
    continuity: safeJson(continuityResult.text), script, storyboard, review,
    pacing, hookResult, loreRecord: safeJson(loreResult.text),
  };
}

function safeJson(text: string): Record<string, unknown> {
  const c = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(c); } catch { const m = c.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : { raw: c }; }
}
