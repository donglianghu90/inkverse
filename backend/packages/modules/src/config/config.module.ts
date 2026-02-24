import { Global, Module, DynamicModule } from '@nestjs/common';
import { ConfigService } from './config.service';
import { configuration } from "./configuration";

export interface ConfigModuleOptions {
  configPath?: string;
}

@Global()
@Module({})
export class ConfigModule {
  static forRoot(options?: ConfigModuleOptions): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        {
          provide: ConfigService,
          async useFactory() {
            const config = await configuration(options?.configPath);
            return new ConfigService(config);
          },
        },
      ],
      exports: [ConfigService],
    };
  }

  static forRootAsync(options: {
    useFactory: () => Promise<ConfigModuleOptions> | ConfigModuleOptions;
    inject?: any[];
  }): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        {
          provide: ConfigService,
          async useFactory(...args: any[]) {
            const moduleOptions = await options.useFactory.apply(null, args);
            const config = await configuration(moduleOptions?.configPath);
            return new ConfigService(config);
          },
          inject: options.inject || [],
        },
      ],
      exports: [ConfigService],
    };
  }
}
