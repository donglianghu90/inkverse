import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Consumer, Kafka, Producer } from 'kafkajs';
import {
  SUBSCRIBER_FIXED_FN_REF_MAP,
  SUBSCRIBER_FN_REF_MAP,
  SUBSCRIBER_OBJ_REF_MAP,
  clearSubscribers,
} from './KafkaDecorator';
import { KafkaConfig, MessageHandler } from './KafkaMessage';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private fixedConsumer: Consumer;
  private readonly consumerSuffix = '-' + Math.floor(Math.random() * 100000);
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private isReconnecting = false;
  private consumersRunning = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(private kafkaConfig: KafkaConfig) {
    this.kafka = new Kafka({
      clientId: this.kafkaConfig.clientId,
      brokers: this.kafkaConfig.brokers,
      ssl: this.kafkaConfig.ssl,
      sasl: this.kafkaConfig.sasl as any,
      connectionTimeout: this.kafkaConfig.connectionTimeout || 1000,
      requestTimeout: this.kafkaConfig.requestTimeout || 5000,
      retry: this.kafkaConfig.retry || {
        initialRetryTime: 100,
        retries: 3,
        maxRetryTime: 3000,
      },
    });
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({
      groupId: this.kafkaConfig.groupId + this.consumerSuffix,
      sessionTimeout: this.kafkaConfig.sessionTimeout || 30000,
      heartbeatInterval: this.kafkaConfig.heartbeatInterval || 3000,
      rebalanceTimeout: this.kafkaConfig.rebalanceTimeout || 60000,
      maxWaitTimeInMs: this.kafkaConfig.maxWaitTimeInMs || 1000,
    });
    this.fixedConsumer = this.kafka.consumer({
      groupId: this.kafkaConfig.groupId,
      sessionTimeout: this.kafkaConfig.sessionTimeout || 30000,
      heartbeatInterval: this.kafkaConfig.heartbeatInterval || 3000,
      rebalanceTimeout: this.kafkaConfig.rebalanceTimeout || 60000,
      maxWaitTimeInMs: this.kafkaConfig.maxWaitTimeInMs || 1000,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
      await this.setupSubscribers();
      Logger.log('Kafka module initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize Kafka module', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }

      await this.disconnect();
      clearSubscribers();
      Logger.log('Kafka module destroyed successfully');
    } catch (error) {
      Logger.error('Error during Kafka module destruction', error);
    }
  }

  async connect(): Promise<void> {
    if (this.isReconnecting) {
      Logger.warn('Connection attempt skipped - already reconnecting');
      return;
    }

    try {
      Logger.log('Connecting to Kafka...');
      await Promise.all([
        this.producer.connect(),
        this.consumer.connect(),
        this.fixedConsumer.connect(),
      ]);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      Logger.log('Successfully connected to Kafka');
    } catch (error) {
      this.isConnected = false;
      Logger.error('Failed to connect to Kafka', error);

      if (!this.isReconnecting) {
        this.handleReconnection();
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      Logger.log('Disconnecting from Kafka...');
      this.isReconnecting = false;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }

      await Promise.all([
        this.producer.disconnect(),
        this.consumer.disconnect(),
        this.fixedConsumer.disconnect(),
      ]);

      this.isConnected = false;
      this.consumersRunning = false;
      Logger.log('Successfully disconnected from Kafka');
    } catch (error) {
      Logger.error('Error disconnecting from Kafka', error);
      throw error;
    }
  }

  private handleReconnection(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      Logger.error('Maximum reconnection attempts reached');
      this.isReconnecting = false;
      return;
    }

    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(500 * Math.pow(1.5, this.reconnectAttempts), 5000);

    Logger.warn(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.reconnectInternal();
      } catch (error) {
        Logger.error('Reconnection failed', error);
        this.isReconnecting = false;
        this.handleReconnection();
      }
    }, delay);
  }

  private async reconnectInternal(): Promise<void> {
    try {
      await this.disconnect();

      this.producer = this.kafka.producer();
      this.consumer = this.kafka.consumer({
        groupId: this.kafkaConfig.groupId + this.consumerSuffix,
        sessionTimeout: this.kafkaConfig.sessionTimeout || 30000,
        heartbeatInterval: this.kafkaConfig.heartbeatInterval || 3000,
        rebalanceTimeout: this.kafkaConfig.rebalanceTimeout || 60000,
        maxWaitTimeInMs: this.kafkaConfig.maxWaitTimeInMs || 1000,
      });
      this.fixedConsumer = this.kafka.consumer({
        groupId: this.kafkaConfig.groupId,
        sessionTimeout: this.kafkaConfig.sessionTimeout || 30000,
        heartbeatInterval: this.kafkaConfig.heartbeatInterval || 3000,
        rebalanceTimeout: this.kafkaConfig.rebalanceTimeout || 60000,
        maxWaitTimeInMs: this.kafkaConfig.maxWaitTimeInMs || 1000,
      });

      await Promise.all([
        this.producer.connect(),
        this.consumer.connect(),
        this.fixedConsumer.connect(),
      ]);

      await this.setupSubscribers();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      Logger.log('Successfully reconnected to Kafka');
    } catch (error) {
      this.isConnected = false;
      Logger.error('Reconnection failed', error);
      throw error;
    }
  }

  private async setupSubscribers(): Promise<void> {
    if (this.consumersRunning) {
      Logger.warn('Consumers already running, skipping setup');
      return;
    }

    const dynamicTopics = Array.from(SUBSCRIBER_FN_REF_MAP.keys());
    const fixedTopics = Array.from(SUBSCRIBER_FIXED_FN_REF_MAP.keys());

    Logger.log(
      `Setting up ${dynamicTopics.length} dynamic topic subscriptions`,
    );
    Logger.log(`Setting up ${fixedTopics.length} fixed topic subscriptions`);

    try {
      for (const topic of dynamicTopics) {
        await this.consumer.subscribe({ topic, fromBeginning: false });
      }

      for (const topic of fixedTopics) {
        await this.fixedConsumer.subscribe({ topic, fromBeginning: false });
      }

      if (dynamicTopics.length > 0) {
        await this.consumer.run({
          eachMessage: async ({ topic, message, partition }) => {
            await this.handleMessage(
              topic,
              message,
              partition,
              SUBSCRIBER_FN_REF_MAP,
            );
          },
        });
      }

      if (fixedTopics.length > 0) {
        await this.fixedConsumer.run({
          eachMessage: async ({ topic, message, partition }) => {
            await this.handleMessage(
              topic,
              message,
              partition,
              SUBSCRIBER_FIXED_FN_REF_MAP,
            );
          },
        });
      }

      this.consumersRunning = true;
      Logger.log('All consumers setup completed');
    } catch (error) {
      Logger.error('Failed to setup subscribers', error);
      throw error;
    }
  }

  private async handleMessage(
    topic: string,
    message: any,
    partition: number,
    handlerMap: Map<string, MessageHandler>,
  ): Promise<void> {
    try {
      const callback = handlerMap.get(topic);
      const object = SUBSCRIBER_OBJ_REF_MAP.get(topic);
      const messageValue = message.value?.toString();

      if (callback && object && messageValue) {
        Logger.debug(
          `Processing message from topic: ${topic}, partition: ${partition}`,
        );
        await callback.apply(object, [messageValue]);
      } else if (!messageValue) {
        Logger.warn(`Received empty message from topic: ${topic}`);
      } else if (!callback) {
        Logger.warn(`No handler found for topic: ${topic}`);
      } else if (!object) {
        Logger.warn(`No instance found for topic: ${topic}`);
      }
    } catch (error) {
      Logger.error(`Error processing message from topic ${topic}:`, error);
      // 这里可以添加死信队列逻辑
    }
  }

  async sendMessage(kafkaTopic: string, kafkaMessage: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Kafka is not connected');
    }

    try {
      Logger.debug(`Sending message to topic: ${kafkaTopic}`);

      const metadata = await this.producer.send({
        topic: kafkaTopic,
        messages: [{ value: JSON.stringify(kafkaMessage) }],
      });

      Logger.debug(`Message sent successfully to topic: ${kafkaTopic}`);
      return metadata;
    } catch (error) {
      Logger.error(`Failed to send message to topic ${kafkaTopic}:`, error);
      throw error;
    }
  }

  isHealthy(): boolean {
    return this.isConnected && !this.isReconnecting;
  }

  getConnectionStatus(): {
    isConnected: boolean;
    isReconnecting: boolean;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    consumersRunning: boolean;
  } {
    return {
      isConnected: this.isConnected,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      consumersRunning: this.consumersRunning,
    };
  }

  async forceReconnect(): Promise<void> {
    Logger.log('Forcing reconnection...');
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    await this.reconnectInternal();
  }
}
