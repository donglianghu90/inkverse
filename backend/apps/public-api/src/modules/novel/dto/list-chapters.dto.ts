/**
 * Query contract for chapter list endpoint.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListChaptersDto {
  @ApiPropertyOptional({ description: '返回的章节数量（按最新排序）', default: 20, minimum: 1, maximum: 200, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
