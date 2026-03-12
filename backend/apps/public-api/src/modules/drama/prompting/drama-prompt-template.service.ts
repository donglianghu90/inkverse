/** Drama Prompt 模板服务 — 包装 Playbook 函数，叠加 Pipeline 的 additionalSystemPrompt */
import { Injectable } from '@nestjs/common';
import { DramaAgentPipelineService } from '../workflow/drama-agent-pipeline.service';

@Injectable()
export class DramaPromptTemplateService {
  constructor(private readonly pipelineService: DramaAgentPipelineService) {}

  async getAdditionalPrompt(dramaId: string, nodeId: string): Promise<string> { // 获取某 Agent 节点的 additionalSystemPrompt
    const nodes = await this.pipelineService.getPublishedNodes(dramaId);
    const node = nodes.find(n => n.id === nodeId);
    return node?.additionalSystemPrompt ?? '';
  }

  async buildPrompt(dramaId: string, nodeId: string, basePrompt: string): Promise<string> { // 组合 playbook 基础 prompt + pipeline 自定义追加
    const additional = await this.getAdditionalPrompt(dramaId, nodeId);
    return additional ? `${basePrompt}\n\n=== 额外指令 ===\n${additional}` : basePrompt;
  }
}
