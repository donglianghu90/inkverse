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
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LlmService } from './llm/llm.service';
import { LlmUsageTrackerService } from './llm/llm-usage-tracker.service';
import { SeedAnalyzerAgent } from './agents/seed-analyzer.agent';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';
import { RecorderAgent } from './agents/recorder.agent';
import { ChapterWorkflowService, ChapterWorkflowResult } from './chapter-workflow.service';
import { DeepMaintenanceService } from './deep-maintenance.service';
import { LoreApplicationService } from './lore-application.service';
import { BookAgentPipelineService } from './book-agent-pipeline.service';
import { NovelProgressService } from './novel-progress.service';
import { DetailStoreService } from './detail-store.service';
import { BookEntity } from './entities/book.entity';
import { ChapterEntity } from './entities/chapter.entity';
import { ArtifactEntity } from './entities/artifact.entity';
import { CreateBookDto } from './dto/create-book.dto';
import { GenerateChaptersBatchDto } from './dto/generate-chapters-batch.dto';
import {
  StoryState,
  storyStateSchema,
  MaintenanceState,
  BookPromptProfile,
  bookPromptProfileSchema,
} from './schemas/novel-state.schemas';
import { ChapterDraft, LoreRecord, generationKpiSchema } from './schemas/novel.schemas';
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

@Injectable()
export class NovelService {
  private readonly logger = new Logger(NovelService.name);

  constructor(
    @InjectRepository(BookEntity)
    private readonly bookRepo: Repository<BookEntity>,
    @InjectRepository(ChapterEntity)
    private readonly chapterRepo: Repository<ChapterEntity>,
    @InjectRepository(ArtifactEntity)
    private readonly artifactRepo: Repository<ArtifactEntity>,
    private readonly dataSource: DataSource,
    private readonly seedAnalyzer: SeedAnalyzerAgent,
    private readonly promptProfiler: PromptProfilerAgent,
    private readonly chapterWorkflow: ChapterWorkflowService,
    private readonly recorder: RecorderAgent,
    private readonly deepMaintenance: DeepMaintenanceService,
    private readonly loreService: LoreApplicationService,
    private readonly llmUsageTracker: LlmUsageTrackerService,
    private readonly llm: LlmService,
    private readonly pipelineService: BookAgentPipelineService,
    private readonly progressService: NovelProgressService,
    private readonly detailStore: DetailStoreService,
  ) {}

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
      systemPrompt: `你是一位资深的网文策划编辑，擅长把粗糙的创意打磨成令人兴奋的故事概念。

你的任务是对用户的原始创意进行"美化"——不是改变方向，而是让它更有吸引力、更具体、更有画面感。

美化原则：
1. 保留用户原始创意的核心方向和关键元素，不要偏离。
2. 补充具体的世界观细节——让设定更独特、更有辨识度。
3. 增加冲突和张力——好的创意必须有"让人想知道接下来怎样"的悬念。
4. 增加主角的独特性——给主角一个有趣的困境或特质。
5. 语言要生动有画面感，但不要过于冗长（控制在 100-200 字之间）。
6. 不要加入过于俗套的元素（"天才废柴""退婚"等除非原创意中有）。

同时列出 2-5 个"亮点"——你在原始创意基础上增强或补充的关键元素，每个亮点一句话概括。`,
      userPrompt: `原始创意：
${rawIdea}
${genre ? `\n参考题材方向：${genre}` : ''}

请输出美化后的创意（enhanced）和亮点列表（highlights）。`,
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
  async createBook(dto: CreateBookDto): Promise<unknown> {
    const t0 = Date.now();
    this.logger.log(
      `[createBook] ========== 极轻量开书 ==========\n` +
      `  mainIdea: ${dto.mainIdea}\n` +
      `  genre: ${dto.genre} | targetAudience: ${dto.targetAudience}`,
    );

    const emitCreate = (step: string, stepIndex: number, message: string, done = false) => {
      this.progressService.emit({
        bookId: '__creating__',
        chapterNumber: 0,
        step,
        stepIndex,
        totalSteps: 4,
        message,
        done,
      });
    };

    // Step 1: Seed analysis
    this.logger.log(`[createBook] 步骤 1/4: 种子创意分析...`);
    emitCreate('seed', 0, '种子创意分析');
    const analysis = await this.seedAnalyzer.analyze({
      mainIdea: dto.mainIdea,
      genre: dto.genre,
      targetAudience: dto.targetAudience,
      titleHint: dto.titleHint,
      mainStoryGoal: dto.mainStoryGoal,
      targetChapterWordCount: dto.targetChapterWordCount ?? 3000,
      plannedTotalChapters: {
        min: dto.plannedMinChapters ?? 500,
        max: dto.plannedMaxChapters ?? 800,
      },
    });
    this.logger.log(
      `[createBook] 种子分析完成 — ${Date.now() - t0}ms\n` +
      `  书名: ${analysis.seed.title} | 主角: ${analysis.seed.protagonistConcept.name}\n` +
      `  大纲节点: ${analysis.outline.points.length} | 可行性: ${analysis.seed.conceptEvaluation?.overallViability ?? 'N/A'}`,
    );
    emitCreate('seed', 0, `种子分析完成 — 书名《${analysis.seed.title}》`);

    // Step 2: Prompt profile
    this.logger.log(`[createBook] 步骤 2/4: 生成写作手册（BookPromptProfile）...`);
    emitCreate('profile', 1, '生成专属写作手册');
    const bookPromptProfile = await this.promptProfiler.generate({
      genre: dto.genre,
      targetAudience: dto.targetAudience,
      mainIdea: dto.mainIdea,
      tone: analysis.seed.tone ?? '热血',
      mainStoryGoal: dto.mainStoryGoal,
      targetChapterWordCount: dto.targetChapterWordCount ?? 3000,
      plannedTotalChapters: {
        min: dto.plannedMinChapters ?? 500,
        max: dto.plannedMaxChapters ?? 800,
      },
    });
    this.logger.log(
      `[createBook] 写作手册生成完成 — ${Date.now() - t0}ms\n` +
      `  题材: ${bookPromptProfile.generatedForGenre} | 受众: ${bookPromptProfile.generatedForAudience}\n` +
      `  类型规则: ${bookPromptProfile.writerGuide.genreRules.length} 条 | 爽感类型: ${bookPromptProfile.satisfactionTypes.length} 种`,
    );
    emitCreate('profile', 1, `写作手册生成完成 — ${bookPromptProfile.writerGuide.genreRules.length} 条题材规则`);

    // Step 3: Persist
    this.logger.log(`[createBook] 步骤 3/4: 初始化角色与世界...`);
    emitCreate('init', 2, '初始化角色与世界');
    const bookEntity = await this.bookRepo.save(
      this.bookRepo.create({ stateJson: {} as Record<string, unknown> }),
    );
    const bookId = bookEntity.bookId;
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
      seed: analysis.seed,
      roughOutline: analysis.outline,
      bookPromptProfile,
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
      maintenance: INITIAL_MAINTENANCE,
    };

