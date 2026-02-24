import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminUserModule } from '../admin-user/admin-user.module';

/**
 * 认证模块
 * 注意：JwtModule 已在 app.module.ts 中全局配置，这里无需重复导入
 */
@Module({
  imports: [AdminUserModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
