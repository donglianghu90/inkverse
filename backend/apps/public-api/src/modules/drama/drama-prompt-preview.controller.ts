/** DramaPromptPreviewController — 生成各个 Agent 节点的预览提示词 */
import { Controller, Get, Param } from '@nestjs/common';
import { DramaService } from './drama.service';

@Controller('drama')
export class DramaPromptPreviewController {
  constructor(
    private readonly dramaService: DramaService,
  ) {}

  /** 返回指定节点的系统默认基础提示词（无短剧上下文，用于全局设置页预览） */
  @Get('global-prompt-preview/:nodeId')
  async getGlobalNodePreview(@Param('nodeId') nodeId: string) {
    return this.dramaService.buildGlobalNodePreview(nodeId);
  }
}
