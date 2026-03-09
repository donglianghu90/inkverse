/** 小说工作流拓扑 — API 输出契约 */
import type { WorkflowParams } from './book-pipeline.interface';

export type WfNodeType = 'agent' | 'condition' | 'check' | 'parallel_fork' | 'parallel_join' | 'loop_entry' | 'loop_exit' | 'phase_header';
export type WfEdgeType = 'normal' | 'conditional_true' | 'conditional_false' | 'retry' | 'rollback' | 'parallel';
export type WfPhaseType = 'sequential' | 'loop' | 'parallel_group';
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

export interface WorkflowTopology {
  phases: WfPhase[];
  nodes: WfNode[];
  edges: WfEdge[];
  params: WorkflowParams;
}
