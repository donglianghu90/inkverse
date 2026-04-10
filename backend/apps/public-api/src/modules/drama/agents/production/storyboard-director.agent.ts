/** 分镜导演 — 按场景分步生成Shot + 后处理角色锁脸/风格一致性强制嵌入 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import {
  shotSchema, episodeStoryboardSchema, EpisodeStoryboard, EpisodeScript, EpisodeIntent,
  DramaState, ScriptScene, CharacterIdentity, shotCharacterSchema, shotDialogueSchema
} from '../../schemas/drama-state.schemas';
import { buildStoryboardDirectorStaticPrompt, buildStoryboardSceneContext, buildUserPromptConstraintsTail } from '../../prompting/drama-playbook';
import { DramaPromptTemplateService } from '../../prompting/drama-prompt-template.service';
import { VideoProviderRouterService } from '../../media-pipeline/video-provider-router.service';
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';

// 黄金场景类型：需要更密集的镜头和专属摄影语言
const GOLDEN_PURPOSES = new Set(['climax', 'confrontation', 'revelation', 'cliffhanger']);
// 过场类型：精简镜头
const FILLER_PURPOSES = new Set(['transition']);

@Injectable()
export class StoryboardDirectorAgent {
  private readonly logger = new Logger(StoryboardDirectorAgent.name);
  constructor(
    private readonly llm: LlmService,
    private readonly promptService: DramaPromptTemplateService,
    private readonly videoRouter: VideoProviderRouterService,
  ) {}

  async direct(state: DramaState, script: EpisodeScript, intent?: EpisodeIntent, continuityWarnings?: string[], rebakeLessons?: string[]): Promise<EpisodeStoryboard> {
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
      const shots = await this.directScene(state, script, scene, globalIdx, isLastScene, intent, prevSceneLastShots, continuityWarnings, rebakeLessons);
      allShots.push(...shots);
      globalIdx += shots.length;
      // 保留最后 2 个 shot 作为下一场景的视觉衔接锚点
      prevSceneLastShots = shots.slice(-2);
    }
    // 旧版后处理强制角色锁脸移至 ShotPromptAssemblerService 组装期实现
    // const totalDur = allShots.reduce((s, sh) => s + sh.estimatedDurationSec, 0);
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
    continuityWarnings?: string[],
    rebakeLessons?: string[],
  ) {
    const profile = state.promptProfile;
    const camGuide = profile?.cameraStyleGuide;
    const epNum = script.episodeNumber;
    const scenePurpose = scene.purpose;

    // P1-2 fix: 只传本场景出场角色的档案，减少 ~30% prompt tokens
    // 防御性归一化：即使上游 Zod 已归一化，此处仍做一次以防止数据不一致
    const normalizeId = (id: string) => id.toLowerCase().replace(/[\s\-_]+/g, '');
    const sceneCharIds = new Set((scene.presentCharacterIds ?? []).map(normalizeId));
    const sceneChars = sceneCharIds.size > 0
      ? state.characters.filter(c => sceneCharIds.has(normalizeId(c.characterId)))
      : state.characters; // 降级：若场景未指定角色列表，传全量
    const chars = sceneChars.map(c => {
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
    const locDesc = loc
      ? `${loc.locationId}(${loc.name}): visualPrompt="${loc.visualPrompt}" lighting="${loc.lightingDefault ?? ''}"${loc.colorTone ? ` colorTone="${loc.colorTone}"` : ''}`
      : scene.sceneHeading;

    const effectiveGolden = GOLDEN_PURPOSES;
    const targetDur = scene.estimatedDurationSec;
    const isGolden = effectiveGolden.has(scenePurpose);
    const isFiller = FILLER_PURPOSES.has(scenePurpose);
    const shotDensitySec = isGolden ? 2.5 : isFiller ? 5 : 3.5;
    const maxShots = isGolden
      ? Math.min(Math.max(Math.ceil(targetDur / shotDensitySec), 4), 15)
      : isFiller
        ? Math.min(Math.ceil(targetDur / shotDensitySec), 5)
        : Math.min(Math.max(Math.ceil(targetDur / shotDensitySec), 3), 12);
    // 签名道具上下文：查找与本场景角色关联的签名道具
    const sigProps = (state.signatureProps ?? [])
      .filter(p => p.visualPrompt?.trim())
      .map(p => `${p.propId}(${p.name}, 归属${p.characterOwner ?? '全剧'}): "${p.visualPrompt}"`);
    const sigPropsCtx = sigProps.length > 0
      ? `\n📌 签名道具（角色持有这些道具时，firstFramePrompt/lastFramePrompt 中必须包含其精确描述）：\n${sigProps.join('\n')}\n`
      : '';
    // masterShotPlan 上下文
    const masterShotCtx = intent?.masterShotPlan?.length
      ? `\n📷 导演规划的主镜头（至少为每个属于本场景的主镜生成 1 个对应 Shot，设 isMasterShot=true）：\n${intent.masterShotPlan.map(m => `- ${m.beatId}: ${m.visualGoal} | ${m.emotionGoal} (${m.actionVerb}, ${m.minDurSec}-${m.maxDurSec}s)`).join('\n')}\n`
      : '';

    // 动态构建 Schema，彻底消除 AI 实体引用的幻觉
    const validCharIds = state.characters.map((c) => c.characterId) as [string, ...string[]];
    const characterIdField = validCharIds.length > 0 ? z.enum(validCharIds) : z.string();
    const dynamicShotCharacterSchema = shotCharacterSchema.extend({
      characterId: characterIdField,
    });
    const dynamicShotDialogueSchema = shotDialogueSchema.extend({
      characterId: characterIdField,
    });
    const dynamicShotSchema = shotSchema.extend({
      sceneId: z.literal(scene.sceneId),
      characters: z.array(dynamicShotCharacterSchema).nullish().transform(v => v ?? []),
      dialogue: dynamicShotDialogueSchema.nullish(),
    });
    const dynamicSceneShotsOutputSchema = z.object({
      _thoughtProcess: z.string().describe('Write your detailed visual planning thoughts here before defining the shots.'),
      shots: z.array(dynamicShotSchema),
    });

    const raw = await this.llm.generateStructured({
      taskName: DRAMA_AGENT_REGISTRY.STORYBOARD_DIRECTOR.key,
      schema: dynamicSceneShotsOutputSchema,
      metadata: { dramaId: state.dramaId, userId: state.userId, episodeNumber: epNum },
      systemPrompt: await this.promptService.buildPrompt(
        state.dramaId,
        'storyboard-director',
        buildStoryboardDirectorStaticPrompt({
          camGuide,
          visualStyle: state.visualStyle,
          videoModelProfile: this.videoRouter.getModelProfile(state.videoProvider ?? 'sora'),
        }),
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
⚠️ 姿态与空间继承铁律（场景内连贯性保障）：
- 同场景内，每个Shot的 firstFramePrompt 中，角色的姿态、位置、朝向必须与前一个Shot的 lastFramePrompt 自然衔接！
- 若前一Shot结尾"角色转身走向门口（背对）"，则下一Shot起始不能是"正面直视镜头"。
- 组装场景时，请脑补角色的物理空间移动，严格保持动作连贯。

⚠️ 合法角色ID白名单（characters数组只能使用这些ID，其他一律视为违规）：
[${state.characters.map(c => `${c.characterId}(${c.name})`).join(', ')}]
路人/守军/群演等非注册角色只能在 visualPrompt 文字描述中出现，禁止写入 characters 数组。

角色档案（提供给你的角色信息仅作参考，请通过视觉动作和交互来表现他们）：
${chars}

场景视觉：
${locDesc}
${masterShotCtx}${sigPropsCtx}
要求：shots数组，每个Shot必须包含firstFramePrompt、lastFramePrompt 和 qualityTier。visualPrompt、firstFramePrompt 和 lastFramePrompt 必须纯粹描写"画面里有什么"，专注动作、姿态、光影氛围与场景布置。
**重要准则**：禁止在 prompt 中出现诸如 "close_up", "medium shot", "looking at camera", 角色发型、衣服、脸部细节的描述！这些描述会在后期管线中自动根据 budget 拼接，如果在 prompt 中出现会导致 token 重复叠加污染画面！
【强化要求】请先在 _thoughtProcess 中一步一步写下你的全场景机位调度考量、节奏分析以及防犯错策略，思考清楚后再输出 shots 数组！
${rebakeLessons?.length ? `\n🔥 回炉教训（上一版分镜之所以不合格的原因，这一版你必须绝对避免）：\n${rebakeLessons.map(l => `- ${l}`).join('\n')}` : ''}
${flashbackCtx}
${continuityWarnings?.length ? `\n⚠️ 连续性警告（分镜创作时必须遵守以下修正建议）：\n${continuityWarnings.join('\n')}` : ''}${buildUserPromptConstraintsTail({ redLines: state.seed?.redLines })}`,
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

    // extreme_close_up：有角色 → portrait（人脸大特写），无角色 → insert（道具/细节微距）
    // 之前无条件返回 insert 导致人脸特写被送入 INSERT_PROP 编译器（强制 "no people"），
    // LLM 凭空捏造道具描述，与人脸参考图严重冲突。
    if (shotSize === 'extreme_close_up') {
      return charCount > 0 ? 'portrait' : 'insert';
    }

    const actionTokens = ['run', 'chase', 'fight', 'hit', 'strike', 'kick', 'jump', 'grab', 'throw', 'punch', '冲', '打', '追', '跑', '跳', '砸', '挥', '扑'];
    const movingCamera = ['tracking', 'crane_up', 'crane_down', 'whip_pan', 'orbit', 'handheld', 'dolly_zoom'].includes(movement);
    if (movingCamera || actionTokens.some(t => visualText.includes(t))) return 'action';

    if (hasDialogue && charCount >= 2) return 'dialogue';
    // close_up 系列 + 单角色 = portrait（人物情绪特写）
    if (charCount <= 1 && ['close_up', 'medium_close_up'].includes(shotSize)) return 'portrait';
    if (hasDialogue) return 'dialogue';
    // 无角色 + 无对白 = 纯道具/环境细节镜头
    if (charCount === 0 && !hasDialogue) return 'insert';
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
}
