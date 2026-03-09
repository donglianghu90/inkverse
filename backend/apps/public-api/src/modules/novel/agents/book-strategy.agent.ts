import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import {
  AudienceDirective,
  BookPromptProfile,
  BookStrategy,
  bookStrategySchema,
  RoughOutline,
  StorySeed,
  StoryState,
  characterBudgetSchema,
  characterFocusPolicySchema,
  hookCadencePolicySchema,
  threadPolicySchema,
} from '../schemas/novel-state.schemas';

const refreshPolicySchema = z.object({
  hookCadencePolicy: hookCadencePolicySchema,
  threadPolicy: threadPolicySchema,
  characterFocusPolicy: characterFocusPolicySchema,
  characterBudget: characterBudgetSchema,
});

@Injectable()
export class BookStrategyAgent {
  constructor(private readonly llm: LlmService) {}

  async generateInitial(input: {
    seed: StorySeed;
    outline: RoughOutline;
    audienceDirective?: AudienceDirective;
    profile: BookPromptProfile;
    userId?: string;
  }): Promise<BookStrategy> {
    const result = await this.llm.generateStructured({
      taskName: 'book-strategy-init',
      schema: bookStrategySchema,
      tags: ['setup', 'book-strategy'],
      metadata: { userId: input.userId ?? '' },
      systemPrompt: `你是网文总策划，负责生成“书级策略（L2）”。书级策略必须稳定、可执行，不要写空话。

输出要求：
1) coreNarrativeContract：100-220字，说明这本书“每章必须交付什么体验”。
2) toneGuardrails：5-8条，写清“允许什么、不允许什么”。
3) audienceDeliveryPolicy：80-180字，描述如何持续满足目标读者期待。
4) hookCadencePolicy：给出偏好钩子类型、重复窗口、激进程度和结尾指令。
5) threadPolicy：给出每章开坑上限、优先动作、逾期优先级、回收密度偏好。
6) characterFocusPolicy：给出核心角色ID列表、辅助角色ID列表、轮转模式、每章最少角色时刻。
7) characterBudget：每章出场角色上限(2-12)、弧内新角色上限(1-8)、核心角色缺席告警章数、重要角色缺席告警章数、配角/龙套冷却章数。参考：长篇玄幻6/3/3/8/5/15，短篇悬疑4/2/2/5/3/10，群像剧8/4/2/6/3/10。

规则：
- 这是书级中层策略，不要写章节级细节。
- 题材规则优先于受众偏好。
- 保持通俗、可被下游agent直接执行。`,
      userPrompt: `题材：${input.seed.genre}
目标读者：${input.seed.targetAudience}
一句话梗概：${input.seed.logline}
核心冲突：${input.seed.coreConflictDirection}
主线目标：${input.seed.mainStoryGoal ?? '（未提供）'}
主题命题：${input.seed.thematicCore?.centralQuestion ?? '（未提供）'}
大纲阶段数：${input.outline.points.length}（预计总章数${input.outline.estimatedTotalChapters ?? 600}）
受众策略：${JSON.stringify(input.audienceDirective ?? {}, null, 2)}
主角：${input.seed.protagonistConcept?.name ?? 'char_protagonist'}（${input.seed.protagonistConcept?.personality ?? '未知'}）
可用钩子类型ID（hookCadencePolicy.preferredTypes 必须从此列表选）：${(input.profile.hookTypes ?? []).map((h) => h.id).filter(Boolean).join('、') || '（未定义）'}`,
      temperature: 0.45,
    });
    return bookStrategySchema.parse({
      ...result,
      lastRefreshedAtChapter: 1,
    });
  }

  async refreshVolumePolicies(state: StoryState): Promise<Pick<BookStrategy, 'hookCadencePolicy' | 'threadPolicy' | 'characterFocusPolicy' | 'characterBudget'>> {
    const activeIds = state.characters
      .filter((c) => {
        const lc = c.status.lifecycleStatus ?? 'active';
        return lc === 'active' || lc === 'return_planned';
      })
      .slice(0, 12)
      .map((c) => c.id);
    const openThreads = (state.plotThreadLedger ?? [])
      .filter((t) => t.status === 'open')
      .slice(0, 12)
      .map((t) => ({
        id: t.id,
        label: t.label,
        setupChapter: t.setupChapter,
        lastTouchedChapter: t.lastTouchedChapter,
        plannedPayoffEndChapter: t.plannedPayoffEndChapter,
      }));
    const recentHooks = (state.recentHookTypes ?? []).slice(-5).map((h) => h.hookType);

    return this.llm.generateStructured({
      taskName: 'book-strategy-refresh-policies',
      schema: refreshPolicySchema,
      tags: ['workflow', 'book-strategy'],
      metadata: { userId: state.userId, bookId: state.bookId, chapterNumber: state.chapterCursor },
      systemPrompt: `你是卷级策略优化器。只刷新4个策略，不改其它：
1) hookCadencePolicy
2) threadPolicy
3) characterFocusPolicy
4) characterBudget（每章出场上限/弧内新角色上限/缺席告警/冷却期，根据新卷节奏调整）

约束：
- 这是“卷级刷新”，策略需覆盖接下来一个卷周期（约10-40章）。
- 不要与题材基线冲突。
- 保持可执行、简洁。`,
      userPrompt: `当前章：${state.chapterCursor}
题材：${state.seed.genre}
主线目标：${state.seed.mainStoryGoal ?? '（未提供）'}
当前卷：${state.currentVolume?.title ?? '（无）'}
当前弧：${state.currentArc?.arcTitle ?? '（无）'}
可用角色：${activeIds.join(',') || '无'}
开放伏线：${JSON.stringify(openThreads, null, 2)}
最近钩子类型：${recentHooks.join('→') || '无'}
现有策略：${JSON.stringify(state.bookStrategy ?? {}, null, 2)}`,
      temperature: 0.35,
    });
  }
}
