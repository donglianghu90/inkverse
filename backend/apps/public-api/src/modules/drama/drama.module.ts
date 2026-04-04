/** Drama module — 短剧引擎，从创意到 Shot JSON + 媒体的完整链路，含任务队列/事件追踪 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';

import { DramaAgentPipelineEntity } from './entities/drama-agent-pipeline.entity';
import { DramaTaskEntity } from './entities/task.entity';
import { DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity } from './entities/run.entity';
import { MediaModule } from '../media/media.module';
// ── Controllers ──
import { DramaController } from './drama.controller';

import { DramaPipelineController } from './drama-pipeline.controller';
import { DramaEpisodeController } from './drama-episode.controller';
import { DramaPromptPreviewController } from './drama-prompt-preview.controller';
import { DramaIdeaController } from './drama-idea.controller';
// ── Core Services ──
import { DramaService } from './drama.service';
import { DramaSseHelper } from './drama-sse.helper';
import { DramaIdeaService } from './drama-idea.service';
import { DramaVisualAssetService } from './drama-visual-asset.service';
import { DramaStateStore } from './drama-state-store.service';
// ── Workflow Services（桶导入）──
import {
  EpisodeWorkflowService, DramaAgentPipelineService, DramaWorkflowTopologyService,
  DramaWorkflowExecutionService, DramaCalibrationService,
} from './workflow';
import { DramaDeterministicCheckerService } from './workflow/deterministic-checker.service';
// ── 媒体管线 Services（桶导入）──
import {
  MediaOrchestratorService, MediaQualityGateService, ShotCoherenceValidatorService,
  EmotionMediaMapperService, GenerationPolicyService, ImageProviderRouterService, VideoProviderRouterService,
  ShotProductionOrderService, ShotContextBuilderService, ShotPromptAssemblerService,
  PromptCompilerService,
} from './media-pipeline';
// ── 基础服务 ──
import { DramaProgressService } from './drama-progress.service';

import { DramaTaskService } from './task/task.service';
import { TaskSubmitterService } from './task/task-submitter.service';
import { DramaTextProcessor } from './task/drama-text.processor';
import { DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor } from './task/drama-media.processor';
import { DramaRunService } from './run/run.service';
// ── 创建链路 Agents（桶导入）──
import {
  DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent,
  DramaProfilerAgent, DramaStrategyAgent,
} from './agents/preparation';
// ── 逐集 Agents（桶导入）──
import { ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent, ScriptwriterAgent, DialogueCoachAgent } from './agents/scripting';
import { StoryboardDirectorAgent, AudioDirectorAgent } from './agents/production';
import { ScriptReviewerAgent, ScriptEditorAgent, PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent } from './agents/review';
// ── Prompt & 任务恢复 ──
import { DramaPromptTemplateService } from './prompting/drama-prompt-template.service';
import { DramaPromptBakerService } from './prompting/drama-prompt-baker.service';
import { DramaTaskRecoveryService } from './drama-task-recovery.service';
import { DramaMediaWatchdogService } from './drama-media-watchdog.service';
import { DRAMA_QUEUE } from './task/types';

import { TemplateModule } from '../template/template.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DramaEntity, EpisodeEntity, VisualAssetEntity, DramaWorkflowExecutionEntity, DramaAgentPipelineEntity,
      DramaTaskEntity,
      DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: DRAMA_QUEUE.TEXT }, { name: DRAMA_QUEUE.IMAGE },
      { name: DRAMA_QUEUE.VIDEO }, { name: DRAMA_QUEUE.VOICE },
    ),
    MediaModule,
    TemplateModule,
  ],
  controllers: [
    DramaPipelineController, DramaEpisodeController, DramaPromptPreviewController,
    DramaIdeaController,
    DramaController,
  ],
  providers: [
    DramaService, DramaSseHelper, DramaIdeaService, DramaVisualAssetService, DramaStateStore, EpisodeWorkflowService, DramaWorkflowExecutionService, DramaAgentPipelineService, DramaWorkflowTopologyService,
    MediaOrchestratorService, MediaQualityGateService, ShotCoherenceValidatorService, EmotionMediaMapperService, GenerationPolicyService, ImageProviderRouterService, VideoProviderRouterService,
    ShotProductionOrderService, ShotContextBuilderService, ShotPromptAssemblerService, PromptCompilerService,
    DramaProgressService,
    DramaTaskService, TaskSubmitterService,
    DramaTextProcessor, DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor,
    DramaRunService,
    DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent, DramaProfilerAgent, DramaStrategyAgent,
    ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent, ScriptwriterAgent, DialogueCoachAgent,
    StoryboardDirectorAgent, AudioDirectorAgent,
    ScriptReviewerAgent, ScriptEditorAgent, PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent,
    DramaDeterministicCheckerService, DramaPromptTemplateService, DramaPromptBakerService, DramaCalibrationService,
    DramaTaskRecoveryService, DramaMediaWatchdogService,
  ],
  exports: [DramaTaskService, TaskSubmitterService, DramaRunService],
})
export class DramaModule {}

