export type DramaAgentCategoryType = 'preparation' | 'scripting' | 'production' | 'review';

export interface DramaAgentMetadata {
  /** 
   * The unique system identifier for the agent. 
   * Maps to LLM usage metrics (taskName), e.g., 'drama-seed-analyzer' 
   */
  key: string;
  
  /** 
   * The short key used in prompt templates and schema overrides.
   * e.g., 'seed-analyzer'
   */
  promptKey: string;
  
  /** Chinese display name */
  name: string;
  
  /** Chinese description */
  desc: string;
  
  /** Grouping category */
  category: DramaAgentCategoryType;
}

export const DRAMA_AGENT_REGISTRY = {
  // ── preparation (建剧筹备群) ──
  SEED_ANALYZER: {
    key: 'drama-seed-analyzer',
    promptKey: 'seed-analyzer',
    name: '编剧手册',
    desc: '分析标签、爽点，输出初始小传',
    category: 'preparation',
  } as DramaAgentMetadata,
  STRATEGY: {
    key: 'drama-strategy',
    promptKey: 'drama-strategy', // In the UI this was drama-strategy
    name: '短剧策略师',
    desc: '定义核心动力、节奏和高光策略',
    category: 'preparation',
  } as DramaAgentMetadata,
  PROFILER: {
    key: 'drama-profiler',
    promptKey: 'drama-profiler', // In the UI this was drama-profiler
    name: '创意分析师',
    desc: '建立全局世界观、人物关系、评审标准',
    category: 'preparation',
  } as DramaAgentMetadata,
  SERIES_DIRECTOR: {
    key: 'drama-series-director',
    promptKey: 'series-director',
    name: '总导演',
    desc: '规划全剧大纲、剧情脉络',
    category: 'preparation',
  } as DramaAgentMetadata,
  VISUAL_ASSET_DESIGNER: {
    key: 'drama-visual-asset-designer',
    promptKey: 'visual-asset-designer',
    name: '全局视觉资产',
    desc: '为主配角和场景设计总体视觉属性',
    category: 'preparation',
  } as DramaAgentMetadata,
  CHARACTER_DESIGNER: {
    key: 'drama-character-designer',
    promptKey: 'character-designer',
    name: '角色细化设计',
    desc: '补充新角色的面部、服装与体态视觉设定',
    category: 'preparation',
  } as DramaAgentMetadata,
  LOCATION_DESIGNER: {
    key: 'drama-location-designer',
    promptKey: 'location-designer',
    name: '场景细化设计',
    desc: '为具体场景设计光影与建筑风格详情',
    category: 'preparation',
  } as DramaAgentMetadata,

  // ── scripting (分集编剧群) ──
  ARC_DIRECTOR: {
    key: 'drama-arc-director',
    promptKey: 'arc-director',
    name: '段落导演',
    desc: '把控几个集数的整体情绪与起承转合',
    category: 'scripting',
  } as DramaAgentMetadata,
  SCRIPTWRITER: {
    key: 'drama-scriptwriter',
    promptKey: 'scriptwriter',
    name: '主笔编剧',
    desc: '扩写单集剧本，创作具体场景行为',
    category: 'scripting',
  } as DramaAgentMetadata,
  DIALOGUE_COACH: {
    key: 'drama-dialogue-coach',
    promptKey: 'dialogue-coach',
    name: '台词教练',
    desc: '优化角色的对白与气口',
    category: 'scripting',
  } as DramaAgentMetadata,
  CONTINUITY_GUARD: {
    key: 'drama-continuity-guard',
    promptKey: 'continuity-guard',
    name: '连贯性守卫',
    desc: '审查剧情漏洞与人设崩塌',
    category: 'scripting',
  } as DramaAgentMetadata,
  HOOK_CRAFTER: {
    key: 'drama-hook-crafter',
    promptKey: 'hook-crafter',
    name: '悬念工匠',
    desc: '设计钩子与集末高潮点',
    category: 'scripting', // in ui this was scripting
  } as DramaAgentMetadata,
  PACING_ANALYZER: {
    key: 'drama-pacing-analyzer',
    promptKey: 'pacing-analyzer',
    name: '节奏分析师',
    desc: '监控剧情节奏和爽点分布',
    category: 'scripting',
  } as DramaAgentMetadata,
  SCRIPT_REVIEWER: {
    key: 'drama-script-reviewer',
    promptKey: 'script-reviewer',
    name: '剧本审评员',
    desc: '进行剧本验收并打分',
    category: 'scripting',
  } as DramaAgentMetadata,
  SCRIPT_EDITOR: {
    key: 'drama-script-editor',
    promptKey: 'script-editor',
    name: '剧本润色员',
    desc: '最后修正不合理的地方',
    category: 'scripting',
  } as DramaAgentMetadata,
  SYSTEM_PROMPT_OPTIMIZER: {
    key: 'drama-system-prompt-optimizer',
    promptKey: 'system-prompt-optimizer',
    name: '系统提示词优化器',
    desc: '分析生成错误并提案打补丁',
    category: 'scripting',
  } as DramaAgentMetadata,

  // ── production (生产制作群) ──
  EPISODE_DIRECTOR: {
    key: 'drama-episode-director',
    promptKey: 'episode-director',
    name: '分集执行导演',
    desc: '分配镜头、规划具体画面构成',
    category: 'production',
  } as DramaAgentMetadata,
  STORYBOARD_DIRECTOR: {
    key: 'drama-storyboard-director',
    promptKey: 'storyboard-director',
    name: '分镜导演',
    desc: '撰写视觉提示词，给生图大模型下指令',
    category: 'production',
  } as DramaAgentMetadata,
  AUDIO_DIRECTOR: {
    key: 'drama-audio-director',
    promptKey: 'audio-director',
    name: '音频导演',
    desc: '选择背景音乐、音效和配音角色',
    category: 'production',
  } as DramaAgentMetadata,
  EPISODE_RECORDER: {
    key: 'drama-episode-recorder',
    promptKey: 'episode-recorder',
    name: '记录员',
    desc: '归档每集的资产与消耗记录',
    category: 'production',
  } as DramaAgentMetadata,
};

export const DRAMA_AGENT_CATEGORIES_META = [
  { id: 'preparation', label: '建剧筹备群', desc: '在创建短剧的准备阶段运行' },
  { id: 'scripting', label: '分集编剧群', desc: '负责具体集数的故事研发和台词打磨' },
  { id: 'production', label: '生产制作群', desc: '负责将剧本转换为分镜和最终视频' },
];

export function getDramaSystemAgents() {
  return DRAMA_AGENT_CATEGORIES_META.map(cat => ({
    id: cat.id,
    label: cat.label,
    desc: cat.desc,
    agents: Object.values(DRAMA_AGENT_REGISTRY)
      .filter(a => a.category === cat.id)
      .map(a => ({
        key: a.promptKey, // Backward compatibility for UI overrides which used promptKey
        taskKey: a.key,
        name: a.name,
        desc: a.desc,
      }))
  }));
}
