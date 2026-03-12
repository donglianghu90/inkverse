/**
 * 音频导演 — 分批处理，每批最多 MAX_SHOTS_PER_BATCH 个 Shot，防止 Token 溢出。
 * 产出：音频增强后的 EpisodeStoryboard（含 audioTimeline）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, EpisodeStoryboard, DramaState, Shot,
} from '../../schemas/drama-state.schemas';
import { buildAudioDirectorSystemPrompt } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

const MAX_SHOTS_PER_BATCH = 10; // 每批最多处理的 Shot 数
const batchOutputSchema = z.object({ shots: z.array(shotSchema), bgmSegments: z.array(z.object({ mood: z.string(), startShotIndex: z.number(), endShotIndex: z.number(), intensityCurve: z.array(z.number()).default([]) })).default([]), silencePoints: z.array(z.object({ afterShotIndex: z.number(), durationSec: z.number(), purpose: z.string() })).default([]) });

@Injectable()
export class AudioDirectorAgent {
  private readonly logger = new Logger(AudioDirectorAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async enhance(state: DramaState, storyboard: EpisodeStoryboard): Promise<EpisodeStoryboard> {
    const shotsArr = storyboard?.shots ?? [];
    if (!shotsArr.length) throw new Error('分镜数据缺失，无法进行音频设计');
    const profile = state.promptProfile;
    const audioGuide = profile?.audioStyleGuide;
    const charVoices = state.characters.map(c =>
      `${c.characterId}(${c.name}): ttsVoiceId=${c.voiceProfile.ttsVoiceId || '待分配'}, pitch=${c.voiceProfile.pitch}, speed=${c.voiceProfile.speed}, timbre=${c.voiceProfile.timbre}`
    ).join('\n');
    const locAmbience = state.locations.map(l => `${l.locationId}: ${l.ambientSoundDefault}`).join('\n');
    const sysPrompt = await this.promptService.buildPrompt(state.dramaId, 'audio-director', buildAudioDirectorSystemPrompt({ audioGuide }));

    const shots = [...shotsArr];
    const allBgm: any[] = [], allSilence: any[] = [];

    for (let off = 0; off < shots.length; off += MAX_SHOTS_PER_BATCH) {
      const batch = shots.slice(off, off + MAX_SHOTS_PER_BATCH);
      if (off > 0) await new Promise(r => setTimeout(r, 500));
      this.logger.log(`E${storyboard.episodeNumber} 音频设计 shot${off}-${off + batch.length - 1}`);

      // 剥离 T2I 字段（firstFramePrompt/lastFramePrompt），音频导演不需要这些字段
      // 发送精简版 shot 给 LLM：仅保留音频决策所需的信息，节省 token 并防止 LLM 错误重写 T2I 内容
      const batchForLlm = batch.map(s => ({
        shotIndex: s.shotIndex,
        shotId: s.shotId,
        sceneId: s.sceneId,
        shotType: s.shotType,
        estimatedDurationSec: s.estimatedDurationSec,
        visualPrompt: s.visualPrompt,
        dialogue: s.dialogue,
        subtitle: s.subtitle,
        characters: s.characters.map(c => ({ characterId: c.characterId, action: c.action, emotion: c.emotion })),
        camera: { angle: s.camera?.angle, movement: s.camera?.movement },
        audio: s.audio,
      }));

      const raw = await this.llm.generateStructured({
        taskName: 'drama-audio-director',
        schema: batchOutputSchema,
        systemPrompt: sysPrompt,
        metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: storyboard.episodeNumber },
        userPrompt: `第 ${storyboard.episodeNumber} 集音频设计（Shot ${off}-${off + batch.length - 1}，共${shots.length}个）：

角色配音：${charVoices}
场景环境音：${locAmbience}

本批Shot：
${JSON.stringify(batchForLlm, null, 0)}

${off > 0 ? `上一批最后Shot的BGM: mood=${shots[off - 1]?.audio?.bgm?.mood ?? 'unknown'} intensity=${shots[off - 1]?.audio?.bgm?.intensity ?? 0.5}` : ''}

要求：返回 shots（含填充的audio）+ bgmSegments + silencePoints`,
        temperature: 0.4,
      });

      const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
      const parsed = Array.isArray(root.shots) ? root.shots : [];
      parsed.forEach((s: any, i: number) => { if (off + i < shots.length) shots[off + i] = shotSchema.parse({ ...shots[off + i], audio: s.audio ?? shots[off + i].audio, dialogue: s.dialogue ?? shots[off + i].dialogue }); });
      if (Array.isArray(root.bgmSegments)) allBgm.push(...root.bgmSegments);
      if (Array.isArray(root.silencePoints)) allSilence.push(...root.silencePoints);
    }

    return episodeStoryboardSchema.parse({
      ...storyboard, shots,
      audioTimeline: { bgmSegments: allBgm, silencePoints: allSilence },
    });
  }
}
