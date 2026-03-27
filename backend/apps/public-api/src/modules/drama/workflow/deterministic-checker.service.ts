/** 确定性规则校验器 — 纯逻辑校验，不调用LLM。含短剧内容质量硬规则。 */
import { Injectable } from '@nestjs/common';
import { DramaDeterministicCheck, EpisodeStoryboard, DramaState, EpisodeScript } from '../schemas/drama-state.schemas';

export type CheckSeverity = 'hard' | 'soft';
export interface FailedCheck { rule: string; detail: string; severity: CheckSeverity }

const HARD_RULES = new Set([
  'unknown_character', 'empty_visual_prompt',
  'missing_first_frame_prompt', 'shot_too_long',
]);
const VP_MAX_WORDS = 80; // visualPrompt词数上限（含face描述后放宽）
/**
 * 台词长度三层标准（Prompt 建议 → Checker 软告警 → ScriptEditor 修复）：
 *  ≤ 15 字：理想目标（Scriptwriter/DialogueCoach Prompt 中的创作建议）
 *  ≤ 20 字：可接受（超过此比例 >30% 触发 too_many_long_dialogues 软告警）
 *  ≤ 25 字：允许上限（超过则记入 dialogueFixes，由 ScriptEditor 定向修复）
 *  > 25 字：不合格，TTS 时长将超过单 Shot 目标时长（2-6s），需强制修复
 *
 * 25 字阈值依据：正常语速 ~3 字/秒，25 字 ≈ 8s TTS；MediaOrchestrator 支持最高 1.5× 视频减速，
 * 超过 25 字后 TTS/视频时长比率会超过 1.5，触发 duration 扩展，导致整集时长严重偏移。
 */
const DIALOGUE_MAX_CHARS = 20; // 超过 20 字计入"偏长台词"统计
const DIALOGUE_SOFT_MAX = 25;  // 超过 25 字触发软告警 + 加入 ScriptEditor 修复列表

/**
 * 根据目标时长动态计算最低 Shot 数（软规则参考值）。
 * Shot 数量应由模型根据题材和场景节奏自主决定；此公式仅作为软警告参考，不硬阻断。
 * 注意：Sora 2 每镜固定 10/15s，180s 自然只有 12–18 镜，远低于此公式的值。
 */
function minShotsForDuration(targetSec: number): number {
  return Math.min(60, Math.max(6, Math.round(targetSec / 6)));
}

/** 单镜时长硬上限（对应当前在用 provider 的物理上限：Kling/Sora 2 均为 15s） */
const SHOT_MAX_DURATION_SEC = 15;

export type DeterministicCheckResult = DramaDeterministicCheck & {
  hardFails: FailedCheck[];
  /** 自动修复的规则清单（不阻断，仅记录） */
  autoFixedRules: string[];
  /** dialogue_too_long 的详情，供 ScriptEditor 定向修复 */
  dialogueFixes: Array<{ sceneId: string; characterId: string; text: string; zhLen: number }>;
};

@Injectable()
export class DramaDeterministicCheckerService {

