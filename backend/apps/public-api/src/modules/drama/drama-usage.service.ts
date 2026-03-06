import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@packages/modules';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Repository } from 'typeorm';
import { EpisodeEntity } from './entities/episode.entity';

interface UsageBucket {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  llmCostUsd: number;
  imageCalls: number;
  imageCostUsd: number;
  videoCalls: number;
  videoCostUsd: number;
  apiSuccessCalls: number;
  apiFailedCalls: number;
}

interface WorkflowWindow {
  phase: 'create' | 'episode';
  episodeNumber?: number;
  step: string;
  startAt: number;
}

interface StepUsage extends UsageBucket { step: string }
interface EpisodeUsage extends UsageBucket { episodeNumber: number; steps: StepUsage[] }

interface DramaUsageResponse {
  dramaId: string;
  currency: 'USD';
  creation: UsageBucket & { steps: StepUsage[] };
  episodes: EpisodeUsage[];
  total: UsageBucket;
}

type JsonRecord = Record<string, any>;

function emptyBucket(): UsageBucket {
  return {
    llmCalls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    llmCostUsd: 0,
    imageCalls: 0,
    imageCostUsd: 0,
    videoCalls: 0,
    videoCostUsd: 0,
    apiSuccessCalls: 0,
    apiFailedCalls: 0,
  };
}

function round6(v: number): number {
  return Number(v.toFixed(6));
}

@Injectable()
export class DramaUsageService {
  constructor(
    @InjectRepository(EpisodeEntity) private readonly episodeRepo: Repository<EpisodeEntity>,
    private readonly configService: ConfigService,
  ) {}

