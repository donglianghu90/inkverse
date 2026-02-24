declare module '*.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare namespace API {
  /**
   * 通用响应数据
   */
  type ResponseData<T = any> = {
    code: number;
    data: T;
    message?: string;
    success?: boolean;
  };

  /**
   * 分页参数
   */
  type PageParams = {
    page?: number;
    pageSize?: number;
    keyword?: string;
  };

  /**
   * 分页结果
   */
  type PageResult<T> = {
    list: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };

  /**
   * 当前用户信息
   */
  type CurrentUser = {
    id: string;
    username: string;
    email: string;
    realName: string;
    role: 'super_admin' | 'admin';
    status: 'active' | 'inactive';
    lastLoginAt?: string;
    createdAt: string;
  };

  /**
   * 企业信息
   */
  type Enterprise = {
    id: string;
    name: string;
    code?: string;
    contactName: string;
    contactPhone: string;
    contactEmail?: string;
    address?: string;
    industry?: string;
    scale?: string;
    remark?: string;
    status: 'active' | 'inactive' | 'suspended';
    createdAt: string;
    updatedAt: string;
  };

  /**
   * 企业管理员账号
   */
  type EnterpriseAdmin = {
    id: string;
    enterpriseId: string;
    username: string;
    email: string;
    realName?: string;
    phone?: string;
    isInitialAdmin: boolean;
    status: 'active' | 'inactive';
    lastLoginAt?: string;
    createdAt: string;
    updatedAt: string;
    enterprise?: {
      id: string;
      name: string;
      code: string;
    };
  };

  /**
   * 超级管理员
   */
  type AdminUser = {
    id: string;
    username: string;
    email: string;
    realName?: string;
    role: 'super_admin' | 'admin';
    status: 'active' | 'inactive';
    lastLoginAt?: string;
    createdAt: string;
    updatedAt: string;
  };

  /**
   * 订阅套餐
   */
  type SubscriptionPlan = {
    id: string;
    name: string;
    code: string;
    durationDays: number;
    price?: number; // 价格（分）
    maxUsers?: number; // 最大用户数
    maxStorage?: number; // 最大存储空间（GB）
    features?: string[]; // 功能列表
    description?: string;
    status: 'active' | 'inactive';
    createdAt: string;
    updatedAt: string;
  };

  /**
   * 企业订阅
   */
  type Subscription = {
    id: string;
    enterpriseId: string;
    planId: string;
    status: 'active' | 'expired' | 'cancelled';
    startDate: string;
    endDate: string;
    createdAt: string;
    updatedAt: string;
    enterprise?: {
      id: string;
      name: string;
      code: string;
    };
    plan?: {
      id: string;
      name: string;
      code: string;
    };
  };

  /**
   * 审计日志
   */
  type AuditLog = {
    id: string;
    operatorId: string;
    operatorName: string;
    action: string;
    resource: string;
    resourceId: string;
    changes?: Record<string, any>;
    ip?: string;
    userAgent?: string;
    createdAt: string;
  };

  /**
   * 仪表板统计数据
   */
  type DashboardStats = {
    totalEnterprises: number;
    activeEnterprises: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    expiringCount: number;
    totalAccounts: number;
  };
}
