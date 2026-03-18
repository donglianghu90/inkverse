/** Drama module — 短剧引擎，从创意到 Shot JSON + 媒体的完整链路，含任务队列/事件追踪 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { DramaGenreTemplateEntity } from './entities/drama-genre-template.entity';
import { DramaVisualStyleTemplateEntity } from './entities/drama-visual-style-template.entity';
import { DramaAgentPipelineEntity } from './entities/drama-agent-pipeline.entity';
import { DramaTaskEntity } from './entities/task.entity';
import { DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity } from './entities/run.entity';
import { MediaModule } from '../media/media.module';
import { DramaController } from './drama.controller';
import { DramaService } from './drama.service';
// ── Workflow Services（桶导入）──
import {
  EpisodeWorkflowService, DramaAgentPipelineService, DramaWorkflowTopologyService,
  DramaWorkflowExecutionService, DramaCalibrationService,
} from './workflow';
import { DramaDeterministicCheckerService } from './workflow/deterministic-checker.service';
// ── 媒体管线 Services（桶导入）──
import {
  MediaOrchestratorService, MediaQualityGateService, ShotCoherenceValidatorService,
  EmotionMediaMapperService, GenerationPolicyService, ImageProviderRouterService,
} from './media-pipeline';
// ── 基础服务 ──
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { DramaVisualStyleTemplateService } from './drama-visual-style-template.service';
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
import { DramaTaskRecoveryService } from './drama-task-recovery.service';
import { DRAMA_QUEUE } from './task/types';
// ── 市场数据 ──
import { MarketDramaEntity } from './entities/market-drama.entity';
import { MarketController } from './market/market.controller';
import { MarketDataService } from './market/market-data.service';
import { MarketSchedulerService } from './market/market-scheduler.service';
import { DouyinDramaCrawler } from './market/crawlers/douyin-drama.crawler';
import { HongguoDramaCrawler } from './market/crawlers/hongguo-drama.crawler';
import { DramaGlobalPromptSettingEntity } from './entities/drama-global-prompt-setting.entity';
import { DramaGlobalPromptSettingService } from './drama-global-prompt-setting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DramaEntity, EpisodeEntity, VisualAssetEntity, DramaWorkflowExecutionEntity, DramaGenreTemplateEntity, DramaAgentPipelineEntity,
      DramaTaskEntity, MarketDramaEntity,
      DramaGraphRunEntity, DramaGraphStepEntity, DramaGraphEventEntity,
      DramaVisualStyleTemplateEntity, DramaGlobalPromptSettingEntity,
    ]),
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: DRAMA_QUEUE.TEXT }, { name: DRAMA_QUEUE.IMAGE },
      { name: DRAMA_QUEUE.VIDEO }, { name: DRAMA_QUEUE.VOICE },
    ),
    MediaModule,
  ],
  controllers: [DramaController, MarketController],
  providers: [
    DramaService, EpisodeWorkflowService, DramaWorkflowExecutionService, DramaAgentPipelineService, DramaWorkflowTopologyService,
    MediaOrchestratorService, MediaQualityGateService, ShotCoherenceValidatorService, EmotionMediaMapperService, GenerationPolicyService, ImageProviderRouterService,
    DramaProgressService, DramaGenreTemplateService, DramaVisualStyleTemplateService,
    DramaTaskService, TaskSubmitterService,
    DramaTextProcessor, DramaImageProcessor, DramaVideoProcessor, DramaVoiceProcessor,
    DramaRunService,
    DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent, DramaProfilerAgent, DramaStrategyAgent,
    ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent, ScriptwriterAgent, DialogueCoachAgent,
    StoryboardDirectorAgent, AudioDirectorAgent,
    ScriptReviewerAgent, ScriptEditorAgent, PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent,
    DramaDeterministicCheckerService, DramaPromptTemplateService, DramaCalibrationService,
    DramaTaskRecoveryService,
    MarketDataService, MarketSchedulerService, DouyinDramaCrawler, HongguoDramaCrawler,
    DramaGlobalPromptSettingService,
  ],
  exports: [DramaTaskService, TaskSubmitterService, DramaRunService],
})
export class DramaModule {}
