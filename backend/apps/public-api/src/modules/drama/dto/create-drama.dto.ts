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

  @IsOptional() @IsEnum([
    'douyin', 'kuaishou', 'hongguo', 'wechat_mini', 'bilibili',
    'tencent_video', 'mango_tv', 'iqiyi', 'reelshort', 'dramabox', 'generic',
  ])
  platformTarget?: 'douyin' | 'kuaishou' | 'hongguo' | 'wechat_mini' | 'bilibili'
    | 'tencent_video' | 'mango_tv' | 'iqiyi' | 'reelshort' | 'dramabox' | 'generic';

  @IsOptional() @IsEnum(['9:16', '16:9'])
  aspectRatio?: '9:16' | '16:9';

  @IsOptional() @IsInt() @Min(30) @Max(600)
  targetEpisodeDurationSec?: number; // 每集目标时长（秒）

  @IsOptional() @IsInt() @Min(20)
  plannedMinEpisodes?: number;

  @IsOptional() @IsInt() @Min(20)
  plannedMaxEpisodes?: number;

  @IsOptional() @IsString()
  genreTemplateId?: string; // 指定题材模板 ID

  @IsOptional() @IsString()
  visualStyleTemplateId?: string; // 指定视觉风格模板 ID（与 drama_visual_style_templates 关联）

  @IsOptional() @IsString()
  visualStyleHint?: string; // 视觉风格提示（如"真人影视""2D 动漫""水墨古风"），传给视觉资产设计师

  @IsOptional() @IsString()
  suggestedVisualStyle?: string; // 视觉风格枚举值（如 period_live / live_action / 2d_anime），由前端推荐流程确定后透传

  @IsOptional() @IsEnum(['fast', 'balanced', 'quality'])
  generationMode?: 'fast' | 'balanced' | 'quality';

  @IsOptional() @IsEnum(['auto', 'volcengine', 'kling', 'hailuo', 'veo', 'sora', 'kling-avatar'])
  videoProvider?: 'auto' | 'volcengine' | 'kling' | 'hailuo' | 'veo' | 'sora' | 'kling-avatar';
}
