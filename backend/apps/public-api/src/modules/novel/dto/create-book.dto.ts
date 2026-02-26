/**
 * API payload contract for creating a new novel project.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateBookDto {
  @ApiProperty({ description: '小说核心创意/高层设定', example: '一个少年在末世废墟中发现了通往平行世界的钥匙' })
  @IsString()
  @IsNotEmpty()
  mainIdea!: string;

  @ApiProperty({ description: '商业类型标签', example: '玄幻' })
  @IsString()
  @IsNotEmpty()
  genre!: string;

  @ApiProperty({ description: '目标读者群体，用于语气和节奏策略', example: '18-30 岁男性网文读者' })
  @IsString()
  @IsNotEmpty()
  targetAudience!: string;

  @ApiProperty({ description: '长期主线目标，用于卷级规划对齐', example: '主角突破封印，统一三界' })
  @IsString()
  @IsNotEmpty()
  mainStoryGoal!: string;

  @ApiPropertyOptional({ description: '可选的书名种子，用于世界观生成', example: '破界少年' })
  @IsString()
  @IsOptional()
  titleHint?: string;

  @ApiPropertyOptional({ description: '每章目标字数（中文字符）', default: 3000, minimum: 1000, maximum: 8000, example: 3000 })
  @IsInt()
  @Min(1000)
  @Max(8000)
  @IsOptional()
  targetChapterWordCount?: number;

  @ApiPropertyOptional({ description: '计划总章数下限', default: 500, minimum: 50, maximum: 2000, example: 500 })
  @IsInt()
  @Min(50)
  @Max(2000)
  @IsOptional()
  plannedMinChapters?: number;

  @ApiPropertyOptional({ description: '计划总章数上限', default: 800, minimum: 100, maximum: 3000, example: 800 })
  @IsInt()
  @Min(100)
  @Max(3000)
  @IsOptional()
  plannedMaxChapters?: number;

  @ApiPropertyOptional({ description: '创建后是否自动启用连载调度', default: true, example: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoSerializationEnabled?: boolean;

  @ApiPropertyOptional({ description: '自动连载每日触发时间（服务器本地时区），格式 HH:mm', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$', default: '08:00', example: '08:00' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  autoSerializationDailyStartTime?: string;

  @ApiPropertyOptional({ description: '自动连载每隔几天执行一次', minimum: 1, maximum: 14, default: 1, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  autoSerializationRunEveryDays?: number;

  @ApiPropertyOptional({ description: '自动连载每次执行生成章节数', minimum: 1, maximum: 50, default: 3, example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  autoSerializationChaptersPerRun?: number;

  @ApiPropertyOptional({ description: '自动连载每章最大修复轮数', default: 2, minimum: 1, maximum: 8, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  autoSerializationMaxRepairRounds?: number;

  @ApiPropertyOptional({ description: '自动连载继续运行的最低写作质量分（下限 7）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(7)
  @Max(10)
  autoSerializationMinQualityScore?: number;

  @ApiPropertyOptional({ description: '自动连载继续运行的最低综合评分（下限 7）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(7)
  @Max(10)
  autoSerializationMinOverallScore?: number;
}
