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

function Section({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        className="flex w-full items-center gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <span className="text-sm font-semibold flex-1">{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <CardContent className="pt-0 pb-4 px-4 space-y-4">{children}</CardContent>}
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
      <Section title="写手身份与题材规则" icon={Sparkles} defaultOpen>
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
      <Section title="写作正反例" icon={BookOpen}>
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
      <Section title="爽感类型" icon={Sparkles}>
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
      <Section title="钩子类型" icon={MessageSquare}>
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
      <Section title="套话黑名单" icon={Shield}>
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
      <Section title="评审校准" icon={Gauge}>
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
      <Section title="世界观配置" icon={Globe}>
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
