import React, { useState } from 'react';
import {
  Sparkles,
  BookOpen,
  MessageSquare,
  Gauge,
  Shield,
  Globe,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { BookPromptProfile } from '@/services/novel';

interface ProfileEditorProps {
  profile: BookPromptProfile;
  onChange: (profile: BookPromptProfile) => void;
  readOnly?: boolean;
}

type RiskLevel = 'low' | 'medium' | 'high';
const riskConfig: Record<RiskLevel, { label: string; cls: string; bg: string }> = {
  low: { label: '低风险', cls: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  medium: { label: '中风险', cls: 'text-amber-600', bg: 'bg-amber-50 border-amber-200 text-amber-800' },
  high: { label: '高风险', cls: 'text-rose-600', bg: 'bg-rose-50 border-rose-200 text-rose-800' },
};

function Section({
  title,
  icon: Icon,
  defaultOpen = false,
  description,
  impact,
  risk,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  description?: string;
  impact?: string;
  risk?: RiskLevel;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rc = risk ? riskConfig[risk] : null;
  return (
    <Card>
      <button
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1">{title}</span>
        {rc && <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${rc.cls} border-current`}>{rc.label}</Badge>}
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 px-4 space-y-4">
          {(description || impact) && (
            <div className={`flex items-start gap-2 rounded-md border p-2.5 text-xs leading-relaxed ${rc?.bg ?? 'bg-muted/50 border-border text-muted-foreground'}`}>
              {risk === 'high' ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              <div>
                {description && <p>{description}</p>}
                {impact && <p className="mt-1 font-medium">修改影响：{impact}</p>}
              </div>
            </div>
          )}
          {children}
        </CardContent>
      )}
    </Card>
  );
}

function StringListEditor({
  items,
  onChange,
  placeholder,
  readOnly,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="text-xs text-muted-foreground mt-2 w-5 shrink-0">{i + 1}.</span>
          {readOnly ? (
            <p className="text-sm flex-1 py-1">{item}</p>
          ) : (
            <Input
              className="flex-1 text-sm h-auto py-1.5"
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
          )}
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex gap-2">
          <Input
            className="flex-1 text-sm h-8"
            placeholder={placeholder ?? '添加新项...'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onChange([...items, draft.trim()]);
                setDraft('');
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1"
            disabled={!draft.trim()}
            onClick={() => {
              onChange([...items, draft.trim()]);
              setDraft('');
            }}
          >
            <Plus className="h-3 w-3" />
            添加
          </Button>
        </div>
      )}
    </div>
  );
}

const ProfileEditor: React.FC<ProfileEditorProps> = ({ profile, onChange, readOnly }) => {
  const update = <K extends keyof BookPromptProfile>(key: K, value: BookPromptProfile[K]) => {
    onChange({ ...profile, [key]: value });
  };

  const updateWriter = <K extends keyof BookPromptProfile['writerGuide']>(
    key: K,
    value: BookPromptProfile['writerGuide'][K],
  ) => {
    onChange({ ...profile, writerGuide: { ...profile.writerGuide, [key]: value } });
  };

  const updateReviewer = <K extends keyof BookPromptProfile['reviewerCalibration']>(
    key: K,
    value: BookPromptProfile['reviewerCalibration'][K],
  ) => {
    onChange({
      ...profile,
      reviewerCalibration: { ...profile.reviewerCalibration, [key]: value },
    });
  };

  const updateWorld = <K extends keyof BookPromptProfile['worldProfile']>(
    key: K,
    value: BookPromptProfile['worldProfile'][K],
  ) => {
    onChange({ ...profile, worldProfile: { ...profile.worldProfile, [key]: value } });
  };

  const TextBlock = ({
    label,
    value,
    onValueChange,
    rows = 3,
  }: {
    label: string;
    value: string;
    onValueChange: (v: string) => void;
    rows?: number;
  }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {readOnly ? (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{value}</p>
      ) : (
        <Textarea
          className="text-sm"
          rows={rows}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Header info */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{profile.generatedForGenre}</Badge>
        <Badge variant="outline">{profile.generatedForAudience}</Badge>
      </div>

      {/* Writer Guide */}
      <Section title="写手身份与题材规则" icon={Sparkles} defaultOpen
        description="定义 AI 写手的创作人格和题材底线。写手身份决定 AI 以什么角色和心态写作；题材规则是所有章节必须遵守的硬性约束；节奏、对话、调性指南控制行文风格。"
        impact="修改写手身份会导致后续章节的文风和叙事口吻发生明显变化；删除题材规则可能导致生成内容偏离类型读者的期望。"
        risk="high"
      >
        <TextBlock
          label="写手身份"
          value={profile.writerGuide.coreIdentity}
          onValueChange={(v) => updateWriter('coreIdentity', v)}
          rows={3}
        />
        <div>
          <Label className="text-xs mb-2 block">题材专属规则</Label>
          <StringListEditor
            items={profile.writerGuide.genreRules}
            onChange={(v) => updateWriter('genreRules', v)}
            placeholder="添加新规则..."
            readOnly={readOnly}
          />
        </div>
        <TextBlock
          label="节奏指南"
          value={profile.writerGuide.pacingGuide}
          onValueChange={(v) => updateWriter('pacingGuide', v)}
        />
        <TextBlock
          label="对话指南"
          value={profile.writerGuide.dialogueGuide}
          onValueChange={(v) => updateWriter('dialogueGuide', v)}
        />
        <TextBlock
          label="调性指南"
          value={profile.writerGuide.toneGuide}
          onValueChange={(v) => updateWriter('toneGuide', v)}
        />
      </Section>

      {/* Craft Examples */}
      <Section title="写作正反例" icon={BookOpen}
        description="提供具体的好写法和坏写法对比示例，AI 写手在生成每一章时都会参考这些示例来避免常见问题。相当于给 AI 的「写作课笔记」。"
        impact="删除示例会让 AI 失去具体的写法参照，质量可能波动；添加新示例可以针对性地纠正反复出现的写作问题。"
        risk="medium"
      >
        <div className="space-y-4">
          {profile.writerGuide.craftExamples.map((ex, i) => (
            <Card key={i} className="bg-muted/30">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">示例 {i + 1}</span>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        const next = profile.writerGuide.craftExamples.filter((_, j) => j !== i);
                        updateWriter('craftExamples', next);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {readOnly ? (
                  <>
                    <p className="text-sm"><span className="text-destructive font-medium">坏：</span>{ex.bad}</p>
                    <p className="text-sm"><span className="text-emerald-600 font-medium">好：</span>{ex.good}</p>
                    <p className="text-sm"><span className="text-primary font-medium">规则：</span>{ex.rule}</p>
                  </>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-destructive">坏的写法</Label>
                      <Input className="text-sm h-8" value={ex.bad} onChange={(e) => {
                        const next = [...profile.writerGuide.craftExamples];
                        next[i] = { ...next[i], bad: e.target.value };
                        updateWriter('craftExamples', next);
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-emerald-600">好的写法</Label>
                      <Input className="text-sm h-8" value={ex.good} onChange={(e) => {
                        const next = [...profile.writerGuide.craftExamples];
                        next[i] = { ...next[i], good: e.target.value };
                        updateWriter('craftExamples', next);
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-primary">规则总结</Label>
                      <Input className="text-sm h-8" value={ex.rule} onChange={(e) => {
                        const next = [...profile.writerGuide.craftExamples];
                        next[i] = { ...next[i], rule: e.target.value };
                        updateWriter('craftExamples', next);
                      }} />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1"
              onClick={() => {
                updateWriter('craftExamples', [
                  ...profile.writerGuide.craftExamples,
                  { bad: '', good: '', rule: '' },
                ]);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              添加正反例
            </Button>
          )}
        </div>
      </Section>

      {/* Satisfaction Types */}
      <Section title="爽感类型" icon={Sparkles}
        description="定义故事中可以使用的「爽点」类型（如打脸、升级、逆袭等）。系统会根据这些类型自动调度爽点的出现频率和间距，避免读者疲劳或枯燥。"
        impact="删除某类爽感会让后续章节不再出现该类高潮场景；修改描述会改变 AI 对该类爽点的理解和表现方式。"
        risk="medium"
      >
        <div className="space-y-2">
          {profile.satisfactionTypes.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              {readOnly ? (
                <p className="text-sm flex-1">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground ml-1">({s.id})</span>
                  <span className="text-muted-foreground ml-1">— {s.description}</span>
                </p>
              ) : (
                <>
                  <Input className="w-20 text-sm h-8" value={s.label} onChange={(e) => {
                    const next = [...profile.satisfactionTypes];
                    next[i] = { ...next[i], label: e.target.value };
                    update('satisfactionTypes', next);
                  }} />
                  <Input className="flex-1 text-sm h-8" value={s.description} onChange={(e) => {
                    const next = [...profile.satisfactionTypes];
                    next[i] = { ...next[i], description: e.target.value };
                    update('satisfactionTypes', next);
                  }} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                    update('satisfactionTypes', profile.satisfactionTypes.filter((_, j) => j !== i));
                  }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Hook Types */}
      <Section title="钩子类型" icon={MessageSquare}
        description="定义每章结尾可以使用的悬念手法（如悬疑钩子、情感钩子、反转钩子等）。系统会自动轮换不同钩子类型，确保章末的吸引力不重复。"
        impact="删除钩子类型会缩小章末悬念的创作空间；类型过少会导致钩子手法重复、读者审美疲劳。"
        risk="medium"
      >
        <div className="space-y-2">
          {profile.hookTypes.map((h, i) => (
            <div key={i} className="flex items-start gap-2">
              {readOnly ? (
                <p className="text-sm flex-1">
                  <span className="font-medium">{h.label}</span>
                  <span className="text-muted-foreground ml-1">— {h.description}</span>
                </p>
              ) : (
                <>
                  <Input className="w-20 text-sm h-8" value={h.label} onChange={(e) => {
                    const next = [...profile.hookTypes];
                    next[i] = { ...next[i], label: e.target.value };
                    update('hookTypes', next);
                  }} />
                  <Input className="flex-1 text-sm h-8" value={h.description} onChange={(e) => {
                    const next = [...profile.hookTypes];
                    next[i] = { ...next[i], description: e.target.value };
                    update('hookTypes', next);
                  }} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                    update('hookTypes', profile.hookTypes.filter((_, j) => j !== i));
                  }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Cliche Patterns */}
      <Section title="套话黑名单" icon={Shield}
        description="列出需要限制使用频率的常见套话或陈词滥调（如「不由得」「竟然」等）。系统在生成和审核时会自动检测并限制这些表达的出现次数。"
        impact="删除黑名单条目会让对应表达不再受限；添加新条目可以抑制你发现的重复用语。设为 0 次表示完全禁止。"
        risk="low"
      >
        <div className="space-y-2">
          {profile.clichePatterns.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              {readOnly ? (
                <p className="text-sm flex-1">
                  "{c.pattern}" <span className="text-muted-foreground">— 每章最多 {c.maxPerChapter} 次</span>
                </p>
              ) : (
                <>
                  <Input className="flex-1 text-sm h-8" value={c.pattern} onChange={(e) => {
                    const next = [...profile.clichePatterns];
                    next[i] = { ...next[i], pattern: e.target.value };
                    update('clichePatterns', next);
                  }} />
                  <Input className="w-16 text-sm h-8 text-center" type="number" min={0} max={10}
                    value={c.maxPerChapter} onChange={(e) => {
                      const next = [...profile.clichePatterns];
                      next[i] = { ...next[i], maxPerChapter: parseInt(e.target.value) || 0 };
                      update('clichePatterns', next);
                    }} />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                    update('clichePatterns', profile.clichePatterns.filter((_, j) => j !== i));
                  }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Reviewer Calibration */}
      <Section title="评审校准" icon={Gauge}
        description="控制 AI 评审员对每章质量的评分标准。维度权重决定哪些方面更重要（如节奏 vs 文笔）；评分锚点定义了高分和低分的具体标准。评分低于阈值的章节会被自动要求重写。"
        impact="调高某个维度的权重会让评审更严格地审查该方面，可能增加重写次数；修改评分锚点会改变「什么算好章节」的判定标准。"
        risk="high"
      >
        <div>
          <Label className="text-xs mb-2 block">维度权重（0.5-2.0，越高越重要）</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(Object.entries(profile.reviewerCalibration.dimensionWeights) as [string, number][]).map(([key, val]) => {
              const labels: Record<string, string> = {
                engagement: '吸引力', pacing: '节奏', hookStrength: '钩子',
                consistency: '一致性', proseQuality: '文笔', characterDepth: '角色深度',
              };
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14 shrink-0">{labels[key] ?? key}</span>
                  {readOnly ? (
                    <span className="text-sm font-medium">{val}</span>
                  ) : (
                    <Input className="w-16 text-sm h-7 text-center" type="number" min={0.5} max={2.0} step={0.1}
                      value={val} onChange={(e) => {
                        updateReviewer('dimensionWeights', {
                          ...profile.reviewerCalibration.dimensionWeights,
                          [key]: parseFloat(e.target.value) || 1.0,
                        });
                      }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <Label className="text-xs mb-2 block">题材专属检查项</Label>
          <StringListEditor
            items={profile.reviewerCalibration.genreSpecificChecks}
            onChange={(v) => updateReviewer('genreSpecificChecks', v)}
            placeholder="添加检查项..."
            readOnly={readOnly}
          />
        </div>
        <TextBlock
          label="高分标准 (9-10)"
          value={profile.reviewerCalibration.scoringAnchors.high}
          onValueChange={(v) => updateReviewer('scoringAnchors', { ...profile.reviewerCalibration.scoringAnchors, high: v })}
          rows={2}
        />
        <TextBlock
          label="中等标准 (5-6)"
          value={profile.reviewerCalibration.scoringAnchors.mid}
          onValueChange={(v) => updateReviewer('scoringAnchors', { ...profile.reviewerCalibration.scoringAnchors, mid: v })}
          rows={2}
        />
        <TextBlock
          label="低分标准 (0-4)"
          value={profile.reviewerCalibration.scoringAnchors.low}
          onValueChange={(v) => updateReviewer('scoringAnchors', { ...profile.reviewerCalibration.scoringAnchors, low: v })}
          rows={2}
        />
      </Section>

      {/* World Profile */}
      <Section title="世界观配置" icon={Globe}
        description="控制故事世界的结构特征。「力量体系」决定是否存在修炼/等级系统；「金手指」决定主角是否有外挂能力；组织类型影响势力/门派的生成方向。"
        impact="关闭力量体系或金手指会让后续章节不再生成相关内容，已有的设定仍会保留但不再扩展。对玄幻/修仙类小说影响极大。"
        risk="high"
      >
        <div>
          <Label className="text-xs mb-2 block">组织类型</Label>
          <StringListEditor
            items={profile.worldProfile.organizationTypes}
            onChange={(v) => updateWorld('organizationTypes', v)}
            placeholder="添加组织类型..."
            readOnly={readOnly}
          />
        </div>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.worldProfile.powerSystemApplicable}
              onChange={(e) => updateWorld('powerSystemApplicable', e.target.checked)}
              disabled={readOnly}
              className="rounded"
            />
            力量体系
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={profile.worldProfile.goldenFingerApplicable}
              onChange={(e) => updateWorld('goldenFingerApplicable', e.target.checked)}
              disabled={readOnly}
              className="rounded"
            />
            金手指
          </label>
        </div>
        <TextBlock
          label="角色关系重心"
          value={profile.worldProfile.characterRelationEmphasis}
          onValueChange={(v) => updateWorld('characterRelationEmphasis', v)}
        />
      </Section>
    </div>
  );
};

export default ProfileEditor;
