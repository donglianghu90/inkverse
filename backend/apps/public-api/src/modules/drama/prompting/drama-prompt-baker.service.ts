/**
 * Drama Prompt Baker — 在短剧创建完成后，一次性将所有 pipeline 节点的 system prompt 烘焙为
 * 完整的 basePromptSnapshot 存入数据库。
 *
 * 设计原则：
 *   - 所有「已知变量」（题材规则 / 编剧手册 / 摄影手册 / 音频手册 / 叙事策略）在创建完成时解析，
 *     存入 basePromptSnapshot。运行时 Agent 直接读取，不再重复组装。
 *   - 运行时真正动态的内容（集号/剧情摘要/角色列表/情绪节拍）只存在于 userPrompt，永不进入 system prompt。
 *   - soulViews（Profiler 按 Agent 生成的本剧专属灵魂视图）是 basePromptSnapshot 的变量来源。
 *   - 用户在「创作工坊」看到并编辑的是已解析的 basePromptSnapshot（完整 prompt），不再是碎片。
 *
 * 预配置题材（boss / sweet / ...）的 storyboard-director 提示词已由 genres/*.prompts.ts 提供
 * WYSIWYG 完整内容，{{visualStyleSection}} 是唯一的运行时占位符。其他 agent 的 BASE 模板
 * 保留 per-drama 变量，由各 build* 函数从 profile/strategy/soul 解析并填充。
 * _custom 题材保持 BASE 原样，此处仍需完整解析所有变量。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { DramaPromptProfile, DramaStrategy, VisualStyleGuide } from '../schemas/drama-state.schemas';
import { DRAMA_AGENT_REGISTRY } from '../agents/drama-agent.registry';
import { DramaAgentPipelineService } from '../workflow/drama-agent-pipeline.service';
import type { DramaAgentNodeConfig } from '../interfaces';
import {
  buildArcDirectorSystemPrompt,
  buildEpisodeDirectorSystemPrompt,
  buildContinuityGuardSystemPrompt,
  buildScriptwriterSystemPrompt,
  buildDialogueCoachSystemPrompt,
  buildStoryboardDirectorStaticPrompt,
  buildAudioDirectorStaticPrompt,
  buildScriptReviewerSystemPrompt,
  buildScriptEditorSystemPrompt,
  buildPacingAnalyzerSystemPrompt,
  buildHookCrafterStaticPrompt,
  buildEpisodeRecorderSystemPrompt,
} from './drama-playbook';

export interface BakeContext {
  dramaId: string;
  profile: DramaPromptProfile;
  strategy?: DramaStrategy;
  visualStyle?: VisualStyleGuide;
  /** seed.redLines — 不可违反的底线，注入到所有下游 agent system prompt */
  redLines?: string[];
  /** 视觉风格模板的扩展字段（来自 DramaVisualStyleTemplateService），含 shotStyleGuide/scriptDialogueGuide 等 */
  visualStyleExtras?: {
    shotStyleGuide?: string;
    scriptDialogueGuide?: string;
    facePromptRule?: string;
    scenePromptGuidance?: string;
  };
  /** 视频模型能力档案，注入分镜 system prompt 让 LLM 按模型约束设计镜头 */
  videoModelProfile?: {
    displayName: string;
    minDurationSec: number;
    maxDurationSec: number;
    sweetSpotSec: number;
    promptStyleHint: string;
    strengthHint: string;
    constraintHint: string;
  };
}

/**
 * 从 profile 中解析出编剧灵魂视图（优先 soulViews，兼容旧 scriptwriterGuide）。
 */
