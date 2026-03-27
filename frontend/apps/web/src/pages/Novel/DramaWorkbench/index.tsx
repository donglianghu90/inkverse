import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, Play, Pause, Loader2, AlertCircle, Film, Clock, Star,
  ChevronRight, Eye, Camera, Users, MapPin, ChevronDown,
  ChevronUp, Clapperboard, Pencil, Save, X, Lock, Unlock, RotateCcw, Wand2,
  Heart, Scissors, Music, Volume2, VolumeX, Timer, Brain, Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  getDrama, listEpisodes, getEpisode, getVisualAssets,
  regenerateVisualAssetImage, refineVisualAssetImage, regenerateVariationImage,
  getGenerateEpisodeSseUrl, getGenerateMediaSseUrl, getEpisodeProgressSseUrl,
  getGenerateAllAssetsSseUrl,
  getGenerationStatus, pauseEpisodeGeneration, type DbRunningItem,
  getDramaUsage, updateShot, listDramaExecutions, resetProblemShots,
  getDramaPipeline, saveDramaPipelineDraft, publishDramaPipeline, saveDramaWorkflowParams, getDramaNodePreview,
  updateDramaVisualStyle, type VisualStyleGuideUpdate,
  type EpisodeListItem, type ShotPatch, type DramaUsageSummary, type DramaSseEvent, type DramaExecutionListItem, type VisualAssetItem,
  type VisualAssetRefineStrength, type VisualAssetRefineSyncScope,
  type ResetFixTarget, type DramaPipeline, type DramaAgentNodeConfig, type DramaWorkflowParams,
} from '@/services/drama';
import { getToken } from '@/services/auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const CUT_POINT_LABELS: Record<string, string> = {
  on_action: '动作切', on_reaction: '反应切', on_emotion_peak: '情绪峰值切',
  on_beat: '节拍切', on_silence: '静默切', free: '自由',
};
const SUBTITLE_STYLE_LABELS: Record<string, string> = {
  default: '默认', emphasis: '强调', whisper: '低语', scream: '呐喊',
  narrator: '旁白', time_skip: '时间跳转',
};
const SUBTITLE_STYLE_COLORS: Record<string, string> = {
  default: 'bg-muted text-foreground', emphasis: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  whisper: 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300', scream: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  narrator: 'bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-300', time_skip: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};
interface EmotionBeat { beatId?: string; startPct?: number; endPct?: number; emotion?: string; intensity?: number; trigger?: string; }

const SOUL_PROFILE_FIELDS: Array<{ key: keyof SoulProfile; label: string; icon: string }> = [
  { key: 'coreDesire', label: '核心欲望', icon: '🎯' },
  { key: 'fatalFlaw', label: '致命缺陷', icon: '💔' },
  { key: 'coreFear', label: '核心恐惧', icon: '😰' },
  { key: 'decisionStyle', label: '决策风格', icon: '🧠' },
  { key: 'stressResponse', label: '压力反应', icon: '⚡' },
  { key: 'internalContradiction', label: '内在矛盾', icon: '🔄' },
];

const VIEW_ANGLE_LABELS: Record<string, string> = {
  face_front: '正面', face_three_quarter: '3/4侧面', upper_body_front: '半身',
  full_body_front: '全身', side_profile: '侧面', back_view: '背面',
  face_happy: '开心表情', face_angry: '愤怒表情',
};
const LOCATION_VIEW_LABELS: Record<string, string> = {
  establishing: '全景', interior_medium: '中景', detail_close: '细节特写',
};
const LOCATION_VIEW_ORDER = ['establishing', 'interior_medium', 'detail_close'];
const VIEW_ANGLE_ORDER = ['face_front', 'face_three_quarter', 'side_profile', 'back_view', 'upper_body_front', 'full_body_front', 'face_happy', 'face_angry'];
const VIEW_ANGLE_GROUP: Record<string, 'core' | 'face' | 'framing'> = {
  face_front: 'core',
  face_three_quarter: 'face',
  side_profile: 'face',
  back_view: 'face',
  upper_body_front: 'framing',
  full_body_front: 'framing',
};
type ViewSyncScope = 'single' | 'group' | 'all';
type ViewEditStrength = 'light' | 'balanced' | 'strong';

const VIEW_SYNC_SCOPE_OPTIONS: Array<{ value: ViewSyncScope; label: string; hint: string }> = [
  { value: 'single', label: '仅当前', hint: '只影响当前选中的视角图。' },
  { value: 'group', label: '同组联动', hint: '影响同一视角组，避免误改无关图。' },
  { value: 'all', label: '全角色', hint: '影响该角色全部视角，统一风格。' },
];

const VIEW_EDIT_STRENGTH_OPTIONS: Array<{ value: ViewEditStrength; label: string }> = [
  { value: 'light', label: '保守' },
  { value: 'balanced', label: '均衡' },
  { value: 'strong', label: '激进' },
];

const VIEW_EDIT_STRENGTH_HINTS: Record<ViewEditStrength, string> = {
  light: '轻微修正细节，优先保持人物身份一致性与五官稳定。',
  balanced: '在一致性与风格变化间折中，适合常规精修。',
  strong: '允许较大变化，适合重做质感或明显重构构图。',
};

const sortViewImages = (items: Array<{ viewAngle: string; imageUrl: string }>): Array<{ viewAngle: string; imageUrl: string }> => (
  [...items].sort((a, b) => {
    const ai = VIEW_ANGLE_ORDER.indexOf(a.viewAngle);
    const bi = VIEW_ANGLE_ORDER.indexOf(b.viewAngle);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  })
);

/** 逐集按需生成，所有角色只保证 face_front 定妆照 */
const CHAR_VIEWS_BY_ROLE: Record<string, string[]> = {
  protagonist: ['face_front'],
  antagonist:  ['face_front'],
  supporting:  ['face_front'],
  minor:       ['face_front'],
};

function normalizeCharRole(role: unknown): string {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'protagonist' || /主角|主人公|女主|男主/.test(r)) return 'protagonist';
  if (r === 'antagonist' || /反派|反角|对手|villain/.test(r)) return 'antagonist';
  if (r === 'supporting' || /配角/.test(r)) return 'supporting';
  return 'minor';
}

/**
 * 将「已生成视角」与「期望视角（按角色/场景类型）」合并：
 * 有图片的显示图片，期望但未生成的显示「待生成」占位。
 */
function mergeExpectedViews(
  actual: Array<{ viewAngle: string; imageUrl: string }> | undefined,
  expected: string[],
  primaryUrl?: string,
): Array<{ viewAngle: string; imageUrl: string }> {
  const map = new Map<string, string>();
  for (const v of actual ?? []) {
    if (v?.viewAngle) map.set(v.viewAngle, v.imageUrl ?? '');
  }
  if (primaryUrl && !map.has(expected[0])) map.set(expected[0], primaryUrl);
  for (const view of expected) {
    if (!map.has(view)) map.set(view, '');
  }
  // 保留 expected 中不存在但已实际生成的视角（防止遗漏）
  for (const v of actual ?? []) {
    if (v?.viewAngle && !map.has(v.viewAngle)) map.set(v.viewAngle, v.imageUrl ?? '');
  }
  return expected
    .map((view) => ({ viewAngle: view, imageUrl: map.get(view) ?? '' }))
    .concat(
      (actual ?? [])
        .filter((v) => v?.viewAngle && !expected.includes(v.viewAngle))
        .map((v) => ({ viewAngle: v.viewAngle, imageUrl: v.imageUrl ?? '' })),
    );
}

const resolveAffectedViews = (
  targetView: string,
  scope: ViewSyncScope,
  availableViews: string[],
): string[] => {
  if (!targetView) return [];
  if (scope === 'all') return availableViews;
  if (scope === 'single') return availableViews.filter((angle) => angle === targetView);
  if (targetView === 'face_front') return availableViews;
  const group = VIEW_ANGLE_GROUP[targetView];
  return availableViews.filter((angle) => angle === targetView || VIEW_ANGLE_GROUP[angle] === group);
};

const ANGLE_LABELS: Record<string, string> = {
  extreme_close_up: '极特写', close_up: '特写', medium_close_up: '中特写',
  medium: '中景', medium_wide: '中远景', wide: '远景', extreme_wide: '极远景',
  over_shoulder: '过肩', bird_eye: '俯瞰', low_angle: '仰角',
  high_angle: '俯角', dutch_angle: '斜构', pov: '主观视角',
};

const MOVEMENT_GROUPS = [
  {
    label: '静止',
    items: [
      { value: 'static', label: '固定机位' },
    ],
  },
  {
    label: '推拉',
    items: [
      { value: 'slow_push_in', label: '慢推' },
      { value: 'slow_pull_back', label: '慢拉' },
      { value: 'dolly_zoom', label: '变焦推拉' },
    ],
  },
  {
    label: '摇移',
    items: [
      { value: 'pan_left', label: '左摇' },
      { value: 'pan_right', label: '右摇' },
      { value: 'tilt_up', label: '上仰' },
      { value: 'tilt_down', label: '下俯' },
      { value: 'whip_pan', label: '甩镜' },
    ],
  },
  {
    label: '升降',
    items: [
      { value: 'crane_up', label: '升镜' },
      { value: 'crane_down', label: '降镜' },
    ],
  },
  {
    label: '跟随',
    items: [
      { value: 'tracking', label: '跟镜' },
      { value: 'orbit', label: '环绕' },
      { value: 'handheld', label: '手持' },
    ],
  },
];

const ALL_MOVEMENTS = MOVEMENT_GROUPS.flatMap(g => g.items);

const MOVEMENT_LABELS: Record<string, string> = Object.fromEntries(
  ALL_MOVEMENTS.map(m => [m.value, m.label]),
);

const SPECIAL_TECHNIQUES = [
  { value: '', label: '无' },
  { value: 'dolly_zoom', label: '希区柯克变焦' },
  { value: 'time_lapse', label: '延时摄影' },
  { value: 'fast_push', label: '急推镜头' },
  { value: 'fast_pull', label: '急拉镜头' },
  { value: 'bullet_time', label: '子弹时间' },
  { value: 'fpv', label: 'FPV 穿梭' },
  { value: 'macro', label: '微距特写' },
  { value: 'slow_motion', label: '慢镜头' },
  { value: 'probe_lens', label: '探针镜头' },
  { value: 'dutch_tilt', label: '旋转倾斜' },
];

const COMPOSITION_LABELS: Record<string, string> = {
  center: '中央构图', rule_of_thirds_left: '三分法左', rule_of_thirds_right: '三分法右',
  symmetrical: '对称构图', leading_space: '引导空间', negative_space: '负空间',
  frame_within_frame: '框中框',
};

const DEPTH_LABELS: Record<string, string> = {
  shallow: '浅景深', medium: '中景深', deep: '深景深',
};

