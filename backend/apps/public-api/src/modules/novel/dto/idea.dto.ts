/** 创意增强 & 主线目标生成 DTO */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EnhanceIdeaDto {
  @ApiProperty({ description: '原始创意', example: '一个孤儿在修仙世界觉醒了...' })
  @IsString() @IsNotEmpty()
  idea: string;

  @ApiPropertyOptional({ description: '题材', example: '仙侠' })
  @IsOptional() @IsString()
  genre?: string;
}

export class GenerateStoryGoalDto {
  @ApiProperty({ description: '核心创意' }) @IsString() @IsNotEmpty()
  mainIdea: string;

  @ApiProperty({ description: '题材' }) @IsString() @IsNotEmpty()
  genre: string;

  @ApiProperty({ description: '目标读者' }) @IsString() @IsNotEmpty()
  targetAudience: string;
}
