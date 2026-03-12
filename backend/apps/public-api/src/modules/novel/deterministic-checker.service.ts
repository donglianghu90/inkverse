/**
 * 轻量确定性检查器（V2）。
 * 不需要 LLM，纯代码逻辑。适配新的 ChapterIntent schema。
 * 保留旧 HardValidator 中有价值的检查逻辑。
 */
import { Injectable } from '@nestjs/common';
import {
  ChapterIntent,
  DeterministicCheckResult,
  StoryState,
} from './schemas/novel-state.schemas';
import { ChapterDraft } from './schemas/novel.schemas';

@Injectable()
export class DeterministicCheckerService {
  check(
    state: StoryState,
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
    const targetWords = state.seed.targetChapterWordCount ?? 3000; // 用户设置的硬性基准
    const hardMin = Math.round(targetWords * 0.85); // 允许 -15% 误差
    const hardMax = Math.round(targetWords * 1.35); // 允许 +35% 误差
    if (charCount < hardMin) {
      failedChecks.push({
        rule: 'word_count_too_short',
        detail: `${charCount} 字，硬性下限 ${hardMin}（目标 ${targetWords}）`,
      });
    }
    if (charCount > hardMax) {
      failedChecks.push({
        rule: 'word_count_too_long',
        detail: `${charCount} 字，硬性上限 ${hardMax}（目标 ${targetWords}）`,
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

    // ── 讲述而非展示 (telling vs showing) ──
    const tellingPatterns = content.match(/[他她](?:感到|感受到|觉得|意识到|知道|明白|认为|确信|心想|心中暗想|心中暗道|内心深处)/g);
    const tellingCount = tellingPatterns?.length ?? 0;
    if (tellingCount > 5) {
      failedChecks.push({
        rule: 'telling_not_showing',
        detail: `"讲述而非展示"出现 ${tellingCount} 次（上限5），用动作/感官替代直述情绪`,
      });
    }

    // ── 段首句式重复 ──
    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let maxConsecutiveSameStart = 1, curRun = 1, lastStart = '';
    for (const line of lines) {
      const first = line.charAt(0);
      if (first === lastStart && /[他她]/.test(first)) { curRun++; maxConsecutiveSameStart = Math.max(maxConsecutiveSameStart, curRun); }
      else { curRun = 1; }
      lastStart = first;
    }
    if (maxConsecutiveSameStart >= 4) {
      failedChecks.push({
        rule: 'paragraph_start_repetition',
        detail: `连续 ${maxConsecutiveSameStart} 段以相同字（他/她）开头，缺乏句式变化`,
      });
    }

    // ── AI味深层检测 ──
    const aiSmellPhrases = ['不禁', '不由得', '不由自主', '深吸一口气', '长舒一口气', '嘴角微扬', '嘴角上扬', '眼中闪过一丝', '目光微凝'];
    const aiSmellHits = aiSmellPhrases.filter((p) => content.includes(p));
    if (aiSmellHits.length >= 4) {
      failedChecks.push({
        rule: 'ai_smell_patterns',
        detail: `AI味套路表达 ${aiSmellHits.length} 种：${aiSmellHits.join('、')}`,
      });
    }

    // ── 对话标签重复 ──
    const dialogueTags = content.match(/[说道](?:：|:)/g);
    const dialogueTagCount = dialogueTags?.length ?? 0;
    const dialogueLines = content.match(/["「].+?["」]/g)?.length ?? 0;
    if (dialogueLines >= 5 && dialogueTagCount / Math.max(dialogueLines, 1) > 0.7) {
      failedChecks.push({
        rule: 'monotone_dialogue_tags',
        detail: `对话标签过于单调（${dialogueTagCount}/${dialogueLines}句用"说/道"），需增加动作标签`,
      });
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
