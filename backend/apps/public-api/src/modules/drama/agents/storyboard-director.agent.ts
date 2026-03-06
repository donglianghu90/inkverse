/** 分镜导演 — 按场景分步生成Shot + 后处理角色锁脸/风格一致性强制嵌入 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, EpisodeStoryboard, EpisodeScript, EpisodeIntent,
  DramaState, ScriptScene, CharacterIdentity,
} from '../schemas/drama-state.schemas';
import { buildStoryboardDirectorSystemPrompt } from '../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../prompting/drama-prompt-template.service';

const sceneShotsOutputSchema = z.object({ shots: z.array(shotSchema) });

// 黄金场景类型：需要更密集的镜头和专属摄影语言
const GOLDEN_PURPOSES = new Set(['climax', 'confrontation', 'revelation', 'cliffhanger']);
// 过场类型：精简镜头
const FILLER_PURPOSES = new Set(['transition']);

@Injectable()
export class StoryboardDirectorAgent {
  private readonly logger = new Logger(StoryboardDirectorAgent.name);
  constructor(private readonly llm: LlmService, private readonly promptService: DramaPromptTemplateService) {}

  async direct(state: DramaState, script: EpisodeScript, intent?: EpisodeIntent): Promise<EpisodeStoryboard> {
    const scenes = script?.scenes ?? [];
    if (!scenes.length) throw new Error('剧本场景为空，无法生成分镜');
    const allShots: z.infer<typeof shotSchema>[] = [];
    let globalIdx = 0;
    for (let si = 0; si < scenes.length; si++) {
      const scene = scenes[si];
      const isLastScene = si === scenes.length - 1;
      if (si > 0) await new Promise(r => setTimeout(r, 800));
      this.logger.log(`E${script?.episodeNumber ?? 1} 场景 ${si + 1}/${scenes.length} [${scene?.purpose ?? ''}]: ${scene?.sceneHeading ?? ''}`);
      const shots = await this.directScene(state, script, scene, globalIdx, isLastScene, intent);
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

  private async directScene(
    state: DramaState, script: EpisodeScript, scene: ScriptScene,
    startIdx: number, isLastScene: boolean, intent?: EpisodeIntent,
  ) {
    const profile = state.promptProfile;
    const camGuide = profile?.cameraStyleGuide;
    const epNum = script.episodeNumber;
    const scenePurpose = scene.purpose;

    // 完整角色外貌描述（不再截断到50字符）
    const chars = state.characters.map(c =>
      `${c.characterId}(${c.name}): face="${c.faceReferencePrompt}" body=${c.bodyType} hair=${c.hairStyle} costume=${c.defaultCostume}` +
      (c.variations?.length ? ` variations=[${c.variations.map(v => `${v.variationId}:${v.name}`).join(',')}]` : ''),
    ).join('\n');
    const loc = state.locations.find(l => l.locationId === scene.locationId);
    const locDesc = loc ? `${loc.locationId}(${loc.name}): "${loc.visualPrompt}" lighting=${loc.lightingDefault}` : scene.sceneHeading;

    // 黄金场景：提高镜头密度；过场：减少镜头数量
    // 知识模式下 exposition/narrative 也算标准场景（非filler）
    const effectiveGolden = state.contentMode === 'knowledge'
      ? new Set([...GOLDEN_PURPOSES, 'exposition', 'narrative'])
      : GOLDEN_PURPOSES;
    const targetDur = scene.estimatedDurationSec;
    const isGolden = effectiveGolden.has(scenePurpose);
    const isFiller = FILLER_PURPOSES.has(scenePurpose);
    const shotDensitySec = isGolden ? 2.5 : isFiller ? 5 : 3.5;
    const maxShots = isGolden
      ? Math.min(Math.max(Math.ceil(targetDur / shotDensitySec), 4), 10)
      : isFiller
        ? Math.min(Math.ceil(targetDur / shotDensitySec), 3)
        : Math.min(Math.max(Math.ceil(targetDur / shotDensitySec), 3), 7);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-storyboard-director',
      schema: sceneShotsOutputSchema,
      systemPrompt: await this.promptService.buildPrompt(state.dramaId, 'storyboard-director', buildStoryboardDirectorSystemPrompt({
        camGuide,
        visualStyle: state.visualStyle,
        epNum, startIdx, maxShots, targetDur,
        scenePurpose,
        isLastScene,
        intentEmotionDirection: intent?.emotionDirection,
        hookDirection: isLastScene ? intent?.hookDirection : undefined,
      })),
      userPrompt: `场景 ${scene.sceneIndex + 1}【${scenePurpose}${isGolden ? ' ⭐黄金场景' : ''}${isLastScene ? ' 🎬全集结尾' : ''}】:
${JSON.stringify(scene, null, 0)}

角色档案（firstFramePrompt/lastFramePrompt中必须包含出场角色的完整face描述，visualPrompt中禁止包含face描述）：
${chars}

场景视觉：
${locDesc}

要求：shots数组，每个Shot必须包含firstFramePrompt、lastFramePrompt 和 qualityTier。visualPrompt专注描述运动/动作（禁止face描述），firstFramePrompt/lastFramePrompt专注描述静态画面（必须含face描述）`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const parsed = Array.isArray(root?.shots) ? root.shots : (Array.isArray(root) ? root : []);

    // 对过场场景的 qualityTier 做后处理保底（防止LLM忘记设置）
    const defaultTier = isGolden ? 'golden' : isFiller ? 'filler' : 'standard';
    return parsed.map((s: any, i: number) => {
      const idx = startIdx + i;
      return shotSchema.parse({
        ...s,
        qualityTier: s.qualityTier ?? defaultTier,
        shotIndex: idx,
        shotId: s.shotId || `ep${epNum}_shot${idx}`,
        sceneId: scene.sceneId,
      });
    });
  }

  /** 后处理：确保首尾帧T2I prompt包含角色face描述（visualPrompt用于T2V，不注入face以节省token） */
  private enforceFaceLock(shots: z.infer<typeof shotSchema>[], state: DramaState): void {
    const charMap = new Map(state.characters.map(c => [c.characterId, c]));
    const vs = state.visualStyle;
    const stylePrefix = vs?.overallAesthetic
      ? [vs.overallAesthetic, vs.renderTechnique, vs.textureStyle, vs.colorGrading].filter(Boolean).join(', ') + ', '
      : '';
    shots.forEach(shot => {
      const faceFragments = this.buildFaceFragments(shot.characters.map(c => c.characterId), charMap, shot.characterVariationIds);
      if (!faceFragments) return;
      if (shot.firstFramePrompt) shot.firstFramePrompt = this.injectFaceLock(shot.firstFramePrompt, faceFragments, stylePrefix);
      if (shot.lastFramePrompt) shot.lastFramePrompt = this.injectFaceLock(shot.lastFramePrompt, faceFragments, stylePrefix);
    });
    this.logger.log(`锁脸后处理完成：${shots.length} shots（仅首尾帧T2I prompt）`);
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
