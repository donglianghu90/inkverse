/**
 * 剧本精修 Agent — 根据 Review 中的 issuesFound 对分镜板+剧本进行定向修复。
 *
 * 分批修复策略（避免 Token 溢出）：
 *   1. 根据 issue 涉及的 shotId/sceneId 确定需修复的 shot 索引集合
 *   2. 将 shots 切分为 ≤MAX_SHOTS_PER_BATCH 的连续批次（包含前后 context shots）
 *   3. 每批独立调用 LLM 修复，代码层 merge 回完整 storyboard
 *   4. 如果 issues 无法关联到具体 shot（全局类问题），回退到全量模式但精简 JSON
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, episodeScriptSchema,
  EpisodeStoryboard, EpisodeScript, EpisodeReview, DramaState, Shot,
} from '../../schemas/drama-state.schemas';
import { buildScriptEditorSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

const MAX_SHOTS_PER_BATCH = 8; // 每批最多处理的 Shot 数（含 context shots）
const CONTEXT_RADIUS = 1;       // 前后各取 N 个 context shot

const batchEditorOutputSchema = z.object({
  shots: z.array(shotSchema),
  scriptPatches: z.array(z.object({
    sceneId: z.string(),
    dialogueIndex: z.number().int().nonnegative().optional(),
    newText: z.string().optional(),
    newParenthetical: z.string().optional(),
  })).default([]),
});

// 全量回退模式使用的精简 schema
const fullEditorOutputSchema = z.object({
  storyboard: episodeStoryboardSchema,
  script: episodeScriptSchema.optional().nullable(),
});

export interface ScriptEditorResult {
  storyboard: EpisodeStoryboard;
  script?: EpisodeScript;
}

type IssueItem = { category?: string; severity?: string; description?: string; suggestedFix?: string };

@Injectable()
export class ScriptEditorAgent {
  private readonly logger = new Logger(ScriptEditorAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async fix(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    priorityIssues?: IssueItem[],
    script?: EpisodeScript,
  ): Promise<EpisodeStoryboard> {
    const result = await this.fixWithScript(state, storyboard, review, priorityIssues, script);
    return result.storyboard;
  }

  async fixWithScript(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    priorityIssues?: IssueItem[],
    script?: EpisodeScript,
  ): Promise<ScriptEditorResult> {
    const issueList = priorityIssues?.length ? priorityIssues : review.issuesFound.filter(i => i.severity === 'critical' || i.severity === 'moderate');
    if (!issueList.length) return { storyboard, script };

    const shots = storyboard?.shots ?? [];
    const affectedIndices = this.resolveAffectedShotIndices(issueList, shots, review);

    // 如果无法关联到具体 shot 或 shots 总量本身就很小（≤MAX_SHOTS_PER_BATCH），使用精简全量模式
    if (affectedIndices.size === 0 || shots.length <= MAX_SHOTS_PER_BATCH) {
      this.logger.log(`E${storyboard.episodeNumber} 精修：全量模式（affectedShots=${affectedIndices.size}, totalShots=${shots.length}）`);
      return this.fixFullMode(state, storyboard, review, issueList, script);
    }

    // 分批修复模式
    this.logger.log(`E${storyboard.episodeNumber} 精修：分批模式（affectedShots=[${[...affectedIndices].join(',')}], totalShots=${shots.length}）`);
    return this.fixBatchMode(state, storyboard, review, issueList, script, affectedIndices);
  }

  /** 分批修复模式 — 只传入受影响的 shots + context shots */
  private async fixBatchMode(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    issueList: IssueItem[], script: EpisodeScript | undefined,
    affectedIndices: Set<number>,
  ): Promise<ScriptEditorResult> {
    const shots = [...storyboard.shots];
    const batches = this.planBatches(affectedIndices, shots.length);
    const sysPrompt = await this.promptService.buildPrompt(
      state.dramaId, 'script-editor',
      buildScriptEditorSystemPrompt({ dialogueGuide: state.promptProfile?.scriptwriterGuide?.dialogueGuide }),
    );

    let editedScript = script ? { ...script, scenes: [...script.scenes] } : undefined;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      if (bi > 0) await new Promise(r => setTimeout(r, 500));
      const batchShots = batch.indices.map(i => shots[i]);

      // 确定本批次要修复的 issues（与本批次 shots 相关的）
      const batchSceneIds = new Set(batchShots.map(s => s.sceneId));
      const batchShotIds = new Set(batchShots.map(s => s.shotId));
      const batchIssues = issueList.filter(issue => {
        // 检查 issue 描述中是否提到本批次的 shot/scene
        const desc = `${issue.description} ${issue.suggestedFix}`;
        for (const sid of batchShotIds) { if (desc.includes(sid)) return true; }
        for (const sid of batchSceneIds) { if (desc.includes(sid)) return true; }
        // 对于无法关联的 issue，每批都携带（全局类问题）
        return !this.issueRefersToSpecificShot(issue, storyboard.shots);
      });

      if (!batchIssues.length) continue;

      const issueText = batchIssues.map(i => `[${i.severity}/${i.category}] ${i.description} → 建议：${i.suggestedFix}`).join('\n');

      // 构建精简的 script context（只含本批次涉及场景的台词）
      const scriptCtx = editedScript
        ? this.buildScriptContext(editedScript, batchSceneIds)
        : '';

      this.logger.log(`E${storyboard.episodeNumber} 精修批次 ${bi + 1}/${batches.length} (shots: ${batch.indices.join(',')}，issues: ${batchIssues.length})`);

      try {
        const raw = await this.llm.generateStructured({
          taskName: 'drama-script-editor',
          schema: batchEditorOutputSchema,
          systemPrompt: sysPrompt,
          metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: storyboard.episodeNumber },
          userPrompt: `修复第 ${storyboard.episodeNumber} 集分镜板（批次 ${bi + 1}/${batches.length}，Shot ${batch.indices[0]}-${batch.indices[batch.indices.length - 1]}）：

=== 需要修复的问题 ===
${issueText}

=== 本批次 Shots（请返回修复后的这些 shots） ===
${JSON.stringify(batchShots, null, 0)}
${scriptCtx}

=== 修复规则 ===
1. 只返回这 ${batchShots.length} 个 shot 的修复版本（保持 shotIndex/shotId 不变）
2. 不要新增或删除 shot，只修改需要修复的字段
3. 如果修改了台词，在 scriptPatches 中返回对应的剧本修改
4. 未涉及的 shot 原样返回`,
          temperature: 0.4,
        });

        const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
        const parsedShots = Array.isArray(root.shots) ? root.shots : [];

        // Merge 修复后的 shots 回完整 storyboard
        for (const parsed of parsedShots) {
          const ps = shotSchema.safeParse(parsed);
          if (!ps.success) continue;
          const idx = batch.indices.find(i => shots[i]?.shotId === ps.data.shotId) ?? batch.indices.find(i => shots[i]?.shotIndex === ps.data.shotIndex);
          if (idx !== undefined && idx >= 0 && idx < shots.length) {
            shots[idx] = ps.data;
          }
        }

        // 应用 scriptPatches
        if (editedScript && Array.isArray(root.scriptPatches)) {
          for (const patch of root.scriptPatches as any[]) {
            if (!patch?.sceneId) continue;
            const scene = editedScript.scenes.find(s => s.sceneId === patch.sceneId);
            if (!scene) continue;
            if (typeof patch.dialogueIndex === 'number' && scene.dialogues?.[patch.dialogueIndex]) {
              if (patch.newText) scene.dialogues[patch.dialogueIndex].text = patch.newText;
              if (patch.newParenthetical) scene.dialogues[patch.dialogueIndex].parenthetical = patch.newParenthetical;
            }
          }
        }
      } catch (err) {
        this.logger.warn(`E${storyboard.episodeNumber} 精修批次 ${bi + 1} 失败，跳过: ${(err as Error).message}`);
      }
    }

    const totalDur = shots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
    const result: ScriptEditorResult = {
      storyboard: episodeStoryboardSchema.parse({
        ...storyboard, shots,
        totalEstimatedDurationSec: Math.round(totalDur * 10) / 10,
      }),
    };
    if (editedScript) result.script = episodeScriptSchema.parse(editedScript);
    return result;
  }

  /** 全量回退模式 — shots 数量较少或无法关联 issue 到具体 shot 时使用 */
  private async fixFullMode(
    state: DramaState, storyboard: EpisodeStoryboard, review: EpisodeReview,
    issueList: IssueItem[], script?: EpisodeScript,
  ): Promise<ScriptEditorResult> {
    const issues = issueList.map(i => `[${i.severity}/${i.category}] ${i.description} → 建议：${i.suggestedFix}`).join('\n');

    // 全量模式也使用精简的 storyboard JSON（剥离 firstFramePrompt/lastFramePrompt 减少 token）
    const slimShots = storyboard.shots.map(s => ({
      shotIndex: s.shotIndex, shotId: s.shotId, sceneId: s.sceneId,
      shotType: s.shotType, estimatedDurationSec: s.estimatedDurationSec,
      visualPrompt: s.visualPrompt, dialogue: s.dialogue, subtitle: s.subtitle,
      characters: s.characters, camera: s.camera, audio: s.audio,
      qualityTier: s.qualityTier, transitionToNext: s.transitionToNext,
      isMasterShot: s.isMasterShot,
    }));
    const slimStoryboard = {
      episodeNumber: storyboard.episodeNumber,
      shots: slimShots,
      totalEstimatedDurationSec: storyboard.totalEstimatedDurationSec,
      audioTimeline: storyboard.audioTimeline,
    };

    const scriptCtx = script ? `\n=== 当前剧本（如修改了分镜中的台词/场景，请同步修改剧本并在 script 字段返回） ===\n${JSON.stringify(script, null, 0)}` : '';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-script-editor',
      schema: fullEditorOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'script-editor', buildScriptEditorSystemPrompt({ dialogueGuide: state.promptProfile?.scriptwriterGuide?.dialogueGuide })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: storyboard.episodeNumber },
      userPrompt: `修复第 ${storyboard.episodeNumber} 集分镜板：

=== 需要修复的问题 ===
${issues}

=== 当前分镜板（精简版，首尾帧提示词已省略） ===
${JSON.stringify(slimStoryboard, null, 0)}
${scriptCtx}

请返回修复后的完整分镜板。如果修改涉及台词或场景结构，请同时返回同步后的 script。`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sb = typeof root.storyboard === 'object' && root.storyboard ? root.storyboard : root;
    const parsedSb = episodeStoryboardSchema.parse(sb);

    // 回填被精简掉的 firstFramePrompt/lastFramePrompt（LLM 全量模式中不传这些字段）
    const originalMap = new Map(storyboard.shots.map(s => [s.shotId, s]));
    parsedSb.shots.forEach(shot => {
      const orig = originalMap.get(shot.shotId);
      if (!orig) return;
      if (!shot.firstFramePrompt?.trim() && orig.firstFramePrompt?.trim()) shot.firstFramePrompt = orig.firstFramePrompt;
      if (!shot.lastFramePrompt?.trim() && orig.lastFramePrompt?.trim()) shot.lastFramePrompt = orig.lastFramePrompt;
      // 保留人工编辑标记
      if (orig.isHumanEdited) { shot.isHumanEdited = true; shot.humanEditedAt = orig.humanEditedAt; shot.humanEditNote = orig.humanEditNote; }
    });

    const editedScript = root.script ? episodeScriptSchema.parse(root.script) : undefined;
    return { storyboard: parsedSb, script: editedScript };
  }

  /** 从 issues 中解析涉及的 shot 索引 */
  private resolveAffectedShotIndices(issues: IssueItem[], shots: Shot[], review: EpisodeReview): Set<number> {
    const indices = new Set<number>();
    const shotIdToIndex = new Map(shots.map((s, i) => [s.shotId, i]));
    const sceneIdToIndices = new Map<string, number[]>();
    shots.forEach((s, i) => {
      const arr = sceneIdToIndices.get(s.sceneId) ?? [];
      arr.push(i);
      sceneIdToIndices.set(s.sceneId, arr);
    });

    for (const issue of issues) {
      const combined = `${issue.description} ${issue.suggestedFix}`;

      // 尝试从描述中提取 shotId
      const shotMatches = combined.match(/shot\d+|ep\d+_shot\d+/gi);
      if (shotMatches) {
        for (const m of shotMatches) {
          const idx = shotIdToIndex.get(m);
          if (idx !== undefined) indices.add(idx);
          // 也尝试按 shotIndex 匹配
          const numMatch = m.match(/(\d+)$/);
          if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (num >= 0 && num < shots.length) indices.add(num);
          }
        }
      }

      // 尝试从描述中提取 sceneId
      const sceneMatches = combined.match(/ep\d+_sc\d+|scene\s*\d+/gi);
      if (sceneMatches) {
        for (const m of sceneMatches) {
          const sceneIndices = sceneIdToIndices.get(m);
          if (sceneIndices) sceneIndices.forEach(i => indices.add(i));
        }
      }
    }

    // 从 review 的 consistencyRiskShots / cameraReadabilityRiskShots 中补充
    for (const rs of [...(review.consistencyRiskShots ?? []), ...(review.cameraReadabilityRiskShots ?? [])]) {
      const idx = shotIdToIndex.get(rs.shotId);
      if (idx !== undefined) indices.add(idx);
    }

    return indices;
  }

  /** 检查 issue 是否引用了具体的 shot */
  private issueRefersToSpecificShot(issue: IssueItem, shots: Shot[]): boolean {
    const combined = `${issue.description} ${issue.suggestedFix}`;
    return shots.some(s => combined.includes(s.shotId)) || /shot\d+|ep\d+_sc\d+/i.test(combined);
  }

  /** 将受影响的 shot 索引规划为批次（含 context shots） */
  private planBatches(affected: Set<number>, totalShots: number): Array<{ indices: number[] }> {
    if (affected.size === 0) return [];

    // 将 affected 扩展为包含 context 的连续区间
    const expanded = new Set<number>();
    for (const idx of affected) {
      for (let offset = -CONTEXT_RADIUS; offset <= CONTEXT_RADIUS; offset++) {
        const target = idx + offset;
        if (target >= 0 && target < totalShots) expanded.add(target);
      }
    }

    // 排序后合并为连续区间
    const sorted = [...expanded].sort((a, b) => a - b);
    const batches: Array<{ indices: number[] }> = [];
    let current: number[] = [];

    for (const idx of sorted) {
      if (current.length > 0 && (idx - current[current.length - 1] > 1 || current.length >= MAX_SHOTS_PER_BATCH)) {
        batches.push({ indices: current });
        current = [];
      }
      current.push(idx);
    }
    if (current.length > 0) batches.push({ indices: current });

    return batches;
  }

  /** 构建精简的 script context（只含指定场景的台词） */
  private buildScriptContext(script: EpisodeScript, sceneIds: Set<string>): string {
    const relevantScenes = script.scenes.filter(s => sceneIds.has(s.sceneId));
    if (!relevantScenes.length) return '';
    const slim = relevantScenes.map(s => ({
      sceneId: s.sceneId,
      purpose: s.purpose,
      dialogues: s.dialogues,
      actions: s.actions?.slice(0, 3),
    }));
    return `\n=== 相关剧本场景（如修改了台词，请在 scriptPatches 中返回修改） ===\n${JSON.stringify(slim, null, 0)}`;
  }
}
