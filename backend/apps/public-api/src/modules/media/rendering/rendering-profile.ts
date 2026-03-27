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
  'face_happy', 'face_angry',
] as const;
export type CharacterViewAngle = typeof CHARACTER_VIEW_ANGLES[number];

export const LOCATION_VIEW_ANGLES = [
  'establishing',    // 建立镜头：全景展示空间全貌
  'interior_medium', // 中景：展示空间核心区域和关键道具
  'detail_close',    // 细节特写：展示标志性道具/质感/材质
] as const;
export type LocationViewAngle = typeof LOCATION_VIEW_ANGLES[number];

export const LOCATION_VIEW_LABELS: Record<string, string> = {
  establishing: '全景',
  interior_medium: '中景',
  detail_close: '细节特写',
};

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

  /** 角色参考图策略 — 逐集按需生成，仅保留链式权重 */
  characterViews: {
    /** 链式生成时，以 face_front 为参考图的权重 */
    chainReferenceWeight: number;
  };

  /** 场景多角度参考图策略 — 按场景复用频率决定生成哪些视角 */
  locationViews: {
    /** 常用场景（isRecurring=true）的视角列表 */
    recurring: readonly LocationViewAngle[];
    /** 普通场景的视角列表 */
    normal: readonly LocationViewAngle[];
    /** 链式生成时，以 establishing 为参考图的权重 */
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

/** 按景别（shotSize）分组 — 与 camera.shotSize 枚举对应 */
const CLOSE_SHOT_SIZES = ['close_up', 'extreme_close_up', 'medium_close_up'];
const WIDE_SHOT_SIZES = ['wide', 'extreme_wide'];
const MEDIUM_SHOT_SIZES = ['medium', 'medium_wide'];
/** 中远景 + 角色在左/右时易出现侧面，优先用 side_profile 参考图 */
const SIDE_LIKE_SIZES = ['medium_wide', 'wide', 'extreme_wide'];
/** bird_eye 是摄影角度（cameraAngle），视野覆盖类似大全景，参考图选全身 */
const BIRD_EYE_LIKE_ANGLES = ['bird_eye', 'worm_eye'];

/**
 * 按渲染配置的优先级策略筛选参考图。
 * 核心逻辑：先按镜头类型确定优先级序列 → URL 去重 → 按优先级排序 → 截断到模型上限。
 */
export function selectRefImages(
  candidates: RefImageCandidate[],
  profile: RenderingProfile,
  shotSize?: string,
  cameraAngle?: string,
): Array<{ url: string; weight: number }> {
  if (!candidates.length) return [];

  const isCloseUp = CLOSE_SHOT_SIZES.includes(shotSize ?? '');
  const isWide = WIDE_SHOT_SIZES.includes(shotSize ?? '') || BIRD_EYE_LIKE_ANGLES.includes(cameraAngle ?? '');
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

/** 从 Shot.camera 提取景别+角度+构图+景深，构建 T2I prompt 补充片段 */
export function buildCameraHint(camera?: {
  shotSize?: string;
  cameraAngle?: string;
  composition?: string;
  depthOfField?: string;
}): string {
  if (!camera) return '';
  const parts: string[] = [];
  if (camera.shotSize) parts.push(camera.shotSize.replace(/_/g, ' '));
  if (camera.cameraAngle && camera.cameraAngle !== 'three_quarter') {
    // three_quarter 是默认值，不注入以节省 token
    parts.push(camera.cameraAngle.replace(/_/g, ' '));
  }
  if (camera.composition) parts.push(camera.composition.replace(/_/g, ' '));
  if (camera.depthOfField && camera.depthOfField !== 'medium') parts.push(`${camera.depthOfField} depth of field`);
  return parts.join(', ');
}

/**
 * 对逗号分隔的 prompt 片段进行大小写不敏感的去重。
 * 保留首次出现顺序，删除后续重复片段。
 */
function deduplicatePromptSegments(prompt: string): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const seg of prompt.split(',')) {
    const trimmed = seg.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result.join(', ');
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
    // 使用前 50 字符作为判断依据（比 15 字符更精确），避免不同场景 visualPrompt 恰好共享前缀词导致误判
    const alreadyHas = prompt.toLowerCase().includes(normalized.toLowerCase().slice(0, 50));
    if (!alreadyHas) {
      switch (profile.prompt.styleInjection) {
        case 'prefix': prompt = `${opts.stylePrefix}${prompt}`; break;
        case 'suffix': prompt = `${prompt}, ${normalized}`; break;
        case 'none': break;
      }
    }
  }

  // 去除拼接后可能产生的重复片段（如 scene visualPrompt 与 stylePrefix 共享部分词汇时）
  prompt = deduplicatePromptSegments(prompt);

  if (prompt.length > profile.prompt.maxLength) {
    // Word-boundary-aware truncation: find the last comma or space before maxLength
    const cutPoint = profile.prompt.maxLength;
    const lastComma = prompt.lastIndexOf(',', cutPoint);
    const lastSpace = prompt.lastIndexOf(' ', cutPoint);
    const breakAt = Math.max(lastComma, lastSpace);
    prompt = breakAt > cutPoint * 0.5 ? prompt.slice(0, breakAt).trimEnd() : prompt.slice(0, cutPoint);
  }

  return prompt;
}

