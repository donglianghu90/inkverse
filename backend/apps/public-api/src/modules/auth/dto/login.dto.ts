import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 登录 DTO
 */
export class LoginDto {
  @ApiProperty({
    description: '用户名',
    example: 'admin',
    minLength: 3,
  })
  @IsString({ message: '用户名必须是字符串' })
  @MinLength(3, { message: '用户名至少3个字符' })
  username: string;

  @ApiProperty({
    description: '密码',
    example: 'Admin@123456',
    minLength: 6,
  })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码至少6个字符' })
  password: string;
}

/**
 * 修改密码 DTO
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: '旧密码',
    example: 'Admin@123456',
  })
  @IsString({ message: '旧密码必须是字符串' })
  oldPassword: string;

  @ApiProperty({
    description: '新密码（至少8位，包含大小写字母、数字、特殊字符）',
    example: 'NewPass@123456',
    minLength: 8,
  })
  @IsString({ message: '新密码必须是字符串' })
  @MinLength(8, { message: '新密码至少8个字符' })
  newPassword: string;
}
