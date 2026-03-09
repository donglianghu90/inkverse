/** 记忆检索 — 输入/输出契约 */

export interface MemoryQuery {
  characterIds?: string[];
  characterImportanceMap?: Record<string, string>;
  locationIds?: string[];
  plotThreadIds?: string[];
  keywords?: string[];
  semanticQuery?: string;
  excludeRecentN?: number;
  maxResults?: number;
}

export interface RankedMemory {
  chapterNumber: number;
  summary: string;
  keyEvents: string[];
  relevanceScore: number;
  matchReasons: string[];
  characterStates?: Record<string, { level: string; mood: string; status: string; location: string }>;
}

export interface PyramidLayer {
  level: 'volume' | 'arc' | 'chapter';
  id: string;
  summary: string;
  chapterRange: string;
  score: number;
}

export interface LongRangeContext {
  memories: RankedMemory[];
  pyramidLayers: PyramidLayer[];
  contextText: string;
}
