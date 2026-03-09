/**
 * 渲染配置(Rendering Profile) — 定义图片模型的能力边界和最佳实践。
 * 解决不同模型在参考图策略、negative prompt、prompt 格式上的差异，
 * 让 MediaOrchestrator 按模型特性组装请求，而非硬编码假设。
 *
 * 扩展新模型只需：
 *   1. 在 rendering-profile.service.ts 的 PROFILE_REGISTRY 中添加匹配规则
 *   2. 定义对应的 RenderingProfile 常量
 */

export type RefImageRole = 'character_face' | 'scene' | 'style' | 'prev_frame';

export const CHARACTER_VIEW_ANGLES = [
  'face_front', 'face_three_quarter', 'upper_body_front',
  'full_body_front', 'side_profile', 'back_view',
] as const;
export type CharacterViewAngle = typeof CHARACTER_VIEW_ANGLES[number];

export interface RefImageCandidate {
  url: string;
  weight: number;
  role: RefImageRole;
}

export interface RenderingProfile {
  readonly modelFamily: string;
  readonly displayName: string;

  /** 参考图策略 — 不同模型对参考图的数量、权重、用途支持差异极大 */
  refImage: {
    /** 模型支持的最大参考图数量（超出按优先级截断） */
    maxCount: number;
    /** 模型是否理解参考图权重（Seedream 不支持，未来 Flux IP-Adapter 支持） */
    supportsWeight: boolean;
    /**
     * 按镜头类型的参考图优先级（索引越小越优先）。
     * 当候选图超过 maxCount 时，低优先级的被丢弃。
     * - closeUp: 特写镜头 → 人脸一致性最关键
     * - wideShot: 全景镜头 → 场景环境优先
     * - default: 其余镜头 → 角色优先（短剧以人物驱动为主）
     */
    priorityByScenario: {
      closeUp: readonly RefImageRole[];
      wideShot: readonly RefImageRole[];
      default: readonly RefImageRole[];
    };
    /** 人脸一致性靠什么实现 */
    faceConsistencyMethod: 'text_only' | 'ref_image' | 'both';
  };

  /** Negative prompt 策略 — 部分模型不支持或反而有害 */
  negativePrompt: {
    supported: boolean;
    /** 该模型最佳实践的 negative prompt */
    defaultValue: string;
  };

  /** Prompt 文本格式偏好 */
  prompt: {
    /** 模型的 prompt 字符上限 */
    maxLength: number;
    /** 风格前缀的注入方式（prefix=前置, suffix=追加, none=不注入） */
    styleInjection: 'prefix' | 'suffix' | 'none';
    /** 模型专属质量提升前缀（如 SD 系 "masterpiece, best quality, "） */
    qualityPrefix?: string;
    /** 模型专属质量提升后缀 */
    qualitySuffix?: string;
  };

  /** 角色多角度参考图策略 — 按角色重要性决定生成哪些视角 */
  characterViews: {
    viewsByRole: Record<'protagonist' | 'antagonist' | 'supporting' | 'minor', readonly CharacterViewAngle[]>;
    /** 链式生成时，以 face_front 为参考图的权重 */
    chainReferenceWeight: number;
  };

  /** 模型专属额外参数（透传给 Provider.generate 的 extra 字段） */
  extraParams?: Record<string, unknown>;
}

/** 角色多角度参考图集 */
export interface CharacterImageSet {
  primary: string;
  views: Partial<Record<CharacterViewAngle, string>>;
}

// ═══ 工具函数 ═══

const CLOSE_ANGLES = ['close_up', 'extreme_close_up', 'medium_close_up'];
const WIDE_ANGLES = ['wide', 'extreme_wide', 'bird_eye'];
const MEDIUM_ANGLES = ['medium', 'medium_wide', 'medium_close_up'];

/**
 * 按渲染配置的优先级策略筛选参考图。
 * 核心逻辑：先按镜头类型确定优先级序列 → URL 去重 → 按优先级排序 → 截断到模型上限。
 */
