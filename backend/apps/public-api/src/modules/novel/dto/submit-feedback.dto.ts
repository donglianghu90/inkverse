/** 提交单章读者评论 + 平台指标。 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional,
  IsString, Max, Min, ValidateNested,
} from 'class-validator';

export class ReaderCommentDto {
  @ApiProperty() @IsString() @IsNotEmpty() content: string;
  @ApiProperty({ enum: ['positive', 'negative', 'neutral', 'mixed'] })
  @IsEnum(['positive', 'negative', 'neutral', 'mixed']) sentiment: string;
  @ApiProperty({ enum: ['plot', 'character', 'writing', 'pacing', 'worldbuilding', 'hook', 'general'] })
  @IsEnum(['plot', 'character', 'writing', 'pacing', 'worldbuilding', 'hook', 'general']) aspect: string;
  @ApiPropertyOptional() @IsOptional() @IsString() authorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() platform?: string;
}

export class PlatformMetricsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) readCompletionRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) retentionRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) favoriteCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) commentCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) wordCount?: number;
}

export class SubmitFeedbackDto {
  @ApiProperty({ description: '章节号' })
  @IsInt() @Min(1) chapterNumber: number;

  @ApiProperty({ type: [ReaderCommentDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReaderCommentDto)
  comments: ReaderCommentDto[];

  @ApiPropertyOptional({ type: PlatformMetricsDto })
  @IsOptional() @ValidateNested() @Type(() => PlatformMetricsDto)
  metrics?: PlatformMetricsDto;
}
