/**
 * Novel module — organic creation architecture.
 * Only V2 agents, workflow, and maintenance services.
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
import { NovelV2Service } from './novel-v2.service';
import { ChapterWorkflowV2Service } from './chapter-workflow-v2.service';
import { DeepMaintenanceService } from './deep-maintenance.service';
import { DeterministicCheckerService } from './validators/deterministic-checker.service';

import { SeedAnalyzerAgent } from './agents/seed-analyzer.agent';
import { IntentAgent } from './agents/intent.agent';
import { CreativeWriterAgent } from './agents/creative-writer.agent';
import { ReviewerAgent } from './agents/reviewer.agent';
import { EditorAgent } from './agents/editor.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';

import { LoreApplicationService } from './lore-application.service';
import { NovelProgressService } from './novel-progress.service';
import { AutoSerializationService } from './auto-serialization.service';
import { AutoSerializationProcessor } from './auto-serialization.processor';

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
    NovelV2Service,
    ChapterWorkflowV2Service,
    DeepMaintenanceService,
    DeterministicCheckerService,

    SeedAnalyzerAgent,
    IntentAgent,
    CreativeWriterAgent,
    ReviewerAgent,
    EditorAgent,
    RecorderAgent,
    PromptProfilerAgent,

    LoreApplicationService,
    NovelProgressService,
    AutoSerializationService,
    AutoSerializationProcessor,
    BookAgentPipelineService,
  ],
})
export class NovelV2Module {}
