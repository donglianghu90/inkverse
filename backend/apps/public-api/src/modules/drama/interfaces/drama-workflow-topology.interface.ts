/** Drama 工作流拓扑 — API 输出契约 */
import type { DramaWorkflowParams } from './drama-pipeline.interface';

export type WfNodeType = 'agent' | 'condition' | 'check' | 'phase_header';
export type WfEdgeType = 'normal' | 'conditional_true' | 'conditional_false' | 'retry';
export type WfPhaseType = 'sequential';
export type ConfigParamType = 'number' | 'boolean';

export interface ConfigParam {
  key: string;
  label: string;
  type: ConfigParamType;
  value: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  description: string;
}

export interface WfNode {
  id: string;
  label: string;
  type: WfNodeType;
  agentType?: string;
  icon?: string;
  isCore: boolean;
  isEnabled: boolean;
  condition?: string;
  configParams?: ConfigParam[];
  phaseId: string;
}

export interface WfEdge {
  id: string;
  source: string;
  target: string;
  type: WfEdgeType;
  label?: string;
  animated?: boolean;
}

export interface WfPhase {
  id: string;
  label: string;
  type: WfPhaseType;
  nodeIds: string[];
}

export interface DramaWorkflowTopology {
  phases: WfPhase[];
  nodes: WfNode[];
  edges: WfEdge[];
  params: DramaWorkflowParams;
}
