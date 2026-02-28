/** 题材 Profile 模板 CRUD + AI 生成 DTO */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class SeedAnalyzerHintsDto {
  @ApiPropertyOptional({ description: '题材核心循环模式', example: ['探索式：发现→假设→验证→更深谜团'] })
  @IsArray() @IsString({ each: true }) @IsOptional()
  coreLoopPatterns?: string[];

  @ApiPropertyOptional({ description: '金手指设计指引' })
  @IsString() @IsOptional()
  goldenFingerGuidance?: string;

  @ApiPropertyOptional({ description: '世界观构建方向' })
  @IsString() @IsOptional()
  worldBuildingDirectives?: string;
}

export class CreateGenreProfileTemplateDto {
  @ApiProperty({ description: '题材标识键', example: 'sci-fi' })
  @IsString() @IsNotEmpty() @MaxLength(100)
  genreKey!: string;

  @ApiProperty({ description: '显示名称', example: '硬科幻·刘慈欣风格' })
  @IsString() @IsNotEmpty() @MaxLength(200)
  displayName!: string;

  @ApiPropertyOptional({ description: '一句话说明', example: '注重物理定律自洽的宏大叙事科幻' })
  @IsString() @IsOptional() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: '自动匹配关键词', example: ['科幻', 'sci-fi', '星际'] })
  @IsArray() @IsString({ each: true }) @IsOptional()
  genreKeywords?: string[];

  @ApiProperty({ description: '完整的 BookPromptProfile JSON' })
  @IsObject() @IsNotEmpty()
  profileJson!: Record<string, unknown>;

  @ApiPropertyOptional({ description: '给 SeedAnalyzer 的题材提示' })
  @ValidateNested() @Type(() => SeedAnalyzerHintsDto) @IsOptional()
  seedHints?: SeedAnalyzerHintsDto;

  @ApiPropertyOptional({ description: '结构化规则原子列表' })
  @IsArray() @IsOptional()
  ruleAtoms?: any[];

  @ApiPropertyOptional({ description: '预生成的 Agent 指令缓存' })
  @IsObject() @IsOptional()
  cachedAgentSections?: { sections: Array<{ agentId: string; key: string; content: string }>; ruleAtoms?: any[] };
}

export class UpdateGenreProfileTemplateDto {
  @ApiPropertyOptional() @IsString() @MaxLength(200) @IsOptional()
  displayName?: string;

  @ApiPropertyOptional() @IsString() @MaxLength(500) @IsOptional()
  description?: string;

  @ApiPropertyOptional() @IsArray() @IsString({ each: true }) @IsOptional()
  genreKeywords?: string[];

  @ApiPropertyOptional() @IsObject() @IsOptional()
  profileJson?: Record<string, unknown>;

  @ApiPropertyOptional() @ValidateNested() @Type(() => SeedAnalyzerHintsDto) @IsOptional()
  seedHints?: SeedAnalyzerHintsDto;

  @ApiPropertyOptional({ description: '结构化规则原子列表' })
  @IsArray() @IsOptional()
  ruleAtoms?: any[];

  @ApiPropertyOptional({ description: '预生成的 Agent 指令缓存' })
  @IsObject() @IsOptional()
  cachedAgentSections?: { sections: Array<{ agentId: string; key: string; content: string }>; ruleAtoms?: any[] };
}

export class AiGenerateProfileDto {
  @ApiProperty({ description: '题材名称', example: '硬科幻' })
  @IsString() @IsNotEmpty()
  genreName!: string;

  @ApiPropertyOptional({ description: '自由文字描述风格/特点', example: '刘慈欣风格，注重物理定律内自洽，宏大叙事' })
  @IsString() @IsOptional()
  styleDescription?: string;

  @ApiPropertyOptional({ description: '参考作品', example: ['三体', '基地系列'] })
  @IsArray() @IsString({ each: true }) @IsOptional()
  referenceWorks?: string[];

  @ApiPropertyOptional({ description: '目标读者', example: '18-35岁科幻爱好者' })
  @IsString() @IsOptional()
  targetAudience?: string;

  @ApiPropertyOptional({ description: '基于某个已有模板生成（作为种子参考）' })
  @IsUUID() @IsOptional()
  baseTemplateId?: string;
}
