import {
  DynamicModule,
  ForwardReference,
  Global,
  InjectionToken,
  Module,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { KafkaService } from './KafkaService';
import { KafkaConfig } from './KafkaMessage';

@Global()
@Module({})
export class KafkaModule {
  static register(kafkaConfig: KafkaConfig): DynamicModule | any {
    return {
      global: true,
      module: KafkaModule,
      providers: [
        {
          provide: KafkaService,
          useValue: new KafkaService(kafkaConfig),
        },
      ],
      exports: [KafkaService],
    } as DynamicModule;
  }

  static registerAsync(opts: {
    useFactory: (...args: any[]) => KafkaConfig;
    inject?: Array<InjectionToken | OptionalFactoryDependency>;
    imports?: (
      | DynamicModule
      | Type<any>
      | Promise<DynamicModule>
      | ForwardReference<any>
    )[];
  }): DynamicModule {
    return {
      global: true,
      module: KafkaModule,
      imports: opts.imports,
      exports: [KafkaService],
      providers: [
        {
          provide: KafkaService,
          useFactory(...args: any[]) {
            const config = opts.useFactory(...args);
            return new KafkaService(config);
          },
          inject: opts.inject,
        },
      ],
    };
  }
}
