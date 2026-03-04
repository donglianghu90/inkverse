/** LLM调用全链路追踪日志 — JSONL格式按日写入独立文件，用于流程回溯、提示词调优、问题排查 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import * as fs from 'fs';
import * as path from 'path';

export interface LlmTraceEntry {
  traceId: string;
  timestamp: string;
  workflowId?: string;
  bookId?: string;
  chapterNumber?: number;
  callSequence?: number;
  taskName: string;
  provider: string;
  model: string;
  tier: string;
  temperature: number;
  durationMs: number;
  tokens: { prompt: number; completion: number; total: number; source: string };
  cost: { usd: number; inputRatePer1M: number; outputRatePer1M: number };
  input: { system: string; user: string };
  output: unknown;
  tags: string[];
  metadata: Record<string, unknown>;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  retries: number;
}

interface TraceConfig { enabled: boolean; logDir: string; maxPromptChars: number; maxOutputChars: number; }

@Injectable()
export class LlmTraceLoggerService implements OnModuleDestroy {
  private readonly logger = new Logger(LlmTraceLoggerService.name);
  private readonly cfg: TraceConfig;
  private seq = 0;
  private stream: fs.WriteStream | null = null;
  private streamDate = '';
  private dramaStream: fs.WriteStream | null = null; // 短剧专用日志流 → logs/llm-drama.jsonl

  constructor(private readonly configService: ConfigService) {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, unknown>;
    const trace = (llm.trace ?? {}) as Record<string, unknown>;
    this.cfg = {
      enabled: String(trace.enabled ?? 'true').toLowerCase() === 'true',
      logDir: String(trace.logDir || './logs'),
      maxPromptChars: Number(trace.maxPromptChars) || 0,
      maxOutputChars: Number(trace.maxOutputChars) || 0,
    };
    if (this.cfg.enabled) {
      fs.mkdirSync(this.cfg.logDir, { recursive: true });
      this.logger.log(`LLM追踪日志已启用 → ${this.cfg.logDir}/llm-trace-*.jsonl | 短剧日志 → ${this.cfg.logDir}/llm-drama.jsonl`);
    }
  }

  private getStream(): fs.WriteStream { // 按日复用 WriteStream，避免每次调用都打开/关闭文件
    const tag = this.dateTag();
    if (this.stream && this.streamDate === tag) return this.stream;
    if (this.stream) this.stream.end();
    this.stream = fs.createWriteStream(path.join(this.cfg.logDir, `llm-trace-${tag}.jsonl`), { flags: 'a' });
    this.stream.on('error', (e) => this.logger.error(`追踪日志写入流异常: ${e.message}`));
    this.streamDate = tag;
    return this.stream;
  }

  private getDramaStream(): fs.WriteStream {
    if (this.dramaStream) return this.dramaStream;
    this.dramaStream = fs.createWriteStream(path.join(this.cfg.logDir, 'llm-drama.jsonl'), { flags: 'a' });
    this.dramaStream.on('error', (e) => this.logger.error(`短剧日志写入流异常: ${e.message}`));
    return this.dramaStream;
  }

  private isDramaTrace(entry: { taskName: string; tags?: string[] }): boolean {
    return entry.taskName.includes('drama') || (entry.tags ?? []).some(t => t.includes('drama'));
  }

  logTrace(entry: Omit<LlmTraceEntry, 'traceId' | 'timestamp'>): void {
    if (!this.cfg.enabled) return;
    const full: LlmTraceEntry = {
      traceId: `${Date.now()}-${++this.seq}`,
      timestamp: new Date().toISOString(),
      ...entry,
      input: { system: this.clip(entry.input.system, this.cfg.maxPromptChars), user: this.clip(entry.input.user, this.cfg.maxPromptChars) },
      output: this.clipOutput(entry.output, this.cfg.maxOutputChars),
    };
    this.getStream().write(JSON.stringify(full) + '\n');
    if (this.isDramaTrace(entry)) this.getDramaStream().write(JSON.stringify(full) + '\n');
  }

  /** 记录被跳过的工作流步骤，便于排查"未执行"与"失败"的区别 */
  logSkipped(taskName: string, reason: string, meta?: { bookId?: string; chapterNumber?: number }): void {
    if (!this.cfg.enabled) return;
    const entry: LlmTraceEntry = {
      traceId: `${Date.now()}-${++this.seq}`, timestamp: new Date().toISOString(),
      taskName, provider: 'none', model: 'none', tier: 'none', temperature: 0, durationMs: 0,
      tokens: { prompt: 0, completion: 0, total: 0, source: 'skipped' },
      cost: { usd: 0, inputRatePer1M: 0, outputRatePer1M: 0 },
      input: { system: '', user: '' }, output: null,
      tags: ['skipped'], metadata: { reason, ...meta }, status: 'skipped', retries: 0,
    };
    this.getStream().write(JSON.stringify(entry) + '\n');
  }

  /** 记录非LLM的工作流生命周期事件（前置步骤失败、重试等），持久化到同一JSONL文件 */
  logWorkflowEvent(evt: { bookId?: string; chapterNumber?: number; step: string; status: 'error' | 'ok'; error?: string; meta?: Record<string, unknown> }): void {
    if (!this.cfg.enabled) return;
    const entry: LlmTraceEntry = {
      traceId: `${Date.now()}-${++this.seq}`, timestamp: new Date().toISOString(),
      bookId: evt.bookId, chapterNumber: evt.chapterNumber,
      taskName: `workflow:${evt.step}`, provider: 'system', model: 'none', tier: 'none', temperature: 0, durationMs: 0,
      tokens: { prompt: 0, completion: 0, total: 0, source: 'system' },
      cost: { usd: 0, inputRatePer1M: 0, outputRatePer1M: 0 },
      input: { system: '', user: '' }, output: evt.meta ?? null,
      tags: ['workflow-event', evt.step], metadata: evt.meta ?? {},
      status: evt.status === 'ok' ? 'success' : 'error', error: evt.error, retries: 0,
    };
    this.getStream().write(JSON.stringify(entry) + '\n');
  }

  /** 短剧专用：记录创建/逐集流程的每一步（含非LLM步骤），输出到 logs/llm-drama.jsonl */
  logDramaWorkflowEvent(evt: { dramaId: string; phase: 'create' | 'episode'; step: string; status: 'ok' | 'error'; episodeNumber?: number; message?: string; error?: string; meta?: Record<string, unknown> }): void {
    if (!this.cfg.enabled) return;
    const entry: LlmTraceEntry = {
      traceId: `${Date.now()}-${++this.seq}`, timestamp: new Date().toISOString(),
      workflowId: evt.dramaId, metadata: { dramaId: evt.dramaId, phase: evt.phase, step: evt.step, episodeNumber: evt.episodeNumber, message: evt.message, ...evt.meta },
      taskName: `drama:${evt.phase}:${evt.step}`, provider: 'system', model: 'none', tier: 'none', temperature: 0, durationMs: 0,
      tokens: { prompt: 0, completion: 0, total: 0, source: 'system' },
      cost: { usd: 0, inputRatePer1M: 0, outputRatePer1M: 0 },
      input: { system: '', user: '' }, output: evt.meta ?? null,
      tags: ['drama-workflow', evt.phase, evt.step], status: evt.status === 'ok' ? 'success' : 'error', error: evt.error, retries: 0,
    };
    this.getDramaStream().write(JSON.stringify(entry) + '\n');
  }

  onModuleDestroy(): void {
    if (this.stream) { this.stream.end(); this.stream = null; }
    if (this.dramaStream) { this.dramaStream.end(); this.dramaStream = null; }
  }

  private dateTag(): string { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  private clip(s: string, max: number): string { return max > 0 && s.length > max ? s.slice(0, max) + `...[截断,共${s.length}字符]` : s; }
  private clipOutput(obj: unknown, max: number): unknown {
    if (max <= 0 || obj == null) return obj;
    const s = JSON.stringify(obj);
    return s.length > max ? s.slice(0, max) + `...[截断,共${s.length}字符]` : obj;
  }
}
