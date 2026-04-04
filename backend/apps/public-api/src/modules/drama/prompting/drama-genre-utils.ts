/**
 * 题材相关工具函数
 */

/**
 * 从中文题材名推断 genreKey（如 '霸总' → 'boss'）。
 */
export function resolveGenreKey(genreName: string): string | undefined {
  if (!genreName) return undefined;
  
  // 核心题材名称映射表
  const genreMapping: Record<string, string> = {
    'boss': 'boss',
    '霸总': 'boss',
    '总裁': 'boss',
    
    'sweet': 'sweet',
    '甜宠': 'sweet',
    '恋爱': 'sweet',
    
    'warrior': 'warrior',
    '战神': 'warrior',
    '兵王': 'warrior',
    
    'timetravel': 'timetravel',
    '穿越': 'timetravel',
    
    'palace': 'palace',
    '宫斗': 'palace',
    '宫廷': 'palace',
    
    'revenge': 'revenge',
    '复仇': 'revenge',
    
    'rebirth': 'rebirth',
    '重生': 'rebirth',
    
    'suspense': 'suspense',
    '悬疑': 'suspense',
    '惊悚': 'suspense',
    
    'urban': 'urban',
    '都市': 'urban',
    
    'ancient': 'ancient',
    '古装': 'ancient',
    '古代': 'ancient',
    
    'history': 'history',
    '历史': 'history',
    
    'biography': 'biography',
    '传记': 'biography',
    
    'mythology': 'mythology',
    '神话': 'mythology',
    '仙侠': 'mythology',
    
    'scifi': 'scifi',
    '科幻': 'scifi',
  };

  // 1. 直匹配
  if (genreMapping[genreName]) return genreMapping[genreName];
  
  // 2. 模糊匹配
  for (const [key, value] of Object.entries(genreMapping)) {
    if (genreName.includes(key)) return value;
  }
  
  return undefined;
}
