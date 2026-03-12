/**
 * 连续性守卫（步骤 2）：
 * 写前预检——识别当前意图中可能导致连续性错误的风险点。
 * 输出注入提示给写手，预防胜于修复。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import {
  ChapterIntent,
  ContinuityPreCheck,
  StoryState,
  continuityPreCheckSchema,
} from '../../schemas/novel-state.schemas';
import { buildCompactContext, UNIFIED_AGENT_MAX_CHARACTERS } from '../../prompting/novel-playbook';

@Injectable()
export class ContinuityGuardAgent {
  constructor(private readonly llm: LlmService) {}

  async preCheck(state: StoryState, intent: ChapterIntent): Promise<ContinuityPreCheck> {
    const context = buildCompactContext(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 3,
      maxOpenThreads: 8,
    });

    const blockedCharacters = state.characters
      .filter((c) => {
        const lc = c.status.lifecycleStatus ?? 'active';
        const canRef = c.status.dormantReference ?? false;
        return ((lc === 'dead' || lc === 'exited') && !canRef) || (lc === 'dormant' && !canRef);
      })
      .map((c) => `${c.name}(${c.id}): ${c.status.lifecycleStatus}`);

    return this.llm.generateStructured({
      taskName: 'continuity-guard',
      schema: continuityPreCheckSchema,
      tags: ['workflow', 'chapter', 'continuity'],
      metadata: {
        userId: state.userId,
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
      },
      systemPrompt: `你是一位连续性审查专家。写作前预检——预防胜于修复。

你的输出两部分：
1. warnings: 连续性问题（block=必须修复，warning=需注意）
2. contextInjections: 给写手的简短提醒（每条不超过30字）

=== 物理连续性检查 ===
- activeCharacterIds 是否包含已死亡/退场/休眠角色
- 场景时间/地点是否与上章结束快照衔接
- 角色能力是否超出当前等级
- 势力关系是否被正确反映
- 叙事视角是否一致

=== 情绪连续性检查（同样重要）===
- 上章结尾角色的情绪状态是什么？本章开头是否承接？
  例：上章结尾主角目睹师父被杀→本章开头不可能平静
  例：上章结尾两人激烈争吵→本章开头不可能若无其事
- 角色间的关系张力是否延续？（上章刚发生冲突，本章不能自动和好）
- 承诺/Flag 是否与本章目标矛盾？

=== contextInjections 要求 ===
不只是"不要做什么"的限制，也要包含"应该做什么"的引导：
- 限制型："李四已死亡，不可出现"
- 延续型："张三上章受伤昏迷，本章开头必须延续"
- 情绪型："主角上章目睹背叛，本章情绪应带有愤怒和不信任"
- 氛围型："当前深夜，场景应黑暗安静"
- 关系型："王五和赵六上章发生冲突，本章互动应有紧张感"`,
      userPrompt: `本章意图：
${JSON.stringify({
  chapterNumber: intent.chapterNumber,
  goals: intent.goals,
  activeCharacterIds: intent.characterAvailability.activeCharacterIds,
  blockedCharacterIds: intent.characterAvailability.blockedCharacterIds,
  carryover: intent.carryoverFromLastChapter,
}, null, 2)}

禁止出场角色：
${blockedCharacters.length > 0 ? blockedCharacters.join('\n') : '无'}

上章结束场景：
${JSON.stringify(state.lastSceneSnapshot ?? '无快照', null, 2)}

故事时间：
${JSON.stringify(state.storyClock ?? '无时钟', null, 2)}

活跃承诺：
${JSON.stringify((state.activeCommitments ?? []).filter((c) => c.status === 'active').slice(0, 5), null, 2)}

故事上下文：
${JSON.stringify(context, null, 2)}`,
      temperature: 0.2,
    });
  }
}
