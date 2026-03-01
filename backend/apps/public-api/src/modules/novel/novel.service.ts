/**
 * 小说服务 — 渐进式创作架构。
 *
 * 核心特点：
 * - createBook 极轻量：只做种子分析 + 粗大纲（1 次 LLM）
 * - 每章 4-5 次 LLM
 * - 圣经/世界观从写作中渐进提炼
 * - 深度维护事件驱动触发
 */
import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { WorkflowExecutionEntity } from './entities/workflow-execution.entity';
import { randomUUID } from 'crypto';
import { LlmService } from './llm/llm.service';
import { LlmUsageTrackerService } from './llm/llm-usage-tracker.service';
import { LlmTraceLoggerService } from './llm/llm-trace-logger.service';
import { SeedAnalyzerAgent } from './agents/seed-analyzer.agent';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { CharacterVoiceCoachAgent } from './agents/character-voice-coach.agent';
import { ChapterWorkflowService, ChapterWorkflowResult } from './chapter-workflow.service';
import { DeepMaintenanceService } from './deep-maintenance.service';
import { LoreApplicationService } from './lore-application.service';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { BookPromptTemplateService } from './book-prompt-template.service';
import { NovelProgressService } from './novel-progress.service';
import { DetailStoreService } from './detail-store.service';
import { MemoryRetrieverService } from './memory-retriever.service';
import { ReaderPulseAnalyzerAgent } from './agents/reader-pulse-analyzer.agent';
import { BookStrategyAgent } from './agents/book-strategy.agent';
import { BookEntity } from './entities/book.entity';
import { ChapterEntity } from './entities/chapter.entity';
import { ArtifactEntity } from './entities/artifact.entity';
import { BookStateRepository } from './book-state.repository';
import {
  ChapterResyncJobEntity,
  ChapterResyncJobStatus,
} from './entities/chapter-resync-job.entity';
import { CHAPTER_RESYNC_QUEUE, ChapterResyncJobPayload } from './chapter-resync.queue';
import { AUTO_SERIALIZATION_QUEUE, AutoSerializationJobPayload } from './auto-serialization.queue';
import { CreateBookCoreDto } from './dto/create-book-core.dto';
import { GenreProfileTemplateService } from './genre-profile-template.service';
import { CreateBookDto } from './dto/create-book.dto';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import {
  StoryState,
  storyStateSchema,
  MaintenanceState,
  BookPromptProfile,
  bookPromptProfileSchema,
  ChapterIntent,
  chapterIntentSchema,
  ReaderFeedback,
  ReaderFeedbackAnalysis,
  FeedbackState,
  AudienceDirective,
  NamingConvention,
  audienceDirectiveSchema,
} from './schemas/novel-state.schemas';
import {
  ChapterDraft,
  LoreRecord,
  chapterDraftSchema,
  loreRecordSchema,
  generationKpiSchema,
} from './schemas/novel.schemas';
import {
  DetailStoreChapterUpdates,
  LocationSensoryAnchor,
  ItemSensorySignature,
} from './detail-store.schemas';
import { z } from 'zod';

const locationSensoryExtractionSchema = z.object({
  sensoryAnchors: z
    .array(
      z.object({
        sense: z.enum(['sight', 'sound', 'smell', 'touch', 'temperature']),
        description: z.string(),
        isLandmark: z.boolean().optional(),
      }),
    )
    .min(0)
    .max(2),
});

const itemSensoryExtractionSchema = z.object({
  sensorySignature: z
    .object({
      visual: z.string().optional(),
      tactile: z.string().optional(),
      auditory: z.string().optional(),
      olfactory: z.string().optional(),
      weight: z.string().optional(),
    })
    .optional(),
  activationEffect: z
    .object({ description: z.string() })
    .optional(),
});

const INITIAL_MAINTENANCE: MaintenanceState = {
  lastMaintenanceAtChapter: 0,
  newCharactersSinceLastMaintenance: 0,
  newLocationsSinceLastMaintenance: 0,
  newThreadsSinceLastMaintenance: 0,
  newFactsSinceLastMaintenance: 0,
  consecutiveLowScoreChapters: 0,
  consecutiveConsistencyWarnings: 0,
  bibleVersion: 0,
  outlineVersion: 1,
};

interface GenerateChapterRuntimeOptions {
  maxRepairRounds?: number;
}

interface CreateBookRuntimeOptions {
  progressChannel?: string;
  userId?: string;
}

type ChapterResyncStatus =
  | 'not_requested'
  | 'queued'
  | 'running'
  | 'synced'
  | 'synced_forward'
  | 'skipped_missing_snapshot'
  | 'skipped_too_many_chapters'
  | 'skipped_missing_chapters'
  | 'failed';

interface ChapterResyncResult {
  status: ChapterResyncStatus;
  message?: string;
  jobId?: string;
  requestedStartChapter?: number;
  requestedEndChapter?: number;
  effectiveStartChapter?: number;
  effectiveEndChapter?: number;
  completedChapters?: number;
  totalChapters?: number;
  progressChapter?: number;
  requestedAt?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface UpdateChapterPayload {
  title?: string;
  content?: string;
  resyncState?: boolean;
}

interface ChapterResyncRunOptions {
  onProgress?: (progress: {
    chapterNumber: number;
    completed: number;
    total: number;
    message: string;
  }) => Promise<void> | void;
}

const MAX_CHAPTER_RESYNC_CHAPTERS = 500;
const DEFAULT_TRACE_ARTIFACT_NAMES = [
  'arc_director',
  'intent',
  'review',
  'deterministic_check',
];
const TRACE_HOOK_TAIL_CHARS = 1200;
const TRACE_REWRITE_THRESHOLD = 70;
const TRACE_CRITICAL_THRESHOLD = 45;
const TRACE_MATCH_GOOD_THRESHOLD = 0.6;

@Injectable()
export class NovelService {
  private readonly logger = new Logger(NovelService.name);

  constructor(
    private readonly bookStateRepo: BookStateRepository,
    @InjectRepository(ChapterEntity)
    private readonly chapterRepo: Repository<ChapterEntity>,
    @InjectRepository(ArtifactEntity)
    private readonly artifactRepo: Repository<ArtifactEntity>,
    @InjectRepository(ChapterResyncJobEntity)
    private readonly chapterResyncJobRepo: Repository<ChapterResyncJobEntity>,
    @InjectRepository(WorkflowExecutionEntity)
    private readonly workflowExecutionRepo: Repository<WorkflowExecutionEntity>,
    @InjectQueue(CHAPTER_RESYNC_QUEUE)
    private readonly chapterResyncQueue: Queue<ChapterResyncJobPayload>,
    @InjectQueue(AUTO_SERIALIZATION_QUEUE)
    private readonly autoSerializationQueue: Queue<AutoSerializationJobPayload>,
    private readonly dataSource: DataSource,
    private readonly seedAnalyzer: SeedAnalyzerAgent,
    private readonly promptProfiler: PromptProfilerAgent,
    private readonly chapterWorkflow: ChapterWorkflowService,
    private readonly recorder: RecorderAgent,
    private readonly voiceCoach: CharacterVoiceCoachAgent,
    private readonly deepMaintenance: DeepMaintenanceService,
    private readonly loreService: LoreApplicationService,
    private readonly llmUsageTracker: LlmUsageTrackerService,
    private readonly llm: LlmService,
    private readonly pipelineService: BookAgentPipelineService,
    private readonly promptTplService: BookPromptTemplateService,
    private readonly progressService: NovelProgressService,
    private readonly detailStore: DetailStoreService,
    private readonly memoryRetriever: MemoryRetrieverService,
    private readonly readerPulse: ReaderPulseAnalyzerAgent,
    private readonly bookStrategyAgent: BookStrategyAgent,
    private readonly genreTemplateService: GenreProfileTemplateService,
    private readonly traceLogger: LlmTraceLoggerService,
  ) {}

  private buildAudienceDirective(
    dto: CreateBookCoreDto,
    tpl: import('./entities/genre-profile-template.entity').GenreProfileTemplateEntity | null,
  ): AudienceDirective {
    return {
      audienceTags: dto.audienceTags?.length ? dto.audienceTags : (tpl?.audienceTags ?? []),
      protagonistFocus: (dto.protagonistFocus ?? tpl?.protagonistFocusTags?.[0] ?? 'male_lead') as AudienceDirective['protagonistFocus'],
      tonePreference: dto.tonePreference ?? tpl?.toneTags?.[0] ?? '',
      relationshipDensity: tpl?.relationshipDensity ?? 'medium',
      hardConstraints: tpl?.hardConstraints ?? [],
      softPreferences: tpl?.softPreferences ?? [],
    };
  }

  private mergeNamingConvention(
    templateDefaults?: import('./entities/genre-profile-template.entity').SeedAnalyzerHints['namingDefaults'],
    analyzed?: NamingConvention,
  ): NamingConvention | undefined {
    const t = templateDefaults ?? {};
    const a = analyzed ?? {};
    const personNameStyle = t.personNameStyle ?? a.personNameStyle;
    const locationNameStyle = t.locationNameStyle ?? a.locationNameStyle;
    if (!personNameStyle || !locationNameStyle) return analyzed;
    return {
      personNameStyle,
      locationNameStyle,
      abilityNameStyle: t.abilityNameStyle ?? a.abilityNameStyle,
      factionNameStyle: t.factionNameStyle ?? a.factionNameStyle,
      itemNameStyle: t.itemNameStyle ?? a.itemNameStyle,
      examples: {
        personNames: (t.examples?.personNames?.length ? t.examples.personNames : (a.examples?.personNames ?? [])),
        locationNames: (t.examples?.locationNames?.length ? t.examples.locationNames : (a.examples?.locationNames ?? [])),
        abilityNames: (t.examples?.abilityNames?.length ? t.examples.abilityNames : (a.examples?.abilityNames ?? [])),
        factionNames: (t.examples?.factionNames?.length ? t.examples.factionNames : (a.examples?.factionNames ?? [])),
      },
      taboos: t.taboos?.length ? t.taboos : (a.taboos ?? []),
    };
  }

  async getBookProfile(bookId: string): Promise<BookPromptProfile> {
    const state = await this.loadBookState(bookId);
    return state.bookPromptProfile;
  }

  async updateBookProfile(bookId: string, profileData: Record<string, unknown>): Promise<BookPromptProfile> {
    const state = await this.loadBookState(bookId);
    const parsed = bookPromptProfileSchema.parse(profileData);
    state.bookPromptProfile = parsed;
    state.updatedAt = new Date().toISOString();
    await this.persistBookState(state);
    this.logger.log(`[updateBookProfile] bookId=${bookId} 写作手册已更新`);
    return parsed;
  }

  async getAudienceDirective(bookId: string): Promise<AudienceDirective | null> {
    const state = await this.loadBookState(bookId);
    return state.audienceDirective ?? null;
  }

  async updateAudienceDirective(bookId: string, directiveData: Record<string, unknown>): Promise<AudienceDirective> {
    const state = await this.loadBookState(bookId);
    const parsed = audienceDirectiveSchema.parse(directiveData);
    state.audienceDirective = parsed;
    state.updatedAt = new Date().toISOString();
    await this.persistBookState(state);
    this.logger.log(`[updateAudienceDirective] bookId=${bookId} 受众策略已更新`);
    return parsed;
  }

  /**
   * Enhance a raw idea into a richer, more compelling concept.
   */
  async enhanceIdea(rawIdea: string, genre?: string) {
    const enhanceSchema = z.object({
      enhanced: z.string(),
      highlights: z.array(z.string()).min(2).max(5),
    });

    return this.llm.generateStructured({
      taskName: 'idea-enhancer',
      schema: enhanceSchema,
      tags: ['setup', 'idea'],
      systemPrompt: `你是一位兼具创意天赋和市场嗅觉的网文策划编辑，擅长把粗糙的灵感打磨成让读者一眼心动的故事概念。

核心任务：对用户的原始创意进行"美化"——保留内核，提升表达，让它读起来像一段让人想追更的故事简介。

美化原则：
1. 忠于原意：保留用户创意的核心方向、关键设定和情感基调，绝不偏离或替换。
2. 世界观锐化：补充1-2个有辨识度的设定细节，让这个故事世界"只此一家"。
3. 冲突前置：在描述中自然埋入核心矛盾或悬念，让人产生"接下来会怎样"的好奇。
4. 主角立体化：赋予主角一个有趣的困境、反差或抉择，而非扁平的标签。
5. 文案质感：语言风格对标优质网文的封面简介——有画面感、有代入感、有节奏感，控制在150-300字。
6. 拒绝俗套：避免已被过度消费的网文套路（无脑打脸、退婚逆袭、赘婿翻身、系统开局等），除非原创意本身包含。
7. 适度原则：如果原始创意已足够精彩具体，润色即可，不要为了美化而过度改造。

输出说明：
- enhanced：美化后的故事概念，像封面简介一样有吸引力。
- highlights：2-5个核心卖点，每个一句话，概括这个创意最能吸引读者的地方（不是你做了什么改动，而是这个故事本身的亮点）。`,
      userPrompt: `原始创意：
${rawIdea}
${genre ? `\n题材方向：${genre}\n请结合该题材的核心吸引力调整美化侧重。` : ''}

请输出美化后的创意和核心卖点。`,
      temperature: 0.75,
    });
  }