  async getDramaUsage(dramaId: string): Promise<DramaUsageResponse> {
    const logPath = this.resolveDramaLogPath();
    if (!fs.existsSync(logPath)) {
      return {
        dramaId,
        currency: 'USD',
        creation: { ...emptyBucket(), steps: [] },
        episodes: [],
        total: emptyBucket(),
      };
    }

    const shotEpisodeMap = await this.buildShotEpisodeMap(dramaId);
    const imageUnitUsd = this.toNumber(this.configService.get('media.cost.imageUsdPerCall'));
    const videoUnitUsd = this.toNumber(this.configService.get('media.cost.videoUsdPerCall'));

    const creationTotal = emptyBucket();
    const total = emptyBucket();
    const creationSteps = new Map<string, UsageBucket>();
    const episodeSteps = new Map<number, Map<string, UsageBucket>>();
    const episodeTotals = new Map<number, UsageBucket>();
    const activeWindows: WorkflowWindow[] = [];

    const rl = readline.createInterface({
      input: fs.createReadStream(logPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const text = line?.trim();
      if (!text) continue;
      let entry: JsonRecord;
      try {
        entry = JSON.parse(text);
      } catch {
        continue;
      }

      const ts = Date.parse(String(entry.timestamp ?? ''));
      if (!Number.isFinite(ts)) continue;

      this.updateWindows(activeWindows, entry, dramaId, ts);

      const mediaDramaId = String(entry.dramaId ?? '');
      const isMediaEntry = typeof entry.taskType === 'string';
      if (isMediaEntry && mediaDramaId === dramaId) {
        const assetType = String(entry.assetType ?? '');
        const refId = String(entry.refId ?? '');
        const status = String(entry.status ?? '').toLowerCase();
        const isImage = entry.taskType === 't2i';
        const isVideo = entry.taskType === 't2v';
        const unitCount = Math.max(1, this.toNumber(entry?.input?.count, 1));

        let targetPhase: 'create' | 'episode' = 'create';
        let targetEpisode: number | undefined;
        let step = assetType || String(entry.taskType);

        if (assetType.startsWith('shot_')) {
          const hit = shotEpisodeMap.get(refId) ?? shotEpisodeMap.get(refId.replace(/_last$/, ''));
          if (typeof hit === 'number') {
            targetPhase = 'episode';
            targetEpisode = hit;
          }
        }

        const bucket = this.pickStepBucket(targetPhase, targetEpisode, step, creationSteps, episodeSteps);
        const totalBucket = this.pickTotalBucket(targetPhase, targetEpisode, creationTotal, episodeTotals);
        if (isImage) {
          const delta = unitCount * imageUnitUsd;
          bucket.imageCalls += unitCount;
          totalBucket.imageCalls += unitCount;
          bucket.imageCostUsd += delta;
          totalBucket.imageCostUsd += delta;
        }
        if (isVideo) {
          const delta = unitCount * videoUnitUsd;
          bucket.videoCalls += unitCount;
          totalBucket.videoCalls += unitCount;
          bucket.videoCostUsd += delta;
          totalBucket.videoCostUsd += delta;
        }
        if (status === 'success') {
          bucket.apiSuccessCalls += 1;
          totalBucket.apiSuccessCalls += 1;
        }
        if (status === 'error' || status === 'failed') {
          bucket.apiFailedCalls += 1;
          totalBucket.apiFailedCalls += 1;
        }
        continue;
      }

      const provider = String(entry.provider ?? '');
      if (provider === 'system') continue;
      const active = activeWindows.length ? activeWindows[activeWindows.length - 1] : null;
      if (!active) continue;

      const bucket = this.pickStepBucket(active.phase, active.episodeNumber, active.step, creationSteps, episodeSteps);
      const totalBucket = this.pickTotalBucket(active.phase, active.episodeNumber, creationTotal, episodeTotals);
      const prompt = this.toNumber(entry?.tokens?.prompt);
      const completion = this.toNumber(entry?.tokens?.completion);
      const totalTokens = this.toNumber(entry?.tokens?.total);
      const llmCost = this.toNumber(entry?.cost?.usd);

      bucket.llmCalls += 1;
      totalBucket.llmCalls += 1;
      bucket.promptTokens += prompt;
      totalBucket.promptTokens += prompt;
      bucket.completionTokens += completion;
      totalBucket.completionTokens += completion;
      const tokenDelta = totalTokens || prompt + completion;
      bucket.totalTokens += tokenDelta;
      totalBucket.totalTokens += tokenDelta;
      bucket.llmCostUsd += llmCost;
      totalBucket.llmCostUsd += llmCost;
    }
    this.mergeBucket(total, creationTotal);
    for (const b of episodeTotals.values()) this.mergeBucket(total, b);

    const episodes: EpisodeUsage[] = [...episodeTotals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([episodeNumber, b]) => ({
        episodeNumber,
        ...this.finalizeBucket(b),
        steps: this.stepsToArray(episodeSteps.get(episodeNumber)),
      }));

    return {
      dramaId,
      currency: 'USD',
      creation: { ...this.finalizeBucket(creationTotal), steps: this.stepsToArray(creationSteps) },
      episodes,
      total: this.finalizeBucket(total),
    };
  }

  private updateWindows(
    activeWindows: WorkflowWindow[],
    entry: JsonRecord,
    dramaId: string,
    ts: number,
  ): void {
    const metadata = (entry.metadata ?? {}) as JsonRecord;
    const mdDramaId = String(metadata.dramaId ?? '');
    if (mdDramaId !== dramaId) return;

    const phase = metadata.phase === 'episode' ? 'episode' : metadata.phase === 'create' ? 'create' : null;
    if (!phase) return;
    const rawStep = String(metadata.step ?? '');
    const episodeNumber = this.toNumber(metadata.episodeNumber);

    if (rawStep.endsWith('_start')) {
      activeWindows.push({
        phase,
        episodeNumber: phase === 'episode' && episodeNumber > 0 ? episodeNumber : undefined,
        step: rawStep.replace(/_start$/, ''),
        startAt: ts,
      });
      return;
    }
    if (rawStep.endsWith('_done')) {
      const target = rawStep.replace(/_done$/, '');
      for (let i = activeWindows.length - 1; i >= 0; i -= 1) {
        const w = activeWindows[i];
        if (w.phase !== phase) continue;
        if (phase === 'episode' && w.episodeNumber !== (episodeNumber > 0 ? episodeNumber : undefined)) continue;
        if (w.step !== target) continue;
        activeWindows.splice(i, 1);
        break;
      }
    }
  }

  private pickTotalBucket(
    phase: 'create' | 'episode',
    episodeNumber: number | undefined,
    creationTotal: UsageBucket,
    episodeTotals: Map<number, UsageBucket>,
  ): UsageBucket {
    if (phase === 'episode' && episodeNumber && episodeNumber > 0) {
      const epTotal = episodeTotals.get(episodeNumber) ?? emptyBucket();
      if (!episodeTotals.has(episodeNumber)) episodeTotals.set(episodeNumber, epTotal);
      return epTotal;
    }
    return creationTotal;
  }

  private pickStepBucket(
    phase: 'create' | 'episode',
    episodeNumber: number | undefined,
    step: string,
    creationSteps: Map<string, UsageBucket>,
    episodeSteps: Map<number, Map<string, UsageBucket>>,
  ): UsageBucket {
    if (phase === 'episode' && episodeNumber && episodeNumber > 0) {
      const stepMap = episodeSteps.get(episodeNumber) ?? new Map<string, UsageBucket>();
      if (!episodeSteps.has(episodeNumber)) episodeSteps.set(episodeNumber, stepMap);
      const stepBucket = stepMap.get(step) ?? emptyBucket();
      if (!stepMap.has(step)) stepMap.set(step, stepBucket);
      return stepBucket;
    }

    const stepBucket = creationSteps.get(step) ?? emptyBucket();
    if (!creationSteps.has(step)) creationSteps.set(step, stepBucket);
    return stepBucket;
  }

  private mergeBucket(target: UsageBucket, source: UsageBucket): void {
    target.llmCalls += source.llmCalls;
    target.promptTokens += source.promptTokens;
    target.completionTokens += source.completionTokens;
    target.totalTokens += source.totalTokens;
    target.llmCostUsd += source.llmCostUsd;
    target.imageCalls += source.imageCalls;
    target.imageCostUsd += source.imageCostUsd;
    target.videoCalls += source.videoCalls;
    target.videoCostUsd += source.videoCostUsd;
    target.apiSuccessCalls += source.apiSuccessCalls;
    target.apiFailedCalls += source.apiFailedCalls;
  }

  private finalizeBucket(input: UsageBucket): UsageBucket {
    return {
      llmCalls: input.llmCalls,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      totalTokens: input.totalTokens,
      llmCostUsd: round6(input.llmCostUsd),
      imageCalls: input.imageCalls,
      imageCostUsd: round6(input.imageCostUsd),
      videoCalls: input.videoCalls,
      videoCostUsd: round6(input.videoCostUsd),
      apiSuccessCalls: input.apiSuccessCalls,
      apiFailedCalls: input.apiFailedCalls,
    };
  }

  private stepsToArray(stepMap?: Map<string, UsageBucket>): StepUsage[] {
    if (!stepMap) return [];
    return [...stepMap.entries()]
      .map(([step, bucket]) => ({ step, ...this.finalizeBucket(bucket) }))
      .sort((a, b) => (b.llmCostUsd + b.imageCostUsd + b.videoCostUsd) - (a.llmCostUsd + a.imageCostUsd + a.videoCostUsd));
  }

  private async buildShotEpisodeMap(dramaId: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const episodes = await this.episodeRepo.find({
      where: { dramaId },
      select: ['episodeNumber', 'storyboard'],
      order: { episodeNumber: 'ASC' },
    });
    for (const ep of episodes) {
      const shots = (((ep.storyboard as any)?.shots ?? []) as Array<{ shotId?: string }>);
      for (const s of shots) {
        if (!s?.shotId) continue;
        map.set(s.shotId, ep.episodeNumber);
      }
    }
    return map;
  }

  private resolveDramaLogPath(): string {
    const llm = (this.configService.get('llm') ?? {}) as Record<string, any>;
    const llmTrace = (llm.trace ?? {}) as Record<string, any>;
    const media = (this.configService.get('media') ?? {}) as Record<string, any>;
    const mediaTrace = (media.trace ?? {}) as Record<string, any>;
    const configuredDir = String(mediaTrace.logDir || llmTrace.logDir || './logs');
    const absDir = path.isAbsolute(configuredDir) ? configuredDir : path.resolve(process.cwd(), configuredDir);
    return path.join(absDir, 'llm-drama.jsonl');
  }

  private toNumber(v: unknown, def = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }
}
