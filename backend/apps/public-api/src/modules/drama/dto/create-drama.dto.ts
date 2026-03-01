import { IsString, IsOptional, IsEnum, IsInt, Min, Max, IsArray, MinLength } from 'class-validator';

export class CreateDramaDto {
  @IsString() @MinLength(10)
  mainIdea: string; // 核心创意（≥10字）

  @IsString()
  genre: string; // 题材（霸总/甜宠/战神/穿越...）

  @IsString()
  targetAudience: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  audienceTags?: string[];

  @IsOptional() @IsEnum(['female_lead', 'male_lead', 'dual_lead', 'ensemble'])
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';

  @IsOptional() @IsString()
  tonePreference?: string;

  @IsOptional() @IsString()
  mainStoryGoal?: string; // 主线目标

  @IsOptional() @IsString()
  titleHint?: string; // 剧名灵感

  @IsOptional() @IsEnum(['douyin', 'kuaishou', 'reelshort', 'dramabox', 'generic'])
  platformTarget?: 'douyin' | 'kuaishou' | 'reelshort' | 'dramabox' | 'generic';

  @IsOptional() @IsEnum(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9';

  @IsOptional() @IsInt() @Min(30) @Max(600)
  targetEpisodeDurationSec?: number; // 每集目标时长（秒）

  @IsOptional() @IsInt() @Min(20)
  plannedMinEpisodes?: number;

  @IsOptional() @IsInt() @Min(20)
  plannedMaxEpisodes?: number;
}
