/** DramaController — 短剧基础 CRUD + 视觉风格更新 */
import { Controller, Post, Get, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { DramaService } from './drama.service';
import { CreateDramaDto } from './dto/create-drama.dto';
import { UsageLedgerService } from '../usage/usage-ledger.service';
import { getDramaSystemAgents } from './agents/drama-agent.registry';

@Controller('drama')
export class DramaController {
  constructor(
    private readonly dramaService: DramaService,
    private readonly usageLedger: UsageLedgerService,
  ) { }

  @Post()
  async createDrama(@Body() dto: CreateDramaDto, @Req() req: any) {
    return this.dramaService.createDrama(dto, { userId: req.user?.id });
  }

  @Get()
  async listDramas(@Req() req: any) {
    return this.dramaService.listDramas(req.user?.id);
  }


  @Get('system/agents')
  getSystemAgents() {
    return getDramaSystemAgents();
  }

  @Get(':dramaId')
  async getDrama(@Param('dramaId') dramaId: string) {
    return this.dramaService.getDrama(dramaId);
  }

  @Delete(':dramaId')
  async deleteDrama(@Param('dramaId') dramaId: string, @Req() req: any) {
    return this.dramaService.deleteDrama(dramaId, req.user?.id);
  }

  @Patch(':dramaId/visual-style')
  async updateVisualStyle(
    @Param('dramaId') dramaId: string,
    @Body() body: { visualStyle: Record<string, unknown> },
    @Req() req: any,
  ) {
    return this.dramaService.updateVisualStyle(dramaId, body.visualStyle, req.user?.id);
  }

  @Get(':dramaId/usage')
  async getDramaUsage(@Param('dramaId') dramaId: string, @Req() req: any) {
    const userId = req.user?.id ?? '';
    await this.dramaService.assertDramaOwnership(dramaId, userId);
    return this.usageLedger.resourceDetailForDrama('drama', dramaId);
  }


}
