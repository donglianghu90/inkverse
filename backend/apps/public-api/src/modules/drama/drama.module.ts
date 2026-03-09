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
import { EpisodeWorkflowService } from './episode-workflow.service';
import { DramaAgentPipelineService } from './drama-agent-pipeline.service';
import { DramaWorkflowTopologyService } from './drama-workflow-topology.service';
import { MediaOrchestratorService } from './media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaWorkflowExecutionService } from './drama-workflow-execution.service';
import { DramaTaskService } from './task/task.service'; // 任务服务
import { TaskSubmitterService } from './task/task-submitter.service';
import { DramaTextProcessor } from './task/drama-text.processor';
import { DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor } from './task/drama-media.processor';
import { DramaRunService } from './run/run.service'; // 运行时服务
import { AssetHubService } from './asset-hub/asset-hub.service'; // 资产中心
import { DramaSeedAnalyzerAgent } from './agents/drama-seed-analyzer.agent';
import { SeriesDirectorAgent } from './agents/series-director.agent';
import { VisualAssetDesignerAgent } from './agents/visual-asset-designer.agent';
import { DramaProfilerAgent } from './agents/drama-profiler.agent';
import { DramaStrategyAgent } from './agents/drama-strategy.agent';
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
import { DramaPromptTemplateService } from './prompting/drama-prompt-template.service';
import { DramaCalibrationService } from './drama-calibration.service';
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
    DramaService, EpisodeWorkflowService, DramaWorkflowExecutionService, DramaAgentPipelineService, DramaWorkflowTopologyService, MediaOrchestratorService,
    DramaProgressService, DramaGenreTemplateService,
    DramaTaskService, TaskSubmitterService, // 任务队列
    DramaTextProcessor, DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor, // Worker 处理器
    DramaRunService, // 运行时事件追踪
    AssetHubService, // 全局资产
    DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent,
    DramaProfilerAgent, DramaStrategyAgent,
    ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent,
    ScriptwriterAgent, DialogueCoachAgent,
    StoryboardDirectorAgent, AudioDirectorAgent,
    ScriptReviewerAgent, ScriptEditorAgent,
    PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent,
    DramaDeterministicCheckerService, DramaPromptTemplateService, DramaCalibrationService,
    DramaTaskRecoveryService,
    MediaQualityGateService, ShotCoherenceValidatorService, EmotionMediaMapperService, GenerationPolicyService,
  ],
  exports: [DramaTaskService, TaskSubmitterService, DramaRunService, AssetHubService],
})
export class DramaModule {}
