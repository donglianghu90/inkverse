import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Agenda, Job } from '@hokify/agenda';
import { randomUUID } from 'crypto';
import { AgendaModuleOptions, DefaultJobOptions } from './agenda.module';
import Bottleneck from 'bottleneck';

export interface TaskPriority {
  SINGLE_CHAT_URGENT: number;   // 单聊紧急
  SINGLE_CHAT_NORMAL: number;   // 单聊普通
  GROUP_CHAT_URGENT: number;    // 群聊紧急
  GROUP_CHAT_NORMAL: number;    // 群聊普通
  CREATE_CONTACT: number;
  GET_GROUP_DETAILS: number;
  DEFAULT: number;
}

export const TASK_PRIORITIES: TaskPriority = {
  SINGLE_CHAT_URGENT: 100,   // 单聊紧急消息（最高优先级）
  SINGLE_CHAT_NORMAL: 80,    // 单聊普通消息
  GROUP_CHAT_URGENT: 60,     // 群聊紧急消息
  GROUP_CHAT_NORMAL: 40,     // 群聊普通消息
  CREATE_CONTACT: 20,        // 创建联系人
  GET_GROUP_DETAILS: 10,     // 获取群详情
  DEFAULT: 1,                // 默认优先级
};

export enum TaskStatus {
  PENDING = 'pending',     // 待执行
  SENDING = 'sending',     // 发送中（已执行但等待回调）
  SENT = 'sent',          // 已发送（收到回调）
  FAILED = 'failed',      // 发送失败
  TIMEOUT = 'timeout',    // 超时
}

export interface TaskData {
  status?: TaskStatus;  // 任务状态
  executeTime?: number; // 执行时间戳
  callbackTime?: number; // 回调时间戳
  error?: string;       // 错误信息
  [key: string]: any;
}

export interface JobOptions {
  jobId?: string;           // 任务ID，如果不传会自动生成
  priority?: number;        // 任务优先级，数字越大优先级越高
  delay?: number;           // 延迟执行时间（毫秒）
  schedule?: Date;          // 指定执行时间
  concurrency?: number;     // 任务并发数
  removeOnComplete?: boolean; // 完成后是否移除
  removeOnFail?: boolean;     // 失败后是否移除
  attempts?: number;          // 重试次数
  backoff?: {                 // 重试策略
    type: 'fixed' | 'exponential';
    delay: number;
  };
  [key: string]: any;
}

export interface MessageTaskData extends TaskData {
  platformId: string;       // 微信号ID
  messageId: string;        // 消息ID
  chatType: 'single' | 'group';  // 会话类型
  toWxid: string;           // 接收方微信ID
  content?: any;            // 消息内容
  clientId: number;         // 客户端ID
  ip: string;               // IP地址
}

export interface TimeoutCheckTaskData extends TaskData {
  originalJobId: string;    // 原发送任务的jobId
  messageId: string;        // 消息ID
  platformId: string;       // 微信号ID
  chatType: 'single' | 'group';
  executeTime: number;      // 原任务执行时间戳
  toWxid: string;           // 接收方
}

export enum TaskType {
  SEND_MESSAGE = 'send_message',
  SEND_IMAGE = 'send_image', 
  SEND_FILE = 'send_file',
  GET_USER_INFO = 'get_user_info',
  GET_GROUP_INFO = 'get_group_info',
  GET_GROUP_MESSAGES = 'get_group_messages',
  CREATE_CONTACT = 'create_contact',
}

@Injectable()
export class AgendaService implements OnModuleInit, OnModuleDestroy {
  private agenda: Agenda;
  private isReady: boolean = false; // Agenda 是否已启动并准备好
  private readonly jobProcessors = new Map<string, boolean>(); // 记录已注册的任务处理器
  private limiter?: Bottleneck; // 限流器
  // 记录每个任务类型的最后调度时间，用于批量任务的时间分配
  private readonly lastScheduledTime = new Map<string, Date>();
  private readonly defaultConcurrency: number;
  private readonly lockLimit?: number; // 全局并发限制
  private readonly defaultJobOptions: DefaultJobOptions;
  private globalProcessor?: (job: Job) => void | Promise<void>; // 全局处理器
  private readonly queueName: string; // 队列名称，也是 MongoDB 中任务的 name 字段

  constructor(
    private readonly options?: AgendaModuleOptions,
  ) {
    this.queueName = options?.name || 'default';
    this.defaultConcurrency = options?.defaultConcurrency ?? 10;
    this.lockLimit = options?.lockLimit;
    this.defaultJobOptions = options?.defaultJobOptions ?? {};
  }

  /**
   * 获取队列名称
   */
  getQueueName(): string {
    return this.queueName;
  }

  /**
   * 设置全局处理器，处理队列中的所有任务
   */
  setGlobalProcessor(processor: (job: Job) => void | Promise<void>): void {
    if (this.globalProcessor) {
      Logger.warn(`Global processor for queue ${this.queueName} is being overridden`);
    }
    this.globalProcessor = processor;
    
    // 如果 agenda 已初始化，立即注册处理器
    if (this.agenda) {
      this.registerGlobalProcessor();
    }
  }

  /**
   * 包装处理器，自动处理 removeOnComplete 和 removeOnFail
   */
  private wrapProcessor(processor: (job: Job) => void | Promise<void>): (job: Job) => Promise<void> {
    return async (job: Job) => {
      const payload = job.attrs.data as any;
      const removeOnComplete = payload._removeOnComplete ?? this.defaultJobOptions.removeOnComplete;
      const removeOnFail = payload._removeOnFail ?? this.defaultJobOptions.removeOnFail;
      
      try {
        // 执行用户的处理器
        await processor(job);
        
        // 成功完成，检查是否需要删除
        if (removeOnComplete) {
          await job.remove();
        }
      } catch (error) {
        // 失败，检查是否需要删除
        if (removeOnFail) {
          await job.remove();
        }
        throw error;
      }
    };
  }

