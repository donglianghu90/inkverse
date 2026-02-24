/**
 * 轻量确定性检查器（V2）。
 * 不需要 LLM，纯代码逻辑。适配新的 ChapterIntent schema。
 * 保留旧 HardValidator 中有价值的检查逻辑。
 */
import { Injectable } from '@nestjs/common';
import {
  ChapterIntent,
  DeterministicCheckResult,
  StoryStateV2,
} from '../schemas/novel-v2.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';

@Injectable()
export class DeterministicCheckerService {
  check(
    state: StoryStateV2,
    intent: ChapterIntent,
    draft: ChapterDraft,
  ): DeterministicCheckResult {
    const failedChecks: { rule: string; detail: string }[] = [];
    const content = draft.content ?? '';

    if (draft.chapterNumber !== intent.chapterNumber) {
      failedChecks.push({
        rule: 'chapter_number_mismatch',
        detail: `期望 ${intent.chapterNumber}，实际 ${draft.chapterNumber}`,
      });
    }

    const charCount = content.replace(/\s+/g, '').length;
    if (charCount < intent.wordCountRange.min) {
      failedChecks.push({
        rule: 'word_count_too_short',
        detail: `${charCount} 字，最低 ${intent.wordCountRange.min}`,
      });
    }
    if (charCount > intent.wordCountRange.max) {
      failedChecks.push({
        rule: 'word_count_too_long',
        detail: `${charCount} 字，最高 ${intent.wordCountRange.max}`,
      });
    }

    const blockedCharacters = state.characters.filter((c) => {
      const lifecycle = c.status.lifecycleStatus ?? 'active';
      const canRef = c.status.dormantReference ?? false;
      return (
        ((lifecycle === 'dead' || lifecycle === 'exited') && !canRef) ||
        (lifecycle === 'dormant' && !canRef)
      );
    });
    for (const character of blockedCharacters) {
      if (this.hasCharacterMention(content, character.name, character.aliases ?? [])) {
        failedChecks.push({
          rule: 'blocked_character_mentioned',
          detail: `禁止出场角色 ${character.name}(${character.id}) 在正文中被提及`,
        });
      }
    }

    const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length < 3) {
      failedChecks.push({
        rule: 'too_few_paragraphs',
        detail: `仅 ${paragraphs.length} 段，章节结构过于单薄`,
      });
    }

    const lastParagraph = paragraphs[paragraphs.length - 1] ?? '';
    if (lastParagraph.length < 20) {
      failedChecks.push({
        rule: 'weak_ending',
        detail: '最后一段过短，钩子可能不足',
      });
    }

    if (!draft.title || draft.title.trim().length < 2) {
      failedChecks.push({
        rule: 'missing_title',
        detail: '章节标题缺失或过短',
      });
    }

    if (/第\s*\d+\s*章/.test(draft.title)) {
      failedChecks.push({
        rule: 'template_title',
        detail: '章节标题使用了"第X章"模板格式',
      });
    }

    const recentPhrases = state.recentDistinctivePhrases ?? [];
    if (recentPhrases.length > 0) {
      const repeated = recentPhrases.filter((p) => content.includes(p));
      if (repeated.length >= 3) {
        failedChecks.push({
          rule: 'excessive_phrase_repetition',
          detail: `与近期章节重复了 ${repeated.length} 个特征表达：${repeated.slice(0, 3).join('、')}`,
        });
      }
    }

    const profileCliches = state.bookPromptProfile?.clichePatterns ?? [];
    for (const cliche of profileCliches) {
      const escapedPattern = cliche.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escapedPattern, 'g');
      const matches = content.match(re);
      const count = matches?.length ?? 0;
      if (count > cliche.maxPerChapter) {
        failedChecks.push({
          rule: 'cliche_overuse',
          detail: `套话"${cliche.pattern}"在本章出现了 ${count} 次（上限 ${cliche.maxPerChapter}）`,
        });
      }
    }

    return {
      pass: failedChecks.length === 0,
      failedChecks,
    };
  }

  private hasCharacterMention(
    content: string,
    name: string,
    aliases: string[],
  ): boolean {
    const tokens = [name, ...aliases]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    return tokens.some((token) => content.includes(token));
  }
}
