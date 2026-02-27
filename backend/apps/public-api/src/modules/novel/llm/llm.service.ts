/** 多Provider LLM网关 — 支持 Gemini + Claude，按任务自动路由最优模型，per-tier精确计费 */
import { Injectable, Logger } from '@nestjs/common';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { z, ZodTypeAny } from 'zod';
import { LlmUsageTrackerService } from './llm-usage-tracker.service';
import { ConfigService } from '@packages/modules';

export type LlmProvider = 'gemini' | 'claude';
export type ModelTier = 'creative' | 'standard' | 'lightweight';

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

interface CostRates { inputRateUsdPer1M: number; outputRateUsdPer1M: number; }

interface ProviderConfig {
  apiKey: string;
  baseUrl?: string; // Claude代理地址
  models: Record<ModelTier, string>;
  costRates: Record<ModelTier, CostRates>; // 按tier区分费率（Opus≠Sonnet）
  enabled: boolean;
}

export interface TaskRoute { provider: LlmProvider; tier: ModelTier; }

/**
 * 任务→模型路由表
 * Claude Opus: 读者可见的创作内容（写作/编辑/缝合）
 * Claude Sonnet: 需要深度推理的规划/审核/分析
 * Gemini: 结构化数据提取/轻量检查（成本最低、JSON Schema原生支持）
 */
