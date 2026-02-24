import { DynamicModule, Global, Module } from '@nestjs/common';
import { OssService } from './oss.service';

export interface OssConfig {
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint?: string;
  internal?: boolean;
  secure?: boolean;
  timeout?: number;
}

export interface OssOptions {
  retryAttempts?: number;
  retryDelay?: number;
  enableHealthCheck?: boolean;
}

const DEFAULT_OPTIONS: OssOptions = {
  retryAttempts: 3,
  retryDelay: 1000,
  enableHealthCheck: true,
};

@Module({})
@Global()
export class OssModule {
  static forRoot(config: OssConfig, options: OssOptions = {}): DynamicModule {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    return {
      module: OssModule,
      providers: [
        {
          provide: 'OSS_CONFIG',
          useValue: config,
        },
        {
          provide: 'OSS_OPTIONS',
          useValue: mergedOptions,
        },
        OssService,
      ],
      exports: [OssService],
    };
  }

  static forRootAsync(asyncOptions: {
    imports?: any[];
    inject?: any[];
    useFactory: (...args: any[]) => Promise<{ config: OssConfig; options?: OssOptions }> | { config: OssConfig; options?: OssOptions };
  }): DynamicModule {
    return {
      module: OssModule,
      imports: asyncOptions.imports || [],
      providers: [
        {
          provide: 'OSS_CONFIG',
          useFactory: async (...args: any[]) => {
            const result = await asyncOptions.useFactory(...args);
            return result.config;
          },
          inject: asyncOptions.inject || [],
        },
        {
          provide: 'OSS_OPTIONS',
          useFactory: async (...args: any[]) => {
            const result = await asyncOptions.useFactory(...args);
            return { ...DEFAULT_OPTIONS, ...(result.options || {}) };
          },
          inject: asyncOptions.inject || [],
        },
        OssService,
      ],
      exports: [OssService],
    };
  }
}
