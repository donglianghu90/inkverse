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
  addEdge,
  Connection,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Save,
  Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
    edges.push({
      id: `e-${sorted[i].id}-${sorted[i + 1].id}`,
      source: sorted[i].id,
      target: sorted[i + 1].id,
      type: 'smoothstep',
      animated: true,
      style: { stroke: 'hsl(var(--primary))', strokeWidth: 1.5, opacity: 0.6 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
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
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p>{error}</p>
        <Button variant="outline" onClick={() => history.push('/novel')}>返回书架</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b px-4 py-3 shrink-0 bg-card">
        <div className="flex items-center gap-3">
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
          <div>
            <span className="text-sm font-semibold">《{book?.title}》</span>
            <span className="text-sm text-muted-foreground ml-2">Agent 工作流</span>
          </div>
          {isDirty && (
            <Badge variant="secondary" className="text-xs gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              有未发布的修改
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pipeline?.publishedAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
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
      <div className="flex flex-1 overflow-hidden">
        {/* ReactFlow canvas */}
        <div className="flex-1 relative">
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

          {/* Click hint */}
          {!selectedNodeId && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="rounded-full bg-card/80 backdrop-blur border px-4 py-2 text-xs text-muted-foreground shadow-sm">
                点击节点查看和编辑提示词
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        {selectedNode && (
          <div className="w-80 border-l bg-card flex flex-col overflow-hidden shrink-0">
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
