/** 全局 Agent 提示词补充设置服务
 *  模式与题材/视觉风格模版相同：
 *  - 系统默认行 userId='system'，应用启动时 seed
 *  - 用户首次访问时从系统行复制到自己的行（ensureUserRows）
 *  - 生产期间从内存缓存读取（O(1)），按 userId 分区
 */
import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DramaGlobalPromptSettingEntity,
  GLOBAL_PROMPT_AGENT_TYPES,
  SYSTEM_USER_ID,
} from './entities/drama-global-prompt-setting.entity';

/** 5 个创建流水线 Agent 的展示说明 */
const AGENT_DESCRIPTIONS: Record<string, string> = {
  'seed-analyzer': '创意分析 — 从用户创意中提取短剧种子与策略方向',
  'series-director': '总导演 — 分段式全剧大纲规划（付费卡点/情绪节奏）',
  'visual-asset-designer': '视觉资产设计 — 角色/场景/视觉风格初始设计',
  'drama-profiler': '编剧手册 — 生成指导所有 Agent 的风格/规则/审核维度',
  'drama-strategy': '策略师 — 制定付费卡点策略、前3集钩子、角色预算',
};

export interface GlobalPromptSettingView {
  agentType: string;
  globalAdditionalPrompt: string;
  description: string;
  updatedAt: string;
}

@Injectable()
export class DramaGlobalPromptSettingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DramaGlobalPromptSettingService.name);

  /** 内存双层缓存：userId → agentType → globalAdditionalPrompt */
  private readonly cache = new Map<string, Map<string, string>>();

  constructor(
    @InjectRepository(DramaGlobalPromptSettingEntity)
    private readonly repo: Repository<DramaGlobalPromptSettingEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedSystemDefaults();
    await this.loadCacheForUser(SYSTEM_USER_ID);
    this.logger.log('Global prompt settings initialised');
  }

  // ─── 系统默认值 seed ───────────────────────────────────────────

  /** 确保系统默认行存在（不覆盖已有数据） */
  private async seedSystemDefaults(): Promise<void> {
    for (const agentType of GLOBAL_PROMPT_AGENT_TYPES) {
      const exists = await this.repo.findOne({ where: { userId: SYSTEM_USER_ID, agentType } });
      if (!exists) {
        await this.repo.save(this.repo.create({
          userId: SYSTEM_USER_ID,
          agentType,
          globalAdditionalPrompt: '',
          description: AGENT_DESCRIPTIONS[agentType] ?? agentType,
        }));
      }
    }
  }

  // ─── 用户行初始化（首次访问时从系统行复制） ─────────────────────

  /** 确保指定用户有完整的 agent 配置行；若缺失则从系统默认复制 */
  async ensureUserRows(userId: string): Promise<void> {
    if (userId === SYSTEM_USER_ID) return;
    for (const agentType of GLOBAL_PROMPT_AGENT_TYPES) {
      const exists = await this.repo.findOne({ where: { userId, agentType } });
      if (!exists) {
        const systemRow = await this.repo.findOne({ where: { userId: SYSTEM_USER_ID, agentType } });
        await this.repo.save(this.repo.create({
          userId,
          agentType,
          globalAdditionalPrompt: systemRow?.globalAdditionalPrompt ?? '',
          description: systemRow?.description ?? AGENT_DESCRIPTIONS[agentType] ?? agentType,
        }));
      }
    }
    // 加载到内存缓存
    await this.loadCacheForUser(userId);
  }

  // ─── 内存缓存 ─────────────────────────────────────────────────

  private async loadCacheForUser(userId: string): Promise<void> {
    const rows = await this.repo.find({ where: { userId } });
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.agentType, row.globalAdditionalPrompt);
    }
    this.cache.set(userId, map);
  }

  /** O(1) 读取，生成期间调用；优先取用户配置，fallback 到系统默认 */
  getGlobalAdditional(userId: string, agentType: string): string {
    return (
      this.cache.get(userId)?.get(agentType)
      ?? this.cache.get(SYSTEM_USER_ID)?.get(agentType)
      ?? ''
    );
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  /** 列出某用户的所有设置（首先确保用户行存在） */
  async listAll(userId: string): Promise<GlobalPromptSettingView[]> {
    await this.ensureUserRows(userId);
    const rows = await this.repo.find({ where: { userId }, order: { agentType: 'ASC' } });
    return rows.map(this.toView);
  }

  /** 更新用户的某 agent 设置 */
  async update(userId: string, agentType: string, globalAdditionalPrompt: string): Promise<GlobalPromptSettingView> {
    let row = await this.repo.findOne({ where: { userId, agentType } });
    if (!row) {
      const systemRow = await this.repo.findOne({ where: { userId: SYSTEM_USER_ID, agentType } });
      row = this.repo.create({
        userId,
        agentType,
        globalAdditionalPrompt,
        description: systemRow?.description ?? AGENT_DESCRIPTIONS[agentType] ?? agentType,
      });
    } else {
      row.globalAdditionalPrompt = globalAdditionalPrompt;
    }
    const saved = await this.repo.save(row);
    // 更新内存缓存
    if (!this.cache.has(userId)) this.cache.set(userId, new Map());
    this.cache.get(userId)!.set(agentType, globalAdditionalPrompt);
    return this.toView(saved);
  }

  /** 批量更新 */
  async batchUpdate(userId: string, items: Array<{ agentType: string; globalAdditionalPrompt: string }>): Promise<GlobalPromptSettingView[]> {
    const results: GlobalPromptSettingView[] = [];
    for (const item of items) {
      results.push(await this.update(userId, item.agentType, item.globalAdditionalPrompt));
    }
    return results;
  }

  /** 重置用户某行为系统默认 */
  async resetToSystem(userId: string, agentType: string): Promise<GlobalPromptSettingView> {
    const systemRow = await this.repo.findOne({ where: { userId: SYSTEM_USER_ID, agentType } });
    return this.update(userId, agentType, systemRow?.globalAdditionalPrompt ?? '');
  }

  private toView(row: DramaGlobalPromptSettingEntity): GlobalPromptSettingView {
    return {
      agentType: row.agentType,
      globalAdditionalPrompt: row.globalAdditionalPrompt,
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
