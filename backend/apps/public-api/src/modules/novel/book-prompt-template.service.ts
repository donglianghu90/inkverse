/** 每本书独立的 Prompt 模板管理服务 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookPromptTemplateEntity, BookPromptTemplates, PromptSection, PromptEditRecord } from './entities/book-prompt-template.entity';
import { buildDefaultTemplates } from './prompting/default-templates';

const MAX_HISTORY = 20;

export interface PromptTemplateView {
  bookId: string;
  playbooks: Record<string, string>;
  agents: Record<string, { agentId: string; sections: PromptSection[] }>;
  editHistory: PromptEditRecord[];
  updatedAt: string;
}

@Injectable()
export class BookPromptTemplateService {
  private readonly logger = new Logger(BookPromptTemplateService.name);

  constructor(
    @InjectRepository(BookPromptTemplateEntity)
    private readonly repo: Repository<BookPromptTemplateEntity>,
  ) {}

  async initDefault(bookId: string): Promise<void> {
    const existing = await this.repo.findOneBy({ bookId });
    if (existing) return;
    await this.repo.save(this.repo.create({ bookId, templates: buildDefaultTemplates() }));
    this.logger.log(`[PromptTemplate] 默认模板已初始化 bookId=${bookId}`);
  }

  async initWithGenerated(bookId: string, generated: {
    sections: Array<{ agentId: string; key: string; content: string }>;
    playbooks?: Record<string, string>;
  }): Promise<void> {
    const existing = await this.repo.findOneBy({ bookId });
    if (existing) return;
    const tpl = buildDefaultTemplates();
    for (const { agentId, key, content } of generated.sections) {
      const agent = tpl.agents[agentId];
      if (!agent) continue;
      const sec = agent.sections.find((s) => s.key === key);
      if (sec && !sec.isLocked && content?.trim()) sec.content = content;
    }
    if (generated.playbooks) {
      for (const [name, content] of Object.entries(generated.playbooks)) {
        if (name in tpl.playbooks && content?.trim()) tpl.playbooks[name] = content;
      }
    }
    await this.repo.save(this.repo.create({ bookId, templates: tpl }));
    const pbCount = generated.playbooks ? Object.keys(generated.playbooks).length : 0;
    this.logger.log(`[PromptTemplate] 题材定制模板已初始化 bookId=${bookId} | sections=${generated.sections.length} playbooks=${pbCount}`);
  }

  async getTemplates(bookId: string): Promise<PromptTemplateView> {
    let entity = await this.repo.findOneBy({ bookId });
    if (!entity) { await this.initDefault(bookId); entity = await this.repo.findOneBy({ bookId }); }
    return this.toView(entity!);
  }

  async updatePlaybook(bookId: string, name: string, content: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    if (!(name in entity.templates.playbooks)) throw new BadRequestException(`Playbook "${name}" 不存在`);
    this.pushHistory(entity.templates, name, name, entity.templates.playbooks[name]);
    entity.templates.playbooks[name] = content;
    await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] playbook "${name}" 已更新 bookId=${bookId}`);
    return this.toView(entity);
  }

  async updateAgentSection(bookId: string, agentId: string, sectionKey: string, content: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    const agent = entity.templates.agents[agentId];
    if (!agent) throw new BadRequestException(`Agent "${agentId}" 不存在`);
    const section = agent.sections.find((s) => s.key === sectionKey);
    if (!section) throw new BadRequestException(`Section "${sectionKey}" 不存在`);
    if (section.isLocked) throw new BadRequestException(`Section "${sectionKey}" 已锁定，不可编辑`);
    this.pushHistory(entity.templates, `agent:${agentId}:${sectionKey}`, section.label, section.content);
    section.content = content;
    await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] agent="${agentId}" section="${sectionKey}" 已更新 bookId=${bookId}`);
    return this.toView(entity);
  }

  /** 回滚指定历史记录：将 target 的内容恢复为 oldContent */
  async revertEdit(bookId: string, historyIndex: number): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    const history = entity.templates.editHistory ?? [];
    if (historyIndex < 0 || historyIndex >= history.length) throw new BadRequestException('历史记录索引越界');
    const record = history[historyIndex];
    if (record.target.startsWith('agent:')) {
      const [, agentId, sectionKey] = record.target.split(':');
      const agent = entity.templates.agents[agentId];
      const section = agent?.sections.find((s) => s.key === sectionKey);
      if (!section) throw new BadRequestException(`回滚目标不存在: ${record.target}`);
      this.pushHistory(entity.templates, record.target, record.label, section.content);
      section.content = record.oldContent;
    } else {
      if (!(record.target in entity.templates.playbooks)) throw new BadRequestException(`回滚目标不存在: ${record.target}`);
      this.pushHistory(entity.templates, record.target, record.label, entity.templates.playbooks[record.target]);
      entity.templates.playbooks[record.target] = record.oldContent;
    }
    await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] 已回滚 "${record.target}" bookId=${bookId}`);
    return this.toView(entity);
  }

  async resetToDefaults(bookId: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    entity.templates = buildDefaultTemplates();
    await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] 已重置为默认 bookId=${bookId}`);
    return this.toView(entity);
  }

  async getPlaybook(bookId: string, name: string): Promise<string> {
    const entity = await this.ensureEntity(bookId);
    return entity.templates.playbooks[name] ?? '';
  }

  async getAgentSections(bookId: string, agentId: string): Promise<PromptSection[]> {
    const entity = await this.ensureEntity(bookId);
    return entity.templates.agents[agentId]?.sections ?? [];
  }

  private pushHistory(tpl: BookPromptTemplates, target: string, label: string, oldContent: string): void {
    if (!tpl.editHistory) tpl.editHistory = [];
    tpl.editHistory.unshift({ timestamp: new Date().toISOString(), target, label, oldContent });
    if (tpl.editHistory.length > MAX_HISTORY) tpl.editHistory.length = MAX_HISTORY;
  }

  private async ensureEntity(bookId: string): Promise<BookPromptTemplateEntity> {
    let entity = await this.repo.findOneBy({ bookId });
    if (!entity) { await this.initDefault(bookId); entity = await this.repo.findOneBy({ bookId }); }
    if (!entity) throw new NotFoundException(`BookPromptTemplate not found: ${bookId}`);
    return entity;
  }

  private toView(entity: BookPromptTemplateEntity): PromptTemplateView {
    return {
      bookId: entity.bookId,
      playbooks: entity.templates.playbooks,
      agents: entity.templates.agents,
      editHistory: entity.templates.editHistory ?? [],
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
