/**
 * API payload contract for automatic multi-chapter generation.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class GenerateChaptersBatchDto {
  @ApiProperty({ description: '本次请求连续生成的章节数', minimum: 1, maximum: 50, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  chapterCount!: number;

  @ApiPropertyOptional({ description: '每章最大修复轮数', default: 2, minimum: 1, maximum: 8, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  maxRepairRounds?: number;

  @ApiPropertyOptional({ description: '质量低于阈值时是否提前停止', default: true, example: true })
  @IsOptional()
  @IsBoolean()
  stopWhenLowQuality?: boolean;

  @ApiPropertyOptional({ description: '是否强制所有质量门通过，未通过则终止批量生成', default: true, example: true })
  @IsOptional()
  @IsBoolean()
  strictQuality?: boolean;

  @ApiPropertyOptional({ description: '继续生成所需的最低写作质量分', default: 7, minimum: 0, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minQualityScore?: number;

  @ApiPropertyOptional({ description: '继续生成所需的最低评审综合分', default: 7, minimum: 0, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minOverallScore?: number;
}
