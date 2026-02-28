/** 创建小说时的自动连载初始配置（与核心创意解耦） */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, Matches, Max, Min } from 'class-validator';

export class AutoSerializationInitDto {
  @ApiPropertyOptional({ description: '创建后是否自动启用连载调度', default: true, example: true })
  @IsOptional() @Type(() => Boolean) @IsBoolean()
  autoSerializationEnabled?: boolean;

  @ApiPropertyOptional({ description: '自动连载每日触发时间（HH:mm）', pattern: '^([01]\\d|2[0-3]):([0-5]\\d)$', default: '08:00', example: '08:00' })
  @IsOptional() @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  autoSerializationDailyStartTime?: string;

  @ApiPropertyOptional({ description: '自动连载每隔几天执行一次', minimum: 1, maximum: 14, default: 1, example: 2 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(14)
  autoSerializationRunEveryDays?: number;

  @ApiPropertyOptional({ description: '自动连载每次执行生成章节数', minimum: 1, maximum: 50, default: 3, example: 3 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  autoSerializationChaptersPerRun?: number;

  @ApiPropertyOptional({ description: '自动连载每章最大修复轮数', default: 2, minimum: 1, maximum: 8, example: 2 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8)
  autoSerializationMaxRepairRounds?: number;

  @ApiPropertyOptional({ description: '自动连载继续运行的最低写作质量分（下限 7）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(7) @Max(10)
  autoSerializationMinQualityScore?: number;

  @ApiPropertyOptional({ description: '自动连载继续运行的最低综合评分（下限 7）', default: 7, minimum: 7, maximum: 10, example: 7 })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(7) @Max(10)
  autoSerializationMinOverallScore?: number;
}
