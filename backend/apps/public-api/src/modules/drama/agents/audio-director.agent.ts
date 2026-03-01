/**
 * 音频导演 — 为分镜板填充完整音频层（BGM、SFX、环境音、台词TTS标注）。
 * 输入：EpisodeStoryboard（不含音频）+ 上下文，输出：音频增强后的 EpisodeStoryboard。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeStoryboardSchema, EpisodeStoryboard, DramaState, DramaPromptProfile,
} from '../schemas/drama-state.schemas';

const audioOutputSchema = z.object({ storyboard: episodeStoryboardSchema });

@Injectable()
export class AudioDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  async enhance(state: DramaState, storyboard: EpisodeStoryboard): Promise<EpisodeStoryboard> {
    const profile = state.promptProfile;
    const audioGuide = profile?.audioStyleGuide;
    const charVoices = state.characters.map(c =>
      `${c.characterId}(${c.name}): ttsVoiceId=${c.voiceProfile.ttsVoiceId || '待分配'}, pitch=${c.voiceProfile.pitch}, speed=${c.voiceProfile.speed}, timbre=${c.voiceProfile.timbre}`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-audio-director',
      schema: audioOutputSchema,
      systemPrompt: `你是短剧音频导演。你的任务是为分镜板的每个Shot填充完整的音频设计。

=== 音频设计原则 ===
1. BGM（背景音乐）：
   - mood 标签：tension_building / romantic_sweet / epic_reveal / sad_piano / comedy_light / action_intense / mysterious / triumphant / heartbreak / silence
   - intensity 0-1：日常0.2-0.3，紧张0.5-0.7，高潮0.8-1.0
   - action：continue（延续）/ fade_in（渐入）/ fade_out（渐出）/ cut（突切）/ swell（涌起）/ drop_to_silence（骤停）
   - 关键规则：反转moment前 drop_to_silence → 反转后 swell（制造震撼感）
   - 同一情绪的BGM不连续超过8个Shot

2. SFX（音效）：
   - 每个有明显动作的Shot都应该有对应音效
   - 常见：door_slam / glass_break / slap / phone_ring / car_engine / footsteps / rain / thunder / crowd_gasp
   - timing：on_action（动作同步）/ before_dialogue（台词前）/ after_dialogue（台词后）/ ambient（持续环境）

3. 环境音（ambience）：
   - 每个场景有默认环境音，场景切换时自动更换
   - 常见：office_quiet / rain_heavy / rain_light / crowd_murmur / night_crickets / traffic / restaurant_bg / wind

4. 台词TTS标注（dialogue字段已有，需确认/调整）：
   - emotion：与场景情绪匹配
   - volume：正常normal，打脸moment用loud，密谈用whisper
   - pace：紧张fast，深情slow，日常normal

=== 风格指南 ===
${audioGuide?.bgmMoodPreferences?.length ? `BGM偏好：${audioGuide.bgmMoodPreferences.join('、')}` : ''}
音效密度：${audioGuide?.sfxDensity ?? 'moderate'}
静默策略：${audioGuide?.silenceUsage ?? '关键反转前使用短暂静默'}
配音风格：${audioGuide?.voiceActingStyle ?? '自然偏克制'}

=== audioTimeline 规划 ===
- bgmSegments：相同mood的连续Shot归为一个segment
- silencePoints：在关键反转/震惊moment前插入0.5-2秒静默

所有输出简体中文（mood/sound标签使用英文标识）。`,

      userPrompt: `请为第 ${storyboard.episodeNumber} 集分镜板填充音频设计：

角色配音档案：
${charVoices}

场景默认环境音：
${state.locations.map(l => `${l.locationId}: ${l.ambientSoundDefault}`).join('\n')}

分镜板（需填充音频）：
${JSON.stringify(storyboard, null, 0)}

要求：
1. 为每个Shot填充 audio（bgm + sfx + ambience）
2. 确认/调整每个有对话的Shot的 dialogue 中的 emotion/volume/pace
3. 规划完整的 audioTimeline（bgmSegments + silencePoints）
4. 返回完整的增强后 storyboard`,
      temperature: 0.4,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sb = typeof root.storyboard === 'object' && root.storyboard ? root.storyboard : root;
    return episodeStoryboardSchema.parse(sb);
  }
}
