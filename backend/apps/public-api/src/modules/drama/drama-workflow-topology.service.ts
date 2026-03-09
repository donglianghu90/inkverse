/** Drama 工作流拓扑生成服务 — 根据 Pipeline 节点配置生成线性链可视化拓扑 */
import { Injectable } from '@nestjs/common';
import { DEFAULT_DRAMA_WORKFLOW_PARAMS } from './entities/drama-agent-pipeline.entity';
import type { DramaAgentNodeConfig, DramaWorkflowParams } from './interfaces';
import type { WfEdgeType, WfNode, WfEdge, WfPhase, DramaWorkflowTopology } from './interfaces';

export type { WfNodeType, WfEdgeType, WfPhaseType, ConfigParamType, ConfigParam, WfNode, WfEdge, WfPhase, DramaWorkflowTopology } from './interfaces';

const AGENT_ICON: Record<string, string> = {
  'arc-director': '🎬', 'episode-director': '🎯', 'continuity-guard': '🛡️', scriptwriter: '✍️',
  'dialogue-coach': '🎙️', 'storyboard-director': '🎥', 'audio-director': '🔊',
  'deterministic-checker': '📋', 'script-reviewer': '🔍', 'script-editor': '✂️',
  'pacing-analyzer': '⏱️', 'hook-crafter': '🪝', 'episode-recorder': '📚',
};

@Injectable()
export class DramaWorkflowTopologyService {
  buildTopology(nodes: DramaAgentNodeConfig[], params?: DramaWorkflowParams | null): DramaWorkflowTopology {
    const p = { ...DEFAULT_DRAMA_WORKFLOW_PARAMS, ...(params ?? {}) };
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const allNodes: WfNode[] = [];
    const allEdges: WfEdge[] = [];
    const mkNode = (id: string, phaseId: string, extra?: Partial<WfNode>): WfNode => {
      const n = nodeMap.get(id);
      return { id, label: n?.label ?? id, type: 'agent', agentType: n?.type, icon: AGENT_ICON[id], isCore: n?.isCore ?? false, isEnabled: n?.isEnabled ?? true, phaseId, ...extra };
    };
    const edge = (src: string, tgt: string, type: WfEdgeType = 'normal', label?: string, animated?: boolean) =>
      allEdges.push({ id: `e-${src}-${tgt}-${type}`, source: src, target: tgt, type, label, animated });

    // Phase 1: 准备阶段
    const P1 = 'preparation';
    allNodes.push(mkNode('arc-director', P1));
    allNodes.push(mkNode('episode-director', P1));
    allNodes.push(mkNode('continuity-guard', P1, {
      configParams: [{ key: 'maxContinuityRetries', label: '阻断重试次数', type: 'number', value: p.maxContinuityRetries, min: 0, max: 5, step: 1, description: '连续性阻断时回退重试的最大次数' }],
    }));
    edge('arc-director', 'episode-director');
    edge('episode-director', 'continuity-guard');

    // Phase 2: 编剧阶段
    const P2 = 'scripting';
    allNodes.push(mkNode('scriptwriter', P2));
    allNodes.push(mkNode('dialogue-coach', P2, {
      configParams: [{ key: 'enableDialogueCoach', label: '启用台词润色', type: 'boolean', value: p.enableDialogueCoach, description: '关闭后跳过台词润色步骤（降级安全节点）' }],
    }));
    edge('continuity-guard', 'scriptwriter');
    edge('scriptwriter', 'dialogue-coach');

    // Phase 3: 制作阶段
    const P3 = 'production';
    allNodes.push(mkNode('storyboard-director', P3));
    allNodes.push(mkNode('audio-director', P3));
    allNodes.push(mkNode('deterministic-checker', P3, { type: 'check' }));
    allNodes.push(mkNode('script-reviewer', P3));
    allNodes.push({
      id: 'review-gate', label: '精修判断', type: 'condition', isCore: false, isEnabled: true, phaseId: P3,
      condition: `overallVerdict in {"needs_edit","major_issues"} && overallScore < ${p.qualityPassScore} && round < ${p.maxEditRounds}`,
      configParams: [
        { key: 'qualityPassScore', label: '质量通过分数', type: 'number', value: p.qualityPassScore, min: 1, max: 10, step: 0.5, description: '总体评分低于该分数时，且 verdict 非 good 才触发精修' },
        { key: 'maxEditRounds', label: '精修最大轮数', type: 'number', value: p.maxEditRounds, min: 0, max: 5, step: 1, description: '精修循环的最大轮数' },
      ],
    });
    allNodes.push(mkNode('script-editor', P3));
    edge('dialogue-coach', 'storyboard-director');
    edge('storyboard-director', 'audio-director');
    edge('audio-director', 'deterministic-checker');
    edge('deterministic-checker', 'script-reviewer');
    edge('script-reviewer', 'review-gate');
    edge('review-gate', 'script-editor', 'conditional_true', '需要精修');
    edge('review-gate', 'pacing-analyzer', 'conditional_false', '跳过精修');
    edge('script-editor', 'script-reviewer', 'retry', '复审', true);

    // Phase 4: 后期阶段
    const P4 = 'post';
    allNodes.push(mkNode('pacing-analyzer', P4, {
      configParams: [{ key: 'enablePacingAnalyzer', label: '启用节奏分析', type: 'boolean', value: p.enablePacingAnalyzer, description: '关闭后跳过节奏分析步骤' }],
    }));
    allNodes.push(mkNode('hook-crafter', P4, {
      configParams: [{ key: 'enableHookCrafter', label: '启用悬念设计', type: 'boolean', value: p.enableHookCrafter, description: '关闭后跳过悬念设计步骤' }],
    }));
    allNodes.push(mkNode('episode-recorder', P4));
    edge('pacing-analyzer', 'hook-crafter');
    edge('hook-crafter', 'episode-recorder');

    const phases: WfPhase[] = [
      { id: P1, label: '准备阶段', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P1).map((n) => n.id) },
      { id: P2, label: '编剧阶段', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P2).map((n) => n.id) },
      { id: P3, label: '制作阶段', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P3).map((n) => n.id) },
      { id: P4, label: '后期阶段', type: 'sequential', nodeIds: allNodes.filter((n) => n.phaseId === P4).map((n) => n.id) },
    ];

    return { phases, nodes: allNodes, edges: allEdges, params: p };
  }
}
