/** 小说 Pipeline — 节点配置、工作流参数、视图契约 */

export type AgentNodeType =
  | 'intent'
  | 'arc-director'
  | 'scene-planner'
  | 'creative-writer'
  | 'scene-stitcher'
  | 'reviewer'
  | 'editor'
  | 'recorder'
  | 'continuity-guard'
  | 'hook-crafter'
  | 'pacing-analyzer'
  | 'character-voice-coach'
  | 'custom';

export type CustomOutputType = 'ChapterDraft' | 'ChapterIntent';

export interface CustomAgentConfig {
  systemPrompt: string;
  userPromptTemplate: string;
  outputType: CustomOutputType;
  temperature: number;
}

export interface AgentNodeConfig {
  id: string;
  type: AgentNodeType;
  label: string;
  description: string;
  isEnabled: boolean;
  isDeletable: boolean;
  isCore: boolean;
  position: number;
  rfPosition: { x: number; y: number };
  additionalSystemPrompt: string;
  customConfig?: CustomAgentConfig;
}

export interface WorkflowParams {
  qualityPassScore: number;
  maxRepairRounds: number;
  editorPolishThreshold: number;
  longRangeMemoryThreshold: number;
}

export interface PipelineView {
  bookId: string;
  draftNodes: AgentNodeConfig[];
  publishedNodes: AgentNodeConfig[] | null;
  publishedAt: string | null;
  hasDraft: boolean;
  workflowParams: WorkflowParams;
}
