import { Logger, OnModuleInit } from '@nestjs/common';
import { SUBSCRIBER_OBJ_REF_MAP } from './KafkaDecorator';

export abstract class AbstractKafkaConsumer implements OnModuleInit {
  constructor() {
    // Register topics immediately in constructor to avoid timing issues
    // This ensures the instance is available before KafkaService starts consuming
    this.registerTopic();
  }

  protected abstract registerTopic(): void;

  public async onModuleInit(): Promise<void> {
    Logger.log('Kafka consumer initialized successfully');
  }

  protected addTopic(topicName: string): void {
    if (!topicName) {
      throw new Error('Topic name cannot be empty');
    }

    if (SUBSCRIBER_OBJ_REF_MAP.has(topicName)) {
      Logger.warn(`Topic ${topicName} is already registered, overriding...`);
    }

    SUBSCRIBER_OBJ_REF_MAP.set(topicName, this);
    Logger.debug(`Registered consumer for topic: ${topicName}`);
  }

  protected getRegisteredTopics(): string[] {
    const topics: string[] = [];
    SUBSCRIBER_OBJ_REF_MAP.forEach((consumer, topic) => {
      if (consumer === this) {
        topics.push(topic);
      }
    });
    return topics;
  }
}
