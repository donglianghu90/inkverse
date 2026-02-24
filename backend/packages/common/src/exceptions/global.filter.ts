import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { LogService } from '@packages/modules';

@Injectable()
@Catch()
export class GlobalFilter implements ExceptionFilter {
  constructor(private readonly logService: LogService) {}
  
  async catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 确定HTTP状态码
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        // 处理验证错误的多个消息
        if (Array.isArray(message)) {
          message = message[0];
        }
      }
    } else if (exception?.message) {
      message = exception.message;
    }

    // 记录错误日志
    this.logError(exception, request, status, message);
    
    // 使用统一的响应格式
    const errorResponse = {
      code: status,
      message: message,
      data: null
    };

    // 对于非 401 错误，返回 200 状态码，但 code 字段保持原错误码
    // 401 错误（token 过期等）保持原样返回
    const httpStatus = status === HttpStatus.UNAUTHORIZED ? status : HttpStatus.OK;
    response.status(httpStatus).json(errorResponse);
  }

  private logError(exception: any, request: Request, status: number, message: string): void {
    const { method, url, ip } = request;
    const isServerError = status >= 500;
    
    const logContent = `
${isServerError ? '🔥' : '⚠️'} ${isServerError ? '服务器错误' : '客户端错误'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 ${method} ${url}
🌐 IP: ${ip}
📊 状态码: ${status}
💬 错误信息: ${message}
🔍 异常类型: ${exception.constructor.name}
${isServerError && exception.stack ? `📋 错误堆栈:\n${exception.stack}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    const context = {
      method,
      url,
      ip,
      statusCode: status,
      exceptionType: exception.constructor.name,
      userId: (request as any).user?.id,
      requestId: (request as any).requestId
    };

    if (isServerError) {
      this.logService.error(logContent, exception, context);
    } else {
      this.logService.warn(logContent, context);
    }

    // 同时记录到API日志
    this.logService.logApiRequest(method, url, status, 0, context);
  }
} 