/** Global LLM module — shared LlmService + EmbeddingService for all novel agents. */
import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmTraceLoggerService } from './llm-trace-logger.service';
import { EmbeddingService } from './embedding.service';

@Global()
@Module({
  providers: [LlmService, LlmTraceLoggerService, EmbeddingService],
  exports: [LlmService, LlmTraceLoggerService, EmbeddingService],
})
export class LlmModule {}
