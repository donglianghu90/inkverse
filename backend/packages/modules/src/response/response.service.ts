import { Injectable } from '@nestjs/common';
import { SuccessResponse, PaginationResponse, PaginationInfo } from './response.dto';

/**
 * 响应服务
 * 提供统一的响应创建方法
 */
@Injectable()
export class ResponseService implements SuccessResponse<any>, PaginationResponse<any> {
  // 实现接口属性
  code: number = 200;
  message: string = '操作成功';
  data: any = null;
  pagination: PaginationInfo = { page: 1, limit: 10, total: 0, totalPages: 0 };

  /**
   * 成功响应
   */
  success<T>(data: T, message: string = '操作成功', code: number = 200): SuccessResponse<T> {
    return {
      code,
      message,
      data,
    };
  }

  /**
   * 错误响应
   */
  error(message: string, code: number = 400, data: any = null): any {
    return {
      code,
      message,
      data,
    };
  }

  /**
   * 分页响应
   */
  paginated<T>(
    data: T[],
    page: number,
    limit: number,
    total: number,
    message: string = '查询成功'
  ): PaginationResponse<T> {
    return {
      code: 200,
      message,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 静态方法 - 成功响应
   */
  static success<T>(data: T, message: string = '操作成功', code: number = 200): SuccessResponse<T> {
    return {
      code,
      message,
      data,
    };
  }

  /**
   * 静态方法 - 错误响应
   */
  static error(message: string, code: number = 400, data: any = null): any {
    return {
      code,
      message,
      data,
    };
  }

  /**
   * 静态方法 - 分页响应
   */
  static paginated<T>(
    data: T[],
    page: number,
    limit: number,
    total: number,
    message: string = '查询成功'
  ): PaginationResponse<T> {
    return {
      code: 200,
      message,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

/**
 * 便捷的响应函数别名
 */
export const success = ResponseService.success;
export const error = ResponseService.error;
export const paginated = ResponseService.paginated;
