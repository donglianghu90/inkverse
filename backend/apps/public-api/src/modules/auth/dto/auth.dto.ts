import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Google OAuth2授权码',
    example: '4/0AfJohXn...',
    type: String,
    required: true
  })
  @IsString({ message: 'google.validation.code.is_string' })
  @IsNotEmpty({ message: 'google.validation.code.is_not_empty' })
  code: string;


  @ApiProperty({
    description: '登录来源',
    example: 'google',
    type: String,
    required: true
  })
  @IsString({ message: 'google.validation.state.is_string' })
  @IsNotEmpty({ message: 'google.validation.state.is_not_empty' })
  state: string;
}