    // 默认先规划首卷（5-10章）再开始逐章创作，避免第1章裸写。
    state = await this.deepMaintenance.bootstrapInitialArc(state);

    await this.persistBookState(state);
    await this.persistArtifact(bookId, 0, 'seed', analysis.seed);
    await this.persistArtifact(bookId, 0, 'rough_outline', analysis.outline);
    await this.pipelineService.initDefault(bookId);

    this.logger.log(
      `[createBook] 步骤 4/4: 初始化完成 — ${Date.now() - t0}ms\n` +
      `  bookId: ${bookId} | 书名: ${analysis.seed.title}\n` +
      `  主角: ${protagonist.name} | 大纲节点: ${analysis.outline.points.length}\n` +
      `  ========== 开书完成 ==========`,
    );
    emitCreate('done', 3, `开书完成 — 《${analysis.seed.title}》`, true);

    return {
      bookId,
      title: analysis.seed.title,
      chapterCursor: 1,
      outline: analysis.outline,
      bookPromptProfile,
      currentArc: state.currentArc ?? null,
    };
  }

  async listBooks(): Promise<unknown> {
    const books = await this.bookRepo.find({
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return {
      count: books.length,
      books: books.map((b) => {
        const s = storyStateSchema.parse(b.stateJson);
        const latestKpi = s.kpiHistory[s.kpiHistory.length - 1] ?? null;
        return {
          bookId: b.bookId,
          title: s.seed.title,
          genre: s.seed.genre ?? '',
          chaptersGenerated: s.chapterCursor - 1,
          latestKpi: latestKpi
            ? { qualityScore: latestKpi.qualityScore, overallScore: latestKpi.overallScore }
            : null,
          updatedAt: b.updatedAt.toISOString(),
        };
      }),
    };
  }

  async getBook(bookId: string): Promise<unknown> {
    const state = await this.loadBookState(bookId);
    const latestKpi = state.kpiHistory[state.kpiHistory.length - 1] ?? null;
    return {
      bookId: state.bookId,
      title: state.seed.title,
      genre: state.seed.genre ?? '',
      chapterCursor: state.chapterCursor,
      chaptersGenerated: state.chapterCursor - 1,
      hasBible: !!state.bible,
      openPlotThreads: state.openPlotThreads,
      currentArc: state.currentArc ?? null,
      completedArcs: state.completedArcs ?? [],
      latestKpi: latestKpi
        ? { qualityScore: latestKpi.qualityScore, overallScore: latestKpi.overallScore }
        : null,
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

  async updateChapter(
    bookId: string,
    chapterNumber: number,
    update: { title?: string; content?: string },
  ): Promise<unknown> {
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
      };
    }

    await this.chapterRepo.update({ bookId, chapterNumber }, patch);

    const updated = await this.chapterRepo.findOneBy({ bookId, chapterNumber });
    return {
      bookId: updated!.bookId,
      chapterNumber: updated!.chapterNumber,
      title: updated!.title,
      content: updated!.content,
      createdAt: updated!.createdAt.toISOString(),
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
      roughOutline: state.roughOutline,
      chapterSummaries: state.chapterSummaries,
    };
  }

  async listChapters(bookId: string, limit: number): Promise<unknown> {
    const exists = await this.bookRepo.count({ where: { bookId } });
    if (exists === 0) throw new NotFoundException(`Book not found: ${bookId}`);
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

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async generateChapterUnsafe(
    bookId: string,
    runtimeOptions?: GenerateChapterRuntimeOptions,
  ): Promise<ChapterWorkflowResult> {
    let state = await this.loadBookState(bookId);
    const chapterNumber = state.chapterCursor;

    return this.llmUsageTracker.runWithChapterScope(
      { bookId, chapterNumber },
      async () => {
        try {
          if (!state.currentArc) {
            state = await this.deepMaintenance.bootstrapInitialArc(state);
          }
          const previousChapterEnding = await this.getPreviousChapterEnding(bookId, chapterNumber);
          const pipelineNodes = await this.pipelineService.getPublishedNodes(bookId);
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

          // Persist artifacts.
          await this.persistArtifactsBatch(bookId, chapterNumber, [
            { name: 'intent', data: result.intent },
            { name: 'review', data: result.review },
            { name: 'deterministic_check', data: result.deterministicCheck },
            { name: 'lore_record', data: result.loreRecord },
          ]);

          // Update high-fidelity detail store (角色细节档案) based on this chapter.
          await this.updateDetailStoreFromChapter(
            bookId,
            result.finalDraft,
            result.loreRecord,
          );

          // Apply lore: creates new world elements + applies deltas.
          state = this.loreService.applyLore(state, result.loreRecord, result.intent);

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
          state.chapterCursor += 1;
          state.updatedAt = new Date().toISOString();
          state.kpiHistory.push(generationKpiSchema.parse({
            hardPass: result.deterministicCheck.pass,
            continuityPass: result.review.dimensions.consistency >= 7,
            qualityPass: result.review.dimensions.proseQuality >= 7,
            juryPass: result.review.dimensions.engagement >= 7,
            qualityScore: result.review.dimensions.proseQuality,
            overallScore: result.overallScore,
          }));

          // Apply retroactive foreshadowing seeds to past chapters.
          state = await this.applyPendingForeshadowing(state);

          // Compact and check maintenance trigger.
          state = this.compactState(state);
          const trigger = this.deepMaintenance.evaluateTrigger(state);
          if (trigger.shouldTrigger) {
            state = await this.deepMaintenance.execute(state, trigger);
            await this.persistArtifact(bookId, chapterNumber, 'maintenance_trigger', trigger);
          }

          await this.persistBookState(state);
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
  ): Promise<void> {
    const chapterNumber = draft.chapterNumber;

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
    if (snapshot?.locationId) {
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

  private compactState(state: StoryState): StoryState {
    return {
      ...state,
      kpiHistory: state.kpiHistory.slice(-NovelService.MAX_KPI),
      chapterSummaries: state.chapterSummaries.slice(-NovelService.MAX_SUMMARIES),
      timelineEvents: (state.timelineEvents ?? []).slice(-NovelService.MAX_TIMELINE),
      characterFactLedger: (state.characterFactLedger ?? [])
        .filter((f) => f.status !== 'deprecated')
        .slice(-NovelService.MAX_FACTS),
      plotThreadLedger: (state.plotThreadLedger ?? []).filter((t) => {
        if (t.status === 'open') return true;
        return state.chapterCursor - t.lastTouchedChapter < 50;
      }),
      completedArcs: (state.completedArcs ?? []).slice(-NovelService.MAX_COMPLETED_ARCS),
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
  private async applyPendingForeshadowing(state: StoryState): Promise<StoryState> {
    const seeds = (state.pendingForeshadowingSeeds ?? []).filter((s) => !s.applied);
    if (seeds.length === 0) return state;

    const applied: string[] = [];

    for (const seed of seeds) {
      if (seed.targetChapterNumber >= state.chapterCursor) continue;

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
  private async getPreviousChapterEnding(bookId: string, currentChapter: number): Promise<string | undefined> {
    if (currentChapter <= 1) return undefined;
    const prev = await this.chapterRepo.findOneBy({
      bookId,
      chapterNumber: currentChapter - 1,
    });
    if (!prev?.content) return undefined;
    const content = prev.content;
    const tail = content.slice(-500);
    const firstNewline = tail.indexOf('\n');
    return firstNewline > 0 ? tail.slice(firstNewline + 1) : tail;
  }

  // -------------------------------------------------------------------------
  // DB helpers
  // -------------------------------------------------------------------------

  private async loadBookState(bookId: string): Promise<StoryState> {
    const book = await this.bookRepo.findOneBy({ bookId });
    if (!book) throw new NotFoundException(`Book not found: ${bookId}`);
    return storyStateSchema.parse(book.stateJson);
  }

  private async persistBookState(state: StoryState): Promise<void> {
    await this.bookRepo.save({
      bookId: state.bookId,
      stateJson: state as unknown as Record<string, unknown>,
    });
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
}
