/** 多Provider LLM网关 — 支持 Gemini + Claude + OpenAI(Responses API)，按任务自动路由最优模型，per-tier精确计费 */
import { Injectable, Logger } from '@nestjs/common';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI, ChatOpenAIResponses, AzureChatOpenAI } from '@langchain/openai';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { z, ZodTypeAny } from 'zod';
import { LlmTraceLoggerService } from './llm-trace-logger.service';
import { ConfigService } from '@packages/modules';
import { UsageLedgerService } from '../../usage/usage-ledger.service';

export type LlmProvider = 'gemini' | 'claude' | 'openai';
export type ModelTier = 'creative' | 'standard' | 'lightweight';

interface StructuredGenerationInput<T extends ZodTypeAny> {
  taskName: string;
  systemPrompt: string;
  userPrompt: string;
  schema: T;
  temperature?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  imageUrls?: string[];
}

interface TokenUsageExtraction {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: 'usage_metadata' | 'response_metadata' | 'missing';
}

interface CostRates { inputRateUsdPer1M: number; outputRateUsdPer1M: number; }

interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  models: Record<ModelTier, string>;
  costRates: Record<ModelTier, CostRates>;
  enabled: boolean;
  azure?: boolean;
  azureInstanceName?: string;
  azureApiVersion?: string;
}

export interface TaskRoute { provider: LlmProvider; tier: ModelTier; }

/**
 * 任务→模型路由表：Gemini(创作/规划/轻量) + Claude(审阅) + OpenAI(可选)
 * Gemini Creative: 终稿文学创作；Standard: 规划/架构；Flash: 轻量提取
 * Claude Sonnet 4.6: 审阅/质量把关（多视角、避免自审同质化）；Opus 4.6: creative 备用
 */
