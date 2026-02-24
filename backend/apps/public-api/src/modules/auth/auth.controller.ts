import { Controller, Get, Post, Body, Req, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, ChangePasswordDto } from './dto/login.dto';
import { Public } from '@packages/common/guards';
import { ResponseService } from '@packages/modules';

/**
 * 认证控制器
 */
@ApiTags('认证')
@Controller('admin/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * 管理员登录 - 公开接口
   */
  @Post('login')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: '管理员登录',
    description: '使用用户名和密码登录，获取 JWT Token',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: '登录成功',
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          admin: {
            id: 'xxx',
            username: 'admin',
            email: 'admin@example.com',
            realName: '系统管理员',
            role: 'super_admin',
            status: 'active',
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const result = await this.authService.login(dto, ip, userAgent);
    return this.responseService.success(result);
  }

  /**
   * 登出 - 需要认证
   */
  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '管理员登出',
    description: '退出登录，清除 Token',
  })
  @ApiResponse({
    status: 200,
    description: '登出成功',
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: { success: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: '未授权' })
  async logout(@Req() req: any) {
    const adminId = req.user?.id;
    await this.authService.logout(adminId);
    return this.responseService.success({ success: true });
  }

  /**
   * 获取当前用户信息 - 需要认证
   */
  @Get('profile')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '获取当前用户信息',
    description: '获取当前登录管理员的详细信息',
  })
  @ApiResponse({
    status: 200,
    description: '获取成功',
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: {
          id: 'xxx',
          username: 'admin',
          email: 'admin@example.com',
          realName: '系统管理员',
          role: 'super_admin',
          status: 'active',
          lastLoginAt: '2025-11-18T10:00:00.000Z',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '未授权' })
  async getProfile(@Req() req: any) {
    const adminId = req.user?.id;
    const result = await this.authService.getProfile(adminId);
    return this.responseService.success(result);
  }

  /**
   * 用户注册 - 公开接口
   */
  @Post('register')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary: '用户注册',
    description: '新用户注册账号',
  })
  @ApiResponse({ status: 200, description: '注册成功' })
  @ApiResponse({ status: 400, description: '用户名已存在' })
  async register(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const result = await this.authService.register(dto, ip, userAgent);
    return this.responseService.success(result);
  }

  /**
   * 修改密码 - 需要认证
   */
  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary: '修改密码',
    description: '修改当前登录管理员的密码，修改后需要重新登录',
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: 200,
    description: '修改成功',
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: { success: true },
      },
    },
  })
  @ApiResponse({ status: 400, description: '旧密码不正确' })
  @ApiResponse({ status: 401, description: '未授权' })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
    const adminId = req.user?.id;
    await this.authService.changePassword(adminId, dto);
    return this.responseService.success({ success: true });
  }
}
