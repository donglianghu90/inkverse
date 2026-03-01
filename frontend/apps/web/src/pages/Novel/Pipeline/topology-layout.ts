import type { Node, Edge, MarkerType } from 'reactflow';
import type { WorkflowTopology, WfNode } from '@/services/novel';
import { NODE_SIZE } from './node-shape-tokens';

const CENTER = 450;
const LEFT = 150;
const RIGHT = 750;

const ROW_AGENT = 160;
const ROW_CONTROL = 130;
const ROW_COMPACT = 105;
const PHASE_GAP = 55;
const PHASE_HEADER_H = 38;
const TOP_PAD = 25;

const NODE_W: Record<string, number> = Object.fromEntries(Object.entries(NODE_SIZE).map(([k, v]) => [k, v.w]));
const NODE_H: Record<string, number> = Object.fromEntries(Object.entries(NODE_SIZE).map(([k, v]) => [k, v.h]));

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
const EDGE_KEY = (source: string, target: string, type: string) => `${source}→${target}→${type}`;
const SIDE_COL_GAP = 120;
const SAME_ROW_GAP = 48;
const MAIN_FLOW = new Set([
  EDGE_KEY('arc-director', 'intent', 'normal'),
  EDGE_KEY('intent', 'continuity-guard', 'normal'),
  EDGE_KEY('continuity-guard', 'memory-check', 'normal'),
  EDGE_KEY('memory-check', 'loop-entry', 'conditional_false'),
  EDGE_KEY('memory-retrieval', 'loop-entry', 'normal'),
  EDGE_KEY('loop-entry', 'path-check', 'normal'),
  EDGE_KEY('path-check', 'chapter-writer', 'conditional_false'),
  EDGE_KEY('path-check', 'scene-planner', 'conditional_true'),
  EDGE_KEY('scene-planner', 'creative-writer', 'normal'),
  EDGE_KEY('creative-writer', 'scene-stitcher', 'normal'),
  EDGE_KEY('scene-stitcher', 'det-check-loop', 'normal'),
  EDGE_KEY('chapter-writer', 'det-check-loop', 'normal'),
  EDGE_KEY('det-check-loop', 'reviewer', 'normal'),
  EDGE_KEY('reviewer', 'quality-gate', 'normal'),
  EDGE_KEY('quality-gate', 'loop-exit', 'conditional_true'),
  EDGE_KEY('loop-exit', 'parallel-analysis-fork', 'normal'),
  EDGE_KEY('parallel-analysis-join', 'det-check-pre', 'normal'),
  EDGE_KEY('det-check-pre', 'polish-check', 'normal'),
  EDGE_KEY('hook-crafter', 'content-changed', 'normal'),
  EDGE_KEY('final-review', 'score-compare', 'normal'),
  EDGE_KEY('score-compare', 'det-check-final', 'conditional_true'),
  EDGE_KEY('det-check-final', 'recorder-fork', 'normal'),
]);

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
  const laneNodes: Node[] = [];
  const rfEdges: Edge[] = [];
  let y = TOP_PAD;
  const leftTargetUsed = new Set<string>();
  const rightTargetUsed = new Set<string>();
  const topTargetUsed = new Set<string>();
  const leftSourceUsed = new Set<string>();
  const rightSourceUsed = new Set<string>();
  const bottomSourceUsed = new Set<string>();

  const nodeCol = new Map<string, number>();
  const nodeY = new Map<string, number>();
  const nodeRfType = new Map<string, string>();

  const place = (id: string, col: number, yy: number, data: Record<string, unknown>, type: string) => {
    rfNodes.push({ id, type, position: { x: col - (NODE_W[type] ?? 240) / 2, y: yy }, data, draggable: true });
    nodeCol.set(id, col);
    nodeY.set(id, yy);
    nodeRfType.set(id, type);
  };
  const centerY = (id: string) => {
    const yy = nodeY.get(id) ?? 0;
    const t = nodeRfType.get(id) ?? 'agentNode';
    return yy + (NODE_H[t] ?? 80) / 2;
  };

  for (const phase of topo.phases) {
    y += PHASE_GAP;
    const phaseHeaderY = y;
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
      if (cw) place(cw.id, RIGHT, y + ROW_AGENT * 2, cw, 'agentNode');

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

    const lanePaddingTop = 14;
    const lanePaddingBottom = 18;
    const laneTopY = phaseHeaderY - lanePaddingTop;
    const laneH = Math.max(80, y - phaseHeaderY + lanePaddingTop + lanePaddingBottom);
    laneNodes.push({
      id: `lane-${phase.id}`,
      type: 'phaseLane',
      position: { x: CENTER - 470, y: laneTopY },
      data: { phaseId: phase.id, height: laneH },
      draggable: false,
      selectable: false,
      focusable: false,
      style: { zIndex: -1 },
    });
  }

  // ── 自动对齐：左右双路汇入中间检查/条件节点时，尽量与两侧来源同一水平线 ──
  for (const n of rfNodes) {
    if (!(n.type === 'checkNode' || n.type === 'conditionNode')) continue;
    const targetCol = nodeCol.get(n.id) ?? CENTER;
    if (Math.abs(targetCol - CENTER) > 50) continue;
    const incoming = topo.edges.filter((e) => e.target === n.id);
    if (incoming.length < 2) continue;

    const centers: number[] = [];
    let hasLeft = false;
    let hasRight = false;
    for (const e of incoming) {
      const sCol = nodeCol.get(e.source) ?? CENTER;
      centers.push(centerY(e.source));
      if (sCol < CENTER - 120) hasLeft = true;
      if (sCol > CENTER + 120) hasRight = true;
    }
    if (!(hasLeft && hasRight) || centers.length < 2) continue;

    // 两侧来源 Y 足够接近时，目标节点贴齐该水平线，减少折返与并线错觉
    const minY = Math.min(...centers);
    const maxY = Math.max(...centers);
    if (maxY - minY <= ROW_AGENT * 0.4) {
      const targetType = nodeRfType.get(n.id) ?? 'agentNode';
      const targetH = NODE_H[targetType] ?? 80;
      const alignedCenterY = Math.round((minY + maxY) / 2);
      const alignedTopY = Math.round(alignedCenterY - targetH / 2);
      n.position.y = alignedTopY;
      nodeY.set(n.id, alignedTopY);
    }
  }

  // ── 边路由：显式指定 handle 防止交叉 ──
  const mergeFromBothSides = new Set<string>();
  const edgeGroupCounts = new Map<string, number>();
  const edgeGroupSeen = new Map<string, number>();
  for (const n of rfNodes) {
    if (!(n.type === 'checkNode' || n.type === 'conditionNode' || n.type === 'parallelJoin' || n.type === 'loopEntry')) continue;
    let hasLeft = false;
    let hasRight = false;
    for (const e of topo.edges) {
      if (e.target !== n.id) continue;
      const sCol = nodeCol.get(e.source) ?? CENTER;
      if (sCol < CENTER - SIDE_COL_GAP) hasLeft = true;
      if (sCol > CENTER + SIDE_COL_GAP) hasRight = true;
    }
    if (hasLeft && hasRight) mergeFromBothSides.add(n.id);
  }
  for (const e of topo.edges) {
    const pair = `${e.source}→${e.target}`;
    edgeGroupCounts.set(pair, (edgeGroupCounts.get(pair) ?? 0) + 1);
  }

  for (const e of topo.edges) {
    const style = EDGE_STYLE[e.type] ?? EDGE_STYLE.normal;
    const labelColor = e.type === 'conditional_true'
      ? 'hsl(142 71% 35%)'
      : e.type === 'retry'
        ? 'hsl(262 83% 45%)'
        : e.type === 'rollback'
          ? 'hsl(25 95% 45%)'
          : e.type === 'conditional_false'
            ? 'hsl(var(--muted-foreground))'
            : 'hsl(var(--muted-foreground))';
    const srcCol = nodeCol.get(e.source) ?? CENTER;
    const tgtCol = nodeCol.get(e.target) ?? CENTER;
    const srcType = nodeRfType.get(e.source);
    const tgtType = nodeRfType.get(e.target);
    const colDiff = tgtCol - srcCol;
    const key = `${e.source}→${e.target}`;
    const groupCount = edgeGroupCounts.get(key) ?? 1;
    const groupIndex = edgeGroupSeen.get(key) ?? 0;
    edgeGroupSeen.set(key, groupIndex + 1);
    const isMainFlow = MAIN_FLOW.has(EDGE_KEY(e.source, e.target, e.type));

    let sourceHandle: string | undefined;
    let targetHandle: string | undefined;
    const dy = centerY(e.target) - centerY(e.source);
    const absDx = Math.abs(colDiff);
    const absDy = Math.abs(dy);
    const srcSide = colDiff > 0 ? 'right' : 'left';
    const tgtSide = colDiff > 0 ? 'left' : 'right';
    const useSourceSide = (side: 'left' | 'right') => (srcType === 'agentNode' ? `source-${side}` : side);

    if (BYPASS.has(key)) { // 跳过边：右出右进，沿右侧绕行
      sourceHandle = useSourceSide('right');
      targetHandle = 'right';
    } else if (e.type === 'retry') { // 回环边：左侧大偏移绕行，避免与右侧分支交叉
      sourceHandle = useSourceSide('left');
      targetHandle = 'left';
    } else if (e.source === 'score-compare' && e.target === 'det-check-final' && e.type === 'rollback') {
      sourceHandle = useSourceSide('left'); targetHandle = 'left'; // rollback 左出左进，与 true 边分离
    } else if (srcType === 'conditionNode') { // 条件节点出线固定语义：true 右出，false 左出
      sourceHandle = e.type === 'conditional_true'
        ? 'right'
        : e.type === 'conditional_false'
          ? 'left'
          : (colDiff > SIDE_COL_GAP ? 'right' : colDiff < -SIDE_COL_GAP ? 'left' : 'bottom');
    } else if (MULTI_SRC.has(srcType!)) { // 其余多出口节点按列差
      sourceHandle = colDiff > SIDE_COL_GAP ? useSourceSide('right') : colDiff < -SIDE_COL_GAP ? useSourceSide('left') : 'bottom';
    } else if (absDx > SIDE_COL_GAP && absDy <= SAME_ROW_GAP) { // 同层横连：side->side
      sourceHandle = useSourceSide(srcSide);
    }

    if (!targetHandle && mergeFromBothSides.has(e.target) && absDx > SIDE_COL_GAP) { // 双侧汇入目标：按来源侧进入
      if (!sourceHandle) sourceHandle = useSourceSide(srcSide);
      targetHandle = tgtSide;
    } else if (!targetHandle && !MULTI_TGT.has(tgtType!) && absDx > SIDE_COL_GAP && absDy <= SAME_ROW_GAP) { // 同层横连
      if (!sourceHandle) sourceHandle = useSourceSide(srcSide);
      targetHandle = tgtSide;
    }

    if (!targetHandle && MULTI_TGT.has(tgtType!)) {
      targetHandle = colDiff > SIDE_COL_GAP ? 'left' : colDiff < -SIDE_COL_GAP ? 'right' : 'top';
    }

    const resolvedTarget = targetHandle ?? 'top';
    const resolvedSource = sourceHandle ?? 'bottom';
    if (resolvedTarget === 'left') leftTargetUsed.add(e.target);
    if (resolvedTarget === 'right') rightTargetUsed.add(e.target);
    if (resolvedTarget === 'top') topTargetUsed.add(e.target);
    if (resolvedSource === 'left' || resolvedSource === 'source-left') leftSourceUsed.add(e.source);
    if (resolvedSource === 'right' || resolvedSource === 'source-right') rightSourceUsed.add(e.source);
    if (resolvedSource === 'bottom') bottomSourceUsed.add(e.source);

    if (key === 'reviewer→quality-gate') {
      sourceHandle = 'bottom';
      targetHandle = 'top';
    }

    const isSideToSide = (sourceHandle === 'left' || sourceHandle === 'right' || sourceHandle === 'source-left' || sourceHandle === 'source-right')
      && (targetHandle === 'left' || targetHandle === 'right');
    const isNearHorizontal = absDy <= 10;
    const edgeType = key === 'det-check-loop→reviewer' || key === 'reviewer→quality-gate' || (isSideToSide && isNearHorizontal && e.type !== 'retry')
      ? 'straight'
      : e.type === 'retry'
        ? 'retryEdge'
        : 'smoothstep';
    const isDetCheckLoopSideIn = key === 'scene-stitcher→det-check-loop' || key === 'chapter-writer→det-check-loop';
    const isStraightEdge = edgeType === 'straight';
    const strokeWidth = isMainFlow
      ? Math.max(style.strokeWidth, isStraightEdge ? 2.0 : 1.9)
      : (isStraightEdge ? Math.max(style.strokeWidth, 1.4) : style.strokeWidth);
    const edgeOpacity = isMainFlow
      ? Math.max(style.opacity, 0.78)
      : (isStraightEdge ? Math.max(style.opacity * 0.92, 0.53) : Math.max(style.opacity * 0.92, 0.3));
    const labelYOffset = groupCount > 1 ? (groupIndex - (groupCount - 1) / 2) * 16 : 0;
    const labelXOffset = groupCount > 1 ? (groupIndex % 2 === 0 ? -4 : 4) : 0;

    rfEdges.push({
      id: e.id, source: e.source, target: e.target, sourceHandle, targetHandle,
      className: isMainFlow ? 'edge-main-flow' : undefined,
      type: edgeType,
      pathOptions: edgeType === 'smoothstep'
        ? (isDetCheckLoopSideIn ? { borderRadius: 8, offset: 10 } : { borderRadius: 10, offset: 18 })
        : undefined,
      animated: e.animated ?? e.type === 'retry',
      label: e.label,
      labelShowBg: !!e.label,
      labelBgPadding: [8, 4],
      labelBgBorderRadius: 6,
      labelStyle: {
        fontSize: 10,
        fill: labelColor,
        fontWeight: 500,
        lineHeight: '14px',
        transform: `translate(${labelXOffset}px, ${labelYOffset}px)`,
      },
      labelBgStyle: { fill: 'hsl(var(--background))', fillOpacity: 0.9 },
      style: {
        stroke: style.stroke,
        strokeWidth,
        strokeDasharray: style.strokeDasharray,
        opacity: edgeOpacity,
      },
      markerEnd: {
        type: 'arrowclosed' as MarkerType,
        color: style.stroke,
        width: isMainFlow ? 22 : 18,
        height: isMainFlow ? 22 : 18,
      },
    });
  }

  for (const n of rfNodes) {
    if (n.type !== 'phaseHeader') {
      n.data = {
        ...(n.data as Record<string, unknown>),
        showTopHandle: topTargetUsed.has(n.id),
        showLeftHandle: leftTargetUsed.has(n.id),
        showRightHandle: rightTargetUsed.has(n.id),
        showBottomSourceHandle: bottomSourceUsed.has(n.id),
        showLeftSourceHandle: leftSourceUsed.has(n.id),
        showRightSourceHandle: rightSourceUsed.has(n.id),
      };
    }
  }

  return { nodes: [...laneNodes, ...rfNodes], edges: rfEdges };
}
