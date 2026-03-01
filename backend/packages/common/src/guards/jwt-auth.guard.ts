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
import { createHash } from 'crypto';
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
    const queryToken = request.query?.token as string | undefined; // SSE/EventSource 不支持自定义 header，降级从 query 取 token

    const token = authHeader?.split(' ')[1] || queryToken;
    if (!token) {
      throw new UnauthorizedException('缺少 Authorization header');
    }

    try {
      // 验证JWT token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });
      
      // 将用户信息添加到请求对象
      request.user = payload;
      
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const redisKey = `inkverse:user:token:${payload.id}:${tokenHash}`;
      const exists = await this.redis.exists(redisKey);
      if (!exists) {
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
