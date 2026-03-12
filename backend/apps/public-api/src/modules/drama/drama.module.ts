/** Drama module — 短剧引擎，从创意到 Shot JSON + 媒体的完整链路，含任务队列/事件追踪/计费/全局资产 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { DramaGenreTemplateEntity } from './entities/drama-genre-template.entity';
import { DramaAgentPipelineEntity } from './entities/drama-agent-pipeline.entity';
import { DramaTaskEntity } from './task/entities/task.entity'; // 任务队列
import { DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity } from './run/entities/run.entity'; // 事件追踪
import { GlobalAssetFolderEntity, GlobalCharacterEntity, GlobalLocationEntity, GlobalStyleEntity } from './asset-hub/entities/asset-hub.entity'; // 全局资产
import { MediaModule } from '../media/media.module';
import { DramaController } from './drama.controller';
import { DramaService } from './drama.service';
// ── 新版 Workflow Services（workflow/ 子目录）──
import { EpisodeWorkflowService } from './workflow/episode-workflow.service';
import { DramaAgentPipelineService } from './workflow/drama-agent-pipeline.service';
import { DramaWorkflowTopologyService } from './workflow/drama-workflow-topology.service';
import { DramaWorkflowExecutionService } from './workflow/drama-workflow-execution.service';
import { DramaCalibrationService } from './workflow/drama-calibration.service';
import { DramaDeterministicCheckerService } from './workflow/deterministic-checker.service';
// ── 媒体 & 进度 & 基础服务 ──
import { MediaOrchestratorService } from './media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaTaskService } from './task/task.service'; // 任务服务
import { TaskSubmitterService } from './task/task-submitter.service';
import { DramaTextProcessor } from './task/drama-text.processor';
import { DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor } from './task/drama-media.processor';
import { DramaRunService } from './run/run.service'; // 运行时服务
import { AssetHubService } from './asset-hub/asset-hub.service'; // 资产中心
// ── 创建链路 Agents（preparation 类，根目录保留含完整功能的 VisualAssetDesigner）──
import { DramaSeedAnalyzerAgent } from './agents/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/visual-asset-designer.agent'; // 根目录版含 resolveEpisodeCharacters/designNewCharacters
import { DramaProfilerAgent } from './agents/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/drama-strategy.agent';
// ── 逐集 Agents（scripting/ 子目录）──
import { ArcDirectorAgent } from './agents/scripting/arc-director.agent';
import { EpisodeDirectorAgent } from './agents/scripting/episode-director.agent';
import { ContinuityGuardAgent } from './agents/scripting/continuity-guard.agent';
import { ScriptwriterAgent } from './agents/scripting/scriptwriter.agent';
import { DialogueCoachAgent } from './agents/scripting/dialogue-coach.agent';
// ── 媒体制作 Agents（production/ 子目录）──
import { StoryboardDirectorAgent } from './agents/production/storyboard-director.agent';
import { AudioDirectorAgent } from './agents/production/audio-director.agent';
// ── 审核 & 优化 Agents（review/ 子目录）──
import { ScriptReviewerAgent } from './agents/review/script-reviewer.agent';
import { ScriptEditorAgent } from './agents/review/script-editor.agent';
import { PacingAnalyzerAgent } from './agents/review/pacing-analyzer.agent';
import { HookCrafterAgent } from './agents/review/hook-crafter.agent';
import { EpisodeRecorderAgent } from './agents/review/episode-recorder.agent';
// ── Prompt & 其他工具 ──
import { DramaPromptTemplateService } from './prompting/drama-prompt-template.service';
import { DramaTaskRecoveryService } from './drama-task-recovery.service';
import { MediaQualityGateService } from './media-quality-gate.service';
import { ShotCoherenceValidatorService } from './shot-coherence-validator.service';
import { EmotionMediaMapperService } from './emotion-media-mapper.service';
import { GenerationPolicyService } from './generation-policy.service';
import { DRAMA_QUEUE } from './task/types';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DramaEntity, EpisodeEntity, VisualAssetEntity, DramaWorkflowExecutionEntity, DramaGenreTemplateEntity, DramaAgentPipelineEntity,
      DramaTaskEntity, // 任务队列
      DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity, // 事件追踪
      GlobalAssetFolderEntity, GlobalCharacterEntity, GlobalLocationEntity, GlobalStyleEntity, // 全局资产
    ]),
    BullModule.registerQueue( // 四队列分治
      { name: DRAMA_QUEUE.TEXT }, { name: DRAMA_QUEUE.IMAGE },
      { name: DRAMA_QUEUE.VIDEO }, { name: DRAMA_QUEUE.VOICE },
    ),
    MediaModule,
  ],
  controllers: [DramaController],
  providers: [
    // 核心服务
    DramaService, EpisodeWorkflowService, DramaWorkflowExecutionService,
    DramaAgentPipelineService, DramaWorkflowTopologyService, MediaOrchestratorService,
    DramaProgressService, DramaGenreTemplateService,
    // 任务队列
    DramaTaskService, TaskSubmitterService,
    DramaTextProcessor, DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor,
    // 运行时事件追踪
    DramaRunService,
    // 全局资产
    AssetHubService,
    // 创建链路 Agents
    DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent,
    DramaProfilerAgent, DramaStrategyAgent,
    // 逐集 Agents
    ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent,
    ScriptwriterAgent, DialogueCoachAgent,
    StoryboardDirectorAgent, AudioDirectorAgent,
    ScriptReviewerAgent, ScriptEditorAgent,
    PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent,
    // 工具 & 校验
    DramaDeterministicCheckerService, DramaPromptTemplateService, DramaCalibrationService,
    DramaTaskRecoveryService,
    MediaQualityGateService, ShotCoherenceValidatorService, EmotionMediaMapperService, GenerationPolicyService,
  ],
  exports: [DramaTaskService, TaskSubmitterService, DramaRunService, AssetHubService],
})
export class DramaModule {}