  /**
   * Generate a compelling main story goal based on the idea, genre, and audience.
   */
  async generateStoryGoal(input: {
    mainIdea: string;
    genre: string;
    targetAudience: string;
  }) {
    const goalSchema = z.object({
      goal: z.string(),
      alternatives: z.array(z.string()).min(2).max(3),
    });

    return this.llm.generateStructured({
      taskName: 'story-goal-generator',
      schema: goalSchema,
      tags: ['setup', 'goal'],
      systemPrompt: `你是一位资深的网文策划，擅长从核心创意中提炼出令人欲罢不能的长篇主线目标。

主线目标是贯穿全书的终极目标——读者一直追读就是想知道主角能否达成它。

生成原则：
1. 主线目标必须从核心创意中自然延伸，不能脱离创意方向。
2. 目标要有层次感——表面目标和深层目标最好不同（表面是"变强"，深层是"寻找真相"）。
3. 目标要有足够的延展性——能支撑 500+ 章的叙事而不显枯燥。
4. 目标要与题材特色契合——玄幻适合"登顶"式目标，悬疑适合"解谜"式目标，言情适合"归属"式目标。
5. 语言简洁有力，30-80 字，要有悬念感。
6. 同时给出 2-3 个备选目标（alternatives），风格/方向不同，供用户选择。`,
      userPrompt: `核心创意：${input.mainIdea}
题材类型：${input.genre}
目标读者：${input.targetAudience}

请生成一个最佳主线目标（goal）和 2-3 个备选方案（alternatives）。`,
      temperature: 0.8,
    });
  }

