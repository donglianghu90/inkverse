import { MessageHandler } from './KafkaMessage';

export const SUBSCRIBER_FN_REF_MAP = new Map<string, MessageHandler>();
export const SUBSCRIBER_FIXED_FN_REF_MAP = new Map<string, MessageHandler>();
export const SUBSCRIBER_OBJ_REF_MAP = new Map<string, any>();

export function SubscribeTo(topic: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = target[propertyKey] as MessageHandler;
    if (typeof originalMethod !== 'function') {
      throw new Error(
        `@SubscribeTo can only be applied to methods. ${propertyKey} is not a function.`,
      );
    }
    SUBSCRIBER_FN_REF_MAP.set(topic, originalMethod);
    return descriptor;
  };
}

export function SubscribeToFixedGroup(topic: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = target[propertyKey] as MessageHandler;
    if (typeof originalMethod !== 'function') {
      throw new Error(
        `@SubscribeToFixedGroup can only be applied to methods. ${propertyKey} is not a function.`,
      );
    }
    SUBSCRIBER_FIXED_FN_REF_MAP.set(topic, originalMethod);
    return descriptor;
  };
}

// 清理函数，用于模块销毁时清理资源
export function clearSubscribers(): void {
  SUBSCRIBER_FN_REF_MAP.clear();
  SUBSCRIBER_FIXED_FN_REF_MAP.clear();
  SUBSCRIBER_OBJ_REF_MAP.clear();
}
