/** DramaIdeaController — 创意辅助（增强、推荐题材/受众、生成故事目标） */
import { Controller, Post, Body, Req } from '@nestjs/common';
import { DramaIdeaService } from './drama-idea.service';

@Controller('drama/idea')
export class DramaIdeaController {
  constructor(private readonly ideaService: DramaIdeaService) {}

  @Post('enhance')
  async enhanceIdea(@Body() body: { idea: string; genre?: string }, @Req() req: any) {
    return this.ideaService.enhanceIdea(body.idea, body.genre, req.user?.id);
  }

  @Post('generate-goal')
  async generateGoal(@Body() body: { mainIdea: string; genre: string; targetAudience: string }, @Req() req: any) {
    return this.ideaService.generateStoryGoal(body, req.user?.id);
  }

  @Post('recommend-genre-audience')
  async recommendGenreAndAudience(@Body() body: { mainIdea: string }, @Req() req: any) {
    return this.ideaService.recommendGenreAndAudience(body.mainIdea, req.user?.id);
  }
}
