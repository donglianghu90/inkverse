/** 短剧引擎 API */
import { request } from '@umijs/max';
import { getToken } from '@/services/auth';

const BASE = '/api/drama';

export interface CreateDramaParams {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  titleHint?: string;
  mainStoryGoal?: string;
  platformTarget?: 'douyin' | 'kuaishou' | 'reelshort' | 'dramabox' | 'generic';
  aspectRatio?: '9:16' | '16:9';
  targetEpisodeDurationSec?: number;
  plannedMinEpisodes?: number;
  plannedMaxEpisodes?: number;
}

export interface DramaListItem {
  id: string;
  userId: string;
  title: string;
  genre: string;
  episodesGenerated: number;
  latestOverallScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EpisodeListItem {
  id: string;
  dramaId: string;
  episodeNumber: number;
  title: string;
  overallScore: number | null;
  totalDurationSec: number;
  shotCount: number;
  createdAt: string;
}

export interface VisualAssetItem {
  id: string;
  dramaId: string;
  assetType: 'character' | 'location' | 'style_guide';
  refId: string;
  name: string;
  data: Record<string, unknown>;
  referenceImageUrl: string;
  createdAt: string;
}

export async function createDrama(data: CreateDramaParams): Promise<{ dramaId: string }> {
  return request(BASE, { method: 'POST', data });
}

export async function listDramas(): Promise<{ dramas: DramaListItem[] }> {
  return request(BASE);
}

export async function getDrama(dramaId: string): Promise<Record<string, unknown>> {
  return request(`${BASE}/${dramaId}`);
}

export async function generateEpisodes(dramaId: string, count = 1): Promise<{ message: string }> {
  return request(`${BASE}/${dramaId}/episodes/generate?count=${count}`, { method: 'POST' });
}

export async function listEpisodes(dramaId: string): Promise<{ episodes: EpisodeListItem[] }> {
  return request(`${BASE}/${dramaId}/episodes`);
}

export async function getEpisode(dramaId: string, episodeNumber: number): Promise<Record<string, unknown>> {
  return request(`${BASE}/${dramaId}/episodes/${episodeNumber}`);
}

export async function getVisualAssets(dramaId: string): Promise<{ assets: VisualAssetItem[] }> {
  return request(`${BASE}/${dramaId}/visual-assets`);
}

/* ─── SSE URLs ─── */

export function getCreateDramaSseUrl(dramaId: string): string {
  const token = getToken();
  return `${BASE}/${dramaId}/create-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getGenerateEpisodeSseUrl(dramaId: string, count = 1): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/generate-sse?count=${count}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

export function getEpisodeProgressSseUrl(dramaId: string): string {
  const token = getToken();
  return `${BASE}/${dramaId}/episodes/progress-sse${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/* ─── 题材模板 ─── */

export interface DramaGenreTemplate {
  id: string;
  userId: string | null;
  genreKey: string;
  displayName: string;
  description: string;
  genreKeywords: string[];
  seedHints: Record<string, unknown> | null;
  audienceTags: string[];
  protagonistFocusTags: string[];
  toneTags: string[];
  platformTags: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listDramaGenreTemplates(): Promise<DramaGenreTemplate[]> {
  return request(`${BASE}/genre-templates/list`);
}

export async function getDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}`);
}

export async function createDramaGenreTemplate(data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates`, { method: 'POST', data });
}

export async function updateDramaGenreTemplate(id: string, data: Partial<DramaGenreTemplate>): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'PUT', data });
}

export async function deleteDramaGenreTemplate(id: string): Promise<{ success: boolean }> {
  return request(`${BASE}/genre-templates/${id}`, { method: 'DELETE' });
}

export async function cloneDramaGenreTemplate(id: string): Promise<DramaGenreTemplate> {
  return request(`${BASE}/genre-templates/${id}/clone`, { method: 'POST' });
}
