/**
 * 初始化超级管理员账号脚本
 *
 * 使用方式:
 *   pnpm run init:admin
 *   # 或
 *   ts-node -r tsconfig-paths/register scripts/init-admin.ts
 */
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { join } from 'path';
import { read } from 'properties-parser';

const SALT_ROUNDS = 10;

const DEFAULT_ADMIN = {
  username: 'admin',
  password: 'Admin@123456',
  email: 'admin@inkverse.com',
  realName: '超级管理员',
  role: 'super_admin',
  status: 'active',
};

async function main() {
  const configPath = join(process.cwd(), 'config', 'public.properties');
  const props = read(configPath) as Record<string, string>;

  const dataSource = new DataSource({
    type: 'postgres',
    host: props['db.pg.host'],
    port: parseInt(props['db.pg.port'] || '5432'),
    username: props['db.pg.user'],
    password: props['db.pg.password'],
    database: props['db.pg.database'],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log('✅ 数据库连接成功');

  const queryRunner = dataSource.createQueryRunner();

  try {
    // 确保 enum 类型存在
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE admin_users_role_enum AS ENUM ('super_admin', 'admin', 'editor');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE admin_users_status_enum AS ENUM ('active', 'disabled');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // 确保表存在
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        real_name VARCHAR(50),
        role admin_users_role_enum NOT NULL DEFAULT 'admin',
        status admin_users_status_enum NOT NULL DEFAULT 'active',
        last_login_at TIMESTAMPTZ,
        last_login_ip VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);
    `);

    console.log('✅ 数据表检查/创建完成');

    // 检查是否已存在
    const existing = await queryRunner.query(
      `SELECT id FROM admin_users WHERE username = $1`,
      [DEFAULT_ADMIN.username],
    );

    if (existing.length > 0) {
      console.log(`ℹ️  管理员账号 "${DEFAULT_ADMIN.username}" 已存在，跳过创建`);
    } else {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN.password, SALT_ROUNDS);

      await queryRunner.query(
        `INSERT INTO admin_users (username, password, email, real_name, role, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          DEFAULT_ADMIN.username,
          hashedPassword,
          DEFAULT_ADMIN.email,
          DEFAULT_ADMIN.realName,
          DEFAULT_ADMIN.role,
          DEFAULT_ADMIN.status,
        ],
      );

      console.log('✅ 超级管理员账号创建成功');
      console.log('────────────────────────────');
      console.log(`   用户名: ${DEFAULT_ADMIN.username}`);
      console.log(`   密码:   ${DEFAULT_ADMIN.password}`);
      console.log(`   邮箱:   ${DEFAULT_ADMIN.email}`);
      console.log(`   角色:   ${DEFAULT_ADMIN.role}`);
      console.log('────────────────────────────');
      console.log('⚠️  请登录后立即修改默认密码！');
    }
  } catch (err) {
    console.error('❌ 初始化失败:', err);
    process.exit(1);
  } finally {
    await dataSource.destroy();
    console.log('🔌 数据库连接已关闭');
  }
}

main();
