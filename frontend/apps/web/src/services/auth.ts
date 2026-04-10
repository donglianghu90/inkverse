import { request } from '@umijs/max';


export interface LoginParams {
  username: string;
  password: string;
}

export interface UserInfo {
  id: string;
  username: string;
  email?: string;
  realName?: string;
  role: string;
  status: string;
}

export interface LoginResult {
  token: string;
  admin: UserInfo;
}

export async function login(data: LoginParams): Promise<LoginResult> {
  const res = await request(`/auth/login`, { method: 'POST', data });
  if (res?.data) return res.data;
  return res;
}

export async function register(data: LoginParams): Promise<LoginResult> {
  const res = await request(`/auth/register`, { method: 'POST', data });
  if (res?.data) return res.data;
  return res;
}

export async function getProfile(): Promise<UserInfo> {
  const res = await request(`/auth/profile`);
  if (res?.data) return res.data;
  return res;
}

export async function logout(): Promise<void> {
  await request(`/auth/logout`, { method: 'POST' });
}

const TOKEN_KEY = 'token';
const USER_KEY = 'user_info';

export function saveAuth(result: LoginResult) {
  localStorage.setItem(TOKEN_KEY, result.token);
  localStorage.setItem(USER_KEY, JSON.stringify(result.admin));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getSavedUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
