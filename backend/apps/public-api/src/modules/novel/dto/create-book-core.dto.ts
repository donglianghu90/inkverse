/** 创建小说的核心创意输入（不含连载调度配置） */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateBookCoreDto {
  @ApiProperty({ description: '小说核心创意/高层设定', example: '一个少年在末世废墟中发现了通往平行世界的钥匙' })
  @IsString() @IsNotEmpty()
  mainIdea!: string;

  @ApiProperty({ description: '商业类型标签', example: '玄幻' })
  @IsString() @IsNotEmpty()
  genre!: string;

  @ApiProperty({ description: '目标读者群体，用于语气和节奏策略', example: '18-30 岁男性网文读者' })
  @IsString() @IsNotEmpty()
  targetAudience!: string;

  @ApiPropertyOptional({ description: '主角聚焦（影响模板匹配和写作策略）', enum: ['female_lead', 'male_lead', 'dual_lead', 'ensemble'], example: 'female_lead' })
  @IsString() @IsIn(['female_lead', 'male_lead', 'dual_lead', 'ensemble']) @IsOptional()
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';

  @ApiPropertyOptional({ description: '调性偏好标签（用于模板匹配）', example: '细腻慢热' })
  @IsString() @IsOptional()
  tonePreference?: string;

  @ApiPropertyOptional({ description: '额外受众标签（用于模板匹配）', example: ['female', '20-35', 'romance-reader'] })
  @IsArray() @IsString({ each: true }) @IsOptional()
  audienceTags?: string[];

  @ApiProperty({ description: '长期主线目标，用于卷级规划对齐', example: '主角突破封印，统一三界' })
  @IsString() @IsNotEmpty()
  mainStoryGoal!: string;

  @ApiPropertyOptional({ description: '可选的书名种子，用于世界观生成', example: '破界少年' })
  @IsString() @IsOptional()
  titleHint?: string;

  @ApiPropertyOptional({ description: '每章目标字数（中文字符）', default: 3000, minimum: 1000, maximum: 8000, example: 3000 })
  @IsInt() @Min(1000) @Max(8000) @IsOptional()
  targetChapterWordCount?: number;

  @ApiPropertyOptional({ description: '计划总章数下限', default: 500, minimum: 50, maximum: 2000, example: 500 })
  @IsInt() @Min(50) @Max(2000) @IsOptional()
  plannedMinChapters?: number;

  @ApiPropertyOptional({ description: '计划总章数上限', default: 800, minimum: 100, maximum: 3000, example: 800 })
  @IsInt() @Min(100) @Max(3000) @IsOptional()
  plannedMaxChapters?: number;

  @ApiPropertyOptional({ description: '指定题材模板 ID（系统或用户自定义），不传则按 genre 自动匹配' })
  @IsUUID() @IsOptional()
  profileTemplateId?: string;
}
