/** 角色声音教练：审计对话一致性 + 提取声音进化（经典语录、动作指纹、情绪调变）。 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { StoryState, ChapterIntent } from '../../schemas/novel-state.schemas';
import { ChapterDraft } from '../../schemas/novel.schemas';
import { buildAudiencePromptBlock } from '../../prompting/audience-directive';
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

const voiceEvolutionExtractSchema = z.object({
  characterUpdates: z.array(z.object({
    characterId: z.string(),
    characterName: z.string(),
    newCatchphrase: z.string().optional(), // 本章出现的经典语录（如有）
    newSignatureGesture: z.string().optional(), // 本章新出现的招牌动作
    voiceShift: z.string().optional(), // 声音变化描述（如有，因重大事件导致）
    emotionalVoiceObserved: z.object({
      emotion: z.string(),
      voiceShift: z.string(),
      corePreserved: z.string(),
    }).optional(),
  })),
});

export type VoiceAudit = z.infer<typeof voiceAuditSchema>;
export type VoiceEvolutionExtract = z.infer<typeof voiceEvolutionExtractSchema>;

@Injectable()
export class CharacterVoiceCoachAgent {
  private readonly logger = new Logger(CharacterVoiceCoachAgent.name);
  constructor(private readonly llm: LlmService) {}

  async audit(state: StoryState, draft: ChapterDraft): Promise<VoiceAudit> {
    const voiceProfiles = state.characters
      .filter((c) => c.voice?.speechPattern)
      .map((c) => {
        const v = c.voice!;
        const profile: Record<string, unknown> = {
          id: c.id, name: c.name,
          speechPattern: v.speechPattern, verbalTics: v.verbalTics ?? [],
          vocabularyLevel: v.vocabularyLevel ?? 'neutral',
          sampleDialogues: (v.sampleDialogues ?? []).slice(0, 3),
        };
        if (v.emotionalVoiceMap?.length) profile['emotionalVoiceMap'] = v.emotionalVoiceMap;
        if (v.powerDynamicVoice) {
          const pdv = v.powerDynamicVoice;
          if (pdv.toSuperior || pdv.toEqual || pdv.toInferior || pdv.toEnemy) profile['powerDynamicVoice'] = pdv;
        }
        if (v.narrativeActions) {
          const na = v.narrativeActions;
          if (na.signatureGestures?.length || na.physicalTics?.length) profile['narrativeActions'] = na;
        }
        if (v.catchphrases?.length) profile['catchphrases'] = v.catchphrases;
        return profile;
      });

    if (voiceProfiles.length === 0) {
      return { pass: true, overallConsistency: 8, characterAudits: [], generalNotes: ['尚无声音档案，跳过审查'] };
    }

    return this.llm.generateStructured({
      taskName: 'character-voice-coach',
      schema: voiceAuditSchema,
      tags: ['workflow', 'chapter', 'voice'],
      metadata: { userId: state.userId, bookId: state.bookId, chapterNumber: draft.chapterNumber },
      systemPrompt: (() => {
        const isLiterary = state.seed.writingMode === 'literary';
        return `你是一位角色声音教练。核心标准：遮住名字能猜出是谁说的。

评判维度：
1. 说话方式与档案一致性（语气、用词、句式、断句习惯）
2. 口头禅/习惯用语是否自然出现（不是强行塞入，而是在合适的情绪下自然流出）
3. 不同角色之间的辨识度——如果两个角色的对话互换名字也毫无违和感，说明辨识度不合格
4. 词汇水平一致性（粗俗/随意/中性/正式/古风）
5. 情绪状态对声音的影响——同一角色在不同情绪下说话方式应有变化，但核心特征保留
6. 权力关系语态——面对不同身份的人，说话方式应有自然差异
7. 叙事动作一致性——角色的招牌动作、下意识习惯是否体现
${isLiterary ? `
=== 文学探索模式补充 ===
- 允许有意为之的声音实验：意识流、不可靠叙述者、视角融合等技法可能导致声音刻意偏离档案。
- 区分"失控的不一致"（扣分）和"有意的声音创新"（不扣分甚至加分）。
- 内心独白、自由间接引语中的声音变化属于合理的文学表达。` : ''}

voiceConsistency 评分：
- 9-10: 声音高度辨识+情绪调变自然+权力语态准确
- 7-8: 基本一致，情绪调变偶有缺失
- 5-6: 部分对话脱离角色声音
- 0-4: 严重脱离，角色说话像同一个人

${buildAudiencePromptBlock(state)}`;
      })(),
      userPrompt: `角色声音档案：
${JSON.stringify(voiceProfiles, null, 2)}

章节对话内容：
${draft.content}

请对每个在本章中有对白的角色进行声音审查。`,
      temperature: 0.3,
    });
  }

  /** 从已写章节中提取声音进化元素（经典语录、新招牌动作、声音变化）。 */
  async extractVoiceEvolution(state: StoryState, draft: ChapterDraft, intent: ChapterIntent): Promise<VoiceEvolutionExtract> {
    const activeCharIds = intent.characterAvailability?.activeCharacterIds ?? [];
    const activeChars = state.characters.filter((c) => activeCharIds.includes(c.id) && c.voice);
    if (activeChars.length === 0) return { characterUpdates: [] };

    const charBriefs = activeChars.map((c) => ({
      id: c.id, name: c.name,
      currentCatchphrases: c.voice?.catchphrases ?? [],
      currentGestures: c.voice?.narrativeActions?.signatureGestures ?? [],
      emotionalVoiceMapSize: c.voice?.emotionalVoiceMap?.length ?? 0,
    }));

    try {
      return await this.llm.generateStructured({
        taskName: 'voice-evolution-extract',
        schema: voiceEvolutionExtractSchema,
        tags: ['workflow', 'chapter', 'voice-evolution'],
        metadata: { userId: state.userId, bookId: state.bookId, chapterNumber: draft.chapterNumber },
        systemPrompt: `你是声音进化分析师。从刚写完的章节中提取角色声音的"进化素材"：
1. **经典语录**：本章中某角色说的特别精彩/有记忆点的一句话（不是每章都有，宁缺毋滥）
2. **新招牌动作**：本章中首次出现的、能代表角色性格的标志性动作/习惯
3. **声音变化**：因重大事件（背叛/觉醒/失去）导致的角色说话方式永久性变化
4. **情绪调变**：观察到的新的情绪-声音对应关系（如"紧张时会反复确认"）

只提取真正有价值的进化，大多数角色大多数章节不会有变化——空值完全正常。`,
        userPrompt: `本章角色：
${JSON.stringify(charBriefs, null, 2)}

章节内容（第${draft.chapterNumber}章）：
${draft.content}

请提取声音进化素材。只报告真正出现新发现的角色。`,
        temperature: 0.2,
      });
    } catch (e) {
      this.logger.warn(`声音进化提取失败: ${e instanceof Error ? e.message : String(e)}`);
      return { characterUpdates: [] };
    }
  }

  /** 将提取的声音进化应用到 StoryState 中的角色档案。 */
  applyVoiceEvolution(state: StoryState, extract: VoiceEvolutionExtract, chapterNumber: number): StoryState {
    if (extract.characterUpdates.length === 0) return state;
    const characters = state.characters.map((c) => {
      const update = extract.characterUpdates.find((u) => u.characterId === c.id);
      if (!update || !c.voice) return c;

      const voice = { ...c.voice };
      if (update.newCatchphrase) {
        voice.catchphrases = [...(voice.catchphrases ?? []).slice(-4), update.newCatchphrase];
      }
      if (update.newSignatureGesture) {
        const na = { ...(voice.narrativeActions ?? {}) };
        na.signatureGestures = [...(na.signatureGestures ?? []).slice(-4), update.newSignatureGesture];
        voice.narrativeActions = na as typeof voice.narrativeActions;
      }
      if (update.voiceShift) {
        voice.voiceEvolution = [...(voice.voiceEvolution ?? []).slice(-9), { chapterNumber, change: update.voiceShift }];
      }
      if (update.emotionalVoiceObserved) {
        const existing = voice.emotionalVoiceMap ?? [];
        const dup = existing.find((e) => e.emotion === update.emotionalVoiceObserved!.emotion);
        if (!dup) voice.emotionalVoiceMap = [...existing.slice(-5), update.emotionalVoiceObserved];
      }
      return { ...c, voice };
    });
    return { ...state, characters };
  }
}
