/**
 * 知识记录员 — 本集生成完毕后，提取知识记录（lore record）用于后续集的上下文。
 * 包含：剧情摘要、角色状态变化、秘密更新、闪回候选标注。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  episodeLoreRecordSchema, EpisodeLoreRecord, EpisodeStoryboard, EpisodeScript, DramaState,
} from '../schemas/drama-state.schemas';

const recorderOutputSchema = z.object({ record: episodeLoreRecordSchema });

@Injectable()
export class EpisodeRecorderAgent {
  constructor(private readonly llm: LlmService) {}

  async record(
    state: DramaState, script: EpisodeScript, storyboard: EpisodeStoryboard,
    cliffhangerSummary: string,
  ): Promise<EpisodeLoreRecord> {
    const raw = await this.llm.generateStructured({
      taskName: 'drama-episode-recorder',
      schema: recorderOutputSchema,
      systemPrompt: `你是短剧知识记录员。你的任务是从本集剧本+分镜中提取所有关键信息，用于后续集的上下文传递。

=== 必须记录 ===
1. summary：3-5句话概括本集发生了什么
2. characterStateDeltas：每个出场角色的状态变化
   - emotionalShift：情绪变化（如"从愤怒到震惊"）
   - relationshipChanges：关系变化（如"与陆子轩从仇视变为暂时合作"）
   - newKnowledge：角色获得的新信息（如"发现了林婉清不是亲生女儿"）
   - costumeUsed：本集使用的服饰
3. plotAdvances：本集推进的剧情线（2-5条）
4. newSecrets：本集产生的新秘密（谁知道、对谁隐瞒）
5. flashbackCandidates：适合后续作为闪回引用的高情感密度镜头
   - shotId + reason + emotionalWeight
   - 只标记真正有"后续回忆价值"的镜头（表白、揭真相、重大决定等）
6. cliffhangerResolution：上集悬念在本集如何解决的
7. newCliffhanger：本集留下的新悬念

所有输出简体中文。`,

      userPrompt: `记录第 ${script.episodeNumber} 集知识：

本集剧本场景：
${script.scenes.map(s => `[${s.purpose}] ${s.objective} — 角色:${s.presentCharacterIds.join(',')} 情绪:${s.emotionalEntry}→${s.emotionalExit}`).join('\n')}

本集分镜数：${storyboard.shots.length}
本集总时长：${storyboard.totalEstimatedDurationSec}秒

本集悬念：${cliffhangerSummary}
上集悬念：${state.lastCliffhanger || '无'}

已知秘密：
${state.secretLedger.filter(s => !s.resolved).map(s => `"${s.secret}" 知情:${s.knownBy.join(',')} 隐瞒:${s.hiddenFrom.join(',')}`).join('\n') || '（无）'}

请提取完整的知识记录。`,
      temperature: 0.3,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const record = typeof root.record === 'object' && root.record ? root.record : root;
    return episodeLoreRecordSchema.parse(record);
  }
}
