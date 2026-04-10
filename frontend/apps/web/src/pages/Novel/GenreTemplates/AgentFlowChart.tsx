/**
 * AgentFlowChart — 短剧 Agent Pipeline 可视化流程图
 * 展示 Agent 之间的数据流转关系，点击节点可编辑系统提示词
 */
import React, { useState } from 'react';
import { Bot, Save, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { updateDramaAgentPrompt, type DramaGenreTemplate, listDramaSystemAgents } from '@/services/drama';
import { message } from 'antd';

/* ─── 类型定义 ─── */
interface AgentNode {
  id: string;
  name: string;
  desc: string;
  phase: 'creation' | 'scripting' | 'production' | 'monitor';
  cx: number; // center x
  cy: number; // center y
}
interface AgentEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  path?: string; // 自定义 SVG path（用于曲线/回环）
}
interface AgentFlowChartProps {
  tplId: string;
  agentPrompts: Record<string, string>;
  originalAgentPrompts: Record<string, string>;
  onPromptsChanged: (newPrompts: Record<string, string>, newOriginal?: Record<string, string>) => void;
}

/* ─── 节点/边定义 ─── */
const NW = 136; // node width
const NH = 62;  // node height
const NW2 = NW / 2;
const NH2 = NH / 2;

// ── 创建阶段 ──
const CREATION_NODES: AgentNode[] = [
  { id: 'seed-analyzer',        name: '编剧手册',     desc: '分析素材种子与爽感红线', phase: 'creation', cx: 78,  cy: 70 },
  { id: 'series-director',      name: '总导演',       desc: '规划全剧大纲与段落结构', phase: 'creation', cx: 258, cy: 70 },
  { id: 'visual-asset-designer',name: '视觉资产设计', desc: '设计人物与场景总体视觉',  phase: 'creation', cx: 438, cy: 70 },
  { id: 'drama-profiler',       name: '创意分析师',   desc: '建立世界观与人物档案',   phase: 'creation', cx: 618, cy: 70 },
  { id: 'drama-strategy',       name: '短剧策略师',   desc: '定义节奏、爽点与付费策略',phase: 'creation', cx: 798, cy: 70 },
];
const CREATION_EDGES: AgentEdge[] = [
  { from: 'seed-analyzer', to: 'series-director' },
  { from: 'series-director', to: 'visual-asset-designer' },
  { from: 'visual-asset-designer', to: 'drama-profiler' },
  { from: 'drama-profiler', to: 'drama-strategy' },
];

// ── 集生成阶段 ──
// 布局: 中心纵轴(cx=350), 编剧左列(cx=120), 制作右列(cx=580), 监控最右(cx=800)
const EPISODE_NODES: AgentNode[] = [
  // 中轴
  { id: 'arc-director',        name: '段落导演',     desc: '把控段落情绪弧',            phase: 'scripting',  cx: 350, cy: 52  },
  { id: 'episode-director',    name: '分集执行导演', desc: '分配镜头与画面构成',        phase: 'scripting',  cx: 350, cy: 152 },
  // 编剧左列
  { id: 'scriptwriter',        name: '主笔编剧',     desc: '扩写单集剧本与场景',        phase: 'scripting',  cx: 120, cy: 282 },
  { id: 'dialogue-coach',      name: '台词教练',     desc: '优化角色对白与气口',        phase: 'scripting',  cx: 120, cy: 382 },
  { id: 'script-reviewer',     name: '剧本审评员',   desc: '审核剧本质量并打分',        phase: 'scripting',  cx: 120, cy: 482 },
  { id: 'script-editor',       name: '剧本润色员',   desc: '修正不达标内容直到过审',    phase: 'scripting',  cx: 120, cy: 582 },
  // 制作右列
  { id: 'storyboard-director', name: '分镜导演',     desc: '撰写 T2I 视觉提示词',       phase: 'production', cx: 580, cy: 282 },
  { id: 'audio-director',      name: '音频导演',     desc: '选择 BGM、音效与配音',       phase: 'production', cx: 580, cy: 382 },
  { id: 'episode-recorder',    name: '记录员',       desc: '归档集数资产与消耗记录',    phase: 'production', cx: 580, cy: 482 },
  // 监控列
  { id: 'continuity-guard',    name: '连贯性守卫',   desc: '审查剧情漏洞与人设崩塌',    phase: 'monitor',    cx: 800, cy: 282 },
  { id: 'hook-crafter',        name: '悬念工匠',     desc: '设计集末钩子与高潮点',      phase: 'monitor',    cx: 800, cy: 382 },
  { id: 'pacing-analyzer',     name: '节奏分析师',   desc: '监控节奏与爽点分布',        phase: 'monitor',    cx: 800, cy: 482 },
];
const EPISODE_EDGES: AgentEdge[] = [
  { from: 'arc-director',      to: 'episode-director' },
  // episode-director → 两侧分支
  { from: 'episode-director',  to: 'scriptwriter',        path: 'M350,183 C350,240 120,232 120,251' },
  { from: 'episode-director',  to: 'storyboard-director', path: 'M350,183 C350,240 580,232 580,251' },
  // 编剧链
  { from: 'scriptwriter',      to: 'dialogue-coach' },
  { from: 'dialogue-coach',    to: 'script-reviewer' },
  { from: 'script-reviewer',   to: 'script-editor',       dashed: true, label: '不达标' },
  // 重审回环 (左弧)
  { from: 'script-editor',     to: 'script-reviewer',     dashed: true, label: '重审',
    path: 'M52,582 C-10,582 -10,482 52,482' },
  // 制作链
  { from: 'storyboard-director', to: 'audio-director' },
  { from: 'audio-director',    to: 'episode-recorder' },
];

