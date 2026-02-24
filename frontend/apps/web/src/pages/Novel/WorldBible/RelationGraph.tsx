import React, { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { CharacterInfo, RelationEdge } from '@/services/novel';

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);

const ROLE_COLORS: Record<string, string> = {
  protagonist: '#f59e0b',
  supporting: '#3b82f6',
  villain: '#ef4444',
  npc: '#6b7280',
};

interface Props {
  characters: CharacterInfo[];
  relations: RelationEdge[];
}

export const RelationGraph: React.FC<Props> = ({ characters, relations }) => {
  const option = useMemo(() => {
    const charMap = new Map(characters.map((c) => [c.id, c]));

    const nodes = characters.map((c) => ({
      id: c.id,
      name: c.name,
      symbolSize: c.role === 'protagonist' ? 60 : c.role === 'villain' ? 45 : 35,
      itemStyle: { color: ROLE_COLORS[c.role] ?? '#6b7280' },
      label: { show: true, fontSize: 12, color: '#e5e5e5' },
      category: c.role,
    }));

    const edges = relations
      .filter((r) => r.status === 'active' && charMap.has(r.fromCharacterId) && charMap.has(r.toCharacterId))
      .map((r) => ({
        source: r.fromCharacterId,
        target: r.toCharacterId,
        value: r.strength,
        label: {
          show: true,
          formatter: r.relationType,
          fontSize: 10,
          color: '#a3a3a3',
        },
        lineStyle: {
          width: Math.max(1, Math.abs(r.strength) / 2),
          color: r.strength >= 0 ? '#22c55e' : '#ef4444',
          curveness: 0.2,
          type: r.strength < 0 ? ('dashed' as const) : ('solid' as const),
        },
      }));

    const categories = [
      { name: 'protagonist' },
      { name: 'supporting' },
      { name: 'villain' },
      { name: 'npc' },
    ];

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item' as const,
        formatter: (params: any) => {
          if (params.dataType === 'node') {
            const char = charMap.get(params.data.id);
            if (!char) return params.data.name;
            return `<b>${char.name}</b><br/>角色: ${char.role}<br/>原型: ${char.archetype}`;
          }
          if (params.dataType === 'edge') {
            const from = charMap.get(params.data.source)?.name ?? params.data.source;
            const to = charMap.get(params.data.target)?.name ?? params.data.target;
            return `${from} → ${to}<br/>关系: ${params.data.label?.formatter ?? ''}<br/>强度: ${params.data.value}`;
          }
          return '';
        },
      },
      legend: {
        data: categories.map((c) => c.name),
        textStyle: { color: '#a3a3a3' },
        formatter: (name: string) => {
          const map: Record<string, string> = { protagonist: '主角', supporting: '配角', villain: '反派', npc: 'NPC' };
          return map[name] ?? name;
        },
      },
      series: [
        {
          type: 'graph',
          layout: 'force',
          data: nodes,
          links: edges,
          categories,
          roam: true,
          draggable: true,
          force: {
            repulsion: 300,
            edgeLength: [120, 250],
            gravity: 0.1,
          },
          emphasis: {
            focus: 'adjacency' as const,
            lineStyle: { width: 4 },
          },
        },
      ],
    };
  }, [characters, relations]);

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      style={{ height: 500, width: '100%' }}
      notMerge={true}
    />
  );
};
