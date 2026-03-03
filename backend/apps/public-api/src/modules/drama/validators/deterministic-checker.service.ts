/** 确定性规则校验器 — 纯逻辑校验，不调用LLM。含短剧内容质量硬规则。 */
import { Injectable } from '@nestjs/common';
import { DramaDeterministicCheck, EpisodeStoryboard, DramaState, EpisodeScript } from '../schemas/drama-state.schemas';

export type CheckSeverity = 'hard' | 'soft';
interface FailedCheck { rule: string; detail: string; severity: CheckSeverity }

const HARD_RULES = new Set([
  'unknown_character', 'empty_visual_prompt', 'too_few_shots', 'shot_index_gap',
  'no_opening_hook', 'no_ending_cliffhanger', 'too_few_scenes',
]);
const VP_MAX_WORDS = 80; // visualPrompt词数上限（含face描述后放宽）
const DIALOGUE_MAX_CHARS = 20; // 单句台词中文字符上限（短剧铁律）
const DIALOGUE_HARD_MAX = 30; // 超过此值为硬错误

@Injectable()
export class DramaDeterministicCheckerService {

  check(state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard): DramaDeterministicCheck & { hardFails: FailedCheck[] } {
    const fails: FailedCheck[] = [];
    const { shots, totalEstimatedDurationSec } = storyboard;
    const target = state.seed.targetEpisodeDurationSec;
    const sev = (rule: string): CheckSeverity => HARD_RULES.has(rule) ? 'hard' : 'soft';

    // === 分镜结构检查 ===
    const deviation = Math.abs(totalEstimatedDurationSec - target) / target;
    if (deviation > 0.2) fails.push({ rule: 'duration_deviation', severity: sev('duration_deviation'),
      detail: `总时长 ${totalEstimatedDurationSec}s 偏离目标 ${target}s 超过20% (${(deviation * 100).toFixed(1)}%)` });

    const shotSum = shots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
    if (Math.abs(shotSum - totalEstimatedDurationSec) > 10) fails.push({ rule: 'shot_duration_sum_mismatch', severity: sev('shot_duration_sum_mismatch'),
      detail: `Shot时长总和 ${shotSum.toFixed(1)}s ≠ total ${totalEstimatedDurationSec}s` });

    if (shots.length < 5) fails.push({ rule: 'too_few_shots', severity: 'hard', detail: `仅 ${shots.length} 个Shot，最少5个` });
    if (shots.length > 60) fails.push({ rule: 'too_many_shots', severity: sev('too_many_shots'), detail: `${shots.length} 个Shot，超过60个上限` });

    shots.forEach(s => {
      if (s.estimatedDurationSec < 0.5) fails.push({ rule: 'shot_too_short', severity: sev('shot_too_short'), detail: `shot${s.shotIndex} 仅 ${s.estimatedDurationSec}s` });
      if (s.estimatedDurationSec > 30) fails.push({ rule: 'shot_too_long', severity: sev('shot_too_long'), detail: `shot${s.shotIndex} 达 ${s.estimatedDurationSec}s` });
    });

    shots.forEach(s => {
      if (!s.visualPrompt?.trim()) fails.push({ rule: 'empty_visual_prompt', severity: 'hard', detail: `shot${s.shotIndex} 缺少 visualPrompt` });
      else {
        const wordCount = s.visualPrompt.trim().split(/\s+/).length;
        if (wordCount > VP_MAX_WORDS) fails.push({ rule: 'visual_prompt_too_long', severity: sev('visual_prompt_too_long'),
          detail: `shot${s.shotIndex} visualPrompt ${wordCount}词 > ${VP_MAX_WORDS}词上限` });
      }
    });

    shots.forEach(s => {
      if (s.isFlashback || s.isPreview) return;
      if (!s.firstFramePrompt?.trim()) fails.push({ rule: 'missing_first_frame_prompt', severity: sev('missing_first_frame_prompt'),
        detail: `shot${s.shotIndex} 缺少 firstFramePrompt` });
      if (!s.lastFramePrompt?.trim()) fails.push({ rule: 'missing_last_frame_prompt', severity: sev('missing_last_frame_prompt'),
        detail: `shot${s.shotIndex} 缺少 lastFramePrompt` });
    });

    // === 角色合法性检查 ===
    const maxChars = state.strategy?.characterBudget?.maxPresentPerEpisode ?? 6;
    const allChars = new Set(shots.flatMap(s => s.characters.map(c => c.characterId)));
    if (allChars.size > maxChars) fails.push({ rule: 'too_many_characters', severity: sev('too_many_characters'),
      detail: `出场 ${allChars.size} 个角色，预算上限 ${maxChars}` });

    const knownCharIds = new Set(state.characters?.map(c => c.characterId) ?? []);
    allChars.forEach(cid => {
      if (!knownCharIds.has(cid)) fails.push({ rule: 'unknown_character', severity: 'hard', detail: `Shot引用了未定义角色 ${cid}` });
    });

    shots.forEach(s => {
      if (!s.characterVariationIds) return;
      Object.entries(s.characterVariationIds).forEach(([cid, vid]) => {
        const ch = state.characters?.find(c => c.characterId === cid);
        if (!ch) return;
        if (!ch.variations?.some(v => v.variationId === vid))
          fails.push({ rule: 'unknown_variation', severity: sev('unknown_variation'), detail: `shot${s.shotIndex} 引用了未定义变体 ${cid}/${vid}` });
      });
    });

    shots.forEach(s => {
      if (s.dialogue && !s.dialogue.isInnerThought && !s.subtitle?.text)
        fails.push({ rule: 'missing_subtitle', severity: sev('missing_subtitle'), detail: `shot${s.shotIndex} 有对话但缺少字幕` });
    });

    const scriptSceneIds = new Set(script.scenes.map(s => s.sceneId));
    const storyboardSceneIds = new Set(shots.map(s => s.sceneId));
    scriptSceneIds.forEach(id => {
      if (!storyboardSceneIds.has(id)) fails.push({ rule: 'scene_missing_in_storyboard', severity: sev('scene_missing_in_storyboard'),
        detail: `剧本场景 ${id} 在分镜中找不到对应Shot` });
    });

    shots.forEach((s, i) => {
      if (s.shotIndex !== i) fails.push({ rule: 'shot_index_gap', severity: 'hard', detail: `shot[${i}].shotIndex=${s.shotIndex}，期望=${i}` });
    });

    // === 短剧内容质量规则（核心新增） ===
    this.checkDialogueLength(script, fails);
    this.checkSceneStructure(script, fails);
    this.checkEmotionalProgression(script, fails);

    const hardFails = fails.filter(f => f.severity === 'hard');
    return { pass: fails.length === 0, failedChecks: fails, hardFails };
  }