/**
 * 根据镜头参数选择最合适的角色参考图视角。
 * 核心逻辑：特写→面部，远景→全身，过肩→背面/3/4 侧面，中景→半身；
 * 中远景且角色在左/右时优先用 side_profile，保证成片服饰与正面定妆一致。
 * 情绪增强：特写/中近景时若角色情绪包含 happy/angry，优先使用对应表情视角。
 */
export function selectBestCharacterView(
  availableViews: CharacterViewAngle[],
  shotSize?: string,
  characterPosition?: string,
  cameraAngle?: string,
  emotion?: string,
): CharacterViewAngle {
  if (!availableViews.length) return 'face_front';
  const geometricViews = availableViews.filter(v => v !== 'face_happy' && v !== 'face_angry') as CharacterViewAngle[];
  if (!geometricViews.length) return 'face_front';
  const has = (v: CharacterViewAngle) => geometricViews.includes(v);
  const hasAll = (v: CharacterViewAngle) => availableViews.includes(v);

  // 情绪增强：特写/中近景时，若角色有强烈情绪且有对应表情视角，优先使用
  const isEmotionCloseEnough = CLOSE_SHOT_SIZES.includes(shotSize ?? '') || shotSize === 'medium_close_up' || shotSize === 'medium';
  if (isEmotionCloseEnough && emotion) {
    const emo = emotion.toLowerCase();
    if (/happ|smile|joy|laugh|deligh|pleas|warm|tender/.test(emo) && hasAll('face_happy')) return 'face_happy';
    if (/angr|fury|rage|furious|wrath|stern|fierce/.test(emo) && hasAll('face_angry')) return 'face_angry';
  }

  // 过肩镜头：前景角色用背影，后景角色用侧脸
  if (cameraAngle === 'over_shoulder') {
    if (characterPosition === 'foreground' || characterPosition === 'background') {
      return characterPosition === 'foreground'
        ? (has('back_view') ? 'back_view' : has('full_body_front') ? 'full_body_front' : 'face_front')
        : (has('face_three_quarter') ? 'face_three_quarter' : 'face_front');
    }
  }

  // bird_eye / worm_eye：俯仰视角优先全身图
  if (BIRD_EYE_LIKE_ANGLES.includes(cameraAngle ?? ''))
    return has('full_body_front') ? 'full_body_front' : has('upper_body_front') ? 'upper_body_front' : 'face_front';

  // 特写景别：按角色左右决定正面或斜侧
  if (CLOSE_SHOT_SIZES.includes(shotSize ?? '')) {
    if (characterPosition === 'left' || characterPosition === 'right')
      return has('face_three_quarter') ? 'face_three_quarter' : 'face_front';
    return has('face_front') ? 'face_front' : geometricViews[0];
  }

  // 中远景且角色在左/右：易出现侧面，优先用 side_profile 参考图
  if (SIDE_LIKE_SIZES.includes(shotSize ?? '') && (characterPosition === 'left' || characterPosition === 'right')) {
    if (has('side_profile')) return 'side_profile';
  }

  if (WIDE_SHOT_SIZES.includes(shotSize ?? ''))
    return has('full_body_front') ? 'full_body_front' : has('upper_body_front') ? 'upper_body_front' : has('side_profile') ? 'side_profile' : 'face_front';

  if (MEDIUM_SHOT_SIZES.includes(shotSize ?? ''))
    return has('upper_body_front') ? 'upper_body_front' : has('full_body_front') ? 'full_body_front' : has('side_profile') ? 'side_profile' : 'face_front';

  return has('face_front') ? 'face_front' : geometricViews[0];
}

/**
 * 根据镜头景别选择最合适的场景参考图视角。
 * 特写→细节，中景→中景内部，远景/全景→establishing；
 * 如果所需视角不存在，回退到 establishing。
 */
export function selectBestLocationView(
  availableViews: LocationViewAngle[],
  shotSize?: string,
): LocationViewAngle {
  if (!availableViews.length) return 'establishing';
  const has = (v: LocationViewAngle) => availableViews.includes(v);
  if (CLOSE_SHOT_SIZES.includes(shotSize ?? '')) {
    return has('detail_close') ? 'detail_close' : has('interior_medium') ? 'interior_medium' : 'establishing';
  }
  if (MEDIUM_SHOT_SIZES.includes(shotSize ?? '')) {
    return has('interior_medium') ? 'interior_medium' : 'establishing';
  }
  return 'establishing';
}

/**
 * 从 age 字符串推导英文 T2I 年龄描述（无 agePrompt 时使用）。
 * 支持 "50"、"50岁"、"约五十" 等，输出如 "around 50 years old, mature features"。
 */
