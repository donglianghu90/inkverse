/** 每本书独立的 Prompt 模板管理服务 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookPromptTemplateEntity, BookPromptTemplates, PromptSection, PromptEditRecord } from './entities/book-prompt-template.entity';
import { buildDefaultRulePack } from './prompting/default-templates';
import { DEFAULT_SYSTEM_ATOMS } from './prompting/default-rule-atoms';
import type { RuleAtom } from './schemas/rule-engine.schemas';

const MAX_HISTORY = 20;
const MANDATORY_SYSTEM_OUTPUT_KEYS = new Set([
  'CHAPTER_TYPE_WRITING_PLAYBOOK',
  'CHAPTER_TYPE_SCENE_PLAN_PLAYBOOK',
  'CHAPTER_TYPE_SCENE_PURPOSE_PLAYBOOK',
  'CHAPTER_TYPE_INTENT_PLAYBOOK',
  'CHAPTER_TYPE_REVIEWER_PLAYBOOK',
]);

export interface PromptTemplateView {
  bookId: string;
  ruleAtoms: RuleAtom[];
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

  async initDefault(bookId: string, genreAtoms?: RuleAtom[]): Promise<void> {
    const existing = await this.repo.findOneBy({ bookId });
    if (existing) return;
    await this.repo.save(this.repo.create({ bookId, templates: buildDefaultRulePack(genreAtoms) }));
    this.logger.log(`[PromptTemplate] 默认模板已初始化 bookId=${bookId}`);
  }

  async initWithGenerated(bookId: string, generated: {
    sections: Array<{ agentId: string; key: string; content: string }>;
    ruleAtoms?: RuleAtom[];
  }, genreAtoms?: RuleAtom[]): Promise<void> {
    const existing = await this.repo.findOneBy({ bookId });
    const tpl = existing?.templates ?? buildDefaultRulePack(genreAtoms);
    for (const { agentId, key, content } of generated.sections) {
      const agent = tpl.agents[agentId];
      if (!agent) continue;
      const sec = agent.sections.find((s) => s.key === key);
      if (sec && !sec.isLocked && content?.trim()) sec.content = content;
    }
    if (generated.ruleAtoms?.length) {
      const map = new Map(tpl.ruleAtoms.map((a) => [a.id, a]));
      for (const atom of generated.ruleAtoms) map.set(atom.id, atom);
      tpl.ruleAtoms = [...map.values()];
    }
    await this.repo.save(existing ? { ...existing, templates: tpl } : this.repo.create({ bookId, templates: tpl }));
    this.logger.log(`[PromptTemplate] 题材定制模板已应用 bookId=${bookId} | sections=${generated.sections.length} ruleAtoms=${tpl.ruleAtoms.length} | mode=${existing ? 'merge' : 'init'}`);
  }

  async getTemplates(bookId: string): Promise<PromptTemplateView> {
    let entity = await this.repo.findOneBy({ bookId });
    if (!entity) { await this.initDefault(bookId); entity = await this.repo.findOneBy({ bookId }); }
    entity = await this.ensureSystemAtoms(entity!);
    return this.toView(entity!);
  }

  // ── RuleAtom CRUD ──
  async getRuleAtoms(bookId: string): Promise<RuleAtom[]> {
    const entity = await this.ensureEntity(bookId);
    return entity.templates.ruleAtoms ?? [];
  }

  async updateRuleAtom(bookId: string, atomId: string, patch: Partial<RuleAtom>): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    const idx = entity.templates.ruleAtoms.findIndex((a) => a.id === atomId);
    if (idx < 0) throw new BadRequestException(`RuleAtom "${atomId}" 不存在`);
    const old = entity.templates.ruleAtoms[idx];
    this.pushHistory(entity.templates, atomId, old.title, old.content);
    entity.templates.ruleAtoms[idx] = { ...old, ...patch, id: atomId };
    await this.repo.save(entity);
    return this.toView(entity);
  }

  async addRuleAtom(bookId: string, atom: RuleAtom): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    entity.templates.ruleAtoms.push(atom);
    await this.repo.save(entity);
    return this.toView(entity);
  }

  async removeRuleAtom(bookId: string, atomId: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    const idx = entity.templates.ruleAtoms.findIndex((a) => a.id === atomId);
    if (idx < 0) throw new BadRequestException(`RuleAtom "${atomId}" 不存在`);
    entity.templates.ruleAtoms.splice(idx, 1);
    await this.repo.save(entity);
    return this.toView(entity);
  }

  async toggleRuleAtom(bookId: string, atomId: string, isEnabled: boolean): Promise<PromptTemplateView> {
    return this.updateRuleAtom(bookId, atomId, { isEnabled });
  }

  // ── Agent Section CRUD（保留兼容） ──
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
    return this.toView(entity);
  }

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
      const atom = entity.templates.ruleAtoms.find((a) => a.id === record.target);
      if (!atom) throw new BadRequestException(`回滚目标不存在: ${record.target}`);
      this.pushHistory(entity.templates, record.target, record.label, atom.content);
      atom.content = record.oldContent;
    }
    await this.repo.save(entity);
    return this.toView(entity);
  }

  async resetToDefaults(bookId: string): Promise<PromptTemplateView> {
    const entity = await this.ensureEntity(bookId);
    entity.templates = buildDefaultRulePack();
    await this.repo.save(entity);
    return this.toView(entity);
  }

  async getAgentSections(bookId: string, agentId: string): Promise<PromptSection[]> {
    const entity = await this.ensureEntity(bookId);
    return entity.templates.agents[agentId]?.sections ?? [];
  }

  /** 数据迁移：将现有 book 的 playbooks 文本转为 ruleAtoms */
  async migratePlaybooksToRuleAtoms(): Promise<{ migrated: number; skipped: number }> {
    const { parsePlaybookTextToAtoms } = await import('./prompting/default-rule-atoms');
    const { CATEGORY_TO_OUTPUT_KEY } = await import('./schemas/rule-engine.schemas');
    const OUTPUT_KEY_TO_CAT = Object.fromEntries(Object.entries(CATEGORY_TO_OUTPUT_KEY).map(([c, k]) => [k, c]));
    const AGENT_MAP: Record<string, string[]> = {
      PROSE_CRAFT_PLAYBOOK: ['creative-writer', 'scene-stitcher', 'reviewer', 'editor'],
      WRITING_SOUL_PLAYBOOK: ['creative-writer'], CHARACTER_ARC_PLAYBOOK: ['creative-writer', 'reviewer'],
      EDITOR_DISCIPLINE_PLAYBOOK: ['editor'], REVIEWER_RUBRIC_PLAYBOOK: ['reviewer'],
      CONTINUITY_BASELINE_PLAYBOOK: ['reviewer', 'editor'],
      THREAD_AWARENESS_PLAYBOOK: ['creative-writer', 'intent', 'scene-planner'],
    };
    const all = await this.repo.find();
    let migrated = 0, skipped = 0;
    for (const entity of all) {
      if (entity.templates.ruleAtoms?.length) { skipped++; continue; }
      const old = (entity.templates as any).playbooks as Record<string, string> | undefined;
      if (!old || !Object.keys(old).length) { skipped++; continue; }
      const atoms: RuleAtom[] = [];
      for (const [key, text] of Object.entries(old)) {
        const cat = OUTPUT_KEY_TO_CAT[key] as any;
        if (!cat || !text?.trim()) continue;
        atoms.push(...parsePlaybookTextToAtoms(text, cat, key, AGENT_MAP[key] ?? ['creative-writer'], 'genre'));
      }
      entity.templates.ruleAtoms = atoms;
      await this.repo.save(entity);
      migrated++;
      this.logger.log(`[migrate] 书籍 ${entity.bookId} 已迁移 ${atoms.length} 条 RuleAtom`);
    }
    return { migrated, skipped };
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
    return this.ensureSystemAtoms(entity);
  }

  private async ensureSystemAtoms(entity: BookPromptTemplateEntity): Promise<BookPromptTemplateEntity> {
    const current = entity.templates.ruleAtoms ?? [];
    const existingIds = new Set(current.map((a) => a.id));
    const mandatoryAtoms = DEFAULT_SYSTEM_ATOMS.filter((a) => MANDATORY_SYSTEM_OUTPUT_KEYS.has(a.outputKey));
    const missing = mandatoryAtoms.filter((a) => !existingIds.has(a.id));
    if (missing.length <= 0) return entity;
    entity.templates.ruleAtoms = [...current, ...missing];
    const saved = await this.repo.save(entity);
    this.logger.log(`[PromptTemplate] 回填缺失系统规则 ${missing.length} 条 bookId=${entity.bookId}`);
    return saved;
  }

  private toView(entity: BookPromptTemplateEntity): PromptTemplateView {
    return {
      bookId: entity.bookId,
      ruleAtoms: entity.templates.ruleAtoms ?? [],
      agents: entity.templates.agents,
      editHistory: entity.templates.editHistory ?? [],
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