export function selectRefImages(
  candidates: RefImageCandidate[],
  profile: RenderingProfile,
  cameraAngle?: string,
): Array<{ url: string; weight: number }> {
  if (!candidates.length) return [];

  const isCloseUp = CLOSE_ANGLES.includes(cameraAngle ?? '');
  const isWide = WIDE_ANGLES.includes(cameraAngle ?? '');
  const priority = isCloseUp
    ? profile.refImage.priorityByScenario.closeUp
    : isWide
      ? profile.refImage.priorityByScenario.wideShot
      : profile.refImage.priorityByScenario.default;

  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  unique.sort((a, b) => {
    const ai = priority.indexOf(a.role);
    const bi = priority.indexOf(b.role);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return unique.slice(0, profile.refImage.maxCount).map(r => ({
    url: r.url,
    weight: profile.refImage.supportsWeight ? r.weight : 1,
  }));
}

/** 从 Shot.camera 提取景别/构图/景深，构建 prompt 补充片段 */
export function buildCameraHint(camera?: { angle?: string; composition?: string; depthOfField?: string }): string {
  if (!camera) return '';
  const parts: string[] = [];
  if (camera.angle) parts.push(camera.angle.replace(/_/g, ' '));
  if (camera.composition) parts.push(camera.composition.replace(/_/g, ' '));
  if (camera.depthOfField && camera.depthOfField !== 'medium') parts.push(`${camera.depthOfField} depth of field`);
  return parts.join(', ');
}

/**
 * 按渲染配置组装最终 T2I prompt。
 * 替代原先硬编码的 enrichT2iPrompt：camera hint + 风格注入 + 质量 token 均由 profile 驱动。
 */
export function assembleT2iPrompt(
  raw: string,
  profile: RenderingProfile,
  opts?: { cameraHint?: string; stylePrefix?: string },
): string {
  let prompt = raw;

  if (opts?.cameraHint) {
    prompt = `${prompt}, ${opts.cameraHint}`;
  }

  if (profile.prompt.qualityPrefix && !prompt.toLowerCase().includes(profile.prompt.qualityPrefix.toLowerCase().slice(0, 15))) {
    prompt = `${profile.prompt.qualityPrefix}${prompt}`;
  }
  if (profile.prompt.qualitySuffix) {
    prompt = `${prompt}, ${profile.prompt.qualitySuffix}`;
  }

  if (opts?.stylePrefix) {
    const normalized = opts.stylePrefix.replace(/,\s*$/, '');
    const alreadyHas = prompt.toLowerCase().includes(normalized.toLowerCase().slice(0, 15));
    if (!alreadyHas) {
      switch (profile.prompt.styleInjection) {
        case 'prefix': prompt = `${opts.stylePrefix}${prompt}`; break;
        case 'suffix': prompt = `${prompt}, ${normalized}`; break;
        case 'none': break;
      }
    }
  }

  if (prompt.length > profile.prompt.maxLength) {
    prompt = prompt.slice(0, profile.prompt.maxLength);
  }

  return prompt;
}

/**
 * 根据镜头参数选择最合适的角色参考图视角。
 * 核心逻辑：特写→面部，远景→全身，过肩→背面/3/4 侧面，中景→半身。
 */
export function selectBestCharacterView(
  availableViews: CharacterViewAngle[],
  cameraAngle?: string,
  characterPosition?: string,
): CharacterViewAngle {
  if (!availableViews.length) return 'face_front';
  const has = (v: CharacterViewAngle) => availableViews.includes(v);

  if (cameraAngle === 'over_shoulder') {
    if (characterPosition === 'foreground' || characterPosition === 'background') {
      return characterPosition === 'foreground'
        ? (has('back_view') ? 'back_view' : has('full_body_front') ? 'full_body_front' : 'face_front')
        : (has('face_three_quarter') ? 'face_three_quarter' : 'face_front');
    }
  }

  if (CLOSE_ANGLES.includes(cameraAngle ?? '')) {
    if (characterPosition === 'left' || characterPosition === 'right')
      return has('face_three_quarter') ? 'face_three_quarter' : 'face_front';
    return has('face_front') ? 'face_front' : availableViews[0];
  }

  if (WIDE_ANGLES.includes(cameraAngle ?? ''))
    return has('full_body_front') ? 'full_body_front' : has('upper_body_front') ? 'upper_body_front' : 'face_front';

  if (MEDIUM_ANGLES.includes(cameraAngle ?? ''))
    return has('upper_body_front') ? 'upper_body_front' : has('full_body_front') ? 'full_body_front' : 'face_front';

  return has('face_front') ? 'face_front' : availableViews[0];
}

/** 为指定视角构建 T2I prompt（链式生成用） */
export function buildViewAnglePrompt(
  char: {
    faceReferencePrompt?: string;
    bodyType?: string; bodyTypePrompt?: string;
    hairStyle?: string; hairStylePrompt?: string;
    defaultCostume?: string; defaultCostumePrompt?: string;
  },
  viewAngle: CharacterViewAngle,
): string {
  const face = char.faceReferencePrompt ?? '';
  const body = char.bodyTypePrompt || char.bodyType || '';
  const hair = char.hairStylePrompt || char.hairStyle || '';
  const costume = char.defaultCostumePrompt || char.defaultCostume || '';
  switch (viewAngle) {
    case 'face_front':
      return face;
    case 'face_three_quarter':
      return `three quarter view portrait, same person, slightly turned, ${face}, neutral background`;
    case 'upper_body_front':
      return `upper body portrait, same person, ${face}, wearing ${costume}, ${body} build, neutral background`;
    case 'full_body_front':
      return `full body standing portrait, same person, ${face}, ${body} build, ${hair} hair, wearing ${costume}, neutral studio background`;
    case 'side_profile':
      return `side profile portrait, same person, ${face}, ${hair} hair, neutral background`;
    case 'back_view':
      return `back view, same person from behind, ${hair} hair, ${body} build, wearing ${costume}, neutral background`;
    default:
      return face;
  }
}