/* ─── 样式映射 ─── */
const PHASE_COLORS: Record<AgentNode['phase'], { fill: string; stroke: string; textMain: string; textSub: string; selFill: string }> = {
  creation:   { fill: '#ede9fe', stroke: '#7c3aed', textMain: '#4c1d95', textSub: '#7c3aed', selFill: '#7c3aed' },
  scripting:  { fill: '#dbeafe', stroke: '#2563eb', textMain: '#1e3a8a', textSub: '#3b82f6', selFill: '#2563eb' },
  production: { fill: '#fef3c7', stroke: '#d97706', textMain: '#78350f', textSub: '#d97706', selFill: '#d97706' },
  monitor:    { fill: '#dcfce7', stroke: '#16a34a', textMain: '#14532d', textSub: '#16a34a', selFill: '#16a34a' },
};

/* ─── 工具：直线端点 ─── */
function lineEndpoints(from: AgentNode, to: AgentNode) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x1: from.cx + (dx > 0 ? NW2 : -NW2), y1: from.cy, x2: to.cx + (dx > 0 ? -NW2 : NW2), y2: to.cy };
  }
  return { x1: from.cx, y1: from.cy + (dy > 0 ? NH2 : -NH2), x2: to.cx, y2: to.cy + (dy > 0 ? -NH2 : NH2) };
}

