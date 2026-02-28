/**
 * Novel module — organic creation architecture with multi-agent quality system.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';

import { BookEntity } from './entities/book.entity';
import { ChapterEntity } from './entities/chapter.entity';
import { ArtifactEntity } from './entities/artifact.entity';
import { AutoSerializationJobEntity } from './entities/auto-serialization-job.entity';
import { ChapterResyncJobEntity } from './entities/chapter-resync-job.entity';
import { BookAgentPipelineEntity } from './entities/book-agent-pipeline.entity';
import { BookPromptTemplateEntity } from './entities/book-prompt-template.entity';
import { WorkflowExecutionEntity } from './entities/workflow-execution.entity';
import { ChapterMemoryEntity } from './entities/chapter-memory.entity';
import { ArcSummaryEntity, VolumeSummaryEntity } from './entities/summary-pyramid.entity';
import {
  BookCharacterEntity, BookPlotThreadEntity, BookTimelineEventEntity,
  BookCharacterFactEntity, BookRelationEntity, BookChapterSummaryEntity,
  BookFactionEntity, BookCommitmentEntity,
} from './entities/book-state-entities';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { WorkflowTopologyService } from './workflow-topology.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
import { WorkflowExecutionService } from './workflow-execution.service';
import { BookStateRepository } from './book-state.repository';
import { AUTO_SERIALIZATION_QUEUE } from './auto-serialization.queue';
import { CHAPTER_RESYNC_QUEUE } from './chapter-resync.queue';

import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterWorkflowService } from './chapter-workflow.service';
import { DeepMaintenanceService } from './deep-maintenance.service';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';

// Core agents
import { SeedAnalyzerAgent } from './agents/seed-analyzer.agent';
import { ArcDirectorAgent } from './agents/arc-director.agent';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';
import { ScenePlannerAgent } from './agents/scene-planner.agent';
import { SceneStitcherAgent } from './agents/scene-stitcher.agent';
import { VolumeDirectorAgent } from './agents/volume-director.agent';

// New quality agents
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { CharacterVoiceCoachAgent } from './agents/character-voice-coach.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { ReaderPulseAnalyzerAgent } from './agents/reader-pulse-analyzer.agent';
import { RetrospectiveLearnerAgent } from './agents/retrospective-learner.agent';

// Recorder sub-agents (parallel extraction)
import { TextAnalyzerAgent } from './agents/text-analyzer.agent';
import { WorldExtractorAgent } from './agents/world-extractor.agent';
import { NarrativeExtractorAgent } from './agents/narrative-extractor.agent';

import { LoreApplicationService } from './lore-application.service';
import { NovelProgressService } from './novel-progress.service';
import { AutoSerializationService } from './auto-serialization.service';
import { AutoSerializationProcessor } from './auto-serialization.processor';
import { ChapterResyncProcessor } from './chapter-resync.processor';
import { DetailStoreService } from './detail-store.service';
import { DetailContextService } from './detail-context.service';
import { CreateBookSessionService } from './create-book-session.service';
import { BookCreationSseService } from './book-creation-sse.service';
import { CreateBookSessionEntity } from './entities/create-book-session.entity';
import { GenreProfileTemplateEntity } from './entities/genre-profile-template.entity';
import { GenreProfileTemplateService } from './genre-profile-template.service';
import { RuleCompilerService } from './rule-compiler.service';
import { MemoryRetrieverService } from './memory-retriever.service';
import { TaskRecoveryService } from './task-recovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookEntity,
      ChapterEntity,
      ArtifactEntity,
      AutoSerializationJobEntity,
      ChapterResyncJobEntity,
      BookAgentPipelineEntity,
      ChapterMemoryEntity,
      ArcSummaryEntity, VolumeSummaryEntity,
      BookCharacterEntity, BookPlotThreadEntity, BookTimelineEventEntity,
      BookCharacterFactEntity, BookRelationEntity, BookChapterSummaryEntity,
      BookFactionEntity, BookCommitmentEntity,
      BookPromptTemplateEntity,
      WorkflowExecutionEntity,
      CreateBookSessionEntity,
      GenreProfileTemplateEntity,
    ]),
    BullModule.registerQueue(
      { name: AUTO_SERIALIZATION_QUEUE },
      { name: CHAPTER_RESYNC_QUEUE },
    ),
  ],
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterWorkflowService,
    DeepMaintenanceService,
    DeterministicCheckerService,

    // Core agents
    SeedAnalyzerAgent,
    ArcDirectorAgent,
    IntentAgent,
    CreativeWriterAgent,
    ReviewerAgent,
    EditorAgent,
    RecorderAgent,
    PromptProfilerAgent,
    ScenePlannerAgent,
    SceneStitcherAgent,
    VolumeDirectorAgent,

    // New quality agents
    ContinuityGuardAgent,
    HookCrafterAgent,
    CharacterVoiceCoachAgent,
    PacingAnalyzerAgent,
    ReaderPulseAnalyzerAgent,
    RetrospectiveLearnerAgent,

    // Recorder sub-agents
    TextAnalyzerAgent,
    WorldExtractorAgent,
    NarrativeExtractorAgent,

    LoreApplicationService,
    NovelProgressService,
    AutoSerializationService,
    AutoSerializationProcessor,
    ChapterResyncProcessor,
    BookAgentPipelineService,
    WorkflowTopologyService,
    BookPromptTemplateService,
    WorkflowExecutionService,
    BookStateRepository,
    DetailStoreService,
    DetailContextService,
    CreateBookSessionService,
    BookCreationSseService,
    MemoryRetrieverService,
    TaskRecoveryService,
    GenreProfileTemplateService,
    RuleCompilerService,
  ],
})
export class NovelModule {}
