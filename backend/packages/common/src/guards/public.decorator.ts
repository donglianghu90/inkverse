import { SetMetadata } from '@nestjs/common';

/**
 * Public 装饰器
 * 用于标记不需要 JWT 认证的公开接口
 * 
 * @example
 * @Public()
 * @Post('login')
 * async login() {}
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

