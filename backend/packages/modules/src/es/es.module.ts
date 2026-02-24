import { DynamicModule, Module, Provider } from '@nestjs/common';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { ESService } from './es.service';
import {
  ESModuleConfig,
  ESAsyncModuleConfig,
  ESClassModuleConfig,
} from './interfaces/es-config.interface';
import {
  ES_MODULE_OPTIONS,
  ES_CLIENT,
  DEFAULT_ES_CONFIG,
} from './constants/es.constants';

/**
 * Elasticsearch模块
 * 提供ES客户端的全局配置和依赖注入
 */
@Module({})
export class ESModule {
  /**
   * 同步注册ES模块
   */
  static forRoot(config: ESModuleConfig): DynamicModule {
    const providers = this.createProviders(config);

    return {
      module: ESModule,
      providers,
      exports: providers,
      global: true,
    };
  }

  /**
   * 异步注册ES模块
   */
  static forRootAsync(options: ESAsyncModuleConfig): DynamicModule {
    const providers = this.createAsyncProviders(options);

    return {
      module: ESModule,
      imports: options.imports || [],
      providers,
      exports: providers,
      global: options.isGlobal !== false,
    };
  }

  /**
   * 使用类配置注册ES模块
   */
  static forRootClass(options: ESClassModuleConfig): DynamicModule {
    const providers = this.createClassProviders(options);

    return {
      module: ESModule,
      imports: options.imports || [],
      providers,
      exports: providers,
      global: options.isGlobal !== false,
    };
  }

  /**
   * 创建同步提供者
   */
  private static createProviders(config: ESModuleConfig): Provider[] {
    const mergedConfig = { ...DEFAULT_ES_CONFIG, ...config };

    return [
      {
        provide: ES_MODULE_OPTIONS,
        useValue: mergedConfig,
      },
      {
        provide: ES_CLIENT,
        useFactory: () => {
          // 处理节点地址配置
          const connectionConfig = { ...mergedConfig.connection };
          if (connectionConfig.nodes && !connectionConfig.node) {
            connectionConfig.node = connectionConfig.nodes;
          }

          return new ElasticsearchClient(connectionConfig);
        },
      },
      ESService,
    ];
  }

  /**
   * 创建异步提供者
   */
  private static createAsyncProviders(
    options: ESAsyncModuleConfig,
  ): Provider[] {
    return [
      {
        provide: ES_MODULE_OPTIONS,
        useFactory: async (...args: any[]) => {
          const config = await options.useFactory(...args);
          return { ...DEFAULT_ES_CONFIG, ...config };
        },
        inject: options.inject || [],
      },
      {
        provide: ES_CLIENT,
        useFactory: (config: ESModuleConfig) => {
          // 处理节点地址配置
          const connectionConfig = { ...config.connection };
          if (connectionConfig.nodes && !connectionConfig.node) {
            connectionConfig.node = connectionConfig.nodes;
          }

          return new ElasticsearchClient(connectionConfig);
        },
        inject: [ES_MODULE_OPTIONS],
      },
      ESService,
    ];
  }

  /**
   * 创建类配置提供者
   */
  private static createClassProviders(
    options: ESClassModuleConfig,
  ): Provider[] {
    return [
      {
        provide: ES_MODULE_OPTIONS,
        useFactory: async (configService: any) => {
          const config = await configService.createESConfig();
          return { ...DEFAULT_ES_CONFIG, ...config };
        },
        inject: [options.useClass],
      },
      {
        provide: ES_CLIENT,
        useFactory: (config: ESModuleConfig) => {
          // 处理节点地址配置
          const connectionConfig = { ...config.connection };
          if (connectionConfig.nodes && !connectionConfig.node) {
            connectionConfig.node = connectionConfig.nodes;
          }

          return new ElasticsearchClient(connectionConfig);
        },
        inject: [ES_MODULE_OPTIONS],
      },
      options.useClass,
      ESService,
    ];
  }
}
