/**
 * 角色声音教练：
 * 检查章节中角色对话是否符合已建立的声音档案。
 * 对话应该"遮住名字也能猜出是谁说的"。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { StoryState } from '../schemas/novel-state.schemas';
import { ChapterDraft } from '../schemas/novel.schemas';
import { z } from 'zod';

const voiceAuditSchema = z.object({
  pass: z.boolean(),
  overallConsistency: z.number().min(0).max(10),
  characterAudits: z.array(z.object({
    characterId: z.string(),
    characterName: z.string(),
    voiceConsistency: z.number().min(0).max(10),
    issues: z.array(z.string()),
    goodExamples: z.array(z.string()),
    suggestions: z.array(z.string()),
  })),
  generalNotes: z.array(z.string()),
});

export type VoiceAudit = z.infer<typeof voiceAuditSchema>;

@Injectable()
export class CharacterVoiceCoachAgent {
  constructor(private readonly llm: LlmService) {}

  async audit(state: StoryState, draft: ChapterDraft): Promise<VoiceAudit> {
    const voiceProfiles = state.characters
      .filter((c) => c.voice?.speechPattern)
      .map((c) => ({
        id: c.id,
        name: c.name,
        speechPattern: c.voice!.speechPattern,
        verbalTics: c.voice!.verbalTics ?? [],
        vocabularyLevel: c.voice!.vocabularyLevel ?? 'neutral',
        sampleDialogues: (c.voice!.sampleDialogues ?? []).slice(0, 3),
      }));

    if (voiceProfiles.length === 0) {
      return {
        pass: true,
        overallConsistency: 8,
        characterAudits: [],
        generalNotes: ['尚无声音档案，跳过审查'],
      };
    }

    return this.llm.generateStructured({
      taskName: 'character-voice-coach',
      schema: voiceAuditSchema,
      tags: ['workflow', 'chapter', 'voice'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是一位角色声音教练。核心标准：遮住名字能猜出是谁说的。

评判标准：
1. 说话方式与档案一致性（语气、用词、句式、断句习惯）
2. 口头禅/习惯用语是否自然出现（不是强行塞入，而是在合适的情绪下自然流出）
3. 不同角色之间的辨识度——如果两个角色的对话互换名字也毫无违和感，说明辨识度不合格
4. 词汇水平一致性（粗俗/随意/中性/正式/古风）
5. 情绪状态对声音的影响——同一角色在愤怒vs冷静时说话方式应有变化，但核心特征保留（沉稳的人发怒时是冷硬，不是暴躁）

voiceConsistency 评分：
- 9-10: 声音高度一致+有辨识度，角色个性跃然纸上
- 7-8: 基本一致，偶有小偏差
- 5-6: 部分对话脱离角色声音
- 0-4: 严重脱离，角色说话像同一个人`,
      userPrompt: `角色声音档案：
${JSON.stringify(voiceProfiles, null, 2)}

章节对话内容：
${draft.content}

请对每个在本章中有对白的角色进行声音审查。`,
      temperature: 0.3,
    });
  }
}
