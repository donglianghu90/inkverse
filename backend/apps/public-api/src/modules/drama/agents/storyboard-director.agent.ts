/**
 * 分镜导演 — 将剧本（EpisodeScript）转化为逐镜头分镜（EpisodeStoryboard）。
 * 每个 Shot 包含镜头、角色动作、视觉提示词（T2V）、字幕，但不含音频（交给 AudioDirector）。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeStoryboardSchema, EpisodeStoryboard, EpisodeScript, DramaState, DramaPromptProfile,
} from '../schemas/drama-state.schemas';

const storyboardOutputSchema = z.object({ storyboard: episodeStoryboardSchema });

@Injectable()
export class StoryboardDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  async direct(state: DramaState, script: EpisodeScript): Promise<EpisodeStoryboard> {
    const profile = state.promptProfile;
    const camGuide = profile?.cameraStyleGuide;
    const chars = state.characters.map(c =>
      `${c.characterId}(${c.name}): face="${c.faceReferencePrompt.slice(0, 60)}..." body=${c.bodyType} hair=${c.hairStyle}`
    ).join('\n');
    const locs = state.locations.map(l =>
      `${l.locationId}(${l.name}): visualPrompt="${l.visualPrompt.slice(0, 60)}..." lighting=${l.lightingDefault}`
    ).join('\n');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-storyboard-director',
      schema: storyboardOutputSchema,
      systemPrompt: `你是短剧分镜导演。你的任务是将剧本转化为逐镜头分镜（Shot 列表）。

=== 分镜原则 ===
1. 每个 Shot = 一个连续画面（2-8秒），一个镜头角度+一段动作/台词
2. 对话场景通常：说话者close_up → 听者反应close_up → 双人medium（不要千篇一律）
3. 关键反转moment = slow_push_in + shallow景深 + 角色表情特写
4. 每集总Shot数通常 15-40 个，按时长密度调整
5. 打脸/爽点/高潮 = 最密集的镜头切换（1-2秒/Shot）
6. 安静/情感 = 较长的镜头停留（4-8秒/Shot）

=== visualPrompt 规则（英文） ===
- 必须包含：角色面部参考、服饰、表情、动作、场景、光影、构图
- 格式："{style}, {character description}, {action}, {scene}, {lighting}, {camera angle}"
- 风格前缀统一（如 "cinematic film still, " 或 "korean drama still, "）

=== 镜头语言 ===
${camGuide?.preferredAngles?.length ? `偏好角度：${camGuide.preferredAngles.join('、')}` : ''}
${camGuide?.signatureTechniques?.length ? `标志手法：${camGuide.signatureTechniques.join('、')}` : ''}
${camGuide?.transitionStyle ? `转场偏好：${camGuide.transitionStyle}` : ''}

=== 视觉风格 ===
${state.visualStyle ? `整体美学：${state.visualStyle.overallAesthetic} | 调色：${state.visualStyle.colorGrading} | 光影：${state.visualStyle.lightingStyle}` : ''}

=== 注意事项 ===
- shotId 格式：ep{N}_shot{M}（如 ep1_shot1）
- 字幕（subtitle）只在有对话或旁白时添加
- transitionToNext：场景切换用 cut 或 fade_black，情感转折用 dissolve
- isFlashback/isPreview 仅在需要时标 true
- 暂不填写 audio 字段（交给 AudioDirector）

所有中文内容使用简体中文，visualPrompt 使用英文。`,

      userPrompt: `请为第 ${script.episodeNumber} 集剧本生成分镜：

剧本内容：
${JSON.stringify(script, null, 0)}

角色视觉档案：
${chars}

场景视觉档案：
${locs}

要求：
1. 返回完整的 storyboard 对象，含 shots 数组和 totalEstimatedDurationSec
2. audioTimeline 中 bgmSegments 留空（后续由AudioDirector填充），silencePoints 按需标注
3. 确保所有 shot 的 estimatedDurationSec 之和约等于目标时长`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const sb = typeof root.storyboard === 'object' && root.storyboard ? root.storyboard : root;
    return episodeStoryboardSchema.parse(sb);
  }
}
