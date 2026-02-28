/** 工作流拓扑生成服务 — 根据 Pipeline 节点配置生成完整的可视化拓扑描述 */
import { Injectable } from '@nestjs/common';
import { AgentNodeConfig, WorkflowParams, DEFAULT_WORKFLOW_PARAMS } from './entities/book-agent-pipeline.entity';

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

const AGENT_ICON: Record<string, string> = {
  'arc-director': '🎬', intent: '🧭', 'continuity-guard': '🛡️', 'scene-planner': '🎯',
  'creative-writer': '✍️', 'scene-stitcher': '🧵', reviewer: '🔍', 'character-voice-coach': '🎙️',
  'pacing-analyzer': '⏱️', editor: '✂️', 'hook-crafter': '🪝', recorder: '📚',
  'text-analyzer': '📝', 'world-extractor': '🌍', 'narrative-extractor': '📖',
};

@Injectable()
export class WorkflowTopologyService {
  buildTopology(nodes: AgentNodeConfig[], params?: WorkflowParams | null): WorkflowTopology {
    const p = { ...DEFAULT_WORKFLOW_PARAMS, ...(params ?? {}) };
    const enabled = (id: string) => nodes.find((n) => n.id === id)?.isEnabled ?? true;
    const agentNode = (id: string, n: AgentNodeConfig | undefined, phaseId: string, extra?: Partial<WfNode>): WfNode => ({
      id, label: n?.label ?? id, type: 'agent', agentType: n?.type, icon: AGENT_ICON[n?.type ?? id],
      isCore: n?.isCore ?? false, isEnabled: n?.isEnabled ?? true, phaseId, ...extra,
    });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const allNodes: WfNode[] = [];
    const allEdges: WfEdge[] = [];
    const edge = (src: string, tgt: string, type: WfEdgeType = 'normal', label?: string, animated?: boolean) =>
      allEdges.push({ id: `e-${src}-${tgt}-${type}`, source: src, target: tgt, type, label, animated });

    // ── Phase 1: 准备 ──
    const P1 = 'preparation';
    allNodes.push(agentNode('arc-director', nodeMap.get('arc-director'), P1));
    allNodes.push(agentNode('intent', nodeMap.get('intent'), P1));
    allNodes.push(agentNode('continuity-guard', nodeMap.get('continuity-guard'), P1));
    allNodes.push({
      id: 'memory-check', label: '长程记忆', type: 'condition', isCore: false, isEnabled: true, phaseId: P1,
      condition: `chapter > ${p.longRangeMemoryThreshold}`,
      configParams: [{ key: 'longRangeMemoryThreshold', label: '触发章节阈值', type: 'number', value: p.longRangeMemoryThreshold, min: 1, max: 100, step: 1, description: '超过此章节数后启用长程记忆检索' }],
    });
    allNodes.push({ id: 'memory-retrieval', label: '远程记忆检索', type: 'agent', agentType: 'memory-retrieval', icon: '📡', isCore: false, isEnabled: true, phaseId: P1 });
    edge('arc-director', 'intent');
    edge('intent', 'continuity-guard');
    edge('continuity-guard', 'memory-check');
    edge('memory-check', 'memory-retrieval', 'conditional_true', `chapter>${p.longRangeMemoryThreshold}`);
    edge('memory-check', 'loop-entry', 'conditional_false', '跳过');
    edge('memory-retrieval', 'loop-entry');

    // ── Phase 2: 质量门控循环 ──
    const P2 = 'quality_loop';
    const maxAttempts = 1 + p.maxRepairRounds;
    allNodes.push({
      id: 'loop-entry', label: '循环入口', type: 'loop_entry', isCore: true, isEnabled: true, phaseId: P2,
      condition: `最多 ${maxAttempts} 轮`,
      configParams: [{ key: 'maxRepairRounds', label: '最大重写轮数', type: 'number', value: p.maxRepairRounds, min: 0, max: 5, step: 1, description: `总尝试次数 = 1 + 此值（当前 ${maxAttempts} 轮）` }],
    });
    allNodes.push({
      id: 'path-check', label: '写作路径', type: 'condition', isCore: false, isEnabled: true, phaseId: P2,
      condition: '首轮且场景规划启用?',
    });
    allNodes.push(agentNode('scene-planner', nodeMap.get('scene-planner'), P2));
    allNodes.push(agentNode('creative-writer', nodeMap.get('creative-writer'), P2, { label: '逐场景写作' }));
    allNodes.push(agentNode('scene-stitcher', nodeMap.get('scene-stitcher'), P2));
    allNodes.push({ id: 'chapter-writer', label: '章节级写作', type: 'agent', icon: '✍️', agentType: 'creative-writer', isCore: true, isEnabled: true, phaseId: P2 });
    allNodes.push({ id: 'det-check-loop', label: '确定性检查', type: 'check', icon: '📋', isCore: true, isEnabled: true, phaseId: P2 });
    allNodes.push(agentNode('reviewer', nodeMap.get('reviewer'), P2));
    allNodes.push({
      id: 'quality-gate', label: '质量门控', type: 'condition', isCore: true, isEnabled: true, phaseId: P2,
      condition: `score ≥ ${p.qualityPassScore} 且无 critical 且硬规则通过`,
      configParams: [{ key: 'qualityPassScore', label: '通过分数', type: 'number', value: p.qualityPassScore, min: 5, max: 10, step: 0.5, description: '加权分达到此值才能通过质量门控' }],
    });
    allNodes.push({ id: 'loop-exit', label: '循环出口', type: 'loop_exit', isCore: true, isEnabled: true, phaseId: P2 });

    edge('loop-entry', 'path-check');
    const scenePlannerEnabled = enabled('scene-planner');
    edge('path-check', 'scene-planner', 'conditional_true', scenePlannerEnabled ? '场景级流水线' : '(未启用)');
    edge('path-check', 'chapter-writer', 'conditional_false', '章节级/重写轮');
    edge('scene-planner', 'creative-writer');
    edge('creative-writer', 'scene-stitcher');
    edge('scene-stitcher', 'det-check-loop');
    edge('chapter-writer', 'det-check-loop');
    edge('det-check-loop', 'reviewer');
    edge('reviewer', 'quality-gate');
    edge('quality-gate', 'loop-exit', 'conditional_true', '✅ 通过');
    edge('quality-gate', 'loop-entry', 'retry', '❌ 重写', true);

    // ── Phase 3: 后处理 ──
    const P3 = 'post_process';
    allNodes.push({ id: 'parallel-analysis-fork', label: '并行质量分析', type: 'parallel_fork', isCore: false, isEnabled: true, phaseId: P3 });
    allNodes.push(agentNode('character-voice-coach', nodeMap.get('character-voice-coach'), P3));
    allNodes.push(agentNode('pacing-analyzer', nodeMap.get('pacing-analyzer'), P3));
    allNodes.push({ id: 'parallel-analysis-join', label: '汇合', type: 'parallel_join', isCore: false, isEnabled: true, phaseId: P3 });
    allNodes.push({ id: 'det-check-pre', label: '确定性检查(精修前)', type: 'check', icon: '📋', isCore: true, isEnabled: true, phaseId: P3 });
    allNodes.push({
      id: 'polish-check', label: '精修判断', type: 'condition', isCore: false, isEnabled: true, phaseId: P3,
      condition: `score < ${p.editorPolishThreshold} 或硬规则失败或有 critical`,
      configParams: [{ key: 'editorPolishThreshold', label: '精修阈值', type: 'number', value: p.editorPolishThreshold, min: 4, max: 9, step: 0.5, description: '加权分低于此值将触发编辑精修' }],
    });
    allNodes.push(agentNode('editor', nodeMap.get('editor'), P3));
    allNodes.push(agentNode('hook-crafter', nodeMap.get('hook-crafter'), P3));
    allNodes.push({ id: 'content-changed', label: '内容变化?', type: 'condition', isCore: false, isEnabled: true, phaseId: P3, condition: '编辑/钩子后内容是否变化' });
    allNodes.push({ id: 'final-review', label: '终稿复评', type: 'agent', icon: '🔍', agentType: 'reviewer', isCore: false, isEnabled: true, phaseId: P3 });
    allNodes.push({ id: 'score-compare', label: '分数对比', type: 'condition', isCore: false, isEnabled: true, phaseId: P3, condition: '复评分 ≥ 原分?' });
    allNodes.push({ id: 'det-check-final', label: '确定性检查(终稿)', type: 'check', icon: '📋', isCore: true, isEnabled: true, phaseId: P3 });

    edge('loop-exit', 'parallel-analysis-fork');
    edge('parallel-analysis-fork', 'character-voice-coach', 'parallel');
    edge('parallel-analysis-fork', 'pacing-analyzer', 'parallel');
    edge('character-voice-coach', 'parallel-analysis-join');
    edge('pacing-analyzer', 'parallel-analysis-join');
    edge('parallel-analysis-join', 'det-check-pre');
    edge('det-check-pre', 'polish-check');
    edge('polish-check', 'editor', 'conditional_true', '需要精修');
    edge('polish-check', 'hook-crafter', 'conditional_false', '跳过精修');
    edge('editor', 'hook-crafter');
    edge('hook-crafter', 'content-changed');
    edge('content-changed', 'final-review', 'conditional_true', '有变化');
    edge('content-changed', 'det-check-final', 'conditional_false', '无变化');
    edge('final-review', 'score-compare');
    edge('score-compare', 'det-check-final', 'conditional_true', '✅ 采纳新版');
    edge('score-compare', 'det-check-final', 'rollback', '↩ 回退原版');

    // ── Phase 4: 记录 ──
    const P4 = 'recording';
    allNodes.push({ id: 'recorder-fork', label: '并行提取', type: 'parallel_fork', isCore: false, isEnabled: true, phaseId: P4 });
    allNodes.push({ id: 'text-analyzer', label: '文本分析', type: 'agent', icon: '📝', agentType: 'text-analyzer', isCore: false, isEnabled: true, phaseId: P4 });
    allNodes.push({ id: 'world-extractor', label: '世界提取', type: 'agent', icon: '🌍', agentType: 'world-extractor', isCore: false, isEnabled: true, phaseId: P4 });
    allNodes.push({ id: 'narrative-extractor', label: '叙事提取', type: 'agent', icon: '📖', agentType: 'narrative-extractor', isCore: false, isEnabled: true, phaseId: P4 });
    allNodes.push({ id: 'recorder-join', label: '合并记录', type: 'parallel_join', isCore: false, isEnabled: true, phaseId: P4 });

    edge('det-check-final', 'recorder-fork');
    edge('recorder-fork', 'text-analyzer', 'parallel');
    edge('recorder-fork', 'world-extractor', 'parallel');
    edge('recorder-fork', 'narrative-extractor', 'parallel');
    edge('text-analyzer', 'recorder-join');
    edge('world-extractor', 'recorder-join');
    edge('narrative-extractor', 'recorder-join');

    const phases: WfPhase[] = [
      { id: P1, label: '准备阶段', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P1).map((n) => n.id) },
      { id: P2, label: '质量门控循环', type: 'loop', nodeIds: allNodes.filter((n) => n.phaseId === P2).map((n) => n.id) },
      { id: P3, label: '后处理', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P3).map((n) => n.id) },
      { id: P4, label: '知识记录', type: 'parallel_group', nodeIds: allNodes.filter((n) => n.phaseId === P4).map((n) => n.id) },
    ];

    return { phases, nodes: allNodes, edges: allEdges, params: p };
  }
}
