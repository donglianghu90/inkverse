/**
 * 编剧 Agent — 短剧核心创作引擎。注入深度上下文：故事全貌、角色关系、秘密、策略、质量反馈。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeScriptSchema, EpisodeScript, DramaState, EpisodeIntent, DramaContinuityCheck,
} from '../schemas/drama-state.schemas';
import { buildScriptwriterSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';
import { DramaCalibrationService } from '../drama-calibration.service';

const scriptOutputSchema = z.object({ script: episodeScriptSchema });

@Injectable()
export class ScriptwriterAgent {
  constructor(
    private readonly llm: LlmService,
    private readonly promptService: DramaPromptTemplateService,
    private readonly calibration: DramaCalibrationService,
  ) {}

  async write(
    state: DramaState, intent: EpisodeIntent, continuity: DramaContinuityCheck,
  ): Promise<EpisodeScript> {
    const profile = state.promptProfile;
    const guide = profile?.scriptwriterGuide;
    const epNum = intent.episodeNumber;

    // 角色说话风格 + 角色间关系
    const charMap = state.characters.map(c => {
      const activeInfo = intent.activeCharacters.find(a => a.characterId === c.characterId);
      return `${c.characterId}(${c.name}): 性格=${c.voiceProfile.speakingStyle}, 口癖="${c.voiceProfile.catchphrase}"${activeInfo ? `, 本集角色=${activeInfo.role}, 情绪=${activeInfo.emotionalState}` : ''}`;
    }).join('\n');

    // 未揭露的秘密（编剧必须知道谁知道什么，才能写出潜台词）
    const activeSecrets = state.secretLedger.filter(s => !s.resolved);
    const secretCtx = activeSecrets.length
      ? activeSecrets.map(s => `🔒 "${s.secret}" — 知情:${s.knownBy.join(',')} 隐瞒:${s.hiddenFrom.join(',')}`).join('\n')
      : '（无活跃秘密）';

    // 质量反馈（从最近3集KPI中提取弱项，防止重复犯错）
    const recentKpi = state.kpiHistory.slice(-3);
    const weakDims = this.calibration.extractWeakDimensionFeedback(recentKpi, 'label');

    const raw = await this.llm.generateStructured({
      taskName: 'drama-scriptwriter',
      schema: scriptOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'scriptwriter', buildScriptwriterSystemPrompt({ guide, visualStyle: state.visualStyle, genreArchetype: state.promptProfile?.genreArchetype })),
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: epNum },
      userPrompt: `第 ${epNum} 集剧本创作：
${epNum === 1 ? `
=== 🔥 第1集冷开场铁律 ===
这是整部剧的第一集，观众零认知、零情感投入。必须遵守：
1. 前3秒必须有视觉冲击或情绪钩子（动作场面/极端情绪/悬念画面/反转），禁止平铺叙述
2. 不做冗长的世界观/人物介绍，通过行动和冲突自然展现角色性格
3. 前30秒必须建立核心矛盾或悬念，让观众产生"接下来怎样？"的欲望
4. 角色首次出场必须有"记忆锚点"（标志性台词/动作/外貌特征），便于后续辨认
5. 结尾悬念强度要求最高级——这是决定观众是否看第2集的关键
` : ''}
=== 集级意图 ===
目标：${intent.goals.join('；')}
情绪方向：${intent.emotionDirection}
钩子方向：${intent.hookDirection}
上集衔接：${intent.carryoverFromLastEpisode}
是否付费集：${intent.isPaywallEpisode ? '是（必须在最关键时刻结束，让观众不得不付费）' : '否'}
目标时长：${intent.durationTargetSec} 秒

=== 故事全貌 ===
${state.storySoFar ? state.storySoFar.slice(0, 800) : '（第一集，无前情）'}
上集悬念：${state.lastCliffhanger || '无'}
${state.currentArcSegment ? `当前段落：${state.currentArcSegment.segmentTitle}（矛盾：${state.currentArcSegment.coreConflict}，情感主题：${state.currentArcSegment.emotionalTheme}）` : ''}
${state.strategy?.coreNarrativeContract ? `叙事契约：${state.strategy.coreNarrativeContract}` : ''}

=== 出场角色 + 说话风格 ===
${charMap}

=== 秘密地图（编剧必读：决定谁能说什么、谁在演戏） ===
${secretCtx}

=== 连续性约束 ===
${continuity.contextInjections.join('\n') || '（无特殊注意事项）'}
${continuity.warnings.length > 0 ? `⚠️ 连续性警告：${continuity.warnings.map(w => w.description).join('；')}` : ''}

=== 场景 ===
${intent.locationIds.map(id => {
  const loc = state.locations.find(l => l.locationId === id);
  return loc ? `${id}(${loc.name}): ${loc.description.slice(0, 80)}` : id;
}).join('\n')}

${weakDims ? `=== 质量警告（前几集弱项，本集务必加强） ===\n${weakDims}` : ''}
${this.calibration.buildCalibrationHint(state)}
=== 创作铁律（违反即不合格） ===
1. 每句台词不超过15个中文字（关键独白除外）
2. 第一场必须是 hook_opening，最后一场必须是 cliffhanger
3. 知道秘密的角色说话要有"知情者的优越感"，不知道的要有"被蒙在鼓里的天真"
4. 每场戏必须有信息增量（推进剧情/揭露线索/反转/情绪爆发），禁止无意义过场
5. sceneId 格式：ep${epNum}_sc1, ep${epNum}_sc2...`,
      temperature: 0.65,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const script = typeof root.script === 'object' && root.script ? root.script : root;
    return episodeScriptSchema.parse(script);
  }

  /** 从最近KPI中提取持续低分维度，生成改进指令 */
}
