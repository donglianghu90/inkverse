/** 细节仓 — 角色/地点/道具的描写片段，供 Writer/Editor 构建上下文 */

export interface CharacterSignatureAction {
  action: string;
  trigger?: string;
  confidence?: number;
}

export type CharacterDescriptionType =
  | 'first_appearance'
  | 'face'
  | 'outfit'
  | 'gesture'
  | 'fight'
  | 'daily_life';

export interface CharacterDescriptionSnippet {
  chapterNumber: number;
  type: CharacterDescriptionType;
  text: string;
}

export interface CharacterDetail {
  characterId: string;
  signatureActions: CharacterSignatureAction[];
  descriptionSnippets: CharacterDescriptionSnippet[];
}

export interface LocationSensoryAnchor {
  sense: 'sight' | 'sound' | 'smell' | 'touch' | 'temperature';
  description: string;
  isLandmark?: boolean;
}

export interface LocationVisitMemory {
  chapterNumber: number;
  characterId: string;
  event: string;
  emotionalTone: string;
}

export type LocationDescriptionType =
  | 'panorama'
  | 'entrance'
  | 'interior'
  | 'weather'
  | 'crowd';

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

export interface ItemSensorySignature {
  visual?: string;
  tactile?: string;
  auditory?: string;
  olfactory?: string;
  weight?: string;
}

export interface ItemActivationEffect {
  chapterNumber: number;
  description: string;
}

export type ItemDescriptionType =
  | 'appearance'
  | 'origin'
  | 'activation'
  | 'limitation'
  | 'evolution';

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

export interface DetailStore {
  characters: CharacterDetail[];
  locations: LocationDetail[];
  items: ItemDetail[];
}

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
