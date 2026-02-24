import { RequestConfig, history } from '@umijs/max';
import { message } from 'antd';

export async function getInitialState(): Promise<Record<string, unknown>> {
  return {};
}

export const request: RequestConfig = {
  timeout: 120000,
  errorConfig: {
    errorHandler: (error: any) => {
      const { response } = error;
      if (response?.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user_info');
        if (window.location.pathname !== '/login') {
          message.warning('登录已过期，请重新登录');
          history.push('/login');
        }
        return;
      }
      if (response?.status) {
        message.error(`请求错误 ${response.status}: ${response.statusText}`);
      } else if (!response) {
        message.error('网络异常，请检查网络连接');
      }
      throw error;
    },
  },
  requestInterceptors: [
    (url: string, options: any) => {
      const token = localStorage.getItem('token');
      if (token) {
        options.headers = {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        };
      }
      return { url, options };
    },
  ],
};