export function ageToT2IPhrase(age: string | undefined): string {
  if (!age || !String(age).trim()) return '';
  const s = String(age).trim();
  const rangeMatch = s.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  const numMatch = rangeMatch ? null : s.match(/\d+/);
  let n: number;
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    n = Math.round((lo + hi) / 2);
  } else if (numMatch) {
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

/** 为场景指定视角构建 T2I prompt（链式生成用） */
export function buildLocationViewPrompt(
  loc: {
    visualPrompt?: string;
    description?: string;
    lightingDefault?: string;
    colorTone?: string;
    keyProps?: string[];
  },
  viewAngle: LocationViewAngle,
): string {
  const base = (loc.visualPrompt || loc.description || '').trim();
  if (!base) return '';
  // 过滤中文：lightingDefault 应为英文，但旧数据或 LLM 可能写中文，中文进英文 T2I 会产生混乱指令
  const hasChinese = (s: string) => /[\u4e00-\u9fff]/.test(s);
  const lighting = loc.lightingDefault && !hasChinese(loc.lightingDefault)
    ? `, ${loc.lightingDefault} lighting` : '';
  const color = loc.colorTone ? `, ${loc.colorTone.replace(/_/g, ' ')} color tone` : '';
  // keyProps 是中文场景陈设描述（仅用于剧本上下文），不拼入 T2I prompt
  switch (viewAngle) {
    case 'establishing':
      return `wide establishing shot, ${base}${lighting}${color}, full environment overview, architectural perspective, no people`;
    case 'interior_medium':
      return `medium shot interior view, ${base}${lighting}${color}, same location as reference, different angle showing central area, no people`;
    case 'detail_close':
      return `close-up detail shot, ${base}${lighting}${color}, same location as reference, focusing on textures, atmospheric detail, no people`;
    default:
      return base;
  }
}

/** 为指定视角构建 T2I prompt（链式生成用） */
export function buildViewAnglePrompt(
  char: {
    faceReferencePrompt?: string;
    bodyType?: string; bodyTypePrompt?: string;
    hairStyle?: string; hairStylePrompt?: string;
    defaultCostume?: string; defaultCostumePrompt?: string;
    age?: string;
    agePrompt?: string;
  },
  viewAngle: CharacterViewAngle,
): string {
  const face = char.faceReferencePrompt ?? '';
  const body = (char.bodyTypePrompt || char.bodyType || '').trim();
  const hair = (char.hairStylePrompt || char.hairStyle || '').trim();
  const costume = (char.defaultCostumePrompt || char.defaultCostume || '').trim();
  // 始终从 age 字段推导年龄词（ageToT2IPhrase 取范围最小值，避免 LLM 取中间值的错误）
  const agePhrase = ageToT2IPhrase(char.age) || (char.agePrompt && char.agePrompt.trim()) || '';
  const opt = (s: string, prefix = '') => (s ? `${prefix}${s}` : '');
  switch (viewAngle) {
    case 'face_front':
      return [face, opt(agePhrase), opt(hair), costume ? `wearing ${costume}` : '', opt(body), 'front-facing, looking at camera, neutral plain background, character reference sheet portrait']
        .filter(Boolean)
        .join(', ');
    case 'face_three_quarter':
      return [
        'three quarter view portrait, same person, slightly turned',
        face,
        opt(agePhrase),
        opt(hair),
        costume ? `wearing ${costume}` : '',
        opt(body),
        'neutral background',
      ]
        .filter(Boolean)
        .join(', ');
    case 'upper_body_front':
      return `upper body portrait, same person, ${face}, ${opt(agePhrase)}${agePhrase ? ', ' : ''}${costume ? `wearing ${costume}, ` : ''}${body ? `${body} build, ` : ''}neutral background`;
    case 'full_body_front':
      return `full body standing portrait, same person, ${face}, ${opt(agePhrase)}${agePhrase ? ', ' : ''}${body ? `${body} build, ` : ''}${hair ? `${hair}, ` : ''}${costume ? `wearing ${costume}, ` : ''}neutral studio background`;
    case 'side_profile':
      return `side profile portrait, same person, ${opt(agePhrase)}${agePhrase ? ', ' : ''}${hair ? `${hair}, ` : ''}${body ? `${body} build, ` : ''}${costume ? `wearing ${costume}, ` : ''}neutral background`;
    case 'back_view':
      return `back view, same person from behind, ${opt(agePhrase)}${agePhrase ? ', ' : ''}${hair ? `${hair}, ` : ''}${body ? `${body} build, ` : ''}${costume ? `wearing ${costume}, ` : ''}neutral background`;
    case 'face_happy':
      return [
        face,
        opt(agePhrase),
        opt(hair),
        costume ? `wearing ${costume}` : '',
        opt(body),
        'happy expression, genuine slight smile, pleased and warm, subtle not exaggerated, same facial bone structure, front-facing, looking at camera, neutral background',
      ]
        .filter(Boolean)
        .join(', ');
    case 'face_angry':
      return [
        face,
        opt(agePhrase),
        opt(hair),
        costume ? `wearing ${costume}` : '',
        opt(body),
        'angry expression, furrowed brows, sharp stern gaze, controlled tension in eyes, not distorted, same facial bone structure, front-facing, looking at camera, neutral background',
      ]
        .filter(Boolean)
        .join(', ');
    default:
      return face;
  }
}
