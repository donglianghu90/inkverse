/** DramaGlobalSettingsController — 全局 Agent 提示词设置 */
import { Controller, Get, Put, Param, Body, Req } from '@nestjs/common';
import { DramaService } from './drama.service';
import { DramaGlobalPromptSettingService } from './drama-global-prompt-setting.service';

@Controller('drama')
export class DramaGlobalSettingsController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly globalPromptSettingService: DramaGlobalPromptSettingService,
  ) {}

  private getUserId(req: any, fallback = ''): string {
    return req?.user?.id ?? req?.user?.userId ?? fallback;
  }

  /** 返回指定节点的系统默认基础提示词（无短剧上下文，用于全局设置页预览） */
  @Get('global-prompt-preview/:nodeId')
  async getGlobalNodePreview(@Param('nodeId') nodeId: string) {
    return this.dramaService.buildGlobalNodePreview(nodeId);
  }

  @Get('global-prompt-settings')
  async listGlobalPromptSettings(@Req() req: any) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.listAll(userId);
  }

  @Put('global-prompt-settings/:agentType')
  async updateGlobalPromptSetting(
    @Param('agentType') agentType: string,
    @Body() body: { globalAdditionalPrompt: string },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.update(userId, agentType, body.globalAdditionalPrompt ?? '');
  }

  @Put('global-prompt-settings')
  async batchUpdateGlobalPromptSettings(
    @Body() body: { items: Array<{ agentType: string; globalAdditionalPrompt: string }> },
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.batchUpdate(userId, body.items ?? []);
  }

  @Put('global-prompt-settings/:agentType/reset')
  async resetGlobalPromptSetting(
    @Param('agentType') agentType: string,
    @Req() req: any,
  ) {
    const userId = this.getUserId(req, 'system');
    return this.globalPromptSettingService.resetToSystem(userId, agentType);
  }
}
