import { ModuleMetadata, Type } from '@nestjs/common';

/**
 * ES连接配置接口
 */
export interface ESConnectionConfig {
  /**
   * ES节点地址
   */
  node?: string | string[];
  nodes?: string | string[];
  /**
   * 认证配置
   */
  auth?:
    | {
        username: string;
        password: string;
      }
    | {
        apiKey: string;
      };

  /**
   * 连接超时时间（毫秒）
   */
  requestTimeout?: number;

  /**
   * 连接池最大连接数
   */
  maxRetries?: number;

  /**
   * SSL/TLS配置
   */
  ssl?: {
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };

  /**
   * TLS配置（ES8新格式）
   */
  tls?: {
    rejectUnauthorized?: boolean;
    ca?: string | Buffer;
    cert?: string | Buffer;
    key?: string | Buffer;
  };

  /**
   * 日志级别
   */
  log?: 'error' | 'warning' | 'info' | 'debug' | 'trace';
}

/**
 * ES模块配置接口
 */
export interface ESModuleConfig {
  /**
   * 连接配置
   */
  connection: ESConnectionConfig;

  /**
   * 默认索引前缀
   */
  indexPrefix?: string;

  /**
   * 是否启用健康检查
   */
  enableHealthCheck?: boolean;

  /**
   * 健康检查间隔（毫秒）
   */
  healthCheckInterval?: number;
}

/**
 * ES异步配置接口
 */
export interface ESAsyncModuleConfig extends Pick<ModuleMetadata, 'imports'> {
  /**
   * 配置工厂函数
   */
  useFactory: (...args: any[]) => Promise<ESModuleConfig> | ESModuleConfig;

  /**
   * 注入的依赖
   */
  inject?: any[];

  /**
   * 是否为全局模块
   */
  isGlobal?: boolean;
}

/**
 * ES类配置接口
 */
export interface ESClassModuleConfig extends Pick<ModuleMetadata, 'imports'> {
  /**
   * 配置类
   */
  useClass: Type<ESModuleConfig>;

  /**
   * 是否为全局模块
   */
  isGlobal?: boolean;
}
