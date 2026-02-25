import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RedisModule } from "@liaoliaots/nestjs-redis";
import path from "path";
import { ConfigModule, ConfigService, LogModule, ResponseModule, OssModule } from "@packages/modules";
import { GlobalErrorInterceptor, GlobalFilter } from "@packages/common/exceptions";
import { UnifiedInterceptor } from "@packages/common/interceptors";
import { BullModule } from "@nestjs/bullmq";
import { JwtAuthGuard } from "@packages/common/guards";
import { JwtModule } from "@nestjs/jwt";
import { LlmModule } from "./modules/novel/llm/llm.module";
import { NovelModule } from "./modules/novel/novel.module";
import { AuthModule } from "./modules/auth/auth.module";

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      configPath: path.join(process.cwd(), "config", "public.properties"),
    }),
    LogModule.register({
      appName: "steel-erp",
      enableSeparateFiles: true,
      enableAllFile: false, // 不启用all.log，避免重复存储
      logLevels: {
        error: true,
        warn: true,
        info: true,
        debug: true
      },
      // customCategories: ['api']
    }),
    ResponseModule, // 添加全局响应模块
    // OSS模块
    OssModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const ossConfig = configService.get("oss");
        return {
          config: {
            region: ossConfig.region,
            accessKeyId: ossConfig.accessKeyId,
            accessKeySecret: ossConfig.accessKeySecret,
            bucket: ossConfig.bucketName,
            secure: true,
          },
          options: {
            enableHealthCheck: true,
            retryAttempts: 3,
            retryDelay: 1000,
          },
        };
      },
    }),
    // PostgreSQL 配置
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const pgConfig = configService.get("db.pg");
        console.log(pgConfig);
        return {
          type: "postgres",
          host: pgConfig.host,
          port: parseInt(pgConfig.port),
          username: pgConfig.user,
          password: pgConfig.password,
          database: pgConfig.database,
          entities: [path.join(__dirname, "**/*.entity{.ts,.js}")],
          autoLoadEntities: true,
          migrations: [path.join(__dirname, "migrations/*{.ts,.js}")],
          migrationsRun: false,
          migrationsTableName: "migrations",
          synchronize: true, // 生产环境禁用自动同步
          logging: false,
          extra: {
            // 连接池最大连接数
            max: 20,
            // 连接超时时间（毫秒）
            connectionTimeoutMillis: 30000,
            // 空闲连接超时时间（毫秒）
            idleTimeoutMillis: 30000,
            // 最大重试次数
            maxRetriesPerRequest: 3,
          },
        };
      },
    }),
    // redis
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: any) => {
        const redisPass = configService.get("redis7.pass");
        return {
          readyLog: true,
          config: {
            host: configService.get("redis7.addr"),
            password: redisPass || undefined,
          },
        };
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('jwt.secret'),
        signOptions: { expiresIn: configService.get('jwt.expiresIn') },
      }),
      global: true, // 使 JwtService 在整个应用中全局可用
    }),
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const redis_config = configService.get('redis7');
        return {
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
          },
          maxRetriesPerRequest: 3,
          connection: {
            host: redis_config?.addr,
            password: redis_config?.pass || undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    // 业务模块
    AuthModule,
    LlmModule,
    NovelModule,
  ],
  controllers: [],
  providers: [GlobalErrorInterceptor, GlobalFilter, UnifiedInterceptor, JwtAuthGuard],
})
export class AppModule {}
