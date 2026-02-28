/** 规则引擎编译器 — 将 RuleAtom[] 按上下文动态编译为各 Agent 的指令文本 */
import { Injectable } from '@nestjs/common';
import { RuleAtom, RuleCondition, CompileContext } from './schemas/rule-engine.schemas';

@Injectable()
export class RuleCompilerService {
  compile(atoms: RuleAtom[], context: CompileContext): Record<string, string> {
    const matched = atoms
      .filter((a) => a.isEnabled && a.targetAgents.includes(context.agentId) && this.matchAll(a.conditions, context))
      .sort((a, b) => b.priority - a.priority);
    const groups = new Map<string, string[]>();
    for (const atom of matched) {
      const list = groups.get(atom.outputKey) ?? [];
      list.push(atom.title ? `【${atom.title}】\n${atom.content}` : atom.content);
      groups.set(atom.outputKey, list);
    }
    const result: Record<string, string> = {};
    for (const [key, parts] of groups) result[key] = parts.join('\n\n');
    return result;
  }

  compileAll(atoms: RuleAtom[], baseCtx: Omit<CompileContext, 'agentId'>, agentIds: string[]): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const agentId of agentIds) {
      const compiled = this.compile(atoms, { ...baseCtx, agentId });
      for (const [key, text] of Object.entries(compiled)) {
        merged[key] = merged[key] ? `${merged[key]}\n\n${text}` : text; // 多 agent 共享同一 key 时合并
      }
    }
    return merged;
  }

  private matchAll(conditions: RuleCondition[] | undefined, ctx: CompileContext): boolean {
    if (!conditions?.length) return true;
    return conditions.every((c) => this.matchOne(c, ctx));
  }

  private matchOne(cond: RuleCondition, ctx: CompileContext): boolean {
    const val = (ctx as Record<string, unknown>)[cond.field];
    if (val === undefined || val === null) return false;
    switch (cond.op) {
      case 'eq': return val === cond.value;
      case 'in': return Array.isArray(cond.value) && cond.value.includes(val as string);
      case 'gt': return typeof val === 'number' && val > (cond.value as number);
      case 'lt': return typeof val === 'number' && val < (cond.value as number);
      case 'gte': return typeof val === 'number' && val >= (cond.value as number);
      case 'lte': return typeof val === 'number' && val <= (cond.value as number);
      default: return false;
    }
  }
}
