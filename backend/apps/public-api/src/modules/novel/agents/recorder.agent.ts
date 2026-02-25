/**
 * 记录员角色（步骤 7）— 并行拆分版：
 * 将提取任务拆分为三个并行子任务，提升速度和准确性：
 * 1. TextAnalyzer: 基础文本分析（摘要、新实体、角色状态）
 * 2. WorldExtractor: 世界状态变化（关系、伏线、势力、时间）
 * 3. NarrativeExtractor: 叙事元素（悬念、信息差、爽感、钩子）
 *
 * 三个结果合并为统一的 LoreRecord。
 */
import { Injectable, Logger } from '@nestjs/common';
import { TextAnalyzerAgent } from './text-analyzer.agent';
import { WorldExtractorAgent } from './world-extractor.agent';
import { NarrativeExtractorAgent } from './narrative-extractor.agent';
import {
  StoryState,
  MaintenanceState,
} from '../schemas/novel-state.schemas';
import {
  ChapterDraft,
  LoreRecord,
} from '../schemas/novel.schemas';

@Injectable()
export class RecorderAgent {
  private readonly logger = new Logger(RecorderAgent.name);

  constructor(
    private readonly textAnalyzer: TextAnalyzerAgent,
    private readonly worldExtractor: WorldExtractorAgent,
    private readonly narrativeExtractor: NarrativeExtractorAgent,
  ) {}

  async record(
    state: StoryState,
    draft: ChapterDraft,
    additionalSystemPrompt?: string,
  ): Promise<LoreRecord> {
    const t0 = Date.now();
    this.logger.log(
      `[Recorder] 并行提取开始 | 章节: ${draft.chapterNumber}`,
    );

    const [textResult, worldResult, narrativeResult] = await Promise.all([
      this.textAnalyzer.analyze(state, draft, additionalSystemPrompt),
      this.worldExtractor.extract(state, draft, additionalSystemPrompt),
      this.narrativeExtractor.extract(state, draft, additionalSystemPrompt),
    ]);

    this.logger.log(
      `[Recorder] 并行提取完成 — ${Date.now() - t0}ms | ` +
      `新角色: ${textResult.newCharacters.length} | ` +
      `关系变更: ${worldResult.relationshipDeltas.length} | ` +
      `伏线变更: ${worldResult.plotThreadDeltas.length}`,
    );

    return {
      chapterNumber: draft.chapterNumber,
      summary: textResult.summary,
      openLoops: narrativeResult.openLoops,
      closedLoops: narrativeResult.closedLoops,
      stateChanges: narrativeResult.stateChanges,
      knowledgeFragments: narrativeResult.knowledgeFragments,
      newCharacters: textResult.newCharacters,
      newLocations: textResult.newLocations,
      newItems: textResult.newItems,
      characterLifecycleDeltas: textResult.characterLifecycleDeltas,
      relationshipDeltas: worldResult.relationshipDeltas,
      timelineEventDeltas: worldResult.timelineEventDeltas,
      plotThreadDeltas: worldResult.plotThreadDeltas,
      characterAliasDeltas: textResult.characterAliasDeltas,
      characterFactDeltas: textResult.characterFactDeltas,
      characterProfileDeltas: textResult.characterProfileDeltas,
      characterVoiceDeltas: textResult.characterVoiceDeltas,
      curiosityDeltas: narrativeResult.curiosityDeltas,
      informationGapDeltas: narrativeResult.informationGapDeltas,
      satisfactionEvents: narrativeResult.satisfactionEvents,
      foreshadowingOpportunities: narrativeResult.foreshadowingOpportunities,
      timeDelta: worldResult.timeDelta,
      addressDeltas: worldResult.addressDeltas,
      sceneSnapshot: worldResult.sceneSnapshot,
      locationProfileDeltas: worldResult.locationProfileDeltas,
      itemProfileDeltas: worldResult.itemProfileDeltas,
      factionDeltas: worldResult.factionDeltas,
      commitmentDeltas: worldResult.commitmentDeltas,
      hookClassification: narrativeResult.hookClassification,
    };
  }

  updateMaintenanceCounters(
    current: MaintenanceState,
    lore: LoreRecord,
  ): MaintenanceState {
    const newCharacters = (lore.newCharacters ?? []).length;
    const newLocations = (lore.newLocations ?? []).length;
    const newThreads = lore.plotThreadDeltas.filter(
      (d) => d.action === 'open',
    ).length;
    const newFacts = (lore.characterFactDeltas ?? []).filter(
      (d) => d.action === 'add',
    ).length;

    return {
      ...current,
      newCharactersSinceLastMaintenance: current.newCharactersSinceLastMaintenance + newCharacters,
      newLocationsSinceLastMaintenance: current.newLocationsSinceLastMaintenance + newLocations,
      newThreadsSinceLastMaintenance: current.newThreadsSinceLastMaintenance + newThreads,
      newFactsSinceLastMaintenance: current.newFactsSinceLastMaintenance + newFacts,
    };
  }
}
