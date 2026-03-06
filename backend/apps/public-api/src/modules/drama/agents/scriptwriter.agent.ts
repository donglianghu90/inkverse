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

const scriptOutputSchema = z.object({ script: episodeScriptSchema });

@Injectable()
export class ScriptwriterAgent {
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

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
    const weakDims = this.extractWeakDimensions(recentKpi);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-scriptwriter',
      schema: scriptOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'scriptwriter', buildScriptwriterSystemPrompt({ guide, visualStyle: state.visualStyle, contentMode: state.contentMode })),
      userPrompt: `第 ${epNum} 集剧本创作：

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
${this.buildCalibrationHint(state)}
=== 创作铁律（违反即不合格） ===
1. 每句台词不超过15个中文字（关键独白除外）
2. ${state.contentMode === 'knowledge' ? '场景purpose类型灵活选择（exposition/narrative/montage/emotional/revelation/climax/transition），结尾场景建议设置知识悬念衔接下集' : '第一场必须是 hook_opening，最后一场必须是 cliffhanger'}
3. 知道秘密的角色说话要有"知情者的优越感"，不知道的要有"被蒙在鼓里的天真"
4. 每场戏必须有信息增量（推进剧情/揭露线索/反转/情绪爆发），禁止无意义过场
5. sceneId 格式：ep${epNum}_sc1, ep${epNum}_sc2...`,
      temperature: 0.65,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const script = typeof root.script === 'object' && root.script ? root.script : root;
    return episodeScriptSchema.parse(script);
  }

  private buildCalibrationHint(state: DramaState): string {
    const patterns = (state.recentIssuePatterns ?? []).filter(p => p.status === 'active' && p.occurrences >= 2);
    if (!patterns.length) return '';
    const sorted = [...patterns].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5);
    const lines = ['=== 自校准警示（近期高频问题）==='];
    for (const p of sorted) lines.push(`⚠ [${p.dimension}] ${p.pattern.split(':').slice(1).join(':')}（已出现${p.occurrences}次）`);
    return lines.join('\n');
  }

  /** 从最近KPI中提取持续低分维度，生成改进指令 */
  private extractWeakDimensions(kpiHistory: Array<{ episodeNumber?: number; overallScore?: number; dimensions?: Record<string, number> }>): string {
    if (!kpiHistory.length) return '';
    const dimSums: Record<string, { total: number; count: number }> = {};
    kpiHistory.forEach(k => Object.entries(k.dimensions ?? {}).forEach(([dim, score]) => {
      if (!dimSums[dim]) dimSums[dim] = { total: 0, count: 0 };
      dimSums[dim].total += score; dimSums[dim].count++;
    }));
    const weakOnes = Object.entries(dimSums)
      .map(([dim, { total, count }]) => ({ dim, avg: total / count }))
      .filter(d => d.avg < 7)
      .sort((a, b) => a.avg - b.avg);
    if (!weakOnes.length) return '';
    const dimNameMap: Record<string, string> = { visualImpact: '画面冲击力', dialogueNaturalness: '台词自然度', pacing: '节奏紧凑度', hookStrength: '悬念强度', consistency: '连续性', emotionalImpact: '情感冲击力' };
    return weakOnes.map(w => `⚠ ${dimNameMap[w.dim] || w.dim} 平均${w.avg.toFixed(1)}分 — 本集请重点加强`).join('\n');
  }
}