const TASK_ROUTES: Record<string, TaskRoute> = {
  // ═══ Gemini Creative — 终稿文学创作 ═══
  'creative-writer':    { provider: 'gemini', tier: 'creative' },
  'hook-crafter':       { provider: 'gemini', tier: 'creative' },
  'chapter-editor':     { provider: 'gemini', tier: 'creative' },
  'character-voice-coach': { provider: 'gemini', tier: 'creative' },
  'scene-writer':       { provider: 'gemini', tier: 'creative' },
  'draft-writer':       { provider: 'gemini', tier: 'creative' },
  'scene-stitcher':     { provider: 'gemini', tier: 'creative' },
  'patch-rewriter':     { provider: 'gemini', tier: 'creative' },
  // ═══ Claude Standard — 审阅/质量把关（多视角，避免写手自审同质化） ═══
  'reader-jury':        { provider: 'claude', tier: 'standard' },
  'chapter-reviewer':   { provider: 'claude', tier: 'standard' },
  'editor-in-chief':    { provider: 'claude', tier: 'standard' },
  'consistency-audit':  { provider: 'claude', tier: 'standard' },
  'retrospective-learner': { provider: 'claude', tier: 'standard' },
  // ═══ Gemini Standard — 规划/架构/结构化分析 ═══
  'idea-enhancer':      { provider: 'gemini', tier: 'standard' },
  'story-goal-generator': { provider: 'gemini', tier: 'standard' },
  'genre-portrait':     { provider: 'gemini', tier: 'standard' },
  'genre-profile-ai-generate': { provider: 'gemini', tier: 'standard' },
  'genre-playbook-generate': { provider: 'gemini', tier: 'standard' },
  'book-strategy-init': { provider: 'gemini', tier: 'standard' },
  'book-strategy-refresh-policies': { provider: 'gemini', tier: 'standard' },
  'arc-summary-pyramid': { provider: 'gemini', tier: 'standard' },
  'volume-summary-pyramid': { provider: 'gemini', tier: 'standard' },
  'arc-director':       { provider: 'gemini', tier: 'standard' },
  'chapter-intent':     { provider: 'gemini', tier: 'standard' },
  'scene-planner':      { provider: 'gemini', tier: 'standard' },
  'bible-crystallization': { provider: 'gemini', tier: 'standard' },
  'outline-revision':   { provider: 'gemini', tier: 'standard' },
  'volume-director':    { provider: 'gemini', tier: 'standard' },
  'volume-foreshadowing': { provider: 'gemini', tier: 'standard' },
  'ip-bible-architect': { provider: 'gemini', tier: 'standard' },
  'cast-bootstrap':     { provider: 'gemini', tier: 'standard' },
  'arc-architect':      { provider: 'gemini', tier: 'standard' },
  'arc-planning':       { provider: 'gemini', tier: 'standard' },
  'scene-designer':     { provider: 'gemini', tier: 'standard' },
  'style-director':     { provider: 'gemini', tier: 'standard' },
  'seed-analyzer':      { provider: 'gemini', tier: 'standard' },
  'reader-pulse-analyzer': { provider: 'gemini', tier: 'standard' },
  'pacing-analyzer':    { provider: 'gemini', tier: 'standard' },
  'continuity-guard':   { provider: 'gemini', tier: 'standard' },
  'prompt-profiler':    { provider: 'gemini', tier: 'standard' },
  'agent-section-generator': { provider: 'gemini', tier: 'standard' },
  'chapter-contract-manager': { provider: 'gemini', tier: 'standard' },
  'continuity-auditor': { provider: 'gemini', tier: 'standard' },
  // ═══ Gemini Flash — 轻量提取（速度最快） ═══
  'text-analyzer':      { provider: 'gemini', tier: 'lightweight' },
  'narrative-extractor': { provider: 'gemini', tier: 'lightweight' },
  'world-extractor':    { provider: 'gemini', tier: 'lightweight' },
  'chapter-recorder':   { provider: 'gemini', tier: 'lightweight' },
  'canon-arbitration':  { provider: 'gemini', tier: 'lightweight' },
  'thread-health-check': { provider: 'gemini', tier: 'lightweight' },
  'style-anchoring':    { provider: 'gemini', tier: 'lightweight' },
  'location-sensory-extract': { provider: 'gemini', tier: 'lightweight' },
  'item-sensory-extract': { provider: 'gemini', tier: 'lightweight' },
  'plot-economy-planner': { provider: 'gemini', tier: 'lightweight' },
  'lore-recorder':      { provider: 'gemini', tier: 'lightweight' },
  'character-canon-arbiter': { provider: 'gemini', tier: 'lightweight' },
  'voice-evolution-extract': { provider: 'gemini', tier: 'lightweight' },
  // ═══ Drama — 短剧引擎 ═══
  'drama-idea-enhancer': { provider: 'gemini', tier: 'standard' },
  'drama-goal-generator': { provider: 'gemini', tier: 'standard' },
  'drama-genre-audience-recommender': { provider: 'gemini', tier: 'standard' },
  'drama-genre-portrait': { provider: 'gemini', tier: 'standard' },
  'drama-genre-seed-hints': { provider: 'gemini', tier: 'standard' },
  'drama-genre-profile-ai-generate': { provider: 'gemini', tier: 'standard' },
  'drama-scriptwriter':       { provider: 'gemini', tier: 'creative' },
  'drama-dialogue-coach':     { provider: 'gemini', tier: 'creative' },
  'drama-script-editor':      { provider: 'gemini', tier: 'creative' },
  'drama-hook-crafter':       { provider: 'gemini', tier: 'creative' },
  'drama-storyboard-director': { provider: 'openai', tier: 'creative' },
  'drama-script-reviewer':    { provider: 'openai', tier: 'standard' },
  'drama-series-director':    { provider: 'gemini', tier: 'standard' },
  'drama-seed-analyzer':      { provider: 'gemini', tier: 'standard' },
  'drama-visual-asset-designer': { provider: 'gemini', tier: 'standard' },
  'drama-profiler':           { provider: 'gemini', tier: 'standard' },
  'drama-strategy':           { provider: 'gemini', tier: 'standard' },
  'drama-arc-director':       { provider: 'gemini', tier: 'standard' },
  'drama-episode-director':   { provider: 'gemini', tier: 'standard' },
  'drama-audio-director':     { provider: 'gemini', tier: 'standard' },
  'drama-continuity-guard':   { provider: 'gemini', tier: 'lightweight' },
  'drama-pacing-analyzer':    { provider: 'gemini', tier: 'lightweight' },
  'drama-episode-recorder':   { provider: 'gemini', tier: 'lightweight' },
};

