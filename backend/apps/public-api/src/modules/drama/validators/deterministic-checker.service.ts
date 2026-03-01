/**
 * 确定性规则校验器 — 纯逻辑校验，不调用 LLM。
 * 检查分镜板的硬性规则（时长/Shot数/角色出场/字段完整性等）。
 */
import { Injectable } from '@nestjs/common';
import {
  DramaDeterministicCheck, EpisodeStoryboard, DramaState, EpisodeScript,
} from '../schemas/drama-state.schemas';

interface FailedCheck { rule: string; detail: string; }

@Injectable()
export class DramaDeterministicCheckerService {

  check(state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard): DramaDeterministicCheck {
    const fails: FailedCheck[] = [];
    const { shots, totalEstimatedDurationSec } = storyboard;
    const target = state.seed.targetEpisodeDurationSec;

    // 时长偏差不超过 ±20%
    const deviation = Math.abs(totalEstimatedDurationSec - target) / target;
    if (deviation > 0.2) fails.push({
      rule: 'duration_deviation', detail: `总时长 ${totalEstimatedDurationSec}s 偏离目标 ${target}s 超过20% (${(deviation * 100).toFixed(1)}%)`,
    });

    // Shot总时长 vs totalEstimatedDurationSec 一致性
    const shotSum = shots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
    if (Math.abs(shotSum - totalEstimatedDurationSec) > 10) fails.push({
      rule: 'shot_duration_sum_mismatch', detail: `Shot时长总和 ${shotSum.toFixed(1)}s ≠ totalEstimatedDurationSec ${totalEstimatedDurationSec}s`,
    });

    // Shot数量范围
    if (shots.length < 5) fails.push({ rule: 'too_few_shots', detail: `仅 ${shots.length} 个Shot，最少5个` });
    if (shots.length > 60) fails.push({ rule: 'too_many_shots', detail: `${shots.length} 个Shot，超过60个上限` });

    // 单Shot时长范围
    shots.forEach(s => {
      if (s.estimatedDurationSec < 0.5) fails.push({ rule: 'shot_too_short', detail: `shot${s.shotIndex} 仅 ${s.estimatedDurationSec}s` });
      if (s.estimatedDurationSec > 30) fails.push({ rule: 'shot_too_long', detail: `shot${s.shotIndex} 达 ${s.estimatedDurationSec}s` });
    });

    // 每个Shot的 visualPrompt 不能为空
    shots.forEach(s => {
      if (!s.visualPrompt?.trim()) fails.push({ rule: 'empty_visual_prompt', detail: `shot${s.shotIndex} 缺少 visualPrompt` });
    });

    // 角色出场数限制
    const maxChars = state.strategy?.characterBudget?.maxPresentPerEpisode ?? 6;
    const allChars = new Set(shots.flatMap(s => s.characters.map(c => c.characterId)));
    if (allChars.size > maxChars) fails.push({
      rule: 'too_many_characters', detail: `出场 ${allChars.size} 个角色，预算上限 ${maxChars}`,
    });

    // 有对话的Shot必须有subtitle
    shots.forEach(s => {
      if (s.dialogue && !s.dialogue.isInnerThought && !s.subtitle?.text) {
        fails.push({ rule: 'missing_subtitle', detail: `shot${s.shotIndex} 有对话但缺少字幕` });
      }
    });

    // 剧本场景数 vs 分镜场景数一致性
    const scriptSceneIds = new Set(script.scenes.map(s => s.sceneId));
    const storyboardSceneIds = new Set(shots.map(s => s.sceneId));
    scriptSceneIds.forEach(id => {
      if (!storyboardSceneIds.has(id)) fails.push({ rule: 'scene_missing_in_storyboard', detail: `剧本场景 ${id} 在分镜中找不到对应Shot` });
    });

    // shotIndex 连续性
    shots.forEach((s, i) => {
      if (s.shotIndex !== i) fails.push({ rule: 'shot_index_gap', detail: `shot[${i}].shotIndex=${s.shotIndex}，期望=${i}` });
    });

    return { pass: fails.length === 0, failedChecks: fails };
  }
}
