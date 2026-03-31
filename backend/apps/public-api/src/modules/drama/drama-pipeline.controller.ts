/** DramaPipelineController — Pipeline 配置相关路由 */
import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { DramaService } from './drama.service';
import { DramaAgentPipelineService } from './workflow/drama-agent-pipeline.service';
import { DramaAgentNodeConfig, DramaWorkflowParams } from './entities/drama-agent-pipeline.entity';
import { DramaPromptTemplateService } from './prompting/drama-prompt-template.service';

@Controller('drama')
export class DramaPipelineController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly pipelineService: DramaAgentPipelineService,
    private readonly promptTemplateService: DramaPromptTemplateService,
  ) {}

  @Get(':dramaId/pipeline')
  async getPipeline(@Param('dramaId') dramaId: string) {
    return this.pipelineService.getPipeline(dramaId);
  }

  @Put(':dramaId/pipeline/draft')
  async savePipelineDraft(@Param('dramaId') dramaId: string, @Body() body: { nodes: DramaAgentNodeConfig[] }) {
    return this.pipelineService.saveDraft(dramaId, body.nodes);
  }

  @Post(':dramaId/pipeline/publish')
  async publishPipeline(@Param('dramaId') dramaId: string) {
    const result = await this.pipelineService.publish(dramaId);
    // 发布后立即使提示词缓存失效，确保下次生成使用最新的 pipeline 节点配置
    this.promptTemplateService.invalidateCache(dramaId);
    return result;
  }

  @Put(':dramaId/pipeline/params')
  async savePipelineParams(@Param('dramaId') dramaId: string, @Body() params: Partial<DramaWorkflowParams>) {
    return this.pipelineService.saveWorkflowParams(dramaId, params);
  }

  @Get(':dramaId/pipeline/topology')
  async getPipelineTopology(@Param('dramaId') dramaId: string) {
    return this.pipelineService.getTopology(dramaId);
  }

  @Get(':dramaId/pipeline/node-preview/:nodeId')
  async getNodePreview(@Param('dramaId') dramaId: string, @Param('nodeId') nodeId: string) {
    return this.dramaService.buildNodePreview(dramaId, nodeId);
  }
}