  /**
   * Create a book with minimal upfront planning.
   * 1 LLM call: seed analysis + rough outline.
   */
  async createBook(dto: CreateBookCoreDto, options?: CreateBookRuntimeOptions): Promise<unknown> {
    let createdBookId = '';
    const logCreate = (step: string, status: 'ok' | 'error', meta?: Record<string, unknown>, error?: string) =>
      this.traceLogger.logWorkflowEvent({ bookId: createdBookId || '__creating__', chapterNumber: 0, step: `createBook:${step}`, status, error, meta });
    return this.llmUsageTracker.runWithChapterScope({ bookId: '__creating__', chapterNumber: 0 }, async () => {
      const t0 = Date.now();
      try {
    logCreate('start', 'ok', { genre: dto.genre, mainIdea: dto.mainIdea?.slice(0, 100) });
    this.logger.log(
      `[createBook] ========== 极轻量开书 ==========\n` +
      `  mainIdea: ${dto.mainIdea}\n` +
      `  genre: ${dto.genre} | targetAudience: ${dto.targetAudience}`,
    );

    const progressChannel = options?.progressChannel ?? '__creating__';

    const emitCreate = (step: string, stepIndex: number, message: string, done = false) => {
      this.progressService.emit({
        bookId: progressChannel,
        chapterNumber: 0,
        step,
        stepIndex,
        totalSteps: 3,
        message,
        done,
      });
    };

    // 从 DB 加载题材模板（优先指定 ID > 多维匹配）
    let tpl: import('./entities/genre-profile-template.entity').GenreProfileTemplateEntity | null = null;
    let templateScore = 0;
    let templateScoreDetail: Record<string, number> | undefined;
    if (dto.profileTemplateId) {
      tpl = await this.genreTemplateService.getById(dto.profileTemplateId);
      templateScore = 1;
    } else {
      const matched = await this.genreTemplateService.findBestMatchWithScore({
        genre: dto.genre,
        targetAudience: dto.targetAudience,
        protagonistFocus: dto.protagonistFocus,
        tonePreference: dto.tonePreference,
        audienceTags: dto.audienceTags,
      }, options?.userId);
      tpl = matched.template;
      templateScore = matched.score;
      templateScoreDetail = matched.detail;
    }
    const seedHints = tpl?.seedHints ?? undefined;
    const templateNamingDefaults = seedHints?.namingDefaults;
    const genreAtoms = tpl?.ruleAtoms?.length ? tpl.ruleAtoms : undefined;
    const hasTemplateProfile = tpl?.profileJson && Object.keys(tpl.profileJson).length > 0;
    const audienceDirective = this.buildAudienceDirective(dto, tpl);
    this.logger.log(`[createBook] 模板匹配: ${tpl?.displayName ?? '无'} | score=${templateScore}${templateScoreDetail ? ` detail=${JSON.stringify(templateScoreDetail)}` : ''}`);

    // Step 1: 种子分析（必须 LLM）+ 写作手册（模板有则跳过，无则 LLM 生成）
    this.logger.log(`[createBook] 步骤 1/3: 种子分析${hasTemplateProfile ? '（模板直供 Profile，跳过 LLM）' : '（并行生成 Profile）'}...`);
    emitCreate('seed_and_profile', 0, hasTemplateProfile ? '种子分析中（写作手册使用模板）' : '种子分析 + 写作手册生成（并行）');
    const sharedChapterWordCount = dto.targetChapterWordCount ?? 3000;
    const sharedPlannedChapters = { min: dto.plannedMinChapters ?? 500, max: dto.plannedMaxChapters ?? 800 };

    let analysis: Awaited<ReturnType<typeof this.seedAnalyzer.analyze>>;
    let bookPromptProfile: BookPromptProfile;
    if (hasTemplateProfile) { // 模板提供完整 Profile → 只做种子分析，省掉 promptProfiler.generate()
      analysis = await this.seedAnalyzer.analyze({
        mainIdea: dto.mainIdea, genre: dto.genre, targetAudience: dto.targetAudience,
        protagonistFocus: dto.protagonistFocus, tonePreference: dto.tonePreference, audienceTags: dto.audienceTags,
        titleHint: dto.titleHint, mainStoryGoal: dto.mainStoryGoal,
        targetChapterWordCount: sharedChapterWordCount, plannedTotalChapters: sharedPlannedChapters, seedHints,
      });
      bookPromptProfile = tpl!.profileJson as unknown as BookPromptProfile;
    } else { // 无模板 → 并行生成种子 + Profile（profile 失败时降级为空壳）
      const seedPromise = this.seedAnalyzer.analyze({
        mainIdea: dto.mainIdea, genre: dto.genre, targetAudience: dto.targetAudience,
        protagonistFocus: dto.protagonistFocus, tonePreference: dto.tonePreference, audienceTags: dto.audienceTags,
        titleHint: dto.titleHint, mainStoryGoal: dto.mainStoryGoal,
        targetChapterWordCount: sharedChapterWordCount, plannedTotalChapters: sharedPlannedChapters, seedHints,
      });
      const profilePromise = this.promptProfiler.generate({
        genre: dto.genre, targetAudience: dto.targetAudience, mainIdea: dto.mainIdea,
        protagonistFocus: dto.protagonistFocus, tonePreference: dto.tonePreference, audienceTags: dto.audienceTags,
        mainStoryGoal: dto.mainStoryGoal,
        targetChapterWordCount: sharedChapterWordCount, plannedTotalChapters: sharedPlannedChapters,
        referenceProfile: tpl?.profileJson as unknown as BookPromptProfile | undefined,
      }).catch((e) => {
        this.logger.warn(`[createBook] Profile 生成失败，将在首章时补充: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      const [a, p] = await Promise.all([seedPromise, profilePromise]);
      analysis = a;
      if (p) { bookPromptProfile = p; } else {
        bookPromptProfile = await this.promptProfiler.generate({
          genre: dto.genre, targetAudience: dto.targetAudience, mainIdea: dto.mainIdea,
          targetChapterWordCount: sharedChapterWordCount, plannedTotalChapters: sharedPlannedChapters,
        });
      }
    }
    const mergedNamingConvention = this.mergeNamingConvention(templateNamingDefaults, analysis.namingConvention);
    let bookStrategy: import('./schemas/novel-state.schemas').BookStrategy | undefined;
    try {
      bookStrategy = await this.bookStrategyAgent.generateInitial({
        seed: {
          ...analysis.seed,
          audienceTags: dto.audienceTags ?? [],
          protagonistFocus: dto.protagonistFocus,
          tonePreference: dto.tonePreference,
          ...(dto.mainStoryGoal ? { mainStoryGoal: dto.mainStoryGoal } : {}),
        },
        outline: analysis.outline,
        audienceDirective,
        profile: bookPromptProfile,
      });
    } catch (e) {
      this.logger.warn(`[createBook] BookStrategy 生成失败，首章时补充: ${e instanceof Error ? e.message : String(e)}`);
    }
    logCreate('seedAnalysis', 'ok', {
      title: analysis.seed.title,
      protagonist: analysis.seed.protagonistConcept.name,
      outlinePoints: analysis.outline.points.length,
      durationMs: Date.now() - t0,
      templateId: tpl?.id ?? null,
      templateScore,
      templateScoreDetail,
    });
    this.logger.log(
      `[createBook] 种子${hasTemplateProfile ? '' : '+手册'}完成 — ${Date.now() - t0}ms\n` +
      `  书名: ${analysis.seed.title} | 主角: ${analysis.seed.protagonistConcept.name}\n` +
      `  大纲节点: ${analysis.outline.points.length} | 可行性: ${analysis.seed.conceptEvaluation?.overallViability ?? 'N/A'}\n` +
      `  题材: ${bookPromptProfile.generatedForGenre} | 规则: ${bookPromptProfile.writerGuide?.genreRules?.length ?? 0} 条`,
    );
    emitCreate('seed_and_profile', 0, `种子完成 — 《${analysis.seed.title}》`);

    // Agent Sections：模板有缓存则直接用，否则实时生成
    const cachedSections = tpl ? await this.genreTemplateService.ensureCachedAgentSections(tpl) : null;
    const agentSectionsPromise = cachedSections
      ? Promise.resolve(cachedSections)
      : this.promptProfiler.generateAgentSections(dto.genre, bookPromptProfile, genreAtoms).catch((e) => {
          this.logger.warn(`[createBook] Agent sections 生成失败，将使用默认: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        });

    // Step 2: Persist
    this.logger.log(`[createBook] 步骤 2/3: 初始化角色与世界...`);
    emitCreate('init', 1, '初始化角色与世界');
    const bookEntity = await this.bookStateRepo.createEmpty(options?.userId);
    const bookId = bookEntity.bookId;
    createdBookId = bookId;
    const now = new Date().toISOString();

    const protagonist = {
      id: 'char_protagonist',
      name: analysis.seed.protagonistConcept.name,
      aliases: [],
      role: 'protagonist' as const,
      archetype: analysis.seed.protagonistConcept.personality,
      personalityTags: [analysis.seed.protagonistConcept.personality],
      profile: {},
      status: {
        locationId: 'loc_start',
        state: analysis.seed.protagonistConcept.situation,
        level: 0,
        inventory: [],
        lifecycleStatus: 'active' as const,
        firstSeenChapter: 1,
        lastSeenChapter: 1,
        plannedReturnChapter: null,
        narrativeImportance: 'core' as const,
        dormantReference: false,
      },
    };

    let state: StoryState = {
      bookId,
      createdAt: now,
      updatedAt: now,
      version: 2,
      seed: {
        ...analysis.seed,
        audienceTags: dto.audienceTags ?? [],
        protagonistFocus: dto.protagonistFocus,
        tonePreference: dto.tonePreference,
        ...(dto.mainStoryGoal ? { mainStoryGoal: dto.mainStoryGoal } : {}),
      },
      roughOutline: analysis.outline,
      bookPromptProfile,
      audienceDirective,
      bookStrategy,
      chapterCursor: 1,
      characters: [protagonist],
      locations: [{
        id: 'loc_start',
        name: '起始地点',
        description: '故事开始的地方（将在第一章中具体化）',
        dangerLevel: 'low',
        profile: {},
      }],
      items: [],
      chapterSummaries: [],
      openPlotThreads: [],
      relationGraph: [],
      timelineEvents: [],
      plotThreadLedger: [],
      characterFactLedger: [],
      lastHook: '',
      kpiHistory: [],
      completedArcAcceptanceReports: [],
      maintenance: INITIAL_MAINTENANCE,
      ...(mergedNamingConvention ? { namingConvention: mergedNamingConvention } : {}),
    };

    await this.persistBookState(state);
    await this.persistArtifact(bookId, 0, 'seed', analysis.seed);
    await this.persistArtifact(bookId, 0, 'rough_outline', analysis.outline);
    await this.persistArtifact(bookId, 0, 'initial_state', state);
    await this.persistArtifact(bookId, 0, 'state_snapshot', state);
    await this.pipelineService.initDefault(bookId);
    logCreate('statePersisted', 'ok', { bookId });
    const generatedSections = await agentSectionsPromise;
    if (generatedSections) {
      await this.promptTplService.initWithGenerated(bookId, generatedSections, genreAtoms);
      logCreate('agentSections', 'ok', { source: 'generated' });
    } else {
      await this.promptTplService.initDefault(bookId, genreAtoms);
      state.agentSectionsStatus = 'pending';
      await this.persistBookState(state);
      logCreate('agentSections', 'ok', { source: 'default-fallback' });
    }

    logCreate('done', 'ok', { bookId, title: analysis.seed.title, durationMs: Date.now() - t0 });
    this.logger.log(
      `[createBook] 步骤 3/3: 初始化完成 — ${Date.now() - t0}ms\n` +
      `  bookId: ${bookId} | 书名: ${analysis.seed.title}\n` +
      `  主角: ${protagonist.name} | 大纲节点: ${analysis.outline.points.length}\n` +
      `  ========== 开书完成 ==========`,
    );
    emitCreate('done', 2, `开书完成 — 《${analysis.seed.title}》`, true);

    return {
      bookId,
      title: analysis.seed.title,
      chapterCursor: 1,
      outline: analysis.outline,
      bookPromptProfile,
      currentArc: state.currentArc ?? null,
      currentArcAcceptance: state.currentArcAcceptance ?? null,
      completedArcAcceptanceReports: state.completedArcAcceptanceReports ?? [],
    };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logCreate('failed', 'error', { durationMs: Date.now() - t0 }, msg);
        if (createdBookId) {
          this.logger.warn(`[createBook] 创建失败，孤儿记录 bookId=${createdBookId} 待清理`);
        }
        throw e;
      } finally {
        const usage = this.llmUsageTracker.consumeCurrentSummary();
        if (usage && createdBookId) {
          usage.bookId = createdBookId;
          try { await this.persistArtifact(createdBookId, 0, 'llm_usage_summary', usage); } catch {}
        }
      }
    });
  }

  async assertBookOwnership(bookId: string, userId: string): Promise<void> {
    return this.bookStateRepo.assertOwnership(bookId, userId);
  }

  async listBooks(userId?: string): Promise<unknown> {
    const books = await this.bookStateRepo.findAllLightweight(50, userId);
    const chapterCountMap = await this.loadChapterCountMap(books.map((b) => b.bookId));
    return {
      count: books.length,
      books: books.map((b) => {
        const s = b.stateJson as any; // 核心态JSONB（不含已拆出的子表数组）
        const kpi = s.kpiHistory ?? [];
        const latestKpi = kpi[kpi.length - 1] ?? null;
        const generatedByCursor = Math.max(0, (s.chapterCursor ?? 1) - 1);
        const generatedByTable = chapterCountMap.get(b.bookId) ?? 0;
        return {
          bookId: b.bookId,
          title: s.seed?.title ?? '',
          genre: s.seed?.genre ?? '',
          chaptersGenerated: Math.max(generatedByCursor, generatedByTable),
          latestKpi: latestKpi
            ? { qualityScore: latestKpi.qualityScore, overallScore: latestKpi.overallScore }
            : null,
          updatedAt: b.updatedAt.toISOString(),
        };
      }),
    };
  }

  async deleteBook(bookId: string): Promise<{ deleted: true; bookId: string }> {
    const exists = await this.bookStateRepo.exists(bookId);
    if (!exists) throw new NotFoundException(`Book not found: ${bookId}`);
    await this.cleanBullMqJobs(bookId);
    await this.dataSource.transaction(async (em) => {
      await em.delete(WorkflowExecutionEntity, { bookId }); // 无 FK CASCADE，手动删
      await em.remove(await em.findOneByOrFail(BookEntity, { bookId })); // CASCADE 自动清理其余关联表
    });
    this.logger.log(`[deleteBook] bookId=${bookId} 已永久删除（含全部关联数据）`);
    return { deleted: true, bookId };
  }

  private async cleanBullMqJobs(bookId: string): Promise<void> {
    const repeatables = await this.autoSerializationQueue.getRepeatableJobs(0, 1000);
    for (const r of repeatables) {
      if (r.id?.includes(bookId)) await this.autoSerializationQueue.removeRepeatableByKey(r.key);
    }
    for (const q of [this.autoSerializationQueue, this.chapterResyncQueue] as Queue[]) {
      const jobs = await q.getJobs(['waiting', 'delayed', 'paused']);
      for (const j of jobs) {
        if ((j.data as any)?.bookId === bookId) await j.remove().catch(() => {});
      }
    }
  }

  async getBookTokenUsage(bookId: string): Promise<unknown> {
    await this.loadBookState(bookId);
    const artifacts = await this.artifactRepo.find({ where: { bookId, name: 'llm_usage_summary' }, order: { chapterNumber: 'ASC' } });
    let totalPromptTokens = 0, totalCompletionTokens = 0, totalTokens = 0, totalCostUsd = 0, totalCalls = 0;
    const providerAgg = new Map<string, { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number }>();
    const modelAgg = new Map<string, { provider: string; tier: string; calls: number; promptTokens: number; completionTokens: number; totalTokens: number; estimatedCostUsd: number; totalDurationMs: number }>();

    const chapters = artifacts.map((a) => {
      const p = a.payload as Record<string, any>;
      const pt = typeof p.promptTokens === 'number' ? p.promptTokens : 0;
      const ct = typeof p.completionTokens === 'number' ? p.completionTokens : 0;
      const tt = typeof p.totalTokens === 'number' ? p.totalTokens : 0;
      const cost = typeof p.estimatedCostUsd === 'number' ? p.estimatedCostUsd : 0;
      const calls = typeof p.totalCalls === 'number' ? p.totalCalls : 0;
      totalPromptTokens += pt; totalCompletionTokens += ct; totalTokens += tt; totalCostUsd += cost; totalCalls += calls;
      // 聚合per-provider（从已持久化的byProvider字段）
      if (Array.isArray(p.byProvider)) {
        for (const bp of p.byProvider) {
          const k = bp.provider ?? 'unknown';
          const cur = providerAgg.get(k) ?? { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
          cur.calls += bp.calls ?? 0; cur.promptTokens += bp.promptTokens ?? 0; cur.completionTokens += bp.completionTokens ?? 0;
          cur.totalTokens += bp.totalTokens ?? 0; cur.estimatedCostUsd += bp.estimatedCostUsd ?? 0;
          providerAgg.set(k, cur);
        }
      }
      if (Array.isArray(p.byModel)) {
        for (const bm of p.byModel) {
          const k = bm.model ?? 'unknown';
          const cur = modelAgg.get(k) ?? { provider: bm.provider ?? '', tier: bm.tier ?? '', calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0, totalDurationMs: 0 };
          cur.calls += bm.calls ?? 0; cur.promptTokens += bm.promptTokens ?? 0; cur.completionTokens += bm.completionTokens ?? 0;
          cur.totalTokens += bm.totalTokens ?? 0; cur.estimatedCostUsd += bm.estimatedCostUsd ?? 0; cur.totalDurationMs += (bm.avgDurationMs ?? 0) * (bm.calls ?? 1);
          modelAgg.set(k, cur);
        }
      }
      return { chapterNumber: a.chapterNumber, promptTokens: pt, completionTokens: ct, totalTokens: tt, estimatedCostUsd: Number(cost.toFixed(6)), totalCalls: calls, byProvider: p.byProvider ?? [], byModel: p.byModel ?? [] };
    });

    const byProvider = [...providerAgg.entries()].map(([provider, b]) => ({ provider, ...b, estimatedCostUsd: Number(b.estimatedCostUsd.toFixed(6)) })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    const byModel = [...modelAgg.entries()].map(([model, b]) => ({ model, provider: b.provider, tier: b.tier, calls: b.calls, promptTokens: b.promptTokens, completionTokens: b.completionTokens, totalTokens: b.totalTokens, estimatedCostUsd: Number(b.estimatedCostUsd.toFixed(6)), avgDurationMs: Number((b.totalDurationMs / Math.max(1, b.calls)).toFixed(2)) })).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    return { bookId, totalPromptTokens, totalCompletionTokens, totalTokens, totalCostUsd: Number(totalCostUsd.toFixed(6)), totalCalls, byProvider, byModel, chapters };
  }

  async getBook(bookId: string): Promise<unknown> {
    const state = await this.loadBookState(bookId);
    const latestKpi = state.kpiHistory[state.kpiHistory.length - 1] ?? null;
    const chapterCount = await this.chapterRepo.count({ where: { bookId } });
    return {
      bookId: state.bookId,
      title: state.seed.title,
      genre: state.seed.genre ?? '',
      chapterCursor: state.chapterCursor,
      chaptersGenerated: Math.max(Math.max(0, state.chapterCursor - 1), chapterCount),
      hasBible: !!state.bible,
      openPlotThreads: state.openPlotThreads,
      currentArc: state.currentArc ?? null,
      completedArcs: state.completedArcs ?? [],
      currentArcAcceptance: state.currentArcAcceptance ?? null,
      completedArcAcceptanceReports: state.completedArcAcceptanceReports ?? [],
      latestKpi: latestKpi
        ? { qualityScore: latestKpi.qualityScore, overallScore: latestKpi.overallScore }
        : null,
    };
  }

  async getQualityStats(bookId: string): Promise<Record<string, unknown>> {
    const state = await this.loadBookState(bookId);
    const kpi = state.kpiHistory;
    const total = kpi.length;
    if (total === 0) return { bookId, totalChapters: 0, message: '暂无生成数据' };

    const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : 0;
    const rate = (arr: boolean[]) => arr.length ? Math.round((arr.filter(Boolean).length / arr.length) * 1000) / 10 : 0;

    const [executions, reviews] = await Promise.all([
      this.workflowExecutionRepo.find({ where: { bookId, status: 'completed' }, select: ['chapterNumber', 'summary'] }),
      this.artifactRepo.find({ where: { bookId, name: 'review' }, select: ['chapterNumber', 'payload'], order: { chapterNumber: 'ASC' } }),
    ]);

    const avgAttempts = executions.length
      ? Math.round((executions.reduce((s, e) => s + (e.summary?.totalLoopAttempts ?? 1), 0) / executions.length) * 100) / 100
      : 1;
    const polishRate = executions.length
      ? Math.round((executions.filter((e) => (e.summary?.totalLoopAttempts ?? 1) > 1).length / executions.length) * 1000) / 10
      : 0;

    const dims = { engagement: [] as number[], pacing: [] as number[], hookStrength: [] as number[], consistency: [] as number[], proseQuality: [] as number[], characterDepth: [] as number[] };
    for (const r of reviews) {
      const d = (r.payload as any)?.dimensions;
      if (!d) continue;
      for (const key of Object.keys(dims) as (keyof typeof dims)[]) {
        if (typeof d[key] === 'number') dims[key].push(d[key]);
      }
    }

    const qm = state.qualityMetricsHistory ?? [];
    const qmRecent = qm.slice(-10);
    const avgQm = (fn: (m: typeof qm[0]) => number) => qm.length ? Math.round((qm.reduce((s, m) => s + fn(m), 0) / qm.length) * 1000) / 1000 : 0;

    return {
      bookId, totalChapters: total,
      avgOverallScore: avg(kpi.map((k) => k.overallScore)),
      avgQualityScore: avg(kpi.map((k) => k.qualityScore)),
      firstPassRate: rate(kpi.map((k) => k.qualityPass)),
      hardPassRate: rate(kpi.map((k) => k.hardPass)),
      continuityPassRate: rate(kpi.map((k) => k.continuityPass)),
      avgRewriteRounds: avgAttempts,
      polishTriggerRate: polishRate,
      dimensionAverages: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, avg(v)])),
      recentTrend: kpi.slice(-10).map((k, i) => ({ chapter: total - kpi.slice(-10).length + i + 1, overall: k.overallScore, quality: k.qualityScore })),
      qualityMetrics: {
        avgHookRepeatRate: avgQm((m) => m.hookRepeatRate),
        avgArcHitRate: avgQm((m) => m.characterArcHitRate),
        avgCoreAbsenceRate: avgQm((m) => m.coreAbsenceRate),
        avgCameoOveruseRate: avgQm((m) => m.cameoOveruseRate),
        totalGenreMismatch: qm.reduce((s, m) => s + (m.genreMismatchFlags?.length ?? 0), 0),
        recentTrend: qmRecent.map((m) => ({
          ch: m.chapterNumber,
          hookRepeat: m.hookRepeatRate,
          arcHit: m.characterArcHitRate,
          coreAbsence: m.coreAbsenceRate,
          present: m.presentCharacterCount,
          fading: m.fadingCount,
        })),
      },
    };
  }

  async generateChapter(bookId: string): Promise<unknown> {
    return this.withBookLock(bookId, async () => {
      const result = await this.generateChapterUnsafe(bookId);
      return this.toPublicResult(result);
    });
  }

  async generateChaptersBatch(bookId: string, dto: GenerateChaptersBatchDto): Promise<unknown> {
    return this.withBookLock(bookId, async () => {
      const batchStart = Date.now();
      const count = dto.chapterCount;
      const maxRepairRounds = dto.maxRepairRounds ?? 2;
      const minQualityScore = Math.max(dto.minQualityScore ?? 7, 7);
      const minOverallScore = Math.max(dto.minOverallScore ?? 7, 7);

      this.logger.log(
        `[batch] ========== 批量生成开始 ==========\n` +
        `  bookId: ${bookId} | 目标章数: ${count}\n` +
        `  修复轮数: ${maxRepairRounds} | 质量门控: 强制开启\n` +
        `  阈值: quality>=${minQualityScore}, overall>=${minOverallScore}`,
      );

      const chapters: unknown[] = [];
      let stopReason: string | null = null;

      for (let i = 0; i < count; i++) {
        this.logger.log(`[batch] 进度: ${i + 1}/${count}`);
        const result = await this.generateChapterUnsafe(bookId, { maxRepairRounds });
        chapters.push(this.toPublicResult(result));

        const chapterQualityScore = result.review.dimensions.proseQuality;
        const chapterOverallScore = result.overallScore;
        const belowThreshold =
          chapterQualityScore < minQualityScore ||
          chapterOverallScore < minOverallScore;

        if (belowThreshold) {
          stopReason = `quality_threshold_failed_at_chapter_${result.finalDraft.chapterNumber}`;
          break;
        }
      }

      const state = await this.loadBookState(bookId);
      this.logger.log(
        `[batch] ========== 批量完成 ========== ${Date.now() - batchStart}ms\n` +
        `  生成: ${chapters.length}/${count} | 停止: ${stopReason ?? '全部完成'}`,
      );

      return {
        bookId,
        requestedChapters: count,
        generatedChapters: chapters.length,
        stopReason,
        nextChapterCursor: state.chapterCursor,
        chapters,
      };
    });
  }

  async getChapter(bookId: string, chapterNumber: number): Promise<unknown> {
    const chapter = await this.chapterRepo.findOneBy({ bookId, chapterNumber });
    if (!chapter) throw new NotFoundException(`Chapter not found: ${bookId}#${chapterNumber}`);
    return {
      bookId: chapter.bookId,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.content,
      createdAt: chapter.createdAt.toISOString(),
    };
  }

  async getChapterArtifacts(
    bookId: string,
    chapterNumber: number,
    namesRaw?: string,
  ): Promise<unknown> {
    const chapter = await this.chapterRepo.findOneBy({ bookId, chapterNumber });
    if (!chapter) {
      throw new NotFoundException(`Chapter not found: ${bookId}#${chapterNumber}`);
    }

    const requestedNames = (namesRaw ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const names = [...new Set(requestedNames.length > 0 ? requestedNames : DEFAULT_TRACE_ARTIFACT_NAMES)];
    if (names.length > 30) {
      throw new UnprocessableEntityException('Artifact names exceed limit (max 30)');
    }
    const fetchNames = [...new Set([...names, 'arc_director', 'intent'])];

    const artifacts = await this.artifactRepo.find({
      where: {
        bookId,
        chapterNumber,
        name: In(fetchNames),
      },
    });
    const payloadByName = new Map(artifacts.map((artifact) => [artifact.name, artifact.payload]));
    const alignment = this.computeChapterTraceAlignment(
      chapter.content,
      this.asRecord(payloadByName.get('arc_director')),
      this.asRecord(payloadByName.get('intent')),
    );

    return {
      bookId,
      chapterNumber,
      names,
      artifacts: names.map((name) => ({
        name,
        found: payloadByName.has(name),
        payload: payloadByName.get(name) ?? null,
      })),
      alignment,
    };
  }

  private computeChapterTraceAlignment(
    chapterContent: string,
    arcPayload: Record<string, unknown> | null,
    intentPayload: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    const contentNorm = this.normalizeForMatch(chapterContent);
    if (!contentNorm) return null;

    const mustHitItems = this.toStringArray(arcPayload?.mustHit).map((text) => ({
      text,
      ...this.scoreGuidanceMatch(text, contentNorm),
    }));
    const intentGoalItems = this.toStringArray(intentPayload?.goals).map((text) => ({
      text,
      ...this.scoreGuidanceMatch(text, contentNorm),
    }));

    const hookText = this.firstNonEmptyString([
      intentPayload?.hookDirection,
      arcPayload?.hookDirective,
    ]);
    const tailNorm = this.normalizeForMatch(
      chapterContent.slice(-Math.min(chapterContent.length, TRACE_HOOK_TAIL_CHARS)),
    );
    const hookMatch = hookText
      ? { text: hookText, ...this.scoreGuidanceMatch(hookText, tailNorm) }
      : null;

    const mustHitScore = this.aggregateMatchScore(mustHitItems);
    const intentScore = this.aggregateMatchScore(intentGoalItems);
    const hookScore = hookMatch ? hookMatch.matchScore : null;
    const weighted: Array<{ score: number; weight: number }> = [];
    if (mustHitScore !== null) weighted.push({ score: mustHitScore, weight: 0.5 });
    if (intentScore !== null) weighted.push({ score: intentScore, weight: 0.35 });
    if (hookScore !== null) weighted.push({ score: hookScore, weight: 0.15 });
    const weightSum = weighted.reduce((sum, part) => sum + part.weight, 0);
    const overall = weightSum > 0
      ? Math.round((weighted.reduce((sum, part) => sum + (part.score * part.weight), 0) / weightSum) * 100)
      : null;
    const remediation = this.buildTraceRemediation(
      overall,
      mustHitItems,
      intentGoalItems,
      hookMatch,
    );

    return {
      overallAlignmentScore: overall,
      mustHit: {
        total: mustHitItems.length,
        matched: mustHitItems.filter((item) => item.matched).length,
        score: mustHitScore,
        items: mustHitItems,
      },
      intentGoals: {
        total: intentGoalItems.length,
        matched: intentGoalItems.filter((item) => item.matched).length,
        score: intentScore,
        items: intentGoalItems,
      },
      hookDirection: hookMatch,
      remediation,
    };
  }

  private buildTraceRemediation(
    overallScore: number | null,
    mustHitItems: Array<{ text: string; matched: boolean; matchScore: number }>,
    intentGoalItems: Array<{ text: string; matched: boolean; matchScore: number }>,
    hookMatch: { text: string; matched: boolean; matchScore: number } | null,
  ): Record<string, unknown> {
    const unmatchedMustHit = mustHitItems
      .filter((item) => !item.matched)
      .map((item) => item.text);
    const weakIntentGoals = intentGoalItems
      .filter((item) => item.matchScore < TRACE_MATCH_GOOD_THRESHOLD)
      .map((item) => item.text);
    const hookWeak = hookMatch ? hookMatch.matchScore < TRACE_MATCH_GOOD_THRESHOLD : false;

    const hasSignals =
      mustHitItems.length > 0 ||
      intentGoalItems.length > 0 ||
      Boolean(hookMatch);
    if (!hasSignals) {
      return {
        shouldRewrite: false,
        severity: 'low',
        reasons: ['缺少可评估的对齐数据'],
        suggestedActions: [],
        rewritePrompt: null,
      };
    }

    const shouldRewrite = overallScore !== null && overallScore < TRACE_REWRITE_THRESHOLD;
    const severity: 'low' | 'medium' | 'high' =
      overallScore !== null && overallScore < TRACE_CRITICAL_THRESHOLD
        ? 'high'
        : shouldRewrite
          ? 'medium'
          : 'low';

    const reasons: string[] = [];
    if (unmatchedMustHit.length > 0) {
      reasons.push(`mustHit 未命中 ${unmatchedMustHit.length} 条`);
    }
    if (weakIntentGoals.length > 0) {
      reasons.push(`章节目标弱命中 ${weakIntentGoals.length} 条`);
    }
    if (hookWeak) {
      reasons.push('结尾钩子与预期方向偏离');
    }
    if (reasons.length === 0 && overallScore !== null) {
      reasons.push(`总体对齐分 ${overallScore}，建议微调`);
    }

    const suggestedActions: string[] = [];
    if (unmatchedMustHit.length > 0) {
      suggestedActions.push(
        `补写 mustHit 场景：${unmatchedMustHit.slice(0, 3).join('；')}`,
      );
    }
    if (weakIntentGoals.length > 0) {
      suggestedActions.push(
        `强化章节目标推进：${weakIntentGoals.slice(0, 3).join('；')}`,
      );
    }
    if (hookWeak && hookMatch) {
      suggestedActions.push(`重写章末钩子，贴合方向：${hookMatch.text}`);
    }
    if (suggestedActions.length === 0) {
      suggestedActions.push('保持当前章节结构，做局部措辞与节奏优化');
    }

    const rewritePrompt = shouldRewrite
      ? [
          '你是小说修订编辑，请在不破坏既有设定的前提下重写本章。',
          '重写目标：优先补齐以下对齐缺口。',
          ...unmatchedMustHit.map((text, idx) => `${idx + 1}. 必须命中：${text}`),
          ...weakIntentGoals.map((text, idx) => `${idx + 1}. 强化目标：${text}`),
          ...(hookWeak && hookMatch ? [`章末钩子方向：${hookMatch.text}`] : []),
          '约束：角色与设定不变；冲突更明确；结尾保留下一章驱动力。',
        ].join('\n')
      : null;

    return {
      shouldRewrite,
      severity,
      reasons,
      suggestedActions,
      rewritePrompt,
    };
  }

  private aggregateMatchScore(
    items: Array<{ matched: boolean; matchScore: number }>,
  ): number | null {
    if (items.length === 0) return null;
    const total = items.reduce((sum, item) => sum + item.matchScore, 0);
    return Math.round((total / items.length) * 100) / 100;
  }

  private scoreGuidanceMatch(
    guidance: string,
    contentNorm: string,
  ): { matched: boolean; matchScore: number } {
    const normalizedGuidance = this.normalizeForMatch(guidance);
    if (!normalizedGuidance) return { matched: false, matchScore: 0 };
    if (contentNorm.includes(normalizedGuidance)) return { matched: true, matchScore: 1 };

    const tokens = this.extractGuidanceTokens(guidance);
    if (tokens.length === 0) return { matched: false, matchScore: 0 };
    const matchedTokenCount = tokens.filter((token) => contentNorm.includes(token)).length;
    const tokenScore = matchedTokenCount / tokens.length;
    const matched =
      tokenScore >= TRACE_MATCH_GOOD_THRESHOLD ||
      (matchedTokenCount >= 2 && tokenScore >= 0.45);
    return {
      matched,
      matchScore: Math.round(tokenScore * 100) / 100,
    };
  }

  private extractGuidanceTokens(text: string): string[] {
    const baseTokens = text
      .split(/[\s,，。！？、；;:：\n\r\t"“”'‘’()（）【】\[\]<>《》]/g)
      .map((token) => this.normalizeForMatch(token))
      .filter((token) => token.length >= 2);
    const uniq = [...new Set(baseTokens)].slice(0, 8);
    if (uniq.length > 0) return uniq;

    const normalized = this.normalizeForMatch(text);
    if (!normalized) return [];
    if (normalized.length <= 4) return [normalized];

    const fallback: string[] = [];
    const step = normalized.length <= 10 ? 2 : 3;
    for (let idx = 0; idx <= normalized.length - 2 && fallback.length < 8; idx += step) {
      fallback.push(normalized.slice(idx, idx + 2));
    }
    return [...new Set(fallback)].filter((token) => token.length >= 2);
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }

  private firstNonEmptyString(values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private normalizeForMatch(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。！？、；：,.!?;:()（）【】\[\]{}"'“”‘’`~\-_/\\|<>《》]/g, '');
  }

  async updateChapter(
    bookId: string,
    chapterNumber: number,
    update: UpdateChapterPayload,
  ): Promise<unknown> {
    return this.withBookLock(bookId, async () => {
      const chapter = await this.chapterRepo.findOneBy({ bookId, chapterNumber });
      if (!chapter) throw new NotFoundException(`Chapter not found: ${bookId}#${chapterNumber}`);

      const patch: Partial<Pick<ChapterEntity, 'title' | 'content'>> = {};
      if (update.title !== undefined) patch.title = update.title;
      if (update.content !== undefined) patch.content = update.content;

      if (Object.keys(patch).length === 0) {
        return {
          bookId: chapter.bookId,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          content: chapter.content,
          createdAt: chapter.createdAt.toISOString(),
          stateResync: { status: 'not_requested' as const },
        };
      }

      const prevContent = chapter.content;
      await this.chapterRepo.update({ bookId, chapterNumber }, patch);
      const updated = await this.chapterRepo.findOneBy({ bookId, chapterNumber });
      if (!updated) throw new NotFoundException(`Chapter not found: ${bookId}#${chapterNumber}`);

      let stateResync: ChapterResyncResult = { status: 'not_requested' };
      const contentChanged = update.content !== undefined && update.content !== prevContent;
      const shouldResync = update.resyncState ?? true;
      if (contentChanged && shouldResync) {
        try {
          stateResync = await this.enqueueChapterResyncJob(
            bookId,
            updated.chapterNumber,
            'updateChapter',
          );
        } catch (err: any) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `[updateChapter] 状态回灌入队失败 bookId=${bookId} chapter=${chapterNumber}: ${message}`,
          );
          stateResync = {
            status: 'failed',
            message: `状态回灌入队失败: ${message}`,
          };
        }
      }

      return {
        bookId: updated.bookId,
        chapterNumber: updated.chapterNumber,
        title: updated.title,
        content: updated.content,
        createdAt: updated.createdAt.toISOString(),
        stateResync,
      };
    });
  }

  async getChapterResyncJob(bookId: string, jobId: string): Promise<unknown> {
    const job = await this.chapterResyncJobRepo.findOneBy({ jobId, bookId });
    if (!job) {
      throw new NotFoundException(`Chapter resync job not found: ${bookId}/${jobId}`);
    }
    return this.toChapterResyncJobView(job);
  }

  private toChapterResyncJobView(
    job: ChapterResyncJobEntity,
  ): Record<string, unknown> {
    const stateResync = this.toChapterResyncResult(job);
    return {
      jobId: job.jobId,
      bookId: job.bookId,
      requestedBy: job.requestedBy,
      requestedRange: {
        startChapter: job.requestedStartChapter,
        endChapter: job.requestedEndChapter,
      },
      effectiveRange:
        job.effectiveStartChapter != null && job.effectiveEndChapter != null
          ? {
              startChapter: job.effectiveStartChapter,
              endChapter: job.effectiveEndChapter,
            }
          : null,
      progress: {
        completedChapters: job.completedChapters,
        totalChapters: job.totalChapters,
        currentChapter: job.progressChapter,
        message: job.progressMessage,
      },
      scheduler: {
        status: job.status,
        startedAt: job.startedAt ? job.startedAt.toISOString() : null,
        finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      },
      lastError: job.lastError,
      lastResult: job.lastResult,
      stateResync,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  private toChapterResyncResult(job: ChapterResyncJobEntity): ChapterResyncResult {
    const raw = (job.lastResult ?? {}) as Partial<ChapterResyncResult>;
    let status: ChapterResyncStatus;
    if (job.status === 'queued') {
      status = 'queued';
    } else if (job.status === 'running') {
      status = 'running';
    } else if (job.status === 'failed') {
      status = 'failed';
    } else if (job.status === 'skipped') {
      const candidate = raw.status;
      status =
        candidate === 'skipped_missing_snapshot' ||
        candidate === 'skipped_too_many_chapters' ||
        candidate === 'skipped_missing_chapters'
          ? candidate
          : 'skipped_missing_chapters';
    } else {
      status = raw.status === 'synced_forward' ? 'synced_forward' : 'synced';
    }

    return {
      status,
      jobId: job.jobId,
      message: raw.message ?? job.progressMessage ?? job.lastError ?? undefined,
      requestedStartChapter: job.requestedStartChapter,
      requestedEndChapter: job.requestedEndChapter,
      effectiveStartChapter: job.effectiveStartChapter ?? undefined,
      effectiveEndChapter: job.effectiveEndChapter ?? undefined,
      completedChapters: job.completedChapters,
      totalChapters: job.totalChapters ?? undefined,
      progressChapter: job.progressChapter ?? undefined,
      requestedAt: job.createdAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    };
  }

  async getWorld(bookId: string): Promise<unknown> {
    const state = await this.loadBookState(bookId);
    return {
      bookId: state.bookId,
      title: state.seed.title,
      genre: state.seed.genre ?? '',
      seed: {
        logline: state.seed.logline,
        tone: state.seed.tone,
        coreConflictDirection: state.seed.coreConflictDirection,
        redLines: state.seed.redLines,
        protagonistConcept: state.seed.protagonistConcept,
      },
      bible: state.bible ?? null,
      characters: state.characters,
      locations: state.locations,
      items: state.items,
      relationGraph: state.relationGraph ?? [],
      openPlotThreads: state.openPlotThreads,
      plotThreadLedger: state.plotThreadLedger ?? [],
      currentArc: state.currentArc ?? null,
      completedArcs: state.completedArcs ?? [],
      currentArcAcceptance: state.currentArcAcceptance ?? null,
      completedArcAcceptanceReports: state.completedArcAcceptanceReports ?? [],
      roughOutline: state.roughOutline,
      chapterSummaries: state.chapterSummaries,
    };
  }

  async getArcContract(bookId: string): Promise<unknown> {
    const state = await this.loadBookState(bookId);
    const trigger = this.deepMaintenance.evaluateTrigger(state);
    return {
      bookId: state.bookId,
      currentArc: state.currentArc ?? null,
      currentArcAcceptance: state.currentArcAcceptance ?? null,
      completedArcAcceptanceReports: (state.completedArcAcceptanceReports ?? []).slice(-10),
      arcPlanningHint: {
        shouldPlanNextArc: trigger.shouldTrigger && trigger.tasks.includes('arc_planning'),
        reasons: trigger.reasons,
      },
    };
  }

  async listChapters(bookId: string, limit: number): Promise<unknown> {
    if (!(await this.bookStateRepo.exists(bookId))) throw new NotFoundException(`Book not found: ${bookId}`);
    const normalizedLimit = Math.max(1, Math.min(200, limit));
    const chapters = await this.chapterRepo.find({
      where: { bookId },
      order: { chapterNumber: 'DESC' },
      take: normalizedLimit,
    });
    return {
      bookId,
      count: chapters.length,
      chapters: chapters.map((ch) => ({
        bookId: ch.bookId,
        chapterNumber: ch.chapterNumber,
        title: ch.title,
        content: ch.content,
        createdAt: ch.createdAt.toISOString(),
      })),
    };
  }

  private async loadChapterCountMap(bookIds: string[]): Promise<Map<string, number>> {
    if (bookIds.length === 0) return new Map<string, number>();
    const rows = await this.chapterRepo
      .createQueryBuilder('chapter')
      .select('chapter.bookId', 'bookId')
      .addSelect('COUNT(*)', 'count')
      .where('chapter.bookId IN (:...bookIds)', { bookIds })
      .groupBy('chapter.bookId')
      .getRawMany<{ bookId: string; count: string }>();
    const result = new Map<string, number>();
    for (const row of rows) result.set(row.bookId, Number(row.count) || 0);
    return result;
  }

  private async loadLatestChapterNumber(bookId: string): Promise<number> {
    const row = await this.chapterRepo
      .createQueryBuilder('chapter')
      .select('MAX(chapter.chapterNumber)', 'maxChapter')
      .where('chapter.bookId = :bookId', { bookId })
      .getRawOne<{ maxChapter: string | null }>();
    return Number(row?.maxChapter ?? 0) || 0;
  }

  private async healChapterCursorIfBehind(bookId: string, state: StoryState): Promise<StoryState> {
    const latestChapterNumber = await this.loadLatestChapterNumber(bookId);
    if (latestChapterNumber < state.chapterCursor) return state;
    const fixedCursor = latestChapterNumber + 1;
    const healed = { ...state, chapterCursor: fixedCursor, updatedAt: new Date().toISOString() };
    await this.persistBookState(healed);
    this.logger.warn(
      `[cursor-heal] 检测到游标落后，已自动修复 bookId=${bookId} cursor=${state.chapterCursor} -> ${fixedCursor} latestChapter=${latestChapterNumber}`,
    );
    return healed;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async generateChapterUnsafe(
    bookId: string,
    runtimeOptions?: GenerateChapterRuntimeOptions,
  ): Promise<ChapterWorkflowResult> {
    let state = await this.runPreStep(bookId, 0, 'loadBookState', () => this.loadBookState(bookId), true);
    state = await this.healChapterCursorIfBehind(bookId, state);
    const chapterNumber = state.chapterCursor;

    return this.llmUsageTracker.runWithChapterScope(
      { bookId, chapterNumber },
      async () => {
        try {
          if (!state.currentArc) {
            state = await this.runPreStep(bookId, chapterNumber, 'bootstrapInitialArc',
              () => this.deepMaintenance.bootstrapInitialArc(state), true);
            await this.persistBookState(state); // arc 创建后立即落盘，避免后续失败导致 arc 反复重建
          }
          if (!state.bookStrategy) {
            state.bookStrategy = await this.bookStrategyAgent.generateInitial({
              seed: state.seed,
              outline: state.roughOutline,
              audienceDirective: state.audienceDirective,
              profile: state.bookPromptProfile,
            });
            await this.persistBookState(state);
          }
          if (state.agentSectionsStatus === 'pending') {
            try {
              const profile = state.bookPromptProfile;
              const genre = state.seed.genre ?? '';
              const baseRuleAtoms = await this.promptTplService.getRuleAtoms(bookId);
              const sections = await this.promptProfiler.generateAgentSections(genre, profile, baseRuleAtoms);
              if (sections) {
                await this.promptTplService.initWithGenerated(bookId, sections, baseRuleAtoms);
                state.agentSectionsStatus = 'generated';
                await this.persistBookState(state);
                this.logger.log(`[ch${chapterNumber}] agentSections 重试成功`);
              }
            } catch (e) {
              this.logPreStepWarn(bookId, chapterNumber, 'agentSectionsRetry', e);
            }
          }

          await this.persistArtifact(bookId, Math.max(0, chapterNumber - 1), 'state_snapshot', state)
            .catch(e => this.logPreStepWarn(bookId, chapterNumber, 'persistStateSnapshot', e));
          const previousChapterEnding = await this.getPreviousChapterEnding(bookId, chapterNumber)
            .catch(e => { this.logPreStepWarn(bookId, chapterNumber, 'getPreviousChapterEnding', e); return undefined; });
          const pipelineNodes = await this.runPreStep(bookId, chapterNumber, 'getPublishedNodes',
            () => this.pipelineService.getPublishedNodes(bookId), true);
          const result = await this.chapterWorkflow.run(
            state,
            previousChapterEnding,
            pipelineNodes,
            { maxRepairRounds: runtimeOptions?.maxRepairRounds },
          );

          // Persist chapter text.
          await this.chapterRepo.upsert(
            {
              bookId,
              chapterNumber: result.finalDraft.chapterNumber,
              title: result.finalDraft.title,
              content: result.finalDraft.content,
            },
            ['bookId', 'chapterNumber'],
          );

          // 章节文本一旦落库，立即推进游标并持久化，避免后续步骤失败导致游标滞后。
          state.chapterCursor = Math.max(state.chapterCursor, result.finalDraft.chapterNumber + 1);
          state.updatedAt = new Date().toISOString();
          await this.persistBookState(state);

          // Persist artifacts.
          const chapterArtifacts: Array<{ name: string; data: unknown }> = [
            { name: 'intent', data: result.intent },
            { name: 'review', data: result.review },
            { name: 'deterministic_check', data: result.deterministicCheck },
            { name: 'lore_record', data: result.loreRecord },
          ];
          if (result.arcDirective) {
            chapterArtifacts.unshift({ name: 'arc_director', data: result.arcDirective });
          }
          await this.persistArtifactsBatch(bookId, chapterNumber, chapterArtifacts);

          // Update high-fidelity detail store (角色细节档案) based on this chapter.
          await this.updateDetailStoreFromChapter(
            bookId,
            result.finalDraft,
            result.loreRecord,
          );

          // Persist structured chapter memory for long-range retrieval.
          await this.memoryRetriever.persistChapterMemory(
            bookId, chapterNumber, result.finalDraft,
            result.loreRecord, state, result.intent,
          ).catch((err) => this.logger.warn(`[ch${chapterNumber}] 章节记忆持久化失败: ${err}`));

          // Apply lore: creates new world elements + applies deltas.
          state = this.loreService.applyLore(state, result.loreRecord, result.intent);

          // Apply voice evolution: catchphrases, gesture fingerprints, emotional voice map.
          if (result.voiceEvolution) state = this.voiceCoach.applyVoiceEvolution(state, result.voiceEvolution, chapterNumber);

          // Update feedback confidence decay.
          state.feedbackState = this.updateFeedbackConfidence(state.feedbackState ?? { history: [], lastAnalyzedAtChapter: 0, gapSinceLastFeedback: 0, pendingCommentCount: 0, sentimentHistory: [], confidence: 'none' }, chapterNumber);

          // Extract distinctive phrases for anti-repetition tracking.
          state = this.updateDistinctivePhrases(state, result.finalDraft.content);

          // Update maintenance counters.
          const updatedMaintenance = this.recorder.updateMaintenanceCounters(
            state.maintenance,
            result.loreRecord,
          );
          state = {
            ...state,
            maintenance: this.updateMaintenanceQualitySignals(
              updatedMaintenance,
              result,
            ),
          };

          // Roll forward state.
          state.updatedAt = new Date().toISOString();
          state.kpiHistory.push(generationKpiSchema.parse({
            hardPass: result.deterministicCheck.pass,
            continuityPass: result.review.dimensions.consistency >= 7,
            qualityPass: result.review.dimensions.proseQuality >= 7,
            juryPass: result.review.dimensions.engagement >= 7,
            qualityScore: result.review.dimensions.proseQuality,
            overallScore: result.overallScore,
          }));
          if (result.qualityMetrics) {
            const qm = result.qualityMetrics as {
              chapterNumber: number; hookRepeatRate: number; characterArcHitRate: number;
              genreMismatchFlags: string[]; coreAbsenceRate: number; cameoOveruseRate: number;
              fadingCount: number; presentCharacterCount: number; newCharactersInArc: number;
            };
            if (!state.qualityMetricsHistory) state.qualityMetricsHistory = [];
            state.qualityMetricsHistory.push(qm);
          }

          // Apply retroactive foreshadowing seeds to past chapters.
          try {
            state = await this.applyPendingForeshadowing(state, chapterNumber);
          } catch (e) { this.logPreStepWarn(bookId, chapterNumber, 'applyPendingForeshadowing', e); }

          // Compact and check maintenance trigger.
          state = this.compactState(state);
          try {
            const trigger = this.deepMaintenance.evaluateTrigger(state);
            if (trigger.shouldTrigger) {
              state = await this.deepMaintenance.execute(state, trigger);
              await this.persistArtifact(bookId, chapterNumber, 'maintenance_trigger', trigger);
            }
          } catch (e) { this.logPreStepWarn(bookId, chapterNumber, 'deepMaintenance', e); }

          await this.persistBookState(state); // 保存最终 state（含伏笔/维护更新）
          await this.persistArtifact(bookId, chapterNumber, 'state_snapshot', state);
          return result;
        } finally {
          const usage = this.llmUsageTracker.consumeCurrentSummary();
          if (usage) {
            try {
              await this.persistArtifact(bookId, chapterNumber, 'llm_usage_summary', usage);
            } catch {
              // ignore non-critical artifact persistence failure
            }
          }
        }
      },
    );
  }

  /**
   * Enqueue background chapter-resync job after manual chapter edits.
   */
  private async enqueueChapterResyncJob(
    bookId: string,
    startChapterNumber: number,
    requestedBy: string,
  ): Promise<ChapterResyncResult> {
    const currentState = await this.loadBookState(bookId);
    const latestChapterNumber = currentState.chapterCursor - 1;
    const replayCount = latestChapterNumber - startChapterNumber + 1;

    if (replayCount <= 0) {
      return {
        status: 'skipped_missing_chapters',
        message: `当前没有可回放章节（start=${startChapterNumber}, latest=${latestChapterNumber})`,
      };
    }
    if (replayCount > MAX_CHAPTER_RESYNC_CHAPTERS) {
      return {
        status: 'skipped_too_many_chapters',
        message: `回灌跨度 ${replayCount} 章，超过上限 ${MAX_CHAPTER_RESYNC_CHAPTERS} 章`,
      };
    }

    const jobId = randomUUID();
    const now = new Date();
    const jobEntity = this.chapterResyncJobRepo.create({
      jobId,
      bookId,
      requestedStartChapter: startChapterNumber,
      requestedEndChapter: latestChapterNumber,
      status: 'queued',
      requestedBy,
      effectiveStartChapter: null,
      effectiveEndChapter: null,
      totalChapters: replayCount,
      completedChapters: 0,
      progressChapter: null,
      progressMessage: '已入队，等待处理',
      lastError: null,
      lastResult: null,
      startedAt: null,
      finishedAt: null,
    });
    await this.chapterResyncJobRepo.save(jobEntity);
    try {
      await this.chapterResyncQueue.add(
        'chapter-resync',
        { jobId },
        { jobId: `chapter-resync:${jobId}` },
      );
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      await this.chapterResyncJobRepo.update(
        { jobId },
        {
          status: 'failed',
          lastError: message,
          progressMessage: `入队失败: ${message}`,
          finishedAt: new Date(),
        },
      );
      throw err;
    }

    return {
      status: 'queued',
      jobId,
      message: `已加入后台重放队列（${startChapterNumber}-${latestChapterNumber}）`,
      requestedStartChapter: startChapterNumber,
      requestedEndChapter: latestChapterNumber,
      totalChapters: replayCount,
      requestedAt: now.toISOString(),
    };
  }

  async processChapterResyncJob(jobId: string): Promise<Record<string, unknown>> {
    const queued = await this.chapterResyncJobRepo.findOneBy({ jobId });
    if (!queued) {
      return { jobId, skipped: true, reason: 'job_not_found' };
    }

    const claim = await this.chapterResyncJobRepo
      .createQueryBuilder()
      .update(ChapterResyncJobEntity)
      .set({
        status: 'running',
        startedAt: () => 'NOW()',
        finishedAt: null,
        lastError: null,
        progressMessage: '开始回放',
        updatedAt: () => 'NOW()',
      })
      .where('jobId = :jobId', { jobId })
      .andWhere('status = :status', { status: 'queued' })
      .execute();

    if (claim.affected === 0) {
      const existing = await this.chapterResyncJobRepo.findOneBy({ jobId });
      return {
        jobId,
        skipped: true,
        reason: 'job_not_claimable',
        status: existing?.status ?? 'missing',
      };
    }

    const claimed = await this.chapterResyncJobRepo.findOneByOrFail({ jobId });
    this.logger.log(
      `[chapter-resync] job=${jobId} book=${claimed.bookId} range=${claimed.requestedStartChapter}-${claimed.requestedEndChapter} 开始`,
    );

    try {
      const result = await this.withBookLock(claimed.bookId, async () =>
        this.syncChapterAndForwardAfterManualEdit(
          claimed.bookId,
          claimed.requestedStartChapter,
          claimed.requestedEndChapter,
          {
            onProgress: async (progress) => {
              await this.chapterResyncJobRepo.update(
                { jobId },
                {
                  completedChapters: progress.completed,
                  totalChapters: progress.total,
                  progressChapter: progress.chapterNumber,
                  progressMessage: progress.message,
                },
              );
            },
          },
        ),
      );

      const finalStatus: ChapterResyncJobStatus =
        result.status === 'synced' || result.status === 'synced_forward'
          ? 'completed'
          : result.status.startsWith('skipped_')
            ? 'skipped'
            : 'failed';
      await this.chapterResyncJobRepo.update(
        { jobId },
        {
          status: finalStatus,
          effectiveStartChapter: result.effectiveStartChapter ?? null,
          effectiveEndChapter: result.effectiveEndChapter ?? null,
          completedChapters: result.completedChapters ?? 0,
          totalChapters: result.totalChapters ?? null,
          progressChapter: result.progressChapter ?? null,
          progressMessage:
            finalStatus === 'completed'
              ? '回放完成'
              : result.message ?? '回放结束',
          lastError: finalStatus === 'failed' ? (result.message ?? '回放失败') : null,
          lastResult: result as unknown as Record<string, unknown>,
          finishedAt: new Date(),
        },
      );
      this.logger.log(`[chapter-resync] job=${jobId} 完成 status=${finalStatus}`);
      return {
        jobId,
        status: finalStatus,
        result,
      };
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      await this.chapterResyncJobRepo.update(
        { jobId },
        {
          status: 'failed',
          progressMessage: `回放失败: ${message}`,
          lastError: message,
          finishedAt: new Date(),
        },
      );
      this.logger.error(`[chapter-resync] job=${jobId} 失败: ${message}`);
      return {
        jobId,
        status: 'failed',
        message,
      };
    }
  }

  /**
   * Rebuild lore/state/detail-store from edited chapter to latest chapter.
   */
  private async syncChapterAndForwardAfterManualEdit(
    bookId: string,
    editedChapterNumber: number,
    requestedEndChapter?: number,
    options?: ChapterResyncRunOptions,
  ): Promise<ChapterResyncResult> {
    const currentState = await this.loadBookState(bookId);
    const latestChapterNumber = currentState.chapterCursor - 1;
    const effectiveEndChapter = Math.max(
      latestChapterNumber,
      requestedEndChapter ?? latestChapterNumber,
    );
    const replayCount = effectiveEndChapter - editedChapterNumber + 1;

    if (replayCount <= 0) {
      return {
        status: 'failed',
        message: `章节范围非法：edited=${editedChapterNumber} latest=${effectiveEndChapter}`,
      };
    }
    if (replayCount > MAX_CHAPTER_RESYNC_CHAPTERS) {
      return {
        status: 'skipped_too_many_chapters',
        message: `回灌跨度 ${replayCount} 章，超过上限 ${MAX_CHAPTER_RESYNC_CHAPTERS} 章`,
        effectiveStartChapter: editedChapterNumber,
        effectiveEndChapter,
        totalChapters: replayCount,
        completedChapters: 0,
      };
    }
    this.logger.log(
      `[updateChapter] 启动状态回灌 bookId=${bookId} range=${editedChapterNumber}-${effectiveEndChapter} replay=${replayCount}`,
    );

    const preChapterState = await this.loadStateSnapshotBeforeChapter(
      bookId,
      editedChapterNumber,
    );
    if (!preChapterState) {
      return {
        status: 'skipped_missing_snapshot',
        message: `缺少第${editedChapterNumber - 1}章快照，无法安全回灌`,
      };
    }

    const chaptersToReplay = await this.loadContiguousChapterRange(
      bookId,
      editedChapterNumber,
      effectiveEndChapter,
    );
    if (!chaptersToReplay) {
      return {
        status: 'skipped_missing_chapters',
        message: `章节数据不连续，无法从第${editedChapterNumber}章重放至第${effectiveEndChapter}章`,
        effectiveStartChapter: editedChapterNumber,
        effectiveEndChapter,
        totalChapters: replayCount,
        completedChapters: 0,
      };
    }

    let replayState = preChapterState;
    const recorderPrompt = await this.loadPipelineNodePrompt(bookId, 'recorder');
    const replayOutputs: Array<{
      chapter: ChapterEntity;
      draft: ChapterDraft;
      loreRecord: LoreRecord;
      stateAfterChapter: StoryState;
    }> = [];

    for (let index = 0; index < chaptersToReplay.length; index++) {
      const chapter = chaptersToReplay[index];
      const completed = index + 1;
      const progressMessage = `回放第${chapter.chapterNumber}章`;
      if (options?.onProgress) {
        await options.onProgress({
          chapterNumber: chapter.chapterNumber,
          completed,
          total: chaptersToReplay.length,
          message: progressMessage,
        });
      }
      const chapterDraft = chapterDraftSchema.parse({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        content: chapter.content,
      });
      const chapterIntent =
        (await this.loadChapterIntentArtifact(bookId, chapter.chapterNumber)) ??
        this.buildFallbackIntent(replayState, chapter.chapterNumber);

      const loreRecord = loreRecordSchema.parse(
        await this.recorder.record(replayState, chapterDraft, recorderPrompt),
      );
      replayState = this.loreService.applyLore(
        replayState,
        loreRecord,
        chapterIntent,
      );
      replayState = {
        ...replayState,
        chapterCursor: chapter.chapterNumber + 1,
        updatedAt: new Date().toISOString(),
      };
      replayOutputs.push({
        chapter,
        draft: chapterDraft,
        loreRecord,
        stateAfterChapter: replayState,
      });
    }

    const mergedState = this.mergeLoreDerivedStateAfterManualEdit(
      currentState,
      replayState,
    );

    await this.persistBookState(mergedState);

    for (const out of replayOutputs) {
      await this.persistArtifact(bookId, out.chapter.chapterNumber, 'lore_record', out.loreRecord);
      await this.persistArtifact(
        bookId,
        out.chapter.chapterNumber,
        'state_snapshot',
        out.chapter.chapterNumber === effectiveEndChapter ? mergedState : out.stateAfterChapter,
      );
    }

    try {
      for (const out of replayOutputs) {
        await this.detailStore.removeChapterContributions(bookId, out.chapter.chapterNumber);
      }
      for (const out of replayOutputs) {
        await this.updateDetailStoreFromChapter(
          bookId,
          out.draft,
          out.loreRecord,
          { enableSensoryExtraction: false },
        );
      }
    } catch (err) {
      this.logger.warn(
        `[updateChapter] detail_store 回灌失败 bookId=${bookId} start=${editedChapterNumber} end=${effectiveEndChapter}: ${err}`,
      );
    }
    this.logger.log(
      `[updateChapter] 状态回灌完成 bookId=${bookId} range=${editedChapterNumber}-${effectiveEndChapter} replay=${replayCount}`,
    );

    return {
      status: replayCount > 1 ? 'synced_forward' : 'synced',
      message:
        replayCount > 1
          ? `已重放 ${replayCount} 章（${editedChapterNumber}-${effectiveEndChapter}）`
          : undefined,
      effectiveStartChapter: editedChapterNumber,
      effectiveEndChapter,
      totalChapters: replayCount,
      completedChapters: replayCount,
      progressChapter: effectiveEndChapter,
    };
  }

  private async loadStateSnapshotBeforeChapter(
    bookId: string,
    chapterNumber: number,
  ): Promise<StoryState | null> {
    const snapshotChapterNumber = Math.max(0, chapterNumber - 1);
    const payload = await this.loadArtifactPayload(
      bookId,
      snapshotChapterNumber,
      'state_snapshot',
    );
    if (!payload) return null;

    try {
      const snapshot = storyStateSchema.parse(payload);
      if (snapshot.chapterCursor !== chapterNumber) {
        this.logger.warn(
          `[state_snapshot] 游标不匹配，拒绝回灌 bookId=${bookId} expected=${chapterNumber} actual=${snapshot.chapterCursor}`,
        );
        return null;
      }
      return snapshot;
    } catch (err) {
      this.logger.warn(
        `[state_snapshot] 解析失败 bookId=${bookId} chapter=${snapshotChapterNumber}: ${err}`,
      );
      return null;
    }
  }

  private async loadContiguousChapterRange(
    bookId: string,
    fromChapterNumber: number,
    toChapterNumber: number,
  ): Promise<ChapterEntity[] | null> {
    const ranged = await this.chapterRepo
      .createQueryBuilder('chapter')
      .where('chapter.bookId = :bookId', { bookId })
      .andWhere('chapter.chapterNumber >= :fromChapterNumber', { fromChapterNumber })
      .andWhere('chapter.chapterNumber <= :toChapterNumber', { toChapterNumber })
      .orderBy('chapter.chapterNumber', 'ASC')
      .getMany();
    const expectedLength = toChapterNumber - fromChapterNumber + 1;
    if (ranged.length !== expectedLength) return null;
    for (let i = 0; i < ranged.length; i++) {
      if (ranged[i].chapterNumber !== fromChapterNumber + i) return null;
    }
    return ranged;
  }

  private mergeLoreDerivedStateAfterManualEdit(
    currentState: StoryState,
    recomputedState: StoryState,
  ): StoryState {
    return storyStateSchema.parse({
      ...currentState,
      characters: recomputedState.characters,
      locations: recomputedState.locations,
      items: recomputedState.items,
      factions: recomputedState.factions,
      activeCommitments: recomputedState.activeCommitments,
      chapterSummaries: recomputedState.chapterSummaries,
      openPlotThreads: recomputedState.openPlotThreads,
      relationGraph: recomputedState.relationGraph,
      timelineEvents: recomputedState.timelineEvents,
      plotThreadLedger: recomputedState.plotThreadLedger,
      characterFactLedger: recomputedState.characterFactLedger,
      lastHook: recomputedState.lastHook,
      recentHookTypes: recomputedState.recentHookTypes,
      readerTension: recomputedState.readerTension,
      informationLedger: recomputedState.informationLedger,
      dopamineSchedule: recomputedState.dopamineSchedule,
      pendingForeshadowingSeeds: recomputedState.pendingForeshadowingSeeds,
      storyClock: recomputedState.storyClock,
      addressMatrix: recomputedState.addressMatrix,
      lastSceneSnapshot: recomputedState.lastSceneSnapshot,
      chapterCursor: currentState.chapterCursor,
      updatedAt: new Date().toISOString(),
    });
  }

  private async loadChapterIntentArtifact(
    bookId: string,
    chapterNumber: number,
  ): Promise<ChapterIntent | null> {
    const payload = await this.loadArtifactPayload(bookId, chapterNumber, 'intent');
    if (!payload) return null;
    try {
      return chapterIntentSchema.parse(payload);
    } catch {
      return null;
    }
  }

  private buildFallbackIntent(
    state: StoryState,
    chapterNumber: number,
  ): ChapterIntent {
    const activeCharacterIds = state.characters.slice(0, 3).map((c) => c.id);
    const focusCharacterIds = activeCharacterIds.slice(0, 1);
    return chapterIntentSchema.parse({
      chapterNumber,
      goals: [`延续第${chapterNumber}章冲突线`],
      emotionDirection: '紧张推进',
      hookDirection: state.lastHook || '抛出新的不确定性',
      carryoverFromLastChapter: '',
      threadGuidance: {
        priorityThreadLabels: state.openPlotThreads.slice(0, 3),
        maxNewThreads: 1,
        advice: '优先推进既有伏线',
      },
      characterAvailability: {
        activeCharacterIds,
        blockedCharacterIds: [],
        foreshadowOnlyCharacterIds: [],
      },
      characterArcGuidance: {
        focusCharacterIds,
        arcHints: [],
        emotionalLogicNotes: '保持角色行为与既有人设一致',
      },
      wordCountRange: { min: 2000, max: 4000 },
    });
  }

  private async loadPipelineNodePrompt(
    bookId: string,
    nodeId: string,
  ): Promise<string | undefined> {
    const pipelineNodes = await this.pipelineService.getPublishedNodes(bookId);
    return pipelineNodes.find((n) => n.id === nodeId)?.additionalSystemPrompt || undefined;
  }

  private async loadArtifactPayload(
    bookId: string,
    chapterNumber: number,
    name: string,
  ): Promise<Record<string, unknown> | null> {
    const artifact = await this.artifactRepo.findOneBy({ bookId, chapterNumber, name });
    return artifact?.payload ?? null;
  }

  /**
   * 基于本章 LoreRecord / Draft，对高保真细节仓做轻量更新。
   *
   * 当前只维护角色相关信息：
   * - 使用 characterProfileDeltas 的 appearance/outfit 等，生成典型描写片段
   *
   * 这里不做额外 LLM 调用，完全复用已有结构化 delta。
   */
  private async updateDetailStoreFromChapter(
    bookId: string,
    draft: ChapterDraft,
    lore: LoreRecord,
    options?: { enableSensoryExtraction?: boolean },
  ): Promise<void> {
    const chapterNumber = draft.chapterNumber;
    const enableSensoryExtraction = options?.enableSensoryExtraction ?? true;

    // ── 角色：外貌/服饰/受伤等描写片段 ──
    const snippetsByCharacter = new Map<
      string,
      { chapterNumber: number; type: import('./detail-store.schemas').CharacterDescriptionType; text: string }[]
    >();

    const pushCharSnippet = (
      characterId: string,
      type: import('./detail-store.schemas').CharacterDescriptionType,
      text: string,
    ) => {
      const list = snippetsByCharacter.get(characterId) ?? [];
      list.push({ chapterNumber, type, text });
      snippetsByCharacter.set(characterId, list);
    };

    for (const delta of lore.characterProfileDeltas ?? []) {
      if (!delta.description?.trim()) continue;
      if (delta.field === 'appearance') {
        pushCharSnippet(delta.characterId, 'face', delta.description);
      } else if (delta.field === 'outfit') {
        pushCharSnippet(delta.characterId, 'outfit', delta.description);
      } else if (delta.field === 'injury') {
        pushCharSnippet(delta.characterId, 'gesture', delta.description);
      }
    }

    const characterUpdates = Array.from(snippetsByCharacter.entries()).map(
      ([characterId, snippets]) => ({ characterId, descriptionSnippets: snippets }),
    );

    // ── 地点：描写片段 + 本章场景访问记忆 ──
    type LocSnippet = {
      chapterNumber: number;
      type: import('./detail-store.schemas').LocationDescriptionType;
      text: string;
    };
    const snippetsByLocation = new Map<string, LocSnippet[]>();
    const visitMemoriesByLocation = new Map<
      string,
      { chapterNumber: number; characterId: string; event: string; emotionalTone: string }[]
    >();

    const pushLocSnippet = (
      locationId: string,
      type: import('./detail-store.schemas').LocationDescriptionType,
      text: string,
    ) => {
      const list = snippetsByLocation.get(locationId) ?? [];
      list.push({ chapterNumber, type, text });
      snippetsByLocation.set(locationId, list);
    };

    for (const delta of lore.locationProfileDeltas ?? []) {
      if (!delta.description?.trim()) continue;
      const type =
        delta.field === 'terrain'
          ? ('panorama' as const)
          : delta.field === 'climate'
            ? ('weather' as const)
            : delta.field === 'sensory'
              ? ('interior' as const)
              : delta.field === 'architecture'
                ? ('interior' as const)
                : ('interior' as const);
      pushLocSnippet(delta.locationId, type, delta.description);
    }

    const snapshot = lore.sceneSnapshot;
    if (snapshot?.locationId && (snapshot.presentCharacterIds?.length ?? 0) > 0) {
      const event = snapshot.ongoingAction?.trim() || '在场';
      const emotionalTone = snapshot.emotionalTone?.trim() || '—';
      const list =
        visitMemoriesByLocation.get(snapshot.locationId) ?? [];
      for (const characterId of snapshot.presentCharacterIds) {
        list.push({
          chapterNumber,
          characterId,
          event,
          emotionalTone,
        });
      }
      visitMemoriesByLocation.set(snapshot.locationId, list);
    }

    const locationIds = new Set<string>([
      ...snippetsByLocation.keys(),
      ...visitMemoriesByLocation.keys(),
    ]);

    // 本章主场景地点：用 LLM 从正文中抽取 1～2 条感官锚点，供重访时复现。
    let extractedAnchors: LocationSensoryAnchor[] = [];
    if (snapshot?.locationId && enableSensoryExtraction) {
      const locationLabel =
        snapshot.locationName?.trim() || snapshot.locationId;
      try {
        extractedAnchors = await this.extractSensoryAnchorsFromChapter(
          draft.content.slice(0, 3200),
          locationLabel,
        );
      } catch (err) {
        this.logger.warn(
          `[detail-store] 地点感官锚点抽取失败 (location=${locationLabel}): ${err}`,
        );
      }
    }

    const locationUpdates = Array.from(locationIds).map((locationId) => ({
      locationId,
      descriptionSnippets: snippetsByLocation.get(locationId) ?? [],
      visitMemories: visitMemoriesByLocation.get(locationId) ?? [],
      ...(locationId === snapshot?.locationId && extractedAnchors.length > 0
        ? { sensoryAnchors: extractedAnchors }
        : {}),
    }));

    // ── 道具：描写片段（外观/来历/限制/进化）──
    type ItemSnippet = {
      chapterNumber: number;
      type: import('./detail-store.schemas').ItemDescriptionType;
      text: string;
    };
    const snippetsByItem = new Map<string, ItemSnippet[]>();
    const pushItemSnippet = (
      itemId: string,
      type: import('./detail-store.schemas').ItemDescriptionType,
      text: string,
    ) => {
      const list = snippetsByItem.get(itemId) ?? [];
      list.push({ chapterNumber, type, text });
      snippetsByItem.set(itemId, list);
    };

    for (const delta of lore.itemProfileDeltas ?? []) {
      if (!delta.description?.trim()) continue;
      const type =
        delta.field === 'appearance'
          ? ('appearance' as const)
          : delta.field === 'origin'
            ? ('origin' as const)
            : delta.field === 'limitation'
              ? ('limitation' as const)
              : delta.field === 'evolution'
                ? ('evolution' as const)
                : ('appearance' as const);
      pushItemSnippet(delta.itemId, type, delta.description);
    }

    if (snippetsByItem.size > 0) {
      // 本章仅对「第一个」有 delta 的道具做一次感官/使用效果抽取，控制 LLM 调用量
      const firstItemId = Array.from(snippetsByItem.keys())[0];
      const firstSnippets = snippetsByItem.get(firstItemId) ?? [];
      const itemHint =
        firstSnippets[0]?.text?.slice(0, 80) ?? '本章出现的道具或武器';

      let extractedSensory: Partial<ItemSensorySignature> | undefined;
      let extractedActivation: { chapterNumber: number; description: string } | undefined;
      if (enableSensoryExtraction) {
        try {
          const out = await this.extractItemSensoryFromChapter(
            draft.content.slice(0, 3200),
            itemHint,
          );
          if (out.sensorySignature && Object.keys(out.sensorySignature).length > 0) {
            extractedSensory = out.sensorySignature;
          }
          if (out.activationEffect?.description?.trim()) {
            extractedActivation = {
              chapterNumber,
              description: out.activationEffect.description.trim(),
            };
          }
        } catch (err) {
          this.logger.warn(
            `[detail-store] 道具感官/使用效果抽取失败 (item=${firstItemId}): ${err}`,
          );
        }
      }

      const itemUpdates = Array.from(snippetsByItem.entries()).map(
        ([itemId, snippets]) => ({
          itemId,
          descriptionSnippets: snippets,
          ...(itemId === firstItemId && (extractedSensory || extractedActivation)
            ? {
                sensorySignature: extractedSensory,
                activationEffects: extractedActivation
                  ? [extractedActivation]
                  : undefined,
              }
            : {}),
        }),
      );

      const updates: DetailStoreChapterUpdates = {
        ...(characterUpdates.length > 0 ? { characterUpdates } : {}),
        ...(locationUpdates.length > 0 ? { locationUpdates } : {}),
        itemUpdates,
      };
      await this.detailStore.applyChapterUpdates(bookId, updates);
      return;
    }

    // 无道具更新时，仍要写入角色与地点
    const updates: DetailStoreChapterUpdates = {
      ...(characterUpdates.length > 0 ? { characterUpdates } : {}),
      ...(locationUpdates.length > 0 ? { locationUpdates } : {}),
    };
    if (characterUpdates.length > 0 || locationUpdates.length > 0) {
      await this.detailStore.applyChapterUpdates(bookId, updates);
    }
  }

  /**
   * 从章节正文中抽取「道具/武器/异火」的感官签名与一次使用效果，
   * 用于细节仓 ItemDetail，便于后续出场时复现。
   */
  private async extractItemSensoryFromChapter(
    contentExcerpt: string,
    itemHint: string,
  ): Promise<{
    sensorySignature?: Partial<ItemSensorySignature>;
    activationEffect?: { description: string };
  }> {
    if (!contentExcerpt?.trim()) return {};

    const result = await this.llm.generateStructured({
      taskName: 'item-sensory-extract',
      schema: itemSensoryExtractionSchema,
      tags: ['workflow', 'detail-store', 'item'],
      metadata: { itemHint: itemHint.slice(0, 50) },
      systemPrompt: `你是道具/武器/异火描写提炼专家。从给定的章节正文摘录中，针对「与道具相关的描写」（提示：${itemHint}），抽取：
1. sensorySignature：该道具的 1～2 个感官维度具体描写（视觉/触感/听觉/气味/重量），只提炼正文中已出现的，不要编造。每个维度一句话即可。
2. activationEffect：若正文中有该道具被使用、激活、催动的一次具体效果描写，提炼为一句话（如「青莲在掌心绽放，方圆三尺温度骤升」）。若无则省略。

要求：只提炼正文中明确出现的描写，不要编造。若几乎没有道具相关描写，可返回空。`,
      userPrompt: `道具/武器提示：${itemHint}\n\n章节正文摘录：\n${contentExcerpt}`,
      temperature: 0.3,
    });

    const sensorySignature: Partial<ItemSensorySignature> = {};
    const raw = result.sensorySignature ?? {};
    if (raw.visual?.trim()) sensorySignature.visual = raw.visual.trim();
    if (raw.tactile?.trim()) sensorySignature.tactile = raw.tactile.trim();
    if (raw.auditory?.trim()) sensorySignature.auditory = raw.auditory.trim();
    if (raw.olfactory?.trim()) sensorySignature.olfactory = raw.olfactory.trim();
    if (raw.weight?.trim()) sensorySignature.weight = raw.weight.trim();

    const activationEffect =
      result.activationEffect?.description?.trim()
        ? { description: result.activationEffect.description.trim() }
        : undefined;

    return {
      ...(Object.keys(sensorySignature).length > 0 ? { sensorySignature } : {}),
      ...(activationEffect ? { activationEffect } : {}),
    };
  }

  /**
   * 从章节正文中抽取当前场景的 1～2 个感官锚点（视觉/听觉/气味等），
   * 用于细节仓「地点」的 sensoryAnchors，便于后续重访同一地点时复现。
   */
  private async extractSensoryAnchorsFromChapter(
    contentExcerpt: string,
    locationLabel: string,
  ): Promise<LocationSensoryAnchor[]> {
    if (!contentExcerpt?.trim()) return [];

    const result = await this.llm.generateStructured({
      taskName: 'location-sensory-extract',
      schema: locationSensoryExtractionSchema,
      tags: ['workflow', 'detail-store', 'location'],
      metadata: { locationLabel },
      systemPrompt: `你是环境描写提炼专家。从给定的章节正文摘录中，针对「${locationLabel}」这一地点，抽取 1～2 个具体、可记忆的感官细节作为「锚点」。
要求：
- 只提炼正文中已出现的描写，不要编造。
- 每个锚点对应一种感官：视觉(sight)、听觉(sound)、气味(smell)、触感(touch)、体感温度(temperature)。
- 描述要具体（如「门口两棵百年老槐树，夏日蝉鸣刺耳」「空气中弥漫着香火与霉味」），不要泛泛而谈。
- 若某处是地标（建筑、标志物），可设 isLandmark 为 true。
- 最多输出 2 个锚点。若摘录中几乎没有环境描写，可返回空数组。`,
      userPrompt: `地点：${locationLabel}\n\n章节正文摘录：\n${contentExcerpt}`,
      temperature: 0.3,
    });

    const raw = result.sensoryAnchors ?? [];
    return raw
      .filter((a) => a.description?.trim())
      .map((a) => ({
        sense: a.sense,
        description: a.description.trim(),
        isLandmark: a.isLandmark ?? false,
      }));
  }

  private updateMaintenanceQualitySignals(
    m: MaintenanceState,
    result: ChapterWorkflowResult,
  ): MaintenanceState {
    const lowScore = result.overallScore < 6.5;
    const consistencyWarning = result.review.dimensions.consistency < 7;

    return {
      ...m,
      consecutiveLowScoreChapters: lowScore ? m.consecutiveLowScoreChapters + 1 : 0,
      consecutiveConsistencyWarnings: consistencyWarning
        ? m.consecutiveConsistencyWarnings + 1 : 0,
    };
  }

  private toPublicResult(result: ChapterWorkflowResult): Record<string, unknown> {
    return {
      chapterNumber: result.finalDraft.chapterNumber,
      title: result.finalDraft.title,
      qualityScore: result.review.dimensions.proseQuality,
      overallScore: result.overallScore,
      wasEdited: result.wasEdited,
      reviewVerdict: result.review.overallVerdict,
    };
  }

  private static readonly MAX_KPI = 100;
  private static readonly MAX_SUMMARIES = 100;
  private static readonly MAX_TIMELINE = 500;
  private static readonly MAX_FACTS = 300;
  private static readonly MAX_COMPLETED_ARCS = 20;
  private static readonly MAX_COMPLETED_ARC_ACCEPTANCE_REPORTS = 50;

  private compactState(state: StoryState): StoryState {
    return {
      ...state,
      kpiHistory: state.kpiHistory.slice(-NovelService.MAX_KPI),
      qualityMetricsHistory: (state.qualityMetricsHistory ?? []).slice(-NovelService.MAX_KPI),
      // buildCompactContext 的 maxChapterSummaries 控制注入量，不需要在此截断
      timelineEvents: (state.timelineEvents ?? []).slice(-NovelService.MAX_TIMELINE),
      characterFactLedger: (state.characterFactLedger ?? [])
        .filter((f) => f.status !== 'deprecated')
        .slice(-NovelService.MAX_FACTS),
      plotThreadLedger: (state.plotThreadLedger ?? []).filter((t) => {
        if (t.status === 'open') return true;
        return state.chapterCursor - t.lastTouchedChapter < 50;
      }),
      completedArcs: (state.completedArcs ?? []).slice(-NovelService.MAX_COMPLETED_ARCS),
      completedArcAcceptanceReports: (state.completedArcAcceptanceReports ?? [])
        .slice(-NovelService.MAX_COMPLETED_ARC_ACCEPTANCE_REPORTS),
      pendingForeshadowingSeeds: (state.pendingForeshadowingSeeds ?? []).filter((s) => !s.applied),
      informationLedger: state.informationLedger ? {
        activeGaps: state.informationLedger.activeGaps,
        resolvedGaps: state.informationLedger.resolvedGaps.slice(-15),
      } : undefined,
      dopamineSchedule: state.dopamineSchedule ? {
        ...state.dopamineSchedule,
        history: state.dopamineSchedule.history.slice(-30),
      } : undefined,
      activeCommitments: (state.activeCommitments ?? []).filter(
        (c) => c.status === 'active' || (state.chapterCursor - (c.resolvedAtChapter ?? 0)) < 5,
      ),
      recentDistinctivePhrases: (state.recentDistinctivePhrases ?? []).slice(-30),
    };
  }

  /**
   * Apply pending foreshadowing seeds by injecting text into past chapters.
   * Only processes seeds targeting chapters that have already been written.
   */
  private async applyPendingForeshadowing(state: StoryState, justGeneratedChapter: number): Promise<StoryState> {
    const seeds = (state.pendingForeshadowingSeeds ?? []).filter((s) => !s.applied);
    if (seeds.length === 0) return state;

    const applied: string[] = [];

    for (const seed of seeds) {
      if (seed.targetChapterNumber >= justGeneratedChapter) continue; // 排除当前章及未来章，仅修改真正的过去章节

      try {
        const chapter = await this.chapterRepo.findOneBy({
          bookId: state.bookId,
          chapterNumber: seed.targetChapterNumber,
        });
        if (!chapter?.content) continue;

        const paragraphs = chapter.content.split('\n');
        const insertIdx = Math.min(seed.insertAfterParagraph, paragraphs.length - 1);

        const foreshadowText = seed.insertionType === 'inner_thought'
          ? `\n${seed.content}\n`
          : `\n${seed.content}\n`;

        paragraphs.splice(insertIdx + 1, 0, foreshadowText.trim());
        const newContent = paragraphs.join('\n');

        await this.chapterRepo.update(
          { bookId: state.bookId, chapterNumber: seed.targetChapterNumber },
          { content: newContent },
        );

        applied.push(seed.id);
        this.traceLogger.logWorkflowEvent({
          bookId: state.bookId, chapterNumber: seed.targetChapterNumber, step: 'foreshadowingInject',
          status: 'ok', meta: { triggeredBy: seed.triggeredByChapter, reason: seed.reason, insertAfter: seed.insertAfterParagraph },
        });
        this.logger.log(
          `[Foreshadowing] 已注入伏笔到第${seed.targetChapterNumber}章 ` +
          `(由第${seed.triggeredByChapter}章触发): ${seed.reason}`,
        );
      } catch (err) {
        this.logger.warn(`[Foreshadowing] 注入失败: ${seed.id} — ${err}`);
      }
    }

    if (applied.length === 0) return state;

    return {
      ...state,
      pendingForeshadowingSeeds: (state.pendingForeshadowingSeeds ?? []).map((s) =>
        applied.includes(s.id) ? { ...s, applied: true } : s,
      ),
    };
  }

  private static readonly CLICHE_PATTERNS: RegExp[] = [
    /[她他]的?眼[中里]闪过一丝/,
    /[他她]心中一[凛惊震]/,
    /[他她]?冷[笑哼]一声/,
    /不由得[倒吸一口凉气|心头一震]/,
    /[他她]的?嘴角[微微]?[上扬|勾起]/,
    /一股[强大|磅礴|浓郁]的气息/,
    /[他她]?[缓缓|猛然][睁开|闭上]眼/,
    /空气[仿佛|似乎]都[凝固|静止]了/,
    /[一道|数道][身影|黑影][闪过|掠过]/,
  ];

  private updateDistinctivePhrases(state: StoryState, content: string): StoryState {
    const existing = state.recentDistinctivePhrases ?? [];
    const newPhrases: string[] = [];

    for (const pattern of NovelService.CLICHE_PATTERNS) {
      const matches = content.match(new RegExp(pattern.source, 'g'));
      if (matches) {
        for (const m of matches) newPhrases.push(m);
      }
    }

    const sentences = content.split(/[。！？\n]/).filter((s) => s.length >= 8 && s.length <= 30);
    const similePatterns = sentences.filter(
      (s) => /[像|如同|仿佛|宛如|好似|犹如]/.test(s),
    );
    for (const s of similePatterns.slice(0, 3)) {
      newPhrases.push(s.trim());
    }

    const merged = [...existing, ...newPhrases];
    const deduped = [...new Set(merged)].slice(-30);

    return { ...state, recentDistinctivePhrases: deduped };
  }

  /**
   * Fetch the last ~500 chars of the previous chapter for seamless continuation.
   */
  private async runPreStep<T>(bid: string, ch: number, step: string, fn: () => Promise<T>, retry = false): Promise<T> {
    let err: Error;
    for (let i = 0; i <= (retry ? 1 : 0); i++) {
      try { return await fn(); } catch (e) {
        err = e as Error;
        if (i === 0 && retry) { this.logger.warn(`[ch${ch}] ${step} 首次失败，1s后重试: ${err.message}`); await new Promise(r => setTimeout(r, 1000)); }
      }
    }
    this.traceLogger.logWorkflowEvent({ bookId: bid, chapterNumber: ch, step, status: 'error', error: err!.message });
    this.logger.error(`[ch${ch}] 前置步骤 ${step} 最终失败: ${err!.message}`);
    throw err!;
  }

  private logPreStepWarn(bid: string, ch: number, step: string, e: unknown): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.traceLogger.logWorkflowEvent({ bookId: bid, chapterNumber: ch, step, status: 'error', error: msg });
    this.logger.warn(`[ch${ch}] ${step} 失败(非关键，跳过): ${msg}`);
  }

  private async getPreviousChapterEnding(bookId: string, currentChapter: number): Promise<string | undefined> {
    if (currentChapter <= 1) return undefined;
    const prev = await this.chapterRepo.findOneBy({ bookId, chapterNumber: currentChapter - 1 });
    if (!prev?.content) return undefined;
    const content = prev.content;
    const tail = content.slice(-1800); // 取 1800 字保留足够缓冲
    // 从末尾向前找最近的段落边界（换行），确保从完整段落开头开始，不切断句子
    const lastNewline = tail.lastIndexOf('\n', tail.length - 200); // 保留至少 200 字结尾
    return lastNewline > 0 ? tail.slice(lastNewline + 1) : tail;
  }

  // -------------------------------------------------------------------------
  // DB helpers
  // -------------------------------------------------------------------------

  private async loadBookState(bookId: string): Promise<StoryState> {
    return this.bookStateRepo.load(bookId);
  }

  private async persistBookState(state: StoryState): Promise<void> {
    await this.bookStateRepo.save(state);
  }

  private async persistArtifact(
    bookId: string, chapterNumber: number, name: string, data: unknown,
  ): Promise<void> {
    await this.artifactRepo.upsert(
      { bookId, chapterNumber, name, payload: (data ?? {}) as Record<string, unknown> },
      ['bookId', 'chapterNumber', 'name'],
    );
  }

  private async persistArtifactsBatch(
    bookId: string, chapterNumber: number, artifacts: { name: string; data: unknown }[],
  ): Promise<void> {
    if (artifacts.length === 0) return;
    await this.artifactRepo.upsert(
      artifacts.map((a) => ({
        bookId, chapterNumber, name: a.name,
        payload: (a.data ?? {}) as Record<string, unknown>,
      })),
      ['bookId', 'chapterNumber', 'name'],
    );
  }

  private async withBookLock<T>(bookId: string, job: () => Promise<T>): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query('SELECT pg_advisory_lock(hashtext($1))', [bookId]);
      return await job();
    } finally {
      try {
        await qr.query('SELECT pg_advisory_unlock(hashtext($1))', [bookId]);
      } finally {
        await qr.release();
      }
    }
  }

  // =========================================================================
  // Reader Feedback — 评论提交 + 触发分析 + 查看
  // =========================================================================

  /** 提交单章评论，累积存储，达标则自动触发分析。 */
  async submitChapterFeedback(bookId: string, feedback: ReaderFeedback): Promise<{
    stored: boolean; analysisTriggered: boolean; analysis?: ReaderFeedbackAnalysis;
  }> {
    const state = await this.loadBookState(bookId);
    const fs = state.feedbackState ?? {
      history: [], lastAnalyzedAtChapter: 0, gapSinceLastFeedback: 0,
      pendingCommentCount: 0, sentimentHistory: [], confidence: 'none' as const,
    };

    const existing = fs.history.findIndex((h) => h.chapterNumber === feedback.chapterNumber);
    if (existing >= 0) {
      fs.history[existing] = { ...fs.history[existing], comments: [...fs.history[existing].comments, ...feedback.comments], metrics: feedback.metrics ?? fs.history[existing].metrics };
    } else {
      fs.history.push(feedback);
    }
    fs.history = fs.history.slice(-50); // 保留最近50章
    fs.pendingCommentCount += feedback.comments.length;
    fs.gapSinceLastFeedback = 0;

    state.feedbackState = fs;
    await this.persistBookState(state);
    this.logger.log(`[Feedback] bookId=${bookId} ch${feedback.chapterNumber} +${feedback.comments.length}条评论，待分析${fs.pendingCommentCount}条`);

    if (this.shouldTriggerAnalysis(fs, state)) {
      const analysis = await this.triggerFeedbackAnalysis(bookId);
      return { stored: true, analysisTriggered: true, analysis };
    }
    return { stored: true, analysisTriggered: false };
  }

  /** 手动触发分析（不管累积量）。 */
  async triggerFeedbackAnalysis(bookId: string): Promise<ReaderFeedbackAnalysis> {
    const state = await this.loadBookState(bookId);
    const fs = state.feedbackState ?? { history: [], lastAnalyzedAtChapter: 0, gapSinceLastFeedback: 0, pendingCommentCount: 0, sentimentHistory: [], confidence: 'none' as const };

    const chaptersWithData = fs.history.filter((h) => h.comments.length > 0);
    const pendingFeedbacks = fs.lastAnalyzedAtChapter > 0
      ? chaptersWithData.filter((h) => h.chapterNumber > fs.lastAnalyzedAtChapter)
      : chaptersWithData;
    const toAnalyze = pendingFeedbacks.length > 0 ? pendingFeedbacks : chaptersWithData.slice(-10);

    if (!toAnalyze.length) throw new UnprocessableEntityException('无可分析的读者评论');

    this.logger.log(`[Feedback] 开始分析 bookId=${bookId}，${toAnalyze.length}个章节，${toAnalyze.reduce((s, f) => s + f.comments.length, 0)}条评论`);
    const analysis = await this.readerPulse.analyze(state, toAnalyze);

    fs.lastAnalysis = analysis;
    fs.lastAnalyzedAtChapter = state.chapterCursor;
    fs.pendingCommentCount = 0;
    fs.confidence = 'fresh';
    fs.sentimentHistory = [
      ...fs.sentimentHistory,
      { chapterRange: `ch${toAnalyze[0].chapterNumber}-ch${toAnalyze[toAnalyze.length - 1].chapterNumber}`, sentiment: analysis.overallSentiment, analysisTimestamp: analysis.analysisTimestamp },
    ].slice(-20);

    state.feedbackState = fs;
    await this.persistBookState(state);
    this.logger.log(`[Feedback] 分析完成 sentiment=${analysis.overallSentiment} trend=${analysis.sentimentTrend} adopt=${this.countAdopted(analysis)}条采纳`);
    return analysis;
  }

  /** 获取反馈分析状态。 */
  async getFeedbackState(bookId: string): Promise<FeedbackState> {
    const state = await this.loadBookState(bookId);
    return state.feedbackState ?? { history: [], lastAnalyzedAtChapter: 0, gapSinceLastFeedback: 0, pendingCommentCount: 0, sentimentHistory: [], confidence: 'none' };
  }

  /** 检查是否应自动触发分析：≥3章有评论且待分析≥30条，或距上次分析已积累≥5章有评论数据。 */
  private shouldTriggerAnalysis(fs: FeedbackState, state: StoryState): boolean {
    if (fs.pendingCommentCount < 15) return false;
    const unanalyzed = fs.history.filter((h) => h.comments.length > 0 && h.chapterNumber > fs.lastAnalyzedAtChapter);
    if (unanalyzed.length >= 3) return true;
    if (fs.pendingCommentCount >= 30) return true;
    return false;
  }

  /** 每章生成后更新反馈新鲜度（在 generateChapter 流程中调用）。 */
  updateFeedbackConfidence(fs: FeedbackState, chapterNumber: number): FeedbackState {
    if (!fs.lastAnalysis) return { ...fs, confidence: 'none' };
    const gap = chapterNumber - fs.lastAnalyzedAtChapter;
    fs.gapSinceLastFeedback = gap;
    if (gap <= 5) fs.confidence = 'fresh';
    else if (gap <= 15) fs.confidence = 'aging';
    else fs.confidence = 'stale';
    // chapter级建议过期检查
    if (fs.lastAnalysis && fs.lastAnalysis.chapterLevel.expiresAfterChapter <= chapterNumber) {
      fs.lastAnalysis = {
        ...fs.lastAnalysis,
        chapterLevel: { ...fs.lastAnalysis.chapterLevel, immediateFixes: [], suspenseUrgency: [], pacingAdjustment: 'maintain', recentTechniqueVerdict: [] },
      };
    }
    return fs;
  }

  private countAdopted(analysis: ReaderFeedbackAnalysis): number {
    const all = [
      ...analysis.bookLevel.writingStyleFeedback, ...analysis.bookLevel.coreIssues,
      ...analysis.arcLevel.suggestions, ...analysis.chapterLevel.immediateFixes,
    ];
    return all.filter((a) => a.verdict === 'adopt' || a.verdict === 'conditional').length;
  }
}
