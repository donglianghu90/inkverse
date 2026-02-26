import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { history, useParams } from '@umijs/max';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Clock,
  Save,
  Rocket,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getPipeline,
  savePipelineDraft,
  publishPipeline,
  getBook,
  type AgentNodeConfig,
  type PipelineView,
  type BookInfo,
} from '@/services/novel';
import { AgentNode, type AgentNodeData } from './nodes/AgentNode';
import { NodeEditPanel } from './panels/NodeEditPanel';

const NODE_TYPES = { agentNode: AgentNode };

function buildRFNodes(
  nodes: AgentNodeConfig[],
  selectedId: string | null,
  onDelete: (id: string) => void,
  onToggle: (id: string) => void,
): Node<AgentNodeData>[] {
  return nodes
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((n) => ({
      id: n.id,
      type: 'agentNode',
      position: n.rfPosition,
      data: { ...n, isSelected: n.id === selectedId, onDelete, onToggle },
      draggable: false,
    }));
}

function buildRFEdges(nodes: AgentNodeConfig[]): Edge[] {
  const sorted = nodes.slice().sort((a, b) => a.position - b.position);
  const edges: Edge[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const bothEnabled = sorted[i].isEnabled && sorted[i + 1].isEnabled;
    edges.push({
      id: `e-${sorted[i].id}-${sorted[i + 1].id}`,
      source: sorted[i].id,
      target: sorted[i + 1].id,
      type: 'smoothstep',
      animated: bothEnabled,
      style: {
        stroke: bothEnabled ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
        strokeWidth: bothEnabled ? 1.5 : 1,
        opacity: bothEnabled ? 0.6 : 0.2,
        strokeDasharray: bothEnabled ? undefined : '6 4',
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: bothEnabled ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' },
    });
  }
  return edges;
}

export default function PipelinePage() {
  const { bookId } = useParams<{ bookId: string }>();
  const [book, setBook] = useState<BookInfo | null>(null);
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [draftNodes, setDraftNodes] = useState<AgentNodeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => draftNodes.find((n) => n.id === selectedNodeId) ?? null,
    [draftNodes, selectedNodeId],
  );

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
    if (selectedNodeId === id) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const handleToggle = useCallback((id: string) => {
    setDraftNodes((prev) =>
      prev.map((n) => n.id === id ? { ...n, isEnabled: !n.isEnabled } : n),
    );
  }, []);

  const rfNodes = useMemo(
    () => buildRFNodes(draftNodes, selectedNodeId, handleDelete, handleToggle),
    [draftNodes, selectedNodeId, handleDelete, handleToggle],
  );
  const rfEdges = useMemo(() => buildRFEdges(draftNodes), [draftNodes]);

  const [nodes, , onNodesChange] = useNodesState(rfNodes);
  const [edges, , onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => {
    onNodesChange(rfNodes.map((n) => ({ type: 'reset', item: n })));
  }, [rfNodes]);

  useEffect(() => {
    onEdgesChange(rfEdges.map((e) => ({ type: 'reset', item: e })));
  }, [rfEdges]);

  useEffect(() => {
    if (!bookId) return;
    Promise.all([getBook(bookId), getPipeline(bookId)])
      .then(([b, p]) => {
        setBook(b);
        setPipeline(p);
        setDraftNodes(p.draftNodes);
      })
      .catch((e) => setError(e?.message ?? '加载失败'))
      .finally(() => setLoading(false));
  }, [bookId]);

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId((prev) => prev === node.id ? null : node.id);
  }, []);

  const handleNodeChange = useCallback((updated: AgentNodeConfig) => {
    setDraftNodes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
  }, []);

  const handleSaveDraft = async () => {
    if (!bookId) return;
    setSaving(true);
    try {
      const result = await savePipelineDraft(bookId, draftNodes);
      setPipeline(result);
      setDraftNodes(result.draftNodes);
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!bookId) return;
    setPublishing(true);
    try {
      await handleSaveDraft();
      const result = await publishPipeline(bookId);
      setPipeline(result);
      setDraftNodes(result.publishedNodes ?? result.draftNodes);
    } catch (e: any) {
      setError(e?.message ?? '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-57px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-57px)] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error}</p>
        <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col bg-background">
      {/* Top bar */}
      <div className="shrink-0 bg-card border-b">
        <div className="h-0.5 bg-gradient-to-r from-primary/60 via-cyan-400/40 to-transparent" />
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-b bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={() => history.push(`/novel/book/${bookId}`)}
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0">
            <span className="text-base font-bold tracking-tight">《{book?.title}》</span>
            <span className="ml-2 text-sm text-muted-foreground">Agent 工作流</span>
          </div>
          {isDirty && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              有未发布的修改
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pipeline?.publishedAt && (
            <div className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                生效版本：{new Date(pipeline.publishedAt).toLocaleString('zh-CN', {
                  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleSaveDraft}
            disabled={saving || !isDirty}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存草稿
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handlePublish}
            disabled={publishing || saving}
          >
            {publishing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Rocket className="h-3.5 w-3.5" />
            }
            发布并生效
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* ReactFlow canvas */}
        <div className="relative min-h-[360px] flex-1 lg:min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            minZoom={0.4}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--muted-foreground)/0.15)" />
            <Controls showInteractive={false} className="!border-border !bg-card !shadow-sm" />
          </ReactFlow>

          {/* Legend + hint */}
          <div className="absolute bottom-4 left-4 pointer-events-none">
            <div className="rounded-xl bg-card/85 backdrop-blur border px-4 py-3 shadow-sm space-y-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground/80">
                <Info className="h-3.5 w-3.5" />
                <span>图例</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[9px] font-bold">1</div>
                <span>核心节点（不可禁用）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-full bg-muted border flex items-center justify-center text-[9px] font-bold text-muted-foreground">2</div>
                <span>可选节点（可禁用/删除）</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-px w-5 bg-primary/60" />
                <span>活跃连线</span>
                <div className="h-px w-5 border-t border-dashed border-muted-foreground/40 ml-1" />
                <span>禁用连线</span>
              </div>
              {!selectedNodeId && (
                <p className="text-muted-foreground/70 pt-0.5">点击节点查看和编辑提示词</p>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        {selectedNode && (
          <div className="h-[50vh] w-full shrink-0 border-t bg-card flex flex-col overflow-hidden lg:h-auto lg:w-[340px] lg:border-l lg:border-t-0">
            <NodeEditPanel
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
              onChange={handleNodeChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
