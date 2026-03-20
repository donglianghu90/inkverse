/** Drama Agent Pipeline — 节点配置、工作流参数、视图契约 */

export type DramaAgentNodeType =
  | 'arc-director' | 'episode-director' | 'continuity-guard'
  | 'scriptwriter' | 'dialogue-coach'
  | 'storyboard-director' | 'audio-director'
  | 'deterministic-checker' | 'script-reviewer' | 'script-editor'
  | 'pacing-analyzer' | 'hook-crafter' | 'episode-recorder'
  | 'custom';

export interface DramaAgentNodeConfig {
  id: string;
  type: DramaAgentNodeType;
  label: string;
  description: string;
  isEnabled: boolean;
  isDeletable: boolean;
  isCore: boolean;
  position: number;
  rfPosition: { x: number; y: number };
  additionalSystemPrompt: string;
  /** 用户固定并编辑后的基础提示词快照。存在时替代代码自动生成的 basePrompt。 */
  basePromptSnapshot?: string;
  /** DramaPromptBakerService 最近一次烘焙的时间（ISO 字符串），供前端展示 */
  promptBakedAt?: string;
  customConfig?: { systemPrompt: string; userPromptTemplate: string; temperature: number };
}

export interface DramaWorkflowParams {
  maxEditRounds: number;
  maxContinuityRetries: number;
  qualityPassScore: number;
  enableDialogueCoach: boolean;
  enablePacingAnalyzer: boolean;
  enableHookCrafter: boolean;
}

export interface DramaPipelineView {
  dramaId: string;
  draftNodes: DramaAgentNodeConfig[];
  publishedNodes: DramaAgentNodeConfig[] | null;
  publishedAt: string | null;
  hasDraft: boolean;
  workflowParams: DramaWorkflowParams;
}
