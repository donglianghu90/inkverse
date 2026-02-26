/** 每本书独立的 Prompt 模板管理服务 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookPromptTemplateEntity, BookPromptTemplates, PromptSection } from './entities/book-prompt-template.entity';
import { buildDefaultTemplates } from './prompting/default-templates';

export interface PromptTemplateView {
  bookId: string;
  playbooks: Record<string, string>;
  agents: Record<string, { agentId: string; sections: PromptSection[] }>;
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

  async getTemplates(bookId: string): Promise<PromptTemplateView> {
    let entity = await this.repo.findOneBy({ bookId });
    if (!entity) { await this.initDefault(bookId); entity = await this.repo.findOneBy({ bookId }); }
    return this.toView(entity!);
  }

  async updatePlaybook(bookId: string, name: string, content: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    if (!(name in entity.templates.playbooks)) throw new BadRequestException(`Playbook "${name}" 不存在`);
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
    section.content = content;
    await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] agent="${agentId}" section="${sectionKey}" 已更新 bookId=${bookId}`);
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
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
