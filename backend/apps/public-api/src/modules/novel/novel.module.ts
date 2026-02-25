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
import { BookAgentPipelineEntity } from './entities/book-agent-pipeline.entity';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { AUTO_SERIALIZATION_QUEUE } from './auto-serialization.processor';

import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';
import { ChapterWorkflowService } from './chapter-workflow.service';
import { DeepMaintenanceService } from './deep-maintenance.service';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';

// Core agents
import { SeedAnalyzerAgent } from './agents/seed-analyzer.agent';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';

// New quality agents
import { ContinuityGuardAgent } from './agents/continuity-guard.agent';
import { HookCrafterAgent } from './agents/hook-crafter.agent';
import { CharacterVoiceCoachAgent } from './agents/character-voice-coach.agent';
import { PacingAnalyzerAgent } from './agents/pacing-analyzer.agent';
import { ReaderPulseAnalyzerAgent } from './agents/reader-pulse-analyzer.agent';

// Recorder sub-agents (parallel extraction)
import { TextAnalyzerAgent } from './agents/text-analyzer.agent';
import { WorldExtractorAgent } from './agents/world-extractor.agent';
import { NarrativeExtractorAgent } from './agents/narrative-extractor.agent';

import { LoreApplicationService } from './lore-application.service';
import { NovelProgressService } from './novel-progress.service';
import { AutoSerializationService } from './auto-serialization.service';
import { AutoSerializationProcessor } from './auto-serialization.processor';
import { DetailStoreService } from './detail-store.service';
import { DetailContextService } from './detail-context.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BookEntity,
      ChapterEntity,
      ArtifactEntity,
      AutoSerializationJobEntity,
      BookAgentPipelineEntity,
    ]),
    BullModule.registerQueue({ name: AUTO_SERIALIZATION_QUEUE }),
  ],
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterWorkflowService,
    DeepMaintenanceService,
    DeterministicCheckerService,

    // Core agents
    SeedAnalyzerAgent,
    IntentAgent,
    CreativeWriterAgent,
    ReviewerAgent,
    EditorAgent,
    RecorderAgent,
    PromptProfilerAgent,

    // New quality agents
    ContinuityGuardAgent,
    HookCrafterAgent,
    CharacterVoiceCoachAgent,
    PacingAnalyzerAgent,
    ReaderPulseAnalyzerAgent,

    // Recorder sub-agents
    TextAnalyzerAgent,
    WorldExtractorAgent,
    NarrativeExtractorAgent,

    LoreApplicationService,
    NovelProgressService,
    AutoSerializationService,
    AutoSerializationProcessor,
    BookAgentPipelineService,
    DetailStoreService,
    DetailContextService,
  ],
})
export class NovelModule {}
