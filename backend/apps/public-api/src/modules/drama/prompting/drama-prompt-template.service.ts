/** Drama Prompt 模板服务 — 包装 Playbook 函数，叠加 Pipeline 的 basePromptSnapshot / additionalSystemPrompt
 *
 *  提示词层级（从上到下）：
 *   1. base = node.basePromptSnapshot（用户固化编辑版）|| codeGeneratedBasePrompt（代码自动生成）
 *   2. 本剧专属补充指令（node.additionalSystemPrompt）
 *      └── 创建短剧时从用户的「全局 AI 指令」初始化，之后可在「创作工坊」中按剧修改
 */
import { Injectable } from '@nestjs/common';
import type { DramaAgentNodeConfig } from '../interfaces';
import { DramaAgentPipelineService } from '../workflow/drama-agent-pipeline.service';

const CACHE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class DramaPromptTemplateService {
  private readonly nodeCache = new Map<string, { nodes: DramaAgentNodeConfig[]; expiresAt: number }>();

  constructor(private readonly pipelineService: DramaAgentPipelineService) {}

  private async getCachedNodes(dramaId: string): Promise<DramaAgentNodeConfig[]> {
    const hit = this.nodeCache.get(dramaId);
    if (hit && Date.now() < hit.expiresAt) return hit.nodes;
    const nodes = await this.pipelineService.getPublishedNodes(dramaId);
    this.nodeCache.set(dramaId, { nodes, expiresAt: Date.now() + CACHE_TTL_MS });
    return nodes;
  }

  invalidateCache(dramaId: string): void {
    this.nodeCache.delete(dramaId);
  }

  async getAdditionalPrompt(dramaId: string, nodeId: string): Promise<string> {
    const nodes = await this.getCachedNodes(dramaId);
    const node = nodes.find(n => n.id === nodeId);
    return node?.additionalSystemPrompt ?? '';
  }

  /**
   * 组装最终系统提示词：
   *   1. base  = node.basePromptSnapshot（用户编辑版）|| codeGeneratedBasePrompt（代码回退）
   *   2. dynamic = 集/场景级动态上下文（如 emotionBeats、scenePurpose 约束，可选）
   *   3. additional = 本剧专属补充指令（node.additionalSystemPrompt）
   */
  async buildPrompt(
    dramaId: string,
    nodeId: string,
    codeGeneratedBasePrompt: string,
    dynamicSection?: string,
  ): Promise<string> {
    const nodes = await this.getCachedNodes(dramaId);
    const node = nodes.find(n => n.id === nodeId);

    const base = node?.basePromptSnapshot?.trim() || codeGeneratedBasePrompt;
    const dramaAdditional = node?.additionalSystemPrompt?.trim() ?? '';

    const parts = [base];
    if (dynamicSection?.trim()) parts.push(dynamicSection.trim());
    if (dramaAdditional) parts.push(`=== 本剧补充指令 ===\n${dramaAdditional}`);

    return parts.join('\n\n');
  }
}
