import { RequestConfig, history } from '@umijs/max';
import { message } from 'antd';
import { getProfile, getToken, clearAuth, type UserInfo } from '@/services/auth';

const PUBLIC_PATHS = ['/login']; // 无需登录即可访问的页面

export async function getInitialState(): Promise<{ currentUser?: UserInfo }> {
  if (PUBLIC_PATHS.includes(history.location.pathname)) return {};
  if (!getToken()) { history.push('/login'); return {}; }
  try {
    const currentUser = await getProfile();
    if (currentUser?.id) return { currentUser };
  } catch {} // 401 由 errorHandler 统一处理跳转
  return {};
}

export const request: RequestConfig = {
  errorConfig: {
    errorHandler: (error: any) => {
      const { response } = error;
      if (response?.status === 401) {
        clearAuth();
        if (window.location.pathname !== '/login') {
          message.warning('登录已过期，请重新登录');
          history.push('/login');
        }
        return;
      }
      if (response?.status) message.error(`请求错误 ${response.status}: ${response.statusText}`);
      else if (!response) message.error('网络异常，请检查网络连接');
      throw error;
    },
  },
  requestInterceptors: [
    (url: string, options: any) => {
      const token = getToken();
      if (token) options.headers = { ...options.headers, Authorization: `Bearer ${token}` };
      return { url, options };
    },
  ],
};
