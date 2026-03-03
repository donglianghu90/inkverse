/** 本地持久化存储 — 管理 storage/ 下的 images/videos/audio 目录 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';

@Injectable()
export class LocalStorageService implements OnModuleInit {
  private readonly logger = new Logger('LocalStorage');
  private baseDir = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const storage = (media.storage ?? {}) as Record<string, unknown>;
    this.baseDir = String(storage.baseDir || path.join(process.cwd(), 'storage'));
    for (const sub of ['images', 'videos', 'audio', 'tmp']) {
      const dir = path.join(this.baseDir, sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
    this.logger.log(`存储根目录: ${this.baseDir}`);
  }

  getBaseDir(): string { return this.baseDir; }

  resolve(subPath: string): string { return path.join(this.baseDir, subPath); }

  ensureDramaDir(dramaId: string, type: 'images' | 'videos' | 'audio'): string {
    const dir = path.join(this.baseDir, type, dramaId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getTmpDir(taskId: string): string {
    const dir = path.join(this.baseDir, 'tmp', taskId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  cleanTmpDir(taskId: string): void {
    try { fs.rmSync(path.join(this.baseDir, 'tmp', taskId), { recursive: true, force: true }); } catch {}
  }

  videoOutputPath(dramaId: string, episodeNumber: number): string {
    const dir = this.ensureDramaDir(dramaId, 'videos');
    return path.join(dir, `ep${episodeNumber}.mp4`);
  }

  ttsOutputPath(dramaId: string, shotId: string): string {
    const dir = this.ensureDramaDir(dramaId, 'audio');
    return path.join(dir, `tts_${shotId}.mp3`);
  }

  imageOutputPath(dramaId: string, shotId: string): string {
    const dir = this.ensureDramaDir(dramaId, 'images');
    return path.join(dir, `frame_${shotId}.png`);
  }

  async downloadToLocal(url: string, destPath: string): Promise<string> {
    if (!url.startsWith('http')) return url;
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120_000 });
    fs.writeFileSync(destPath, res.data);
    return destPath;
  }

  writeBase64(destPath: string, base64Data: string): string {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
    return destPath;
  }
}