interface LlmCachedConfig {
  providers: Record<LlmProvider, ProviderConfig>;
  fallbackProvider: LlmProvider;
  maxPromptChars: number;
  tracingEnabled: boolean;
  tracingProject: string;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly cfg: LlmCachedConfig;

  constructor(
    private readonly traceLogger: LlmTraceLoggerService,
    private readonly configService: ConfigService,
    private readonly usageLedger: UsageLedgerService,
  ) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const langsmith = (this.configService.get('langsmith') ?? {}) as Record<string, unknown>;

    const geminiCfg = (llm.gemini ?? llm.google ?? {}) as Record<string, unknown>;
    const claudeCfg = (llm.claude ?? {}) as Record<string, unknown>;
    const openaiCfg = (llm.openai ?? {}) as Record<string, unknown>;
    const costGemini = (llm.cost ?? {}) as Record<string, unknown>;
    const costClaude = (claudeCfg.cost ?? {}) as Record<string, unknown>;
    const costOpenai = (openaiCfg.cost ?? {}) as Record<string, unknown>;
    const geminiTiers = (geminiCfg.tiers ?? {}) as Record<string, unknown>;
    const claudeTiers = (claudeCfg.tiers ?? {}) as Record<string, unknown>;
    const openaiTiers = (openaiCfg.tiers ?? {}) as Record<string, unknown>;

    const defaultGeminiModel = String(geminiCfg.model || 'gemini-2.5-pro');
    const defaultOpenaiModel = String(openaiCfg.model || 'gpt-5');

    this.cfg = {
      providers: {
        gemini: {
          apiKey: String(geminiCfg.apiKey || ''),
          baseUrl: geminiCfg.baseUrl ? String(geminiCfg.baseUrl) : undefined,
          models: {
            creative: String(geminiTiers.creative || defaultGeminiModel),
            standard: String(geminiTiers.standard || defaultGeminiModel),
            lightweight: String(geminiTiers.lightweight || defaultGeminiModel),
          },
          costRates: LlmService.parseTierCostRates(costGemini, { inputRateUsdPer1M: 0, outputRateUsdPer1M: 0 }),
          enabled: Boolean(geminiCfg.apiKey),
        },
        claude: {
          apiKey: String(claudeCfg.apiKey || ''),
          baseUrl: claudeCfg.baseUrl ? String(claudeCfg.baseUrl) : undefined,
          models: {
            creative: String(claudeTiers.creative || 'claude-opus-4-6'),
            standard: String(claudeTiers.standard || 'claude-sonnet-4-6'),
            lightweight: String(claudeTiers.lightweight || 'claude-sonnet-4-6'),
          },
          costRates: LlmService.parseTierCostRates(costClaude, { inputRateUsdPer1M: 5, outputRateUsdPer1M: 25 }),
          enabled: Boolean(claudeCfg.apiKey),
        },
        openai: {
          apiKey: String(openaiCfg.apiKey || ''),
          baseUrl: openaiCfg.baseUrl ? String(openaiCfg.baseUrl) : undefined,
          models: {
            creative: String(openaiTiers.creative || defaultOpenaiModel),
            standard: String(openaiTiers.standard || defaultOpenaiModel),
            lightweight: String(openaiTiers.lightweight || defaultOpenaiModel),
          },
          costRates: LlmService.parseTierCostRates(costOpenai, { inputRateUsdPer1M: 2, outputRateUsdPer1M: 10 }),
          enabled: Boolean(openaiCfg.apiKey),
          azure: String(openaiCfg.azure ?? '').toLowerCase() === 'true',
          azureInstanceName: openaiCfg.azureInstanceName ? String(openaiCfg.azureInstanceName) : undefined,
          azureApiVersion: String(openaiCfg.azureApiVersion || '2024-12-01-preview'),
        },
      },
      fallbackProvider: (llm.fallbackProvider as LlmProvider) || 'gemini',
      maxPromptChars: LlmService.num(llm.maxPromptChars, 400_000),
      tracingEnabled: String(langsmith.tracing ?? '').toLowerCase() === 'true',
      tracingProject: String(langsmith.project ?? 'novel-engine'),
    };

