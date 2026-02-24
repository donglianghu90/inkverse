import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { AgendaService } from './agenda.service';
import { AGENDA_PROCESS, AGENDA_PROCESSOR_QUEUE_NAME } from './agenda.decorators';

@Injectable()
export class AgendaExplorer implements OnModuleInit {
  private readonly logger: Logger;

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
    private readonly agendaService: AgendaService,
  ) {
    const queueName = agendaService.getQueueName();
    this.logger = new Logger(`${AgendaExplorer.name}:${queueName || 'default'}`);
  }

  async onModuleInit() {
    // 延迟执行，确保 AgendaService 已经初始化
    await new Promise(resolve => setTimeout(resolve, 100));
    this.explore();
  }

  explore() {
    const queueName = this.agendaService.getQueueName();
    
    const instanceWrappers: InstanceWrapper[] = [
      ...this.discoveryService.getProviders(),
      ...this.discoveryService.getControllers(),
    ];

    let foundProcessors = 0;

    instanceWrappers.forEach((wrapper: InstanceWrapper) => {
      const { instance } = wrapper;
      if (!instance || typeof instance === 'string' || !Object.getPrototypeOf(instance)) {
        return;
      }
      
      const processorQueueName = this.reflector.get<string>(AGENDA_PROCESSOR_QUEUE_NAME, instance.constructor);
      if (!processorQueueName) {
        return;
      }

      // 只注册属于当前队列的处理器
      if (processorQueueName !== queueName) {
        return;
      }

      this.logger.log(`Found processor: ${instance.constructor.name} for queue: ${processorQueueName}`);

      const methodNames = this.metadataScanner.getAllMethodNames(Object.getPrototypeOf(instance));
      methodNames.forEach((methodName) => {
        const isProcessor = this.reflector.get<boolean>(AGENDA_PROCESS, instance[methodName]);
        if (isProcessor) {
          try {
            const processMethod = instance[methodName].bind(instance);
            // 注册一个通用处理器，处理队列中的所有任务
            this.agendaService.setGlobalProcessor(processMethod);
            foundProcessors++;
            this.logger.log(`Registered processor method: ${instance.constructor.name}.${methodName}() for queue: ${queueName}`);
          } catch (error) {
            this.logger.error(`Failed to register processor for queue ${queueName}:`, error instanceof Error ? error.message : String(error));
          }
        }
      });
    });

    if (foundProcessors === 0) {
      this.logger.warn(`No processors found for queue: ${queueName}. Make sure to use @Processor('${queueName}') and @Process() decorators.`);
    }
  }
}
