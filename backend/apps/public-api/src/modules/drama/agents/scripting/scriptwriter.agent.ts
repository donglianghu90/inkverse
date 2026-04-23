/**
 * 编剧 Agent — 短剧核心创作引擎。注入深度上下文：故事全貌、角色关系、秘密、策略、质量反馈。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  episodeScriptSchema, EpisodeScript, DramaState, EpisodeIntent, DramaContinuityCheck, scriptSceneSchema
} from '../../schemas/drama-state.schemas';
import { buildScriptwriterSystemPrompt, buildUserPromptConstraintsTail } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';
import { DramaCalibrationService } from '../../workflow/drama-calibration.service';
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';

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
    // 过滤逻辑：仅保留本集出场角色（activeCharacters 中注册）+ 全剧/段落常驻角色（scope != 'episode'）
    // scope='episode' 的历史临时角色（已退场）不再传入，避免编剧误用已退场角色
    const activeCharIds = new Set(intent.activeCharacters.map(a => a.characterId));
    const relevantChars = state.characters.filter(c => activeCharIds.has(c.characterId) || c.scope !== 'episode');
    const charMap = relevantChars.map(c => {
      const activeInfo = intent.activeCharacters.find(a => a.characterId === c.characterId);
      const soul = c.soulProfile;
      const soulStr = soul
        ? ` | 灵魂层: 欲望=${soul.coreDesire || '-'}, 弱点=${soul.fatalFlaw || '-'}, 恐惧=${soul.coreFear || '-'}, 决策=${soul.decisionStyle || '-'}, 压力反应=${soul.stressResponse || '-'}${soul.emotionalTriggers?.length ? `, 触发器=[${soul.emotionalTriggers.join(',')}]` : ''}${soul.behavioralHabits?.length ? `, 习惯=[${soul.behavioralHabits.join(',')}]` : ''}${soul.internalContradiction ? `, 内在矛盾=${soul.internalContradiction}` : ''}`
        : '';
      return `${c.characterId}(${c.name}): 性格=${c.voiceProfile.speakingStyle}, 口癖="${c.voiceProfile.catchphrase}"${soulStr}${activeInfo ? `, 本集角色=${activeInfo.role}, 情绪弧线=${activeInfo.emotionalJourney || activeInfo.emotionalState}` : '（非本集出场）'}`;
    }).join('\n');

    // 未揭露的秘密（编剧必须知道谁知道什么，才能写出潜台词）
    const activeSecrets = state.secretLedger.filter(s => !s.resolved);
    const secretCtx = activeSecrets.length
      ? activeSecrets.map(s => `🔒 "${s.secret}" — 知情:${s.knownBy.join(',')} 隐瞒:${s.hiddenFrom.join(',')}`).join('\n')
      : '（无活跃秘密）';

    // 质量反馈（从最近3集KPI中提取弱项，防止重复犯错）
    const recentKpi = state.kpiHistory.slice(-3);
    const weakDims = this.calibration.extractWeakDimensionFeedback(recentKpi, 'label');

    // 动态构建 Schema，彻底消除 AI 实体引用的幻觉
    const validCharIds = [...new Set([...intent.activeCharacters.map(a => a.characterId), ...(intent.proposedNewCharacters ?? []).map(p => p.characterId)])] as [string, ...string[]];
    // 允许空字符串（环境音/动作）或 narrator（旁白）
    const characterIdField = validCharIds.length > 0 ? z.enum([...validCharIds, 'narrator', '']) : z.string();

    const dynamicScriptSceneSchema = scriptSceneSchema.extend({
      presentCharacterIds: z.array(characterIdField).nullish().transform(v => v ?? []),
      dialogues: z.array(z.object({
        characterId: characterIdField.nullish().transform(v => v ?? ''),
        text: z.string(),
        parenthetical: z.string().nullish().transform(v => v ?? ''),
      })).nullish().transform(v => v ?? []),
      actions: z.array(z.object({
        description: z.string(),
        characterId: characterIdField.nullish().transform(v => v ?? ''),
      })).nullish().transform(v => v ?? []),
    });

    const dynamicEpisodeScriptSchema = episodeScriptSchema.extend({
      scenes: z.array(dynamicScriptSceneSchema).min(1).max(8),
    });

    const dynamicScriptOutputSchema = z.object({
      _thoughtProcess: z.string().describe('Write your detailed reasoning here before generating the script.'),
      script: dynamicEpisodeScriptSchema
    });

    const raw = await this.llm.generateStructured({
      taskName: DRAMA_AGENT_REGISTRY.SCRIPTWRITER.key,
      schema: dynamicScriptOutputSchema,
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

${intent.emotionBeats?.length ? `=== ⚠️ 情绪节拍覆盖要求（违反即不合格）===
本集预设 ${intent.emotionBeats.length} 个情绪节拍，你的场景必须覆盖所有高强度节拍（intensity≥0.7）：
${intent.emotionBeats.filter(b => b.intensity >= 0.7).map(b => `- ${b.beatId}(${b.emotion}, 强度${b.intensity}): ${b.trigger}`).join('\n')}
每个高强度节拍至少对应 1 个场景中的关键台词/动作/转折。不允许出现"分镜无法覆盖"的空白节拍。
` : ''}
${weakDims ? `=== 质量警告（前几集弱项，本集务必加强） ===\n${weakDims}` : ''}
${this.calibration.buildCalibrationHint(state)}
=== ⚠️ 角色ID铁律（违反直接导致系统阻断）===
dialogues[].characterId 和 actions[].characterId【只能】使用以下已注册 ID：
[${[...new Set([...intent.activeCharacters.map(a => a.characterId), ...(intent.proposedNewCharacters ?? []).map(p => p.characterId)])].join(', ')}]
禁止使用未注册的角色ID。如果场景需要路人/群演发言，改用旁白方式（isVoiceover=true, characterId 留空或使用 narrator）。

=== 创作铁律（违反即不合格） ===
1. 每句台词不超过${(state.promptProfile as any)?.maxDialogueLength ?? 15}个中文字（关键独白除外，最多${((state.promptProfile as any)?.maxDialogueLength ?? 15) + 10}字）
2. 第一场必须是 hook_opening；${state.isSeriesFinale ? '本集是大结局，最后一场必须是 climax/emotional/closure/revelation 之一（禁止 cliffhanger——大结局要给观众完整的情感闭合）' : '最后一场必须是 cliffhanger 或 climax，保持追剧张力'}
3. 知道秘密的角色说话要有"知情者的优越感"，不知道的要有"被蒙在鼓里的天真"
4. 每场戏必须有信息增量（推进剧情/揭露线索/反转/情绪爆发），禁止无意义过场
5. sceneId 格式：ep${epNum}_sc1, ep${epNum}_sc2...
6. 场景信息密度：estimatedDurationSec 超过 50 秒的场景，内部必须包含 ≥2 个转折点（turningPoint 只写最关键的那个，但 dialogues/actions 中必须体现至少 2 次情绪/信息转折）
7. 全集所有场景的 estimatedDurationSec 总和必须达到目标时长（${intent.durationTargetSec}秒）的 80%-110%
8. 每个场景的 objective 中标注本场覆盖的 emotionBeat ID（如"覆盖 eb_3, eb_4"），确保高强度节拍无遗漏
9. 【强化要求】先在 _thoughtProcess 中一步步写下你的思考过程（分析目标、反思弱项、设计人物高光动作和台词），想清楚之后再编写 script 字段。
10. 【道具状态铁律】凡是道具/武器的持握状态发生变化（从「挂于腰间/收纳」→「触碰/持握/拔出/攻击」），必须在 actions[] 中写出独立的过渡动作描述，例如：
    - ✅ 合法：action="缓缓将手移向剑柄" → action="抽出长剑" → action="持剑指向对方"
    - ❌ 非法：上一场景剑还在鞘中，下一场景突然出现「持剑对峙」而无任何中间动作
    道具状态只能在 actions[] 的明确授权下逐步递进，禁止在相邻场景/动作之间无说明地跳变。${buildUserPromptConstraintsTail({ redLines: state.seed?.redLines })}`,
      temperature: 0.65,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const script = typeof root.script === 'object' && root.script ? root.script : root;
    return episodeScriptSchema.parse(script);
  }

  /** 从最近KPI中提取持续低分维度，生成改进指令 */
}
