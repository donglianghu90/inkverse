/** 火山引擎方舟 HTTP 客户端 — 统一鉴权、重试、日志 */
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Logger } from '@nestjs/common';

export interface VolcengineClientConfig {
  apiKey: string;
  baseUrl: string; // https://ark.cn-beijing.volces.com/api/v3
  timeoutMs?: number;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export class VolcengineClient {
  private readonly http: AxiosInstance;
  private readonly logger = new Logger('VolcengineClient');

  constructor(private readonly config: VolcengineClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 120_000,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    });
  }

  async post<T = unknown>(path: string, body: Record<string, unknown>, opts?: AxiosRequestConfig): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        const t0 = Date.now();
        const res = await this.http.post<T>(path, body, opts);
        this.logger.debug(`POST ${path} → ${res.status} (${Date.now() - t0}ms)`);
        return res.data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status ?? 0;
        if (!RETRYABLE.has(status) || i >= MAX_RETRIES) break;
        const delay = RETRY_DELAY_MS * Math.pow(2, i) * (0.5 + Math.random() * 0.5);
        this.logger.warn(`POST ${path} → ${status}, 第${i + 1}次重试 (${Math.round(delay)}ms)`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    const msg = (lastErr as any)?.response?.data?.error?.message ?? (lastErr as Error).message;
    this.logger.error(`POST ${path} 失败: ${msg}`);
    throw lastErr;
  }

  async get<T = unknown>(path: string, opts?: AxiosRequestConfig): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= MAX_RETRIES; i++) {
      try {
        const res = await this.http.get<T>(path, opts);
        return res.data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status ?? 0;
        if (!RETRYABLE.has(status) || i >= MAX_RETRIES) break;
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, i)));
      }
    }
    throw lastErr;
  }

  async delete<T = unknown>(path: string): Promise<T> {
    const res = await this.http.delete<T>(path);
    return res.data;
  }
}
