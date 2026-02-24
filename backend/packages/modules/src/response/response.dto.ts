/**
 * 分页信息接口
 */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * 成功响应接口
 */
export interface SuccessResponse<T = any> {
  code: number;
  message: string;
  data: T;
}

/**
 * 分页响应接口
 */
export interface PaginationResponse<T = any> {
  code: number;
  message: string;
  data: T[];
  pagination: PaginationInfo;
} 