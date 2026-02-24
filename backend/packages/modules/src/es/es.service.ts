import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import {
  ES_CLIENT,
  ES_MODULE_OPTIONS,
  ALL_BASIC_STOP_WORDS,
  TECHNICAL_TERMS_WHITELIST,
  TECHNICAL_TERM_PATTERNS,
  TECHNICAL_TERM_EXTRACTION_PATTERNS,
  DEFAULT_KEYWORD_EXTRACTION_OPTIONS,
  ANALYZERS,
} from './constants/es.constants';
import { ESModuleConfig } from './interfaces/es-config.interface';

/**
 * 关键词提取选项
 */
export interface KeywordExtractionOptions {
  maxKeywords?: number; // 最大关键词数量，默认10
  minLength?: number; // 最小词长度，默认2
  includeTechnicalTerms?: boolean; // 是否包含技术术语，默认true
  customStopWords?: string[]; // 自定义停用词
  technicalWhitelist?: string[]; // 技术术语白名单
}

/**
 * Elasticsearch服务类
 * 提供ES客户端的封装和常用操作方法
 */
@Injectable()
export class ESService implements OnModuleInit {
  private healthCheckTimer?: NodeJS.Timeout;
  private stopWordsSet: Set<string>;
  private technicalWhitelist: Set<string>;

  constructor(
    @Inject(ES_CLIENT) private readonly client: ElasticsearchClient,
    @Inject(ES_MODULE_OPTIONS) private readonly config: ESModuleConfig,
  ) {
    // 初始化停用词和技术术语
    this.initializeStopWords();
  }

  async onModuleInit() {
    await this.initialize();
  }

  /**
   * 初始化ES服务
   */
  private async initialize() {
    try {
      // 检查连接
      await this.ping();
      Logger.log('ES客户端连接成功');

      // 启动健康检查
      if (this.config.enableHealthCheck) {
        this.startHealthCheck();
      }

      // 输出集群信息
      const info = await this.getClusterInfo();
      Logger.log(`ES集群版本: ${info.version?.number}`);
    } catch (error) {
      Logger.error('ES客户端初始化失败', error);
      throw error;
    }
  }

  /**
   * 获取ES客户端实例
   */
  getClient(): ElasticsearchClient {
    return this.client;
  }

  /**
   * 检查ES连接状态
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      Logger.error('ES连接检查失败', error);
      return false;
    }
  }

  /**
   * 获取集群信息
   */
  async getClusterInfo(): Promise<any> {
    try {
      const response = await this.client.info();
      return response;
    } catch (error) {
      Logger.error('获取ES集群信息失败', error);
      throw error;
    }
  }

  /**
   * 获取集群健康状态
   */
  async getClusterHealth(): Promise<any> {
    try {
      const response = await this.client.cluster.health();
      return response;
    } catch (error) {
      Logger.error('获取ES集群健康状态失败', error);
      throw error;
    }
  }

  /**
   * 检查索引是否存在
   */
  async indexExists(index: string): Promise<boolean> {
    try {
      const response = await this.client.indices.exists({ index });
      return response;
    } catch (error) {
      Logger.error(`检查索引${index}失败`, error);
      return false;
    }
  }

  /**
   * 创建索引
   */
  async createIndex(index: string, body?: any): Promise<boolean> {
    try {
      await this.client.indices.create({ index, body });
      Logger.log(`索引${index}创建成功`);
      return true;
    } catch (error) {
      Logger.error(`创建索引${index}失败`, error);
      return false;
    }
  }

  /**
   * 删除索引
   */
  async deleteIndex(index: string): Promise<boolean> {
    try {
      await this.client.indices.delete({ index });
      Logger.log(`索引${index}删除成功`);
      return true;
    } catch (error) {
      Logger.error(`删除索引${index}失败`, error);
      return false;
    }
  }

  /**
   * 文本分析
   */
  async analyze(
    text: string,
    analyzer: string,
    index?: string,
  ): Promise<any[]> {
    try {
      const params: any = {
        index,
        body: {
          analyzer,
          text,
        },
      };
      const response = await this.client.indices.analyze(params);
      return response.tokens || [];
    } catch (error) {
      Logger.error(`文本分析失败: ${text}`, error);
      throw error;
    }
  }

