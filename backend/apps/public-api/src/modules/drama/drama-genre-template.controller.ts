/** DramaGenreTemplateController — 题材模板 CRUD + AI 生成 */
import { Controller, Get, Post, Put, Delete, Param, Body, Req } from '@nestjs/common';
import { DramaGenreTemplateService } from './drama-genre-template.service';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto, AiGenerateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';

@Controller('drama/genre-templates')
export class DramaGenreTemplateController {
  constructor(private readonly genreTemplateService: DramaGenreTemplateService) {}

  @Get('list')
  async listGenreTemplates(@Req() req: any) {
    return this.genreTemplateService.list(req.user?.id);
  }

  @Get('analytics')
  async getGenreAnalytics() {
    return this.genreTemplateService.getRecommendedGenres();
  }

  @Post('ai-generate')
  async aiGenerateGenreTemplate(@Body() dto: AiGenerateDramaGenreTemplateDto, @Req() req: any) {
    const result = await this.genreTemplateService.aiGenerate({ ...dto, userId: req.user?.id });
    return this.genreTemplateService.create(req.user?.id ?? 'anonymous', {
      genreKey: dto.genreName.toLowerCase().replace(/\s+/g, '-'),
      displayName: result.displayName,
      description: result.description,
      genreKeywords: result.genreKeywords,
      profileJson: result.profileJson,
      seedHints: result.seedHints as any,
      audienceTags: result.audienceTags,
      protagonistFocusTags: result.protagonistFocusTags,
      toneTags: result.toneTags,
      platformTags: result.platformTags,
    });
  }

  @Get(':id')
  async getGenreTemplate(@Param('id') id: string) {
    return this.genreTemplateService.getById(id);
  }

  @Post()
  async createGenreTemplate(@Body() dto: CreateDramaGenreTemplateDto, @Req() req: any) {
    return this.genreTemplateService.create(req.user?.id ?? 'anonymous', dto);
  }

  @Put(':id')
  async updateGenreTemplate(@Param('id') id: string, @Body() dto: UpdateDramaGenreTemplateDto, @Req() req: any) {
    return this.genreTemplateService.update(id, req.user?.id ?? 'anonymous', dto);
  }

  @Delete(':id')
  async deleteGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.remove(id, req.user?.id ?? 'anonymous');
  }

  @Post(':id/clone')
  async cloneGenreTemplate(@Param('id') id: string, @Req() req: any) {
    return this.genreTemplateService.clone(id, req.user?.id ?? 'anonymous');
  }
}
