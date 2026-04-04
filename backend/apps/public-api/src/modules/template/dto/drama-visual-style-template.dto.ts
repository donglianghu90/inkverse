/** 短剧视觉风格模板 CRUD DTO */
import { IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDramaVisualStyleTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  styleKey: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  displayName: string;

  @IsString() @IsOptional() @MaxLength(500)
  description?: string;

  @IsString() @IsIn(['live_action', '2d_animation', '3d_animation', 'stop_motion', 'chinese_traditional']) @IsOptional()
  styleCategory?: string;

  @IsArray() @IsString({ each: true }) @IsOptional()
  tags?: string[];

  @IsObject() @IsOptional()
  visualGuide?: Record<string, unknown>;

  @IsObject() @IsOptional()
  promptGuidance?: Record<string, unknown>;

  @IsArray() @IsString({ each: true }) @IsOptional()
  genreCompatibility?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  audienceTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  platformTags?: string[];
}

export class UpdateDramaVisualStyleTemplateDto {
  @IsString() @MaxLength(200) @IsOptional()
  displayName?: string;

  @IsString() @MaxLength(500) @IsOptional()
  description?: string;

  @IsString() @IsIn(['live_action', '2d_animation', '3d_animation', 'stop_motion', 'chinese_traditional']) @IsOptional()
  styleCategory?: string;

  @IsArray() @IsString({ each: true }) @IsOptional()
  tags?: string[];

  @IsObject() @IsOptional()
  visualGuide?: Record<string, unknown>;

  @IsObject() @IsOptional()
  promptGuidance?: Record<string, unknown>;

  @IsArray() @IsString({ each: true }) @IsOptional()
  genreCompatibility?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  audienceTags?: string[];

  @IsArray() @IsString({ each: true }) @IsOptional()
  platformTags?: string[];
}