  /** 台词长度检查：短剧台词必须短而有力 */
  private checkDialogueLength(script: EpisodeScript, fails: FailedCheck[]): void {
    let longCount = 0;
    script.scenes.forEach(scene => {
      (scene.dialogues ?? []).forEach(d => {
        if (!d.text) return;
        const zhLen = d.text.replace(/[^\u4e00-\u9fff]/g, '').length;
        if (zhLen > DIALOGUE_HARD_MAX) {
          fails.push({ rule: 'dialogue_too_long', severity: 'hard', detail: `场景${scene.sceneId} 角色${d.characterId} 台词${zhLen}字 > ${DIALOGUE_HARD_MAX}字: "${d.text.slice(0, 20)}..."` });
        } else if (zhLen > DIALOGUE_MAX_CHARS) {
          longCount++;
        }
      });
    });
    const totalDialogues = script.scenes.reduce((sum, s) => sum + (s.dialogues?.length ?? 0), 0);
    if (totalDialogues > 0 && longCount / totalDialogues > 0.3) {
      fails.push({ rule: 'too_many_long_dialogues', severity: 'soft',
        detail: `${((longCount / totalDialogues) * 100).toFixed(0)}%台词超过${DIALOGUE_MAX_CHARS}字，短剧应以短句为主` });
    }
  }

  /** 场景结构检查：首场必须有hook、末场必须有悬念、最少2场 */
  private checkSceneStructure(script: EpisodeScript, fails: FailedCheck[]): void {
    const scenes = script.scenes;
    if (scenes.length < 2) {
      fails.push({ rule: 'too_few_scenes', severity: 'hard', detail: `仅${scenes.length}场戏，短剧至少需要2场` });
      return;
    }
    const firstScene = scenes[0];
    if (firstScene.purpose !== 'hook_opening') {
      fails.push({ rule: 'no_opening_hook', severity: 'soft', detail: `第一场purpose="${firstScene.purpose}"，应为"hook_opening"` });
    }
    const lastScene = scenes[scenes.length - 1];
    if (lastScene.purpose !== 'cliffhanger' && lastScene.purpose !== 'climax') {
      fails.push({ rule: 'no_ending_cliffhanger', severity: 'soft', detail: `末场purpose="${lastScene.purpose}"，应为"cliffhanger"或"climax"` });
    }
  }

  /** 情绪进展检查：避免全集情绪扁平（用emotionalEntry/emotionalExit对比） */
  private checkEmotionalProgression(script: EpisodeScript, fails: FailedCheck[]): void {
    const entries = script.scenes.map(s => s.emotionalEntry).filter(Boolean);
    const exits = script.scenes.map(s => s.emotionalExit).filter(Boolean);
    if (entries.length < 2) return;
    const uniqueEntries = new Set(entries);
    const uniqueExits = new Set(exits);
    if (uniqueEntries.size === 1 && uniqueExits.size === 1 && entries[0] === exits[0]) {
      fails.push({ rule: 'flat_emotional_arc', severity: 'soft', detail: `全集${entries.length}场情绪均为"${entries[0]}"→"${exits[0]}"，缺乏起伏` });
    }
  }
}
