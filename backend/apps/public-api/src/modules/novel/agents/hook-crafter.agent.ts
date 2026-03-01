/**
 * 钩子工匠（步骤 6）：
 * 专门优化章节结尾钩子——让读者无法停下来。
 * 只改动最后几段，不影响正文其余部分。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  StoryState,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import { buildCompactContextProse, UNIFIED_AGENT_MAX_CHARACTERS } from '../prompting/novel-playbook';
import { buildAudiencePromptBlock } from '../prompting/audience-directive';

@Injectable()
export class HookCrafterAgent {
  private readonly logger = new Logger(HookCrafterAgent.name);

  constructor(private readonly llm: LlmService) {}

  private resolveHookTypeId(
    raw: string,
    hookTypes: Array<{ id?: string; label?: string }>,
  ): string | null {
    const v = raw.trim().toLowerCase();
    const byId = hookTypes.find((h) => h.id.toLowerCase() === v);
    if (byId) return byId.id;
    const byLabel = hookTypes.find((h) => h.label.trim().toLowerCase() === v);
    if (byLabel) return byLabel.id;
    const byInclude = hookTypes.find((h) => v.includes(h.id.toLowerCase()) || v.includes(h.label.trim().toLowerCase()));
    return byInclude?.id ?? null;
  }

  async enhanceHook(
    state: StoryState,
    intent: ChapterIntent,
    draft: ChapterDraft,
    playbooks?: Record<string, string>,
  ): Promise<ChapterDraft> {
    const profile = state.bookPromptProfile;
    const isLiterary = state.seed.writingMode === 'literary';
    const hookTypeDefs = (profile.hookTypes ?? []).filter(
      (h): h is { id: string; label: string; description?: string } =>
        typeof h.id === 'string' && h.id.length > 0 && typeof h.label === 'string' && h.label.length > 0,
    );
    const hookTypes = hookTypeDefs.map((h) => `${h.id}(${h.label}): ${h.description}`).join('\n');
    const repeatWindow = isLiterary ? 1 : (state.bookStrategy?.hookCadencePolicy?.avoidRecentRepeatWindow ?? 3);
    const recentHooks = (state.recentHookTypes ?? []).slice(-repeatWindow);
    const recentHookStr = recentHooks.map((h) => h.hookType).join('→');
    const recentHookSet = new Set(recentHooks.map((h) => h.hookType));
    const preferred = (state.bookStrategy?.hookCadencePolicy?.preferredTypes ?? [])
      .map((raw) => this.resolveHookTypeId(raw, hookTypeDefs))
      .filter((v): v is string => !!v);
    const baseAllowed = preferred.length > 0 ? preferred : hookTypeDefs.map((h) => h.id);
    const filteredAllowed = baseAllowed.filter((id) => !recentHookSet.has(id));
    const allowedHookTypes = filteredAllowed.length > 0 ? filteredAllowed : baseAllowed;
    const storyContext = buildCompactContextProse(state, {
      maxCharacters: UNIFIED_AGENT_MAX_CHARACTERS,
      maxChapterSummaries: 3,
      maxOpenThreads: 6,
      maxTimelineEvents: 8,
    });

    const paragraphs = draft.content.split('\n');
    const lastParagraphs = paragraphs.slice(-12).join('\n');

    const firstTry = await this.llm.generateStructured({
      taskName: 'hook-crafter',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'hook'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
      },
      systemPrompt: `${playbooks?.['agent:hook-crafter:role'] ?? (isLiterary
        ? '你是一位文学结尾工匠——打磨章节结尾的最后几段。\n目标：让读者在读完最后一行后感到余韵悠长——可以是悬念，也可以是一个挥之不去的意象、一个没说出口的话、一种无法命名的情绪。'
        : '你是一位钩子工匠——专门打磨章节结尾的最后几段。\n唯一目标：让读者读完最后一行后无法克制地想点"下一章"。')}

=== ${isLiterary ? '结尾' : '基础钩子'}技法 ===
${playbooks?.['agent:hook-crafter:basic_techniques'] ?? (isLiterary
  ? '1. 悬念断裂——最紧张瞬间戛然而止（传统但有效）\n2. 安静共鸣——结尾是一个细微的感官细节/意象，让情绪在读者心中持续回荡\n3. 开放问题——结尾提出一个无法立即回答的问题（不一定是情节上的）\n4. 意象消融——最后的画面如水墨般化开，暗示了某种无法言说的东西\n5. 情感悬崖——角色面临内心深处的选择\n6. 认知位移——最后一句让前面所有内容的意义微妙地变化'
  : '1. 悬念断裂——最紧张瞬间戛然而止\n2. 信息炸弹——最后一句翻转认知\n3. 情感悬崖——角色面临无法逃避的选择\n4. 时间压力——"距离XX只剩三天"\n5. 视角切换——切到另一角色的惊人发现')}

=== 高阶${isLiterary ? '结尾' : '钩子'}技法 ===
${playbooks?.['agent:hook-crafter:advanced_techniques'] ?? (isLiterary
  ? '6. 主题回响——结尾的意象/动作与核心命题形成呼应\n7. 时间折叠——跳到一个未来或过去的碎片，让读者重新审视当下\n8. 静水深流——表面平静，越想越不安\n9. 对话余韵——最后一句对白意在言外，读者自行补全\n10. 感官锚点——一个独特的气味/声音/触感，标记这一章的情感温度'
  : '6. 叠加式——两个悬念同时引爆\n7. 认知翻转——最后一句暗示全搞错了\n8. 静水深流——表面平静，细想脊背发凉\n9. 预期翻转——通过场景暗示\n10. 信息差钩子——利用活跃信息差')}

=== 信息差利用 ===
${(() => {
  const gaps = (state.informationLedger ?? { activeGaps: [] }).activeGaps;
  if (gaps.length === 0) return '当前无活跃信息差。';
  return '可利用的信息差（选一个最适合的）：\n' + gaps.slice(0, 3).map((g) => `- [${g.type}] ${g.secret}（${g.knownBy.join(',')}知道，${g.unknownTo.join(',')}不知道）`).join('\n');
})()}

=== 硬规则 ===
${playbooks?.['agent:hook-crafter:hard_rules'] ?? '- 只修改最后3-5段，保留前面所有内容\n- 钩子必须有具体内容，不能空泛\n- 与近期钩子类型不重复\n- 不能破坏已有伏线逻辑\n- 输出完整章节（标题+全文）'}
- 输出时必须给出 selectedHookType，且只能从允许列表中选择。

本书可用钩子类型：
${hookTypes}
允许钩子类型（硬限制）：${allowedHookTypes.join('、')}
禁止重复窗口（硬限制）：最近${repeatWindow}章内已用类型=${[...recentHookSet].join('、') || '无'}

${buildAudiencePromptBlock(state)}
${playbooks?.['__bookStrategy'] ?? ''}
${playbooks?.['__policySlice'] ?? ''}`,
      userPrompt: `故事上下文（精简）：
${storyContext}

钩子方向：${intent.hookDirection}
近期钩子类型：${recentHookStr || '暂无'}
${recentHooks.length >= 2 && new Set(recentHooks.map((h) => h.hookType)).size === 1
  ? '⚠️ 连续使用相同类型！请换一种。'
  : ''}

当前章节结尾部分：
${lastParagraphs}

请优化结尾钩子，输出完整章节（保持 chapterNumber=${draft.chapterNumber}）。`,
      temperature: 0.75,
    });
    firstTry.chapterNumber = draft.chapterNumber;
    return firstTry;
  }
}
