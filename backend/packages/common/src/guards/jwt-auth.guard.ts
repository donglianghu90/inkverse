import { RedisService } from '@liaoliaots/nestjs-redis';
import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@packages/modules';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface JwtPayload {
  id: string;
  teamId: string;
  teamPlanId: string;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly redis: Redis | null;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 检查是否为公开路由
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('缺少 Authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('无效的 token 格式');
    }

    try {
      // 验证JWT token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });
      
      // 将用户信息添加到请求对象
      request.user = payload;
      
      // 从 Redis 获取存储的 token
      // 统一使用 steel-erp:user:token:${id} 格式
      const redisKey = `inkverse:user:token:${payload.id}`;
      const storedToken = await this.redis.get(redisKey);
      
      // 如果 Redis 中没有 token 或者 token 不匹配，则认为 token 无效
      if (!storedToken || storedToken !== token) {
        throw new UnauthorizedException('token 已失效，请重新登录');
      }
      
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('无效的 token');
    }
  }
}
