/** Drama module — 短剧引擎，独立于 Novel 模块，从创意到 Shot JSON + 媒体生成的完整链路。 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DramaEntity } from './entities/drama.entity';
import { EpisodeEntity } from './entities/episode.entity';
import { VisualAssetEntity } from './entities/visual-asset.entity';
import { DramaWorkflowExecutionEntity } from './entities/drama-workflow-execution.entity';
import { DramaGenreTemplateEntity } from './entities/drama-genre-template.entity';
import { DramaAgentPipelineEntity } from './entities/drama-agent-pipeline.entity';
import { MediaModule } from '../media/media.module';
import { DramaController } from './drama.controller';
import { DramaService } from './drama.service';
import { EpisodeWorkflowService } from './episode-workflow.service';
import { DramaAgentPipelineService } from './drama-agent-pipeline.service';
import { DramaWorkflowTopologyService } from './drama-workflow-topology.service';
import { MediaOrchestratorService } from './media-orchestrator.service';
import { DramaProgressService } from './drama-progress.service';
import { DramaGenreTemplateService } from './drama-genre-template.service';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DramaEntity, EpisodeEntity, VisualAssetEntity,
      DramaWorkflowExecutionEntity, DramaGenreTemplateEntity, DramaAgentPipelineEntity,
    ]),
    MediaModule,
  ],
  controllers: [DramaController],
  providers: [
    DramaService, EpisodeWorkflowService, DramaAgentPipelineService, DramaWorkflowTopologyService, MediaOrchestratorService,
    DramaProgressService, DramaGenreTemplateService,
    DramaSeedAnalyzerAgent, SeriesDirectorAgent, VisualAssetDesignerAgent,
    DramaProfilerAgent, DramaStrategyAgent,
    ArcDirectorAgent, EpisodeDirectorAgent, ContinuityGuardAgent,
    ScriptwriterAgent, DialogueCoachAgent,
    StoryboardDirectorAgent, AudioDirectorAgent,
    ScriptReviewerAgent, ScriptEditorAgent,
    PacingAnalyzerAgent, HookCrafterAgent, EpisodeRecorderAgent,
    DramaDeterministicCheckerService,
    DramaPromptTemplateService,
  ],
})
export class DramaModule {}
