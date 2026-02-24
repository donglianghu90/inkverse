import { SetMetadata } from '@nestjs/common';

export const AGENDA_PROCESSOR_QUEUE_NAME = 'agenda_processor_queue_name';
export const AGENDA_PROCESS = 'agenda_process';

/**
 * 装饰器：标记一个类为 Agenda 队列处理器
 * @param queueName 队列名称（AgendaService 实例名，如 'wechat-task'）
 * 
 * @example
 * @Processor('wechat-task')
 * export class WechatTaskProcessor {
 *   @Process()
 *   async process(job: Job) {
 *     const { type, data } = job.attrs.data;
 *     // 根据 type 分发处理逻辑
 *     switch(type) {
 *       case 'send_message': 
 *         // 处理发送消息
 *         break;
 *       case 'send_image':
 *         // 处理发送图片
 *         break;
 *     }
 *   }
 * }
 */
export const Processor = (queueName: string): ClassDecorator =>
  SetMetadata(AGENDA_PROCESSOR_QUEUE_NAME, queueName);

/**
 * 装饰器：标记一个方法为任务处理方法
 * 该方法会处理指定队列的所有任务
 */
export const Process = (): MethodDecorator => SetMetadata(AGENDA_PROCESS, true);
