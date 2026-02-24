import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUserEntity } from './admin-user.entity';
import { AdminUserService } from './admin-user.service';

@Module({
  imports: [TypeOrmModule.forFeature([AdminUserEntity])],
  providers: [AdminUserService],
  exports: [AdminUserService],
})
export class AdminUserModule {}
