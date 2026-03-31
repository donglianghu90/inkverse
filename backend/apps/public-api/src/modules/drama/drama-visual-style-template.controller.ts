/** DramaVisualStyleTemplateController — 视觉风格模板 CRUD */
import { Controller, Get, Post, Put, Delete, Param, Body, Req } from '@nestjs/common';
import { DramaVisualStyleTemplateService } from './drama-visual-style-template.service';
import { CreateDramaVisualStyleTemplateDto, UpdateDramaVisualStyleTemplateDto } from './dto/drama-visual-style-template.dto';

@Controller('drama/visual-style-templates')
export class DramaVisualStyleTemplateController {
  constructor(private readonly visualStyleTemplateService: DramaVisualStyleTemplateService) {}

  @Get('list')
  async listVisualStyleTemplates(@Req() req: any) {
    return this.visualStyleTemplateService.list(req.user?.id);
  }

  @Get(':id')
  async getVisualStyleTemplate(@Param('id') id: string) {
    return this.visualStyleTemplateService.getById(id);
  }

  @Post()
  async createVisualStyleTemplate(@Body() dto: CreateDramaVisualStyleTemplateDto, @Req() req: any) {
    return this.visualStyleTemplateService.create(req.user?.id ?? 'anonymous', dto);
  }

  @Put(':id')
  async updateVisualStyleTemplate(@Param('id') id: string, @Body() dto: UpdateDramaVisualStyleTemplateDto, @Req() req: any) {
    return this.visualStyleTemplateService.update(id, req.user?.id ?? 'anonymous', dto);
  }

  @Delete(':id')
  async deleteVisualStyleTemplate(@Param('id') id: string, @Req() req: any) {
    return this.visualStyleTemplateService.remove(id, req.user?.id ?? 'anonymous');
  }

  @Post(':id/clone')
  async cloneVisualStyleTemplate(@Param('id') id: string, @Req() req: any) {
    return this.visualStyleTemplateService.clone(id, req.user?.id ?? 'anonymous');
  }
}
