/**
 * API payload contract for daily auto-serialization schedule.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ConfigureAutoSerializationDto {
  @ApiProperty({ description: '每日触发时间（服务器本地时区），格式 HH:mm', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$', example: '08:00' })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  dailyStartTime!: string;

  @ApiProperty({ description: '每次定时运行生成的章节数', minimum: 1, maximum: 50, example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  chaptersPerRun!: number;

  @ApiPropertyOptional({ description: '每章最大修复轮数', default: 2, minimum: 1, maximum: 8, example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8)
  maxRepairRounds?: number;

  @ApiPropertyOptional({ description: '继续运行所需的最低写作质量分（下限 7，低于阈值将终止当次运行）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(7)
  @Max(10)
  minQualityScore?: number;

  @ApiPropertyOptional({ description: '继续运行所需的最低评审综合分（下限 7，低于阈值将终止当次运行）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(7)
  @Max(10)
  minOverallScore?: number;
}