const ROLE_STYLES: Record<string, { label: string; className: string }> = {
  protagonist: { label: '主角', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  antagonist: { label: '反派', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  supporting: { label: '配角', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  minor: { label: '路人', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
};
const CHARACTER_ROLE_ORDER: Record<string, number> = { protagonist: 0, antagonist: 1, supporting: 2, minor: 3 };

type ShotFilterMode = 'all' | 'problem' | 'locked' | 'flashback';
const SHOT_FILTER_LABELS: Record<ShotFilterMode, string> = {
  all: '全部',
  problem: '问题镜头',
  locked: '已锁定',
  flashback: '闪回',
};

const STEP_LABELS: Record<string, string> = {
  seed_analyze: '种子分析',
  outline_plan: '大纲规划',
  visual_design: '视觉设计',
  assets_generate: '参考图生成',
  profile_strategy: '编剧手册/策略',
  arc_plan: '段落规划',
  intent: '集导演',
  continuity: '连续性检查',
  script: '剧本创作',
  dialogue: '台词润色',
  storyboard: '分镜生成',
  audio: '音频设计',
  deterministic: '硬规则校验',
  review: '质量审核',
  edit: '精修',
  pacing: '节奏分析',
  hook: '悬念设计',
  record: '知识记录',
  shot_first_frame: '首帧图生成',
  shot_last_frame: '尾帧图生成',
  shot_video: '视频生成',
  character_image: '角色图生成',
  location_image: '场景图生成',
  character_variation: '角色变体图',
};

const EPISODE_STEP_KEY_LABELS: Record<string, string> = {
  arc_planned: '段落规划',
  intent_ready: '集导演规划',
  continuity_checked: '连续性检查',
  script_drafted: '编剧创作',
  dialogue_polished: '台词润色',
  storyboard_drafted: '分镜生成',
  audio_designed: '音频设计',
  deterministic_checked: '硬规则校验',
  reviewed: '质量审核',
  edited: '精修',
  pacing_analyzed: '节奏分析',
  hook_crafted: '悬念设计',
  recorded: '知识记录',
};

const PIPELINE_NODE_LABELS: Record<string, string> = {
  'arc-director': '卷导演',
  'episode-director': '集导演',
  'continuity-guard': '连续性守卫',
  scriptwriter: '编剧',
  'dialogue-coach': '台词润色',
  'storyboard-director': '分镜导演',
  'audio-director': '音频设计',
  'deterministic-checker': '硬规则校验',
  'script-reviewer': '质量审核',
  'script-editor': '精修编辑',
  'pacing-analyzer': '节奏分析',
  'hook-crafter': '悬念设计',
  'episode-recorder': '知识记录',
};

const SKIP_REASON_LABELS: Record<string, string> = {
  pipeline_disabled: 'Pipeline 节点禁用',
  workflow_param_disabled: '工作流参数关闭',
};

const NARRATIVE_ARC_LABELS: Record<string, string> = {
  conflict_resolution: '冲突化解',
  life_journey: '人生旅程',
  mystery_reveal: '悬谜揭秘',
  quest: '征途追寻',
  rise_and_fall: '兴衰沉浮',
};

const FACT_CONSTRAINT_LABELS: Record<string, string> = {
  none: '纯虚构',
  inspired_by: '历史灵感',
  period_accurate: '史实严格',
};

const CONTINUITY_WARNING_LABELS: Record<string, string> = {
  character_appearance_mismatch: '角色外貌与设定不一致',
  location_continuity_break: '场景连续性断裂',
  costume_inconsistency: '服饰连续性不一致',
  emotion_jump: '角色情绪跳变',
  timeline_violation: '时间线矛盾',
  secret_leak: '秘密信息泄露',
  dead_character_active: '退场角色异常出现',
  relationship_contradiction: '角色关系矛盾',
  character_name_inconsistency: '角色姓名不一致',
  addressing_inconsistency: '角色称呼漂移',
  duplicate_name_confusion: '角色重名/近似名混淆',
};

const CONTINUITY_SEVERITY_LABELS: Record<string, string> = {
  warning: '警告',
  block: '阻断',
};

type QcFixTarget = Exclude<ResetFixTarget, 'all'>;

const FIX_TARGET_LABELS: Record<ResetFixTarget, string> = {
  all: '全部',
  identity: '身份',
  style: '风格',
  camera: '构图',
  motion: '动作',
};

const FIX_TARGET_ORDER: QcFixTarget[] = ['identity', 'style', 'camera', 'motion'];

const fmtCny = (n?: number) => `¥${Number(n ?? 0).toFixed(4)}`;
/** 总费用：优先使用后端聚合的 costCny（不会因新增 kind 遗漏），未返回时 fallback 累加各项 */
const bucketCost = (b: { costCny?: number; llmCostCny: number; imageCostCny: number; videoCostCny: number; ttsCostCny?: number; embeddingCostCny?: number }) =>
  (b.costCny != null && b.costCny > 0)
    ? b.costCny
    : (b.llmCostCny ?? 0) + (b.imageCostCny ?? 0) + (b.videoCostCny ?? 0) + (b.ttsCostCny ?? 0) + (b.embeddingCostCny ?? 0);

const resolveSkippedStepLabel = (input: { nodeId?: string; stepKey?: string; step?: string; message?: string }): string => {
  if (input.nodeId && PIPELINE_NODE_LABELS[input.nodeId]) return PIPELINE_NODE_LABELS[input.nodeId];
  if (input.stepKey && EPISODE_STEP_KEY_LABELS[input.stepKey]) return EPISODE_STEP_KEY_LABELS[input.stepKey];
  if (input.step && STEP_LABELS[input.step]) return STEP_LABELS[input.step];
  return input.message || input.step || '未知步骤';
};

const resolveSkipReasonLabel = (skipReason?: string): string => {
  if (skipReason && SKIP_REASON_LABELS[skipReason]) return SKIP_REASON_LABELS[skipReason];
  return skipReason || '已跳过';
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface CharacterVariation {
  variationId: string;
  name: string;
  costume: string;
  visualPromptOverride: string;
  referenceImageUrl?: string;
}
interface SoulProfile {
  coreDesire?: string;
  fatalFlaw?: string;
  coreFear?: string;
  decisionStyle?: string;
  stressResponse?: string;
  emotionalTriggers?: string[];
  behavioralHabits?: string[];
  internalContradiction?: string;
}
interface Character {
  characterId: string; name: string; role: string; faceDescription: string;
  bodyType: string; hairStyle: string; skinTone: string; age: string;
  defaultCostume: string; distinguishingFeatures: string;
  faceReferencePrompt?: string;
  voiceProfile: { timbre: string; speakingStyle: string; catchphrase?: string };
  soulProfile?: SoulProfile;
  variations?: CharacterVariation[];
}
interface Location {
  locationId: string; name: string; description: string; lightingDefault: string;
  colorTone: string; keyProps: string[]; isRecurring: boolean; ambientSoundDefault: string;
  visualPrompt?: string;
}
interface ShotCamera { angle: string; movement: string; composition: string; depthOfField: string; }
interface ShotChar { characterId: string; action: string; emotion: string; position: string; }
interface ShotDialogue { characterId: string; text: string; emotion: string; isVoiceover: boolean; isInnerThought: boolean; }
interface ShotSfx { trigger: string; sound: string; }
interface ShotDramaticSilence { durationSec?: number; trigger?: string; }
interface ShotAudio { bgm?: { mood: string; intensity: number }; sfx?: ShotSfx[]; ambience?: string; dramaticSilence?: ShotDramaticSilence; }
interface Shot {
  shotIndex: number; shotId: string; sceneId: string; camera: ShotCamera;
  characters: ShotChar[]; dialogue?: ShotDialogue | null; audio?: ShotAudio | null;
  visualPrompt: string; subtitle?: { text: string; style: string; karaoke?: boolean } | null;
  estimatedDurationSec: number; transitionToNext: string;
  trimInSec?: number | null; trimOutSec?: number | null;
  cutPointHint?: string | null;
  firstFrameImageUrl?: string | null; lastFrameImageUrl?: string | null;
  firstFramePrompt?: string | null; lastFramePrompt?: string | null;
  isMasterShot?: boolean;
  regenPriority?: 'high' | 'medium' | 'low';
  qualityTier?: 'golden' | 'standard' | 'filler';
  isFlashback?: boolean;
  isPreview?: boolean;
  specialTechnique?: string | null;
  isHumanEdited?: boolean;
  humanEditedAt?: string | null;
}
interface ShotMediaQc {
  identityScore?: number;
  styleScore?: number;
  readabilityScore?: number;
  score?: number;
  passed?: boolean;
  attempts?: number;
  issues?: string[];
  failReasons?: QcFixTarget[];
  recommendedFix?: QcFixTarget;
}
interface ShotMedia {
  imageUrl?: string;
  videoUrl?: string;
  ttsUrl?: string;
  lastFrameImageUrl?: string;
  status?: string;
  qc?: ShotMediaQc;
  t2iPrompt?: string;
  t2iNegativePrompt?: string;
  lastFrameT2iPrompt?: string;
}
interface ContinuityWarning {
  type: string;
  description: string;
  severity: 'warning' | 'block' | string;
  affectedEntityId?: string;
}
interface SkippedStepItem {
  key: string;
  label: string;
  reason: string;
}

const isProblemShotMediaEntry = (shot: Shot, media: ShotMedia | null | undefined, episodeMediaStatus?: string): boolean => {
  if (!media) return false;
  if (shot.isPreview) return false;
  if (media.qc?.passed === false) return true;
  if (media.status === 'failed' || media.status === 'submitted') return true;
  if (media.status === 'completed' && !media.videoUrl) return true;
  if (episodeMediaStatus === 'failed' && media.status === 'image_done' && !media.videoUrl && !shot.isFlashback) return true;
  return false;
};

const isHighPriorityShot = (shot: Shot): boolean =>
  !!(shot.isMasterShot || shot.regenPriority === 'high' || shot.qualityTier === 'golden');

const isQcFixTarget = (value: unknown): value is QcFixTarget =>
  value === 'identity' || value === 'style' || value === 'camera' || value === 'motion';

const resolveShotFixTags = (
  shot: Shot,
  media: ShotMedia | null | undefined,
  reviewConsistencyRiskIds: Set<string>,
  reviewCameraRiskIds: Set<string>,
): Set<QcFixTarget> => {
  const tags = new Set<QcFixTarget>();
  const qc = media?.qc;
  if (isQcFixTarget(qc?.recommendedFix)) tags.add(qc.recommendedFix);
  for (const reason of qc?.failReasons ?? []) {
    if (isQcFixTarget(reason)) tags.add(reason);
  }
  if (reviewConsistencyRiskIds.has(shot.shotId)) {
    tags.add('identity');
    tags.add('style');
  }
  if (reviewCameraRiskIds.has(shot.shotId)) tags.add('camera');
  const likelyMotionProblem = media?.status === 'failed' && !media?.videoUrl && !shot.isPreview;
  if (likelyMotionProblem) tags.add('motion');
  return tags;
};

// ─── ShotEditPanel ────────────────────────────────────────────────────────────

interface ShotEditPanelProps {
  shot: Shot;
  dramaId: string;
  episodeNumber: number;
  onSaved: (patch: ShotPatch) => void;
  onCancel: () => void;
}

const ShotEditPanel: React.FC<ShotEditPanelProps> = ({ shot, dramaId, episodeNumber, onSaved, onCancel }) => {
  const [saving, setSaving] = useState(false);
  const [visualPrompt, setVisualPrompt] = useState(shot.visualPrompt ?? '');
  const [movement, setMovement] = useState(shot.camera?.movement ?? 'static');
  const [technique, setTechnique] = useState(shot.specialTechnique ?? '');
  const [firstFrameUrl, setFirstFrameUrl] = useState(shot.firstFrameImageUrl ?? '');
  const [lastFrameUrl, setLastFrameUrl] = useState(shot.lastFrameImageUrl ?? '');
  const [editNote, setEditNote] = useState('');

  const handleSave = async () => {
    setSaving(true);
    try {
      const patch: ShotPatch = {
        visualPrompt: visualPrompt.trim() || undefined,
        camera: { ...shot.camera, movement },
        specialTechnique: technique || null,
        firstFrameImageUrl: firstFrameUrl.trim() || null,
        lastFrameImageUrl: lastFrameUrl.trim() || null,
        humanEditNote: editNote.trim() || undefined,
      };
      await updateShot(dramaId, episodeNumber, shot.shotId, patch);
      message.success('分镜已保存');
      onSaved(patch);
    } catch (e: any) {
      message.error(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20 px-3 pb-4 pt-3 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
          <Pencil className="h-3 w-3" />人工编辑模式
        </p>
        <p className="text-[10px] text-muted-foreground">保存后此镜头将被锁定，AI 重跑时跳过</p>
      </div>

      {/* 画面描述 */}
      <div className="space-y-1.5">
        <Label className="text-xs">画面描述（Visual Prompt）</Label>
        <Textarea
          className="text-xs min-h-[80px] resize-none"
          value={visualPrompt}
          onChange={e => setVisualPrompt(e.target.value)}
          placeholder="用英文描述画面内容、光线、构图和氛围..."
        />
      </div>

      {/* 镜头运动 */}
      <div className="space-y-1.5">
        <Label className="text-xs">镜头运动</Label>
        <div className="space-y-2">
          {MOVEMENT_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] text-muted-foreground mb-1">{group.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setMovement(item.value)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-all border',
                      movement === item.value
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-background text-foreground border-border hover:border-violet-400',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 特殊拍摄手法 */}
      <div className="space-y-1.5">
        <Label className="text-xs">特殊拍摄手法</Label>
        <div className="flex flex-wrap gap-1.5">
          {SPECIAL_TECHNIQUES.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTechnique(t.value)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-all border',
                technique === t.value
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-background text-foreground border-border hover:border-emerald-400',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 首尾帧 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">首帧图片 URL（可选）</Label>
          {firstFrameUrl && (
            <div className="rounded-md overflow-hidden bg-muted h-16 mb-1">
              <img src={firstFrameUrl} alt="首帧" className="w-full h-full object-cover" onError={() => setFirstFrameUrl('')} />
            </div>
          )}
          <Input
            className="text-xs h-7"
            value={firstFrameUrl}
            onChange={e => setFirstFrameUrl(e.target.value)}
            placeholder="粘贴图片 URL..."
          />
          <p className="text-[10px] text-muted-foreground">T2V 将以此图为起始帧生成视频</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">尾帧图片 URL（可选）</Label>
          {lastFrameUrl && (
            <div className="rounded-md overflow-hidden bg-muted h-16 mb-1">
              <img src={lastFrameUrl} alt="尾帧" className="w-full h-full object-cover" onError={() => setLastFrameUrl('')} />
            </div>
          )}
          <Input
            className="text-xs h-7"
            value={lastFrameUrl}
            onChange={e => setLastFrameUrl(e.target.value)}
            placeholder="粘贴图片 URL..."
          />
          <p className="text-[10px] text-muted-foreground">T2V 将以此图为结束帧</p>
        </div>
      </div>

      {/* 修改备注 */}
      <div className="space-y-1.5">
        <Label className="text-xs">修改备注（可选）</Label>
        <Input
          className="text-xs h-7"
          value={editNote}
          onChange={e => setEditNote(e.target.value)}
          placeholder="记录为什么要修改这个镜头..."
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="gap-1.5" disabled={saving} onClick={handleSave}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? '保存中...' : '保存锁定'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          <X className="h-3.5 w-3.5 mr-1" />取消
        </Button>
      </div>
    </div>
  );
};

// ─── ShotCard ─────────────────────────────────────────────────────────────────

interface ShotCardProps {
  shot: Shot;
  index: number;
  charNames: Map<string, string>;
  locNames: Map<string, string>;
  mediaItem?: ShotMedia | null;
  dramaId: string;
  episodeNumber: number;
  onShotUpdated: (shotId: string, patch: ShotPatch) => void;
}

const ShotCard: React.FC<ShotCardProps> = ({
  shot, index, charNames, locNames, mediaItem, dramaId, episodeNumber, onShotUpdated,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const imgUrl = mediaItem?.imageUrl ?? shot.firstFrameImageUrl ?? shot.lastFrameImageUrl;
  const qc = mediaItem?.qc;

  const handleSaved = (patch: ShotPatch) => {
    setEditing(false);
    onShotUpdated(shot.shotId, patch);
  };

  return (
    <Card className={cn(
      'overflow-hidden border transition-colors',
      shot.isHumanEdited ? 'border-violet-300 dark:border-violet-700' : 'border-border/60',
    )}>
      <CardContent className="p-0">
        {/* ── 折叠头部 ── */}
        <div className="flex items-start gap-3 p-3">
          {/* 镜号 + 锁定标志 */}
          <div className="shrink-0 flex flex-col items-center gap-1">
            <button
              type="button"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-mono font-bold text-xs hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors"
              onClick={() => setExpanded(e => !e)}
              title={expanded ? '收起' : '展开详情'}
            >
              {String(index + 1).padStart(3, '0')}
            </button>
            {shot.isHumanEdited && (
              <span title="人工已锁定">
                <Lock className="h-2.5 w-2.5 text-violet-500" />
              </span>
            )}
            {imgUrl && (
              <div className="w-8 h-6 rounded overflow-hidden bg-muted shrink-0">
                <img src={imgUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            {!imgUrl && (
              <div className="w-8 h-6 rounded bg-muted/50 flex items-center justify-center">
                <Camera className="h-2.5 w-2.5 text-muted-foreground/40" />
              </div>
            )}
          </div>

          {/* 摘要内容 */}
          <div className="flex-1 min-w-0" onClick={() => setExpanded(e => !e)} role="button" tabIndex={0}>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {shot.camera?.angle && (
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">
                  {ANGLE_LABELS[shot.camera.angle] ?? shot.camera.angle}
                </span>
              )}
              {shot.camera?.movement && shot.camera.movement !== 'static' && (
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                  {MOVEMENT_LABELS[shot.camera.movement] ?? shot.camera.movement}
                </span>
              )}
              {shot.specialTechnique && (
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                  {SPECIAL_TECHNIQUES.find(t => t.value === shot.specialTechnique)?.label ?? shot.specialTechnique}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground px-0.5 py-0.5">{shot.estimatedDurationSec}s</span>
              {shot.isFlashback && (
                <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 px-1.5 py-0.5 rounded">闪回</span>
              )}
              {shot.cutPointHint && shot.cutPointHint !== 'free' && (
                <span className="text-[10px] bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Scissors className="h-2 w-2" />{CUT_POINT_LABELS[shot.cutPointHint] ?? shot.cutPointHint}
                </span>
              )}
              {shot.subtitle?.style && shot.subtitle.style !== 'default' && (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded', SUBTITLE_STYLE_COLORS[shot.subtitle.style] ?? 'bg-muted')}>
                  {SUBTITLE_STYLE_LABELS[shot.subtitle.style] ?? shot.subtitle.style}
                  {shot.subtitle.karaoke && ' ⌨'}
                </span>
              )}
              {shot.isHumanEdited && (
                <span className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Lock className="h-2 w-2" />已锁定
                </span>
              )}
              {qc && (
                <span
                  className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    qc.passed === false
                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  {qc.passed === false ? 'QC未过' : 'QC通过'}
                  {typeof qc.score === 'number' ? ` ${qc.score.toFixed(1)}` : ''}
                </span>
              )}
              {qc?.recommendedFix && (
                <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">
                  建议修复：{FIX_TARGET_LABELS[qc.recommendedFix]}
                </span>
              )}
            </div>
            <p className={cn('text-xs text-muted-foreground leading-relaxed', !expanded && 'line-clamp-2')}>
              {shot.visualPrompt}
            </p>
            {shot.dialogue?.text && !expanded && (
              <p className="text-xs mt-1 text-foreground/80 truncate">
                <span className="font-semibold text-violet-600 dark:text-violet-400">
                  {charNames.get(shot.dialogue.characterId) ?? shot.dialogue.characterId}
                </span>
                {shot.dialogue.isVoiceover && <span className="text-muted-foreground text-[10px] ml-0.5">（画外音）</span>}
                ：{shot.dialogue.text}
              </p>
            )}
          </div>

          {/* 编辑 + 展开按钮 */}
          <div className="shrink-0 flex items-center gap-1 mt-0.5">
            <button
              type="button"
              onClick={() => { setEditing(e => !e); setExpanded(true); }}
              className={cn(
                'p-1 rounded transition-colors',
                editing
                  ? 'text-violet-600 bg-violet-100 dark:bg-violet-900/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              )}
              title={editing ? '取消编辑' : '编辑此镜头'}
            >
              {shot.isHumanEdited ? <Lock className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* ── 展开详情 ── */}
        {expanded && !editing && (
          <div className="border-t border-border/40 px-3 pb-3 pt-2.5 space-y-3">
            {imgUrl && (
              <div className="rounded-lg overflow-hidden bg-muted">
                <img src={imgUrl} alt={`shot ${index + 1}`} className="w-full object-cover max-h-48" />
              </div>
            )}

            {/* T2I 提示词 */}
            {(mediaItem?.t2iPrompt || shot.firstFramePrompt || shot.lastFramePrompt) && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">图片生成提示词</p>
                <div className="space-y-2">
                  {mediaItem?.t2iPrompt && (
                    <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 px-2.5 py-2">
                      <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-1">首帧 T2I（最终发送）</p>
                      <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all">{mediaItem.t2iPrompt}</p>
                    </div>
                  )}
                  {mediaItem?.t2iNegativePrompt && (
                    <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 px-2.5 py-2">
                      <p className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1">Negative Prompt</p>
                      <p className="text-[11px] text-red-900 dark:text-red-200 leading-relaxed break-all select-all">{mediaItem.t2iNegativePrompt}</p>
                    </div>
                  )}
                  {mediaItem?.lastFrameT2iPrompt && (
                    <div className="rounded-md bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 px-2.5 py-2">
                      <p className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 mb-1">尾帧 T2I（最终发送）</p>
                      <p className="text-[11px] text-indigo-900 dark:text-indigo-200 leading-relaxed break-all select-all">{mediaItem.lastFrameT2iPrompt}</p>
                    </div>
                  )}
                  {shot.firstFramePrompt && (
                    <div className="rounded-md bg-muted/50 px-2.5 py-2">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">首帧原始 Prompt（分镜）</p>
                      <p className="text-[11px] text-foreground/80 leading-relaxed break-all select-all">{shot.firstFramePrompt}</p>
                    </div>
                  )}
                  {shot.lastFramePrompt && (
                    <div className="rounded-md bg-muted/50 px-2.5 py-2">
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">尾帧原始 Prompt（分镜）</p>
                      <p className="text-[11px] text-foreground/80 leading-relaxed break-all select-all">{shot.lastFramePrompt}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {qc && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">画面质检</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: '总分', value: typeof qc.score === 'number' ? qc.score.toFixed(1) : '-' },
                    { label: '人物一致性', value: typeof qc.identityScore === 'number' ? qc.identityScore.toFixed(1) : '-' },
                    { label: '风格一致性', value: typeof qc.styleScore === 'number' ? qc.styleScore.toFixed(1) : '-' },
                    { label: '构图可读性', value: typeof qc.readabilityScore === 'number' ? qc.readabilityScore.toFixed(1) : '-' },
                    { label: '重试次数', value: String(qc.attempts ?? 1) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md bg-muted/50 px-2 py-1.5">
                      <p className="text-[10px] text-muted-foreground">{item.label}</p>
                      <p className="text-[11px] font-medium mt-0.5">{item.value}</p>
                    </div>
                  ))}
                </div>
                {qc.failReasons?.length ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">
                    归因：{qc.failReasons.map((x) => FIX_TARGET_LABELS[x]).join('、')}
                  </p>
                ) : null}
                {qc.issues?.length ? (
                  <p className="text-[11px] text-red-600 dark:text-red-300 mt-1.5">
                    问题：{qc.issues.join('；')}
                  </p>
                ) : null}
              </div>
            )}

            {/* 台词 */}
            {shot.dialogue?.text && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">台词</p>
                <div className="pl-3 border-l-2 border-violet-300 dark:border-violet-700">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {charNames.get(shot.dialogue.characterId) ?? shot.dialogue.characterId}
                    {shot.dialogue.isVoiceover && <span className="ml-1 font-normal text-muted-foreground">（画外音）</span>}
                    {shot.dialogue.isInnerThought && <span className="ml-1 font-normal text-muted-foreground">（内心独白）</span>}
                  </p>
                  <p className="text-xs mt-0.5 text-foreground/90 leading-relaxed">{shot.dialogue.text}</p>
                </div>
              </div>
            )}

            {/* 动作状态 */}
            {shot.characters?.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">动作状态</p>
                <div className="space-y-1">
                  {shot.characters.map((c, ci) => (
                    <div key={ci} className="text-xs flex items-start gap-2">
                      <span className="shrink-0 font-medium">{charNames.get(c.characterId) ?? c.characterId}</span>
                      <span className="text-muted-foreground flex-1">{c.action}</span>
                      {c.emotion && <span className="shrink-0 text-amber-600 dark:text-amber-400 text-[10px]">（{c.emotion}）</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 摄影参数 */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">摄影参数</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: '景别', value: ANGLE_LABELS[shot.camera?.angle] ?? shot.camera?.angle },
                  { label: '镜头运动', value: MOVEMENT_LABELS[shot.camera?.movement] ?? shot.camera?.movement },
                  { label: '构图', value: COMPOSITION_LABELS[shot.camera?.composition] ?? shot.camera?.composition },
                  { label: '景深', value: DEPTH_LABELS[shot.camera?.depthOfField] ?? shot.camera?.depthOfField },
                  shot.specialTechnique ? { label: '特殊手法', value: SPECIAL_TECHNIQUES.find(t => t.value === shot.specialTechnique)?.label } : null,
                ].map(item => item?.value ? (
                  <div key={item.label} className="rounded-md bg-muted/50 px-2 py-1.5">
                    <p className="text-[10px] text-muted-foreground">{item.label}</p>
                    <p className="text-[11px] font-medium mt-0.5">{item.value}</p>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* 引用信息 */}
            {(shot.sceneId || shot.characters?.length > 0) && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">引用信息</p>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {shot.sceneId && locNames.get(shot.sceneId) && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 px-2 py-0.5">
                      <MapPin className="h-2.5 w-2.5" />{locNames.get(shot.sceneId)}
                    </span>
                  )}
                  {shot.characters?.map(c => (
                    <span key={c.characterId} className="inline-flex items-center gap-1 rounded-md bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 px-2 py-0.5">
                      {charNames.get(c.characterId) ?? c.characterId}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 字幕 */}
            {shot.subtitle?.text && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">字幕</p>
                <div className={cn('rounded-md px-2.5 py-2 text-xs', SUBTITLE_STYLE_COLORS[shot.subtitle.style] ?? 'bg-muted/50')}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-medium">{SUBTITLE_STYLE_LABELS[shot.subtitle.style] ?? shot.subtitle.style}</span>
                    {shot.subtitle.karaoke && <span className="text-[10px] bg-white/60 dark:bg-black/30 px-1 py-0.5 rounded">逐字显示</span>}
                  </div>
                  <p className={cn('leading-relaxed', shot.subtitle.style === 'whisper' && 'italic opacity-80', shot.subtitle.style === 'scream' && 'font-bold text-base')}>{shot.subtitle.text}</p>
                </div>
              </div>
            )}

            {/* 音效 */}
            {(shot.audio?.bgm?.mood || (shot.audio?.sfx?.length ?? 0) > 0 || shot.audio?.ambience || shot.audio?.dramaticSilence) && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Music className="h-3 w-3" />音频设计
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {shot.audio?.bgm?.mood && (
                    <div className="rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-2 py-1.5 col-span-2">
                      <p className="text-[10px] text-indigo-600 dark:text-indigo-400 flex items-center gap-1"><Volume2 className="h-2.5 w-2.5" />BGM</p>
                      <p className="text-[11px] font-medium mt-0.5">{shot.audio.bgm.mood} · 强度 {(shot.audio.bgm.intensity * 100).toFixed(0)}%</p>
                    </div>
                  )}
                  {shot.audio?.ambience && (
                    <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5">
                      <p className="text-[10px] text-emerald-600 dark:text-emerald-400">环境音</p>
                      <p className="text-[11px] font-medium mt-0.5">{shot.audio.ambience}</p>
                    </div>
                  )}
                  {shot.audio?.dramaticSilence && (
                    <div className="rounded-md bg-gray-50 dark:bg-gray-800/50 px-2 py-1.5">
                      <p className="text-[10px] text-gray-600 dark:text-gray-400 flex items-center gap-1"><VolumeX className="h-2.5 w-2.5" />戏剧性静默</p>
                      <p className="text-[11px] font-medium mt-0.5">
                        {shot.audio.dramaticSilence.durationSec ? `${shot.audio.dramaticSilence.durationSec}s` : ''}
                        {shot.audio.dramaticSilence.trigger ? ` · ${shot.audio.dramaticSilence.trigger}` : ''}
                      </p>
                    </div>
                  )}
                  {shot.audio?.sfx?.map((sfx, si) => (
                    <div key={si} className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5">
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">SFX</p>
                      <p className="text-[11px] font-medium mt-0.5">{sfx.sound}</p>
                      <p className="text-[10px] text-muted-foreground">{sfx.trigger}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 底部 */}
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
              <span className="flex items-center gap-0.5"><Timer className="h-2.5 w-2.5" />{shot.estimatedDurationSec}s</span>
              {(shot.trimInSec != null || shot.trimOutSec != null) && (
                <span className="flex items-center gap-0.5 text-pink-600 dark:text-pink-400">
                  <Scissors className="h-2.5 w-2.5" />
                  裁剪 {shot.trimInSec != null ? `入${shot.trimInSec}s` : ''}{shot.trimOutSec != null ? ` 出${shot.trimOutSec}s` : ''}
                </span>
              )}
              <span>转场：{shot.transitionToNext === 'cut' ? '切换' : shot.transitionToNext === 'fade_black' ? '黑场淡出' : shot.transitionToNext === 'dissolve' ? '溶解' : shot.transitionToNext === 'match_cut' ? '匹配剪辑' : shot.transitionToNext}</span>
              {shot.cutPointHint && <span className="text-pink-500">✂ {CUT_POINT_LABELS[shot.cutPointHint] ?? shot.cutPointHint}</span>}
              {shot.isFlashback && <span className="text-amber-500">◆ 闪回</span>}
            </div>

            {/* 修改记录 */}
            {shot.isHumanEdited && (
              <div className="rounded-md bg-violet-50 dark:bg-violet-900/20 px-2.5 py-1.5 flex items-center gap-2 text-[10px] text-violet-700 dark:text-violet-400">
                <Lock className="h-3 w-3 shrink-0" />
                <span>人工锁定 · AI 重跑将跳过此镜头</span>
              </div>
            )}

            {/* 编辑入口 */}
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 text-xs h-7 border-dashed"
              onClick={() => setEditing(true)}
            >
              {shot.isHumanEdited
                ? <><Unlock className="h-3 w-3" />重新编辑此镜头</>
                : <><Pencil className="h-3 w-3" />人工编辑此镜头</>}
            </Button>
          </div>
        )}

        {/* ── 编辑面板 ── */}
        {editing && (
          <ShotEditPanel
            shot={shot}
            dramaId={dramaId}
            episodeNumber={episodeNumber}
            onSaved={handleSaved}
            onCancel={() => setEditing(false)}
          />
        )}
      </CardContent>
    </Card>
  );
};

// ─── CharacterPromptPanel ─────────────────────────────────────────────────────

/**
 * 复现后端 drama.service.ts buildAssetStylePrefix 角色分支逻辑：
 * 优先 characterStylePrompt → styleReferencePrompt → 最小 fallback（不含 colorGrading/lightingStyle）
 */
function buildAssetStylePrefix(vs?: Record<string, unknown>): string {
  if (!vs) return '';
  const charRef = ((vs.characterStylePrompt as string) ?? '').trim();
  if (charRef) return charRef + ', ';
  const styleRef = ((vs.styleReferencePrompt as string) ?? '').trim();
  if (styleRef) return styleRef + ', ';
  const parts = [vs.overallAesthetic, vs.renderTechnique, vs.referenceStyle]
    .filter(Boolean).map((p) => (p as string).trim()).filter(Boolean);
  return parts.length ? parts.join(', ') + ', ' : '';
}

/** 复现后端 rendering-profile.ts ageToT2IPhrase 逻辑 */
function ageToT2IPhrase(age?: string): string {
  if (!age) return '';
  const s = String(age).trim();
  const numMatch = s.match(/\d+/);
  let n: number;
  if (numMatch) {
    n = parseInt(numMatch[0], 10);
  } else {
    n = NaN;
  }
  if (!isNaN(n)) {
    if (n <= 0 || n > 120) return '';
    if (n < 18) return 'young, teenage appearance';
    if (n < 35) return `around ${n} years old, young adult`;
    if (n < 55) return `around ${n} years old, middle-aged, mature features`;
    return `around ${n} years old, mature, older adult features`;
  }
  const lower = s.toLowerCase();
  if (/少年|teen|young\s*man|young\s*woman/i.test(lower) || /幼|少/.test(s)) return 'young, teenage appearance';
  if (/青年|young\s*adult|二十|三十|20s|30s/i.test(lower)) return 'young adult';
  if (/中年|middle|四十|五十|40s|50s|mid\s*age/i.test(lower)) return 'middle-aged, mature features';
  if (/老年|elder|old|六十|七十|60s|70s|senior/i.test(lower)) return 'mature, older adult features';
  return '';
}

/** 复现后端 rendering-profile.ts buildViewAnglePrompt 完整逻辑（含 agePhrase） */
function buildViewAnglePrompt(char: any, viewAngle: string): string {
  const face = (char.faceReferencePrompt ?? '').trim();
  const body = (char.bodyTypePrompt || char.bodyType || '').trim();
  const hair = (char.hairStylePrompt || char.hairStyle || '').trim();
  const costume = (char.defaultCostumePrompt || char.defaultCostume || '').trim();
  // 始终从 age 字段推导年龄词（取范围最小值），agePrompt 仅作兜底
  const agePhrase = (ageToT2IPhrase(char.age) || (char.agePrompt && (char.agePrompt as string).trim()) || '').trim();
  const opt = (s: string) => s || '';
  switch (viewAngle) {
    case 'face_front':
      return [face, opt(agePhrase), opt(hair), costume ? `wearing ${costume}` : '', opt(body), 'front-facing, looking at camera, neutral plain background, character reference sheet portrait']
        .filter(Boolean).join(', ');
    case 'face_three_quarter':
      return [
        'three quarter view portrait, same person, slightly turned',
        face, opt(agePhrase), opt(hair), costume ? `wearing ${costume}` : '', opt(body), 'neutral background',
      ].filter(Boolean).join(', ');
    case 'upper_body_front':
      return `upper body portrait, same person, ${face}${agePhrase ? `, ${agePhrase}` : ''}${costume ? `, wearing ${costume}` : ''}${body ? `, ${body} build` : ''}, neutral background`;
    case 'full_body_front':
      return `full body standing portrait, same person, ${face}${agePhrase ? `, ${agePhrase}` : ''}${body ? `, ${body} build` : ''}${hair ? `, ${hair}` : ''}${costume ? `, wearing ${costume}` : ''}, neutral studio background`;
    case 'side_profile':
      return `side profile portrait, same person${agePhrase ? `, ${agePhrase}` : ''}${hair ? `, ${hair}` : ''}${body ? `, ${body} build` : ''}${costume ? `, wearing ${costume}` : ''}, neutral background`;
    case 'back_view':
      return `back view, same person from behind${agePhrase ? `, ${agePhrase}` : ''}${hair ? `, ${hair}` : ''}${body ? `, ${body} build` : ''}${costume ? `, wearing ${costume}` : ''}, neutral background`;
    case 'face_happy':
      return [face, opt(agePhrase), opt(hair), costume ? `wearing ${costume}` : '', opt(body), 'happy expression, genuine slight smile, pleased and warm, subtle not exaggerated, same facial bone structure, front-facing, looking at camera, neutral background']
        .filter(Boolean).join(', ');
    case 'face_angry':
      return [face, opt(agePhrase), opt(hair), costume ? `wearing ${costume}` : '', opt(body), 'angry expression, furrowed brows, sharp stern gaze, controlled tension in eyes, not distorted, same facial bone structure, front-facing, looking at camera, neutral background']
        .filter(Boolean).join(', ');
    default:
      return face;
  }
}

/**
 * 复现后端 prompt-optimizer.service.ts optimizeForT2I 对 Volcengine Seedream 的质量 booster：
 *   provider boosters: cinematic lighting, rich color depth（volcengine 专属）
 *   + golden tier extra（按 shotType 不同）
 *   注意：Seedream profile 的 qualityPrefix / qualitySuffix 均为空字符串，
 *   质量词完全由 optimizeForT2I 注入，assembleT2iPrompt 不再追加。
 */
const CHAR_QUALITY_BOOSTERS  = 'cinematic lighting, rich color depth, cinematic composition, dramatic atmosphere';
const SCENE_QUALITY_BOOSTERS = 'cinematic lighting, rich color depth, cinematic composition, no human subjects, environmental photography';

const VIEW_ANGLE_PANEL_LABELS: Record<string, string> = {
  face_front: '正面特写',
  face_three_quarter: '3/4 侧面',
  upper_body_front: '上半身',
  full_body_front: '全身',
  side_profile: '侧面',
  back_view: '背面',
  face_happy: '表情·喜',
  face_angry: '表情·怒',
};

const CharacterPromptPanel: React.FC<{ char: Character; visualStyle?: Record<string, unknown> }> = ({ char, visualStyle }) => {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const anyChar = char as any;

  const hasPrompts = !!(char.faceReferencePrompt || anyChar.bodyTypePrompt || anyChar.hairStylePrompt || anyChar.defaultCostumePrompt || anyChar.appearanceHint);
  if (!hasPrompts) return null;

  const stylePrefix = buildAssetStylePrefix(visualStyle);

  const viewAngles = ['face_front', 'face_three_quarter', 'upper_body_front', 'full_body_front', 'side_profile', 'back_view', 'face_happy', 'face_angry'];
  const assembledPrompts = viewAngles.map((view) => {
    const raw = buildViewAnglePrompt(anyChar, view);
    if (!raw) return null;
    const optimized = `${raw}, ${CHAR_QUALITY_BOOSTERS}`;
    const full = stylePrefix ? `${stylePrefix}${optimized}` : optimized;
    return { view, label: VIEW_ANGLE_PANEL_LABELS[view] ?? view, full };
  }).filter(Boolean) as Array<{ view: string; label: string; full: string }>;

  const rawFields: Array<{ label: string; value: string; hint: string }> = [
    { label: '面部生成提示词', value: char.faceReferencePrompt ?? '', hint: '注入：所有角色参考图生成' },
    { label: '年龄提示词', value: anyChar.agePrompt || ageToT2IPhrase(char.age), hint: '注入：所有角色参考图（agePrompt 优先，其次 age 转换）' },
    { label: '体型提示词', value: anyChar.bodyTypePrompt ?? '', hint: '注入：全身图 / storyboard T2I' },
    { label: '发型提示词', value: anyChar.hairStylePrompt ?? '', hint: '注入：角色参考图生成' },
    { label: '服装提示词', value: anyChar.defaultCostumePrompt ?? '', hint: '注入：全身图 / storyboard T2I' },
    { label: '综合外貌提示词', value: anyChar.appearanceHint ?? '', hint: '注入：episode-director 新角色声明' },
  ].filter((p) => p.value);

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800/50 overflow-hidden">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
      >
        <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
          <Lock className="h-3 w-3" />
          图片生成提示词
        </span>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-blue-500" />
          : <ChevronDown className="h-3 w-3 text-blue-500" />}
      </button>
      {expanded && (
        <div className="bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-2 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-blue-500/80 dark:text-blue-400/60">由 Profiler Agent 建剧时自动生成，注入图像生成管线。如需调整，请通过「精修」功能指定自定义提示词。</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowRaw((v) => !v); }}
              className="shrink-0 ml-2 text-[9px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
            >
              {showRaw ? '查看完整 Prompt' : '查看原子字段'}
            </button>
          </div>

          {showRaw ? (
            rawFields.map(({ label, value, hint }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400">{label}</p>
                  <span className="text-[9px] text-blue-400/70">{hint}</span>
                </div>
                <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono">{value}</p>
              </div>
            ))
          ) : (
            <>
              <p className="text-[10px] text-blue-500/70 dark:text-blue-400/50">以下为实际发送给 Seedream 5.0 的完整 Prompt（风格前缀 + 视角原子 + Volcengine quality boosters），按视角展示：</p>
              {assembledPrompts.map(({ view, label, full }) => (
                <div key={view}>
                  <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">{label}</p>
                  <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono">{full}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── LocationPromptPanel ──────────────────────────────────────────────────────

/** 复现后端 buildAssetStylePrefix location 分支逻辑（优先 styleReferencePrompt） */
function buildSceneStylePrefix(vs?: Record<string, unknown>): string {
  if (!vs) return '';
  const styleRef = ((vs.styleReferencePrompt as string) ?? '').trim();
  if (styleRef) return styleRef + ', ';
  const parts = [vs.overallAesthetic, vs.renderTechnique, vs.textureStyle, vs.colorGrading, vs.lightingStyle, vs.referenceStyle]
    .filter(Boolean).map((p) => (p as string).trim()).filter(Boolean);
  return parts.length ? parts.join(', ') + ', ' : '';
}

/** 复现后端 rendering-profile.ts buildLocationViewPrompt 逻辑 */
function buildLocViewPromptFE(loc: Location, viewAngle: string): string {
  const base = (loc.visualPrompt || loc.description || '').trim();
  if (!base) return '';
  const lighting = loc.lightingDefault ? `, ${loc.lightingDefault} lighting` : '';
  const color = loc.colorTone ? `, ${loc.colorTone} color tone` : '';
  switch (viewAngle) {
    case 'establishing':
      return `wide establishing shot, ${base}${lighting}${color}, full environment overview, architectural perspective, no people`;
    case 'interior_medium':
      return `medium shot interior view, ${base}${lighting}${color}, same location as reference, different angle showing central area, no people`;
    case 'detail_close':
      return `close-up detail shot, ${base}${lighting}${color}, same location as reference, focusing on textures and key props, atmospheric detail, no people`;
    default:
      return base;
  }
}

const LOCATION_VIEW_PANEL_LABELS: Record<string, string> = {
  establishing: '全景',
  interior_medium: '中景',
  detail_close: '细节特写',
};

const LocationPromptPanel: React.FC<{ loc: Location; visualStyle?: Record<string, unknown> }> = ({ loc, visualStyle }) => {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (!loc.visualPrompt) return null;

  const stylePrefix = buildSceneStylePrefix(visualStyle);

  const viewAngles = ['establishing', 'interior_medium', 'detail_close'];
  const assembledPrompts = viewAngles.map((view) => {
    const raw = buildLocViewPromptFE(loc, view);
    if (!raw) return null;
    const optimized = `${raw}, ${SCENE_QUALITY_BOOSTERS}`;
    const full = stylePrefix ? `${stylePrefix}${optimized}` : optimized;
    return { view, label: LOCATION_VIEW_PANEL_LABELS[view] ?? view, full };
  }).filter(Boolean) as Array<{ view: string; label: string; full: string }>;

  return (
    <div className="rounded-md border border-blue-200 dark:border-blue-800/50 overflow-hidden">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
      >
        <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
          <Lock className="h-3 w-3" />
          图片生成提示词
        </span>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-blue-500" />
          : <ChevronDown className="h-3 w-3 text-blue-500" />}
      </button>
      {expanded && (
        <div className="bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-2 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-blue-500/80 dark:text-blue-400/60">由 Visual Asset Designer 建剧时自动生成，注入图像生成管线。如需调整，请通过「精修」功能指定自定义提示词。</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowRaw((v) => !v); }}
              className="shrink-0 ml-2 text-[9px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
            >
              {showRaw ? '查看完整 Prompt' : '查看原始提示词'}
            </button>
          </div>

          {showRaw ? (
            <div>
              <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">场景视觉提示词</p>
              <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono">{loc.visualPrompt}</p>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-blue-500/70 dark:text-blue-400/50">以下为实际发送给 Seedream 5.0 的完整 Prompt（风格前缀 + 视角原子 + Volcengine quality boosters），按视角展示：</p>
              {assembledPrompts.map(({ view, label, full }) => (
                <div key={view}>
                  <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">{label}</p>
                  <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono">{full}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ─── VariationItem ────────────────────────────────────────────────────────────

const VariationItem: React.FC<{
  variation: CharacterVariation;
  imageUrl?: string;
  busy?: boolean;
  onRegenerate: () => void;
}> = ({ variation: v, imageUrl: vImg, busy: vBusy = false, onRegenerate }) => {
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden bg-background">
      {vImg ? (
        <img src={vImg} alt={v.name} className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="w-full aspect-[3/4] bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground">
          待生成
        </div>
      )}
      <div className="p-1.5 space-y-1">
        <p className="text-[11px] font-medium truncate">{v.name}</p>
        {v.costume && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">{v.costume}</p>
        )}
        {v.visualPromptOverride && (
          <div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowPrompt((p) => !p); }}
              className="text-[9px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 underline underline-offset-2"
            >
              {showPrompt ? '收起提示词' : '图片提示词 ↓'}
            </button>
            {showPrompt && (
              <p className="text-[10px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono mt-1 bg-blue-50 dark:bg-blue-950/30 rounded p-1.5">
                {v.visualPromptOverride}
              </p>
            )}
          </div>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] gap-1 w-full"
          disabled={vBusy}
          onClick={onRegenerate}
        >
          {vBusy
            ? <><Loader2 className="h-3 w-3 animate-spin" />生成中</>
            : vImg
              ? <><RotateCcw className="h-3 w-3" />重新生成</>
              : <><Wand2 className="h-3 w-3" />生成</>}
        </Button>
      </div>
    </div>
  );
};

// ─── CharacterCard ────────────────────────────────────────────────────────────

const CharacterCard: React.FC<{
  char: Character;
  imageUrl?: string;
  viewImages?: Array<{ viewAngle: string; imageUrl: string }>;
  busy?: boolean;
  visualStyle?: Record<string, unknown>;
  variationImages?: Map<string, string>;
  variationBusyKeys?: Set<string>;
  onRegenerate: (viewAngle?: string) => void;
  onRefine: (input: {
    viewAngle?: string;
    syncScope: VisualAssetRefineSyncScope;
    strength: VisualAssetRefineStrength;
    instruction: string;
  }) => void;
  onRegenerateVariation?: (variationId: string) => void;
}> = ({ char, imageUrl, viewImages, busy = false, visualStyle, variationImages, variationBusyKeys, onRegenerate, onRefine, onRegenerateVariation }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeViewAngle, setActiveViewAngle] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [refineViewAngle, setRefineViewAngle] = useState('');
  const [syncScope, setSyncScope] = useState<ViewSyncScope>('group');
  const [editStrength, setEditStrength] = useState<ViewEditStrength>('balanced');
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    if (prevBusyRef.current && !busy) setExpanded(true);
    prevBusyRef.current = busy;
  }, [busy]);
  const roleStyle = ROLE_STYLES[char.role] ?? ROLE_STYLES.minor;
  const resolvedViews = useMemo(() => {
    const role = normalizeCharRole(char.role);
    const expected = CHAR_VIEWS_BY_ROLE[role] ?? ['face_front'];
    return sortViewImages(mergeExpectedViews(viewImages, expected, imageUrl));
  }, [imageUrl, viewImages, char.role]);
  const viewImageMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of resolvedViews) {
      if (item?.viewAngle && item?.imageUrl) map.set(item.viewAngle, item.imageUrl);
    }
    if (imageUrl && !map.has('face_front')) map.set('face_front', imageUrl);
    return map;
  }, [imageUrl, resolvedViews]);
  const availableViews = useMemo(() => resolvedViews.map((vi) => vi.viewAngle), [resolvedViews]);
  const selectedView = activeViewAngle || resolvedViews[0]?.viewAngle || '';
  const selectedViewLabel = selectedView ? (VIEW_ANGLE_LABELS[selectedView] ?? selectedView) : '未选择';
  const anchorView = availableViews.includes('face_front') ? 'face_front' : (availableViews[0] ?? '');
  const anchorViewLabel = anchorView ? (VIEW_ANGLE_LABELS[anchorView] ?? anchorView) : '未定义';

  useEffect(() => {
    if (resolvedViews.length === 0) {
      if (activeViewAngle) setActiveViewAngle('');
      return;
    }
    if (!activeViewAngle || !availableViews.includes(activeViewAngle)) {
      setActiveViewAngle(resolvedViews[0].viewAngle);
    }
  }, [activeViewAngle, availableViews, resolvedViews]);

  const openRefineDialog = () => {
    const targetView = selectedView || 'face_front';
    setRefineViewAngle(targetView);
    setRefineInstruction('');
    setRefineOpen(true);
  };

  const submitRefine = () => {
    const instruction = refineInstruction.trim();
    if (!instruction) {
      message.warning('请先输入精修要求');
      return;
    }
    const targetView = refineViewAngle || selectedView || 'face_front';
    onRefine({
      viewAngle: targetView,
      syncScope,
      strength: editStrength,
      instruction,
    });
    setRefineOpen(false);
  };

  const refineTargetView = refineViewAngle || selectedView || 'face_front';
  const refinePreviewUrl = viewImageMap.get(refineTargetView) || imageUrl || '';
  const refinePreviewLabel = VIEW_ANGLE_LABELS[refineTargetView] ?? refineTargetView;
  const plannedViews = resolveAffectedViews(
    refineTargetView,
    syncScope,
    availableViews.length ? availableViews : [refineTargetView],
  );

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-3 space-y-2">
          <button type="button" className="w-full text-left flex items-start gap-3" onClick={() => setExpanded(e => !e)}>
            {imageUrl ? (
              <img src={imageUrl} alt={char.name} className="w-9 h-9 rounded-full object-cover shrink-0 ring-2 ring-violet-200 dark:ring-violet-800" />
            ) : (
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-sm font-bold shrink-0">
                {char.name.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold">{char.name}</p>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', roleStyle.className)}>{roleStyle.label}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{char.faceDescription}</p>
            </div>
            <div className="shrink-0 mt-0.5">
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </button>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              disabled={busy}
              onClick={() => onRegenerate(selectedView || 'face_front')}
            >
              {busy
                ? <><Loader2 className="h-3 w-3 animate-spin" />生成中</>
                : (imageUrl || resolvedViews.length > 0)
                  ? <><RotateCcw className="h-3 w-3" />重新生成</>
                  : <><Wand2 className="h-3 w-3" />生成</>}
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={busy}
              onClick={openRefineDialog}
            >
              <Pencil className="h-3 w-3" />精修
            </Button>
            {selectedView && (
              <span className="text-[10px] text-muted-foreground">
                当前视角：{VIEW_ANGLE_LABELS[selectedView] ?? selectedView}
              </span>
            )}
          </div>

          {expanded && (
            <div className="pt-2 border-t border-border/40 space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
              {resolvedViews.length > 1 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground">多角度参考图（点击选择当前视角）</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {resolvedViews.map((vi) => (
                      <button
                        key={vi.viewAngle}
                        type="button"
                        onClick={() => setActiveViewAngle(vi.viewAngle)}
                        className={cn(
                          'rounded-lg overflow-hidden border text-left transition-colors',
                          selectedView === vi.viewAngle
                            ? 'border-violet-500 ring-1 ring-violet-300 dark:ring-violet-700'
                            : 'border-border/60 hover:border-violet-300',
                        )}
                      >
                        {vi.imageUrl ? (
                          <img src={vi.imageUrl} alt={`${char.name} ${vi.viewAngle}`} className="w-full aspect-[3/4] object-cover" />
                        ) : (
                          <div className="w-full aspect-[3/4] bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground">
                            待生成
                          </div>
                        )}
                        <p className="text-[10px] text-center text-muted-foreground py-0.5 bg-background">
                          {VIEW_ANGLE_LABELS[vi.viewAngle] ?? vi.viewAngle}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : imageUrl ? (
                <div className="rounded-lg overflow-hidden bg-muted mb-1.5">
                  <img src={imageUrl} alt={char.name} className="w-full object-cover max-h-52" />
                </div>
              ) : null}

              {resolvedViews.length > 0 && (
                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground">
                    锚点：{anchorViewLabel} · 当前视角：{selectedViewLabel}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    点击「精修」进入编辑面板；展示区仅用于查看与选中视角。
                  </p>
                </div>
              )}

              {(char.faceReferencePrompt || (char as any).bodyTypePrompt || (char as any).hairStylePrompt || (char as any).defaultCostumePrompt || (char as any).appearanceHint) && (
                <CharacterPromptPanel char={char} visualStyle={visualStyle} />
              )}
              {char.age && <p><span className="text-muted-foreground">年龄：</span>{char.age}</p>}
              {char.hairStyle && <p><span className="text-muted-foreground">发型：</span>{char.hairStyle}</p>}
              {char.skinTone && <p><span className="text-muted-foreground">肤色：</span>{char.skinTone}</p>}
              {char.bodyType && <p><span className="text-muted-foreground">体型：</span>{char.bodyType}</p>}
              {char.defaultCostume && <p><span className="text-muted-foreground">默认服装：</span>{char.defaultCostume}</p>}
              {char.distinguishingFeatures && <p><span className="text-muted-foreground">标志特征：</span>{char.distinguishingFeatures}</p>}
              {char.voiceProfile?.timbre && <p><span className="text-muted-foreground">音色：</span>{char.voiceProfile.timbre}</p>}
              {char.voiceProfile?.speakingStyle && <p><span className="text-muted-foreground">配音风格：</span>{char.voiceProfile.speakingStyle}</p>}
              {char.voiceProfile?.catchphrase && (
                <p><span className="text-muted-foreground">口头禅：</span><span className="italic">&quot;{char.voiceProfile.catchphrase}&quot;</span></p>
              )}

              {char.soulProfile && Object.values(char.soulProfile).some(Boolean) && (
                <div className="pt-2 border-t border-border/40">
                  <p className="text-[10px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                    <Brain className="h-3 w-3" />灵魂人设
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {SOUL_PROFILE_FIELDS.map(({ key, label, icon }) => {
                      const val = char.soulProfile?.[key];
                      if (!val || (Array.isArray(val) && val.length === 0)) return null;
                      return (
                        <div key={key} className="rounded-md bg-muted/50 px-2 py-1.5">
                          <p className="text-[10px] text-muted-foreground">{icon} {label}</p>
                          <p className="text-[11px] font-medium mt-0.5">{String(val)}</p>
                        </div>
                      );
                    })}
                    {char.soulProfile.emotionalTriggers?.length ? (
                      <div className="rounded-md bg-muted/50 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">🎭 情绪触发点</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {char.soulProfile.emotionalTriggers.map((t, i) => (
                            <span key={i} className="text-[10px] bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {char.soulProfile.behavioralHabits?.length ? (
                      <div className="rounded-md bg-muted/50 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">🔁 行为习惯</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {char.soulProfile.behavioralHabits.map((h, i) => (
                            <span key={i} className="text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded">{h}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {char.variations && char.variations.length > 0 && (
                <div className="pt-2 border-t border-border/40">
                  <p className="text-[10px] font-semibold text-muted-foreground mb-2">服装变体（衣橱）</p>
                  <div className="grid grid-cols-2 gap-2">
                    {char.variations.map((v) => (
                      <VariationItem
                        key={v.variationId}
                        variation={v}
                        imageUrl={variationImages?.get(v.variationId)}
                        busy={variationBusyKeys?.has(`${char.characterId}:${v.variationId}`) || busy}
                        onRegenerate={() => onRegenerateVariation?.(v.variationId)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={refineOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setRefineOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>精修角色图：{char.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-4 items-start">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">目标视角</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(availableViews.length ? availableViews : ['face_front']).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setRefineViewAngle(view)}
                      className={cn(
                        'px-2 py-1 rounded-md border text-xs transition-colors',
                        refineTargetView === view
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-background text-muted-foreground border-border hover:text-foreground',
                      )}
                    >
                      {VIEW_ANGLE_LABELS[view] ?? view}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">精修要求</Label>
                <Textarea
                  className="min-h-[88px] text-xs"
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  placeholder="例如：衣服改为墨绿色丝绸，保持脸型和发型不变，光线更自然"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">同步范围</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {VIEW_SYNC_SCOPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSyncScope(opt.value)}
                        className={cn(
                          'px-2 py-1 rounded-md border text-xs transition-colors',
                          syncScope === opt.value
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground',
                        )}
                        title={opt.hint}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">修改强度</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {VIEW_EDIT_STRENGTH_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEditStrength(opt.value)}
                        className={cn(
                          'px-2 py-1 rounded-md border text-xs transition-colors',
                          editStrength === opt.value
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                预计影响：{plannedViews.map((v) => VIEW_ANGLE_LABELS[v] ?? v).join('、') || '仅当前'} · {VIEW_EDIT_STRENGTH_HINTS[editStrength]}
              </p>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefineOpen(false)}>
                  取消
                </Button>
                <Button size="sm" disabled={busy || !refineInstruction.trim()} onClick={submitRefine}>
                  {busy ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />提交中</> : '提交精修'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">当前预览：{refinePreviewLabel}</p>
              <div className="rounded-lg border border-border/70 overflow-hidden bg-muted aspect-[3/4]">
                {refinePreviewUrl ? (
                  <img
                    src={refinePreviewUrl}
                    alt={`${char.name} ${refinePreviewLabel}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    当前视角暂无图片
                  </div>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                切换左侧“目标视角”时，右侧预览会同步切换，避免盲改。
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ─── PropCard ─────────────────────────────────────────────────────────────────

const PropCard: React.FC<{
  prop: VisualAssetItem;
  busy?: boolean;
  onRegenerate: () => void;
  onRefine: (instruction: string) => void;
}> = ({ prop, busy = false, onRegenerate, onRefine }) => {
  const [refineOpen, setRefineOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const imageUrl = prop.referenceImageUrl;
  const propData = prop.data as {
    name?: string; description?: string; visualPrompt?: string;
    locationName?: string; locationId?: string;
  };

  const handleRefine = () => {
    const text = instruction.trim();
    if (!text) { message.warning('请先输入精修要求'); return; }
    onRefine(text);
    setRefineOpen(false);
  };

  return (
    <>
      <Card className="overflow-hidden flex flex-col">
        {/* Prop image */}
        <div className="relative aspect-square bg-muted/40 overflow-hidden">
          {imageUrl ? (
            <img src={imageUrl} alt={prop.name} className="w-full h-full object-cover" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
              <span className="text-2xl">📦</span>
              <span className="text-[10px]">待生成</span>
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
            </div>
          )}
        </div>
        {/* Info */}
        <CardContent className="p-2.5 flex-1 flex flex-col gap-1.5">
          <div>
            <p className="text-xs font-semibold leading-tight">{prop.name}</p>
            {propData.locationName && (
              <p className="text-[10px] text-muted-foreground mt-0.5">📍 {propData.locationName}</p>
            )}
            {propData.description && (
              <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{propData.description}</p>
            )}
          </div>
          {propData.visualPrompt && (
            <div className="rounded-md border border-blue-200 dark:border-blue-800/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowPrompt((p) => !p)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
              >
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  图片生成提示词
                </span>
                {showPrompt
                  ? <ChevronUp className="h-3 w-3 text-blue-500" />
                  : <ChevronDown className="h-3 w-3 text-blue-500" />}
              </button>
              {showPrompt && (
                <div className="bg-blue-50/50 dark:bg-blue-950/20 px-2.5 py-2">
                  <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed break-all select-all font-mono">{propData.visualPrompt}</p>
                </div>
              )}
            </div>
          )}
          {/* Actions */}
          <div className="flex gap-1 mt-auto pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] flex-1 px-1"
              disabled={busy}
              onClick={onRegenerate}
            >
              <RotateCcw className="h-2.5 w-2.5 mr-1" />重生
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] flex-1 px-1"
              disabled={busy || !imageUrl}
              onClick={() => { setInstruction(''); setRefineOpen(true); }}
            >
              <Wand2 className="h-2.5 w-2.5 mr-1" />精修
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Refine dialog */}
      <Dialog open={refineOpen} onOpenChange={setRefineOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">精修道具：{prop.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {imageUrl && <img src={imageUrl} alt={prop.name} className="w-full rounded-lg object-cover aspect-square" />}
            <div className="space-y-1">
              <Label className="text-xs">精修要求</Label>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="描述需要修改的部分，如：调整材质质感为青铜锈蚀效果..."
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRefineOpen(false)}>取消</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleRefine}>开始精修</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ─── LocationCard ─────────────────────────────────────────────────────────────

const sortLocationViewImages = (items: Array<{ viewAngle: string; imageUrl: string }>) => {
  const order = new Map(LOCATION_VIEW_ORDER.map((v, i) => [v, i]));
  return [...items].sort((a, b) => (order.get(a.viewAngle) ?? 99) - (order.get(b.viewAngle) ?? 99));
};

const LocationCard: React.FC<{
  loc: Location;
  imageUrl?: string;
  viewImages?: Array<{ viewAngle: string; imageUrl: string }>;
  busy?: boolean;
  visualStyle?: Record<string, unknown>;
  onRegenerate: (viewAngle?: string) => void;
  onRefine: (instruction: string, viewAngle?: string) => void;
}> = ({ loc, imageUrl, viewImages, busy = false, visualStyle, onRegenerate, onRefine }) => {
  const [expanded, setExpanded] = useState(false);
  const [activeViewAngle, setActiveViewAngle] = useState('');
  const [refineOpen, setRefineOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [refineViewAngle, setRefineViewAngle] = useState('');

  const resolvedViews = useMemo(() => {
    const expected = loc.isRecurring
      ? ['establishing', 'interior_medium', 'detail_close']
      : ['establishing'];
    return sortLocationViewImages(mergeExpectedViews(viewImages, expected, imageUrl));
  }, [imageUrl, viewImages, loc.isRecurring]);
  const availableViews = useMemo(() => resolvedViews.map((vi) => vi.viewAngle), [resolvedViews]);
  const selectedView = activeViewAngle || resolvedViews[0]?.viewAngle || '';

  useEffect(() => {
    if (resolvedViews.length === 0) {
      if (activeViewAngle) setActiveViewAngle('');
      return;
    }
    if (!activeViewAngle || !availableViews.includes(activeViewAngle)) {
      setActiveViewAngle(resolvedViews[0].viewAngle);
    }
  }, [activeViewAngle, availableViews, resolvedViews]);

  const openRefineDialog = () => {
    setInstruction('');
    setRefineViewAngle(selectedView || 'establishing');
    setRefineOpen(true);
  };
  const handleRefine = () => {
    const text = instruction.trim();
    if (!text) {
      message.warning('请先输入场景精修要求');
      return;
    }
    onRefine(text, refineViewAngle || selectedView || 'establishing');
    setRefineOpen(false);
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div role="button" tabIndex={0} className="w-full text-left cursor-pointer" onClick={() => setExpanded(e => !e)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}>
          <CardContent className="p-3 flex items-start gap-3">
            {imageUrl ? (
              <img src={imageUrl} alt={loc.name} className="w-9 h-9 rounded-lg object-cover shrink-0 ring-2 ring-emerald-200 dark:ring-emerald-800" />
            ) : (
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 shrink-0">
                <MapPin className="h-4 w-4" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold">{loc.name}</p>
                {loc.isRecurring && (
                  <span className="text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">常用</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{loc.description}</p>
              {expanded && (
                <div className="mt-2 space-y-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
                  {resolvedViews.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground">多角度参考图（点击选择当前视角）</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {resolvedViews.map((vi) => (
                          <button
                            key={vi.viewAngle}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setActiveViewAngle(vi.viewAngle); }}
                            className={cn(
                              'rounded-lg overflow-hidden border text-left transition-colors',
                              selectedView === vi.viewAngle
                                ? 'border-emerald-500 ring-1 ring-emerald-300 dark:ring-emerald-700'
                                : 'border-border/60 hover:border-emerald-300',
                            )}
                          >
                            {vi.imageUrl ? (
                              <img src={vi.imageUrl} alt={`${loc.name} ${vi.viewAngle}`} className="w-full aspect-[3/2] object-cover" />
                            ) : (
                              <div className="w-full aspect-[3/2] bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground">
                                待生成
                              </div>
                            )}
                            <p className="text-[10px] text-center text-muted-foreground py-0.5 bg-background">
                              {LOCATION_VIEW_LABELS[vi.viewAngle] ?? vi.viewAngle}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : imageUrl ? (
                    <div className="rounded-lg overflow-hidden bg-muted mb-2">
                      <img src={imageUrl} alt={loc.name} className="w-full object-cover max-h-40" />
                    </div>
                  ) : null}
                  <LocationPromptPanel loc={loc} visualStyle={visualStyle} />
                  {loc.lightingDefault && <p><span className="text-muted-foreground">光线：</span>{loc.lightingDefault}</p>}
                  {loc.colorTone && <p><span className="text-muted-foreground">色调：</span>{loc.colorTone}</p>}
                  {loc.ambientSoundDefault && <p><span className="text-muted-foreground">环境音：</span>{loc.ambientSoundDefault}</p>}
                  {loc.keyProps?.length > 0 && (
                    <p><span className="text-muted-foreground">标志道具：</span>{loc.keyProps.join('、')}</p>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 mt-0.5">
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardContent>
        </div>
        <div className="px-3 pb-3 pt-0 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={busy}
            onClick={() => onRegenerate(selectedView || 'establishing')}
          >
            {busy
              ? <><Loader2 className="h-3 w-3 animate-spin" />生成中</>
              : (imageUrl || resolvedViews.length > 0)
                ? <><RotateCcw className="h-3 w-3" />重新生成</>
                : <><Wand2 className="h-3 w-3" />生成</>}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={busy}
            onClick={openRefineDialog}
          >
            <Pencil className="h-3 w-3" />精修
          </Button>
          {selectedView && (
            <span className="text-[10px] text-muted-foreground">
              当前视角：{LOCATION_VIEW_LABELS[selectedView] ?? selectedView}
            </span>
          )}
        </div>
      </Card>

      <Dialog
        open={refineOpen}
        onOpenChange={(open) => {
          if (busy) return;
          setRefineOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>精修场景图：{loc.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {availableViews.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs">目标视角</Label>
                <div className="flex flex-wrap gap-1.5">
                  {availableViews.map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setRefineViewAngle(view)}
                      className={cn(
                        'px-2 py-1 rounded-md border text-xs transition-colors',
                        (refineViewAngle || selectedView) === view
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-background text-muted-foreground border-border hover:text-foreground',
                      )}
                    >
                      {LOCATION_VIEW_LABELS[view] ?? view}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">精修要求</Label>
              <Textarea
                className="min-h-[88px] text-xs"
                placeholder="例如：改为黄昏暖色调，增加窗外雨丝与地面反光"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefineOpen(false)}>
                取消
              </Button>
              <Button size="sm" disabled={busy || !instruction.trim()} onClick={handleRefine}>
                {busy ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />提交中</> : '提交精修'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ─── WorkshopTab — 创作工坊 ───────────────────────────────────────────────────


interface WorkshopTabProps {
  dramaId: string;
  drama: Record<string, unknown> | null;
  onDramaUpdated: () => void;
  draftNodes: DramaAgentNodeConfig[];
  setDraftNodes: React.Dispatch<React.SetStateAction<DramaAgentNodeConfig[]>>;
  workflowParams: DramaWorkflowParams;
  setWorkflowParams: React.Dispatch<React.SetStateAction<DramaWorkflowParams>>;
  pipeline: DramaPipeline | null;
  setPipeline: React.Dispatch<React.SetStateAction<DramaPipeline | null>>;
  selectedNodeId: string | null;
  setSelectedNodeId: React.Dispatch<React.SetStateAction<string | null>>;
  nodeAdditional: string;
  setNodeAdditional: React.Dispatch<React.SetStateAction<string>>;
  nodeAdditionalSaved: string;
  setNodeAdditionalSaved: React.Dispatch<React.SetStateAction<string>>;
  pipelineSaving: boolean;
  setPipelineSaving: React.Dispatch<React.SetStateAction<boolean>>;
  pipelinePublishing: boolean;
  setPipelinePublishing: React.Dispatch<React.SetStateAction<boolean>>;
  paramsSaving: boolean;
  setParamsSaving: React.Dispatch<React.SetStateAction<boolean>>;
}

const WorkshopTab: React.FC<WorkshopTabProps> = ({
  dramaId, drama, onDramaUpdated, draftNodes, setDraftNodes, workflowParams, setWorkflowParams,
  pipeline, setPipeline, selectedNodeId, setSelectedNodeId,
  nodeAdditional, setNodeAdditional, nodeAdditionalSaved, setNodeAdditionalSaved,
  pipelineSaving, setPipelineSaving, pipelinePublishing, setPipelinePublishing,
  paramsSaving, setParamsSaving,
}) => {
  const selectedNode = draftNodes.find((n) => n.id === selectedNodeId) ?? null;
  const promptProfile = (drama as any)?.state?.promptProfile as Record<string, unknown> | undefined;
  const scriptwriterGuide = promptProfile?.scriptwriterGuide as Record<string, unknown> | undefined;
  const genreArchetype = promptProfile?.genreArchetype as Record<string, unknown> | undefined;
  const visualStyle = (drama as any)?.state?.visualStyle as Record<string, unknown> | undefined;

  // ── 视觉风格编辑状态 ──
  const [vsEditing, setVsEditing] = useState(false);
  const [vsSaving, setVsSaving] = useState(false);
  const [vsForm, setVsForm] = useState<VisualStyleGuideUpdate>({
    overallAesthetic: '', colorGrading: '', lightingStyle: '', era: 'contemporary',
    renderTechnique: '', textureStyle: '', referenceStyle: '', styleReferencePrompt: '',
  });

  useEffect(() => {
    if (visualStyle) {
      setVsForm({
        overallAesthetic: (visualStyle.overallAesthetic as string) ?? '',
        colorGrading: (visualStyle.colorGrading as string) ?? '',
        lightingStyle: (visualStyle.lightingStyle as string) ?? '',
        era: (visualStyle.era as string) ?? 'contemporary',
        renderTechnique: (visualStyle.renderTechnique as string) ?? '',
        textureStyle: (visualStyle.textureStyle as string) ?? '',
        referenceStyle: (visualStyle.referenceStyle as string) ?? '',
        styleReferencePrompt: (visualStyle.styleReferencePrompt as string) ?? '',
      });
    }
  }, [visualStyle]);

  const handleVsSave = async () => {
    setVsSaving(true);
    try {
      const payload: VisualStyleGuideUpdate = {
        overallAesthetic: vsForm.overallAesthetic,
        colorGrading: vsForm.colorGrading,
        lightingStyle: vsForm.lightingStyle,
        era: vsForm.era,
        ...(vsForm.renderTechnique ? { renderTechnique: vsForm.renderTechnique } : {}),
        ...(vsForm.textureStyle ? { textureStyle: vsForm.textureStyle } : {}),
        ...(vsForm.referenceStyle ? { referenceStyle: vsForm.referenceStyle } : {}),
        ...(vsForm.styleReferencePrompt ? { styleReferencePrompt: vsForm.styleReferencePrompt } : {}),
      };
      await updateDramaVisualStyle(dramaId, payload);
      message.success('视觉风格已更新');
      setVsEditing(false);
      onDramaUpdated();
    } catch (err: any) {
      message.error(err?.data?.message || '保存失败');
    } finally {
      setVsSaving(false);
    }
  };

  const isDirty = nodeAdditional !== nodeAdditionalSaved;
  const hasUnpublished = pipeline?.hasDraft ?? false;

  // 基础提示词预览
  const [basePromptCache, setBasePromptCache] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

  // 基础提示词编辑状态
  const [baseEditing, setBaseEditing] = useState(false);
  const [editedBase, setEditedBase] = useState('');
  const [editedBaseSaved, setEditedBaseSaved] = useState('');
  const [baseSaving, setBaseSaving] = useState(false);
  const isBaseDirty = editedBase !== editedBaseSaved;

  useEffect(() => {
    if (!selectedNodeId || !dramaId) return;
    if (basePromptCache[selectedNodeId]) return; // 已缓存
    setPreviewLoading(true);
    getDramaNodePreview(dramaId, selectedNodeId)
      .then(({ basePrompt }) => setBasePromptCache((prev) => ({ ...prev, [selectedNodeId]: basePrompt })))
      .catch(() => setBasePromptCache((prev) => ({ ...prev, [selectedNodeId]: '提示词加载失败' })))
      .finally(() => setPreviewLoading(false));
  }, [dramaId, selectedNodeId, basePromptCache]);

  const handleSelectNode = (node: DramaAgentNodeConfig) => {
    if (isDirty || isBaseDirty) {
      if (!window.confirm('当前有未保存的修改，切换节点会丢弃，确认切换吗？')) return;
    }
    setSelectedNodeId(node.id);
    setNodeAdditional(node.additionalSystemPrompt ?? '');
    setNodeAdditionalSaved(node.additionalSystemPrompt ?? '');
    // 切换节点时重置基础提示词编辑状态
    setBaseEditing(false);
    const snap = node.basePromptSnapshot ?? '';
    setEditedBase(snap);
    setEditedBaseSaved(snap);
  };

  /** 解锁基础提示词进入编辑模式 */
  const handleUnlockBase = () => {
    if (!selectedNode) return;
    // 优先使用已有快照，无快照时用自动生成的预览文本作为起始值
    const initial = selectedNode.basePromptSnapshot?.trim() || basePromptCache[selectedNode.id] || '';
    setEditedBase(initial);
    setEditedBaseSaved(selectedNode.basePromptSnapshot ?? '');
    setBaseEditing(true);
  };

  /** 保存基础提示词快照 */
  const handleSaveBase = async () => {
    if (!selectedNodeId) return;
    const updated = draftNodes.map((n) =>
      n.id === selectedNodeId ? { ...n, basePromptSnapshot: editedBase || undefined } : n,
    );
    setBaseSaving(true);
    try {
      const pl = await saveDramaPipelineDraft(dramaId, updated);
      setDraftNodes(updated);
      setPipeline(pl);
      setEditedBaseSaved(editedBase);
      message.success('基础提示词已固定保存');
    } catch {
      message.error('保存失败');
    } finally {
      setBaseSaving(false);
    }
  };

  /** 重置基础提示词快照（恢复自动生成） */
  const handleResetBase = async () => {
    if (!selectedNodeId) return;
    if (!window.confirm('重置后将恢复为系统自动生成的提示词，已固定的内容将丢失，确认重置吗？')) return;
    const updated = draftNodes.map((n) =>
      n.id === selectedNodeId ? { ...n, basePromptSnapshot: undefined } : n,
    );
    setBaseSaving(true);
    try {
      const pl = await saveDramaPipelineDraft(dramaId, updated);
      setDraftNodes(updated);
      setPipeline(pl);
      setEditedBase('');
      setEditedBaseSaved('');
      setBaseEditing(false);
      message.success('已重置为自动生成');
    } catch {
      message.error('重置失败');
    } finally {
      setBaseSaving(false);
    }
  };

  const handleToggleNode = async (node: DramaAgentNodeConfig) => {
    if (node.isCore) return;
    const updated = draftNodes.map((n) => n.id === node.id ? { ...n, isEnabled: !n.isEnabled } : n);
    setDraftNodes(updated);
    try {
      const pl = await saveDramaPipelineDraft(dramaId, updated);
      setPipeline(pl);
    } catch {
      setDraftNodes(draftNodes);
      message.error('保存失败');
    }
  };

  const handleSaveAdditional = async () => {
    if (!selectedNodeId) return;
    const updated = draftNodes.map((n) => n.id === selectedNodeId ? { ...n, additionalSystemPrompt: nodeAdditional } : n);
    setPipelineSaving(true);
    try {
      const pl = await saveDramaPipelineDraft(dramaId, updated);
      setDraftNodes(updated);
      setPipeline(pl);
      setNodeAdditionalSaved(nodeAdditional);
      message.success('已保存草稿');
    } catch {
      message.error('保存失败');
    } finally {
      setPipelineSaving(false);
    }
  };

  const handleDiscardAdditional = () => {
    setNodeAdditional(nodeAdditionalSaved);
  };

  const handlePublish = async () => {
    setPipelinePublishing(true);
    try {
      const pl = await publishDramaPipeline(dramaId);
      setPipeline(pl);
      message.success('已发布，下次生成将使用新配置');
    } catch {
      message.error('发布失败');
    } finally {
      setPipelinePublishing(false);
    }
  };

  const handleSaveParams = async () => {
    setParamsSaving(true);
    try {
      const pl = await saveDramaWorkflowParams(dramaId, workflowParams);
      setPipeline(pl);
      message.success('参数已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setParamsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 发布横幅 */}
      <div className={cn(
        'flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 overflow-hidden transition-all duration-200',
        hasUnpublished ? 'py-2.5 opacity-100 max-h-20' : 'py-0 opacity-0 max-h-0 border-transparent bg-transparent pointer-events-none',
      )}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-300">草稿有未发布的修改，发布后下次生成将使用新配置</p>
          </div>
          <Button size="sm" onClick={handlePublish} disabled={pipelinePublishing} className="h-7 text-xs">
            {pipelinePublishing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            发布
          </Button>
      </div>

      {/* Agent 节点配置 */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-violet-500" />
          Agent 节点配置
          <span className="text-xs text-muted-foreground font-normal">— 基础提示词可解锁编辑并固定，补充指令追加在末尾</span>
        </h3>
        <div className="grid grid-cols-[240px_1fr] gap-4 min-h-[400px]">
          {/* 节点列表 */}
          <div className="space-y-1 border rounded-lg p-2 bg-muted/30">
            {draftNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => handleSelectNode(node)}
                className={cn(
                  'w-full text-left rounded-md px-3 py-2 transition-colors',
                  selectedNodeId === node.id
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                    : 'hover:bg-muted',
                  !node.isEnabled && 'opacity-50',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium truncate">{node.label}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {node.isCore && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-violet-300 text-violet-600 dark:text-violet-400">核心</Badge>
                    )}
                    {!node.isEnabled && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">已关</Badge>
                    )}
                    {node.basePromptSnapshot?.trim() && (
                      <div className="w-1.5 h-1.5 rounded-full bg-violet-400" title="基础提示词已固定" />
                    )}
                    {node.additionalSystemPrompt?.trim() && (
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400" title="有补充指令" />
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* 节点编辑面板 */}
          {selectedNode ? (
            <div className="space-y-4">
              {/* 节点信息头 */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    {selectedNode.label}
                    {selectedNode.isCore ? (
                      <Badge variant="outline" className="text-[10px] h-4 border-violet-300 text-violet-600">核心节点</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleNode(selectedNode)}
                        className={cn(
                          'text-[10px] h-5 px-2 rounded border transition-colors',
                          selectedNode.isEnabled
                            ? 'border-green-300 text-green-700 bg-green-50 dark:bg-green-900/30 hover:bg-green-100'
                            : 'border-muted text-muted-foreground bg-muted hover:bg-muted/80',
                        )}
                      >
                        {selectedNode.isEnabled ? '已启用 · 点击关闭' : '已关闭 · 点击启用'}
                      </button>
                    )}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{selectedNode.description}</p>
                </div>
              </div>

              {/* 基础提示词 */}
              <div className={cn(
                'rounded-lg border overflow-hidden transition-colors',
                baseEditing
                  ? 'border-violet-300 dark:border-violet-700'
                  : selectedNode.basePromptSnapshot ? 'border-violet-200 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/20' : 'border-dashed border-muted-foreground/30 bg-muted/20',
              )}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-dashed border-muted-foreground/20">
                  <div className="flex items-center gap-1.5">
                    {baseEditing ? (
                      <Unlock className="h-3.5 w-3.5 text-violet-500" />
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className={cn('text-xs font-medium', baseEditing ? 'text-violet-700 dark:text-violet-300' : 'text-muted-foreground')}>
                      基础提示词
                    </span>
                    {selectedNode.basePromptSnapshot && !baseEditing && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-300 text-violet-600 dark:text-violet-400">已固定</Badge>
                    )}
                    {!baseEditing && (
                      <span className="text-[10px] text-muted-foreground/60">（{selectedNode.basePromptSnapshot ? '用户已固定，点击编辑可修改' : '系统自动生成，点击编辑可固定修改'}）</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {baseEditing ? (
                      <>
                        <Button
                          variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                          onClick={() => { setBaseEditing(false); setEditedBase(editedBaseSaved); }}
                        >
                          取消
                        </Button>
                        {selectedNode.basePromptSnapshot && (
                          <Button
                            variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                            onClick={handleResetBase} disabled={baseSaving}
                          >
                            重置为自动生成
                          </Button>
                        )}
                        <Button
                          size="sm" className="h-6 text-[10px] px-2"
                          onClick={handleSaveBase} disabled={baseSaving || !isBaseDirty}
                        >
                          {baseSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                          固定保存
                        </Button>
                      </>
                    ) : (
                      <>
                        {(basePromptCache[selectedNode.id] || selectedNode.basePromptSnapshot) && (
                          <span className="text-[10px] text-muted-foreground/60">
                            {(selectedNode.basePromptSnapshot || basePromptCache[selectedNode.id] || '').length} 字符
                          </span>
                        )}
                        <Button
                          variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30"
                          onClick={handleUnlockBase}
                        >
                          <Unlock className="h-3 w-3 mr-1" />编辑
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {baseEditing ? (
                  <div className="space-y-1.5 p-2">
                    <Textarea
                      value={editedBase}
                      onChange={(e) => setEditedBase(e.target.value)}
                      className="min-h-[260px] font-mono text-[11px] resize-y bg-background"
                      placeholder="输入自定义基础提示词，保存后将替代系统自动生成的版本..."
                    />
                    <p className="text-right text-[10px] text-muted-foreground">{editedBase.length} 字符</p>
                  </div>
                ) : selectedNode.basePromptSnapshot ? (
                  <div className="h-56 overflow-y-auto">
                    <pre className="px-3 py-2.5 text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap font-mono break-words">
                      {selectedNode.basePromptSnapshot}
                    </pre>
                  </div>
                ) : previewLoading && !basePromptCache[selectedNode.id] ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />加载中…
                  </div>
                ) : (
                  <div className="h-56 overflow-y-auto">
                    <pre className="px-3 py-2.5 text-[11px] text-muted-foreground/80 leading-relaxed whitespace-pre-wrap font-mono break-words">
                      {basePromptCache[selectedNode.id] ?? '加载中…'}
                    </pre>
                  </div>
                )}
              </div>

              {/* 补充指令（可编辑） */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Unlock className="h-3.5 w-3.5 text-violet-500" />
                    <Label className="text-xs font-medium">补充指令</Label>
                    <span className="text-[10px] text-muted-foreground">（追加到基础提示词末尾，优先级最高）</span>
                  </div>
                  <div className={cn('flex gap-1.5 transition-opacity duration-150', isDirty ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleDiscardAdditional}>
                      <RotateCcw className="h-3 w-3 mr-1" />撤销
                    </Button>
                    <Button size="sm" className="h-7 text-xs" onClick={handleSaveAdditional} disabled={pipelineSaving}>
                      {pipelineSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                      保存草稿
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={nodeAdditional}
                  onChange={(e) => setNodeAdditional(e.target.value)}
                  placeholder={`为「${selectedNode.label}」添加额外的创作指令，例如：\n- 对话中优先保留台词的古韵感\n- 钩子必须出现在最后1个镜头`}
                  className="min-h-[160px] font-mono text-xs resize-y"
                />
                <p className="text-right text-[10px] text-muted-foreground">{nodeAdditional.length} 字符</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground border rounded-lg border-dashed">
              从左侧选择一个 Agent 节点进行配置
            </div>
          )}
        </div>
      </div>

      {/* 工作流参数 */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          工作流参数
        </h3>
        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">质量门槛评分（0–10）</Label>
                <Input
                  type="number" min={0} max={10} step={0.5}
                  value={workflowParams.qualityPassScore ?? 7.0}
                  onChange={(e) => setWorkflowParams((p) => ({ ...p, qualityPassScore: parseFloat(e.target.value) || 7.0 }))}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">低于此分数触发精修编辑，建议 6.5–8.5</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">最大精修轮数</Label>
                <Input
                  type="number" min={0} max={5}
                  value={workflowParams.maxEditRounds ?? 2}
                  onChange={(e) => setWorkflowParams((p) => ({ ...p, maxEditRounds: parseInt(e.target.value, 10) || 2 }))}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">script-editor 最多循环次数，建议 1–3</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">连续性重试次数</Label>
                <Input
                  type="number" min={0} max={3}
                  value={workflowParams.maxContinuityRetries ?? 1}
                  onChange={(e) => setWorkflowParams((p) => ({ ...p, maxContinuityRetries: parseInt(e.target.value, 10) }))}
                  className="h-8 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">continuity-guard 失败时重试次数</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              {([
                { key: 'enableDialogueCoach', label: '台词润色', desc: 'dialogue-coach 节点' },
                { key: 'enablePacingAnalyzer', label: '节奏分析', desc: 'pacing-analyzer 节点' },
                { key: 'enableHookCrafter', label: '悬念设计', desc: 'hook-crafter 节点' },
              ] as Array<{ key: keyof DramaWorkflowParams; label: string; desc: string }>).map(({ key, label, desc }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2 hover:bg-muted transition-colors">
                  <input
                    type="checkbox"
                    checked={workflowParams[key] !== false}
                    onChange={(e) => setWorkflowParams((p) => ({ ...p, [key]: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-violet-600"
                  />
                  <div>
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <Button size="sm" className="h-7 text-xs" onClick={handleSaveParams} disabled={paramsSaving}>
                {paramsSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                保存参数
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 本剧编剧手册（只读） */}
      {promptProfile && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4 text-sky-500" />
            本剧编剧手册
            <span className="text-xs text-muted-foreground font-normal">— 由 Profiler Agent 在建剧时自动生成，动态注入各 Agent，只读</span>
          </h3>
          <div className="space-y-3">
            {/* 题材规则 */}
            {genreArchetype && (
              <Card className="border-sky-100 dark:border-sky-900">
                <CardContent className="pt-3 pb-3">
                  <p className="text-xs font-medium text-sky-700 dark:text-sky-300 mb-2 flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> 题材原型
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {([
                      genreArchetype.coreIdentity as string,
                      NARRATIVE_ARC_LABELS[genreArchetype.narrativeArc as string] ?? genreArchetype.narrativeArc as string,
                    ])
                      .filter(Boolean)
                      .map((v, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] bg-sky-50 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">{v}</Badge>
                      ))}
                  </div>
                  {typeof genreArchetype.factConstraint === 'string' && genreArchetype.factConstraint && genreArchetype.factConstraint !== 'none' && (
                    <p className="text-xs text-muted-foreground leading-relaxed border-t pt-2 mt-1">
                      <span className="font-medium">史实约束：</span>{FACT_CONSTRAINT_LABELS[genreArchetype.factConstraint as string] ?? genreArchetype.factConstraint}
                    </p>
                  )}
                  {Array.isArray(genreArchetype.forbiddenClichés) && (genreArchetype.forbiddenClichés as string[]).length > 0 && (
                    <div className="border-t pt-2 mt-2">
                      <p className="text-[10px] text-muted-foreground mb-1">禁用老梗</p>
                      <div className="flex flex-wrap gap-1">
                        {(genreArchetype.forbiddenClichés as string[]).map((c: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px] border-red-200 text-red-600 dark:text-red-400">{c}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 台词风格指南 */}
            {typeof scriptwriterGuide?.dialogueGuide === 'string' && scriptwriterGuide.dialogueGuide && (
              <Card className="border-sky-100 dark:border-sky-900">
                <CardContent className="pt-3 pb-3">
                  <p className="text-xs font-medium text-sky-700 dark:text-sky-300 mb-2 flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> 台词风格指南
                    <span className="text-[10px] text-muted-foreground font-normal">— 注入：台词润色 / 质量审核 / 精修编辑</span>
                  </p>
                  <pre className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-sans bg-muted/30 rounded p-2.5">
                    {scriptwriterGuide.dialogueGuide}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* 题材规则 */}
            {typeof scriptwriterGuide?.genreRules === 'string' && scriptwriterGuide.genreRules && (
              <Card className="border-sky-100 dark:border-sky-900">
                <CardContent className="pt-3 pb-3">
                  <p className="text-xs font-medium text-sky-700 dark:text-sky-300 mb-2 flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> 题材创作规则
                    <span className="text-[10px] text-muted-foreground font-normal">— 注入：卷导演 / 悬念设计</span>
                  </p>
                  <pre className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-sans bg-muted/30 rounded p-2.5">
                    {scriptwriterGuide.genreRules}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* 视觉风格 — 可编辑 */}
            {(visualStyle || true) && (
              <Card className="border-sky-100 dark:border-sky-900">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                      <Palette className="h-3 w-3" /> 视觉风格
                      <span className="text-[10px] text-muted-foreground font-normal">— 注入：分镜导演 / 集导演 / 图像生成</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      {vsEditing ? (
                        <>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setVsEditing(false)} disabled={vsSaving}>
                            <X className="h-3 w-3 mr-1" />取消
                          </Button>
                          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={handleVsSave} disabled={vsSaving}>
                            {vsSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}保存
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground" onClick={() => setVsEditing(true)}>
                          <Pencil className="h-3 w-3 mr-1" />编辑
                        </Button>
                      )}
                    </div>
                  </div>

                  {vsEditing ? (
                    /* ── 编辑模式 ── */
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-2.5">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">整体美学风格 *</Label>
                          <Textarea
                            rows={2}
                            className="text-xs mt-0.5"
                            value={vsForm.overallAesthetic}
                            onChange={(e) => setVsForm(p => ({ ...p, overallAesthetic: e.target.value }))}
                            placeholder="如: 现代都市电影质感，高对比度，层次丰富"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-muted-foreground">调色风格 *</Label>
                            <Input
                              className="text-xs h-7 mt-0.5"
                              value={vsForm.colorGrading}
                              onChange={(e) => setVsForm(p => ({ ...p, colorGrading: e.target.value }))}
                              placeholder="如: 冷暖对比，阴影压蓝"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">光影风格 *</Label>
                            <Input
                              className="text-xs h-7 mt-0.5"
                              value={vsForm.lightingStyle}
                              onChange={(e) => setVsForm(p => ({ ...p, lightingStyle: e.target.value }))}
                              placeholder="如: 三点布光，伦勃朗光"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">时代背景</Label>
                          <div className="flex gap-1.5 mt-1">
                            {(['contemporary', 'ancient', 'future', 'mixed'] as const).map(era => (
                              <Badge
                                key={era}
                                variant={vsForm.era === era ? 'default' : 'outline'}
                                className="cursor-pointer text-[10px] px-1.5"
                                onClick={() => setVsForm(p => ({ ...p, era }))}
                              >
                                {{ contemporary: '现代', ancient: '古代', future: '未来', mixed: '跨时代' }[era]}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-[10px] text-muted-foreground">渲染技术</Label>
                            <Input
                              className="text-xs h-7 mt-0.5"
                              value={vsForm.renderTechnique}
                              onChange={(e) => setVsForm(p => ({ ...p, renderTechnique: e.target.value }))}
                              placeholder="如: 写实CG、3D NPR赛璐璐"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground">材质质感</Label>
                            <Input
                              className="text-xs h-7 mt-0.5"
                              value={vsForm.textureStyle}
                              onChange={(e) => setVsForm(p => ({ ...p, textureStyle: e.target.value }))}
                              placeholder="如: 胶片颗粒、水彩晕染"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">参考风格/作品</Label>
                          <Input
                            className="text-xs h-7 mt-0.5"
                            value={vsForm.referenceStyle}
                            onChange={(e) => setVsForm(p => ({ ...p, referenceStyle: e.target.value }))}
                            placeholder="如: 吉卜力、新海诚、港片黄金时代"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">英文 T2I 风格提示词</Label>
                          <Textarea
                            rows={2}
                            className="text-xs font-mono mt-0.5"
                            value={vsForm.styleReferencePrompt}
                            onChange={(e) => setVsForm(p => ({ ...p, styleReferencePrompt: e.target.value }))}
                            placeholder="English-only T2I style prompt injected into every image..."
                          />
                          <p className="text-[10px] text-muted-foreground mt-0.5">仅英文，直接注入所有图片生成提示词前缀</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* ── 查看模式 ── */
                    visualStyle ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-1 gap-1.5">
                          {vsForm.overallAesthetic && (
                            <div>
                              <span className="text-[10px] text-muted-foreground">整体美学：</span>
                              <span className="text-xs">{vsForm.overallAesthetic}</span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                            {vsForm.colorGrading && (
                              <div><span className="text-[10px] text-muted-foreground">调色：</span><span className="text-xs">{vsForm.colorGrading}</span></div>
                            )}
                            {vsForm.lightingStyle && (
                              <div><span className="text-[10px] text-muted-foreground">光影：</span><span className="text-xs">{vsForm.lightingStyle}</span></div>
                            )}
                            {vsForm.era && (
                              <div><span className="text-[10px] text-muted-foreground">时代：</span><span className="text-xs">{{ contemporary: '现代', ancient: '古代', future: '未来', mixed: '跨时代' }[vsForm.era] ?? vsForm.era}</span></div>
                            )}
                            {vsForm.renderTechnique && (
                              <div><span className="text-[10px] text-muted-foreground">渲染：</span><span className="text-xs">{vsForm.renderTechnique}</span></div>
                            )}
                            {vsForm.textureStyle && (
                              <div><span className="text-[10px] text-muted-foreground">材质：</span><span className="text-xs">{vsForm.textureStyle}</span></div>
                            )}
                            {vsForm.referenceStyle && (
                              <div><span className="text-[10px] text-muted-foreground">参考：</span><span className="text-xs">{vsForm.referenceStyle}</span></div>
                            )}
                          </div>
                          {vsForm.styleReferencePrompt && (
                            <div className="mt-1 rounded bg-muted/40 px-2 py-1.5">
                              <p className="text-[10px] text-muted-foreground mb-0.5">T2I 提示词前缀：</p>
                              <p className="text-[10px] font-mono text-foreground/70 leading-relaxed line-clamp-2">{vsForm.styleReferencePrompt}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">尚未生成视觉风格，点击"编辑"手动配置</p>
                    )
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── DramaWorkbench ───────────────────────────────────────────────────────────

const DramaWorkbench: React.FC = () => {
  const { dramaId } = useParams<{ dramaId: string }>();
  const [drama, setDrama] = useState<Record<string, unknown> | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genStep, setGenStep] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [skippedSteps, setSkippedSteps] = useState<SkippedStepItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pipelineInitialized = useRef(false);
  const [previewEp, setPreviewEp] = useState<Record<string, unknown> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [mediaGenEp, setMediaGenEp] = useState<number | null>(null);
  const [mediaGenProgress, setMediaGenProgress] = useState(0);
  const [problemResetEp, setProblemResetEp] = useState<number | null>(null);
  const [problemResetMode, setProblemResetMode] = useState<'all' | 'high' | QcFixTarget | null>(null);
  const mediaAbortRef = useRef<AbortController | null>(null);
  const [showMediaConfirm, setShowMediaConfirm] = useState(false);
  const [usage, setUsage] = useState<DramaUsageSummary | null>(null);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [expandedEpisodeUsage, setExpandedEpisodeUsage] = useState<number | null>(null);
  const [latestExecByEpisode, setLatestExecByEpisode] = useState<Map<number, DramaExecutionListItem>>(new Map());
  const [dbRunning, setDbRunning] = useState<DbRunningItem[]>([]);
  const [assetByKey, setAssetByKey] = useState<Map<string, VisualAssetItem>>(new Map());
  const [assetImages, setAssetImages] = useState<Map<string, string>>(new Map());
  const [assetViewImages, setAssetViewImages] = useState<Map<string, Array<{ viewAngle: string; imageUrl: string }>>>(new Map());
  const [assetGeneratingKeys, setAssetGeneratingKeys] = useState<Set<string>>(new Set());
  const [variationGeneratingKeys, setVariationGeneratingKeys] = useState<Set<string>>(new Set());
  const [assetTypeFilter, setAssetTypeFilter] = useState<'all' | 'character' | 'location' | 'prop'>('all');
  const [assetQuery, setAssetQuery] = useState('');
  const [allAssetsGenerating, setAllAssetsGenerating] = useState(false);
  const [allAssetsProgress, setAllAssetsProgress] = useState('');
  const allAssetsSseRef = useRef<EventSource | null>(null);
  // ── 提示词工坊 Pipeline ──
  const [pipeline, setPipeline] = useState<DramaPipeline | null>(null);
  const [draftNodes, setDraftNodes] = useState<DramaAgentNodeConfig[]>([]);
  const [workflowParams, setWorkflowParams] = useState<DramaWorkflowParams>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeAdditional, setNodeAdditional] = useState(''); // 当前编辑中的 additionalSystemPrompt
  const [nodeAdditionalSaved, setNodeAdditionalSaved] = useState(''); // 已保存的值，用于 dirty 判断
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [pipelinePublishing, setPipelinePublishing] = useState(false);
  const [paramsSaving, setParamsSaving] = useState(false);
  const [shotFilterMode, setShotFilterMode] = useState<ShotFilterMode>('all');
  const [shotQuery, setShotQuery] = useState('');

  useEffect(() => () => { abortRef.current?.abort(); mediaAbortRef.current?.abort(); }, []);

  const fetchData = useCallback(async () => {
    if (!dramaId) return;
    try {
      setLoading(true);
      const [d, epRes, usageRes, assetsRes, execRes] = await Promise.all([
        getDrama(dramaId), listEpisodes(dramaId),
        getDramaUsage(dramaId).catch(() => null),
        getVisualAssets(dramaId).catch(() => ({ assets: [] as any[] })),
        listDramaExecutions(dramaId, { latestPerEpisode: true, limit: 80, includeCreation: false }).catch(() => ({ executions: [] as DramaExecutionListItem[] })),
      ]);
      setDrama(d);
      setEpisodes(epRes.episodes);
      setUsage(usageRes);
      const execMap = new Map<number, DramaExecutionListItem>();
      (execRes.executions ?? []).forEach((exec) => {
        if (exec.episodeNumber > 0 && !execMap.has(exec.episodeNumber)) execMap.set(exec.episodeNumber, exec);
      });
      setLatestExecByEpisode(execMap);
      const assetMap = new Map<string, VisualAssetItem>();
      const imgMap = new Map<string, string>();
      const viewMap = new Map<string, Array<{ viewAngle: string; imageUrl: string }>>();
      (assetsRes.assets ?? []).forEach((a: VisualAssetItem) => {
        const key = `${a.assetType}:${a.refId}`;
        assetMap.set(key, a);
        if (a.referenceImageUrl) imgMap.set(key, a.referenceImageUrl);
        if (a.referenceImages?.length) viewMap.set(key, a.referenceImages);
      });
      setAssetByKey(assetMap);
      setAssetImages(imgMap);
      setAssetViewImages(viewMap);
      // 加载 pipeline 配置（懒加载，不阻塞主界面）
      getDramaPipeline(dramaId).then((pl) => {
        setPipeline(pl);
        const nodes = pl.draftNodes ?? [];
        setDraftNodes(nodes);
        setWorkflowParams(pl.workflowParams ?? {});
        if (!pipelineInitialized.current && nodes.length > 0) {
          pipelineInitialized.current = true;
          setSelectedNodeId(nodes[0].id);
          setNodeAdditional(nodes[0].additionalSystemPrompt ?? '');
          setNodeAdditionalSaved(nodes[0].additionalSystemPrompt ?? '');
        }
      }).catch(() => {});
    } catch (e: any) {
      message.error(e?.message ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, [dramaId]); // selectedNodeId intentionally excluded — initial selection is set only once on first load

  const applyUpdatedAsset = useCallback((asset: VisualAssetItem) => {
    const key = `${asset.assetType}:${asset.refId}`;
    setAssetByKey((prev) => {
      const next = new Map(prev);
      next.set(key, asset);
      return next;
    });
    setAssetImages((prev) => {
      const next = new Map(prev);
      if (asset.referenceImageUrl) next.set(key, asset.referenceImageUrl);
      else next.delete(key);
      return next;
    });
    setAssetViewImages((prev) => {
      const next = new Map(prev);
      if (asset.referenceImages?.length) next.set(key, asset.referenceImages);
      else next.delete(key);
      return next;
    });
  }, []);

  const setAssetBusy = useCallback((key: string, busy: boolean) => {
    setAssetGeneratingKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleRegenerateAsset = useCallback(async (
    assetType: 'character' | 'location',
    refId: string,
    viewAngle?: string,
  ) => {
    if (!dramaId) return;
    const key = `${assetType}:${refId}`;
    const asset = assetByKey.get(key);
    if (!asset) {
      message.warning('未找到可重生资产');
      return;
    }
    setAssetBusy(key, true);
    try {
      const updated = await regenerateVisualAssetImage(dramaId, asset.id, viewAngle ? { viewAngle } : undefined);
      applyUpdatedAsset(updated);
      message.success(`${asset.name} 已重新生成`);
    } catch (e: any) {
      message.error(e?.message ?? '重生失败');
    } finally {
      setAssetBusy(key, false);
    }
  }, [applyUpdatedAsset, assetByKey, dramaId, setAssetBusy]);

  const handleRegenerateVariation = useCallback(async (
    characterId: string,
    variationId: string,
  ) => {
    if (!dramaId) return;
    const asset = assetByKey.get(`character:${characterId}`);
    if (!asset) { message.warning('未找到角色资产'); return; }
    const busyKey = `${characterId}:${variationId}`;
    setVariationGeneratingKeys((prev) => new Set([...prev, busyKey]));
    try {
      const updated = await regenerateVariationImage(dramaId, asset.id, variationId);
      applyUpdatedAsset(updated);
      message.success('服装变体图已生成');
    } catch (e: any) {
      message.error(e?.message ?? '变体图生成失败');
    } finally {
      setVariationGeneratingKeys((prev) => { const next = new Set(prev); next.delete(busyKey); return next; });
    }
  }, [applyUpdatedAsset, assetByKey, dramaId]);

  const handleRefineAsset = useCallback(async (
    assetType: 'character' | 'location',
    refId: string,
    payload: {
      instruction: string;
      viewAngle?: string;
      syncScope?: VisualAssetRefineSyncScope;
      strength?: VisualAssetRefineStrength;
    },
  ) => {
    if (!dramaId) return;
    const key = `${assetType}:${refId}`;
    const asset = assetByKey.get(key);
    if (!asset) {
      message.warning('未找到可精修资产');
      return;
    }
    if (!payload.instruction.trim()) {
      message.warning('请输入修改要求');
      return;
    }
    setAssetBusy(key, true);
    try {
      const result = await refineVisualAssetImage(dramaId, asset.id, {
        instruction: payload.instruction,
        viewAngle: payload.viewAngle,
        syncScope: payload.syncScope,
        strength: payload.strength,
        preserveIdentity: true,
      });
      applyUpdatedAsset(result.asset);
      const affected = result.affectedViews?.length ? `（影响 ${result.affectedViews.length} 个视角）` : '';
      message.success(`精修完成${affected}`);
    } catch (e: any) {
      message.error(e?.message ?? '精修失败');
    } finally {
      setAssetBusy(key, false);
    }
  }, [applyUpdatedAsset, assetByKey, dramaId, setAssetBusy]);

  // ─── 批量生成所有参考图 ────────────────────────────────────────────────────────
  const handleGenerateAllAssets = useCallback(() => {
    if (!dramaId || allAssetsGenerating) return;
    allAssetsSseRef.current?.close();
    setAllAssetsGenerating(true);
    setAllAssetsProgress('连接中...');
    const url = getGenerateAllAssetsSseUrl(dramaId);
    const es = new EventSource(url);
    allAssetsSseRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev: DramaSseEvent = JSON.parse(e.data);
        if (ev._type === 'heartbeat') return;
        if (ev._type === 'progress') {
          setAllAssetsProgress(ev.message ?? '生成中...');
          return;
        }
        if (ev.terminal) {
          es.close();
          allAssetsSseRef.current = null;
          setAllAssetsGenerating(false);
          if (ev._type === 'result') {
            setAllAssetsProgress('');
            message.success('参考图生成完成');
            getVisualAssets(dramaId).then(({ assets }) => {
              const imgMap = new Map<string, string>();
              const viewMap = new Map<string, Array<{ viewAngle: string; imageUrl: string }>>();
              const aMap = new Map<string, VisualAssetItem>();
              (assets ?? []).forEach((a: VisualAssetItem) => {
                const key = `${a.assetType}:${a.refId}`;
                aMap.set(key, a);
                if (a.referenceImageUrl) imgMap.set(key, a.referenceImageUrl);
                if (a.referenceImages?.length) viewMap.set(key, a.referenceImages);
              });
              setAssetByKey(aMap);
              setAssetImages(imgMap);
              setAssetViewImages(viewMap);
            }).catch(() => {});
          } else {
            setAllAssetsProgress('');
            message.error(ev.error ?? '参考图生成失败');
          }
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      es.close();
      allAssetsSseRef.current = null;
      setAllAssetsGenerating(false);
      setAllAssetsProgress('');
      message.error('参考图生成连接中断');
    };
  }, [dramaId, allAssetsGenerating]);

  // ─── 通用 SSE 读取循环 ────────────────────────────────────────────────────────
  const readSseStream = useCallback(async (url: string, onResult?: (msg: string) => void) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error('SSE 连接失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stopped = false;
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const p = JSON.parse(line.slice(5).trim()) as DramaSseEvent;
            if (p._type === 'heartbeat' || p._type === 'info') continue;
            if (p._type === 'error' || p.error || p.terminalStatus === 'failed') {
              const err = p.error || p.message || '生成失败';
              setLastError(err);
              message.error(err);
              stopped = true;
              break;
            }
            if (p._type === 'result') {
              if (p.terminalStatus === 'paused' || Boolean((p.data as any)?.paused)) {
                setPaused(true);
                setPauseLoading(false);
              } else {
                onResult?.(p.message ?? '生成完成');
              }
              stopped = true;
              break;
            }
            if (p._type === 'progress') {
              if ((p.totalSteps ?? 0) > 0) {
                setGenProgress(Math.round((((p.stepIndex ?? 0) + ((p.done ?? false) ? 1 : 0.5)) / (p.totalSteps ?? 1)) * 100));
              }
              setGenStep(p.message ?? p.step ?? '');
              if (p.skipped) {
                const key = p.nodeId ?? p.stepKey ?? p.step ?? `ep_${p.stepIndex ?? 0}`;
                const label = resolveSkippedStepLabel(p);
                const reason = resolveSkipReasonLabel(p.skipReason);
                setSkippedSteps((prev) => {
                  if (prev.some((item) => item.key === key)) return prev;
                  return [...prev, { key, label, reason }];
                });
              }
            }
          } catch { /* skip */ }
        }
      }
      await fetchData();
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '生成失败');
    } finally {
      setGenerating(false);
      setGenProgress(0);
      setGenStep('');
      setDbRunning([]);
      setPauseLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    if (!dramaId) return;
    // 页面加载时检查后端生成状态：
    // ① 内存活跃 (episode.generating=true)  → 订阅 progress-sse（只接收，不触发新生成）
    // ② 内存无记录 + DB有记录 + 心跳陈旧    → 后端被中断，展示中断提示供用户手动恢复
    // ③ 内存无记录 + DB无记录               → 无生成任务，正常展示
    getGenerationStatus(dramaId)
      .then(s => {
        const liveRunning = s.episode?.generating;
        const livePaused = s.episode?.paused;
        const dbItems = s.dbRunning ?? [];
        setDbRunning(liveRunning ? [] : dbItems.filter(r => !r.isActive));
        if (livePaused && !liveRunning) {
          setPaused(true);
        } else if (liveRunning) {
          if (livePaused) setPauseLoading(true);
          setGenerating(true);
          setSkippedSteps([]);
          setGenProgress(s.episode.progress ?? 0);
          setGenStep(s.episode.lastStep ?? '生成中...');
          readSseStream(getEpisodeProgressSseUrl(dramaId));
        }
      })
      .catch(() => { /* 状态查询失败不影响页面展示 */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  // 用户主动触发生成（使用 generate-sse，后端会新建或断点续传）
  const handleGenerate = useCallback(async () => {
    if (!dramaId) return;
    setPaused(false); setPauseLoading(false);
    setGenerating(true); setGenProgress(0); setGenStep(''); setLastError(null); setDbRunning([]);
    setSkippedSteps([]);
    await readSseStream(getGenerateEpisodeSseUrl(dramaId), (msg) => message.success(msg));
  }, [dramaId, readSseStream]);

  const handlePause = useCallback(async () => {
    if (!dramaId) return;
    setPauseLoading(true);
    try {
      const res = await pauseEpisodeGeneration(dramaId);
      if (!res.paused) { message.warning(res.message); setPauseLoading(false); }
    } catch {
      message.error('暂停请求失败');
      setPauseLoading(false);
    }
  }, [dramaId]);

  const handlePreview = async (ep: EpisodeListItem) => {
    if (!dramaId) return;
    setPreviewLoading(true);
    try { setPreviewEp(await getEpisode(dramaId, ep.episodeNumber)); }
    catch { message.error('加载集详情失败'); }
    finally { setPreviewLoading(false); }
  };

  const handleGenerateMedia = async (episodeNumber: number) => {
    if (!dramaId) return;
    setShowMediaConfirm(false); setMediaGenEp(episodeNumber); setMediaGenProgress(0);
    const controller = new AbortController();
    mediaAbortRef.current = controller;
    try {
      const res = await fetch(getGenerateMediaSseUrl(dramaId, episodeNumber), {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('连接失败');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let stopped = false;
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const p = JSON.parse(line.slice(5).trim()) as DramaSseEvent;
            if (p._type === 'heartbeat' || p._type === 'info') continue;
            if (p._type === 'error' || p.error || p.terminalStatus === 'failed') {
              message.error(p.error || p.message || '媒体生成失败');
              stopped = true;
              break;
            }
            if (p._type === 'result') {
              message.success(p.message || '媒体生成完成');
              stopped = true;
              break;
            }
            if (p._type === 'progress' && (p.totalSteps ?? 0) > 0) {
              setMediaGenProgress(Math.round((((p.stepIndex ?? 0) + ((p.done ?? false) ? 1 : 0.5)) / (p.totalSteps ?? 1)) * 100));
            }
          } catch { /* skip */ }
        }
      }
      if (previewEp && (previewEp as any).episodeNumber === episodeNumber)
        setPreviewEp(await getEpisode(dramaId, episodeNumber));
      await fetchData();
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(e?.message ?? '媒体生成失败');
    } finally { setMediaGenEp(null); setMediaGenProgress(0); }
  };

  const handleRegenerateProblemShots = async (
    episodeNumber: number,
    opts?: { onlyHighPriority?: boolean; fixTarget?: ResetFixTarget },
  ) => {
    if (!dramaId) return;
    const onlyHighPriority = opts?.onlyHighPriority ?? false;
    const fixTarget = opts?.fixTarget ?? 'all';
    const activeMode: 'all' | 'high' | QcFixTarget = onlyHighPriority ? 'high' : fixTarget;
    setProblemResetEp(episodeNumber);
    setProblemResetMode(activeMode);
    setShowMediaConfirm(false);
    try {
      const result = await resetProblemShots(dramaId, episodeNumber, {
        includeReviewRisks: true,
        onlyHighPriority,
        fixTarget,
      });
      const scopeLabel = onlyHighPriority
        ? '高优先'
        : (fixTarget === 'all' ? '全部' : `${FIX_TARGET_LABELS[fixTarget]}类`);
      if (result.resetCount > 0) {
        message.success(`已重置 ${result.resetCount} 个${scopeLabel}问题镜头，开始重新生成媒体`);
      } else {
        message.info(`未发现${scopeLabel}问题镜头，直接开始媒体生成`);
      }
      if (previewEp && (previewEp as any).episodeNumber === episodeNumber) {
        setPreviewEp(await getEpisode(dramaId, episodeNumber));
      }
      await fetchData();
      await handleGenerateMedia(episodeNumber);
    } catch (e: any) {
      message.error(e?.message ?? '问题镜头重置失败');
    } finally {
      setProblemResetEp(null);
      setProblemResetMode(null);
    }
  };

  // 人工编辑 Shot 后在本地同步更新，无需重新请求
  const handleShotUpdated = useCallback((shotId: string, patch: ShotPatch) => {
    setPreviewEp(prev => {
      if (!prev) return prev;
      const storyboard = (prev as any).storyboard;
      if (!storyboard?.shots) return prev;
      const shots = storyboard.shots.map((s: any) =>
        s.shotId === shotId
          ? { ...s, ...patch, isHumanEdited: true, humanEditedAt: new Date().toISOString() }
          : s,
      );
      return { ...prev, storyboard: { ...storyboard, shots } };
    });
  }, []);

  useEffect(() => {
    setShotFilterMode('all');
    setShotQuery('');
  }, [previewEp]);

  // Must run unconditionally (before any early return) to satisfy Rules of Hooks
  const charactersForHooks: Character[] = ((drama as any)?.state?.characters ?? []) as Character[];
  const locationsForHooks: Location[] = ((drama as any)?.state?.locations ?? []) as Location[];
  const allProps = useMemo(() => {
    const props: VisualAssetItem[] = [];
    for (const [key, asset] of assetByKey) {
      if (key.startsWith('prop:')) props.push(asset);
    }
    return props.sort((a, b) => {
      const locA = String(a.data?.locationName ?? '');
      const locB = String(b.data?.locationName ?? '');
      return locA.localeCompare(locB, 'zh') || a.name.localeCompare(b.name, 'zh');
    });
  }, [assetByKey]);
  const assetVariationImages = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const [, asset] of assetByKey) {
      if (asset.assetType !== 'character') continue;
      const vars = (asset.data?.variations ?? []) as Array<{ variationId?: string; referenceImageUrl?: string }>;
      if (!vars.length) continue;
      const varMap = new Map<string, string>();
      for (const v of vars) {
        if (v.variationId && v.referenceImageUrl) varMap.set(v.variationId, v.referenceImageUrl);
      }
      if (varMap.size) map.set(asset.refId, varMap);
    }
    return map;
  }, [assetByKey]);
  const missingVariationImageCount = useMemo(() => {
    let count = 0;
    for (const char of charactersForHooks) {
      if (!char.variations?.length) continue;
      if (!assetImages.get(`character:${char.characterId}`)) continue;
      const varMap = assetVariationImages.get(char.characterId);
      for (const v of char.variations) {
        if (!varMap?.get(v.variationId)) count++;
      }
    }
    return count;
  }, [charactersForHooks, assetImages, assetVariationImages]);
  const missingLocationImageCount = useMemo(() => {
    let count = 0;
    for (const loc of locationsForHooks) {
      const views = assetViewImages.get(`location:${loc.locationId}`);
      if (!views?.length) {
        count += 1;
        continue;
      }
      count += views.filter(vi => !vi.imageUrl).length;
    }
    return count;
  }, [locationsForHooks, assetViewImages]);

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (!drama) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <AlertCircle className="h-10 w-10" />
      <p>短剧不存在</p>
      <Button variant="outline" onClick={() => history.push('/novel/dramas')}>返回短剧</Button>
    </div>
  );

  const state = (drama as any).state as Record<string, unknown> | undefined;
  const seed = state?.seed as Record<string, unknown> | undefined;
  const outline = state?.seriesOutline as Record<string, unknown> | undefined;
  const catharsisType = typeof seed?.catharsisType === 'string' ? seed.catharsisType : '';
  const logline = typeof seed?.logline === 'string' ? seed.logline : '';
  const characters = (state?.characters as Character[]) ?? [];
  const locations = (state?.locations as Location[]) ?? [];
  const visualStyle = state?.visualStyle as Record<string, unknown> | undefined;
  const charNames = new Map<string, string>(characters.map(c => [c.characterId, c.name]));
  const locNames = new Map<string, string>(locations.map(l => [l.locationId, l.name]));
  const normalizedAssetQuery = assetQuery.trim().toLowerCase();
  const sortedCharacters = [...characters].sort((a, b) => (CHARACTER_ROLE_ORDER[a.role] ?? 9) - (CHARACTER_ROLE_ORDER[b.role] ?? 9));
  const filteredCharacters = sortedCharacters.filter((char) => {
    if (!normalizedAssetQuery) return true;
    const haystack = [
      char.name,
      ROLE_STYLES[char.role]?.label ?? char.role,
      char.faceDescription,
      char.defaultCostume,
      char.distinguishingFeatures,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalizedAssetQuery);
  });
  const sortedLocations = [...locations].sort((a, b) => (b.isRecurring ? 1 : 0) - (a.isRecurring ? 1 : 0));
  const filteredLocations = sortedLocations.filter((loc) => {
    if (!normalizedAssetQuery) return true;
    const haystack = [loc.name, loc.description, loc.colorTone, loc.lightingDefault, ...(loc.keyProps ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedAssetQuery);
  });
  const missingCharacterImageCount = characters.filter((char) => !assetImages.get(`character:${char.characterId}`)).length;

  const filteredProps = normalizedAssetQuery
    ? allProps.filter((p) => {
        const haystack = [p.name, String(p.data?.description ?? ''), String(p.data?.locationName ?? '')]
          .join(' ').toLowerCase();
        return haystack.includes(normalizedAssetQuery);
      })
    : allProps;

  const missingPropImageCount = allProps.filter((p) => !p.referenceImageUrl).length;
  const missingAssetCount = missingCharacterImageCount + missingLocationImageCount + missingVariationImageCount + missingPropImageCount;

  const shots = ((previewEp as any)?.storyboard?.shots as Shot[]) ?? [];
  const shotMediaMap = ((previewEp as any)?.shotMediaMap as Record<string, ShotMedia>) ?? {};
  const generatedShotCount = Object.keys(shotMediaMap).filter(k => shotMediaMap[k]?.imageUrl).length;
  const reviewConsistencyRiskIds = new Set(
    ((((previewEp as any)?.review?.consistencyRiskShots as Array<{ shotId?: string }> | undefined) ?? [])
      .map((r) => r?.shotId)
      .filter((sid): sid is string => !!sid)),
  );
  const reviewCameraRiskIds = new Set(
    ((((previewEp as any)?.review?.cameraReadabilityRiskShots as Array<{ shotId?: string }> | undefined) ?? [])
      .map((r) => r?.shotId)
      .filter((sid): sid is string => !!sid)),
  );
  const reviewRiskShotIds = new Set<string>([...reviewConsistencyRiskIds, ...reviewCameraRiskIds]);
  const problemShotIds = shots
    .filter((shot) =>
      isProblemShotMediaEntry(shot, shotMediaMap[shot.shotId], (previewEp as any)?.mediaStatus)
      || reviewRiskShotIds.has(shot.shotId),
    )
    .map((shot) => shot.shotId);
  const problemShotSet = new Set(problemShotIds);
  const problemShotCount = problemShotIds.length;
  const highPriorityProblemShotCount = shots.filter((shot) =>
    problemShotSet.has(shot.shotId) && isHighPriorityShot(shot),
  ).length;
  const fixTargetCounts: Record<QcFixTarget, number> = { identity: 0, style: 0, camera: 0, motion: 0 };
  for (const shot of shots) {
    if (!problemShotSet.has(shot.shotId)) continue;
    const tags = resolveShotFixTags(shot, shotMediaMap[shot.shotId], reviewConsistencyRiskIds, reviewCameraRiskIds);
    for (const tag of tags) fixTargetCounts[tag] += 1;
  }
  const humanEditedCount = shots.filter(s => s.isHumanEdited).length;
  const previewEpNum = (previewEp as any)?.episodeNumber as number | undefined;
  const previewExec = previewEpNum !== undefined ? latestExecByEpisode.get(previewEpNum) : undefined;
  const previewSkippedSteps = previewExec?.skippedSteps ?? [];
  const continuityResult = ((previewEp as any)?.continuity ?? (previewEp as any)?.continuityCheck ?? null) as
    { pass?: boolean; warnings?: ContinuityWarning[]; contextInjections?: string[] } | null;
  const continuityWarnings = continuityResult?.warnings ?? [];
  const flashbackShotCount = shots.filter((shot) => !!shot.isFlashback).length;
  const shotOrderById = new Map(shots.map((shot, idx) => [shot.shotId, idx]));
  const normalizedShotQuery = shotQuery.trim().toLowerCase();
  const filteredShots = shots.filter((shot, idx) => {
    if (shotFilterMode === 'problem' && !problemShotSet.has(shot.shotId)) return false;
    if (shotFilterMode === 'locked' && !shot.isHumanEdited) return false;
    if (shotFilterMode === 'flashback' && !shot.isFlashback) return false;
    if (!normalizedShotQuery) return true;

    const relatedCharacters = (shot.characters ?? [])
      .map((item) => charNames.get(item.characterId) ?? item.characterId)
      .join(' ');
    const sceneName = shot.sceneId ? (locNames.get(shot.sceneId) ?? shot.sceneId) : '';
    const haystack = [
      shot.shotId,
      String(idx + 1),
      shot.visualPrompt,
      shot.dialogue?.text ?? '',
      relatedCharacters,
      sceneName,
    ].join(' ').toLowerCase();
    return haystack.includes(normalizedShotQuery);
  });
  const showCharacterAssets = (assetTypeFilter === 'all' || assetTypeFilter === 'character') && filteredCharacters.length > 0;
  const showLocationAssets = (assetTypeFilter === 'all' || assetTypeFilter === 'location') && filteredLocations.length > 0;
  const showPropAssets = (assetTypeFilter === 'all' || assetTypeFilter === 'prop') && filteredProps.length > 0;
  const showAssetEmptyState = !showCharacterAssets && !showLocationAssets && !showPropAssets;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => history.push('/novel/dramas')}>
          <ArrowLeft className="h-4 w-4" />返回
        </Button>
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-violet-500" />
          <Badge variant="secondary" className="text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400">短剧</Badge>
        </div>
      </div>

      {/* Drama info */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{(drama as any).title}</h1>
        <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
          <span>{(drama as any).genre}</span>
          <span>·</span>
          <span>{(drama as any).episodesGenerated ?? 0} / {(outline?.totalPlannedEpisodes as number) ?? '?'} 集</span>
          {catharsisType && <><span>·</span><span>爽点：{catharsisType}</span></>}
          {characters.length > 0 && <><span>·</span><span>{characters.length} 角色</span></>}
          {locations.length > 0 && <><span>·</span><span>{locations.length} 场景</span></>}
          {allProps.length > 0 && <><span>·</span><span>{allProps.length} 道具</span></>}
        </div>
        {logline && <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{logline}</p>}
      </div>

      {usage && (
        <Card className="mb-6 border-primary/30 bg-primary/[0.02]">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">资源消耗统计</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setUsageExpanded((v) => !v)}
              >
                {usageExpanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                {usageExpanded ? '收起明细' : '展开明细'}
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-md border px-2 py-1.5">
                <p className="text-muted-foreground">总费用</p>
                <p className="font-semibold">{fmtCny(bucketCost(usage.total))}</p>
              </div>
              <div className="rounded-md border px-2 py-1.5">
                <p className="text-muted-foreground">LLM Tokens</p>
                <p className="font-semibold">{usage.total.totalTokens.toLocaleString()}</p>
              </div>
              <div className="rounded-md border px-2 py-1.5">
                <p className="text-muted-foreground">图片调用</p>
                <p className="font-semibold">{usage.total.imageCalls}</p>
              </div>
              <div className="rounded-md border px-2 py-1.5">
                <p className="text-muted-foreground">视频调用</p>
                <p className="font-semibold">{usage.total.videoCalls}</p>
              </div>
              {(usage.total.ttsCalls ?? 0) > 0 && (
                <div className="rounded-md border px-2 py-1.5">
                  <p className="text-muted-foreground">TTS 调用</p>
                  <p className="font-semibold">{usage.total.ttsCalls}</p>
                </div>
              )}
              {(usage.total.embeddingCalls ?? 0) > 0 && (
                <div className="rounded-md border px-2 py-1.5">
                  <p className="text-muted-foreground">Embedding</p>
                  <p className="font-semibold">{(usage.total.embeddingTokens ?? 0).toLocaleString()} tokens</p>
                </div>
              )}
            </div>

            {usageExpanded && (
              <>
                <div className="grid sm:grid-cols-2 gap-2 text-xs pt-1">
                  <div className="rounded-md border p-2.5">
                    <p className="text-muted-foreground mb-1">创建阶段</p>
                    <p className="font-medium">{fmtCny(bucketCost(usage.creation))}</p>
                    <p className="text-muted-foreground mt-0.5">tokens {usage.creation.totalTokens.toLocaleString()} · 图片 {usage.creation.imageCalls} · 视频 {usage.creation.videoCalls}</p>
                  </div>
                  <div className="rounded-md border p-2.5">
                    <p className="text-muted-foreground mb-1">集数阶段</p>
                    <p className="font-medium">{fmtCny(bucketCost(usage.total) - bucketCost(usage.creation))}</p>
                    <p className="text-muted-foreground mt-0.5">共 {usage.episodes.length} 集有消耗统计</p>
                  </div>
                </div>

                {usage.creation.steps.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-medium mb-1.5">创建步骤明细</p>
                    <div className="space-y-1">
                      {usage.creation.steps.map((s) => (
                        <div key={s.step} className="text-xs flex items-center justify-between text-muted-foreground">
                          <span>{STEP_LABELS[s.step] ?? s.step}</span>
                          <span>{fmtCny(bucketCost(s))} · {s.totalTokens.toLocaleString()} tokens</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {usage.episodes.length > 0 && (
                  <div className="pt-1">
                    <p className="text-xs font-medium mb-1.5">分集消耗</p>
                    <div className="max-h-52 overflow-auto border rounded-md divide-y">
                      {usage.episodes.map((epUsage) => {
                        const open = expandedEpisodeUsage === epUsage.episodeNumber;
                        return (
                          <div key={epUsage.episodeNumber} className="text-xs">
                            <button
                              type="button"
                              className="w-full px-2.5 py-1.5 flex items-center justify-between hover:bg-muted/50 transition-colors"
                              onClick={() => setExpandedEpisodeUsage((v) => (v === epUsage.episodeNumber ? null : epUsage.episodeNumber))}
                            >
                              <span>第 {epUsage.episodeNumber} 集</span>
                              <span className="text-muted-foreground">
                                {fmtCny(bucketCost(epUsage))} · {epUsage.totalTokens.toLocaleString()} tokens · 图 {epUsage.imageCalls} / 视 {epUsage.videoCalls}
                              </span>
                            </button>
                            {open && epUsage.steps.length > 0 && (
                              <div className="px-2.5 pb-2 space-y-1 text-[11px] text-muted-foreground bg-muted/20">
                                {epUsage.steps.map((step) => (
                                  <div key={step.step} className="flex items-center justify-between">
                                    <span>{STEP_LABELS[step.step] ?? step.step}</span>
                                    <span>{fmtCny(bucketCost(step))} · {step.totalTokens.toLocaleString()} tokens</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="episodes">
        <TabsList className="mb-5">
          <TabsTrigger value="episodes" className="gap-1.5">
            <Film className="h-3.5 w-3.5" />
            分集列表
            {episodes.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 min-w-[18px] px-1">{episodes.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            角色 & 场景
            {(characters.length + locations.length + allProps.length) > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 min-w-[18px] px-1">
                {characters.length + locations.length + allProps.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="workshop" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            创作工坊
          </TabsTrigger>
        </TabsList>

        {/* ── 分集列表 ── */}
        <TabsContent value="episodes">
          <div className="flex gap-3 mb-4">
            {!paused ? (
              <>
                <Button className="gap-2" disabled={generating} onClick={() => handleGenerate()}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {generating ? '生成中...' : '生成下一集'}
                </Button>
              </>
            ) : (
              <>
                <Button className="gap-2" onClick={() => handleGenerate()}>
                  <Play className="h-4 w-4" />继续生成
                </Button>
              </>
            )}
          </div>

          {/* 已暂停提示 */}
          {paused && !generating && (
            <Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Pause className="h-4 w-4 text-amber-500" />
                  <span className="font-medium text-amber-800 dark:text-amber-200">生成已暂停</span>
                  <span className="text-muted-foreground text-xs ml-auto">点击「继续生成」恢复</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 实时生成进度（SSE 连接活跃） */}
          {generating && (
            <Card className="mb-4 border-violet-200 dark:border-violet-800">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                  <span className="font-medium">{pauseLoading ? '暂停中，等待当前集完成...' : (genStep || '准备中...')}</span>
                  <span className="text-muted-foreground ml-auto tabular-nums">{genProgress}%</span>
                </div>
                <Progress value={genProgress} className="h-1.5" />
                {skippedSteps.length > 0 && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 px-2.5 py-2 space-y-1">
                    <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">本轮已跳过步骤</p>
                    <div className="flex flex-wrap gap-1.5">
                      {skippedSteps.map((item) => (
                        <Badge key={item.key} variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">
                          {item.label} · {item.reason}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {!pauseLoading && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 mt-1 h-7 text-xs"
                    onClick={handlePause}
                  >
                    <Pause className="h-3 w-3" />暂停
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* 后端生成被中断/失败 → 显示恢复提示 */}
          {!generating && dbRunning.length > 0 && (
            <Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-900/10">
              <CardContent className="p-4 space-y-2">
                {dbRunning.map(r => {
                  const isFailed = r.status === 'failed';
                  return (
                    <div key={r.episodeNumber} className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        <span className="font-medium text-amber-800 dark:text-amber-200">
                          E{r.episodeNumber} {isFailed ? '生成失败' : '生成被中断'}
                        </span>
                        <span className="text-muted-foreground ml-auto tabular-nums text-xs">{r.progressPct}%</span>
                      </div>
                      {isFailed && r.errorMessage && (
                        <p className="text-xs text-amber-700 dark:text-amber-300 truncate">{r.errorMessage}</p>
                      )}
                      <Progress value={r.progressPct} className="h-1.5" />
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-amber-700 dark:text-amber-300">
                          上次进度：{r.stepLabel}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2 border-amber-300 hover:bg-amber-100"
                          onClick={() => handleGenerate()}
                        >
                          {isFailed ? '从断点重试' : '从断点继续'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {lastError && !generating && (
            <Card className="mb-4 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">生成失败</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 truncate mt-0.5">{lastError}</p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0"
                  onClick={() => { setLastError(null); handleGenerate(); }}>
                  从断点重试
                </Button>
              </CardContent>
            </Card>
          )}

          {episodes.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">尚未生成任何集</CardContent></Card>
          ) : (
            <div className="space-y-2">
              {episodes.map((ep) => {
                const epExec = latestExecByEpisode.get(ep.episodeNumber);
                const skippedCount = epExec?.skippedCount ?? 0;
                const skippedTooltip = (epExec?.skippedSteps ?? [])
                  .slice(0, 8)
                  .map((s) => `${resolveSkippedStepLabel({ nodeId: s.nodeId, stepKey: s.stepKey, message: s.message })} · ${resolveSkipReasonLabel(s.skipReason)}`)
                  .join('\n');
                return (
                  <Card
                    key={ep.id}
                    className="group cursor-pointer hover:border-primary/30 transition-all"
                    onClick={() => history.push(`/novel/drama/${dramaId}/episodes/${ep.episodeNumber}`)}
                  >
                    <CardContent className="flex items-center gap-4 p-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-bold text-sm shrink-0">
                        {ep.episodeNumber}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ep.title}</p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{ep.totalDurationSec}s</span>
                          <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{ep.shotCount} 镜</span>
                          {ep.mediaStatus === 'completed' && (
                            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                              <Film className="h-3 w-3" />已生成
                            </span>
                          )}
                          {(ep.mediaStatus === 'generating_first_frames' || ep.mediaStatus === 'generating_images' || ep.mediaStatus === 'generating_videos') && (
                            <span className="text-amber-600 inline-flex items-center gap-1">
                              <Loader2 className="h-3 w-3 animate-spin" />生成中
                            </span>
                          )}
                          {skippedCount > 0 && (
                            <span
                              className="text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"
                              title={skippedTooltip || '存在流程跳过项'}
                            >
                              <AlertCircle className="h-3 w-3" />跳过 {skippedCount} 步
                            </span>
                          )}
                        </div>
                      </div>
                      {ep.overallScore !== null && (() => {
                        const score = Number(ep.overallScore);
                        if (!Number.isFinite(score)) return null;
                        return (
                          <span className={cn('text-sm font-semibold tabular-nums',
                            score >= 8 ? 'text-emerald-600' : score >= 7 ? 'text-amber-600' : 'text-red-500')}>
                            <Star className="h-3.5 w-3.5 inline mr-0.5" />{score.toFixed(1)}
                          </span>
                        );
                      })()}
                      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          onClick={() => handlePreview(ep)}
                        >
                          <Eye className="h-3 w-3" />脚本
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() => history.push(`/novel/drama/${dramaId}/episodes/${ep.episodeNumber}`)}
                        >
                          <Clapperboard className="h-3 w-3" />制作台
                        </Button>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── 角色 & 场景 ── */}
        <TabsContent value="assets">
          {characters.length === 0 && locations.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">核心角色在建剧时设计，其余角色和场景在各集生产时按需自动新增</CardContent></Card>
          ) : (
            <div className="space-y-6">
              <Card className="border-border/70 bg-muted/20">
                <CardContent className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(['all', 'character', 'location', 'prop'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setAssetTypeFilter(mode)}
                        className={cn(
                          'h-7 px-2.5 rounded-md text-xs border transition-colors',
                          assetTypeFilter === mode
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-background text-muted-foreground border-border hover:text-foreground',
                        )}
                      >
                        {mode === 'all'
                          ? '全部资产'
                          : mode === 'character'
                            ? `角色 ${characters.length}`
                            : mode === 'location'
                              ? `场景 ${locations.length}`
                              : `道具 ${allProps.length}`}
                      </button>
                    ))}
                    {missingAssetCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                        <AlertCircle className="h-3 w-3 mr-1" />缺图 {missingAssetCount}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={missingAssetCount > 0 ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-xs ml-auto"
                      disabled={allAssetsGenerating}
                      onClick={handleGenerateAllAssets}
                    >
                      {allAssetsGenerating ? (
                        <><Loader2 className="h-3 w-3 mr-1 animate-spin" />{allAssetsProgress || '生成中...'}</>
                      ) : missingAssetCount > 0 ? (
                        <><Wand2 className="h-3 w-3 mr-1" />{`生成全部参考图 (${missingAssetCount})`}</>
                      ) : (
                        <><RotateCcw className="h-3 w-3 mr-1" />重新生成全部</>
                      )}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      className="h-8 text-xs sm:max-w-sm"
                      value={assetQuery}
                      onChange={(e) => setAssetQuery(e.target.value)}
                      placeholder="搜索角色/场景/道具：名称、描述、服装..."
                    />
                    <p className="text-[11px] text-muted-foreground">
                      当前显示：角色 {filteredCharacters.length}/{characters.length} · 场景 {filteredLocations.length}/{locations.length} · 道具 {filteredProps.length}/{allProps.length}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {showCharacterAssets && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-4 w-4 text-violet-500" />
                    <h3 className="text-base font-semibold">角色</h3>
                    <Badge variant="secondary" className="text-xs">{filteredCharacters.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {filteredCharacters.map(char => (
                      <CharacterCard
                        key={char.characterId}
                        char={char}
                        imageUrl={assetImages.get(`character:${char.characterId}`)}
                        viewImages={assetViewImages.get(`character:${char.characterId}`)}
                        busy={assetGeneratingKeys.has(`character:${char.characterId}`)}
                        visualStyle={visualStyle}
                        variationImages={assetVariationImages.get(char.characterId)}
                        variationBusyKeys={variationGeneratingKeys}
                        onRegenerate={(viewAngle) => handleRegenerateAsset('character', char.characterId, viewAngle)}
                        onRefine={(input) => handleRefineAsset('character', char.characterId, input)}
                        onRegenerateVariation={(variationId) => handleRegenerateVariation(char.characterId, variationId)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {showLocationAssets && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-emerald-500" />
                    <h3 className="text-base font-semibold">场景</h3>
                    <Badge variant="secondary" className="text-xs">{filteredLocations.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {filteredLocations.map(loc => (
                      <LocationCard
                        key={loc.locationId}
                        loc={loc}
                        imageUrl={assetImages.get(`location:${loc.locationId}`)}
                        viewImages={assetViewImages.get(`location:${loc.locationId}`)}
                        busy={assetGeneratingKeys.has(`location:${loc.locationId}`)}
                        visualStyle={visualStyle}
                        onRegenerate={(viewAngle) => handleRegenerateAsset('location', loc.locationId, viewAngle)}
                        onRefine={(instruction, viewAngle) => handleRefineAsset('location', loc.locationId, { instruction, viewAngle })}
                      />
                    ))}
                  </div>
                </div>
              )}
              {showPropAssets && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-base">🎭</span>
                    <h3 className="text-base font-semibold">道具</h3>
                    <Badge variant="secondary" className="text-xs">{filteredProps.length}</Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {filteredProps.map(prop => (
                      <PropCard
                        key={prop.id}
                        prop={prop}
                        busy={assetGeneratingKeys.has(`prop:${prop.refId}`)}
                        onRegenerate={() => {
                          const asset = assetByKey.get(`prop:${prop.refId}`);
                          if (!asset || !dramaId) return;
                          setAssetGeneratingKeys(prev => new Set(prev).add(`prop:${prop.refId}`));
                          regenerateVisualAssetImage(dramaId, asset.id)
                            .then(updated => applyUpdatedAsset(updated))
                            .catch(() => message.error('道具图片重新生成失败'))
                            .finally(() => setAssetGeneratingKeys(prev => { const s = new Set(prev); s.delete(`prop:${prop.refId}`); return s; }));
                        }}
                        onRefine={(instruction) => {
                          const asset = assetByKey.get(`prop:${prop.refId}`);
                          if (!asset || !dramaId) return;
                          setAssetGeneratingKeys(prev => new Set(prev).add(`prop:${prop.refId}`));
                          refineVisualAssetImage(dramaId, asset.id, { instruction })
                            .then(({ asset: updated }) => applyUpdatedAsset(updated))
                            .catch(() => message.error('道具图片精修失败'))
                            .finally(() => setAssetGeneratingKeys(prev => { const s = new Set(prev); s.delete(`prop:${prop.refId}`); return s; }));
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {showAssetEmptyState ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-xs text-muted-foreground">
                    未找到符合筛选条件的资产
                  </CardContent>
                </Card>
              ) : null}
            </div>
          )}
        </TabsContent>

        {/* ── 创作工坊 ── */}
        <TabsContent value="workshop">
          <WorkshopTab
            dramaId={dramaId ?? ''}
            drama={drama}
            onDramaUpdated={fetchData}
            draftNodes={draftNodes}
            setDraftNodes={setDraftNodes}
            workflowParams={workflowParams}
            setWorkflowParams={setWorkflowParams}
            pipeline={pipeline}
            setPipeline={setPipeline}
            selectedNodeId={selectedNodeId}
            setSelectedNodeId={setSelectedNodeId}
            nodeAdditional={nodeAdditional}
            setNodeAdditional={setNodeAdditional}
            nodeAdditionalSaved={nodeAdditionalSaved}
            setNodeAdditionalSaved={setNodeAdditionalSaved}
            pipelineSaving={pipelineSaving}
            setPipelineSaving={setPipelineSaving}
            pipelinePublishing={pipelinePublishing}
            setPipelinePublishing={setPipelinePublishing}
            paramsSaving={paramsSaving}
            setParamsSaving={setParamsSaving}
          />
        </TabsContent>
      </Tabs>

      {/* Episode preview dialog */}
      <Dialog open={!!previewEp} onOpenChange={(open) => { if (!open) { setPreviewEp(null); setShowMediaConfirm(false); } }}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Clapperboard className="h-5 w-5 text-violet-500 shrink-0" />
              第 {previewEpNum} 集 — {(previewEp as any)?.title}
              {humanEditedCount > 0 && (
                <Badge variant="secondary" className="text-[10px] text-violet-600 bg-violet-100 dark:bg-violet-900/30">
                  <Lock className="h-2.5 w-2.5 mr-1" />{humanEditedCount} 镜已锁定
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : previewEp ? (
            <ScrollArea className="flex-1 overflow-auto">
              <div className="px-5 py-4 space-y-5">
                {/* Stats + media action */}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5" />{shots.length} 个镜头
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />{(previewEp as any).storyboard?.totalEstimatedDurationSec}s
                    </span>
                    {generatedShotCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600">
                        <Eye className="h-3.5 w-3.5" />{generatedShotCount}/{shots.length} 张图
                      </span>
                    )}
                    {problemShotCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-red-600">
                        <AlertCircle className="h-3.5 w-3.5" />{problemShotCount} 个问题镜头
                      </span>
                    )}
                    {problemShotCount > 0 && FIX_TARGET_ORDER.some((tag) => fixTargetCounts[tag] > 0) && (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                        <Star className="h-3.5 w-3.5" />
                        {FIX_TARGET_ORDER.filter((tag) => fixTargetCounts[tag] > 0)
                          .map((tag) => `${FIX_TARGET_LABELS[tag]}:${fixTargetCounts[tag]}`)
                          .join(' · ')}
                      </span>
                    )}
                    {humanEditedCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-violet-600">
                        <Lock className="h-3.5 w-3.5" />{humanEditedCount} 镜锁定
                      </span>
                    )}
                    {previewSkippedSteps.length > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                        <AlertCircle className="h-3.5 w-3.5" />跳过 {previewSkippedSteps.length} 步
                      </span>
                    )}
                  </div>

                  {previewEpNum !== undefined && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {problemShotCount > 0 && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs gap-1"
                            disabled={mediaGenEp !== null || problemResetEp !== null}
                            onClick={() => handleRegenerateProblemShots(previewEpNum, { onlyHighPriority: false, fixTarget: 'all' })}
                          >
                            {problemResetEp === previewEpNum && problemResetMode === 'all'
                              ? <><Loader2 className="h-3 w-3 animate-spin" />全量重置中…</>
                              : <><RotateCcw className="h-3 w-3" />重生全部（{problemShotCount}）</>}
                          </Button>
                          {highPriorityProblemShotCount > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              disabled={mediaGenEp !== null || problemResetEp !== null}
                              onClick={() => handleRegenerateProblemShots(previewEpNum, { onlyHighPriority: true, fixTarget: 'all' })}
                            >
                              {problemResetEp === previewEpNum && problemResetMode === 'high'
                                ? <><Loader2 className="h-3 w-3 animate-spin" />高优先重置中…</>
                                : <><Star className="h-3 w-3" />高优先（{highPriorityProblemShotCount}）</>}
                            </Button>
                          )}
                          {FIX_TARGET_ORDER.filter((target) => fixTargetCounts[target] > 0).map((target) => (
                            <Button
                              key={target}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              disabled={mediaGenEp !== null || problemResetEp !== null}
                              onClick={() => handleRegenerateProblemShots(previewEpNum, { onlyHighPriority: false, fixTarget: target })}
                            >
                              {problemResetEp === previewEpNum && problemResetMode === target
                                ? <><Loader2 className="h-3 w-3 animate-spin" />{FIX_TARGET_LABELS[target]}重置中…</>
                                : <><RotateCcw className="h-3 w-3" />修{FIX_TARGET_LABELS[target]}（{fixTargetCounts[target]}）</>}
                            </Button>
                          ))}
                        </>
                      )}

                      {(previewEp as any).mediaStatus !== 'completed' && (
                        !showMediaConfirm ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={mediaGenEp !== null || problemResetEp !== null} onClick={() => setShowMediaConfirm(true)}>
                            <Film className="h-3 w-3" />生成媒体
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-muted-foreground">确认？</p>
                            <Button size="sm" className="h-7 text-xs" disabled={mediaGenEp !== null || problemResetEp !== null} onClick={() => handleGenerateMedia(previewEpNum)}>
                              {mediaGenEp === previewEpNum
                                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />{mediaGenProgress}%</>
                                : '确认'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowMediaConfirm(false)}>取消</Button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>

                {previewSkippedSteps.length > 0 && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 p-2.5">
                    <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 mb-1.5">流程跳过记录</p>
                    <div className="flex flex-wrap gap-1.5">
                      {previewSkippedSteps.slice(0, 12).map((step, idx) => (
                        <Badge key={`${step.stepKey ?? 'step'}-${step.nodeId ?? ''}-${idx}`} variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-300">
                          {resolveSkippedStepLabel({ nodeId: step.nodeId, stepKey: step.stepKey, message: step.message })} · {resolveSkipReasonLabel(step.skipReason)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {(previewEp as any).videoUrl && (
                  <div className="rounded-lg overflow-hidden bg-black">
                    <video src={(previewEp as any).videoUrl} controls className="w-full max-h-56" />
                  </div>
                )}

                {mediaGenEp === previewEpNum && (
                  <Card className="border-violet-200 dark:border-violet-800">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                        <span>媒体生成中...</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">{mediaGenProgress}%</span>
                      </div>
                      <Progress value={mediaGenProgress} className="h-1.5" />
                    </CardContent>
                  </Card>
                )}

                {/* Emotion Beats */}
                {(() => {
                  const beats = ((previewEp as any)?.intent?.emotionBeats ?? []) as EmotionBeat[];
                  if (!beats.length) return null;
                  const EMOTION_COLORS: Record<string, string> = {
                    tension: 'bg-red-400', fear: 'bg-purple-400', joy: 'bg-yellow-400', sadness: 'bg-blue-400',
                    anger: 'bg-orange-400', surprise: 'bg-pink-400', hope: 'bg-emerald-400', despair: 'bg-gray-500',
                    relief: 'bg-teal-400', excitement: 'bg-rose-400', suspense: 'bg-indigo-400', warmth: 'bg-amber-400',
                  };
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-2.5">
                        <Heart className="h-4 w-4 text-rose-500" />
                        <h3 className="text-sm font-semibold">情绪节拍表</h3>
                        <span className="text-[10px] text-muted-foreground ml-auto">{beats.length} 个节拍</span>
                      </div>
                      <div className="relative rounded-lg bg-muted/50 p-3 overflow-hidden">
                        <div className="relative h-8 rounded bg-muted mb-2">
                          {beats.map((b, i) => {
                            const left = (b.startPct ?? 0) * 100;
                            const width = Math.max(((b.endPct ?? 0) - (b.startPct ?? 0)) * 100, 1);
                            const color = EMOTION_COLORS[b.emotion ?? ''] ?? 'bg-violet-400';
                            const opacity = 0.3 + (b.intensity ?? 0.5) * 0.7;
                            return (
                              <div
                                key={b.beatId ?? i}
                                className={cn('absolute top-0 h-full rounded-sm transition-colors', color)}
                                style={{ left: `${left}%`, width: `${width}%`, opacity }}
                                title={`${b.emotion} (${((b.startPct ?? 0) * 100).toFixed(0)}%–${((b.endPct ?? 0) * 100).toFixed(0)}%) 强度:${((b.intensity ?? 0) * 100).toFixed(0)}%`}
                              />
                            );
                          })}
                          <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1 text-[8px] text-muted-foreground/60">
                            <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {beats.map((b, i) => (
                            <div key={b.beatId ?? i} className="flex items-center gap-1 text-[10px]">
                              <span className={cn('w-2 h-2 rounded-full', EMOTION_COLORS[b.emotion ?? ''] ?? 'bg-violet-400')} />
                              <span className="font-medium">{b.emotion}</span>
                              <span className="text-muted-foreground">{((b.startPct ?? 0) * 100).toFixed(0)}–{((b.endPct ?? 0) * 100).toFixed(0)}%</span>
                              {b.trigger && <span className="text-muted-foreground/70 truncate max-w-24">({b.trigger})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Review scores */}
                {(previewEp as any).review && (
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <Star className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-semibold">质量评分</h3>
                      <span className={cn('ml-auto text-base font-bold tabular-nums',
                        (previewEp as any).review.overallScore >= 8 ? 'text-emerald-600' :
                        (previewEp as any).review.overallScore >= 7 ? 'text-amber-600' : 'text-red-500')}>
                        {Number((previewEp as any).review.overallScore).toFixed(1)}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Object.entries((previewEp as any).review.dimensions || {}).map(([k, v]) => (
                        <div key={k} className="text-center p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground leading-tight">
                            {k === 'visualImpact' ? '画面冲击' : k === 'dialogueNaturalness' ? '台词自然' :
                             k === 'pacing' ? '节奏' : k === 'hookStrength' ? '悬念强度' :
                             k === 'consistency' ? '连续性' : k === 'emotionalImpact' ? '情感冲击' : k}
                          </p>
                          <p className="text-sm font-bold mt-0.5">{(v as number).toFixed(1)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Continuity warnings */}
                {continuityResult && (
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      <AlertCircle className="h-4 w-4 text-sky-500" />
                      <h3 className="text-sm font-semibold">连续性预检</h3>
                      <span className={cn(
                        'ml-auto text-xs px-2 py-0.5 rounded',
                        continuityWarnings.some(w => w.severity === 'block')
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                      )}>
                        {continuityWarnings.some(w => w.severity === 'block') ? '存在阻断项' : '通过'}
                      </span>
                    </div>

                    {continuityWarnings.length === 0 ? (
                      <p className="text-xs text-muted-foreground">未发现连续性问题</p>
                    ) : (
                      <div className="space-y-2">
                        {continuityWarnings.map((w, i) => (
                          <div
                            key={`${w.type}-${i}`}
                            className={cn(
                              'rounded-md border px-2.5 py-2',
                              w.severity === 'block'
                                ? 'border-red-200 bg-red-50/60 dark:border-red-800 dark:bg-red-950/20'
                                : 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20',
                            )}
                          >
                            <div className="flex items-center gap-2 text-xs mb-1">
                              <span className="font-medium">
                                {CONTINUITY_WARNING_LABELS[w.type] ?? w.type}
                              </span>
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[10px]',
                                w.severity === 'block'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                              )}>
                                {CONTINUITY_SEVERITY_LABELS[w.severity] ?? w.severity}
                              </span>
                              {w.affectedEntityId && (
                                <span className="text-muted-foreground">对象：{w.affectedEntityId}</span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{w.description}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {(continuityResult.contextInjections?.length ?? 0) > 0 && (
                      <div className="mt-2.5 rounded-md border border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20 p-2.5">
                        <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 mb-1">上下文注入建议</p>
                        <div className="space-y-1">
                          {continuityResult.contextInjections!.slice(0, 5).map((ctx, idx) => (
                            <p key={idx} className="text-xs text-sky-700/90 dark:text-sky-300/90 leading-relaxed">- {ctx}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Shot browser */}
                {shots.length > 0 && (
                  <div>
                    <div className="space-y-2.5 mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">分镜脚本</h3>
                          <Badge variant="secondary" className="text-[10px]">{shots.length} 镜</Badge>
                          {humanEditedCount > 0 && (
                            <Badge variant="secondary" className="text-[10px] text-violet-600 bg-violet-100 dark:bg-violet-900/30">
                              {humanEditedCount} 锁定
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">点击铅笔图标编辑并锁定</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(['all', 'problem', 'locked', 'flashback'] as ShotFilterMode[]).map((mode) => {
                            const count = mode === 'all'
                              ? shots.length
                              : mode === 'problem'
                                ? problemShotCount
                                : mode === 'locked'
                                  ? humanEditedCount
                                  : flashbackShotCount;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setShotFilterMode(mode)}
                                className={cn(
                                  'h-7 px-2.5 rounded-md text-xs border transition-colors',
                                  shotFilterMode === mode
                                    ? 'bg-violet-600 text-white border-violet-600'
                                    : 'bg-background text-muted-foreground border-border hover:text-foreground',
                                )}
                              >
                                {SHOT_FILTER_LABELS[mode]} {count}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="h-8 text-xs sm:max-w-sm"
                            value={shotQuery}
                            onChange={(e) => setShotQuery(e.target.value)}
                            placeholder="搜索镜头：镜号、角色、场景、台词、画面描述..."
                          />
                          <p className="text-[11px] text-muted-foreground">
                            当前显示 {filteredShots.length}/{shots.length} 镜
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {filteredShots.map((shot, idx) => (
                        <ShotCard
                          key={shot.shotId ?? idx}
                          shot={shot}
                          index={shotOrderById.get(shot.shotId) ?? idx}
                          charNames={charNames}
                          locNames={locNames}
                          mediaItem={shotMediaMap[shot.shotId] ?? null}
                          dramaId={dramaId ?? ''}
                          episodeNumber={previewEpNum ?? 1}
                          onShotUpdated={handleShotUpdated}
                        />
                      ))}
                      {filteredShots.length === 0 && (
                        <Card className="border-dashed">
                          <CardContent className="py-8 text-center text-xs text-muted-foreground">
                            当前筛选条件下没有匹配镜头
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DramaWorkbench;