function resolveScriptwriterSoul(profile: DramaPromptProfile) {
  const soul = profile.soulViews?.scriptwriter;
  const legacy = profile.scriptwriterGuide;
  return {
    coreIdentity: soul?.coreIdentity || legacy?.coreIdentity || '',
    genreRules: soul?.genreRules?.length ? soul.genreRules : (legacy?.genreRules ?? []),
    dialogueGuide: soul?.dialogueGuide || legacy?.dialogueGuide || '',
    pacingGuide: soul?.pacingGuide || legacy?.pacingGuide || '',
    visualNarrativeGuide: soul?.visualNarrativeGuide || legacy?.visualNarrativeGuide || '',
    forbiddenPatterns: soul?.forbiddenPatterns?.length ? soul.forbiddenPatterns : (legacy?.forbiddenPatterns ?? []),
  };
}

@Injectable()
export class DramaPromptBakerService {
  private readonly logger = new Logger(DramaPromptBakerService.name);

  constructor(private readonly pipelineService: DramaAgentPipelineService) {}

  /**
   * 核心入口：短剧创建完成（Profiler 运行后）调用。
   * 为所有 pipeline 节点生成完整的 basePromptSnapshot 并发布。
   */
  async bakeAndPublish(ctx: BakeContext): Promise<void> {
    const { dramaId, profile, strategy, visualStyle, visualStyleExtras } = ctx;

    const soul = resolveScriptwriterSoul(profile);
    const genreRules = soul.genreRules;
    const genreArchetype = profile.genreArchetype;
    const cameraGuide = profile.cameraStyleGuide;
    const audioGuide = profile.audioStyleGuide;
    const reviewerCalib = profile.reviewerCalibration;

    const visualStyleWithExtras = visualStyle
      ? { ...visualStyle, shotStyleGuide: visualStyleExtras?.shotStyleGuide }
      : visualStyleExtras?.shotStyleGuide
        ? { overallAesthetic: '', colorGrading: '', lightingStyle: '', renderTechnique: '', textureStyle: '', referenceStyle: '', shotStyleGuide: visualStyleExtras.shotStyleGuide }
        : undefined;

    const scriptwriterVisualStyle = visualStyle
      ? { ...visualStyle, scriptDialogueGuide: visualStyleExtras?.scriptDialogueGuide }
      : undefined;

    // --- 为各节点烘焙 basePromptSnapshot ---
    // 预配置题材：storyboard-director 使用 WYSIWYG 提示词（genres/*.prompts.ts），只需解析 visualStyleSection。
    //             其他 agent 的 BASE 模板通过 build* 函数解析 per-drama 变量。
    // _custom 题材：所有 agent 使用 BASE 模板，build* 函数在此处完整解析所有变量。
    const snapshots: Record<string, string> = {

      [DRAMA_AGENT_REGISTRY.ARC_DIRECTOR.promptKey]: buildArcDirectorSystemPrompt({
        genreArchetype,
        genreRules,
        arcDirectorGuide: profile.arcDirectorGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.ARC_DIRECTOR.promptKey]) + this.soulBlock('arcDirector', profile),

      [DRAMA_AGENT_REGISTRY.EPISODE_DIRECTOR.promptKey]: buildEpisodeDirectorSystemPrompt({
        maxPresentPerEpisode: strategy?.characterBudget?.maxPresentPerEpisode,
        genreArchetype,
        visualStyle: visualStyleWithExtras,
        genreRules,
        episodeDirectorGuide: profile.episodeDirectorGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.EPISODE_DIRECTOR.promptKey]) + this.soulBlock('episodeDirector', profile),

      [DRAMA_AGENT_REGISTRY.CONTINUITY_GUARD.promptKey]: buildContinuityGuardSystemPrompt({
        genreSpecificChecks: [
          ...(reviewerCalib?.genreSpecificChecks ?? []),
          ...(profile.soulViews?.continuityGuardChecks ?? []),
        ],
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.CONTINUITY_GUARD.promptKey]),

      [DRAMA_AGENT_REGISTRY.SCRIPTWRITER.promptKey]: buildScriptwriterSystemPrompt({
        guide: soul,
        visualStyle: scriptwriterVisualStyle,
        genreArchetype,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.SCRIPTWRITER.promptKey]),

      [DRAMA_AGENT_REGISTRY.DIALOGUE_COACH.promptKey]: buildDialogueCoachSystemPrompt({
        dialogueGuide: soul.dialogueGuide,
        adaptationNotes: genreArchetype?.adaptationNotes,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.DIALOGUE_COACH.promptKey]),

      [DRAMA_AGENT_REGISTRY.STORYBOARD_DIRECTOR.promptKey]: buildStoryboardDirectorStaticPrompt({
        camGuide: cameraGuide,
        visualStyle,
        videoModelProfile: ctx.videoModelProfile,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.STORYBOARD_DIRECTOR.promptKey]),

      [DRAMA_AGENT_REGISTRY.AUDIO_DIRECTOR.promptKey]: buildAudioDirectorStaticPrompt({
        audioGuide: audioGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.AUDIO_DIRECTOR.promptKey]),

      [DRAMA_AGENT_REGISTRY.SCRIPT_REVIEWER.promptKey]: buildScriptReviewerSystemPrompt({
        weights: reviewerCalib?.dimensionWeights as Record<string, number> | undefined,
        genreChecks: reviewerCalib?.genreSpecificChecks,
        dialogueGuide: soul.dialogueGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.SCRIPT_REVIEWER.promptKey]),

      [DRAMA_AGENT_REGISTRY.SCRIPT_EDITOR.promptKey]: buildScriptEditorSystemPrompt({
        dialogueGuide: soul.dialogueGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.SCRIPT_EDITOR.promptKey]),

      [DRAMA_AGENT_REGISTRY.PACING_ANALYZER.promptKey]: buildPacingAnalyzerSystemPrompt({
        genreArchetype,
        genreRules,
        pacingAnalyzerGuide: profile.pacingAnalyzerGuide,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.PACING_ANALYZER.promptKey]) + this.soulBlock('pacingAnalyzer', profile),

      [DRAMA_AGENT_REGISTRY.HOOK_CRAFTER.promptKey]: buildHookCrafterStaticPrompt({
        strategy: strategy?.hookCadencePolicy,
        genreRules,
        genreArchetype: profile.soulViews?.hookCrafter
          ? { adaptationNotes: profile.soulViews.hookCrafter }
          : genreArchetype,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.HOOK_CRAFTER.promptKey]),

      [DRAMA_AGENT_REGISTRY.EPISODE_RECORDER.promptKey]: buildEpisodeRecorderSystemPrompt({
        genreArchetype,
        genreRules,
      }, profile.agentSystemPrompts?.[DRAMA_AGENT_REGISTRY.EPISODE_RECORDER.promptKey]),
    };

    const currentNodes = await this.pipelineService.getPublishedNodes(dramaId);
    const updatedNodes: DramaAgentNodeConfig[] = currentNodes.map(node => {
      const snap = snapshots[node.id];
      if (!snap) return node;
      return {
        ...node,
        basePromptSnapshot: snap,
        promptBakedAt: new Date().toISOString(),
      };
    });

    await this.pipelineService.saveDraft(dramaId, updatedNodes);
    await this.pipelineService.publish(dramaId);

    this.logger.log(`[PromptBaker] 烘焙完成 dramaId=${dramaId} nodes=${Object.keys(snapshots).length}`);
  }

  /**
   * 从 soulViews 提取指定 Agent 的适配块，若有内容则格式化为追加段落。
   * 追加在对应节点 prompt 末尾，补充题材基线之上的本剧个性化规则。
   */
  private soulBlock(key: 'arcDirector' | 'episodeDirector' | 'pacingAnalyzer', profile: DramaPromptProfile): string {
    const text = profile.soulViews?.[key];
    if (!text?.trim()) return '';
    const labels: Record<string, string> = {
      arcDirector: '本剧专属段落规划补充',
      episodeDirector: '本剧专属集级规划补充',
      pacingAnalyzer: '本剧专属节奏评估补充',
    };
    return `\n\n=== ${labels[key]} ===\n${text.trim()}`;
  }
}
