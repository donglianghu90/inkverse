import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import OSS from 'ali-oss';
import { OssOptions } from './oss.module';
import axios from 'axios';

export interface OssConfig {
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  endpoint?: string;
  internal?: boolean;
  secure?: boolean;
  timeout?: number;
}

export interface UploadResult {
  name: string;
  url: string;
}

export interface UploadOptions {
  fileName?: string;
  headers?: Record<string, string>;
  meta?: Record<string, string>;
  mime?: string;
}


@Injectable()
export class OssService implements OnModuleInit {
  private ossClient: OSS | null = null;

  constructor(
    @Inject('OSS_CONFIG') private readonly ossConfig: OssConfig,
    @Inject('OSS_OPTIONS') private readonly options: OssOptions,
  ) {}

  async onModuleInit() {
    Logger.log('OssService 初始化开始');

    try {
      await this.initializeOssClient();
      Logger.log('OssService 初始化完成');
    } catch (error) {
      Logger.error('OssService 初始化失败', error);
      if (this.options.enableHealthCheck) {
        throw error;
      }
    }
  }

  private async initializeOssClient() {
    try {
      if (!this.ossConfig) {
        throw new Error('OSS 配置未找到');
      }

      this.ossClient = new OSS({
        region: this.ossConfig.region,
        accessKeyId: this.ossConfig.accessKeyId,
        accessKeySecret: this.ossConfig.accessKeySecret,
        bucket: this.ossConfig.bucket,
        // endpoint: this.ossConfig.endpoint,
        // internal: this.ossConfig.internal,
        secure: this.ossConfig.secure !== undefined ? this.ossConfig.secure : true,
        timeout: this.ossConfig.timeout,
      });

      Logger.log('OSS 客户端初始化成功');

      // 健康检查
      if (this.options.enableHealthCheck) {
        await this.healthCheck();
      }
    } catch (error) {
      Logger.error('OSS 客户端初始化失败', error);
      throw error;
    }
  }

