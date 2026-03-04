/** 创意增强 & 主线目标生成 DTO */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional({ description: '主角侧重' }) @IsOptional() @IsString()
  protagonistFocus?: string;

  @ApiPropertyOptional({ description: '基调偏好' }) @IsOptional() @IsString()
  tonePreference?: string;

  @ApiPropertyOptional({ description: '受众标签', type: [String] }) @IsOptional() @IsArray() @IsString({ each: true })
  audienceTags?: string[];

  @ApiPropertyOptional({ description: '书名/标题提示' }) @IsOptional() @IsString()
  titleHint?: string;
}

export class EnhanceGoalDto {
  @ApiProperty({ description: '用户写的主线目标草稿' }) @IsString() @IsNotEmpty()
  goal: string;

  @ApiProperty({ description: '核心创意' }) @IsString() @IsNotEmpty()
  mainIdea: string;

  @ApiProperty({ description: '题材' }) @IsString() @IsNotEmpty()
  genre: string;

  @ApiProperty({ description: '目标读者' }) @IsString() @IsNotEmpty()
  targetAudience: string;

  @ApiPropertyOptional({ description: '主角侧重' }) @IsOptional() @IsString()
  protagonistFocus?: string;

  @ApiPropertyOptional({ description: '基调偏好' }) @IsOptional() @IsString()
  tonePreference?: string;

  @ApiPropertyOptional({ description: '受众标签', type: [String] }) @IsOptional() @IsArray() @IsString({ each: true })
  audienceTags?: string[];

  @ApiPropertyOptional({ description: '书名/标题提示' }) @IsOptional() @IsString()
  titleHint?: string;
}
