import { mw } from "request-ip";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Log4jsLogger } from "@nestx-log4js/core";
import { I18nValidationExceptionFilter, I18nValidationPipe } from 'nestjs-i18n';
import { UnifiedInterceptor } from "@packages/common/interceptors";
import { GlobalErrorInterceptor, GlobalFilter } from "@packages/common/exceptions";
import { JwtAuthGuard } from "@packages/common/guards";
import { ConfigService } from "@packages/modules";
import { xmlParser } from "@packages/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    cors: true,
    abortOnError: false,
    logger: false,
    rawBody: true,
  });

  const config = app.get(ConfigService);

  // 获取真实 IP
  app.use(mw({ attributeName: "ip" }));
  // xml 解析
  app.use(xmlParser());
  // 日志系统
  app.useLogger(app.get(Log4jsLogger));

  // 全局验证管道 - 支持国际化
  app.useGlobalPipes(
    new I18nValidationPipe({
      transform: true,
      enableDebugMessages: true, // 开发环境
      disableErrorMessages: false,
    })
  );

  // API前缀
  app.setGlobalPrefix("api/inkverse");

  // 全局拦截器 - 统一响应格式和日志记录
  app.useGlobalInterceptors(app.get(UnifiedInterceptor));

  // 全局异常过滤器 - 统一错误处理
  app.useGlobalFilters(
    new I18nValidationExceptionFilter({
      detailedErrors: true, // 开启详细错误信息，便于调试
    }),
    app.get(GlobalFilter), // 使用依赖注入获取实例
  );
  // 初始化全局错误拦截器
  app.get(GlobalErrorInterceptor);

  // ==================== 全局 JWT 认证守卫 ====================
  // 所有接口默认需要认证，使用 @Public() 装饰器标记公开接口
  app.useGlobalGuards(app.get(JwtAuthGuard));
  // Swagger API 文档配置 - 仅在非生产环境启用
  const isProduction = config.get('env') === 'prd' || process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Swagger API 文档配置
    const swaggerConfig = new DocumentBuilder()
      .setTitle("inkverse API")
      .setDescription("inkverse API 接口文档")
      .setVersion("1.0")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          name: "Authorization",
          description: "请输入 JWT token（登录后获取）",
          in: "header",
        },
        "Authorization"
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("docs", app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    });
  }

  const port = config.get("port") || 8080;
  await app.listen(port, "0.0.0.0");

  Logger.log(`🚀 inkverse API 系统启动成功`);
  Logger.log(`📍 服务地址: ${await app.getUrl()}`);
  Logger.log(`📚 API文档: ${await app.getUrl()}/docs`);
  Logger.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap();
