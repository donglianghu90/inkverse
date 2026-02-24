import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AdminUserEntity } from './admin-user.entity';
import { AdminRole, AdminStatus } from '../../common/enums';

const SALT_ROUNDS = 10;

@Injectable()
export class AdminUserService {
  constructor(
    @InjectRepository(AdminUserEntity)
    private readonly adminUserRepo: Repository<AdminUserEntity>,
  ) {}

  async findByUsername(username: string): Promise<AdminUserEntity | null> {
    return this.adminUserRepo.findOne({ where: { username } });
  }

  async findById(id: string): Promise<AdminUserEntity | null> {
    return this.adminUserRepo.findOne({ where: { id } });
  }

  async validatePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async updateLastLogin(id: string, ip: string): Promise<void> {
    await this.adminUserRepo.update(id, {
      lastLoginAt: new Date(),
      lastLoginIp: ip,
    });
  }

  async changePassword(id: string, newPassword: string): Promise<void> {
    const hashed = await this.hashPassword(newPassword);
    await this.adminUserRepo.update(id, { password: hashed });
  }

  async createAdmin(data: {
    username: string;
    password: string;
    email?: string;
    realName?: string;
    role?: AdminRole;
  }): Promise<AdminUserEntity> {
    const existing = await this.findByUsername(data.username);
    if (existing) {
      throw new BadRequestException(`用户名 "${data.username}" 已存在`);
    }

    const hashedPassword = await this.hashPassword(data.password);

    const admin = this.adminUserRepo.create({
      username: data.username,
      password: hashedPassword,
      email: data.email,
      realName: data.realName,
      role: data.role || AdminRole.ADMIN,
      status: AdminStatus.ACTIVE,
    });

    return this.adminUserRepo.save(admin);
  }

  async ensureSuperAdmin(data: {
    username: string;
    password: string;
    email?: string;
    realName?: string;
  }): Promise<AdminUserEntity> {
    const existing = await this.findByUsername(data.username);
    if (existing) {
      return existing;
    }

    const hashedPassword = await this.hashPassword(data.password);

    const admin = this.adminUserRepo.create({
      username: data.username,
      password: hashedPassword,
      email: data.email,
      realName: data.realName,
      role: AdminRole.SUPER_ADMIN,
      status: AdminStatus.ACTIVE,
    });

    return this.adminUserRepo.save(admin);
  }
}