  /**
   * 批量操作
   */
  async bulk(body: any[]): Promise<any> {
    const response = await this.client.bulk({ body, refresh: true });
    return response;
  }

  /**
   * 索引单个文档
   */
  async index(params: {
    index: string;
    body: any;
    refresh?: boolean;
  }): Promise<any> {
    const response = await this.client.index(params);
    return response;
  }

  /**
   * 搜索
   */
  async search(params: any): Promise<any> {
    const response = await this.client.search(params);
    return response;
  }

  /**
   * 获取文档
   */
  async get(params: any): Promise<any> {
    const response = await this.client.get(params);
    return response;
  }

  /**
   * 批量获取文档
   */
  async mget(params: any): Promise<any> {
    const response = await this.client.mget(params);
    return response;
  }
  /**
   * 启动健康检查
   */
  private startHealthCheck() {
    const interval = this.config.healthCheckInterval || 30000;

    this.healthCheckTimer = setInterval(async () => {
      try {
        const isHealthy = await this.ping();
        if (!isHealthy) {
          Logger.warn('ES健康检查失败');
        }
      } catch (error) {
        Logger.error('ES健康检查异常', error);
      }
    }, interval);

    Logger.log(`ES健康检查已启动，间隔: ${interval}ms`);
  }

  /**
   * 停止健康检查
   */
  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      Logger.log('ES健康检查已停止');
    }
  }

  /**
   * 模块销毁时清理资源
   */
  async onModuleDestroy() {
    this.stopHealthCheck();
    await this.client.close();
    Logger.log('ES客户端连接已关闭');
  }

  /**
   * 初始化停用词和技术术语白名单
   */
  private initializeStopWords() {
    // 从环境变量获取自定义配置
    const customStopWords =
      process.env.CUSTOM_STOP_WORDS?.split(',').map((s) => s.trim()) || [];
    const customWhitelist =
      process.env.TECHNICAL_WHITELIST?.split(',').map((s) => s.trim()) || [];

    // 使用constants中的预定义列表
    this.stopWordsSet = new Set([...ALL_BASIC_STOP_WORDS, ...customStopWords]);
    this.technicalWhitelist = new Set([
      ...TECHNICAL_TERMS_WHITELIST,
      ...customWhitelist,
    ]);
  }

  /**
   * 提取查询关键词（使用ES分词API确保一致性）
   * @param query 查询文本
   * @param options 提取选项
   * @returns 关键词数组
   */
  async extractQueryKeywords(
    query: string,
    options: KeywordExtractionOptions = {},
  ): Promise<string[]> {
    try {
      // 合并默认选项和用户选项
      const mergedOptions = {
        ...DEFAULT_KEYWORD_EXTRACTION_OPTIONS,
        ...options,
      };
      const {
        maxKeywords,
        minLength,
        includeTechnicalTerms,
        customStopWords,
        technicalWhitelist,
      } = mergedOptions;

      // 1. 使用ES分词API进行主要分词
      const primaryTokens = await this.analyzeWithES(query, ANALYZERS.IK_SMART);

      // 2. 使用细粒度分词获取更多关键词
      const detailTokens = await this.analyzeWithES(
        query,
        ANALYZERS.IK_MAX_WORD,
      );

      // 3. 提取技术术语（补充ES分词可能遗漏的专业术语）
      const technicalTerms = includeTechnicalTerms
        ? this.extractTechnicalTerms(query)
        : [];

      // 4. 合并去重所有词汇
      const allTokens = [
        ...new Set([...primaryTokens, ...detailTokens, ...technicalTerms]),
      ];

      // 5. 过滤停用词和应用自定义配置
      const filteredTokens = this.filterTokens(allTokens, {
        minLength,
        customStopWords,
        technicalWhitelist,
      });

      // 6. 按重要性排序，保留前N个
      return this.rankAndLimitTokens(
        filteredTokens,
        technicalTerms,
        query,
        maxKeywords,
      );
    } catch (error) {
      Logger.error('ES分词失败，回退到简单分词', error);
      return this.fallbackKeywordExtraction(query, options);
    }
  }

  /**
   * 使用ES分词API分析文本
   */
  private async analyzeWithES(
    text: string,
    analyzer: string,
  ): Promise<string[]> {
    const tokens = await this.analyze(text, analyzer);
    const tokenStrings = [
      ...new Set(
        tokens
          .map((token: any) => token.token)
          .filter((token: string) => this.isValidToken(token)),
      ),
    ];

    Logger.debug(`ES分词结果: [${tokenStrings.join(', ')}]`);
    return tokenStrings;
  }

  /**
   * 验证token是否有效
   */
  private isValidToken(token: string): boolean {
    // 基础过滤规则
    if (token.length < 2) return false;

    // 过滤纯数字
    if (/^\d+$/.test(token)) return false;

    // 过滤纯符号
    if (/^[^\w\u4e00-\u9fa5]+$/.test(token)) return false;

    return true;
  }

  /**
   * 过滤tokens
   */
  private filterTokens(
    tokens: string[],
    options: {
      minLength: number;
      customStopWords: string[];
      technicalWhitelist: string[];
    },
  ): string[] {
    const { minLength, customStopWords, technicalWhitelist } = options;

    // 合并停用词
    const allStopWords = new Set([
      ...Array.from(this.stopWordsSet),
      ...customStopWords,
    ]);

    // 合并技术术语白名单
    const allWhitelist = new Set([
      ...Array.from(this.technicalWhitelist),
      ...technicalWhitelist,
    ]);

    return tokens.filter((token) => {
      // 长度过滤
      if (token.length < minLength) return false;

      // 检查白名单
      if (allWhitelist.has(token) || allWhitelist.has(token.toLowerCase())) {
        return true;
      }

      // 检查技术术语模式
      if (this.isTechnicalTerm(token)) {
        return true;
      }

      // 检查停用词
      return !allStopWords.has(token.toLowerCase());
    });
  }

  /**
   * 判断是否为技术术语
   */
  private isTechnicalTerm(token: string): boolean {
    return TECHNICAL_TERM_PATTERNS.some((pattern) => pattern.test(token));
  }

  /**
   * 提取技术术语
   */
  private extractTechnicalTerms(content: string): string[] {
    const terms = [];
    TECHNICAL_TERM_EXTRACTION_PATTERNS.forEach((pattern) => {
      const matches = content.match(pattern) || [];
      terms.push(...matches);
    });

    return [...new Set(terms)];
  }

  /**
   * 对关键词按重要性排序并限制数量
   */
  private rankAndLimitTokens(
    tokens: string[],
    technicalTerms: string[],
    originalQuery: string,
    maxKeywords: number,
  ): string[] {
    // 计算每个词的重要性得分
    const tokenScores = new Map<string, number>();

    tokens.forEach((token) => {
      let score = 0;

      // 1. 基础得分：词长度
      score += token.length * 0.1;

      // 2. 技术术语加分
      if (technicalTerms.includes(token)) {
        score += 2.0;
      }

      // 3. 在原查询中的频率
      const frequency = (
        originalQuery.toLowerCase().match(new RegExp(token, 'g')) || []
      ).length;
      score += frequency * 0.5;

      // 4. 中英文混合词汇加分
      if (/[a-zA-Z]/.test(token) && /[\u4e00-\u9fa5]/.test(token)) {
        score += 1.5;
      }

      // 5. 纯英文技术词汇
      if (/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(token)) {
        score += 1.0;
      }

      // 6. 白名单词汇加分
      if (this.technicalWhitelist.has(token)) {
        score += 1.8;
      }

      tokenScores.set(token, score);
    });

    // 按得分排序，返回前N个
    return Array.from(tokenScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([token]) => token);
  }

  /**
   * 回退方案：简单关键词提取
   */
  private fallbackKeywordExtraction(
    query: string,
    options: KeywordExtractionOptions = {},
  ): string[] {
    const { maxKeywords = 10, minLength = 2 } = options;

    Logger.warn('使用简单分词作为回退方案');

    // 基础分词
    const words = query
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5.-]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= minLength);

    // 提取技术术语
    const technicalTerms = this.extractTechnicalTerms(query);

    // 合并去重
    const allTerms = [...new Set([...words, ...technicalTerms])];

    // 简单过滤停用词
    const filtered = allTerms.filter(
      (term) =>
        !this.stopWordsSet.has(term.toLowerCase()) ||
        this.technicalWhitelist.has(term),
    );

    // 按长度排序，返回前N个
    return filtered.sort((a, b) => b.length - a.length).slice(0, maxKeywords);
  }
}