  /**
   * 注册全局处理器到 Agenda
   */
  private registerGlobalProcessor(): void {
    if (!this.agenda || !this.globalProcessor) {
      return;
    }

    const concurrency = this.defaultConcurrency;
    const lockLimit = this.lockLimit;
    
    // 包装处理器，自动处理 removeOnComplete 和 removeOnFail
    const wrappedProcessor = this.wrapProcessor(this.globalProcessor);
    
    // 使用队列名作为 MongoDB 任务的 name 字段
    // lockLimit: 跨所有实例的全局并发限制
    // concurrency: 单实例并发限制
    this.agenda.define(this.queueName, wrappedProcessor, { 
      concurrency,
      lockLimit 
    });
    this.jobProcessors.set(this.queueName, true);
  }

  async onModuleInit() {
    // 优先使用模块选项中的 mongoUrl，其次使用配置服务中的 MONGO_URL，最后使用默认值
    const mongoUrl = this.options?.mongoUrl;
    
    if (!mongoUrl) {
      Logger.warn('MongoDB URL not configured, AgendaService will not be initialized');
      return;
    }
    
    // 从模块选项中获取配置，或使用默认值
    const collection = this.options?.collection || 'agenda_tasks';
    const processEvery = this.options?.processEvery || '1 second';
    const maxConcurrency = this.options?.maxConcurrency ?? 200;
    const defaultLockLimit = this.options?.defaultLockLimit ?? 0;
    const defaultLockLifetime = this.options?.defaultLockLifetime ?? 10 * 60 * 1000;
    
    try {
      this.agenda = new Agenda({
        db: { 
          address: mongoUrl, 
          collection,
          options: {
            serverSelectionTimeoutMS: 5000, // 5秒连接超时
            socketTimeoutMS: 10000, // 10秒socket超时
          }
        },
        processEvery,
        // 最大并发数
        maxConcurrency,
        // 分布式部署配置
        defaultLockLimit, // 0 表示无限制，但会通过 MongoDB 锁机制控制
        defaultLockLifetime, // 默认10分钟锁超时，防止死锁
        // 实例标识，用于调试和监控
        name: `${this.queueName}-${process.env.NODE_ENV || 'development'}-${process.pid}`,
        // 🔥 关键配置：按优先级排序任务
        // nextRunAt: 1 表示升序（最早的先执行）
        // priority: -1 表示降序（数字越大优先级越高，越先执行）
        sort: { nextRunAt: 1, priority: -1 },
      });

      // 初始化限流器
      if (this.options?.rateLimiter) {
        const config = this.options.rateLimiter;
        this.limiter = new Bottleneck({
          maxConcurrent: config.maxConcurrent,
          minTime: config.minTime,
          reservoir: config.reservoir,
          reservoirRefreshAmount: config.reservoirRefreshAmount,
          reservoirRefreshInterval: config.reservoirRefreshInterval,
        });
      }

      // 先启动 Agenda 建立数据库连接
      await this.agenda.start();
      this.isReady = true; // 标记为已就绪
      
      // 等待处理器注册（最多等待 2 秒）
      // 这样可以确保重启时处理器已经注册，能够处理现有任务
      const maxWaitTime = 2000;
      const startWait = Date.now();
      while (!this.globalProcessor && (Date.now() - startWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // 注册全局处理器（如果已设置）
      this.registerGlobalProcessor();

      // 启动后恢复现有的队列处理器
      await this.recoverExistingQueues();
    } catch (error) {
      this.isReady = false;
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.limiter) {
      await this.limiter.stop();
    }
    
    if (this.agenda) {
      await this.agenda.stop();
    }
  }

  /**
   * 恢复系统重启前存在的队列处理器
   */
  private async recoverExistingQueues(): Promise<void> {
    try {
      // 清理可能的死锁任务
      await this.cleanupDeadlocks();
      
      // 查找所有待执行的任务
      // 注意：Agenda 会查询所有 collection 中的任务，我们需要所有的，因为动态注册的任务可能有不同的 name
      const existingJobs = await this.agenda.jobs({ 
        $or: [
          { nextRunAt: { $exists: true } }, // 待执行任务
          { lockedAt: { $exists: true } }   // 可能的死锁任务
        ]
      });

      // 找出所有唯一的任务名称，并准备恢复
      const queueJobNames = new Set<string>();
      const queueJobs: typeof existingJobs = [];
      
      for (const job of existingJobs) {
        const jobName = job.attrs.name;
        // 所有从这个 Agenda 实例查询到的任务都应该被恢复
        // 因为它们都来自同一个 collection (wechat_task_agenda)
        queueJobNames.add(jobName);
        queueJobs.push(job);
      }

      // 为未注册的 name 自动注册处理器（重启后恢复）
      if (this.globalProcessor) {
        for (const jobName of queueJobNames) {
          if (!this.jobProcessors.has(jobName)) {
            Logger.log(`[${this.queueName}] Auto-registering processor for recovered job name: ${jobName}`);
            const wrappedProcessor = this.wrapProcessor(this.globalProcessor);
            this.agenda.define(jobName, wrappedProcessor, {
              concurrency: 1,
              lockLimit: this.lockLimit,
            });
            this.jobProcessors.set(jobName, true);
          }
        }
      }

      if (queueJobs.length > 0) {
        Logger.log(`[${this.queueName}] Found ${queueJobs.length} existing tasks to recover (filtered from ${existingJobs.length} total)`);
        
        // 统计各类型任务数量
        const taskTypeCounts = new Map<string, number>();
        const taskNameCounts = new Map<string, number>();
        let expiredCount = 0;
        const now = new Date();
        
        // 检查并重新调度过期任务
        for (const job of queueJobs) {
          const data = job.attrs.data as any;
          const jobName = job.attrs.name;
          const type = data?.data?.type || 'unknown';
          
          taskTypeCounts.set(type, (taskTypeCounts.get(type) || 0) + 1);
          taskNameCounts.set(jobName, (taskNameCounts.get(jobName) || 0) + 1);
          
          // 如果任务已经过期（nextRunAt < now），重新调度为立即执行
          if (job.attrs.nextRunAt && job.attrs.nextRunAt < now && !job.attrs.lockedAt) {
            Logger.log(`[${this.queueName}] Rescheduling expired task: ${data.jobId} (name: ${jobName})`);
            job.schedule(now);
            await job.save();
            expiredCount++;
          }
        }
        
        Logger.log(`[${this.queueName}] Task recovery summary:`, {
          total: queueJobs.length,
          expired: expiredCount,
          byType: Object.fromEntries(taskTypeCounts),
          byName: Object.fromEntries(taskNameCounts),
        });
      } else {
        Logger.log(`[${this.queueName}] No existing tasks to recover`);
      }

    } catch (error) {
      Logger.error(`[${this.queueName}] Failed to recover existing queues:`, error);
    }
  }

  /**
   * 为指定的任务类型创建任务处理器
   */
  private async createJobProcessor(jobType: string, concurrency: number = 1): Promise<void> {
    if (!this.agenda) {
      throw new Error('AgendaService is not initialized. Make sure onModuleInit() has been called before using this service.');
    }

    if (this.jobProcessors.has(jobType)) {
      return;
    }

    // 为每个任务类型定义处理器，并设置并发限制
    this.agenda.define(jobType, async (job: Job) => {
      const data = job.attrs.data as TaskData;
      await this.handleTask(jobType, data, job);
    }, { concurrency });

    this.jobProcessors.set(jobType, true);
  }

  /**
   * Defines a job processor.
   * @param type The type of the job.
   * @param processor The function that processes the job.
   * @param options The options for the job definition.
   */
  public define(type: string, processor: (job: Job) => void | Promise<void>, options?: any): void {
    if (!this.agenda) {
      throw new Error('AgendaService is not initialized. Make sure onModuleInit() has been called before using this service.');
    }

    if (this.jobProcessors.has(type)) {
      Logger.warn(`Processor for job type ${type} is already defined and will be overridden.`);
    }
    this.agenda.define(type, processor, options || {});
    this.jobProcessors.set(type, true);
  }

  /**
   * 添加任务 - 与 BullMQ API 保持一致
   * @param name 任务名称（作为 Agenda 的 name，如 'wx0_send_message', 'wx1_send_message'）
   * @param data 任务数据
   * @param options 任务选项
   * @returns 任务ID
   * 
   * 🔑 自动轮询机制：
   * - 第一个参数 `name` 会作为 Agenda 的 name（队列标识）
   * - 每个不同的 `name` 会自动注册为独立的处理器（concurrency=1）
   * - Agenda 会自动在不同的 name 之间轮询执行任务
   * - 所有 name 都使用同一个 @Process() 方法处理
   * 
   * @example
   * // 10个账号，每个10条消息
   * for (let i = 0; i < 10; i++) {
   *   for (let j = 0; j < 10; j++) {
   *     await agendaService.add(`wx${i}_send_message`, {
   *       platformId: `wx${i}`,
   *       messageId: `msg_${j}`,
   *       content: 'hello',
   *     }, {
   *       jobId: `wx${i}_msg_${j}`,
   *     });
   *   }
   * }
   * 
   * // 执行顺序：
   * // wx0 的 msg_0 → wx1 的 msg_0 → wx2 的 msg_0 → ... → wx9 的 msg_0
   * // wx0 的 msg_1 → wx1 的 msg_1 → wx2 的 msg_1 → ... → wx9 的 msg_1
   * // ... 依次轮询
   * 
   * // 在处理器中使用
   * @Process()
   * async process(job: Job) {
   *   const { data, jobId } = job.attrs.data;
   *   const name = job.attrs.name;  // 'wx0_send_message'
   *   
   *   // 从 name 中提取 type
   *   const type = name.substring(name.lastIndexOf('_') + 1);  // 'send_message'
   *   
   *   switch(type) {
   *     case 'send_message':
   *       await this.handleSendMessage(data, jobId);
   *       break;
   *   }
   * }
   */
  async add(name: string, data: TaskData, options: JobOptions = {}): Promise<string> {
    if (!this.agenda) {
      throw new Error('AgendaService is not initialized');
    }

    // 🔑 自动注册处理器：如果该 name 还没有注册，自动注册一个
    if (!this.jobProcessors.has(name)) {
      if (!this.globalProcessor) {
        throw new Error(`No processor registered for queue: ${this.queueName}. Please use @Processor() and @Process() decorators.`);
      }
      
      // 包装处理器，自动处理 removeOnComplete 和 removeOnFail
      const wrappedProcessor = this.wrapProcessor(this.globalProcessor);
      
      // 每个 name 的 concurrency=1，确保每个账号每次只执行1个任务
      this.agenda.define(name, wrappedProcessor, {
        concurrency: 1,
        lockLimit: this.lockLimit,
      });
      this.jobProcessors.set(name, true);
    }

    // 合并默认选项和传入选项
    const mergedOptions = {
      ...this.defaultJobOptions,
      ...options,
    };
    
    // 生成或使用提供的 jobId
    const jobId = mergedOptions.jobId || this.generateJobId();
    const priority = mergedOptions.priority || 1;
    
    // 检查是否已存在相同 name 和 jobId 的任务
    const existingJobs = await this.agenda.jobs({ 
      name: name,  // 使用传入的 name
      'data.jobId': jobId,
    });
    
    if (existingJobs.length > 0) {
      const existingJob = existingJobs[0];
      
      // 如果任务正在执行中，忽略更新
      if (existingJob.attrs.lockedAt) {
        Logger.warn(`Task [${name}] ${jobId} is running, ignoring update`);
        return jobId;
      }
      // 更新任务数据
      const existingData = existingJob.attrs.data as any;
      existingJob.attrs.data = {
        data,
        jobId,
        _removeOnComplete: mergedOptions.removeOnComplete,
        _removeOnFail: mergedOptions.removeOnFail,
        _attempts: mergedOptions.attempts,
        _backoff: mergedOptions.backoff,
        _attemptsMade: existingData._attemptsMade || 0, // 保留已尝试次数
      };
      
      // 更新优先级
      existingJob.priority(priority);
      
      // 更新执行时间
      if (mergedOptions.schedule) {
        existingJob.schedule(mergedOptions.schedule);
      } else if (mergedOptions.delay) {
        existingJob.schedule(new Date(Date.now() + mergedOptions.delay));
      } else {
        existingJob.schedule(new Date());
      }
      
      await existingJob.save();
    
      return jobId;
    }
    
    // 任务不存在，创建新任务
    const job = this.agenda.create(name, {  // 使用传入的 name
      data,
      jobId,
      _removeOnComplete: mergedOptions.removeOnComplete,
      _removeOnFail: mergedOptions.removeOnFail,
      _attempts: mergedOptions.attempts,
      _backoff: mergedOptions.backoff,
      _attemptsMade: 0, // 初始化已尝试次数
    });
    
    // 设置优先级
    job.priority(priority);
    
    // 设置执行时间
    if (mergedOptions.schedule) {
      job.schedule(mergedOptions.schedule);
    } else if (mergedOptions.delay) {
      job.schedule(new Date(Date.now() + mergedOptions.delay));
    } else {
      job.schedule(new Date());
    }
    
    await job.save();
    
    return jobId;
  }

  /**
   * 调度任务 - 只需要任务类型和数据（保留兼容）
   * @deprecated 使用 add() 方法代替
   */
  async scheduleJob(jobType: string, data: TaskData): Promise<string> {
    return this.add(jobType, data, { priority: (data as any).priority });
  }

  /**
   * 批量添加任务 - 与 BullMQ API 保持一致
   * @param jobs 任务列表，每项包含 { type, data, opts }
   * @returns 任务ID列表
   * 
   * @example
   * await agendaService.addBulk([
   *   { type: 'send_message', data: { content: 'hello1' }, opts: { priority: 100 } },
   *   { type: 'send_message', data: { content: 'hello2' }, opts: { priority: 90 } },
   * ]);
   */
  async addBulk(jobs: Array<{ type: string; data: TaskData; opts?: JobOptions }>): Promise<string[]> {
    const jobIds: string[] = [];
    const batchSize = 100;
    const jobsToSave: any[] = [];
  
    
    for (let i = 0; i < jobs.length; i++) {
      const { type, data, opts = {} } = jobs[i];
      
      // 确保任务处理器存在
      const concurrency = opts.concurrency || 1;
      await this.createJobProcessor(type, concurrency);
      
      const jobId = opts.jobId || this.generateJobId();
      const priority = opts.priority || 1;
      
      // 创建任务
      const job = this.agenda.create(type, {
        ...data,
        jobId,
      });
      
      job.priority(priority);
      
      // 设置执行时间
      if (opts.schedule) {
        job.schedule(opts.schedule);
      } else if (opts.delay) {
        job.schedule(new Date(Date.now() + opts.delay));
      } else {
        job.schedule(new Date());
      }
      
      jobsToSave.push(job);
      jobIds.push(jobId);
      
      // 批量保存
      if (jobsToSave.length >= batchSize) {
        await Promise.all(jobsToSave.map(j => j.save()));
        jobsToSave.length = 0;
      }
    }
    
    // 保存剩余任务
    if (jobsToSave.length > 0) {
      await Promise.all(jobsToSave.map(j => j.save()));
    }
    
    return jobIds;
  }

  /**
   * 批量调度任务 - 自动计算执行时间，避免内存累积
   * @param jobType 任务类型（如 'send_message', 'send_image'）
   * @param dataList 任务数据列表
   * @param options 配置选项
   * @returns 已调度的任务ID列表
   * 
   * @example
   * // 适用于大批量任务（10万+），自动分配执行时间
   * await agendaService.scheduleBatchJobs('send_message', tasks, {
   *   intervalMs: 1000,  // 每个任务间隔1秒
   *   batchSize: 200,
   * });
   */
  async scheduleBatchJobs(
    jobType: string, 
    dataList: TaskData[], 
    options: {
      concurrency?: number;
      intervalMs?: number;
      checkExisting?: boolean;
      batchSize?: number;
    } = {}
  ): Promise<string[]> {
    const {
      concurrency = 1,
      intervalMs = 1000,
      checkExisting = false,  // 默认不检查，提升性能
      batchSize = 100         // 每批保存100个
    } = options;
    
    // 确保任务处理器存在
    await this.createJobProcessor(jobType, concurrency);
    
    const jobIds: string[] = [];
    const now = Date.now();
    const lastScheduled = this.lastScheduledTime.get(jobType)?.getTime() || now;
    
    // 计算起始时间（取当前时间和最后调度时间中较大的值）
    let nextExecutionTime = Math.max(now, lastScheduled);  
    // 批量处理任务
    const jobs: any[] = [];
    
    for (let i = 0; i < dataList.length; i++) {
      const taskData = dataList[i];
      const jobId = taskData.jobId || this.generateJobId();
      const priority = taskData.priority || 1;
      
      // 如果需要检查已存在的任务（可选，会影响性能）
      if (checkExisting) {
        const existingJob = await this.agenda.jobs({ 
          name: jobType,
          'data.jobId': jobId,
          $or: [
            { nextRunAt: { $exists: true } },
            { lockedAt: { $exists: true } }
          ]
        });
        
        if (existingJob.length > 0) {
          jobIds.push(jobId);
          continue;
        }
      }
      
      // 创建任务
      const job = this.agenda.create(jobType, {
        ...taskData,
        jobId,
        priority,
      });
      
      job.priority(priority);
      job.schedule(new Date(nextExecutionTime));
      
      jobs.push(job);
      jobIds.push(jobId);
      
      // 计算下一个任务的执行时间
      nextExecutionTime += intervalMs;
      
      // 批量保存
      if (jobs.length >= batchSize) {
        await Promise.all(jobs.map(j => j.save()));
        jobs.length = 0; // 清空已保存的任务
      }
    }
    
    // 保存剩余的任务
    if (jobs.length > 0) {
      await Promise.all(jobs.map(j => j.save()));
    }
    
    // 更新最后调度时间
    this.lastScheduledTime.set(jobType, new Date(nextExecutionTime));
    
    return jobIds;
  }

  /**
   * 调度任务 - 支持自定义并发数
   */
  async scheduleJobWithConcurrency(jobType: string, data: TaskData, concurrency: number = 1): Promise<string> {
    // 确保任务处理器存在
    await this.createJobProcessor(jobType, concurrency);
    
    // 如果没有提供 jobId，自动生成一个
    const jobId = data.jobId || this.generateJobId();
    const priority = data.priority || 1;
    
    // 检查是否已存在相同的 jobId
    const existingJob = await this.agenda.jobs({ 
      name: jobType,
      'data.jobId': jobId,
      $or: [
        { nextRunAt: { $exists: true } }, // 待执行
        { lockedAt: { $exists: true } }   // 正在执行
      ]
    });
    
    if (existingJob.length > 0) {
      return jobId;
    }
    
    const job = this.agenda.create(jobType, {
      ...data,
      jobId,
      priority,
    });
    
    // 设置优先级和立即执行
    job.priority(priority);
    job.schedule(new Date());
    await job.save();
    return jobId;
  }

  /**
   * 生成唯一的 jobId
   */
  private generateJobId(): string {
    return `job_${randomUUID()}`;
  }

  /**
   * 标记任务为发送中状态（执行后等待回调）
   * @param type 任务类型
   * @param jobId 任务ID
   */
  async markTaskAsSending(type: string, jobId: string): Promise<boolean> {
    try {
      const jobs = await this.agenda.jobs({
        name: this.queueName,
        'data.type': type,
        'data.jobId': jobId,
      });

      if (jobs.length === 0) {
        return false;
      }

      const job = jobs[0];
      const taskData = job.attrs.data as any;
      
      // 更新状态
      taskData.data.status = TaskStatus.SENDING;
      taskData.data.executeTime = Date.now();
      job.attrs.data = taskData;
      
      await job.save();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 完成任务并删除（收到回调时调用）
   * @param type 任务类型
   * @param jobId 任务ID
   */
  async completeTask(type: string, jobId: string): Promise<boolean> {
    try {
      const jobs = await this.agenda.jobs({
        name: this.queueName,
        'data.type': type,
        'data.jobId': jobId,
      });

      if (jobs.length === 0) {
        return false;
      }

      const job = jobs[0];
      const taskData = job.attrs.data as any;
      
      // 更新状态为已发送
      taskData.data.status = TaskStatus.SENT;
      taskData.data.callbackTime = Date.now();
      
      // 删除任务
      await job.remove();
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 标记任务为失败但不删除
   * @param type 任务类型
   * @param jobId 任务ID
   * @param error 错误信息
   */
  async failTask(type: string, jobId: string, error?: string): Promise<boolean> {
    try {
      const jobs = await this.agenda.jobs({
        name: this.queueName,
        'data.type': type,
        'data.jobId': jobId,
      });

      if (jobs.length === 0) {

        return false;
      }

      const job = jobs[0];
      const taskData = job.attrs.data as any;
      
      // 更新状态为失败
      taskData.data.status = TaskStatus.FAILED;
      taskData.data.error = error || 'Unknown error';
      job.attrs.data = taskData;
      
      await job.save();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 启动定时超时检查任务
   * 定期检查所有状态为 sending 且超过指定时间的任务
   * @param intervalMs 检查间隔（毫秒），默认1分钟
   * @param timeoutMs 超时时间（毫秒），默认3分钟
   */
  async startTimeoutChecker(intervalMs: number = 60 * 1000, timeoutMs: number = 3 * 60 * 1000): Promise<void> {
    if (!this.agenda) {
      throw new Error('AgendaService is not initialized');
    }

    // 等待 Agenda 就绪（最多等待 10 秒）
    const maxWaitTime = 10000;
    const startWait = Date.now();
    while (!this.isReady && (Date.now() - startWait) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!this.isReady) {
      throw new Error('AgendaService is not ready after waiting');
    }

    const jobName = `${this.queueName}_timeout_checker`;
    
    try {
      // 先取消现有的同名任务（避免重复）
      await this.agenda.cancel({ name: jobName });
      
      // 定义定时任务
      this.agenda.define(jobName, async () => {
        await this.checkTimeoutTasks(timeoutMs);
      });
      
      // 将毫秒转换为秒，Agenda.js 支持的格式
      const intervalSeconds = Math.floor(intervalMs / 1000);
      let interval: string;
      if (intervalSeconds >= 60) {
        const minutes = Math.floor(intervalSeconds / 60);
        interval = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
      } else {
        interval = `${intervalSeconds} ${intervalSeconds === 1 ? 'second' : 'seconds'}`;
      }
    
      
      // 创建并启动定时任务
       await this.agenda.every(interval, jobName);
    } catch (error) {
      throw error;
    }
  }

  /**
   * 检查所有类型的超时任务
   * @param timeoutMs 超时时间（毫秒）
   */
  private async checkTimeoutTasks(timeoutMs: number): Promise<void> {
    try {
      const now = Date.now();
      const timeoutThreshold = now - timeoutMs;
      console.log('timeoutThreshold', timeoutThreshold);
      // 查找所有状态为 sending 的任务
      const jobs = await this.agenda.jobs({
        name: this.queueName,
        'data.data.status': TaskStatus.SENDING,
      });

      let timeoutCount = 0;
      
      for (const job of jobs) {
        const taskData = job.attrs.data as any;
        const executeTime = taskData.data.executeTime || 0;
      
        // 检查是否超时
        if (executeTime && executeTime < timeoutThreshold) {
          // 标记为超时
          taskData.data.status = TaskStatus.TIMEOUT;
          taskData.data.error = `Task timeout: No callback received within ${timeoutMs / 1000}s`;
          job.attrs.data = taskData;
          
          await job.save();
          
          const duration = now - executeTime;
          timeoutCount++;
        }
      }
    } catch (error) {
    }
  }

  /**
   * 停止超时检查任务
   */
  async stopTimeoutChecker(): Promise<void> {
    if (!this.agenda) {
      return;
    }

    const jobName = `${this.queueName}_timeout_checker`;
    await this.agenda.cancel({ name: jobName });
  }

  /**
   * 处理任务的统一入口
   */
  private async handleTask(jobType: string, data: TaskData, job: Job): Promise<void> {
    const jobData = job.attrs.data as any;
    const removeOnComplete = jobData._removeOnComplete ?? this.defaultJobOptions.removeOnComplete;
    const removeOnFail = jobData._removeOnFail ?? this.defaultJobOptions.removeOnFail;
    const maxAttempts = jobData._attempts || 0; // 最大重试次数
    const attemptsMade = jobData._attemptsMade || 0; // 已尝试次数
    const backoffConfig = jobData._backoff;
    
    // 执行任务的内部函数
    const executeTask = async () => {
      try {
        // 对于自定义任务类型，记录日志但不报错
        
        // 如果配置了 removeOnComplete，任务完成后删除
        if (removeOnComplete) {
          await job.remove();
        }
      } catch (error) {
        // 任务执行失败，处理重试逻辑
        const currentAttempt = attemptsMade + 1;
        
        // 检查是否还有重试次数
        if (maxAttempts > 0 && currentAttempt < maxAttempts) {
          // 还有重试次数，重新调度任务
          await this.retryFailedTask(job, currentAttempt, backoffConfig);
        } else {
          // 没有重试次数了，按照配置处理
          if (removeOnFail) {
            await job.remove();
          }
        }
        
        throw error;
      }
    };
    
    // 如果配置了限流器，通过限流器执行；否则直接执行
    if (this.limiter) {
      await this.limiter.schedule(executeTask);
    } else {
      await executeTask();
    }
  }

  /**
   * 重试失败的任务
   * 将任务重新调度到所有现有待执行任务之后
   */
  private async retryFailedTask(
    job: Job, 
    attemptsMade: number, 
    backoffConfig?: { type: 'fixed' | 'exponential'; delay: number }
  ): Promise<void> {
    try {
      // 查询当前队列中所有待执行任务的最晚执行时间
      const pendingJobs = await this.agenda.jobs({
        name: this.queueName,
        nextRunAt: { $exists: true },
        lockedAt: { $exists: false }
      });
      
      let latestRunAt = new Date();
      if (pendingJobs.length > 0) {
        // 找到最晚的执行时间
        const maxRunAt = pendingJobs.reduce((max, j) => {
          const runAt = j.attrs.nextRunAt;
          return runAt && runAt > max ? runAt : max;
        }, new Date(0));
        
        if (maxRunAt > latestRunAt) {
          latestRunAt = maxRunAt;
        }
      }
      
      // 计算重试延迟
      let retryDelay = 0;
      if (backoffConfig) {
        if (backoffConfig.type === 'fixed') {
          retryDelay = backoffConfig.delay;
        } else if (backoffConfig.type === 'exponential') {
          // 指数退避：delay * 2^(attemptsMade - 1)
          retryDelay = backoffConfig.delay * Math.pow(2, attemptsMade - 1);
        }
      }
      
      // 设置重试时间：最晚任务时间 + 重试延迟
      const retryTime = new Date(latestRunAt.getTime() + retryDelay);
      
      // 更新任务数据
      const jobData = job.attrs.data as any;
      jobData._attemptsMade = attemptsMade;
      job.attrs.data = jobData;
      
      job.priority(-10);
      
      // 重新调度任务
      job.schedule(retryTime);
      await job.save();
    } catch (error) {
      // 重试调度失败，直接删除任务
      await job.remove();
    }
  }

  /**
   * 处理发送消息任务
   */

  /**
   * 取消平台的所有待处理任务
   */
  async cancelPlatformTasks(platformId: string): Promise<void> {
    await this.agenda.cancel({ 'data.platformId': platformId });
  }

  /**
   * 获取所有活跃的平台队列
   */
  async getActivePlatforms(): Promise<string[]> {
    const jobs = await this.agenda.jobs({ nextRunAt: { $exists: true } });
    const platforms = new Set<string>();
    
    jobs.forEach(job => {
      const data = job.attrs.data as any;
      if (data?.platformId) {
        platforms.add(data.platformId);
      }
    });
    
    return Array.from(platforms);
  }

  /**
   * 获取指定平台的任务队列状态
   */
  async getPlatformQueueStatus(platformId: string): Promise<{
    totalTasks: number;
    pendingTasks: number;
    runningTasks: number;
    lastExecutionTime?: Date;
    tasksByType: Record<string, number>;
  }> {
    const allJobs = await this.agenda.jobs({ 'data.platformId': platformId });
    const pendingJobs = await this.agenda.jobs({ 
      'data.platformId': platformId, 
      nextRunAt: { $exists: true },
      lockedAt: { $exists: false }
    });
    const runningJobs = await this.agenda.jobs({ 
      'data.platformId': platformId, 
      lockedAt: { $exists: true }
    });

    const tasksByType: Record<string, number> = {};
    allJobs.forEach(job => {
      const data = job.attrs.data as any;
      const taskType = data?.taskType || 'unknown';
      tasksByType[taskType] = (tasksByType[taskType] || 0) + 1;
    });

    return {
      totalTasks: allJobs.length,
      pendingTasks: pendingJobs.length,
      runningTasks: runningJobs.length,
      lastExecutionTime: null, // 不再按 platformId 跟踪，而是按任务类型跟踪
      tasksByType,
    };
  }

  /**
   * 获取任务统计信息
   */
  async getTaskStats(): Promise<any> {
    const jobs = await this.agenda.jobs({});
    const runningJobs = await this.agenda.jobs({ lockedAt: { $exists: true }, $where: 'this.lockedAt > new Date(Date.now() - this.lockLifetime)' });
    
    const stats = {
      total: jobs.length,
      running: runningJobs.length,
      pending: jobs.length - runningJobs.length,
      byType: {} as Record<string, number>,
      byAccount: {} as Record<string, number>,
      byStatus: {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
      },
      instances: {} as Record<string, number>, // 各实例处理的任务数
    };

    jobs.forEach(job => {
      const taskName = job.attrs.name;
      const data = job.attrs.data as any;
      const accountId = data?.accountId;
      const lockedBy = job.attrs.lockedAt ? 'running' : 'pending';
      const lastRunBy = (job.attrs as any).lastRunBy;

      stats.byType[taskName] = (stats.byType[taskName] || 0) + 1;
      if (accountId) {
        stats.byAccount[accountId] = (stats.byAccount[accountId] || 0) + 1;
      }
      
      stats.byStatus[lockedBy]++;
      
      if (lastRunBy) {
        stats.instances[lastRunBy] = (stats.instances[lastRunBy] || 0) + 1;
      }
    });

    return {
      ...stats,
      currentInstance: this.agenda.name,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 获取分布式实例信息
   */
  async getDistributedInstancesInfo(): Promise<any> {
    const runningJobs = await this.agenda.jobs({ 
      lockedAt: { $exists: true }, 
      $where: 'this.lockedAt > new Date(Date.now() - this.lockLifetime)' 
    });

    const instances = {} as Record<string, {
      runningTasks: number;
      lastActivity: Date;
      tasks: string[];
    }>;

    runningJobs.forEach(job => {
      const instanceName = (job.attrs as any).lastRunBy || 'unknown';
      if (!instances[instanceName]) {
        instances[instanceName] = {
          runningTasks: 0,
          lastActivity: new Date(0),
          tasks: [],
        };
      }
      
      instances[instanceName].runningTasks++;
      instances[instanceName].tasks.push(job.attrs.name);
      
      if (job.attrs.lockedAt && job.attrs.lockedAt > instances[instanceName].lastActivity) {
        instances[instanceName].lastActivity = job.attrs.lockedAt;
      }
    });

    return {
      currentInstance: this.agenda.name,
      totalInstances: Object.keys(instances).length,
      instances,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 清理死锁任务（锁超时的任务）
   */
  async cleanupDeadlocks(): Promise<number> {
    const deadlockThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10分钟
    
    const deadlockedJobs = await this.agenda.jobs({
      lockedAt: { $lt: deadlockThreshold },
      $or: [
        { lastFinishedAt: { $exists: false } },
        { lastFinishedAt: { $exists: true, $lt: new Date() } }
      ]
    });

    let cleanedCount = 0;
    for (const job of deadlockedJobs) {
      try {
        // 重置锁状态，使任务可以被重新执行
        await job.save();
        job.attrs.lockedAt = undefined;
        (job.attrs as any).lastRunBy = undefined;
        await job.save();
        cleanedCount++;
      } catch (error) {
      }
    }

    return cleanedCount;
  }

  /**
   * 获取系统重启恢复信息
   */
  async getRecoveryInfo(): Promise<{
    totalRecoveredTasks: number;
    recoveredPlatforms: string[];
    tasksByPlatform: Record<string, number>;
    tasksByType: Record<string, number>;
    oldestTask?: Date;
    newestTask?: Date;
  }> {
    const existingJobs = await this.agenda.jobs({ 
      nextRunAt: { $exists: true }
    });

    const platformIds = new Set<string>();
    const tasksByPlatform: Record<string, number> = {};
    const tasksByType: Record<string, number> = {};
    let oldestTask: Date | undefined;
    let newestTask: Date | undefined;

    existingJobs.forEach(job => {
      const data = job.attrs.data as any;
      const platformId = data?.platformId;
      const taskType = data?.taskType;
      const nextRunAt = job.attrs.nextRunAt;

      if (platformId) {
        platformIds.add(platformId);
        tasksByPlatform[platformId] = (tasksByPlatform[platformId] || 0) + 1;
      }

      if (taskType) {
        tasksByType[taskType] = (tasksByType[taskType] || 0) + 1;
      }

      if (nextRunAt) {
        if (!oldestTask || nextRunAt < oldestTask) {
          oldestTask = nextRunAt;
        }
        if (!newestTask || nextRunAt > newestTask) {
          newestTask = nextRunAt;
        }
      }
    });

    return {
      totalRecoveredTasks: existingJobs.length,
      recoveredPlatforms: Array.from(platformIds),
      tasksByPlatform,
      tasksByType,
      oldestTask,
      newestTask,
    };
  }


  /**
   * 处理超时检查任务
   * 检查消息是否在1分钟内收到回调，如果没有则标记为超时
   */
  private async handleTimeoutCheck(data: TimeoutCheckTaskData): Promise<void> {
    try {
      // 注意：这里需要注入 MessageService 来查询消息状态
      // 由于当前 AgendaService 是通用服务，这部分逻辑应该通过回调函数或事件来处理
      // 这里提供一个占位实现，实际使用时需要在上层服务中处理
      
      // 触发超时事件或回调（需要在实际集成时实现）
      // 例如：this.eventEmitter.emit('message.timeout', data);
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * 移除任务 - 与 BullMQ API 保持一致
   * @param jobId 任务ID
   * @returns 是否成功
   */
  async remove(jobId: string): Promise<boolean> {
    try {
      const result = await this.agenda.cancel({
        'data.jobId': jobId
      });
      
      if (result > 0) {
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 根据 jobId 删除任务（保留兼容）
   * @deprecated 使用 remove() 方法代替
   */
  async cancelTaskByJobId(jobId: string): Promise<number> {
    const result = await this.remove(jobId);
    return result ? 1 : 0;
  }

  /**
   * 根据 messageId 删除任务（包括超时检查任务）
   * 用于在收到消息回调时删除对应的超时检查任务
   */
  async cancelTaskByMessageId(messageId: string): Promise<number> {
    try {
      const result = await this.agenda.cancel({
        'data.messageId': messageId
      });
      
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 根据 platformId 和任务类型删除任务
   */
  async cancelTasksByPlatformIdAndType(
    platformId: string, 
    taskType?: string
  ): Promise<number> {
    try {
      const query: any = { 'data.platformId': platformId };
      
      if (taskType) {
        query.name = new RegExp(`^${taskType}_`);
      }
      
      const result = await this.agenda.cancel(query);
      
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 批量取消超时检查任务
   * 用于批量清理已完成消息的超时检查任务
   */
  async cancelTimeoutCheckTasks(messageIds: string[]): Promise<number> {
    try {
      const result = await this.agenda.cancel({
        name: 'timeout_check',
        'data.messageId': { $in: messageIds }
      });
      
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取任务 - 与 BullMQ API 保持一致
   * @param jobId 任务ID
   * @returns 任务信息
   */
  async getJob(jobId: string): Promise<any | null> {
    const jobs = await this.agenda.jobs({
      'data.jobId': jobId
    });
    
    if (jobs.length === 0) {
      return null;
    }
    
    const job = jobs[0];
    return {
      id: jobId,
      name: job.attrs.name,
      data: job.attrs.data,
      opts: {
        priority: job.attrs.priority,
      },
      nextRunAt: job.attrs.nextRunAt,
      lastRunAt: job.attrs.lastRunAt,
      lockedAt: job.attrs.lockedAt,
      failedAt: job.attrs.failedAt,
      finishedAt: job.attrs.lastFinishedAt,
    };
  }

  /**
   * 获取任务列表
   * @param query 查询条件
   * @returns 任务列表
   */
  async getJobs(query: any = {}): Promise<any[]> {
    const jobs = await this.agenda.jobs(query);
    
    return jobs.map(job => {
      const data = job.attrs.data as any;
      return {
        id: data?.jobId,
        name: job.attrs.name,
        data: job.attrs.data,
        opts: {
          priority: job.attrs.priority,
        },
        nextRunAt: job.attrs.nextRunAt,
        lastRunAt: job.attrs.lastRunAt,
        lockedAt: job.attrs.lockedAt,
        failedAt: job.attrs.failedAt,
        finishedAt: job.attrs.lastFinishedAt,
      };
    });
  }

  /**
   * 清空队列
   * @param type 任务类型（可选）
   * @returns 清除的任务数量
   */
  async clean(type?: string): Promise<number> {
    const query = type ? { name: type } : {};
    const result = await this.agenda.cancel(query);
    return result;
  }

  /**
   * 获取指定 messageId 的任务信息（用于调试）
   */
  async getTaskByMessageId(messageId: string): Promise<any[]> {
    const jobs = await this.agenda.jobs({
      'data.messageId': messageId
    });
    
    return jobs.map(job => ({
      name: job.attrs.name,
      data: job.attrs.data,
      nextRunAt: job.attrs.nextRunAt,
      lastRunAt: job.attrs.lastRunAt,
      lockedAt: job.attrs.lockedAt,
    }));
  }
}
