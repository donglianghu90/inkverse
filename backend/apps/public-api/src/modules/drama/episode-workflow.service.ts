/**
 * 逐集 Pipeline 编排 — 将单集生成的所有Agent串联为完整工作流。
 * 流程：ArcDirector → EpisodeDirector → ContinuityGuard → Scriptwriter → DialogueCoach
 *       → StoryboardDirector → AudioDirector → DeterministicChecker → ScriptReviewer
 *       → (if needs_edit) ScriptEditor → HookCrafter → EpisodeRecorder
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { DramaState, EpisodeSynopsis } from './schemas/drama-state.schemas';
import { ArcDirectorAgent } from './agents/arc-director.agent';
import { EpisodeDirectorAgent } from './agents/episode-director.agent';
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { ScriptwriterAgent } from './agents/scriptwriter.agent';
import { DialogueCoachAgent } from './agents/dialogue-coach.agent';
import { StoryboardDirectorAgent } from './agents/storyboard-director.agent';
import { AudioDirectorAgent } from './agents/audio-director.agent';
import { ScriptReviewerAgent } from './agents/script-reviewer.agent';
import { ScriptEditorAgent } from './agents/script-editor.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { EpisodeRecorderAgent } from './agents/episode-recorder.agent';
import { DramaDeterministicCheckerService } from './validators/deterministic-checker.service';
import { DramaProgressService } from './drama-progress.service';

const MAX_EDIT_ROUNDS = 2;

@Injectable()
export class EpisodeWorkflowService {
  private readonly logger = new Logger(EpisodeWorkflowService.name);

  constructor(
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    @InjectRepository(DramaWorkflowExecutionEntity) private readonly wfRepo: Repository<DramaWorkflowExecutionEntity>,
    private readonly arcDirector: ArcDirectorAgent,
    private readonly episodeDirector: EpisodeDirectorAgent,
    private readonly continuityGuard: ContinuityGuardAgent,
    private readonly scriptwriter: ScriptwriterAgent,
    private readonly dialogueCoach: DialogueCoachAgent,
    private readonly storyboardDirector: StoryboardDirectorAgent,
    private readonly audioDirector: AudioDirectorAgent,
    private readonly reviewer: ScriptReviewerAgent,
    private readonly editor: ScriptEditorAgent,
    private readonly pacingAnalyzer: PacingAnalyzerAgent,
    private readonly hookCrafter: HookCrafterAgent,
    private readonly episodeRecorder: EpisodeRecorderAgent,
    private readonly deterministicChecker: DramaDeterministicCheckerService,
    private readonly progressService: DramaProgressService,
  ) {}

  async generateEpisode(dramaId: string, episodeNumber: number): Promise<void> {
    const drama = await this.dramaRepo.findOneOrFail({ where: { id: dramaId } });
    const state = drama.state as unknown as DramaState;
    const synopsis = state.seriesOutline?.episodes?.[episodeNumber - 1];
    if (!synopsis) throw new Error(`大纲中不存在第 ${episodeNumber} 集`);

    const wf = await this.wfRepo.save(this.wfRepo.create({
      dramaId, episodeNumber, status: 'running', lastCheckpoint: 'init',
      ownerInstanceId: `worker_${Date.now()}`, heartbeatAt: new Date(),
    }));

    const emitEp = (stepIndex: number, message: string, done = false) =>
      this.progressService.emit({ dramaId, phase: 'episode', episodeNumber, step: `ep_${stepIndex}`, stepIndex, totalSteps: 13, message, done });

    try {
      // Step 1: 段落规划
      this.log(wf.id, 1, '段落规划');
      emitEp(0, '段落规划...');
      const arcSegment = await this.arcDirector.planOrRefresh(state, episodeNumber);
      if (!state.currentArcSegment || state.currentArcSegment.segmentId !== arcSegment.segmentId) {
        state.currentArcSegment = arcSegment;
        if (!state.arcSegments.find(a => a.segmentId === arcSegment.segmentId)) state.arcSegments.push(arcSegment);
      }
      await this.checkpoint(wf, 'arc_planned', { arcSegment });
      emitEp(0, '段落规划完成', true);

      this.log(wf.id, 2, '集导演规划');
      emitEp(1, '集导演规划...');
      const intent = await this.episodeDirector.direct(state, synopsis);
      await this.checkpoint(wf, 'intent_ready', { intent });
      emitEp(1, '集导演完成', true);

      this.log(wf.id, 3, '连续性检查');
      emitEp(2, '连续性检查...');
      const continuity = await this.continuityGuard.verify(state, intent);
      if (continuity.warnings.some(w => w.severity === 'block')) {
        this.logger.warn(`E${episodeNumber} 连续性检查有阻断性问题，仍继续但标记`);
      }
      await this.checkpoint(wf, 'continuity_checked', { continuity });
      emitEp(2, '连续性检查完成', true);

      this.log(wf.id, 4, '编剧创作');
      emitEp(3, '编剧创作...');
      let script = await this.scriptwriter.write(state, intent, continuity);
      await this.checkpoint(wf, 'script_drafted', { script });
      emitEp(3, '编剧创作完成', true);

      this.log(wf.id, 5, '台词润色');
      emitEp(4, '台词润色...');
      script = await this.dialogueCoach.polish(script, state.characters, state.promptProfile);
      await this.checkpoint(wf, 'dialogue_polished', { script });
      emitEp(4, '台词润色完成', true);

      this.log(wf.id, 6, '分镜生成');
      emitEp(5, '分镜生成...');
      let storyboard = await this.storyboardDirector.direct(state, script);
      await this.checkpoint(wf, 'storyboard_drafted', { storyboard });
      emitEp(5, '分镜生成完成', true);

      this.log(wf.id, 7, '音频设计');
      emitEp(6, '音频设计...');
      storyboard = await this.audioDirector.enhance(state, storyboard);
      await this.checkpoint(wf, 'audio_designed', { storyboard });
      emitEp(6, '音频设计完成', true);

      this.log(wf.id, 8, '硬规则校验');
      emitEp(7, '硬规则校验...');
      const detCheck = this.deterministicChecker.check(state, script, storyboard);
      if (!detCheck.pass) {
        this.logger.warn(`E${episodeNumber} 硬规则校验失败: ${detCheck.failedChecks.map(f => f.rule).join(', ')}`);
      }
      await this.checkpoint(wf, 'deterministic_checked', { detCheck });
      emitEp(7, '硬规则校验完成', true);

      this.log(wf.id, 9, '质量审核');
      emitEp(8, '质量审核...');
      let review = await this.reviewer.review(state, script, storyboard);
      await this.checkpoint(wf, 'reviewed', { review });
      emitEp(8, '质量审核完成', true);

      for (let round = 0; round < MAX_EDIT_ROUNDS && review.overallVerdict === 'needs_edit'; round++) {
        this.log(wf.id, 10, `精修第${round + 1}轮`);
        emitEp(9, `精修第${round + 1}轮...`);
        storyboard = await this.editor.fix(state, storyboard, review);
        review = await this.reviewer.review(state, script, storyboard);
        await this.checkpoint(wf, `edited_round_${round + 1}`, { storyboard, review });
      }
      emitEp(9, '精修完成', true);

      this.log(wf.id, 11, '节奏分析');
      emitEp(10, '节奏分析...');
      const pacing = await this.pacingAnalyzer.analyze(state, storyboard);
      await this.checkpoint(wf, 'pacing_analyzed', { pacing });
      emitEp(10, '节奏分析完成', true);

      this.log(wf.id, 12, '悬念设计');
      emitEp(11, '悬念设计...');
      const hookResult = await this.hookCrafter.craft(state, storyboard);
      if (hookResult.previewShots.length > 0) {
        storyboard.shots.push(...hookResult.previewShots);
      }
      await this.checkpoint(wf, 'hook_crafted', { hookResult });
      emitEp(11, '悬念设计完成', true);

      this.log(wf.id, 13, '知识记录');
      emitEp(12, '知识记录...');
      const loreRecord = await this.episodeRecorder.record(state, script, storyboard, hookResult.cliffhangerSummary);
      await this.checkpoint(wf, 'recorded', { loreRecord });

      // 持久化Episode
      const episode = this.episodeRepo.create({
        dramaId, episodeNumber,
        title: synopsis.title,
        script: script as unknown as Record<string, unknown>,
        storyboard: storyboard as unknown as Record<string, unknown>,
        review: review as unknown as Record<string, unknown>,
        loreRecord: loreRecord as unknown as Record<string, unknown>,
        overallScore: review.overallScore,
        totalDurationSec: Math.round(storyboard.totalEstimatedDurationSec),
        shotCount: storyboard.shots.length,
      });
      await this.episodeRepo.save(episode);

      // 更新 DramaState
      this.updateDramaState(state, episodeNumber, hookResult, loreRecord, review);
      drama.state = state as unknown as Record<string, unknown>;
      drama.episodesGenerated = episodeNumber;
      drama.latestOverallScore = review.overallScore;
      await this.dramaRepo.save(drama);

      // 完成
      wf.status = 'completed';
      wf.summary = { overallScore: review.overallScore, shotCount: storyboard.shots.length, duration: storyboard.totalEstimatedDurationSec };
      await this.wfRepo.save(wf);
      emitEp(12, `E${episodeNumber} 生成完成`, true);
      this.logger.log(`✅ E${episodeNumber} 生成完成 — 评分: ${review.overallScore} | Shot: ${storyboard.shots.length} | 时长: ${storyboard.totalEstimatedDurationSec}s`);
    } catch (err) {
      wf.status = 'failed';
      wf.errorMessage = err instanceof Error ? err.message : String(err);
      await this.wfRepo.save(wf);
      throw err;
    }
  }

  private updateDramaState(
    state: DramaState, epNum: number,
    hookResult: { cliffhangerSummary?: string; hookType?: string },
    loreRecord: { summary?: string; flashbackCandidates?: Array<{ shotId?: string; reason?: string; emotionalWeight?: 'low' | 'medium' | 'high' | 'iconic' }> },
    review: { overallScore?: number; dimensions?: Record<string, number> },
  ): void {
    state.episodeCursor = epNum + 1;
    state.lastCliffhanger = hookResult.cliffhangerSummary ?? '';
    state.recentHookTypes.push({ episodeNumber: epNum, hookType: hookResult.hookType ?? 'cliffhanger' });
    if (state.recentHookTypes.length > 10) state.recentHookTypes = state.recentHookTypes.slice(-10);
    state.episodeSummaries.push({ episodeNumber: epNum, summary: loreRecord.summary ?? '' });
    const score = review.overallScore ?? 0;
    state.kpiHistory.push({ episodeNumber: epNum, overallScore: score, dimensions: review.dimensions ?? {}, generatedAt: new Date().toISOString() });

    (loreRecord.flashbackCandidates ?? []).forEach(fc => {
      state.flashbackBank.push({ shotId: fc.shotId ?? '', reason: fc.reason ?? '', emotionalWeight: fc.emotionalWeight ?? 'low', episodeNumber: epNum, visualPromptSnapshot: '' });
    });

    const intensity = score >= 8.5 ? 'climactic' : score >= 7 ? 'major' : score >= 5.5 ? 'medium' : 'minor';
    state.dopamineSchedule.history.push({ type: hookResult.hookType ?? 'cliffhanger', intensity, deliveredAtEpisode: epNum, description: hookResult.cliffhangerSummary ?? '' });
    state.dopamineSchedule.episodesSinceMinor = intensity === 'minor' ? 0 : state.dopamineSchedule.episodesSinceMinor + 1;
    state.dopamineSchedule.episodesSinceMajor = (intensity === 'major' || intensity === 'climactic') ? 0 : state.dopamineSchedule.episodesSinceMajor + 1;
    state.updatedAt = new Date().toISOString();
  }

  private async checkpoint(wf: DramaWorkflowExecutionEntity, name: string, data: Record<string, unknown>): Promise<void> {
    wf.lastCheckpoint = name;
    wf.stepOutputs = { ...wf.stepOutputs, [name]: data };
    wf.heartbeatAt = new Date();
    await this.wfRepo.save(wf);
  }

  private log(wfId: string, step: number, name: string): void {
    this.logger.log(`[${wfId.slice(0, 8)}] Step ${step}/13: ${name}`);
  }
}