/* ─── 主组件 ─── */
export const AgentFlowChart: React.FC<AgentFlowChartProps> = ({ tplId, agentPrompts, originalAgentPrompts, onPromptsChanged }) => {
  const [phase, setPhase] = useState<'creation' | 'episode'>('creation');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [agentsMap, setAgentsMap] = useState<Record<string, {name: string, desc: string}>>({});

  React.useEffect(() => {
    listDramaSystemAgents().then(categories => {
      const map: Record<string, {name: string, desc: string}> = {};
      categories.forEach(cat => {
        cat.agents.forEach(agent => {
          map[agent.promptKey] = { name: agent.name, desc: agent.desc };
        });
      });
      setAgentsMap(map);
    }).catch(console.error);
  }, []);

  const nodes = phase === 'creation' ? CREATION_NODES : EPISODE_NODES;
  const edges = phase === 'creation' ? CREATION_EDGES : EPISODE_EDGES;

  const handleSelectNode = (id: string) => {
    setSelectedId(id);
    setEditValue(agentPrompts[id] ?? originalAgentPrompts[id] ?? '');
  };

  const isDirty = selectedId
    ? (agentPrompts[selectedId] ?? '') !== (originalAgentPrompts[selectedId] ?? '')
    : false;

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const updated = await updateDramaAgentPrompt(tplId, selectedId, editValue);
      const newP = (updated.profileJson as any)?.agentSystemPrompts ?? {};
      onPromptsChanged(newP);
      message.success('提示词已保存');
    } catch (err: any) { message.error(err?.data?.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!selectedId) return;
    const original = originalAgentPrompts[selectedId] ?? '';
    setEditValue(original);
    setSaving(true);
    try {
      const updated = await updateDramaAgentPrompt(tplId, selectedId, original);
      const newP = (updated.profileJson as any)?.agentSystemPrompts ?? {};
      onPromptsChanged(newP);
    } catch { } finally { setSaving(false); }
  };

  /* ─── 渲染单个节点 ─── */
  const renderNode = (node: AgentNode) => {
    const c = PHASE_COLORS[node.phase];
    const isSelected = selectedId === node.id;
    const hasCustom = (agentPrompts[node.id] ?? '') !== (originalAgentPrompts[node.id] ?? '');
    const x = node.cx - NW2, y = node.cy - NH2;
    return (
      <g key={node.id} style={{ cursor: 'pointer' }} onClick={() => handleSelectNode(node.id)}>
        {/* 选中光晕 */}
        {isSelected && (
          <rect x={x - 3} y={y - 3} width={NW + 6} height={NH + 6} rx={11}
            fill={c.selFill} opacity={0.2} />
        )}
        <rect x={x} y={y} width={NW} height={NH} rx={8}
          fill={isSelected ? c.selFill : c.fill}
          stroke={isSelected ? c.selFill : (hasCustom ? '#059669' : c.stroke)}
          strokeWidth={isSelected ? 2 : (hasCustom ? 2 : 1.5)} />
        {/* 绿点：有自定义提示词 */}
        {hasCustom && !isSelected && (
          <circle cx={x + NW - 10} cy={y + 10} r={5} fill="#059669" />
        )}
        {/* 名称 */}
        <text x={node.cx} y={node.cy - 10} textAnchor="middle"
          fill={isSelected ? 'white' : c.textMain}
          fontSize={12.5} fontWeight="700" style={{ pointerEvents: 'none' }}>
          {agentsMap[node.id]?.name || node.name}
        </text>
        {/* 描述 */}
        <text x={node.cx} y={node.cy + 8} textAnchor="middle"
          fill={isSelected ? 'rgba(255,255,255,0.85)' : c.textSub}
          fontSize={10} style={{ pointerEvents: 'none' }}>
          {(agentsMap[node.id]?.desc || node.desc).length > 16 ? (agentsMap[node.id]?.desc || node.desc).slice(0, 16) + '…' : (agentsMap[node.id]?.desc || node.desc)}
        </text>
        {/* Agent ID */}
        <text x={node.cx} y={node.cy + 24} textAnchor="middle"
          fill={isSelected ? 'rgba(255,255,255,0.5)' : '#9ca3af'}
          fontSize={8.5} fontFamily="monospace" style={{ pointerEvents: 'none' }}>
          {node.id}
        </text>
      </g>
    );
  };

  /* ─── 渲染单条边 ─── */
  const arrowColor = '#94a3b8';
  const renderEdge = (edge: AgentEdge) => {
    const fromN = nodes.find(n => n.id === edge.from);
    const toN = nodes.find(n => n.id === edge.to);
    if (!fromN || !toN) return null;
    const key = `${edge.from}→${edge.to}`;
    const stroke = edge.dashed ? '#f59e0b' : arrowColor;
    const markerId = edge.dashed ? 'arr-dashed' : 'arr-solid';

    let d: string;
    if (edge.path) {
      d = edge.path;
    } else {
      const { x1, y1, x2, y2 } = lineEndpoints(fromN, toN);
      d = `M${x1},${y1} L${x2},${y2}`;
    }
    // label 中点
    const midX = fromN.cx + (toN.cx - fromN.cx) * 0.5;
    const midY = fromN.cy + (toN.cy - fromN.cy) * 0.5;

    return (
      <g key={key}>
        <path d={d} stroke={stroke} strokeWidth={edge.dashed ? 1.5 : 2}
          strokeDasharray={edge.dashed ? '6,3' : undefined}
          markerEnd={`url(#${markerId})`} fill="none" />
        {edge.label && (
          <text x={midX} y={midY - 6} textAnchor="middle" fontSize={9.5}
            fill={edge.dashed ? '#d97706' : '#6b7280'} fontWeight="500">
            {edge.label}
          </text>
        )}
      </g>
    );
  };

  const selectedNode = nodes.find(n => n.id === selectedId);

  // SVG 尺寸
  const viewBox = phase === 'creation' ? '0 0 876 140' : '0 0 876 660';
  const svgHeight = phase === 'creation' ? 140 : 660;

  return (
    <div className="space-y-4">
      {/* 阶段切换 + 图例 */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant={phase === 'creation' ? 'default' : 'outline'}
            onClick={() => { setPhase('creation'); setSelectedId(null); }}>
            🎬 创建阶段（5 Agents）
          </Button>
          <Button size="sm" variant={phase === 'episode' ? 'default' : 'outline'}
            onClick={() => { setPhase('episode'); setSelectedId(null); }}>
            📺 集生成阶段（12 Agents）
          </Button>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />已自定义提示词</span>
          <span className="flex items-center gap-1"><span className="inline-block border border-amber-400 w-6 border-dashed" />重试路径</span>
          <span>点击节点编辑提示词</span>
        </div>
      </div>

      {/* 阶段标题 + 说明 */}
      <div className="flex gap-4 flex-wrap text-[11px]">
        {phase === 'creation' ? (
          <>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-violet-200 border border-violet-600 inline-block" />创建阶段 Agent</span>
            <span className="text-muted-foreground">数据流：素材种子 → 大纲 → 视觉 → 世界观档案 → 节奏策略</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-blue-200 border border-blue-600 inline-block" />剧本 Agent</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-amber-100 border border-amber-600 inline-block" />制作 Agent</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-green-100 border border-green-600 inline-block" />监控 Agent</span>
          </>
        )}
      </div>

      {/* SVG 流程图 */}
      <div className="border rounded-xl overflow-x-auto bg-slate-50/50 dark:bg-slate-900/30">
        <svg viewBox={viewBox} width="100%" height={svgHeight} style={{ minWidth: '600px' }}>
          <defs>
            <marker id="arr-solid" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={arrowColor} />
            </marker>
            <marker id="arr-dashed" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#f59e0b" />
            </marker>
          </defs>
          {/* 集生成阶段列标题 */}
          {phase === 'episode' && (
            <>
              <text x={120} y={20} textAnchor="middle" fontSize={11} fill="#6b7280" fontWeight="600">编剧主线</text>
              <text x={580} y={20} textAnchor="middle" fontSize={11} fill="#6b7280" fontWeight="600">制作主线</text>
              <text x={800} y={20} textAnchor="middle" fontSize={11} fill="#6b7280" fontWeight="600">监控 Agent</text>
              {/* 分割线 */}
              <line x1={360} y1={30} x2={360} y2={640} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,4" />
              <line x1={700} y1={30} x2={700} y2={640} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4,4" />
            </>
          )}
          {/* 边（先渲染，在节点下方） */}
          {edges.map(renderEdge)}
          {/* 节点 */}
          {nodes.map(renderNode)}
        </svg>
      </div>

      {/* 节点编辑面板 */}
      {selectedNode && (
        <div className="border rounded-xl overflow-hidden">
          {/* 面板头 */}
          <div className={cn('px-4 py-3 flex items-center justify-between',
            PHASE_COLORS[selectedNode.phase].fill)}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" style={{ color: PHASE_COLORS[selectedNode.phase].stroke }} />
              <span className="font-semibold text-sm">{agentsMap[selectedNode.id]?.name || selectedNode.name}</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono border-muted-foreground/40">
                {selectedNode.id}
              </Badge>
              {isDirty && (
                <Badge className="text-[9px] h-4 px-1.5 bg-amber-100 text-amber-700 border-amber-300">已修改</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {isDirty && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={handleReset} disabled={saving}>
                  <RotateCcw className="w-3 h-3 mr-1" />恢复系统默认
                </Button>
              )}
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                保存
              </Button>
            </div>
          </div>
          {/* 描述 */}
          <div className="px-4 py-2 bg-muted/30 border-b text-xs text-muted-foreground">
            {agentsMap[selectedNode.id]?.desc || selectedNode.desc} · 该提示词定义 Agent 的角色、规则与创作风格
          </div>
          {/* 编辑区 */}
          <div className="p-4">
            <Textarea
              className="font-mono text-xs min-h-[180px] resize-y"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={`输入 ${agentsMap[selectedNode.id]?.name || selectedNode.name} 的系统提示词...\n留空则使用系统内建默认逻辑\n\n可用变量（部分 Agent 支持）：{{epMin}} {{epMax}} {{durSec}} {{visualStyleDesc}} 等`}
            />
            <p className="text-[10px] text-muted-foreground mt-2">
              修改后点"保存"立即生效；下次使用此模板创建短剧时将使用新的提示词
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
