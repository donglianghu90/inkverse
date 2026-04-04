import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DramaGenreTemplateEntity } from './entities/drama-genre-template.entity';
import { DramaVisualStyleTemplateEntity } from './entities/drama-visual-style-template.entity';
import { DramaEntity } from '../drama/entities/drama.entity';
import { LlmModule } from '../novel/llm/llm.module';
import { DramaGenreTemplateController } from './genre/drama-genre-template.controller';
import { DramaGenreTemplateService } from './genre/drama-genre-template.service';
import { DramaVisualStyleTemplateController } from './visual-style/drama-visual-style-template.controller';
import { DramaVisualStyleTemplateService } from './visual-style/drama-visual-style-template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DramaGenreTemplateEntity,
      DramaVisualStyleTemplateEntity,
      DramaEntity,
    ]),
    LlmModule,
  ],
  controllers: [
    DramaGenreTemplateController,
    DramaVisualStyleTemplateController,
  ],
  providers: [
    DramaGenreTemplateService,
    DramaVisualStyleTemplateService,
  ],
  exports: [
    DramaGenreTemplateService,
    DramaVisualStyleTemplateService,
  ],
})
export class TemplateModule {}
