/**
 * ES模块令牌常量
 */
export const ES_MODULE_OPTIONS = 'ES_MODULE_OPTIONS';
export const ES_CLIENT = 'ES_CLIENT';

/**
 * 默认配置常量
 */
export const DEFAULT_ES_CONFIG = {
  requestTimeout: 300000,
  maxRetries: 3,
  enableHealthCheck: true,
  healthCheckInterval: 30000,
  indexPrefix: '',
  log: 'error' as const,
};

/**
 * 中文基础停用词
 */
export const CHINESE_STOP_WORDS = [
  '的',
  '了',
  '在',
  '是',
  '有',
  '和',
  '与',
  '或',
  '但',
  '因为',
  '所以',
  '这',
  '那',
  '这个',
  '那个',
  '我',
  '你',
  '他',
  '她',
  '它',
  '我们',
  '你们',
  '他们',
  '她们',
  '它们',
  '可以',
  '应该',
  '需要',
  '能够',
  '必须',
  '想要',
  '怎么',
  '如何',
  '什么',
  '为什么',
  '哪里',
  '什么时候',
  '一个',
  '一些',
  '很多',
  '非常',
  '比较',
  '最',
  '更',
];

/**
 * 中文查询相关停用词
 */
export const CHINESE_QUERY_STOP_WORDS = [
  '查询',
  '搜索',
  '找',
  '寻找',
  '请问',
  '请告诉我',
  '我想知道',
  '帮我',
  '给我',
  '告诉我',
  '说明',
  '解释',
  '介绍',
];

/**
 * 英文基础停用词
 */
export const ENGLISH_STOP_WORDS = [
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'up',
  'about',
  'into',
  'through',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'what',
  'how',
  'when',
  'where',
  'why',
  'which',
  'who',
];

/**
 * 英文查询相关停用词
 */
export const ENGLISH_QUERY_STOP_WORDS = [
  'find',
  'search',
  'look',
  'tell',
  'show',
  'give',
  'help',
  'explain',
  'describe',
  'what',
  'how',
  'please',
  'can',
  'could',
  'would',
];

/**
 * 技术术语白名单
 */
export const TECHNICAL_TERMS_WHITELIST = [
  'IT',
  'AI',
  'ML',
  'API',
  'HTTP',
  'REST',
  'JSON',
  'XML',
  'SQL',
  'NoSQL',
  'Node.js',
  'Vue.js',
  'React.js',
  'Angular.js',
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C++',
  'C#',
  'PHP',
  'Ruby',
  'Go',
  'Rust',
  'Docker',
  'Kubernetes',
  'AWS',
  'Azure',
  'GCP',
  'MongoDB',
  'MySQL',
  'PostgreSQL',
  'Redis',
  'Elasticsearch',
];

/**
 * 技术术语识别正则模式
 */
export const TECHNICAL_TERM_PATTERNS = [
  /^[A-Z][a-z]+\.[A-Z][a-z]+$/, // Node.js, Vue.js
  /^[A-Z]{2,}$/, // API, HTTP, SQL
  /^\w+\d+(\.\d+)?$/, // Python3.8, ES8, HTTP2
  /^[A-Z][a-z]+[A-Z]\w*$/, // JavaScript, TypeScript
  /^\w+\+\+$/, // C++
  /^[a-z]+-[a-z]+(-[a-z]+)*$/, // multi-word terms
  /^@[a-z]+\/[a-z-]+$/, // @vue/cli, @nestjs/common
];

/**
 * 技术术语提取正则模式（用于从文本中提取）
 */
export const TECHNICAL_TERM_EXTRACTION_PATTERNS = [
  /\b[A-Z][a-z]+\.[A-Z][a-z]+\b/g, // Node.js, Vue.js
  /\b[A-Z]{2,}\b/g, // API, HTTP, SQL, REST
  /\b\w+\d+(\.\d+)?\b/g, // Python3.8, ES8, HTTP2
  /\b[A-Z][a-z]+[A-Z]\w*\b/g, // JavaScript, TypeScript
  /\b\w+\+\+\b/g, // C++
  /\b[a-z]+-[a-z]+(-[a-z]+)*\b/g, // multi-word terms
];

/**
 * 默认关键词提取选项
 */
export const DEFAULT_KEYWORD_EXTRACTION_OPTIONS = {
  maxKeywords: 10,
  minLength: 2,
  includeTechnicalTerms: true,
  customStopWords: [],
  technicalWhitelist: [],
};

/**
 * 分析器名称常量
 */
export const ANALYZERS = {
  IK_SMART: 'ik_smart',
  IK_MAX_WORD: 'ik_max_word',
  STANDARD: 'standard',
  CHINESE: 'chinese',
  ENGLISH: 'english',
} as const;

/**
 * 合并后的基础停用词列表
 */
export const ALL_BASIC_STOP_WORDS = [
  ...CHINESE_STOP_WORDS,
  ...CHINESE_QUERY_STOP_WORDS,
  ...ENGLISH_STOP_WORDS,
  ...ENGLISH_QUERY_STOP_WORDS,
];
