/**
 * Lightweight "detail store" schemas for high-fidelity prose.
 *
 * 设计目标：
 * - 把「好写作需要的细节」（习惯动作、典型描写片段）和 StoryState 的硬事实解耦
 * - 只在需要的时候为 Writer/Editor 等 Agent 构建上下文
 * - 持久化为 jsonb（通过 ArtifactEntity），不强耦合数据库结构
 */

import type { DetailStore } from '../interfaces';

export const EMPTY_DETAIL_STORE: DetailStore = {
  characters: [],
  locations: [],
  items: [],
};
