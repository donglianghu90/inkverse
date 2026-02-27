import type { Node, Edge, MarkerType } from 'reactflow';
import type { WorkflowTopology, WfNode } from '@/services/novel';

const CENTER = 450; // 中心列视觉中点
const LEFT = 140;   // 左列视觉中点
const RIGHT = 760;  // 右列视觉中点

const ROW_AGENT = 170;
const ROW_CONTROL = 150;
const ROW_COMPACT = 130;
const PHASE_GAP = 70;
const PHASE_HEADER_H = 55;

const NODE_W: Record<string, number> = {
  agentNode: 256, conditionNode: 200, checkNode: 224,
  parallelFork: 208, parallelJoin: 208,
  loopEntry: 240, loopExit: 240, phaseHeader: 220,
};

const EDGE_STYLE: Record<string, { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity: number }> = {
  normal:            { stroke: 'hsl(var(--primary))', strokeWidth: 1.5, opacity: 0.6 },
  conditional_true:  { stroke: 'hsl(142 71% 45%)', strokeWidth: 1.5, opacity: 0.7 },
  conditional_false: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '6 4', opacity: 0.4 },
  retry:             { stroke: 'hsl(262 83% 58%)', strokeWidth: 2, strokeDasharray: '4 3', opacity: 0.7 },
  rollback:          { stroke: 'hsl(25 95% 53%)', strokeWidth: 1.5, strokeDasharray: '6 3', opacity: 0.6 },
  parallel:          { stroke: 'hsl(172 66% 50%)', strokeWidth: 1.5, opacity: 0.5 },
};

function nodeType(n: WfNode): string {
  const map: Record<string, string> = {
    agent: 'agentNode', condition: 'conditionNode', check: 'checkNode',
    parallel_fork: 'parallelFork', parallel_join: 'parallelJoin',
    loop_entry: 'loopEntry', loop_exit: 'loopExit', phase_header: 'phaseHeader',
  };
  return map[n.type] ?? 'agentNode';
}

function findNode(topo: WorkflowTopology, id: string) { return topo.nodes.find((nd) => nd.id === id); }

export function buildLayout(topo: WorkflowTopology): { nodes: Node[]; edges: Edge[] } {
  const rfNodes: Node[] = [];
  const rfEdges: Edge[] = [];
  let y = 0;

  const place = (id: string, col: number, yy: number, data: Record<string, unknown>, type: string) => {
    rfNodes.push({ id, type, position: { x: col - (NODE_W[type] ?? 240) / 2, y: yy }, data, draggable: true });
  };

  for (const phase of topo.phases) {
    y += PHASE_GAP;
    place(`ph-${phase.id}`, CENTER, y, { label: phase.label, phaseId: phase.id }, 'phaseHeader');
    y += PHASE_HEADER_H;

    if (phase.id === 'preparation') {
      for (const nid of ['arc-director', 'intent', 'continuity-guard']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, CENTER, y, n, nodeType(n)); y += ROW_AGENT; }
      }
      const memCheck = findNode(topo, 'memory-check');
      if (memCheck) place(memCheck.id, CENTER, y, memCheck, 'conditionNode');
      const memRet = findNode(topo, 'memory-retrieval');
      if (memRet) place(memRet.id, RIGHT, y, memRet, 'agentNode');
      y += ROW_CONTROL;
    }

    if (phase.id === 'quality_loop') {
      const loopEntry = findNode(topo, 'loop-entry');
      if (loopEntry) { place(loopEntry.id, CENTER, y, loopEntry, 'loopEntry'); y += ROW_CONTROL; }

      const pathCheck = findNode(topo, 'path-check');
      if (pathCheck) { place(pathCheck.id, CENTER, y, pathCheck, 'conditionNode'); y += ROW_CONTROL + 20; }

      let leftY = y;
      for (const nid of ['scene-planner', 'creative-writer', 'scene-stitcher']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, LEFT, leftY, n, 'agentNode'); leftY += ROW_AGENT; }
      }
      const cw = findNode(topo, 'chapter-writer');
      if (cw) place(cw.id, RIGHT, y + ROW_AGENT * 0.6, cw, 'agentNode');

      y = leftY + 20;
      for (const nid of ['det-check-loop', 'reviewer', 'quality-gate']) {
        const n = findNode(topo, nid);
        if (n) {
          const gap = n.type === 'agent' ? ROW_AGENT : ROW_CONTROL;
          place(n.id, CENTER, y, n, nodeType(n));
          y += gap;
        }
      }
      const loopExit = findNode(topo, 'loop-exit');
      if (loopExit) { place(loopExit.id, CENTER, y, loopExit, 'loopExit'); y += ROW_COMPACT; }
    }

    if (phase.id === 'post_process') {
      const fork = findNode(topo, 'parallel-analysis-fork');
      if (fork) { place(fork.id, CENTER, y, fork, 'parallelFork'); y += ROW_COMPACT; }

      const vc = findNode(topo, 'character-voice-coach');
      const pa = findNode(topo, 'pacing-analyzer');
      if (vc) place(vc.id, LEFT, y, vc, 'agentNode');
      if (pa) place(pa.id, RIGHT, y, pa, 'agentNode');
      y += ROW_AGENT;

      const join = findNode(topo, 'parallel-analysis-join');
      if (join) { place(join.id, CENTER, y, join, 'parallelJoin'); y += ROW_COMPACT; }

      for (const nid of ['det-check-pre', 'polish-check']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, CENTER, y, n, nodeType(n)); y += ROW_CONTROL; }
      }

      const ed = findNode(topo, 'editor');
      if (ed) place(ed.id, LEFT, y, ed, 'agentNode');
      const hc = findNode(topo, 'hook-crafter');
      if (hc) place(hc.id, RIGHT, y, hc, 'agentNode');
      y += ROW_AGENT;

      for (const nid of ['content-changed', 'final-review', 'score-compare', 'det-check-final']) {
        const n = findNode(topo, nid);
        if (n) {
          const gap = n.type === 'agent' ? ROW_AGENT : ROW_CONTROL;
          place(n.id, CENTER, y, n, nodeType(n));
          y += gap;
        }
      }
    }

    if (phase.id === 'recording') {
      const fork = findNode(topo, 'recorder-fork');
      if (fork) { place(fork.id, CENTER, y, fork, 'parallelFork'); y += ROW_COMPACT; }

      const ta = findNode(topo, 'text-analyzer');
      const we = findNode(topo, 'world-extractor');
      const ne = findNode(topo, 'narrative-extractor');
      if (ta) place(ta.id, LEFT, y, ta, 'agentNode');
      if (we) place(we.id, CENTER, y, we, 'agentNode');
      if (ne) place(ne.id, RIGHT, y, ne, 'agentNode');
      y += ROW_AGENT;

      const join = findNode(topo, 'recorder-join');
      if (join) place(join.id, CENTER, y, join, 'parallelJoin');
    }
  }

  for (const e of topo.edges) {
    const style = EDGE_STYLE[e.type] ?? EDGE_STYLE.normal;
    rfEdges.push({
      id: e.id, source: e.source, target: e.target,
      type: 'smoothstep',
      animated: e.animated ?? e.type === 'retry',
      label: e.label,
      labelStyle: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' },
      labelBgStyle: { fill: 'hsl(var(--background))', fillOpacity: 0.8 },
      style: { stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDasharray: style.strokeDasharray, opacity: style.opacity },
      markerEnd: { type: 'arrowclosed' as MarkerType, color: style.stroke },
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}
