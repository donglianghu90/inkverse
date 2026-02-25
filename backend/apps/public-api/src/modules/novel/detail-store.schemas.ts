/**
 * Lightweight "detail store" schemas for high-fidelity prose.
 *
 * 设计目标：
 * - 把「好写作需要的细节」（习惯动作、典型描写片段）和 StoryState 的硬事实解耦
 * - 只在需要的时候为 Writer/Editor 等 Agent 构建上下文
 * - 持久化为 jsonb（通过 ArtifactEntity），不强耦合数据库结构
 */

// 单个角色的标志性动作（签名动作）
export interface CharacterSignatureAction {
  action: string;          // 例如："思考时无意识摩挲纳戒"
  trigger?: string;        // 例如："紧张/思考时"
  confidence?: number;     // 0-1，未来可用于治理/筛选
}

// 角色的典型描写片段
export type CharacterDescriptionType =
  | 'first_appearance'   // 初次出场整体印象
  | 'face'               // 外貌/神情
  | 'outfit'             // 服饰
  | 'gesture'            // 动作/习惯动作
  | 'fight'              // 战斗场面中的形象
  | 'daily_life';        // 日常生活状态

export interface CharacterDescriptionSnippet {
  chapterNumber: number;
  type: CharacterDescriptionType;
  text: string;
}

// 角色细节档案
export interface CharacterDetail {
  characterId: string;
  signatureActions: CharacterSignatureAction[];
  descriptionSnippets: CharacterDescriptionSnippet[];
}

// ---------------------------------------------------------------------------
// 地点细节（感官锚点 + 访问记忆 + 描写片段）
// ---------------------------------------------------------------------------

/** 地点感官锚点：读者/角色再次到场时复现的标志性细节 */
export interface LocationSensoryAnchor {
  sense: 'sight' | 'sound' | 'smell' | 'touch' | 'temperature';
  description: string;
  isLandmark?: boolean; // true = 永久地标，每次出场都应提及
}

/** 角色在该地点的历史访问记忆（用于「重返同一地点」时描写偏移） */
export interface LocationVisitMemory {
  chapterNumber: number;
  characterId: string;
  event: string;        // 例如："被退婚"、"突破成功"
  emotionalTone: string; // 例如："屈辱"、"狂喜"
}

/** 地点描写片段类型 */
export type LocationDescriptionType =
  | 'panorama'   // 全景/首次远观
  | 'entrance'   // 入口/第一次进入
  | 'interior'   // 室内/内部
  | 'weather'    // 该地的天气/季节感
  | 'crowd';     // 人群/氛围

export interface LocationDescriptionSnippet {
  chapterNumber: number;
  type: LocationDescriptionType;
  text: string;
}

export interface LocationDetail {
  locationId: string;
  sensoryAnchors: LocationSensoryAnchor[];
  visitMemories: LocationVisitMemory[];
  descriptionSnippets: LocationDescriptionSnippet[];
}

// ---------------------------------------------------------------------------
// 道具/物品细节（感官签名 + 使用效果 + 描写片段）
// ---------------------------------------------------------------------------

/** 道具感官签名：视觉/触感/听觉等，便于再次出场时复现 */
export interface ItemSensorySignature {
  visual?: string;
  tactile?: string;
  auditory?: string;
  olfactory?: string;
  weight?: string;
}

/** 道具使用/激活时的效果描写（某章中的一次使用） */
export interface ItemActivationEffect {
  chapterNumber: number;
  description: string;
}

/** 道具描写片段类型 */
export type ItemDescriptionType =
  | 'appearance'  // 外观
  | 'origin'      // 来历
  | 'activation'  // 使用/激活时的效果
  | 'limitation'  // 限制/代价
  | 'evolution';  // 进化/阶段变化

export interface ItemDescriptionSnippet {
  chapterNumber: number;
  type: ItemDescriptionType;
  text: string;
}

export interface ItemDetail {
  itemId: string;
  sensorySignature?: ItemSensorySignature;
  activationEffects: ItemActivationEffect[];
  descriptionSnippets: ItemDescriptionSnippet[];
}

// ---------------------------------------------------------------------------
// DetailStore：角色 + 地点 + 道具
// ---------------------------------------------------------------------------

export interface DetailStore {
  characters: CharacterDetail[];
  locations: LocationDetail[];
  items: ItemDetail[];
}

export const EMPTY_DETAIL_STORE: DetailStore = {
  characters: [],
  locations: [],
  items: [],
};

/** 单章对细节仓的批量更新，用于一次 load → 合并 → save，避免并行 upsert 互相覆盖 */
export interface DetailStoreChapterUpdates {
  characterUpdates?: Array<{
    characterId: string;
    signatureActions?: CharacterSignatureAction[];
    descriptionSnippets?: CharacterDescriptionSnippet[];
  }>;
  locationUpdates?: Array<{
    locationId: string;
    sensoryAnchors?: LocationSensoryAnchor[];
    visitMemories?: LocationVisitMemory[];
    descriptionSnippets?: LocationDescriptionSnippet[];
  }>;
  itemUpdates?: Array<{
    itemId: string;
    sensorySignature?: Partial<ItemSensorySignature>;
    activationEffects?: ItemActivationEffect[];
    descriptionSnippets?: ItemDescriptionSnippet[];
  }>;
}