    if (this.cfg.tracingEnabled) {
      process.env.LANGSMITH_TRACING = 'true';
      process.env.LANGCHAIN_TRACING_V2 = 'true';
      process.env.LANGSMITH_PROJECT = this.cfg.tracingProject;
      const apiKey = String(langsmith.apiKey ?? '');
      const endpoint = String(langsmith.endpoint ?? 'https://api.smith.langchain.com');
      if (apiKey) process.env.LANGSMITH_API_KEY = apiKey;
      if (endpoint) process.env.LANGSMITH_ENDPOINT = endpoint;
    }

    const ep = Object.entries(this.cfg.providers).filter(([, v]) => v.enabled).map(([k, v]) => v.azure ? `${k}(azure:${v.azureInstanceName})` : k);
    this.logger.log(`LLM providers initialized: [${ep.join(', ')}]${this.cfg.tracingEnabled ? ' | LangSmith tracing ON' : ''}`);
  }

  private static parseTierCostRates(costObj: Record<string, unknown>, fallback: CostRates): Record<ModelTier, CostRates> {
    const tiers: ModelTier[] = ['creative', 'standard', 'lightweight'];
    const globalIn = LlmService.num(costObj.inputUsdPer1M, fallback.inputRateUsdPer1M);
    const globalOut = LlmService.num(costObj.outputUsdPer1M, fallback.outputRateUsdPer1M);
    const result = {} as Record<ModelTier, CostRates>;
    for (const tier of tiers) {
      const tierObj = (costObj[tier] ?? {}) as Record<string, unknown>;
      result[tier] = {
        inputRateUsdPer1M: LlmService.num(tierObj.inputUsdPer1M, globalIn),
        outputRateUsdPer1M: LlmService.num(tierObj.outputUsdPer1M, globalOut),
      };
    }
    return result;
  }

  async generateStructured<T extends ZodTypeAny>(input: StructuredGenerationInput<T>): Promise<z.infer<T>> {
    const temperature = input.temperature ?? 0.6;
    const tags = ['novel-engine', input.taskName, ...(input.tags ?? [])];
    const route = this.resolveRoute(input.taskName);

    this.logger.log(
      `[${input.taskName}] ====== LLM 调用开始 ======\n` +
      `  provider: ${route.provider} | 模型: ${route.model} (tier: ${route.tier}) | 温度: ${temperature}\n` +
      `  metadata: ${JSON.stringify(input.metadata ?? {})}\n  tags: [${tags.join(', ')}]`,
    );
    this.logger.debug(`[${input.taskName}] SYSTEM (${input.systemPrompt.length}c) USER (${input.userPrompt.length}c)`);

    const promptLen = input.systemPrompt.length + input.userPrompt.length;
    if (promptLen > this.cfg.maxPromptChars) {
      const overflow = promptLen - this.cfg.maxPromptChars;
      this.logger.warn(`[${input.taskName}] prompt ${promptLen}c > budget ${this.cfg.maxPromptChars}，截断 userPrompt ${overflow}c`);
      input = { ...input, userPrompt: input.userPrompt.slice(0, Math.max(1000, input.userPrompt.length - overflow)) + '\n[...上下文因超限已截断，请基于已有信息完成任务]' };
    }

    const attempts = this.buildAttemptChain(route);
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        return await this.callModel(input, attempt.provider, attempt.tier, attempt.model, temperature, tags);
      } catch (error) {
        lastError = error;
        const isLast = attempts.indexOf(attempt) >= attempts.length - 1;
        this.logger.warn(`[${input.taskName}] ${attempt.provider}/${attempt.model} failed${isLast ? '' : ', trying next'}: ${(error as Error).message?.slice(0, 200)}`);
      }
    }
    throw lastError;
  }

  private resolveRoute(taskName: string): { provider: LlmProvider; tier: ModelTier; model: string } {
    const route = TASK_ROUTES[taskName] ?? { provider: this.cfg.fallbackProvider, tier: 'standard' as ModelTier };
    const providerCfg = this.cfg.providers[route.provider];
    if (!providerCfg?.enabled) {
      const fb = this.cfg.providers[this.cfg.fallbackProvider];
      return { provider: this.cfg.fallbackProvider, tier: route.tier, model: fb.models[route.tier] };
    }
    return { ...route, model: providerCfg.models[route.tier] };
  }

  private buildAttemptChain(route: { provider: LlmProvider; tier: ModelTier; model: string }) {
    const chain = [{ provider: route.provider, tier: route.tier, model: route.model }];
    if (route.provider !== this.cfg.fallbackProvider && this.cfg.providers[this.cfg.fallbackProvider]?.enabled) {
      const fb = this.cfg.providers[this.cfg.fallbackProvider];
      chain.push({ provider: this.cfg.fallbackProvider, tier: route.tier, model: fb.models[route.tier] });
    }
    return chain;
  }

  private static readonly RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504, 529]);
  private static readonly CALL_MAX_RETRIES = 3;
  private static readonly CALL_BASE_DELAY_MS = 2000;

  private async callModel<T extends ZodTypeAny>(
    input: StructuredGenerationInput<T>, provider: LlmProvider, tier: ModelTier, modelName: string, temperature: number, tags: string[],
  ): Promise<z.infer<T>> {
    const t0 = Date.now();
    const providerCfg = this.cfg.providers[provider];
    const rates = providerCfg.costRates[tier];
    const chatModel = this.createChatModel(provider, providerCfg, modelName, temperature);
    const schema = provider === 'gemini' ? LlmService.sanitizeSchemaForGemini(toJsonSchema(input.schema as any)) : input.schema;
    const structuredModel = (chatModel as any).withStructuredOutput(schema, { includeRaw: true });
    const humanContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: input.userPrompt },
    ];
    if (input.imageUrls?.length) {
      for (const url of input.imageUrls) {
        humanContent.push({ type: 'image_url', image_url: { url } });
      }
    }
    const humanMsg = input.imageUrls?.length
      ? new HumanMessage({ content: humanContent as any })
      : new HumanMessage(input.userPrompt);
    const messages = [new SystemMessage(input.systemPrompt), humanMsg];
    const meta = input.metadata ?? {};
    const traceBase = { taskName: input.taskName, provider, model: modelName, tier, temperature, tags, metadata: meta, input: { system: input.systemPrompt, user: input.userPrompt }, ...(meta.bookId ? { bookId: meta.bookId as string, chapterNumber: meta.chapterNumber as number } : {}), ...(meta.workflowId ? { workflowId: meta.workflowId as string } : {}) };

    let response: unknown;
    let lastErr: unknown;
    let retryCount = 0;
    for (let retry = 0; retry <= LlmService.CALL_MAX_RETRIES; retry++) {
      try {
        const config: RunnableConfig = { runName: input.taskName, tags, metadata: { taskName: input.taskName, provider, model: modelName, tier, ...input.metadata } };
        if (retry === 0 && this.cfg.tracingEnabled) this.logger.log(`[${input.taskName}] LangSmith tracing (project=${this.cfg.tracingProject})`);
        response = await structuredModel.invoke(messages, config);
        if (retry > 0) this.logger.log(`[${input.taskName}] 第${retry}次重试成功 (${provider}/${modelName})`);
        retryCount = retry;
        break;
      } catch (error) {
        lastErr = error;
        retryCount = retry;
        const status = (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.code;
        const errMsg = ((error as Error).message ?? '').toLowerCase();
        const isNetworkError = typeof status === 'string' && /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/i.test(status) || /(timeout|econnreset|etimedout|socket hang up|network|fetch failed)/i.test(errMsg);
        const retryable = LlmService.RETRYABLE_STATUS.has(Number(status)) || isNetworkError;
        if (!retryable || retry >= LlmService.CALL_MAX_RETRIES) {
          this.logger.error(`[${input.taskName}] ====== LLM 调用失败 (${provider}/${modelName}) ====== ${Date.now() - t0}ms\n  错误: ${(error as Error).message}${retry > 0 ? ` (已重试${retry}次)` : ''}`);
          const errUsage = this.extractUsageFromError(error);
          const errTokens = errUsage ?? { prompt: 0, completion: 0, total: 0, source: 'missing' as const };
          const errCost = LlmService.estimateCost(errTokens.prompt, errTokens.completion, rates);
          this.traceLogger.logTrace({ ...traceBase, durationMs: Date.now() - t0, tokens: { prompt: errTokens.prompt, completion: errTokens.completion, total: errTokens.total, source: errTokens.source }, cost: { usd: errCost, inputRatePer1M: rates.inputRateUsdPer1M, outputRatePer1M: rates.outputRateUsdPer1M }, output: null, status: 'error', error: (error as Error).message, retries: retry });
          const errMeta = input.metadata ?? {};
          const errIsDrama = tags.some(t => t.includes('drama'));
          this.usageLedger.record({
            userId: String(errMeta.userId ?? ''),
            module: errIsDrama ? 'drama' : 'novel',
            resourceId: String(errMeta.dramaId ?? errMeta.bookId ?? ''),
            scope: errIsDrama ? (errMeta.episodeNumber ? `episode:${errMeta.episodeNumber}` : 'creation') : (errMeta.chapterNumber ? `chapter:${errMeta.chapterNumber}` : 'creation'),
            action: input.taskName, kind: 'llm', provider, model: modelName,
            tokensIn: errTokens.prompt, tokensOut: errTokens.completion,
            costUsd: errCost, ok: false, durationMs: Date.now() - t0,
          }).catch(() => {});
          throw error;
        }
        const delay = LlmService.CALL_BASE_DELAY_MS * Math.pow(2, retry) * (0.5 + Math.random() * 0.5);
        this.logger.warn(`[${input.taskName}] ${provider}/${modelName} 返回 ${status}，${Math.round(delay)}ms 后第${retry + 1}次重试`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    if (!response) throw lastErr;

    const durationMs = Date.now() - t0;
    const wrapped = this.unwrapResponse<z.infer<T>>(response);
    const usage = this.extractUsage(wrapped.raw, provider);
    const cost = LlmService.estimateCost(usage.promptTokens, usage.completionTokens, rates);

    this.logger.log(
      `[${input.taskName}] ====== LLM 调用完成 (${provider}/${modelName}) ====== ${durationMs}ms\n` +
      `  tokens: in=${usage.promptTokens} out=${usage.completionTokens} total=${usage.totalTokens}\n` +
      `  费率: $${rates.inputRateUsdPer1M}/$${rates.outputRateUsdPer1M} per 1M | 费用: $${cost} (source: ${usage.source})`,
    );
    this.logger.debug(`[${input.taskName}] AI 输出:\n${this.truncate(JSON.stringify(wrapped.parsed, null, 2), 2000)}`);

    this.traceLogger.logTrace({ ...traceBase, durationMs, tokens: { prompt: usage.promptTokens, completion: usage.completionTokens, total: usage.totalTokens, source: usage.source }, cost: { usd: cost, inputRatePer1M: rates.inputRateUsdPer1M, outputRatePer1M: rates.outputRateUsdPer1M }, output: wrapped.parsed, status: wrapped.parsed == null ? 'error' : 'success', error: wrapped.parsed == null ? '结构化输出解析为 null' : undefined, retries: retryCount });

    const isDrama = tags.some(t => t.includes('drama'));
    const mod = isDrama ? 'drama' : 'novel';
    const resourceId = String(meta.dramaId ?? meta.bookId ?? '');
    const scope = isDrama
      ? (meta.episodeNumber ? `episode:${meta.episodeNumber}` : 'creation')
      : (meta.chapterNumber ? `chapter:${meta.chapterNumber}` : 'creation');
    this.usageLedger.record({
      userId: String(meta.userId ?? ''),
      module: mod, resourceId, scope,
      action: input.taskName, kind: 'llm', provider, model: modelName,
      tokensIn: usage.promptTokens, tokensOut: usage.completionTokens,
      costUsd: cost, ok: wrapped.parsed != null, durationMs,
    }).catch(() => {});

    if (wrapped.parsed == null) {
      const err = new Error(`[${input.taskName}] 结构化输出解析为 null (${provider}/${modelName})，模型返回内容无法匹配 schema`);
      (err as any).status = 500;
      throw err;
    }
    return wrapped.parsed;
  }

  private static readonly LLM_TIMEOUT_MS = 180_000; // 3分钟，防止hung连接

  private createChatModel(provider: LlmProvider, cfg: ProviderConfig, model: string, temperature: number) {
    const proxyHeaders = cfg.baseUrl ? { 'User-Agent': 'Mozilla/5.0' } : undefined;
    if (provider === 'claude') {
      return new ChatAnthropic({
        anthropicApiKey: cfg.apiKey, anthropicApiUrl: cfg.baseUrl,
        model, temperature, maxRetries: 0, maxTokens: 16384,
        clientOptions: { timeout: LlmService.LLM_TIMEOUT_MS, ...(proxyHeaders ? { defaultHeaders: proxyHeaders } : {}) },
      });
    }
    if (provider === 'openai') {
      if (cfg.azure && cfg.azureInstanceName) {
        return new AzureChatOpenAI({
          azureOpenAIApiKey: cfg.apiKey,
          azureOpenAIApiInstanceName: cfg.azureInstanceName,
          azureOpenAIApiDeploymentName: model,
          azureOpenAIApiVersion: cfg.azureApiVersion || '2024-12-01-preview',
          temperature, maxRetries: 0, maxTokens: 16384,
        });
      }
      return new ChatOpenAIResponses({
        apiKey: cfg.apiKey, model, temperature, maxRetries: 0, timeout: LlmService.LLM_TIMEOUT_MS,
        configuration: {
          baseURL: cfg.baseUrl,
          ...(proxyHeaders ? { defaultHeaders: proxyHeaders } : {}),
        },
      });
    }
    return new ChatGoogleGenerativeAI({
      apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model, temperature, maxRetries: 0,
      ...(proxyHeaders ? { customHeaders: proxyHeaders } : {}),
    } as any);
  }

  // ═══ Token提取 — 兼容Gemini/Claude/OpenAI三种response格式 ═══

  private extractUsage(raw: Record<string, unknown> | null, _provider: LlmProvider): TokenUsageExtraction {
    if (!raw) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'missing' };
    const um = this.toRecord(raw.usage_metadata);
    if (um) {
      const p = this.toInt(um.input_tokens), c = this.toInt(um.output_tokens);
      return { promptTokens: p, completionTokens: c, totalTokens: this.toInt(um.total_tokens) || p + c, source: 'usage_metadata' };
    }
    const rm = this.toRecord(raw.response_metadata);
    if (rm) {
      const u = this.toRecord(rm.usage) ?? this.toRecord(rm.tokenUsage) ?? this.toRecord(rm.usage_metadata);
      if (u) {
        const p = this.toInt(u.input_tokens) || this.toInt(u.prompt_tokens) || this.toInt(u.promptTokens);
        const c = this.toInt(u.output_tokens) || this.toInt(u.completion_tokens) || this.toInt(u.completionTokens);
        return { promptTokens: p, completionTokens: c, totalTokens: this.toInt(u.total_tokens) || this.toInt(u.totalTokens) || p + c, source: 'response_metadata' };
      }
    }
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'missing' };
  }

  // ═══ Schema清理（仅Gemini需要，Claude/OpenAI直传Zod） ═══

  private static readonly GEMINI_UNSUPPORTED_KEYS = new Set([
    'additionalProperties', '$schema', 'strict', 'default', 'not', 'if', 'then', 'else',
    'patternProperties', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties',
    'unevaluatedItems', 'contentEncoding', 'contentMediaType', 'uniqueItems',
    '$id', '$ref', '$defs', 'definitions', '$anchor', '$dynamicRef', '$dynamicAnchor',
    'prefixItems', '$comment', 'examples', 'deprecated', 'readOnly', 'writeOnly',
    'minItems', 'maxItems', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'pattern', // Gemini structured output 不支持数值/数组/字符串约束
  ]);

  static sanitizeSchemaForGemini(obj: unknown): Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) return obj as Record<string, unknown>;
    const o = { ...obj } as Record<string, unknown>;
    for (const k of LlmService.GEMINI_UNSUPPORTED_KEYS) delete o[k];
    if ('exclusiveMinimum' in o) { delete o['exclusiveMinimum']; }
    if ('exclusiveMaximum' in o) { delete o['exclusiveMaximum']; }
    if (Array.isArray(o['type'])) { const types = (o['type'] as string[]).filter((t) => t !== 'null'); o['type'] = types[0] ?? 'string'; o['nullable'] = true; }
    const isNullLike = (v: Record<string, unknown>) => v['type'] === 'null' || (Object.keys(v).length <= 1 && 'not' in v) || Object.keys(v).length === 0; // { "not": {} } 来自 Zod .optional()
    const collapseUnion = (key: 'anyOf' | 'oneOf') => {
      if (!Array.isArray(o[key])) return;
      const vs = o[key] as Record<string, unknown>[];
      const real = vs.filter((v) => !isNullLike(v)), hadNull = real.length < vs.length;
      if (real.length <= 1) { if (real.length === 1) Object.assign(o, LlmService.sanitizeSchemaForGemini(real[0])); else { o['type'] = 'string'; } if (hadNull) o['nullable'] = true; delete o[key]; }
      else { o[key] = real.map((v) => LlmService.sanitizeSchemaForGemini(v)); }
    };
    collapseUnion('anyOf');
    collapseUnion('oneOf');
    if (o['const'] !== undefined) { o['enum'] = [o['const']]; delete o['const']; }
    for (const key of Object.keys(o)) {
      if (key === 'anyOf' || key === 'oneOf' || key === 'enum') continue;
      if (Array.isArray(o[key])) o[key] = (o[key] as unknown[]).map((item) => LlmService.sanitizeSchemaForGemini(item));
      else if (typeof o[key] === 'object' && o[key] !== null) o[key] = LlmService.sanitizeSchemaForGemini(o[key]);
    }
    // Gemini 要求所有 properties 必须列入 required；缺失字段标记 nullable
    if (o['type'] === 'object' && typeof o['properties'] === 'object' && o['properties'] !== null) {
      const props = o['properties'] as Record<string, Record<string, unknown>>;
      const keys = Object.keys(props);
      const cur = new Set(Array.isArray(o['required']) ? o['required'] as string[] : []);
      for (const k of keys) { if (!cur.has(k)) props[k] = { ...props[k], nullable: true }; }
      o['required'] = keys;
    }
    return o;
  }

  // ═══ 工具方法 ═══

  static estimateCost(promptTokens: number, completionTokens: number, rates: CostRates): number {
    return Number(((promptTokens / 1e6) * rates.inputRateUsdPer1M + (completionTokens / 1e6) * rates.outputRateUsdPer1M).toFixed(8));
  }

  private unwrapResponse<T>(response: unknown): { parsed: T; raw: Record<string, unknown> | null } {
    if (this.isRecord(response) && 'parsed' in response) return { parsed: response.parsed as T, raw: this.isRecord(response.raw) ? response.raw as Record<string, unknown> : null };
    return { parsed: response as T, raw: null };
  }

  private static num(value: unknown, fallback: number): number { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : fallback; }
  private toInt(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }
  private isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null; }
  private toRecord(v: unknown): Record<string, unknown> | null { return this.isRecord(v) ? v : null; }
  private truncate(text: string, maxLen: number): string { return text.length <= maxLen ? text : text.slice(0, maxLen) + `\n... [截断，共 ${text.length} 字符]`; }

  /** 尝试从错误对象中提取 token 用量（部分 API 即使返回错误也携带 usage） */
  private extractUsageFromError(error: unknown): { prompt: number; completion: number; total: number; source: string } | null {
    const e = error as Record<string, unknown> | undefined;
    if (!e) return null;
    const candidates = [
      this.toRecord(e.response), this.toRecord(e.error), this.toRecord(e.data),
      this.toRecord((e.rawError as Record<string, unknown>)?.response),
      this.toRecord((e.cause as Record<string, unknown>)?.response),
    ].filter(Boolean) as Record<string, unknown>[];
    for (const resp of candidates) {
      const usage = this.toRecord(resp.usage) ?? this.toRecord(resp.usage_metadata) ?? this.toRecord(resp.tokenUsage);
      if (!usage) continue;
      const p = this.toInt(usage.input_tokens) || this.toInt(usage.prompt_tokens) || this.toInt(usage.promptTokens);
      const c = this.toInt(usage.output_tokens) || this.toInt(usage.completion_tokens) || this.toInt(usage.completionTokens);
      if (p + c > 0) return { prompt: p, completion: c, total: p + c, source: 'error_response' };
    }
    return null;
  }
}
