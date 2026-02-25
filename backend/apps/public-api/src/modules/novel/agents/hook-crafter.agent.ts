/**
 * 钩子工匠（步骤 6）：
 * 专门优化章节结尾钩子——让读者无法停下来。
 * 只改动最后几段，不影响正文其余部分。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  ChapterIntent,
  StoryState,
} from '../schemas/novel-state.schemas';
import { ChapterDraft, chapterDraftSchema } from '../schemas/novel.schemas';
import { buildCompactContextProse } from '../prompting/novel-playbook';

@Injectable()
export class HookCrafterAgent {
  constructor(private readonly llm: LlmService) {}

  async enhanceHook(
    state: StoryState,
    intent: ChapterIntent,
    draft: ChapterDraft,
  ): Promise<ChapterDraft> {
    const profile = state.bookPromptProfile;
    const hookTypes = profile.hookTypes.map((h) => `${h.id}(${h.label}): ${h.description}`).join('\n');
    const recentHooks = (state.recentHookTypes ?? []).slice(-3);
    const recentHookStr = recentHooks.map((h) => h.hookType).join('→');

    const paragraphs = draft.content.split('\n');
    const lastParagraphs = paragraphs.slice(-12).join('\n');

    return this.llm.generateStructured({
      taskName: 'hook-crafter',
      schema: chapterDraftSchema,
      tags: ['workflow', 'chapter', 'hook'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: intent.chapterNumber,
      },
      systemPrompt: `你是一位钩子工匠——专门打磨章节结尾的最后几段。
唯一目标：让读者读完最后一行后无法克制地想点"下一章"。

=== 基础钩子技法 ===
1. 悬念断裂——在最紧张的瞬间戛然而止（"他推开门，看到的不是……"但不写出来）
2. 信息炸弹——最后一句话翻转认知（"那个人……竟然是他父亲。"）
3. 情感悬崖——角色面临无法逃避的选择
4. 时间压力——"距离XX只剩三天"
5. 视角切换——切到另一个角色的惊人发现

=== 高阶钩子技法（用这些让钩子从"不错"变成"无法放下"）===
6. 叠加式——两个悬念同时引爆。上一个问题还没解决，新的更大问题出现。
7. 认知翻转——读者以为知道真相，最后一句暗示他们全搞错了。
8. 静水深流（猫腻式）——表面平静的一句话，细想之下却脊背发凉。不需要戏剧性的"轰然"。
9. 预期翻转——暗示下一章会很精彩（"他不知道的是，等待他的远不止这些"），但不要用这种直白的叙述体，而是通过场景暗示。
10. 信息差钩子——利用当前活跃的信息差制造钩子：读者知道但角色不知道的事即将被角色触碰到。

=== 信息差利用 ===
${(() => {
  const gaps = (state.informationLedger ?? { activeGaps: [] }).activeGaps;
  if (gaps.length === 0) return '当前无活跃信息差。';
  return '可利用的信息差（选一个最适合的）：\n' + gaps.slice(0, 3).map((g) => `- [${g.type}] ${g.secret}（${g.knownBy.join(',')}知道，${g.unknownTo.join(',')}不知道）`).join('\n');
})()}

=== 硬规则 ===
- 只修改最后3-5段，保留前面所有内容
- 钩子必须有具体内容，不能是空泛的"危险逼近"
- 与近期钩子类型不重复
- 不能破坏已有伏线逻辑
- 输出完整章节（标题+全文）

本书可用钩子类型：
${hookTypes}`,
      userPrompt: `钩子方向：${intent.hookDirection}
近期钩子类型：${recentHookStr || '暂无'}
${recentHooks.length >= 2 && new Set(recentHooks.map((h) => h.hookType)).size === 1
  ? '⚠️ 连续使用相同类型！请换一种。'
  : ''}

当前章节结尾部分：
${lastParagraphs}

完整章节：
标题：${draft.title}
正文：
${draft.content}

请优化结尾钩子，输出完整的章节（保持 chapterNumber=${draft.chapterNumber}）。`,
      temperature: 0.75,
    });
  }
}
