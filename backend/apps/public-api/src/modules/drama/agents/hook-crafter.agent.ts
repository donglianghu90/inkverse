/**
 * 悬念工匠 — 负责集末悬念 + 下集预告Shot的生成。
 * 检查悬念是否与最近几集重复，确保每集结尾都让观众"不得不看下一集"。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { shotSchema, Shot, DramaState, EpisodeStoryboard } from '../schemas/drama-state.schemas';

const hookOutputSchema = z.object({
  cliffhangerSummary: z.string(), // 本集悬念文字描述
  hookType: z.string(), // 悬念类型标签
  previewShots: z.array(shotSchema).max(3), // 下集预告Shot（0-3个）
  hookStrengthSelfScore: z.number().min(0).max(10), // 自评悬念强度
});

export type HookCrafterOutput = z.infer<typeof hookOutputSchema>;

@Injectable()
export class HookCrafterAgent {
  constructor(private readonly llm: LlmService) {}

  async craft(state: DramaState, storyboard: EpisodeStoryboard): Promise<HookCrafterOutput> {
    const epNum = storyboard.episodeNumber;
    const recentHooks = state.recentHookTypes.slice(-5).map(h => `E${h.episodeNumber}: ${h.hookType}`).join('、');
    const strategy = state.strategy?.hookCadencePolicy;
    const lastShots = storyboard.shots.slice(-3);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-hook-crafter',
      schema: hookOutputSchema,
      systemPrompt: `你是短剧悬念工匠。你的任务是确保每集结尾都有致命的悬念钩子。

=== 悬念类型库 ===
- identity_reveal：身份即将揭露（"她看到了那张照片..."）
- truth_fragment：真相碎片（"原来这一切都是..."）
- relationship_flip：关系反转（"他居然是她的..."）
- danger_looming：危险逼近（"门外的脚步声越来越近"）
- choice_dilemma：两难选择（"签还是不签"）
- betrayal_hint：背叛暗示（"她在背后拨了那个电话"）
- power_shift：力量对比逆转（"从今天起，这家公司归我管"）
- emotional_bomb：情感炸弹（"其实这些年...我一直在等你"）
- new_enemy：新敌出现
- mystery_deepens：谜团加深

=== 悬念规则 ===
1. 最近 ${strategy?.avoidRecentRepeatWindow ?? 3} 集内不重复同类型悬念
2. 付费卡点集的悬念必须是 hookStrengthSelfScore ≥ 8
3. 悬念要用画面传递，不要用旁白解释
4. 下集预告Shot：最多3个，快剪风格（每个1-2秒），isPreview=true

=== 偏好类型 ===
${strategy?.preferredTypes?.join('、') || '无特殊偏好'}
紧迫感倾向：${strategy?.urgencyBias ?? 'aggressive'}`,

      userPrompt: `为第 ${epNum} 集设计悬念钩子：

本集最后3个Shot概要：
${lastShots.map(s => `shot${s.shotIndex}: ${s.camera.angle} — ${s.characters.map(c => `${c.characterId}(${c.emotion})`).join(',')} ${s.dialogue?.text ?? '无台词'}`).join('\n')}

最近悬念记录：${recentHooks || '无（第一集）'}
是否付费集：${state.seriesOutline?.paywallEpisodes?.includes(epNum) ? '是' : '否'}
${state.seriesOutline?.episodes?.[epNum - 1]?.cliffhanger ? `大纲建议悬念：${state.seriesOutline.episodes[epNum - 1].cliffhanger}` : ''}

下一集概要：${state.seriesOutline?.episodes?.[epNum]?.coreConflict ?? '未知'}

请设计本集悬念 + 下集预告Shot（如适用）。previewShots 的 shotId 格式：ep${epNum}_preview_1。`,
      temperature: 0.6,
    });

    return hookOutputSchema.parse(raw);
  }
}
