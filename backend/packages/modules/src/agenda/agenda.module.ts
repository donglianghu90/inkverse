import { Module, DynamicModule, Inject, Provider, Type } from '@nestjs/common';
import { ConfigModule, ConfigService } from '../config';
import { AgendaService } from './agenda.service';
import { DiscoveryModule } from '@nestjs/core';
import { AgendaExplorer } from './agenda.explorer';

export interface DefaultJobOptions {
  priority?: number;          // 默认优先级
  delay?: number;             // 默认延迟时间（毫秒）
  removeOnComplete?: boolean; // 完成后是否移除
  removeOnFail?: boolean;     // 失败后是否移除
  attempts?: number;          // 重试次数
  backoff?: {                 // 重试策略
    type: 'fixed' | 'exponential';
    delay: number;
  };
}

export interface AgendaModuleOptions {
  name?: string;  // 用于区分不同的 Agenda 实例
  mongoUrl?: string;  // MongoDB 连接地址
  collection?: string;
  processEvery?: string;  // 轮询间隔，默认 '1 second'
  maxConcurrency?: number;  // 全局最大并发数，默认 200
  defaultConcurrency?: number;  // 单个job默认并发数，默认 10
  lockLimit?: number;  // 跨所有实例的全局并发限制（默认 0 不限制），设置为 1 可实现全局串行
  defaultLockLimit?: number;
  defaultLockLifetime?: number;
  defaultJobOptions?: DefaultJobOptions;  // 默认任务选项
  // Bottleneck 限流配置（可选，用于精细控制）
  rateLimiter?: {
    maxConcurrent?: number;  // 最大并发数
    minTime?: number;        // 每个任务最小间隔时间（毫秒）
    reservoir?: number;      // 令牌桶初始容量
    reservoirRefreshAmount?: number;  // 每次刷新增加的令牌数
    reservoirRefreshInterval?: number; // 刷新间隔（毫秒）
  };
}

export interface AgendaModuleAsyncOptions {
  useFactory?: (...args: any[]) => Promise<AgendaModuleOptions> | AgendaModuleOptions;
  inject?: any[];
  useExisting?: Type<AgendaOptionsFactory>;
  useClass?: Type<AgendaOptionsFactory>;
}

export interface AgendaOptionsFactory {
  createAgendaOptions(): Promise<AgendaModuleOptions> | AgendaModuleOptions;
}

export const AGENDA_MODULE_OPTIONS = 'AGENDA_MODULE_OPTIONS';
export const AGENDA_ROOT_OPTIONS = 'AGENDA_ROOT_OPTIONS';

export function getAgendaToken(name?: string): string {
  return name ? `AGENDA_SERVICE_${name}` : 'AGENDA_SERVICE';
}

/**
 * 装饰器：注入指定名称的 AgendaService
 * @param name Agenda 实例名称，如果不传则注入默认实例
 * 
 * @example
 * constructor(
 *   @InjectAgenda('wechat') private wechatAgenda: AgendaService,
 *   @InjectAgenda('email') private emailAgenda: AgendaService,
 * ) {}
 */
export function InjectAgenda(name?: string) {
  return Inject(getAgendaToken(name));
}

@Module({})
export class AgendaModule {
  /**
   * 注册队列 - 用于创建特定的队列实例
   * @param options 队列配置选项
   */
  static registerQueue(options: AgendaModuleOptions = {}): DynamicModule {
    const agendaToken = getAgendaToken(options.name);
    
    return {
      module: AgendaModule,
      imports: [ConfigModule, DiscoveryModule],
      providers: [
        {
          provide: AGENDA_MODULE_OPTIONS + (options.name ? `_${options.name}` : ''),
          useValue: options,
        },
        {
          provide: agendaToken,
          useFactory: (configService: ConfigService, rootOptions?: AgendaModuleOptions) => {
            // 合并根配置和队列配置，队列配置优先
            const mergedOptions = {
              ...rootOptions,
              ...options,
              defaultJobOptions: {
                ...rootOptions?.defaultJobOptions,
                ...options.defaultJobOptions,
              },
            };
            const service = new AgendaService(mergedOptions);
            return service;
          },
          inject: [ConfigService, { token: AGENDA_ROOT_OPTIONS, optional: true }],
        },
        {
          provide: AgendaService,
          useExisting: agendaToken,
        },
        AgendaExplorer,
      ],
      exports: [agendaToken, AgendaService],
    };
  }

  /**
   * 全局配置 - 用于设置全局默认选项（异步）
   * @param options 异步配置选项
   */
  static forRootAsync(options: AgendaModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = this.createAsyncProviders(options);
    
    return {
      global: true,
      module: AgendaModule,
      imports: options.useExisting || options.useClass ? [] : [ConfigModule],
      providers,
      exports: providers,
    };
  }

  /**
   * 全局配置 - 用于设置全局默认选项（同步）
   * @param options 配置选项
   */
  static forRoot(options: AgendaModuleOptions = {}): DynamicModule {
    return {
      global: true,
      module: AgendaModule,
      providers: [
        {
          provide: AGENDA_ROOT_OPTIONS,
          useValue: options,
        },
      ],
      exports: [AGENDA_ROOT_OPTIONS],
    };
  }

  private static createAsyncProviders(options: AgendaModuleAsyncOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: AGENDA_ROOT_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const useClass = options.useClass || options.useExisting;
    if (!useClass) {
      throw new Error('Invalid AgendaModule async options');
    }

    return [
      {
        provide: AGENDA_ROOT_OPTIONS,
        useFactory: async (optionsFactory: AgendaOptionsFactory) => {
          return await optionsFactory.createAgendaOptions();
        },
        inject: [useClass],
      },
      ...(options.useClass
        ? [
            {
              provide: useClass,
              useClass,
            },
          ]
        : []),
    ];
  }

  /**
   * @deprecated 使用 registerQueue() 代替
   */
  static register(options: AgendaModuleOptions = {}): DynamicModule {
    return this.registerQueue(options);
  }
}
