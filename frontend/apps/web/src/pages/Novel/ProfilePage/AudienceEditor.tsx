import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';
import type { AudienceDirective } from '@/services/novel';

interface AudienceEditorProps {
  audience: AudienceDirective;
  onChange: (audience: AudienceDirective) => void;
}

const StrList: React.FC<{ value: string[]; onChange: (v: string[]) => void; ph?: string }> = ({ value = [], onChange, ph }) => (
  <div className="space-y-2">
    {value.map((item, i) => (
      <div key={i} className="flex gap-2">
        <Input 
          value={item} 
          onChange={(e) => { const n = [...value]; n[i] = e.target.value; onChange(n); }} 
          placeholder={ph} 
          className="text-sm" 
        />
        <Button 
          variant="ghost" 
          size="icon" 
          className="shrink-0 text-muted-foreground hover:text-destructive" 
          onClick={() => onChange(value.filter((_, j) => j !== i))}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    ))}
    <Button variant="outline" size="sm" onClick={() => onChange([...value, ''])}>
      <Plus className="w-4 h-4 mr-1.5" />添加
    </Button>
  </div>
);

const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border rounded-lg overflow-hidden bg-card">
    <div className="px-4 py-3 bg-muted/30 border-b font-medium text-sm">
      {title}
    </div>
    <div className="p-4 space-y-4">
      {children}
    </div>
  </div>
);

const AudienceEditor: React.FC<AudienceEditorProps> = ({ audience, onChange }) => {
  return (
    <div className="space-y-6">
      <FormSection title="受众与叙事聚焦">
        <div>
          <Label className="text-sm font-medium mb-2 block">受众标签</Label>
          <p className="text-xs text-muted-foreground mb-3">定义目标读者的画像特征，影响 AI 的文风和爽感判断标准。</p>
          <StrList 
            value={audience.audienceTags} 
            onChange={(v) => onChange({ ...audience, audienceTags: v })} 
            ph="如: 女性向、18-35岁、言情读者" 
          />
        </div>
        
        <div className="pt-2">
          <Label className="text-sm font-medium mb-2 block">主角聚焦</Label>
          <p className="text-xs text-muted-foreground mb-3">决定故事的叙事视角和情感侧重点。</p>
          <div className="flex flex-wrap gap-2">
            {['female_lead', 'male_lead', 'dual_lead', 'ensemble'].map(tag => {
              const labels: Record<string, string> = { 
                female_lead: '女主视角', 
                male_lead: '男主视角', 
                dual_lead: '双主角', 
                ensemble: '群像' 
              };
              const selected = audience.protagonistFocus === tag;
              return (
                <Badge 
                  key={tag} 
                  variant={selected ? 'default' : 'outline'} 
                  className={`cursor-pointer px-3 py-1 ${selected ? '' : 'hover:bg-muted'}`}
                  onClick={() => onChange({ ...audience, protagonistFocus: tag as any })}
                >
                  {labels[tag]}
                </Badge>
              );
            })}
          </div>
        </div>
        
        <div className="pt-2">
          <Label className="text-sm font-medium mb-2 block">调性偏好</Label>
          <p className="text-xs text-muted-foreground mb-3">整体故事的风格基调。</p>
          <Input 
            value={audience.tonePreference} 
            onChange={(e) => onChange({ ...audience, tonePreference: e.target.value })} 
            placeholder="如: 细腻慢热、轻松幽默、杀伐果断" 
          />
        </div>
      </FormSection>
      
      <FormSection title="关系与规则偏好">
        <div>
          <Label className="text-sm font-medium mb-2 block">关系密度</Label>
          <p className="text-xs text-muted-foreground mb-3">决定角色之间情感互动和羁绊在剧情中的比重。</p>
          <div className="flex gap-6">
            {['low', 'medium', 'high'].map(level => {
              const labels: Record<string, string> = { 
                low: '低 (剧情主导)', 
                medium: '中 (剧情与关系平衡)', 
                high: '高 (关系主导/言情)' 
              };
              return (
                <label key={level} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input 
                    type="radio" 
                    name="relationshipDensity" 
                    value={level} 
                    checked={audience.relationshipDensity === level}
                    onChange={(e) => onChange({ ...audience, relationshipDensity: e.target.value as any })}
                    className="w-4 h-4 text-primary"
                  />
                  {labels[level]}
                </label>
              );
            })}
          </div>
        </div>

        <div className="pt-2">
          <Label className="text-sm font-medium mb-2 block">硬性约束 (Hard Constraints)</Label>
          <p className="text-xs text-muted-foreground mb-3">Agent 绝对不能违反的底线规则。</p>
          <StrList 
            value={audience.hardConstraints} 
            onChange={(v) => onChange({ ...audience, hardConstraints: v })} 
            ph="如: 禁止出现后宫情节" 
          />
        </div>

        <div className="pt-2">
          <Label className="text-sm font-medium mb-2 block">软性偏好 (Soft Preferences)</Label>
          <p className="text-xs text-muted-foreground mb-3">Agent 优先考虑的写作倾向。</p>
          <StrList 
            value={audience.softPreferences} 
            onChange={(v) => onChange({ ...audience, softPreferences: v })} 
            ph="如: 倾向于描写细腻的心理活动" 
          />
        </div>
      </FormSection>
    </div>
  );
};

export default AudienceEditor;