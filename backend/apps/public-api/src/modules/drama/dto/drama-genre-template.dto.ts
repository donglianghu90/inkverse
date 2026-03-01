/** 短剧题材模板 CRUD DTO */
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDramaGenreTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  genreKey: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  displayName: string;

  @IsString() @IsOptional() @MaxLength(500)
  description?: string;

  @IsArray() @IsString({ each: true }) @IsOptional()
  genreKeywords?: string[];

  @IsObject() @IsOptional()
  profileJson?: Record<string, unknown>;

  @IsObject() @IsOptional()
  seedHints?: Record<string, unknown>;

  @IsArray() @IsString({ each: true }) @IsOptional()
  audienceTags?: string[];

  @IsArray() @IsIn(['female_lead', 'male_lead', 'dual_lead', 'ensemble'], { each: true }) @IsOptional()
  protagonistFocusTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  toneTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  platformTags?: string[];
}

export class UpdateDramaGenreTemplateDto {
  @IsString() @MaxLength(200) @IsOptional()
  displayName?: string;

  @IsString() @MaxLength(500) @IsOptional()
  description?: string;

  @IsArray() @IsString({ each: true }) @IsOptional()
  genreKeywords?: string[];

  @IsObject() @IsOptional()
  profileJson?: Record<string, unknown>;

  @IsObject() @IsOptional()
  seedHints?: Record<string, unknown>;

  @IsArray() @IsString({ each: true }) @IsOptional()
  audienceTags?: string[];

  @IsArray() @IsIn(['female_lead', 'male_lead', 'dual_lead', 'ensemble'], { each: true }) @IsOptional()
  protagonistFocusTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  toneTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  platformTags?: string[];
}
