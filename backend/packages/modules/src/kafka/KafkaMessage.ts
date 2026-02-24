export class KafkaPayload {
  public body: any;
  public messageId: string;
  public messageType: string;
  public topicName: string;
  public createdTime?: string;

  static create(
    messageId: string,
    body: any,
    messageType: string,
    topicName: string,
  ): KafkaPayload {
    return {
      messageId,
      body,
      messageType,
      topicName,
      createdTime: new Date().toISOString(),
    };
  }
}

export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  groupId: string;
  // 添加可选的高级配置
  ssl?: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
  connectionTimeout?: number;
  requestTimeout?: number;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  rebalanceTimeout?: number;
  maxWaitTimeInMs?: number;
  retry?: {
    initialRetryTime?: number;
    retries?: number;
    maxRetryTime?: number;
  };
}

export interface MessageHandler {
  (message: string): Promise<void> | void;
}
