/** 分镜导演 — 按场景分步生成Shot + 后处理角色锁脸/风格一致性强制嵌入 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, EpisodeStoryboard, EpisodeScript, EpisodeIntent,
  DramaState, ScriptScene, CharacterIdentity,
} from '../../schemas/drama-state.schemas';
import { buildStoryboardDirectorStaticPrompt, buildStoryboardSceneContext } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';

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
    let prevSceneLastShots: z.infer<typeof shotSchema>[] = [];
    for (let si = 0; si < scenes.length; si++) {
      const scene = scenes[si];
      const isLastScene = si === scenes.length - 1;
      if (si > 0) await new Promise(r => setTimeout(r, 800));
      this.logger.log(`E${script?.episodeNumber ?? 1} 场景 ${si + 1}/${scenes.length} [${scene?.purpose ?? ''}]: ${scene?.sceneHeading ?? ''}`);
      const shots = await this.directScene(state, script, scene, globalIdx, isLastScene, intent, prevSceneLastShots);
      allShots.push(...shots);
      globalIdx += shots.length;
      // 保留最后 2 个 shot 作为下一场景的视觉衔接锚点
      prevSceneLastShots = shots.slice(-2);
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
    prevSceneLastShots: z.infer<typeof shotSchema>[] = [],
  ) {
    const profile = state.promptProfile;
    const camGuide = profile?.cameraStyleGuide;
    const epNum = script.episodeNumber;
    const scenePurpose = scene.purpose;

    const chars = state.characters.map(c => {
      const face = c.faceReferencePrompt || '';
      const body = c.bodyTypePrompt || c.bodyType || '';
      const hair = c.hairStylePrompt || c.hairStyle || '';
      const costume = c.defaultCostumePrompt || c.defaultCostume || '';
      const parts = [`face="${face}"`, body && `body="${body}"`, hair && `hair="${hair}"`, costume && `costume="${costume}"`].filter(Boolean);
      return `${c.characterId}(${c.name}): ${parts.join(' ')}` +
        (c.variations?.length ? ` variations=[${c.variations.map(v => `${v.variationId}:${v.name}(${v.costume})`).join(',')}]` : '');
    }).join('\n');

    // 闪回候选：提供给分镜导演，支持标记 isFlashback + flashbackSourceShotId
    const flashbackCandidates = (state.flashbackBank ?? []).slice(-8);
    const flashbackCtx = flashbackCandidates.length > 0
      ? `\n可用闪回素材（如果场景需要回忆/闪回，设置 isFlashback=true 和 flashbackSourceShotId）：\n${flashbackCandidates.map(fb => `E${fb.episodeNumber} ${fb.shotId}: ${fb.reason} [${fb.emotionalWeight}]${fb.visualPromptSnapshot ? ` visual="${fb.visualPromptSnapshot.slice(0, 60)}"` : ''}`).join('\n')}`
      : '';

    const loc = state.locations.find(l => l.locationId === scene.locationId);
    const locDesc = loc ? `${loc.locationId}(${loc.name}): "${loc.visualPrompt}" lighting=${loc.lightingDefault}` : scene.sceneHeading;

    const effectiveGolden = GOLDEN_PURPOSES;
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
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: epNum },
      systemPrompt: await this.promptService.buildPrompt(
        state.dramaId,
        'storyboard-director',
        buildStoryboardDirectorStaticPrompt({ camGuide, visualStyle: state.visualStyle }),
        buildStoryboardSceneContext({
          camGuide,
          maxShots, targetDur,
          scenePurpose,
          isLastScene,
          intentEmotionDirection: intent?.emotionDirection,
          hookDirection: isLastScene ? intent?.hookDirection : undefined,
          emotionBeats: intent?.emotionBeats,
        }),
      ),
      userPrompt: `场景 ${scene.sceneIndex + 1}【${scenePurpose}${isGolden ? ' ⭐黄金场景' : ''}${isLastScene ? ' 🎬全集结尾' : ''}】:
${JSON.stringify(scene, null, 0)}
${epNum === 1 && scene.sceneIndex === 0 ? `
🔥 第1集开场分镜铁律：
- 第1个Shot必须是视觉冲击力最强的画面（特写/低角度/动态构图），qualityTier=golden
- 前3个Shot必须建立核心视觉张力，禁止平庸构图
- 角色首次亮相的Shot要突出"记忆锚点"（标志性外貌+环境对比）
` : ''}
${prevSceneLastShots.length > 0 ? `
🎬 上一场景结尾（视觉衔接参考，确保本场景第一个Shot在角色位置/情绪/构图上与此自然衔接）：
${prevSceneLastShots.map(s => `- shot${s.shotIndex} [${s.camera?.shotSize ?? ''}+${s.camera?.cameraAngle ?? ''}/${s.camera?.movement ?? ''}] chars=[${s.characters.map(c => c.characterId).join(',')}] emotion=${s.characters[0]?.emotion ?? ''} | lastFrame: "${(s.lastFramePrompt ?? '').slice(0, 80)}"`).join('\n')}
` : ''}
⚠️ 合法角色ID白名单（characters数组只能使用这些ID，其他一律视为违规）：
[${state.characters.map(c => `${c.characterId}(${c.name})`).join(', ')}]
路人/守军/群演等非注册角色只能在 visualPrompt 文字描述中出现，禁止写入 characters 数组。

角色档案（firstFramePrompt/lastFramePrompt中必须包含出场角色的完整face描述，visualPrompt中禁止包含face描述）：
${chars}

场景视觉：
${locDesc}

要求：shots数组，每个Shot必须包含firstFramePrompt、lastFramePrompt 和 qualityTier。visualPrompt专注描述运动/动作（禁止face描述），firstFramePrompt/lastFramePrompt专注描述静态画面（必须含face描述）
${flashbackCtx}`,
      temperature: 0.5,
    });

    const root = typeof raw === 'object' && raw ? raw as Record<string, unknown> : {};
    const parsed = Array.isArray(root?.shots) ? root.shots : (Array.isArray(root) ? root : []);

    // 对过场场景的 qualityTier 做后处理保底（防止LLM忘记设置）
    const defaultTier = isGolden ? 'golden' : isFiller ? 'filler' : 'standard';
    const styleLockRef = this.resolveStyleLockRef(state);
    const identityRefMap = this.buildIdentityRefMap(state);
    const masterBeatAssignments = this.resolveMasterBeatAssignments(script, scene, parsed.length, intent);
    return parsed.map((s: any, i: number) => {
      const idx = startIdx + i;
      const beat = masterBeatAssignments.get(i);
      const isMasterShot = typeof s.isMasterShot === 'boolean'
        ? s.isMasterShot
        : !!beat || (isGolden && i === 0);
      const normalizedQualityTier = s.qualityTier ?? defaultTier;
      const inferredShotType = this.inferShotType(s);
      return shotSchema.parse({
        ...s,
        isMasterShot,
        actionUnitId: s.actionUnitId || beat?.beatId || `${scene.sceneId}_act_${i + 1}`,
        shotType: s.shotType ?? inferredShotType,
        regenPriority: s.regenPriority ?? this.inferRegenPriority(normalizedQualityTier, isMasterShot),
        qualityTier: normalizedQualityTier,
        characterLockRefs: this.buildCharacterLockRefs(s, identityRefMap),
        styleLockRef: s.styleLockRef || styleLockRef,
        shotIndex: idx,
        shotId: s.shotId || `ep${epNum}_shot${idx}`,
        sceneId: scene.sceneId,
      });
    });
  }

  private inferShotType(shot: any): 'portrait' | 'dialogue' | 'action' | 'wide' | 'insert' {
    const shotSize: string = shot?.camera?.shotSize ?? '';
    const cameraAngle: string = shot?.camera?.cameraAngle ?? '';
    const movement: string = shot?.camera?.movement ?? '';
    const hasDialogue = !!shot?.dialogue?.text;
    const charCount = Array.isArray(shot?.characters) ? shot.characters.length : 0;
    const visualText = `${shot?.visualPrompt ?? ''} ${(shot?.characters ?? []).map((c: any) => c?.action ?? '').join(' ')}`.toLowerCase();

    // 景别决定基础类型
    if (['extreme_wide', 'wide', 'medium_wide'].includes(shotSize) || cameraAngle === 'bird_eye') return 'wide';
    if (shotSize === 'extreme_close_up') return 'insert';

    const actionTokens = ['run', 'chase', 'fight', 'hit', 'strike', 'kick', 'jump', 'grab', 'throw', 'punch', '冲', '打', '追', '跑', '跳', '砸', '挥', '扑'];
    const movingCamera = ['tracking', 'crane_up', 'crane_down', 'whip_pan', 'orbit', 'handheld', 'dolly_zoom'].includes(movement);
    if (movingCamera || actionTokens.some(t => visualText.includes(t))) return 'action';

    if (hasDialogue && charCount >= 2) return 'dialogue';
    // close_up 系列 + 单角色 = portrait（人物情绪特写）
    if (charCount <= 1 && ['close_up', 'medium_close_up'].includes(shotSize)) return 'portrait';
    if (hasDialogue) return 'dialogue';
    if (charCount === 0) return 'insert';
    return 'portrait';
  }

  private inferRegenPriority(
    qualityTier: 'golden' | 'standard' | 'filler',
    isMasterShot: boolean,
  ): 'high' | 'medium' | 'low' {
    if (isMasterShot || qualityTier === 'golden') return 'high';
    if (qualityTier === 'filler') return 'low';
    return 'medium';
  }

  private buildIdentityRefMap(state: DramaState): Map<string, string> {
    const map = new Map<string, string>();
    const version = state.visualBible?.version || 'v0';
    for (const pack of state.visualBible?.identityPack ?? []) {
      const faceDnaKey = (pack.faceDna || 'face').slice(0, 18);
      map.set(pack.characterId, `vb:${version}:${pack.characterId}:${faceDnaKey}`);
    }
    return map;
  }

  private buildCharacterLockRefs(shot: any, identityRefMap: Map<string, string>): string[] {
    const ids = new Set<string>();
    for (const c of shot?.characters ?? []) {
      if (c?.characterId) ids.add(c.characterId);
    }
    const refs = [...ids].map(id => identityRefMap.get(id) || `character:${id}`);
    return refs.slice(0, 4);
  }

  private resolveStyleLockRef(state: DramaState): string {
    if (state.visualBible?.version) return `vb-style:${state.visualBible.version}`;
    const styleBits = [
      state.visualStyle?.overallAesthetic,
      state.visualStyle?.renderTechnique,
      state.visualStyle?.textureStyle,
      state.visualStyle?.colorGrading,
    ].filter(Boolean);
    return styleBits.length ? `style:${styleBits.join('|')}` : '';
  }

  private resolveMasterBeatAssignments(
    script: EpisodeScript,
    scene: ScriptScene,
    shotCount: number,
    intent?: EpisodeIntent,
  ): Map<number, EpisodeIntent['masterShotPlan'][number]> {
    const assignments = new Map<number, EpisodeIntent['masterShotPlan'][number]>();
    if (!intent?.masterShotPlan?.length || shotCount <= 0) return assignments;

    const beats = intent.masterShotPlan.filter(b => b?.beatId);
    if (!beats.length) return assignments;

    const sceneDurations = script.scenes.map(s => Math.max(1, s.estimatedDurationSec || 1));
    const totalDur = sceneDurations.reduce((acc, n) => acc + n, 0);
    const sceneIndex = Math.max(0, scene.sceneIndex);
    const sceneStart = sceneDurations.slice(0, sceneIndex).reduce((acc, n) => acc + n, 0);
    const sceneDur = sceneDurations[sceneIndex] || Math.max(1, scene.estimatedDurationSec || 1);
    const sceneEnd = sceneStart + sceneDur;
    const used = new Set<number>();

    for (let bi = 0; bi < beats.length; bi++) {
      const beat = beats[bi];
      const ratio = beats.length === 1 ? 0.5 : bi / (beats.length - 1);
      const beatTime = totalDur * ratio;
      const isInScene = beatTime >= sceneStart && beatTime <= sceneEnd;
      if (!isInScene) continue;

      const localRatio = sceneDur > 0 ? Math.min(0.999, Math.max(0, (beatTime - sceneStart) / sceneDur)) : 0;
      const targetIndex = Math.min(shotCount - 1, Math.max(0, Math.floor(localRatio * shotCount)));
      const claimIndex = this.claimNearestAvailableShotIndex(targetIndex, shotCount, used);
      if (claimIndex < 0) continue;

      assignments.set(claimIndex, beat);
      used.add(claimIndex);
    }
    return assignments;
  }

  private claimNearestAvailableShotIndex(targetIndex: number, shotCount: number, used: Set<number>): number {
    if (shotCount <= 0) return -1;
    if (!used.has(targetIndex)) return targetIndex;
    for (let offset = 1; offset < shotCount; offset++) {
      const right = targetIndex + offset;
      if (right < shotCount && !used.has(right)) return right;
      const left = targetIndex - offset;
      if (left >= 0 && !used.has(left)) return left;
    }
    return -1;
  }

  /** 后处理：确保首尾帧T2I prompt包含角色face描述（visualPrompt用于T2V，不注入face以节省token） */
  private enforceFaceLock(shots: z.infer<typeof shotSchema>[], state: DramaState): void {
    const charMap = new Map(state.characters.map(c => [c.characterId, c]));
    // 仅截取 styleReferencePrompt 首段（逗号前）作为轻量风格锚定前缀。
    // 完整 styleReferencePrompt 由 MediaOrchestrator 在 T2I 组装阶段全量注入，
    // 此处只需一个简短关键词（如 "cinematic live action"）防止 LLM 生成的首尾帧偏离风格基调。
    const styleRef = state.visualStyle?.styleReferencePrompt ?? '';
    const stylePrefix = styleRef.split(',')[0]?.trim() ?? '';
    shots.forEach(shot => {
      const faceFragments = this.buildFaceFragments(shot.characters.map(c => c.characterId), charMap, shot.characterVariationIds);
      if (!faceFragments) return;
      if (shot.firstFramePrompt) shot.firstFramePrompt = this.injectFaceLock(shot.firstFramePrompt, faceFragments, stylePrefix);
      if (shot.lastFramePrompt) shot.lastFramePrompt = this.injectFaceLock(shot.lastFramePrompt, faceFragments, stylePrefix);
    });
    this.logger.log(`锁脸后处理完成：${shots.length} shots（首尾帧T2I prompt，风格前缀="${stylePrefix || '无'}"）`);
  }

  private buildFaceFragments(charIds: string[], charMap: Map<string, CharacterIdentity>, variationIds?: Record<string, string>): string {
    return charIds.map(cid => {
      const c = charMap.get(cid);
      if (!c) return '';
      const vid = variationIds?.[cid];
      const variation = vid ? c.variations?.find(v => v.variationId === vid) : null;
      const costume = variation?.visualPromptOverride || c.defaultCostumePrompt || c.defaultCostume;
      const hair = c.hairStylePrompt || c.hairStyle;
      const body = c.bodyTypePrompt || c.bodyType;
      const parts = [c.faceReferencePrompt, hair, body, costume].filter(Boolean);
      // 用 characterId（英文全拼，如 libai/yangyuhuan）作为 bracket 标识，避免中文名无法匹配英文 prompt
      return `[${c.characterId}: ${parts.join(', ')}]`;
    }).filter(Boolean).join(', ');
  }

  /** 将face描述注入prompt（去重：如果已含角色 characterId 关键词则不重复注入） */
  private injectFaceLock(prompt: string, faceFragments: string, stylePrefix: string): string {
    if (!prompt?.trim()) return `${stylePrefix}${faceFragments}`;
    const hasStyle = stylePrefix && prompt.toLowerCase().startsWith(stylePrefix.toLowerCase().slice(0, 10));
    // 用 characterId（英文全拼ID，如 [libai:）而非中文名来检测是否已注入，避免中英文不匹配
    const hasFace = faceFragments.split('[').filter(Boolean).every(f => {
      const cid = f.match(/^([^:]+):/)?.[1]?.trim();
      return cid && prompt.includes(`[${cid}:`);
    });
    if (hasFace && hasStyle) return prompt;
    const parts: string[] = [];
    if (!hasStyle && stylePrefix) parts.push(stylePrefix.trim());
    if (!hasFace) parts.push(faceFragments);
    return parts.length ? `${parts.join(', ')}, ${prompt}` : prompt;
  }
}
