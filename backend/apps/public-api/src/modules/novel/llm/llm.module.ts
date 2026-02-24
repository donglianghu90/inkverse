/**
 * Global LLM module so every agent/service can inject a single shared LlmService.
 */
import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmUsageTrackerService } from './llm-usage-tracker.service';

@Global()
@Module({
  providers: [LlmService, LlmUsageTrackerService],
  exports: [LlmService, LlmUsageTrackerService],
})
export class LlmModule {}