  private async healthCheck() {
    try {
      if (!this.ossClient) {
        throw new Error('OSS 客户端未初始化');
      }

      // 尝试列出存储桶信息来验证连接
      await this.ossClient.getBucketInfo(this.ossConfig.bucket);
      Logger.log('OSS 健康检查通过');
    } catch (error) {
      Logger.error('OSS 健康检查失败', error);
      throw new Error(
        `OSS 健康检查失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 上传文件
   * @param objectName 对象名称（文件路径）
   * @param file 文件内容（Buffer、Stream 或本地文件路径）
   * @param options 上传选项
   * @returns 上传结果
   */
  async uploadFile(
    objectName: string,
    file: Buffer | NodeJS.ReadableStream | string,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const uploadOptions: any = {};

      if (options.headers) {
        uploadOptions.headers = options.headers;
      }

      if (options.meta) {
        uploadOptions.meta = options.meta;
      }

      if (options.mime) {
        uploadOptions.mime = options.mime;
      }

      const result = await this.ossClient.put(objectName, file, uploadOptions);

      Logger.log(`文件上传成功: ${objectName}`);

      return {
        name: result.name,
        url: result.url,
      };
    } catch (error) {
      Logger.error(`文件上传失败: ${objectName}`, error);
      throw new Error(
        `文件上传失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async uploadBase64Image(
    base64Image: string,
    objectName: string,
  ): Promise<UploadResult> {
    const base64data = base64Image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64data, 'base64');
    return this.uploadFile(objectName, buffer);
  }

  /**
   * 从在线 URL 上传图片到 OSS
   * @param url 图片的在线 URL
   * @param ossPath OSS 存储路径
   * @returns 上传结果
   */
  async uploadFromUrl(url: string, ossPath: string): Promise<UploadResult> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      const result = await this.uploadFile(ossPath, buffer);
      return result;
    } catch (error) {
      Logger.error(`从 URL 上传图片失败: ${url} -> ${ossPath}`, error);
      throw new Error(`从 URL 上传图片失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 下载文件
   * @param objectName 对象名称
   * @returns 文件内容
   */
  async downloadFile(objectName: string): Promise<Buffer> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const result = await this.ossClient.get(objectName);
      Logger.log(`文件下载成功: ${objectName}`);
      return result.content as Buffer;
    } catch (error) {
      Logger.error(`文件下载失败: ${objectName}`, error);
      throw new Error(
        `文件下载失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 删除文件
   * @param objectName 对象名称
   */
  async deleteFile(objectName: string): Promise<void> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      await this.ossClient.delete(objectName);
      Logger.log(`文件删除成功: ${objectName}`);
    } catch (error) {
      Logger.error(`文件删除失败: ${objectName}`, error);
      throw new Error(
        `文件删除失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 批量删除文件
   * @param objectNames 对象名称数组
   */
  async deleteMultipleFiles(objectNames: string[]): Promise<void> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      await this.ossClient.deleteMulti(objectNames);
      Logger.log(`批量删除文件成功: ${objectNames.length} 个文件`);
    } catch (error) {
      Logger.error(`批量删除文件失败`, error);
      throw new Error(
        `批量删除文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 检查文件是否存在
   * @param objectName 对象名称
   * @returns 是否存在
   */
  async fileExists(objectName: string): Promise<boolean | OSS.HeadObjectResult> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      return await this.ossClient.head(objectName);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        return false;
      }
      Logger.error(`检查文件存在性失败: ${objectName}`, error);
      throw new Error(
        `检查文件存在性失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 从阿里云 OSS URL 中提取对象名称
   * @param ossUrl 完整的阿里云 OSS URL
   * @returns 对象名称
   */
  private extractObjectNameFromUrl(ossUrl: string): string {
    try {
      // 匹配阿里云 OSS URL 格式: https://{bucket}.{endpoint}/{objectName}
      // 或者: https://{endpoint}/{bucket}/{objectName}
      const url = new URL(ossUrl);
      let objectName = '';

      // 格式: https://bucket.oss-region.aliyuncs.com/path/to/file
      objectName = decodeURIComponent(url.pathname.substring(1)); // 移除开头的 '/'

      if (!objectName) {
        throw new Error('无法从 URL 中提取对象名称');
      }

      return objectName;
    } catch (error) {
      Logger.error(`从 URL 提取对象名称失败: ${ossUrl}`, error);
      throw new Error(
        `从 URL 提取对象名称失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取文件信息（支持对象名称或完整URL）
   * @param objectNameOrUrl 对象名称或完整的阿里云OSS URL
   * @returns 文件信息
   */
  async getFileInfo(objectNameOrUrl: string): Promise<any> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      let objectName = objectNameOrUrl;

      // 判断是否为完整的URL
      if (
        objectNameOrUrl.startsWith('http://') ||
        objectNameOrUrl.startsWith('https://')
      ) {
        objectName = this.extractObjectNameFromUrl(objectNameOrUrl);
        Logger.log(`从URL提取对象名称: ${objectName}`);
      }

      const result = await this.ossClient.head(objectName);
      return result.res.headers;
    } catch (error) {
      Logger.error(`获取文件信息失败: ${objectNameOrUrl}`, error);
      return null;
    }
  }

  /**
   * 列出文件
   * @param prefix 前缀
   * @param maxKeys 最大返回数量
   * @returns 文件列表
   */
  async listFiles(prefix?: string, maxKeys: number = 1000): Promise<any[]> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const options: any = { 'max-keys': maxKeys };
      if (prefix) {
        options.prefix = prefix;
      }

      const result = await this.ossClient.list(options, {});
      Logger.log(`列出文件成功: ${result.objects?.length || 0} 个文件`);
      return result.objects || [];
    } catch (error) {
      Logger.error(`列出文件失败`, error);
      throw new Error(
        `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 生成签名 URL
   * @param objectName 对象名称
   * @param expires 过期时间（秒）
   * @returns 签名 URL
   */
  async generateSignedUrl(
    objectName: string,
    expires: number = 3600,
  ): Promise<string> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const url = this.ossClient.signatureUrl(objectName, { expires });
      Logger.log(`生成签名 URL 成功: ${objectName}`);
      return url;
    } catch (error) {
      Logger.error(`生成签名 URL 失败: ${objectName}`, error);
      throw new Error(
        `生成签名 URL 失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 复制文件
   * @param sourceObjectName 源对象名称
   * @param targetObjectName 目标对象名称
   * @param sourceBucket 源存储桶（可选，默认为当前存储桶）
   */
  async copyFile(
    sourceObjectName: string,
    targetObjectName: string,
    sourceBucket?: string,
  ): Promise<void> {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }

    try {
      const source = sourceBucket
        ? `/${sourceBucket}/${sourceObjectName}`
        : sourceObjectName;

     const result = await this.ossClient.copy(targetObjectName, source);
      Logger.log(`文件复制成功: ${sourceObjectName} -> ${targetObjectName}`);
      Logger.log(`文件复制结果: ${JSON.stringify(result, null, 2)}`);
      return result;
    } catch (error) {
      Logger.error(
        `文件复制失败: ${sourceObjectName} -> ${targetObjectName}`,
        error,
      );
      throw new Error(
        `文件复制失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取 OSS 客户端实例（用于高级操作）
   * @returns OSS 客户端实例
   */
  getClient(): OSS {
    if (!this.ossClient) {
      throw new Error('OSS 客户端未初始化');
    }
    return this.ossClient;
  }

  /**
   * 获取当前配置
   * @returns OSS 配置
   */
  getConfig(): OssConfig {
    return this.ossConfig;
  }
}
