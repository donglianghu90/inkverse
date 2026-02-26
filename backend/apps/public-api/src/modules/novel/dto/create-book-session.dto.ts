import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CreateBookDto } from './create-book.dto';

/**
 * Request payload for create-book session bootstrap.
 * Uses DTO body validation to avoid oversized/unsafe querystring payloads.
 */
export class CreateBookSessionDto extends CreateBookDto {
  @ApiPropertyOptional({
    description: '可选幂等键。重复提交相同键会复用同一个创建会话',
    example: '3d6e4d57-fb74-4f0d-8d3e-e7e75c449cbf',
  })
  @IsOptional()
  @IsString()
  @Length(6, 128)
  idempotencyKey?: string;
}

