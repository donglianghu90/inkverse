import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { history, useParams } from '@umijs/max';
import ReactFlow, { Node, Edge, Controls, Background, BackgroundVariant, SmoothStepEdge, type NodeChange, type EdgeProps, applyNodeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import './pipeline.css';
import { ArrowLeft, Loader2, AlertCircle, Clock, Save, Rocket, Info, Play, Square, History, BookOpen, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getPipeline, savePipelineDraft, publishPipeline, getBook, getTopology, saveWorkflowParams,
  type AgentNodeConfig, type PipelineView, type BookInfo, type WorkflowTopology,
} from '@/services/novel';
import { AgentNode } from './nodes/AgentNode';
import { ConditionNode } from './nodes/ConditionNode';
import { CheckNode } from './nodes/CheckNode';
import { LoopEntryNode, LoopExitNode } from './nodes/LoopGroupNode';
import { ParallelForkNode, ParallelJoinNode } from './nodes/ParallelNode';
import { PhaseHeader } from './nodes/PhaseHeader';
import { PhaseLane } from './nodes/PhaseLane';
import { NodeEditPanel } from './panels/NodeEditPanel';
import { ConditionEditPanel } from './panels/ConditionEditPanel';
import { ExecutionPanel } from './panels/ExecutionPanel';
import { PlaybookPanel } from './panels/PlaybookPanel';
import { buildLayout } from './topology-layout';
import { useWorkflowProgress } from './hooks/useWorkflowProgress';
import { useExecutionReplay } from './hooks/useExecutionReplay';

const NODE_TYPES = {
  agentNode: AgentNode, conditionNode: ConditionNode, checkNode: CheckNode,
  loopEntry: LoopEntryNode, loopExit: LoopExitNode,
  parallelFork: ParallelForkNode, parallelJoin: ParallelJoinNode, phaseHeader: PhaseHeader, phaseLane: PhaseLane,
};
const RetryEdge = (props: EdgeProps) => <SmoothStepEdge {...props} pathOptions={{ offset: 400, borderRadius: 8 }} />;
const EDGE_TYPES = { retryEdge: RetryEdge };

export default function PipelinePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [topology, setTopology] = useState<WorkflowTopology | null>(null);
  const [draftNodes, setDraftNodes] = useState<AgentNodeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const progress = useWorkflowProgress(bookId);
  const replay = useExecutionReplay(bookId);
  const [showExecPanel, setShowExecPanel] = useState(false);
  const [showPlaybookPanel, setShowPlaybookPanel] = useState(false);

  const EMPTY_STATES = useRef<Record<string, never>>({}).current;
  const activeNodeStates = useMemo(
    () => progress.isRunning ? progress.nodeStates : replay.currentExec ? replay.nodeStates : EMPTY_STATES,
    [progress.isRunning, progress.nodeStates, replay.currentExec, replay.nodeStates, EMPTY_STATES],
  );
  const selectedAgentNode = useMemo(() => draftNodes.find((n) => n.id === selectedNodeId) ?? null, [draftNodes, selectedNodeId]);
  const selectedWfNode = useMemo(() => topology?.nodes.find((n) => n.id === selectedNodeId) ?? null, [topology, selectedNodeId]);
  const selectedType = selectedWfNode?.type;

  const isDirty = useMemo(() => {
    if (!pipeline) return false;
    return JSON.stringify(draftNodes) !== JSON.stringify(pipeline.publishedNodes ?? pipeline.draftNodes);
  }, [draftNodes, pipeline]);

  const handleDelete = useCallback((id: string) => {
    setDraftNodes((prev) => {
      const node = prev.find((n) => n.id === id);
      if (!node?.isDeletable) return prev;
      return prev.filter((n) => n.id !== id).map((n, i) => ({ ...n, position: i }));
    });
    setSelectedNodeId((prev) => prev === id ? null : prev);
  }, []);

  const handleToggle = useCallback((id: string) => {
    setDraftNodes((prev) => prev.map((n) => n.id === id ? { ...n, isEnabled: !n.isEnabled } : n));
  }, []);

  const computedLayout = useMemo(() => {
    if (!topology) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildLayout(topology);
  }, [topology]);

  const rfNodes = useMemo(() => {
    return computedLayout.nodes.map((n) => {
      const ns = activeNodeStates[n.id];
      const statusData = ns ? { status: ns.status, statusMessage: ns.message, durationMs: ns.durationMs } : {};
      if (n.type === 'agentNode') {
        const agentCfg = draftNodes.find((d) => d.id === n.id);
        if (agentCfg) return { ...n, draggable: true, data: { ...agentCfg, ...n.data, ...statusData, isSelected: n.id === selectedNodeId, onDelete: handleDelete, onToggle: handleToggle } };
      }
      return { ...n, draggable: true, data: { ...n.data, ...statusData } };
    });
  }, [computedLayout.nodes, draftNodes, selectedNodeId, handleDelete, handleToggle, activeNodeStates]);

  const rfEdges = useMemo(() => computedLayout.edges, [computedLayout.edges]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const layoutVersion = useRef(0);

  useEffect(() => {
    layoutVersion.current += 1;
    setNodes(rfNodes);
  }, [rfNodes]);

  useEffect(() => { setEdges(rfEdges); }, [rfEdges]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, []);

  useEffect(() => {
    if (!bookId) return;
    Promise.all([getBook(bookId), getPipeline(bookId), getTopology(bookId)])
      .then(([b, p, t]) => { setBook(b); setPipeline(p); setDraftNodes(p.draftNodes); setTopology(t); })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [bookId]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => prev === node.id ? null : node.id);
  }, []);

  const handleNodeChange = useCallback((updated: AgentNodeConfig) => {
    setDraftNodes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  }, []);

  const handleParamSave = useCallback(async (key: string, value: number) => {
    if (!bookId) return;
    const result = await saveWorkflowParams(bookId, { [key]: value });
    setPipeline(result);
    const t = await getTopology(bookId);
    setTopology(t);
  }, [bookId]);

  const handleSaveDraft = async () => {
    if (!bookId) return;
    setSaving(true);
    try {
      const result = await savePipelineDraft(bookId, draftNodes);
      setPipeline(result); setDraftNodes(result.draftNodes);
      const t = await getTopology(bookId);
      setTopology(t);
    } catch (e: any) { setError(e?.message ?? '保存失败'); } finally { setSaving(false); }
  };

  const handlePublish = async () => {
    if (!bookId) return;
    setPublishing(true);
    try {
      await handleSaveDraft();
      const result = await publishPipeline(bookId);
      setPipeline(result); setDraftNodes(result.publishedNodes ?? result.draftNodes);
      const t = await getTopology(bookId);
      setTopology(t);
    } catch (e: any) { setError(e?.message ?? '发布失败'); } finally { setPublishing(false); }
  };

  if (loading) return <div className="flex h-[calc(100vh-57px)] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (error) return (
    <div className="flex h-[calc(100vh-57px)] flex-col items-center justify-center gap-3 text-muted-foreground">
      <AlertCircle className="h-10 w-10" /><p>{error}</p>
      <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col bg-background">
      <div className="shrink-0 bg-card border-b"><div className="h-0.5 bg-gradient-to-r from-primary/60 via-cyan-400/40 to-transparent" /></div>
      <div className="flex shrink-0 flex-col gap-3 border-b bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => history.push(`/novel/book/${bookId}`)}>
            <ArrowLeft className="h-4 w-4" />返回
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0">
            <span className="text-base font-bold tracking-tight">《{book?.title}》</span>
            <span className="ml-2 text-sm text-muted-foreground">Agent 工作流</span>
          </div>
          {isDirty && <Badge variant="secondary" className="gap-1 text-xs"><div className="h-1.5 w-1.5 rounded-full bg-amber-500" />有未发布的修改</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pipeline?.publishedAt && (
            <div className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>生效版本：{new Date(pipeline.publishedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}
          {progress.isRunning ? (
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={progress.stopListening}>
              <Square className="h-3.5 w-3.5" />停止监听
            </Button>
          ) : progress.isIdle ? (
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => progress.resetStates()}>
              <Radio className="h-3.5 w-3.5" />当前无生成任务
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { progress.resetStates(); progress.startListening(); }}>
              <Play className="h-3.5 w-3.5" />实时监听
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { replay.loadExecutions(); setShowExecPanel(true); setShowPlaybookPanel(false); }}>
            <History className="h-3.5 w-3.5" />执行历史
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setShowPlaybookPanel(true); setShowExecPanel(false); setSelectedNodeId(null); }}>
            <BookOpen className="h-3.5 w-3.5" />写作规则
          </Button>
          <div className="h-4 w-px bg-border" />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSaveDraft} disabled={saving || !isDirty}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存草稿
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handlePublish} disabled={publishing || saving}>
            {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}发布并生效
          </Button>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="relative min-h-[360px] flex-1 lg:min-h-0">
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={handleNodesChange}
            onNodeClick={handleNodeClick} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
            fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.15} maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground)/0.15)" />
            <Controls showInteractive={false} className="!border-border !bg-card !shadow-sm" />
          </ReactFlow>
          <div className="absolute bottom-4 left-4 pointer-events-none">
            <div className="rounded-xl bg-card/90 backdrop-blur-sm border px-4 py-3 shadow-md space-y-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2 font-semibold text-foreground/80"><Info className="h-3.5 w-3.5" /><span>图例</span></div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-8 rounded border bg-card shadow-sm overflow-hidden"><div className="h-0.5 bg-blue-400" /></div>
                <span>Agent 节点</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16"><path d="M8 1 L15 8 L8 15 L1 8 Z" className="fill-amber-50 dark:fill-amber-950/40 stroke-amber-400" strokeWidth="1.5" /></svg>
                <span>条件判断</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="h-4 w-5 shrink-0" viewBox="0 0 20 16" fill="none"><path d="M4 1 L16 1 L19 8 L16 15 L4 15 L1 8Z" className="fill-sky-50 dark:fill-sky-950/40 stroke-sky-400" strokeWidth="1.5" strokeLinejoin="round" /></svg>
                <span>确定性检查</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-4 w-7 rounded-full border border-violet-400/40 bg-violet-50/60 dark:bg-violet-950/20" />
                <span>循环节点</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-10 h-3 rounded-sm border border-teal-400/40 bg-gradient-to-r from-transparent via-teal-400/35 to-transparent" />
                <span>并行同步条</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-px w-4 bg-emerald-500" /><span>通过</span>
                <div className="h-px w-4 border-t border-dashed border-muted-foreground/40" /><span>跳过</span>
                <div className="h-px w-4 bg-violet-500" /><span>重写</span>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="px-1 rounded border border-border/50 bg-background/70">条件左=否</span>
                <span className="px-1 rounded border border-emerald-400/40 bg-background/70 text-emerald-600/90">条件右=是</span>
              </div>
              {!selectedNodeId && <p className="text-muted-foreground/60 pt-0.5 text-[10px]">点击节点查看详情和编辑</p>}
            </div>
          </div>
        </div>

        {selectedAgentNode && selectedType === 'agent' && (
          <div className="h-[50vh] w-full shrink-0 border-t bg-card flex flex-col overflow-hidden lg:h-auto lg:w-[340px] lg:border-l lg:border-t-0">
            <NodeEditPanel node={selectedAgentNode} onClose={() => setSelectedNodeId(null)} onChange={handleNodeChange} />
          </div>
        )}
        {selectedWfNode && (selectedType === 'condition' || selectedType === 'loop_entry') && selectedWfNode.configParams?.length && (
          <div className="h-[50vh] w-full shrink-0 border-t bg-card flex flex-col overflow-hidden lg:h-auto lg:w-[340px] lg:border-l lg:border-t-0">
            <ConditionEditPanel node={selectedWfNode} onClose={() => setSelectedNodeId(null)} onSave={handleParamSave} />
          </div>
        )}
        {showExecPanel && !selectedNodeId && (
          <div className="h-[50vh] w-full shrink-0 border-t bg-card flex flex-col overflow-hidden lg:h-auto lg:w-[340px] lg:border-l lg:border-t-0">
            <ExecutionPanel executions={replay.executions} currentExec={replay.currentExec} loading={replay.loading} onSelect={replay.selectExecution} onClear={() => { replay.clearReplay(); setShowExecPanel(false); }} />
          </div>
        )}
        {showPlaybookPanel && !selectedNodeId && bookId && (
          <div className="h-[50vh] w-full shrink-0 border-t bg-card flex flex-col overflow-hidden lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
            <PlaybookPanel bookId={bookId} onClose={() => setShowPlaybookPanel(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
