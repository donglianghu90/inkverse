/**
 * 悬念工匠 — 负责集末悬念 + 下集预告Shot的生成。
 * 检查悬念是否与最近几集重复，确保每集结尾都让观众"不得不看下一集"。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { shotSchema, Shot, DramaState, EpisodeStoryboard } from '../schemas/drama-state.schemas';
import { buildHookCrafterSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const hookOutputSchema = z.object({
  cliffhangerSummary: z.string().default(''),
  hookType: z.string().default('cliffhanger'),
  previewShots: z.array(shotSchema).max(3).default([]),
  hookStrengthSelfScore: z.number().min(0).max(10).default(5),
});

export type HookCrafterOutput = z.infer<typeof hookOutputSchema>;

@Injectable()
export class HookCrafterAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async craft(state: DramaState, storyboard: EpisodeStoryboard): Promise<HookCrafterOutput> {
    const shots = storyboard?.shots ?? [];
    const epNum = storyboard?.episodeNumber ?? 1;
    const recentHooks = state.recentHookTypes.slice(-5).map(h => `E${h.episodeNumber}: ${h.hookType}`).join('、');
    const strategy = state.strategy?.hookCadencePolicy;
    const lastShots = shots.slice(-3);

    // 多巴胺状态：帮助悬念工匠判断钩子需要有多强（知识模式下跳过）
    const dopa = state.dopamineSchedule;
    const dopaNote = dopa?.episodesSinceMajor >= 3
      ? `\n⚡ 观众已 ${dopa.episodesSinceMajor} 集未获重大爽感，本集悬念必须是 hookStrengthSelfScore ≥ 8 的高烈度类型。`
      : '';
    // 本集情绪弧线摘要（比只看最后3个shot更完整）
    const epSynopsis = state.seriesOutline?.episodes?.[epNum - 1];
    const emotionalArc = epSynopsis?.emotionalArc ? `\n本集情绪弧线：${epSynopsis.emotionalArc}` : '';

    // 闪回候选：从 flashbackBank 中挑选高情感权重的 iconic/high 镜头供悬念设计参考
    const flashbackCandidates = (state.flashbackBank ?? [])
      .filter(fb => fb.emotionalWeight === 'iconic' || fb.emotionalWeight === 'high')
      .slice(-5);
    const flashbackCtx = flashbackCandidates.length > 0
      ? `\n=== 可用闪回镜头（可在 previewShots 中引用为闪回） ===\n${flashbackCandidates.map(fb => `E${fb.episodeNumber} ${fb.shotId}: ${fb.reason} [${fb.emotionalWeight}]`).join('\n')}`
      : '';

    const raw = await this.llm.generateStructured({
      taskName: 'drama-hook-crafter',
      schema: hookOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'hook-crafter', buildHookCrafterSystemPrompt({ strategy })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: epNum },
      userPrompt: `为第 ${epNum} 集设计悬念钩子：

本集最后3个Shot概要：
${lastShots.map(s => `shot${s.shotIndex}: ${s.camera?.angle} — ${(s.characters ?? []).map((c: any) => `${c.characterId}(${c.emotion})`).join(',')} ${s.dialogue?.text ?? '无台词'}`).join('\n')}
${emotionalArc}
最近悬念记录：${recentHooks || '无（第一集）'}
是否付费集：${state.seriesOutline?.paywallEpisodes?.includes(epNum) ? '是' : '否'}
${state.seriesOutline?.episodes?.[epNum - 1]?.cliffhanger ? `大纲建议悬念：${state.seriesOutline.episodes[epNum - 1].cliffhanger}` : ''}
${flashbackCtx}

下一集概要：${state.seriesOutline?.episodes?.[epNum]?.coreConflict ?? '未知'}
${dopaNote}
${state.isSeriesFinale ? `\n🏁 【大结局模式】这是全剧最后一集！\n- 不需要 cliffhanger，改为"余韵式结尾"——一句回味无穷的台词、一个意味深长的画面、或一段收束感的蒙太奇\n- hookType 设为 "finale_closure" 而非 cliffhanger\n- previewShots 改为"终章余韵镜头"（如角色远去、日落、空间回望等），不超过2个\n- hookStrengthSelfScore 评估标准改为"余韵强度"：观众看完后是否有满足感和回味感` : '请设计本集悬念 + 下集预告Shot（如适用）。'}
previewShots 的 shotId 格式：ep${epNum}_preview_1。`,
      temperature: 0.6,
    });

    return hookOutputSchema.parse(raw);
  }
}
