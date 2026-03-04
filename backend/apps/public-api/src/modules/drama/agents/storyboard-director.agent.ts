/** 分镜导演 — 按场景分步生成Shot + 后处理角色锁脸/风格一致性强制嵌入 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, EpisodeStoryboard, EpisodeScript, DramaState, ScriptScene, CharacterIdentity,
} from '../schemas/drama-state.schemas';
import { buildStoryboardDirectorSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const sceneShotsOutputSchema = z.object({ shots: z.array(shotSchema) });

@Injectable()
export class StoryboardDirectorAgent {
  private readonly logger = new Logger(StoryboardDirectorAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async direct(state: DramaState, script: EpisodeScript): Promise<EpisodeStoryboard> {
    const scenes = script?.scenes ?? [];
    if (!scenes.length) throw new Error('剧本场景为空，无法生成分镜');
    const allShots: z.infer<typeof shotSchema>[] = [];
    let globalIdx = 0;
    for (let si = 0; si < scenes.length; si++) {
      const scene = scenes[si];
      if (si > 0) await new Promise(r => setTimeout(r, 800));
      this.logger.log(`E${script?.episodeNumber ?? 1} 场景 ${si + 1}/${scenes.length}: ${scene?.sceneHeading ?? ''}`);
      const shots = await this.directScene(state, script, scene, globalIdx);
      allShots.push(...shots);
      globalIdx += shots.length;
    }
    // 后处理：强制角色锁脸 + 风格前缀嵌入
    this.enforceFaceLock(allShots, state);
    const totalDur = allShots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
    return episodeStoryboardSchema.parse({
      episodeNumber: script?.episodeNumber ?? 1, shots: allShots,
      totalEstimatedDurationSec: Math.round(totalDur * 10) / 10,
      audioTimeline: { bgmSegments: [], silencePoints: [] },
    });
  }

  private async directScene(state: DramaState, script: EpisodeScript, scene: ScriptScene, startIdx: number) {
    const profile = state.promptProfile;
    const camGuide = profile?.cameraStyleGuide;
    const epNum = script.episodeNumber;
    // 完整角色外貌描述（不再截断到50字符）
    const chars = state.characters.map(c =>
      `${c.characterId}(${c.name}): face="${c.faceReferencePrompt}" body=${c.bodyType} hair=${c.hairStyle} costume=${c.defaultCostume}` +
      (c.variations?.length ? ` variations=[${c.variations.map(v => `${v.variationId}:${v.name}`).join(',')}]` : ''),
    ).join('\n');
    const loc = state.locations.find(l => l.locationId === scene.locationId);
    const locDesc = loc ? `${loc.locationId}(${loc.name}): "${loc.visualPrompt}" lighting=${loc.lightingDefault}` : scene.sceneHeading;
    const targetDur = scene.estimatedDurationSec;
    const maxShots = Math.min(Math.max(Math.ceil(targetDur / 3), 3), 8);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-storyboard-director',
      schema: sceneShotsOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'storyboard-director', buildStoryboardDirectorSystemPrompt({
        camGuide, visualStyle: state.visualStyle, epNum, startIdx, maxShots, targetDur,
      })),
      userPrompt: `场景 ${scene.sceneIndex + 1}:
${JSON.stringify(scene, null, 0)}

角色档案（每个Shot的visualPrompt/firstFramePrompt必须包含出场角色的完整face描述）：
${chars}

场景视觉：
${locDesc}

要求：shots数组，每个Shot必须包含firstFramePrompt和lastFramePrompt，且visualPrompt中必须嵌入角色face描述确保跨Shot人脸一致`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const parsed = Array.isArray(root?.shots) ? root.shots : (Array.isArray(root) ? root : []);
    return parsed.map((s: any, i: number) => {
      const idx = startIdx + i;
      return shotSchema.parse({ ...s, shotIndex: idx, shotId: s.shotId || `ep${epNum}_shot${idx}`, sceneId: scene.sceneId });
    });
  }

  /** 后处理：确保每个Shot的visualPrompt/firstFramePrompt/lastFramePrompt包含角色face描述 */
  private enforceFaceLock(shots: z.infer<typeof shotSchema>[], state: DramaState): void {
    const charMap = new Map(state.characters.map(c => [c.characterId, c]));
    const stylePrefix = state.visualStyle ? `${state.visualStyle}, ` : '';
    shots.forEach(shot => {
      const faceFragments = this.buildFaceFragments(shot.characters.map(c => c.characterId), charMap, shot.characterVariationIds);
      if (!faceFragments) return;
      shot.visualPrompt = this.injectFaceLock(shot.visualPrompt, faceFragments, stylePrefix);
      if (shot.firstFramePrompt) shot.firstFramePrompt = this.injectFaceLock(shot.firstFramePrompt, faceFragments, stylePrefix);
      if (shot.lastFramePrompt) shot.lastFramePrompt = this.injectFaceLock(shot.lastFramePrompt, faceFragments, stylePrefix);
    });
    this.logger.log(`锁脸后处理完成：${shots.length} shots`);
  }

  /** 构建角色face描述片段（支持变体覆盖） */
  private buildFaceFragments(charIds: string[], charMap: Map<string, CharacterIdentity>, variationIds?: Record<string, string>): string {
    return charIds.map(cid => {
      const c = charMap.get(cid);
      if (!c) return '';
      const vid = variationIds?.[cid];
      const variation = vid ? c.variations?.find(v => v.variationId === vid) : null;
      const costume = variation?.costume || c.defaultCostume;
      return `[${c.name}: ${c.faceReferencePrompt}, ${c.hairStyle} hair, ${c.bodyType}, wearing ${costume}]`;
    }).filter(Boolean).join(', ');
  }

  /** 将face描述注入prompt（去重：如果已含角色名关键词则不重复注入） */
  private injectFaceLock(prompt: string, faceFragments: string, stylePrefix: string): string {
    if (!prompt?.trim()) return `${stylePrefix}${faceFragments}`;
    const hasStyle = stylePrefix && prompt.toLowerCase().startsWith(stylePrefix.toLowerCase().slice(0, 10));
    const hasFace = faceFragments.split('[').filter(Boolean).every(f => {
      const name = f.match(/^([^:]+):/)?.[1]?.trim();
      return name && prompt.includes(name);
    });
    if (hasFace && hasStyle) return prompt;
    const parts: string[] = [];
    if (!hasStyle && stylePrefix) parts.push(stylePrefix.trim());
    if (!hasFace) parts.push(faceFragments);
    return parts.length ? `${parts.join(', ')}, ${prompt}` : prompt;
  }
}
