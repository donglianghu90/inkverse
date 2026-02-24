/**
 * Unified LLM gateway for all novel agents.
 * - Uses Gemini via LangChain ChatGoogleGenerativeAI.
 * - Supports structured output with Zod schema.
 * - Supports deterministic mock in dry-run/no-key mode.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableConfig } from '@langchain/core/runnables';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z, ZodTypeAny } from 'zod';
import { LlmUsageTrackerService } from './llm-usage-tracker.service';
import { ConfigService } from '@packages/modules';

interface StructuredGenerationInput<T extends ZodTypeAny> {
  taskName: string;
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  temperature?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface TokenUsageExtraction {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'usage_metadata' | 'response_metadata' | 'missing';
}

interface CostRates {
  inputRateUsdPer1M: number;
  outputRateUsdPer1M: number;
}

type ModelTier = 'creative' | 'standard' | 'lightweight';

interface ModelTierConfig {
  creative: string;
  standard: string;
  lightweight: string;
}

const DEFAULT_TASK_TIER: Record<string, ModelTier> = {
  // V1 agents
  'draft-writer': 'creative',
  'style-director': 'creative',
  'patch-rewriter': 'creative',
  'editor-in-chief': 'standard',
  'ip-bible-architect': 'standard',
  'cast-bootstrap': 'standard',
  'arc-architect': 'standard',
  'arc-architect-replan': 'standard',
  'chapter-contract-manager': 'standard',
  'scene-designer': 'standard',
  'continuity-auditor': 'standard',
  'reader-jury': 'standard',
  'plot-economy-planner': 'lightweight',
  'lore-recorder': 'lightweight',
  'character-canon-arbiter': 'lightweight',
  // V2 agents
  'seed-analyzer': 'standard',
  'chapter-intent': 'standard',
  'creative-writer': 'creative',
  'chapter-reviewer': 'standard',
  'chapter-editor': 'creative',
  'chapter-recorder': 'lightweight',
  'bible-crystallization': 'standard',
  'outline-revision': 'standard',
  'consistency-audit': 'standard',
  'canon-arbitration': 'lightweight',
  'thread-health-check': 'lightweight',
  'arc-planning': 'standard',
  'style-anchoring': 'lightweight',
};

interface LlmCachedConfig {
  apiKey: string;
  modelName: string;
  modelTiers: ModelTierConfig;
  fallbackModelName: string;
  maxPromptChars: number;
  costRates: CostRates;
  tracingEnabled: boolean;
  tracingProject: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly cfg: LlmCachedConfig;

  constructor(
    private readonly usageTracker: LlmUsageTrackerService,
    private readonly configService: ConfigService,
  ) {
    const llm = this.configService.get('llm') ?? ({} as Record<string, unknown>);
    const langchain = this.configService.get('langchain') ?? ({} as Record<string, unknown>);
    const langsmith = this.configService.get('langsmith') ?? ({} as Record<string, unknown>);
    const cost = (llm as Record<string, unknown>)?.cost ?? ({} as Record<string, unknown>);

    const llmRecord = llm as Record<string, unknown>;
    const defaultModel = String(llmRecord?.gemini?.['model'] || llmRecord?.google?.['model'] || 'gemini-2.5-pro');
    const tiers = (llmRecord?.tiers ?? {}) as Record<string, unknown>;

    this.cfg = {
      apiKey: String(llmRecord?.gemini?.['apiKey'] || llmRecord?.google?.['apiKey'] || ''),
      modelName: defaultModel,
      modelTiers: {
        creative: String(tiers.creative || defaultModel),
        standard: String(tiers.standard || defaultModel),
        lightweight: String(tiers.lightweight || defaultModel),
      },
      fallbackModelName: String(llmRecord?.fallbackModel || defaultModel),
      maxPromptChars: this.readNonNegativeNumber(llmRecord?.maxPromptChars as string | undefined, 400_000),
      costRates: {
        inputRateUsdPer1M: this.readNonNegativeNumber((cost as Record<string, unknown>)?.inputUsdPer1M as string | undefined, 0),
        outputRateUsdPer1M: this.readNonNegativeNumber((cost as Record<string, unknown>)?.outputUsdPer1M as string | undefined, 0),
      },
      tracingEnabled:
        ((langchain as Record<string, unknown>)?.tracingV2 ?? '').toString().toLowerCase() === 'true' ||
        Boolean((langsmith as Record<string, unknown>)?.tracing),
      tracingProject: String((langchain as Record<string, unknown>)?.project ?? 'novel-engine'),
    };
  }

  /**
   * Generate schema-validated structured output for a specific task.
   * Supports tiered model routing by task name and automatic fallback on failure.
   */
  async generateStructured<T extends ZodTypeAny>(
    input: StructuredGenerationInput<T>,
  ): Promise<z.infer<T>> {
    const startedAt = new Date();
    const { apiKey, costRates: rates } = this.cfg;
    const temperature = input.temperature ?? 0.6;
    const tags = this.buildTags(input);
    const primaryModel = this.resolveModelForTask(input.taskName);

    if (!apiKey) {
      throw new Error(`[${input.taskName}] GEMINI_API_KEY 未配置，无法调用 LLM`);
    }

    this.logger.log(
      `[${input.taskName}] ====== LLM 调用开始 ======\n` +
      `  模型: ${primaryModel} (tier: ${DEFAULT_TASK_TIER[input.taskName] ?? 'standard'}) | 温度: ${temperature}\n` +
      `  metadata: ${JSON.stringify(input.metadata ?? {})}\n` +
      `  tags: [${tags.join(', ')}]`,
    );
    this.logger.debug(
      `[${input.taskName}] SYSTEM PROMPT (${input.systemPrompt.length} chars):\n${this.truncate(input.systemPrompt, 1500)}`,
    );
    this.logger.debug(
      `[${input.taskName}] USER PROMPT (${input.userPrompt.length} chars):\n${this.truncate(input.userPrompt, 2000)}`,
    );

    const promptCharCount = input.systemPrompt.length + input.userPrompt.length;
    if (promptCharCount > this.cfg.maxPromptChars) {
      this.logger.warn(
        `[${input.taskName}] prompt size ${promptCharCount} chars exceeds budget ${this.cfg.maxPromptChars}`,
      );
    }

    const modelsToTry = [primaryModel];
    if (this.cfg.fallbackModelName !== primaryModel) {
      modelsToTry.push(this.cfg.fallbackModelName);
    }

    let lastError: unknown;
    for (const modelName of modelsToTry) {
      try {
        return await this.callModelWithTracking(input, modelName, temperature, tags);
      } catch (error) {
        lastError = error;
        if (modelName !== modelsToTry[modelsToTry.length - 1]) {
          this.logger.warn(
            `[${input.taskName}] model ${modelName} failed, falling back to ${modelsToTry[modelsToTry.indexOf(modelName) + 1]}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    throw lastError;
  }

  private resolveModelForTask(taskName: string): string {
    const tier = DEFAULT_TASK_TIER[taskName] ?? 'standard';
    return this.cfg.modelTiers[tier];
  }

  private async callModelWithTracking<T extends ZodTypeAny>(
    input: StructuredGenerationInput<T>,
    modelName: string,
    temperature: number,
    tags: string[],
  ): Promise<z.infer<T>> {
    const callStartedAt = new Date();
    const { apiKey, costRates: rates } = this.cfg;

    const model = new ChatGoogleGenerativeAI({
      apiKey,
      model: modelName,
      temperature,
      maxRetries: 3,
      timeout: 180_000,
    });
    const structuredModel = model.withStructuredOutput(input.schema, {
      includeRaw: true,
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', input.systemPrompt],
      ['human', input.userPrompt],
    ]);

    const chain = prompt.pipe(structuredModel);
    let response: unknown;
    try {
      response = await chain.invoke(
        {},
        this.buildInvokeConfig(input),
      );
    } catch (error) {
      const durationMs = new Date().getTime() - callStartedAt.getTime();
      this.logger.error(
        `[${input.taskName}] ====== LLM 调用失败 (${modelName}) ====== ${durationMs}ms\n` +
        `  错误: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - callStartedAt.getTime();
    const wrapped = this.unwrapStructuredResponse<z.infer<T>>(response);
    const usage = this.extractTokenUsage(wrapped.raw);
    const estimatedCostUsd = this.estimateCostUsd(
      usage.promptTokens,
      usage.completionTokens,
      rates,
    );

    this.logger.log(
      `[${input.taskName}] ====== LLM 调用完成 (${modelName}) ====== ${durationMs}ms\n` +
      `  tokens: prompt=${usage.promptTokens} completion=${usage.completionTokens} total=${usage.totalTokens}\n` +
      `  费用: $${estimatedCostUsd} (source: ${usage.source})`,
    );
    this.logger.debug(
      `[${input.taskName}] AI 输出 (parsed):\n${this.truncate(JSON.stringify(wrapped.parsed, null, 2), 2000)}`,
    );

    this.usageTracker.recordCall({
      taskName: input.taskName,
      model: modelName,
      provider: 'gemini',
      startedAt: callStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd,
      inputRateUsdPer1M: rates.inputRateUsdPer1M,
      outputRateUsdPer1M: rates.outputRateUsdPer1M,
      tokenSource: usage.source,
      temperature,
      tags,
    });

    return wrapped.parsed;
  }

  private buildInvokeConfig<T extends ZodTypeAny>(
    input: StructuredGenerationInput<T>,
  ): RunnableConfig {
    const tags = this.buildTags(input);
    const metadata = {
      taskName: input.taskName,
      model: this.cfg.modelName,
      provider: 'gemini',
      storyStore: 'postgres',
      ...input.metadata,
    };

    if (this.cfg.tracingEnabled) {
      this.logger.log(
        `[${input.taskName}] LangSmith tracing enabled (project=${this.cfg.tracingProject})`,
      );
    }

    return {
      runName: input.taskName,
      tags,
      metadata,
    };
  }

  private buildTags<T extends ZodTypeAny>(
    input: StructuredGenerationInput<T>,
  ): string[] {
    return ['novel-engine', input.taskName, ...(input.tags ?? [])];
  }

  private unwrapStructuredResponse<T>(response: unknown): {
    parsed: T;
    raw: Record<string, unknown> | null;
  } {
    if (
      this.isRecord(response) &&
      'parsed' in response
    ) {
      return {
        parsed: response.parsed as T,
        raw:
          this.isRecord(response.raw)
            ? (response.raw as Record<string, unknown>)
            : null,
      };
    }
    return {
      parsed: response as T,
      raw: null,
    };
  }

  private extractTokenUsage(raw: Record<string, unknown> | null): TokenUsageExtraction {
    if (!raw) {
      return {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        source: 'missing',
      };
    }

    const usageMetadata = this.toRecord(raw.usage_metadata);
    if (usageMetadata) {
      const promptTokens = this.toNonNegativeInteger(usageMetadata.input_tokens);
      const completionTokens = this.toNonNegativeInteger(usageMetadata.output_tokens);
      const totalTokens =
        this.toNonNegativeInteger(usageMetadata.total_tokens) ||
        promptTokens + completionTokens;
      return {
        promptTokens,
        completionTokens,
        totalTokens,
        source: 'usage_metadata',
      };
    }

    const responseMetadata = this.toRecord(raw.response_metadata);
    if (responseMetadata) {
      const usageFromResponse =
        this.toRecord(responseMetadata.tokenUsage) ??
        this.toRecord(responseMetadata.usage) ??
        this.toRecord(responseMetadata.usage_metadata);
      if (usageFromResponse) {
        const promptTokens =
          this.toNonNegativeInteger(usageFromResponse.promptTokens) ||
          this.toNonNegativeInteger(usageFromResponse.prompt_tokens) ||
          this.toNonNegativeInteger(usageFromResponse.input_tokens);
        const completionTokens =
          this.toNonNegativeInteger(usageFromResponse.completionTokens) ||
          this.toNonNegativeInteger(usageFromResponse.completion_tokens) ||
          this.toNonNegativeInteger(usageFromResponse.output_tokens);
        const totalTokens =
          this.toNonNegativeInteger(usageFromResponse.totalTokens) ||
          this.toNonNegativeInteger(usageFromResponse.total_tokens) ||
          promptTokens + completionTokens;
        return {
          promptTokens,
          completionTokens,
          totalTokens,
          source: 'response_metadata',
        };
      }
    }

    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      source: 'missing',
    };
  }

  private estimateCostUsd(
    promptTokens: number,
    completionTokens: number,
    rates: CostRates,
  ): number {
    const inputCost = (promptTokens / 1_000_000) * rates.inputRateUsdPer1M;
    const outputCost = (completionTokens / 1_000_000) * rates.outputRateUsdPer1M;
    return Number((inputCost + outputCost).toFixed(8));
  }

  private readNonNegativeNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return parsed;
  }

  private toNonNegativeInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }
    const normalized = Math.floor(value);
    return normalized >= 0 ? normalized : 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!this.isRecord(value)) {
      return null;
    }
    return value;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + `\n... [截断，共 ${text.length} 字符]`;
  }

}
