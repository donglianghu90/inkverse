/**
 * 台词教练 — 分场景润色台词，注入角色关系+秘密上下文，驱动潜台词和情感张力。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  scriptSceneSchema, episodeScriptSchema, EpisodeScript, CharacterIdentity, DramaPromptProfile, ScriptScene, DramaState,
} from '../../schemas/drama-state.schemas';
import { buildDialogueCoachSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

const sceneCoachOutputSchema = z.object({ scene: scriptSceneSchema });

@Injectable()
export class DialogueCoachAgent {
  private readonly logger = new Logger(DialogueCoachAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async polish(
    script: EpisodeScript, characters: CharacterIdentity[], profile?: DramaPromptProfile, dramaId?: string, state?: DramaState,
  ): Promise<EpisodeScript> {
    // 全量角色 Map，用于按场景按需过滤（避免每次调用 LLM 传入所有角色，减少噪音和 Token 消耗）
    const charVoiceMap = new Map(characters.map(c => {
      const soul = c.soulProfile;
      const soulHint = soul
        ? ` | 欲望=${soul.coreDesire || '-'}, 弱点=${soul.fatalFlaw || '-'}, 压力反应=${soul.stressResponse || '-'}${soul.emotionalTriggers?.length ? `, 雷区=[${soul.emotionalTriggers.join(',')}]` : ''}`
        : '';
      return [c.characterId, `${c.characterId}(${c.name}): 音色=${c.voiceProfile.timbre}, 风格=${c.voiceProfile.speakingStyle}, 口癖="${c.voiceProfile.catchphrase}", 语速=${c.voiceProfile.speed}${soulHint}`];
    }));
    const coachCtx = {
      dialogueGuide: profile?.scriptwriterGuide?.dialogueGuide,
      adaptationNotes: profile?.genreArchetype?.adaptationNotes,
    };
    const sysPrompt = dramaId
      ? await this.promptService.buildPrompt(dramaId, 'dialogue-coach', buildDialogueCoachSystemPrompt(coachCtx))
      : buildDialogueCoachSystemPrompt(coachCtx);

    const activeSecrets = (state?.secretLedger ?? []).filter(s => !s.resolved).map(s => ({
      id: s.id ?? '', secret: s.secret ?? '', knownBy: s.knownBy ?? [], hiddenFrom: s.hiddenFrom ?? [], resolved: !!s.resolved,
    }));

    const polished: ScriptScene[] = [];
    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      if (!scene.dialogues?.length) { polished.push(scene); continue; }
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      this.logger.log(`E${script.episodeNumber} 台词润色 场景${i + 1}/${script.scenes.length}`);

      // 提取本场出场角色ID
      const sceneCharIds = new Set((scene.dialogues ?? []).map(d => d.characterId).filter(Boolean));
      const secretCtx = this.buildSceneSecretContext(sceneCharIds, activeSecrets);
      // 只传本场出场角色的配音档案，过滤无关角色减少 Token 消耗和 LLM 混淆
      const sceneCharVoices = [...sceneCharIds].map(id => charVoiceMap.get(id ?? '')).filter(Boolean).join('\n') || '（无配音档案）';

      try {
        const raw = await this.llm.generateStructured({
          taskName: 'drama-dialogue-coach',
          schema: sceneCoachOutputSchema,
          systemPrompt: sysPrompt,
          metadata: { dramaId, userId: state?.userId, episodeNumber: script.episodeNumber },
          userPrompt: `润色第 ${script.episodeNumber} 集场景 ${i + 1}（${scene.purpose}）的台词：

角色配音档案（仅本场出场角色）：
${sceneCharVoices}

${secretCtx ? `=== 秘密上下文（决定潜台词方向） ===\n${secretCtx}\n` : ''}当前场景：
${JSON.stringify(scene, null, 0)}

=== 润色要求 ===
1. 保持结构不变，只优化 dialogues 中的 text 和 parenthetical
2. 每句台词不超过15个中文字（关键独白例外，但也不超过25字）
3. 知情者说话要有"话中有话"的暗示，不知情者要自然天真
4. parenthetical 必须包含语气动作指示（如：冷笑、故作轻松、攥紧拳头）
5. 短剧节奏：禁止寒暄废话，每句话都要推进剧情或加深情感张力`,
          temperature: 0.5,
        });
        const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
        const s = typeof root.scene === 'object' && root.scene ? root.scene : root;
        polished.push(scriptSceneSchema.parse({ ...scene, dialogues: (s as any).dialogues ?? scene.dialogues, actions: (s as any).actions ?? scene.actions }));
      } catch (err) {
        this.logger.warn(`E${script.episodeNumber} 场景${i + 1}润色降级: ${(err as Error).message}`);
        polished.push(scene);
      }
    }
    return episodeScriptSchema.parse({ ...script, scenes: polished });
  }

  /** 构建场景维度的秘密上下文：只输出与本场角色相关的秘密 */
  private buildSceneSecretContext(
    sceneCharIds: Set<string>,
    secrets: Array<{ id: string; secret: string; knownBy: string[]; hiddenFrom: string[]; resolved: boolean }>,
  ): string {
    if (!secrets.length || !sceneCharIds.size) return '';
    const relevant = secrets.filter(s =>
      s.knownBy.some(id => sceneCharIds.has(id)) || s.hiddenFrom.some(id => sceneCharIds.has(id)),
    );
    if (!relevant.length) return '';
    return relevant.map(s => {
      const present = (ids: string[]) => ids.filter(id => sceneCharIds.has(id));
      const knowers = present(s.knownBy);
      const hidden = present(s.hiddenFrom);
      return `🔒 "${s.secret}" — 在场知情者:${knowers.join(',') || '无'} 在场不知情者:${hidden.join(',') || '无'}`;
    }).join('\n');
  }
}