  check(state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard): DeterministicCheckResult {
    const fails: FailedCheck[] = [];
    const autoFixedRules: string[] = [];
    const dialogueFixes: DeterministicCheckResult['dialogueFixes'] = [];
    const shots = storyboard?.shots ?? [];
    const totalEstimatedDurationSec = storyboard?.totalEstimatedDurationSec ?? 0;
    const target = state.seed.targetEpisodeDurationSec;
    const sev = (rule: string): CheckSeverity => HARD_RULES.has(rule) ? 'hard' : 'soft';

    // === 自动修复：shotIndex 连续性（直接重排，不计入 fails） ===
    let indexFixed = false;
    shots.forEach((s, i) => {
      if (s.shotIndex !== i) { s.shotIndex = i; indexFixed = true; }
    });
    if (indexFixed) autoFixedRules.push('shot_index_gap');

    // === 分镜结构检查 ===
    const deviation = Math.abs(totalEstimatedDurationSec - target) / target;
    if (deviation > 0.2) fails.push({ rule: 'duration_deviation', severity: sev('duration_deviation'),
      detail: `总时长 ${totalEstimatedDurationSec}s 偏离目标 ${target}s 超过20% (${(deviation * 100).toFixed(1)}%)` });

    const shotSum = shots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
    if (Math.abs(shotSum - totalEstimatedDurationSec) > 10) fails.push({ rule: 'shot_duration_sum_mismatch', severity: sev('shot_duration_sum_mismatch'),
      detail: `Shot时长总和 ${shotSum.toFixed(1)}s ≠ total ${totalEstimatedDurationSec}s` });

    // too_few_shots 降为软规则：镜数由模型根据题材/节奏决定；Sora 2 每镜 10/15s，180s 自然仅 12–18 镜
    const minShots = minShotsForDuration(target);
    if (shots.length < minShots) fails.push({ rule: 'too_few_shots', severity: 'soft', detail: `仅 ${shots.length} 个Shot，目标时长${target}s 参考最低 ${minShots} 个（Sora 2 等长镜头 provider 可忽略）` });
    if (shots.length > 60) fails.push({ rule: 'too_many_shots', severity: sev('too_many_shots'), detail: `${shots.length} 个Shot，超过60个上限` });

    shots.forEach(s => {
      if (s.estimatedDurationSec < 0.5) fails.push({ rule: 'shot_too_short', severity: sev('shot_too_short'), detail: `shot${s.shotIndex} 仅 ${s.estimatedDurationSec}s` });
      // shot_too_long 升为 hard rule：>15s 超出 Kling/Sora 2 的物理上限，无法生成，触发分镜重生成
      if (s.estimatedDurationSec > SHOT_MAX_DURATION_SEC) fails.push({ rule: 'shot_too_long', severity: 'hard', detail: `shot${s.shotIndex} 达 ${s.estimatedDurationSec}s，超出 provider 物理上限 ${SHOT_MAX_DURATION_SEC}s` });
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

    // shot_index_gap 已在方法开头自动修复，此处不再重复校验

    // === 短剧内容质量规则 ===
    this.checkDialogueLength(script, fails, dialogueFixes);
    this.checkSceneStructure(script, fails, !!state.isSeriesFinale);
    this.checkEmotionalProgression(script, fails);
    this.checkDialogueConsistency(script, storyboard, fails);

    const hardFails = fails.filter(f => f.severity === 'hard');
    return { pass: fails.length === 0, failedChecks: fails, hardFails, autoFixedRules, dialogueFixes };
  }

  /** 台词长度检查：超过软阈值记录告警，由 ScriptEditor 定向修复 */
  private checkDialogueLength(
    script: EpisodeScript,
    fails: FailedCheck[],
    dialogueFixes: DeterministicCheckResult['dialogueFixes'],
  ): void {
    let longCount = 0;
    script.scenes.forEach(scene => {
      (scene.dialogues ?? []).forEach(d => {
        if (!d.text) return;
        const zhLen = d.text.replace(/[^\u4e00-\u9fff]/g, '').length;
        if (zhLen > DIALOGUE_SOFT_MAX) {
          // 降为软规则：记录详情供 ScriptEditor 定向修复，不再硬阻断
          fails.push({ rule: 'dialogue_too_long', severity: 'soft',
            detail: `场景${scene.sceneId} 角色${d.characterId} 台词${zhLen}字 > ${DIALOGUE_SOFT_MAX}字: "${d.text.slice(0, 20)}..."` });
          dialogueFixes.push({ sceneId: scene.sceneId, characterId: d.characterId ?? '', text: d.text, zhLen });
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

  private checkSceneStructure(script: EpisodeScript, fails: FailedCheck[], isSeriesFinale = false): void {
    const scenes = script.scenes;
    if (scenes.length < 1) {
      // 降为软规则：仅在完全没有场景时报软告警（schema 本身 min(1)，正常不会触发）
      fails.push({ rule: 'too_few_scenes', severity: 'soft', detail: `无有效场景，短剧至少需要1场` });
      return;
    }
    if (scenes.length < 2) {
      fails.push({ rule: 'too_few_scenes', severity: 'soft', detail: `仅${scenes.length}场戏，建议至少2场以形成起伏结构` });
    }
    const firstScene = scenes[0];
    if (firstScene.purpose !== 'hook_opening') {
      fails.push({ rule: 'no_opening_hook', severity: 'soft', detail: `第一场purpose="${firstScene.purpose}"，应为"hook_opening"` });
    }
    const lastScene = scenes[scenes.length - 1];
    const validEndings = isSeriesFinale
      ? ['climax', 'emotional', 'closure', 'revelation']
      : ['cliffhanger', 'climax'];
    if (!validEndings.includes(lastScene.purpose)) {
      fails.push({ rule: 'no_ending_cliffhanger', severity: 'soft',
        detail: isSeriesFinale
          ? `大结局末场purpose="${lastScene.purpose}"，应为 ${validEndings.join('/')} 之一`
          : `末场purpose="${lastScene.purpose}"，应为"cliffhanger"或"climax"` });
    }
  }

  /**
   * 轻量 Shot 级校验 — 用于 HookCrafter previewShots 等不需要完整 script/storyboard 的场景。
   * 只检查 visualPrompt 非空、角色合法性、shotIndex 合理性。
   */
  checkShots(shots: import('../schemas/drama-state.schemas').Shot[], state: DramaState): FailedCheck[] {
    const fails: FailedCheck[] = [];
    const knownCharIds = new Set(state.characters?.map(c => c.characterId) ?? []);

    shots.forEach((s, i) => {
      if (!s.visualPrompt?.trim()) {
        fails.push({ rule: 'empty_visual_prompt', severity: 'hard', detail: `previewShot[${i}] 缺少 visualPrompt` });
      }
      s.characters.forEach(c => {
        if (!knownCharIds.has(c.characterId)) {
          fails.push({ rule: 'unknown_character', severity: 'hard', detail: `previewShot[${i}] 引用未定义角色 ${c.characterId}` });
        }
      });
      if (s.dialogue?.text) {
        const zhLen = s.dialogue.text.replace(/[^\u4e00-\u9fff]/g, '').length;
        if (zhLen > DIALOGUE_SOFT_MAX) {
          fails.push({ rule: 'dialogue_too_long', severity: 'soft', detail: `previewShot[${i}] 台词${zhLen}字 > ${DIALOGUE_SOFT_MAX}字` });
        }
      }
    });
    return fails;
  }

  /** 情绪进展检查：避免全集情绪扁平、高潮低于铺垫、结尾情绪与 purpose 不匹配 */
  private checkEmotionalProgression(script: EpisodeScript, fails: FailedCheck[]): void {
    const entries = script.scenes.map(s => s.emotionalEntry).filter(Boolean);
    const exits = script.scenes.map(s => s.emotionalExit).filter(Boolean);
    if (entries.length < 2) return;
    const uniqueEntries = new Set(entries);
    const uniqueExits = new Set(exits);
    if (uniqueEntries.size === 1 && uniqueExits.size === 1 && entries[0] === exits[0]) {
      fails.push({ rule: 'flat_emotional_arc', severity: 'soft', detail: `全集${entries.length}场情绪均为"${entries[0]}"→"${exits[0]}"，缺乏起伏` });
    }

    // 检查高潮场景情绪是否高于铺垫场景
    const HIGH_INTENSITY_PURPOSES = new Set(['climax', 'confrontation', 'revelation', 'cliffhanger']);
    const LOW_INTENSITY_PURPOSES = new Set(['transition', 'exposition', 'hook_opening']);
    const LOW_INTENSITY_EXITS = new Set(['平静', '日常', '舒适', '轻松', '放松', '平淡', 'calm', 'relaxed', 'neutral']);
    for (const scene of script.scenes) {
      if (HIGH_INTENSITY_PURPOSES.has(scene.purpose) && LOW_INTENSITY_EXITS.has(scene.emotionalExit)) {
        fails.push({ rule: 'climax_below_setup', severity: 'soft',
          detail: `场景${scene.sceneId} purpose="${scene.purpose}"但情绪出口为"${scene.emotionalExit}"，高潮场景应有高强度情绪` });
      }
    }

    // 检查结尾场景情绪与 purpose 匹配
    const lastScene = script.scenes[script.scenes.length - 1];
    const TENSE_ENDINGS = new Set(['cliffhanger', 'climax']);
    const CALM_EXITS = new Set(['平静', '日常', '舒适', '轻松', '放松', '平淡', '满足', 'calm', 'relaxed', 'satisfied']);
    if (TENSE_ENDINGS.has(lastScene.purpose) && CALM_EXITS.has(lastScene.emotionalExit)) {
      fails.push({ rule: 'ending_emotion_mismatch', severity: 'soft',
        detail: `末场purpose="${lastScene.purpose}"但情绪出口为"${lastScene.emotionalExit}"，悬念/高潮场景结尾应保持紧张感` });
    }
  }

  /** Script↔Storyboard 台词一致性检查：确保分镜中的台词在剧本中有对应 */
  private checkDialogueConsistency(script: EpisodeScript, storyboard: EpisodeStoryboard, fails: FailedCheck[]): void {
    const scriptDialogueMap = new Map<string, Set<string>>();
    for (const scene of script.scenes) {
      const texts = new Set<string>();
      (scene.dialogues ?? []).forEach(d => { if (d.text?.trim()) texts.add(d.text.trim()); });
      scriptDialogueMap.set(scene.sceneId, texts);
    }

    let mismatchCount = 0;
    for (const shot of (storyboard?.shots ?? [])) {
      if (!shot.dialogue?.text?.trim()) continue;
      if (shot.isFlashback || shot.isPreview) continue;
      const sceneTexts = scriptDialogueMap.get(shot.sceneId);
      if (!sceneTexts) continue; // scene not found — already checked by scene_missing_in_storyboard
      const shotText = shot.dialogue.text.trim();
      // 允许轻微差异（精修可能微调标点），用包含关系匹配
      const found = [...sceneTexts].some(t => t.includes(shotText) || shotText.includes(t));
      if (!found) mismatchCount++;
    }
    if (mismatchCount > 0) {
      fails.push({ rule: 'dialogue_storyboard_mismatch', severity: 'soft',
        detail: `${mismatchCount}条分镜台词在剧本中无法匹配，可能存在 Script↔Storyboard 数据脱节` });
    }
  }
}
