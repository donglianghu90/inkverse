/** Global LLM module — shared LlmService + EmbeddingService for all novel agents. */
import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmUsageTrackerService } from './llm-usage-tracker.service';
import { EmbeddingService } from './embedding.service';

@Global()
@Module({
  providers: [LlmService, LlmUsageTrackerService, EmbeddingService],
  exports: [LlmService, LlmUsageTrackerService, EmbeddingService],
})
export class LlmModule {}
