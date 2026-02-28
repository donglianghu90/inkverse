import type { Node, Edge, MarkerType } from 'reactflow';
import type { WorkflowTopology, WfNode } from '@/services/novel';

const CENTER = 450;
const LEFT = 150;
const RIGHT = 750;

const ROW_AGENT = 135;
const ROW_CONTROL = 110;
const ROW_COMPACT = 90;
const PHASE_GAP = 40;
const PHASE_HEADER_H = 38;
const TOP_PAD = 25;

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

const MULTI_SRC = new Set(['conditionNode', 'parallelFork']);
const MULTI_TGT = new Set(['loopEntry', 'parallelJoin']);
const BYPASS = new Set(['polish-check→hook-crafter', 'content-changed→det-check-final']); // 右侧绕行的跳过边

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
  let y = TOP_PAD;

  const nodeCol = new Map<string, number>();
  const nodeY = new Map<string, number>();
  const nodeRfType = new Map<string, string>();

  const place = (id: string, col: number, yy: number, data: Record<string, unknown>, type: string) => {
    rfNodes.push({ id, type, position: { x: col - (NODE_W[type] ?? 240) / 2, y: yy }, data, draggable: true });
    nodeCol.set(id, col);
    nodeY.set(id, yy);
    nodeRfType.set(id, type);
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
      if (pathCheck) { place(pathCheck.id, CENTER, y, pathCheck, 'conditionNode'); y += ROW_CONTROL; }

      let leftY = y;
      for (const nid of ['scene-planner', 'creative-writer', 'scene-stitcher']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, LEFT, leftY, n, 'agentNode'); leftY += ROW_AGENT; }
      }
      const cw = findNode(topo, 'chapter-writer');
      if (cw) place(cw.id, RIGHT, y + ROW_AGENT * 0.5, cw, 'agentNode');

      y = leftY;
      for (const nid of ['det-check-loop', 'reviewer', 'quality-gate']) {
        const n = findNode(topo, nid);
        if (n) {
          place(n.id, CENTER, y, n, nodeType(n));
          y += n.type === 'agent' ? ROW_AGENT : ROW_CONTROL;
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
      // editor → hook-crafter 纵列排布在 CENTER，跳过边走右侧绕行，消除交叉
      for (const nid of ['editor', 'hook-crafter']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, CENTER, y, n, 'agentNode'); y += ROW_AGENT; }
      }
      // 终稿链全部 CENTER 纵列
      for (const nid of ['content-changed', 'final-review', 'score-compare', 'det-check-final']) {
        const n = findNode(topo, nid);
        if (n) { place(n.id, CENTER, y, n, nodeType(n)); y += n.type === 'agent' ? ROW_AGENT : ROW_CONTROL; }
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

  // ── 边路由：显式指定 handle 防止交叉 ──
  for (const e of topo.edges) {
    const style = EDGE_STYLE[e.type] ?? EDGE_STYLE.normal;
    const srcCol = nodeCol.get(e.source) ?? CENTER;
    const tgtCol = nodeCol.get(e.target) ?? CENTER;
    const srcType = nodeRfType.get(e.source);
    const tgtType = nodeRfType.get(e.target);
    const colDiff = tgtCol - srcCol;
    const key = `${e.source}→${e.target}`;

    let sourceHandle: string | undefined;
    let targetHandle: string | undefined;

    if (BYPASS.has(key)) { // 跳过边：右出右进，沿右侧绕行
      sourceHandle = 'right';
      targetHandle = 'right';
    } else if (e.type === 'retry') { // 回环边：右侧绕行
      sourceHandle = 'right';
      targetHandle = 'right';
    } else if (e.source === 'score-compare' && e.target === 'det-check-final' && e.type === 'conditional_false') {
      sourceHandle = 'left'; targetHandle = 'left'; // rollback 左出左进，与 true 边分离
    } else if (MULTI_SRC.has(srcType!)) { // 条件/Fork 出边
      sourceHandle = colDiff > 100 ? 'right' : colDiff < -100 ? 'left' : 'bottom';
    }

    if (!targetHandle && MULTI_TGT.has(tgtType!)) {
      if (e.type === 'retry') targetHandle = 'right';
      else targetHandle = colDiff > 100 ? 'left' : colDiff < -100 ? 'right' : 'top';
    }
    if (!targetHandle && tgtType === 'checkNode' && Math.abs(colDiff) > 100) { // 不同列汇入 checkNode → 侧向进入防交叉
      targetHandle = colDiff > 0 ? 'left' : 'right';
    }

    rfEdges.push({
      id: e.id, source: e.source, target: e.target, sourceHandle, targetHandle,
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
