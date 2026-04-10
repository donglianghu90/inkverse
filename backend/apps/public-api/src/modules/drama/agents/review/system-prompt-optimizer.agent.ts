import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../../llm/llm.service';
import { z } from 'zod';
import { DRAMA_AGENT_REGISTRY } from '../drama-agent.registry';

const proposalOutputSchema = z.object({
  targetConfigArea: z.enum(['genreRules', 'visualStyleGuide', 'cameraStyleGuide', 'audioStyleGuide', 'agentSystemPrompts', 'profilerGuide', 'adaptationNotes']),
  suggestedRule: z.string().describe('具体的、可以直接追加到对应配置中的约束规则文本，务必精炼硬核'),
  rootCause: z.string().describe('详细分析导致此次生成故障或低分缺陷的根本原因'),
});

@Injectable()
export class SystemPromptOptimizerAgent {
  private readonly logger = new Logger(SystemPromptOptimizerAgent.name);

  constructor(private readonly llm: LlmService) {}

  async generateProposal(
    targetAgentKey: string,
    failureDetails: string,
    stateContext: any,
  ): Promise<z.infer<typeof proposalOutputSchema> | null> {
    try {
      const prompt = `你是剧集提示词进化引擎。
目标 Agent：${targetAgentKey}
近期发生了严重的生成故障或低分缺陷，详情如下：
${failureDetails}

当前的上下文状态概要：
${JSON.stringify(stateContext, null, 2)}

请生成一条防御性补丁规则（suggestedRule），它在被追加到该剧/题材的 System Prompt 相应区域后，能够针对性地解决以上根本原因，强力规避下次再犯。`;

      const raw = await this.llm.generateStructured({
        taskName: DRAMA_AGENT_REGISTRY.SYSTEM_PROMPT_OPTIMIZER.key,
        schema: proposalOutputSchema,
        systemPrompt: '你是一个顶级的全栈 AI 与提示词自进化系统。你的目标是根据 Bad Cases 生成精准的打补丁规则。务必遵守 Prompt Engineering 原则，不要生成过长的废话，规则必须极其强硬、不可打破。',
        userPrompt: prompt,
        temperature: 0.3,
      });

      return proposalOutputSchema.parse(raw);
    } catch (e) {
      this.logger.error(`Failed to generate prompt optimization proposal: ${(e as Error).message}`);
      return null;
    }
  }
}