const TASK_ROUTES: Record<string, TaskRoute> = {
  // ═══ Claude Opus — 文学创作（读者直接看到的内容） ═══
  'creative-writer':    { provider: 'claude', tier: 'creative' },
  'scene-writer':       { provider: 'claude', tier: 'creative' },
  'scene-stitcher':     { provider: 'claude', tier: 'creative' },
  'chapter-editor':     { provider: 'claude', tier: 'creative' },
  'hook-crafter':       { provider: 'claude', tier: 'creative' },
  'draft-writer':       { provider: 'claude', tier: 'creative' },
  'style-director':     { provider: 'claude', tier: 'creative' },
  'patch-rewriter':     { provider: 'claude', tier: 'creative' },
  // ═══ Claude Sonnet — 规划/审核/分析（需要深度推理） ═══
  'seed-analyzer':      { provider: 'claude', tier: 'standard' },
  'arc-director':       { provider: 'claude', tier: 'standard' },
  'chapter-intent':     { provider: 'claude', tier: 'standard' },
  'scene-planner':      { provider: 'claude', tier: 'standard' },
  'chapter-reviewer':   { provider: 'claude', tier: 'standard' },
  'bible-crystallization': { provider: 'claude', tier: 'standard' },
  'outline-revision':   { provider: 'claude', tier: 'standard' },
  'volume-director':    { provider: 'claude', tier: 'standard' },
  'volume-foreshadowing': { provider: 'claude', tier: 'standard' },
  'reader-pulse-analyzer': { provider: 'claude', tier: 'standard' },
  'consistency-audit':  { provider: 'claude', tier: 'standard' },
  'editor-in-chief':    { provider: 'claude', tier: 'standard' },
  'ip-bible-architect': { provider: 'claude', tier: 'standard' },
  'cast-bootstrap':     { provider: 'claude', tier: 'standard' },
  'arc-architect':      { provider: 'claude', tier: 'standard' },
  'arc-planning':       { provider: 'claude', tier: 'standard' },
  'character-voice-coach': { provider: 'claude', tier: 'standard' },
  // ═══ Gemini — 结构化提取/轻量任务（成本最低） ═══
  'text-analyzer':      { provider: 'gemini', tier: 'lightweight' },
  'narrative-extractor': { provider: 'gemini', tier: 'lightweight' },
  'world-extractor':    { provider: 'gemini', tier: 'lightweight' },
  'chapter-recorder':   { provider: 'gemini', tier: 'lightweight' },
  'canon-arbitration':  { provider: 'gemini', tier: 'lightweight' },
  'thread-health-check': { provider: 'gemini', tier: 'lightweight' },
  'style-anchoring':    { provider: 'gemini', tier: 'lightweight' },
  'location-sensory-extract': { provider: 'gemini', tier: 'lightweight' },
  'item-sensory-extract': { provider: 'gemini', tier: 'lightweight' },
  'pacing-analyzer':    { provider: 'gemini', tier: 'standard' },
  'continuity-guard':   { provider: 'gemini', tier: 'standard' },
  'prompt-profiler':    { provider: 'gemini', tier: 'standard' },
  'chapter-contract-manager': { provider: 'gemini', tier: 'standard' },
  'scene-designer':     { provider: 'gemini', tier: 'standard' },
  'continuity-auditor': { provider: 'gemini', tier: 'standard' },
  'reader-jury':        { provider: 'gemini', tier: 'standard' },
  'plot-economy-planner': { provider: 'gemini', tier: 'lightweight' },
  'lore-recorder':      { provider: 'gemini', tier: 'lightweight' },
  'character-canon-arbiter': { provider: 'gemini', tier: 'lightweight' },
  'retrospective-learner': { provider: 'gemini', tier: 'standard' },
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
    private readonly usageTracker: LlmUsageTrackerService,
    private readonly configService: ConfigService,
  ) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const langchain = (this.configService.get('langchain') ?? {}) as Record<string, unknown>;
    const langsmith = (this.configService.get('langsmith') ?? {}) as Record<string, unknown>;

    const geminiCfg = (llm.gemini ?? llm.google ?? {}) as Record<string, unknown>;
    const claudeCfg = (llm.claude ?? {}) as Record<string, unknown>;
    const costGemini = (llm.cost ?? {}) as Record<string, unknown>;
    const costClaude = (claudeCfg.cost ?? {}) as Record<string, unknown>;
    const geminiTiers = (llm.tiers ?? {}) as Record<string, unknown>;
    const claudeTiers = (claudeCfg.tiers ?? {}) as Record<string, unknown>;

    const defaultGeminiModel = String(geminiCfg.model || 'gemini-2.5-pro');

    this.cfg = {
      providers: {
        gemini: {
          apiKey: String(geminiCfg.apiKey || ''),
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
            creative: String(claudeTiers.creative || 'claude-opus-4-20250514'),
            standard: String(claudeTiers.standard || 'claude-sonnet-4-20250514'),
            lightweight: String(claudeTiers.lightweight || 'claude-sonnet-4-20250514'),
          },
          costRates: LlmService.parseTierCostRates(costClaude, { inputRateUsdPer1M: 5, outputRateUsdPer1M: 25 }),
          enabled: Boolean(claudeCfg.apiKey),
        },
      },
      fallbackProvider: (llm.fallbackProvider as LlmProvider) || 'gemini',
      maxPromptChars: LlmService.num(llm.maxPromptChars, 400_000),
      tracingEnabled: String(langchain.tracingV2 ?? '').toLowerCase() === 'true' || Boolean(langsmith.tracing),
      tracingProject: String(langchain.project ?? 'novel-engine'),
    };

    const ep = Object.entries(this.cfg.providers).filter(([, v]) => v.enabled).map(([k]) => k);
    this.logger.log(`LLM providers initialized: [${ep.join(', ')}]`);
  }

  /** 解析tier级费率，支持 cost.creative.inputUsdPer1M 和 cost.inputUsdPer1M 两种格式 */
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
    if (promptLen > this.cfg.maxPromptChars) this.logger.warn(`[${input.taskName}] prompt ${promptLen}c > budget ${this.cfg.maxPromptChars}`);

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

  private static readonly RETRYABLE_STATUS = new Set([403, 408, 429, 500, 502, 503, 504, 529]); // SDK不重试403，这里补上代理端瞬态拦截
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
    const messages = [new SystemMessage(input.systemPrompt), new HumanMessage(input.userPrompt)];

    let response: unknown;
    let lastErr: unknown;
    for (let retry = 0; retry <= LlmService.CALL_MAX_RETRIES; retry++) {
      try {
        const config: RunnableConfig = { runName: input.taskName, tags, metadata: { taskName: input.taskName, provider, model: modelName, tier, ...input.metadata } };
        if (retry === 0 && this.cfg.tracingEnabled) this.logger.log(`[${input.taskName}] LangSmith tracing (project=${this.cfg.tracingProject})`);
        response = await structuredModel.invoke(messages, config);
        if (retry > 0) this.logger.log(`[${input.taskName}] 第${retry}次重试成功 (${provider}/${modelName})`);
        break;
      } catch (error) {
        lastErr = error;
        const status = (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.code;
        const retryable = LlmService.RETRYABLE_STATUS.has(Number(status));
        if (!retryable || retry >= LlmService.CALL_MAX_RETRIES) {
          this.logger.error(`[${input.taskName}] ====== LLM 调用失败 (${provider}/${modelName}) ====== ${Date.now() - t0}ms\n  错误: ${(error as Error).message}${retry > 0 ? ` (已重试${retry}次)` : ''}`);
          throw error;
        }
        const delay = LlmService.CALL_BASE_DELAY_MS * Math.pow(2, retry) * (0.5 + Math.random() * 0.5); // 指数退避+抖动
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

    this.usageTracker.recordCall({
      taskName: input.taskName, model: modelName, provider, tier,
      startedAt: new Date(t0).toISOString(), finishedAt: new Date().toISOString(), durationMs,
      promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens,
      estimatedCostUsd: cost, inputRateUsdPer1M: rates.inputRateUsdPer1M,
      outputRateUsdPer1M: rates.outputRateUsdPer1M, tokenSource: usage.source, temperature, tags,
    });
    return wrapped.parsed;
  }

  private createChatModel(provider: LlmProvider, cfg: ProviderConfig, model: string, temperature: number) {
    if (provider === 'claude') {
      return new ChatAnthropic({
        anthropicApiKey: cfg.apiKey,
        anthropicApiUrl: cfg.baseUrl,
        model, temperature, maxRetries: 3, maxTokens: 16384,
        clientOptions: cfg.baseUrl ? { defaultHeaders: { 'User-Agent': 'Mozilla/5.0' } } : undefined, // 代理端Cloudflare会拦截SDK默认UA
      });
    }
    return new ChatGoogleGenerativeAI({ apiKey: cfg.apiKey, model, temperature, maxRetries: 3 });
  }

  // ═══ Token提取 — 兼容Gemini和Claude两种response格式 ═══

  private extractUsage(raw: Record<string, unknown> | null, provider: LlmProvider): TokenUsageExtraction {
    if (!raw) return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'missing' };
    // Claude: usage_metadata.input_tokens / output_tokens（LangChain统一格式）
    // Gemini: usage_metadata.input_tokens / output_tokens
    const um = this.toRecord(raw.usage_metadata);
    if (um) {
      const p = this.toInt(um.input_tokens), c = this.toInt(um.output_tokens);
      return { promptTokens: p, completionTokens: c, totalTokens: this.toInt(um.total_tokens) || p + c, source: 'usage_metadata' };
    }
    // fallback: response_metadata（部分LangChain版本）
    const rm = this.toRecord(raw.response_metadata);
    if (rm) {
      // Claude原生: rm.usage.input_tokens / output_tokens
      const u = this.toRecord(rm.usage) ?? this.toRecord(rm.tokenUsage) ?? this.toRecord(rm.usage_metadata);
      if (u) {
        const p = this.toInt(u.input_tokens) || this.toInt(u.prompt_tokens) || this.toInt(u.promptTokens);
        const c = this.toInt(u.output_tokens) || this.toInt(u.completion_tokens) || this.toInt(u.completionTokens);
        return { promptTokens: p, completionTokens: c, totalTokens: this.toInt(u.total_tokens) || this.toInt(u.totalTokens) || p + c, source: 'response_metadata' };
      }
    }
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'missing' };
  }

  // ═══ Schema清理（仅Gemini需要） ═══

  private static readonly GEMINI_UNSUPPORTED_KEYS = new Set([
    'additionalProperties', '$schema', 'strict', 'default', 'not', 'if', 'then', 'else',
    'patternProperties', 'dependentRequired', 'dependentSchemas', 'unevaluatedProperties',
    'unevaluatedItems', 'contentEncoding', 'contentMediaType', 'uniqueItems',
    '$id', '$ref', '$defs', 'definitions', '$anchor', '$dynamicRef', '$dynamicAnchor',
    'prefixItems', '$comment', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  ]);

  static sanitizeSchemaForGemini(obj: unknown): Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) return obj as Record<string, unknown>;
    const o = { ...obj } as Record<string, unknown>;
    for (const k of LlmService.GEMINI_UNSUPPORTED_KEYS) delete o[k];
    if ('exclusiveMinimum' in o) { const v = o['exclusiveMinimum'] as number; o['minimum'] = Number.isInteger(v) ? v + 1 : v; delete o['exclusiveMinimum']; }
    if ('exclusiveMaximum' in o) { const v = o['exclusiveMaximum'] as number; o['maximum'] = Number.isInteger(v) ? v - 1 : v; delete o['exclusiveMaximum']; }
    if ('minItems' in o && typeof o['minItems'] === 'number' && o['minItems'] <= 0) delete o['minItems'];
    if ('minLength' in o && typeof o['minLength'] === 'number' && o['minLength'] <= 0) delete o['minLength'];
    if (Array.isArray(o['type'])) { const types = (o['type'] as string[]).filter((t) => t !== 'null'); o['type'] = types[0] ?? 'string'; o['nullable'] = true; }
    if (Array.isArray(o['anyOf'])) {
      const vs = o['anyOf'] as Record<string, unknown>[], nonNull = vs.filter((v) => v['type'] !== 'null');
      if (nonNull.length === 1 && nonNull.length < vs.length) { Object.assign(o, LlmService.sanitizeSchemaForGemini(nonNull[0])); o['nullable'] = true; delete o['anyOf']; }
      else { o['anyOf'] = vs.map((v) => LlmService.sanitizeSchemaForGemini(v)); }
    }
    if (Array.isArray(o['oneOf'])) {
      const vs = o['oneOf'] as Record<string, unknown>[], nonNull = vs.filter((v) => v['type'] !== 'null');
      if (nonNull.length === 1 && nonNull.length < vs.length) { Object.assign(o, LlmService.sanitizeSchemaForGemini(nonNull[0])); o['nullable'] = true; delete o['oneOf']; }
      else { o['oneOf'] = vs.map((v) => LlmService.sanitizeSchemaForGemini(v)); }
    }
    if (o['const'] !== undefined) { o['enum'] = [o['const']]; delete o['const']; }
    for (const key of Object.keys(o)) {
      if (key === 'anyOf' || key === 'oneOf' || key === 'enum') continue;
      if (Array.isArray(o[key])) o[key] = (o[key] as unknown[]).map((item) => LlmService.sanitizeSchemaForGemini(item));
      else if (typeof o[key] === 'object' && o[key] !== null) o[key] = LlmService.sanitizeSchemaForGemini(o[key]);
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
}
