import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Request } from 'express';
import { LogService } from '@packages/modules';

@Injectable()
export class UnifiedInterceptor implements NestInterceptor {
  constructor(private readonly logService: LogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    // 设置响应头，禁用缓存（避免 304 状态码）
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    // 记录请求信息
    this.logRequest(request);

    return next.handle().pipe(
      map((data) => {
        // 格式化响应数据
        return this.formatResponse(data);
      }),
      tap((data) => {
        // 记录响应信息
        const duration = Date.now() - startTime;
        this.logResponse(request, data, duration);
      }),
    );
  }

  private formatResponse(data: any): any {
    return data;
  }

  private logRequest(request: Request): void {
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const contentType = headers['content-type'] || '';

    const logContent = `
🚀 请求开始
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 ${method} ${url}
🌐 IP: ${ip}
👤 User-Agent: ${userAgent.substring(0, 100)}${userAgent.length > 100 ? '...' : ''}
📄 Content-Type: ${contentType}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    this.logService.info(logContent, {
      method,
      url,
      ip,
      userAgent: userAgent.substring(0, 100),
      contentType,
      userId: (request as any).user?.id,
      requestId: (request as any).requestId
    });
  }

  private logResponse(request: Request, data: any, duration: number): void {
    const { method, url } = request;
    const isError = data?.code >= 400;
    const status = data?.code || 200;
    const message = data?.message || '操作成功';

    const emoji = isError ? '❌' : '✅';
    const logContent = `
${emoji} 请求完成
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 ${method} ${url}
📊 状态码: ${status}
💬 消息: ${message}
⏱️  耗时: ${duration}ms

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
// ${process.env.NODE_ENV === 'development' ? `📄 响应数据: ${JSON.stringify(data, null, 2)}` : ''}
    const context = {
      method,
      url,
      statusCode: status,
      message,
      duration,
      userId: (request as any).user?.id,
      requestId: (request as any).requestId
    };

    if (isError) {
      this.logService.warn(logContent, context);
    } else {
      this.logService.info(logContent, context);
    }

    // 记录到API专用日志
    this.logService.logApiRequest(method, url, status, duration, context);
  }
} 