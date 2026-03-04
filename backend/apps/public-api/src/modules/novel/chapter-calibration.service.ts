/** 章节级自校准引擎 — 将重写中发现的问题反哺到书籍规则与配置 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import { BookPromptTemplateService } from './book-prompt-template.service';
import type { RuleAtom } from './schemas/rule-engine.schemas';
import type { StoryState, ChapterReview, BookPromptProfile } from './schemas/novel-state.schemas';

interface CalibrationConfig {
  issueRepeatThreshold: number; // 问题重复几次触发生成 RuleAtom
  maxActivePatterns: number; // recentIssuePatterns 最大保留条数
  autoRuleExpiryChapters: number; // auto_calibration 规则过期章数
  dimensionShiftWindow: number; // 维度偏移检测的滑动窗口（章数）
  dimensionShiftThreshold: number; // 维度均分低于此值触发权重微调
  weightAdjustStep: number; // 单次权重微调步长
  lessonPromoteMinConfidence: string; // lesson 升格所需最低 confidence
}

export interface CalibrationEvent {
  type: 'pattern_tracked' | 'rule_generated' | 'weight_adjusted' | 'cliche_added' | 'rule_expired' | 'lesson_promoted';
  chapter: number;
  detail: string;
}

const DIMENSION_KEYS = ['engagement', 'pacing', 'hookStrength', 'consistency', 'proseQuality', 'characterDepth'] as const;
const ISSUE_TO_DIMENSION: Record<string, string> = {
  pacing: 'pacing', hook: 'hookStrength', dialogue: 'proseQuality', prose_quality: 'proseQuality',
  ai_smell: 'proseQuality', character_voice: 'characterDepth', character_depth: 'characterDepth',
  emotional_logic: 'engagement', continuity: 'consistency', plot_thread: 'consistency',
};

@Injectable()
export class ChapterCalibrationService {
  private readonly logger = new Logger(ChapterCalibrationService.name);
  private readonly cfg: CalibrationConfig;

  constructor(
    private readonly configService: ConfigService,
    private readonly templateService: BookPromptTemplateService,
  ) {
    const raw = (this.configService.get('calibration') ?? {}) as Record<string, unknown>;
    this.cfg = {
      issueRepeatThreshold: Number(raw.issueRepeatThreshold) || 2,
      maxActivePatterns: Number(raw.maxActivePatterns) || 20,
      autoRuleExpiryChapters: Number(raw.autoRuleExpiryChapters) || 30,
      dimensionShiftWindow: Number(raw.dimensionShiftWindow) || 5,
      dimensionShiftThreshold: Number(raw.dimensionShiftThreshold) || 1.5,
      weightAdjustStep: Number(raw.weightAdjustStep) || 0.1,
      lessonPromoteMinConfidence: String(raw.lessonPromoteMinConfidence || 'strong'),
    };
  }

  /** 章节完成后调用 — 执行全部校准路径，返回更新后的 state */
  async calibrate(state: StoryState, review: ChapterReview, chapterNumber: number): Promise<{ state: StoryState; events: CalibrationEvent[] }> {
    const events: CalibrationEvent[] = [];
    state = this.trackIssuePatterns(state, review, chapterNumber, events);
    state = await this.generateRulesFromPatterns(state, chapterNumber, events);
    state = this.adjustDimensionWeights(state, review, chapterNumber, events);
    state = this.detectNewCliches(state, review, chapterNumber, events);
    state = await this.expireAutoRules(state, chapterNumber, events);
    return { state, events };
  }

  /** 弧结束时调用 — 将 strong lesson 升格为永久 RuleAtom */
  async promoteLessons(state: StoryState, chapterNumber: number): Promise<{ state: StoryState; events: CalibrationEvent[] }> {
    const events: CalibrationEvent[] = [];
    const toPromote = state.writingLessons.filter(
      (l) => l.confidence === this.cfg.lessonPromoteMinConfidence && !l.promotedToRuleAtomId,
    );
    for (const lesson of toPromote) {
      const atomId = `lesson_${lesson.id}`;
      const atom: RuleAtom = {
        id: atomId, category: this.lessonCategoryToRuleCategory(lesson.category),
        title: `[经验升格] ${lesson.insight.slice(0, 30)}`, content: `${lesson.insight}\n可执行建议：${lesson.actionable}`,
        priority: 65, targetAgents: ['creative-writer', 'reviewer'], outputKey: 'CALIBRATION_LESSONS',
        source: 'lesson_promoted', tags: ['auto', 'lesson'],
      };
      await this.templateService.addRuleAtom(state.bookId, atom);
      lesson.promotedToRuleAtomId = atomId;
      events.push({ type: 'lesson_promoted', chapter: chapterNumber, detail: `lesson=${lesson.id} → atom=${atomId}` });
      this.logger.log(`[Calibration] Lesson升格 ${lesson.id} → RuleAtom ${atomId}`);
    }
    return { state, events };
  }

  // ── 路径A：追踪问题模式 ──
  private trackIssuePatterns(state: StoryState, review: ChapterReview, ch: number, events: CalibrationEvent[]): StoryState {
    if (!state.recentIssuePatterns) state.recentIssuePatterns = [];
    for (const issue of review.issuesFound) {
      if (issue.severity === 'minor') continue;
      const dim = ISSUE_TO_DIMENSION[issue.category] ?? 'engagement';
      const sig = `${issue.category}:${issue.description.slice(0, 60)}`;
      const existing = state.recentIssuePatterns.find((p) => p.pattern === sig && p.status === 'active');
      if (existing) {
        existing.occurrences++;
        existing.lastSeenChapter = ch;
      } else {
        state.recentIssuePatterns.push({
          pattern: sig, dimension: dim, occurrences: 1, firstSeenChapter: ch, lastSeenChapter: ch, status: 'active',
        });
      }
      events.push({ type: 'pattern_tracked', chapter: ch, detail: sig });
    }
    if (state.recentIssuePatterns.length > this.cfg.maxActivePatterns) {
      state.recentIssuePatterns.sort((a, b) => b.occurrences - a.occurrences);
      state.recentIssuePatterns.length = this.cfg.maxActivePatterns;
    }
    return state;
  }

  // ── 路径A续：达到阈值时生成 RuleAtom ──
  private async generateRulesFromPatterns(state: StoryState, ch: number, events: CalibrationEvent[]): Promise<StoryState> {
    const ready = (state.recentIssuePatterns ?? []).filter(
      (p) => p.status === 'active' && p.occurrences >= this.cfg.issueRepeatThreshold && !p.generatedRuleAtomId,
    );
    for (const pattern of ready) {
      const atomId = `auto_cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const [category, ...descParts] = pattern.pattern.split(':');
      const desc = descParts.join(':');
      const atom: RuleAtom = {
        id: atomId, category: this.issueCategoryToRuleCategory(category),
        title: `[自校准] ${desc.slice(0, 40)}`, content: `该问题已在近${pattern.occurrences}章重复出现：${desc}。写作时务必规避此模式。`,
        priority: 70, targetAgents: ['creative-writer', 'reviewer'], outputKey: 'CALIBRATION_RULES',
        source: 'auto_calibration', tags: ['auto', pattern.dimension],
        expiresAfterChapters: this.cfg.autoRuleExpiryChapters, createdAtChapter: ch, hitCount: 0,
      };
      await this.templateService.addRuleAtom(state.bookId, atom);
      pattern.generatedRuleAtomId = atomId;
      events.push({ type: 'rule_generated', chapter: ch, detail: `pattern=${pattern.pattern} → atom=${atomId}` });
      this.logger.log(`[Calibration] 自动规则生成 ${atomId}: ${desc.slice(0, 60)}`);
    }
    return state;
  }

  // ── 路径B：维度偏移检测 + 权重微调（基于当前 review + calibrationHistory 防重复） ──
  private adjustDimensionWeights(state: StoryState, review: ChapterReview, ch: number, events: CalibrationEvent[]): StoryState {
    const profile = state.bookPromptProfile as BookPromptProfile | undefined;
    if (!profile?.reviewerCalibration) return state;
    const kpi = state.kpiHistory ?? [];
    if (kpi.length < this.cfg.dimensionShiftWindow) return state; // 章数不足，跳过
    const history = profile.reviewerCalibration.calibrationHistory ?? [];
    for (const dim of DIMENSION_KEYS) {
      const score = review.dimensions[dim] ?? 0;
      if (score >= this.cfg.dimensionShiftThreshold) continue; // 当前分不低，跳过
      const recentAdj = history.filter((h) => h.dimension === dim && ch - h.chapter < this.cfg.dimensionShiftWindow);
      if (recentAdj.length > 0) continue; // 近 N 章已调过此维度，跳过
      const weights = profile.reviewerCalibration.dimensionWeights as Record<string, number>;
      const oldW = weights[dim] ?? 1.0;
      const newW = Math.min(2.0, oldW + this.cfg.weightAdjustStep);
      if (newW === oldW) continue;
      weights[dim] = Number(newW.toFixed(2));
      if (!profile.reviewerCalibration.calibrationHistory) (profile.reviewerCalibration as any).calibrationHistory = [];
      profile.reviewerCalibration.calibrationHistory.push({ chapter: ch, dimension: dim, oldWeight: oldW, newWeight: newW, reason: `第${ch}章${dim}=${score.toFixed(1)}，低于阈值${this.cfg.dimensionShiftThreshold}` });
      events.push({ type: 'weight_adjusted', chapter: ch, detail: `${dim}: ${oldW}→${newW}` });
      this.logger.log(`[Calibration] 维度权重微调 ${dim}: ${oldW}→${newW}`);
    }
    return state;
  }

  // ── 路径C：检测新 AI 味/套话模式 ──
  private detectNewCliches(state: StoryState, review: ChapterReview, ch: number, events: CalibrationEvent[]): StoryState {
    const profile = state.bookPromptProfile as BookPromptProfile | undefined;
    if (!profile?.clichePatterns) return state;
    const aiSmellIssues = review.issuesFound.filter((i) => i.category === 'ai_smell');
    for (const issue of aiSmellIssues) {
      const pattern = issue.description.slice(0, 80);
      const exists = profile.clichePatterns.some((c: any) => c.pattern === pattern);
      if (exists) continue;
      profile.clichePatterns.push({ pattern, maxPerChapter: 0 } as any);
      events.push({ type: 'cliche_added', chapter: ch, detail: pattern });
      this.logger.log(`[Calibration] 新套话模式入库: ${pattern}`);
    }
    return state;
  }

  // ── 清理过期的自动规则 ──
  private async expireAutoRules(state: StoryState, ch: number, events: CalibrationEvent[]): Promise<StoryState> {
    const atoms = await this.templateService.getRuleAtoms(state.bookId);
    const toRemove = atoms.filter(
      (a) => a.source === 'auto_calibration' && a.createdAtChapter && a.expiresAfterChapters && ch - a.createdAtChapter > a.expiresAfterChapters,
    );
    for (const atom of toRemove) {
      await this.templateService.removeRuleAtom(state.bookId, atom.id);
      const pattern = (state.recentIssuePatterns ?? []).find((p) => p.generatedRuleAtomId === atom.id);
      if (pattern) pattern.status = 'expired';
      events.push({ type: 'rule_expired', chapter: ch, detail: `atom=${atom.id}` });
      this.logger.log(`[Calibration] 过期规则清理 ${atom.id}`);
    }
    return state;
  }

  // ── 辅助：issue category → RuleAtom category ──
  private issueCategoryToRuleCategory(cat: string): 'prose_craft' | 'writing_soul' | 'character_arc' | 'editor_discipline' | 'reviewer_rubric' | 'continuity_baseline' | 'thread_awareness' {
    const map: Record<string, string> = {
      pacing: 'writing_soul', hook: 'writing_soul', dialogue: 'prose_craft', prose_quality: 'prose_craft',
      ai_smell: 'prose_craft', character_voice: 'character_arc', character_depth: 'character_arc',
      emotional_logic: 'writing_soul', continuity: 'continuity_baseline', plot_thread: 'thread_awareness',
    };
    return (map[cat] ?? 'prose_craft') as any;
  }

  private lessonCategoryToRuleCategory(cat: string): 'prose_craft' | 'writing_soul' | 'character_arc' | 'editor_discipline' | 'reviewer_rubric' | 'continuity_baseline' | 'thread_awareness' {
    const map: Record<string, string> = {
      pacing: 'writing_soul', dialogue: 'prose_craft', character: 'character_arc', worldbuilding: 'continuity_baseline',
      hook: 'writing_soul', prose: 'prose_craft', structure: 'writing_soul', emotion: 'writing_soul',
    };
    return (map[cat] ?? 'prose_craft') as any;
  }
}
