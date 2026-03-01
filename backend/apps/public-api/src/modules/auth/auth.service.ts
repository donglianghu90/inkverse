import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { ConfigService } from '@packages/modules';
import { AdminUserService } from '../admin-user/admin-user.service';
import { LoginDto, ChangePasswordDto } from './dto/login.dto';

/**
 * 管理员 JWT Payload
 */
export interface AdminJwtPayload {
  id: string;
  username: string;
  role: string;
}

/**
 * 认证服务
 */
@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly adminUserService: AdminUserService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  /**
   * 管理员登录
   */
  async login(dto: LoginDto, ip: string, userAgent: string): Promise<{ token: string; admin: any }> {
    // 1. 查找管理员
    const admin = await this.adminUserService.findByUsername(dto.username);
    if (!admin) {
      throw new BadRequestException('用户名或密码错误');
    }

    // 2. 验证密码
    const isPasswordValid = await this.adminUserService.validatePassword(dto.password, admin.password);
    if (!isPasswordValid) {
      throw new BadRequestException('用户名或密码错误');
    }

    // 3. 检查账号状态
    if (admin.status !== 'active') {
      throw new BadRequestException('账号已被禁用');
    }

    // 4. 生成 JWT Token
    const payload: AdminJwtPayload = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    };

    const token = await this.generateToken(payload);

    // 5. 更新最后登录信息
    await this.adminUserService.updateLastLogin(admin.id, ip);

    // 6. 返回结果（不返回密码）
    const { password, ...adminInfo } = admin;

    return {
      token,
      admin: adminInfo,
    };
  }

  /**
   * 用户注册
   */
  async register(dto: LoginDto, ip: string, userAgent: string): Promise<{ token: string; admin: any }> {
    const admin = await this.adminUserService.createAdmin({
      username: dto.username,
      password: dto.password,
    });
    const payload: AdminJwtPayload = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    };
    const token = await this.generateToken(payload);
    await this.adminUserService.updateLastLogin(admin.id, ip);
    const { password, ...adminInfo } = admin;
    return { token, admin: adminInfo };
  }

  /**
   * 登出
   */
  async logout(adminId: string, token?: string): Promise<void> {
    const userTokenSetKey = this.buildUserTokenSetKey(adminId);
    if (token) {
      const tokenKey = this.buildTokenKey(adminId, token);
      await this.redis.multi().del(tokenKey).srem(userTokenSetKey, tokenKey).exec();
      return;
    }
    const tokenKeys = await this.redis.smembers(userTokenSetKey);
    if (tokenKeys.length > 0) {
      await this.redis.del(...tokenKeys);
    }
    await this.redis.del(userTokenSetKey);
  }

  /**
   * 获取当前用户信息
   */
  async getProfile(adminId: string): Promise<any> {
    const admin = await this.adminUserService.findById(adminId);
    if (!admin) {
      throw new BadRequestException('用户不存在');
    }

    const { password, ...adminInfo } = admin;
    return adminInfo;
  }

  /**
   * 修改密码
   */
  async changePassword(adminId: string, dto: ChangePasswordDto): Promise<void> {
    const admin = await this.adminUserService.findById(adminId);
    if (!admin) {
      throw new BadRequestException('用户不存在');
    }

    // 验证旧密码
    const isOldPasswordValid = await this.adminUserService.validatePassword(dto.oldPassword, admin.password);
    if (!isOldPasswordValid) {
      throw new BadRequestException('旧密码不正确');
    }

    // 修改密码
    await this.adminUserService.changePassword(adminId, dto.newPassword);

    // 清除 token
    await this.logout(adminId);
  }

  /**
   * 生成 JWT token
   */
  private async generateToken(payload: AdminJwtPayload): Promise<string> {
    const accessToken = this.jwtService.sign(payload);
    const expiresIn = this.configService.get('jwt.expiresIn') || '1d';
    const expiresInSeconds = this.convertTimeToSeconds(expiresIn);
    const tokenKey = this.buildTokenKey(payload.id, accessToken);
    const userTokenSetKey = this.buildUserTokenSetKey(payload.id);
    await this.redis
      .multi()
      .setex(tokenKey, expiresInSeconds, '1')
      .sadd(userTokenSetKey, tokenKey)
      .expire(userTokenSetKey, expiresInSeconds)
      .exec();
    return accessToken;
  }

  private buildUserTokenSetKey(adminId: string): string {
    return `inkverse:user:tokens:${adminId}`;
  }

  private buildTokenKey(adminId: string, token: string): string {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return `inkverse:user:token:${adminId}:${tokenHash}`;
  }

  /**
   * 验证 JWT token
   */
  async validateToken(token: string): Promise<AdminJwtPayload | null> {
    try {
      const payload = this.jwtService.verify<AdminJwtPayload>(token);
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * 将时间字符串转换为秒数
   */
  private convertTimeToSeconds(timeString: string): number {
    const match = timeString.match(/^(\d+)([dhms])$/);
    if (!match) {
      return 86400; // 默认1天
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return value * 24 * 60 * 60;
      case 'h':
        return value * 60 * 60;
      case 'm':
        return value * 60;
      case 's':
        return value;
      default:
        return 86400;
    }
  }
}
