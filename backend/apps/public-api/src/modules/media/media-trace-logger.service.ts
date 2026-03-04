/** T2I/T2V 媒体生成追踪日志 — JSONL 格式，用于流程回溯与提示词调优 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import * as fs from 'fs';
import * as path from 'path';

export interface MediaTraceEntry {
  traceId: string;
  timestamp: string;
  taskType: 't2i' | 't2v';
  provider: string;
  model: string;
  durationMs: number;
  dramaId?: string;
  assetType?: string;
  refId?: string;
  input: { prompt: string; size?: string; count?: number; referenceImages?: number }; // referenceImages=参考图数量
  output: { imageUrls?: string[]; videoUrl?: string };
  status: 'success' | 'error';
  error?: string;
  jobId?: string;
}

@Injectable()
export class MediaTraceLoggerService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaTraceLoggerService.name);
  private enabled = false;
  private logDir = './logs';
  private stream: fs.WriteStream | null = null;

  constructor(private readonly configService: ConfigService) {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const trace = (media.trace ?? {}) as Record<string, unknown>;
    this.enabled = String(trace.enabled ?? 'true').toLowerCase() === 'true';
    this.logDir = String(trace.logDir || './logs');
    if (this.enabled) {
      fs.mkdirSync(this.logDir, { recursive: true });
      this.stream = fs.createWriteStream(path.join(this.logDir, 'llm-drama.jsonl'), { flags: 'a' });
      this.stream.on('error', (e) => this.logger.error(`追踪日志写入异常: ${e.message}`));
      this.logger.log(`T2I追踪日志已启用 → ${this.logDir}/llm-drama.jsonl`);
    }
  }

  logT2i(entry: Omit<MediaTraceEntry, 'traceId' | 'timestamp' | 'taskType'>): void {
    if (!this.enabled || !this.stream) return;
    const full: MediaTraceEntry = {
      traceId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      taskType: 't2i',
      ...entry,
    };
    this.stream.write(JSON.stringify(full) + '\n');
  }

  onModuleDestroy(): void {
    if (this.stream) { this.stream.end(); this.stream = null; }
  }
}
