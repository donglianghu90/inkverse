/** 视频后处理器 — 基于 FFmpeg 的 per-shot 后处理：调色/特效/速度变化/稳定化/Ken Burns */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);

import type { ColorGrade, PostProcessOptions, PostProcessResult } from './interfaces/post-process.interface';

export type { ColorGrade, PostProcessOptions, PostProcessResult } from './interfaces/post-process.interface';

const COLOR_FILTERS: Record<ColorGrade, string> = {
  warm: 'colortemperature=temperature=6800,eq=saturation=1.15:brightness=0.03',
  cold: 'colortemperature=temperature=4500,eq=saturation=0.9:brightness=-0.02',
  high_contrast: 'eq=contrast=1.3:brightness=0.02:saturation=1.1',
  desaturated: 'eq=saturation=0.6:brightness=-0.03',
  golden_hour: 'colortemperature=temperature=7200,eq=saturation=1.2:brightness=0.05',
  noir: 'eq=saturation=0.3:contrast=1.4:brightness=-0.05',
  neutral: '',
};

@Injectable()
export class VideoPostProcessorService implements OnModuleInit {
  private readonly logger = new Logger('VideoPostProcessor');
  private ffmpegAvailable = false;

  async onModuleInit() {
    try {
      await execFileAsync('ffmpeg', ['-version']);
      this.ffmpegAvailable = true;
    } catch {
      this.ffmpegAvailable = false;
      this.logger.warn('FFmpeg 未安装，视频后处理不可用');
    }
  }

  isAvailable(): boolean { return this.ffmpegAvailable; }

  /** 对单个 Shot 视频文件执行后处理 */
  async processShot(inputPath: string, outputPath: string, opts: PostProcessOptions): Promise<PostProcessResult> {
    if (!this.ffmpegAvailable) {
      if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
      return { outputPath, durationSec: opts.durationSec ?? 0 };
    }

    const filters: string[] = [];
    let speedFactor = opts.speedFactor ?? 1.0;

    if (opts.stabilize && !opts.kenBurns) {
      filters.push('deshake=rx=32:ry=32');
    }

    if (opts.colorGrade && opts.colorGrade !== 'neutral') {
      const cf = COLOR_FILTERS[opts.colorGrade];
      if (cf) filters.push(cf);
    }

    if (speedFactor !== 1.0 && speedFactor > 0) {
      const pts = 1 / speedFactor;
      filters.push(`setpts=${pts.toFixed(4)}*PTS`);
    }

    if (!filters.length && !opts.kenBurns) {
      if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
      const dur = opts.durationSec ?? await this.probeDuration(inputPath);
      return { outputPath, durationSec: dur / (speedFactor || 1) };
    }

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const audioFilters: string[] = [];
    if (speedFactor !== 1.0 && speedFactor > 0) {
      audioFilters.push(`atempo=${this.clampAtempo(speedFactor)}`);
    }

    const args = ['-i', inputPath];
    if (filters.length) args.push('-vf', filters.join(','));
    if (audioFilters.length) args.push('-af', audioFilters.join(','));
    args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
    args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-y', outputPath);

    try {
      await execFileAsync('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 });
    } catch (err: any) {
      this.logger.error(`Shot后处理失败: ${err.stderr?.slice(-300) ?? err.message}`);
      if (inputPath !== outputPath) fs.copyFileSync(inputPath, outputPath);
    }

    const finalDur = await this.probeDuration(outputPath);
    return { outputPath, durationSec: finalDur };
  }

  /** Ken Burns 效果：从静态图片生成带平移/缩放运动的视频 */
  async applyKenBurns(
    imagePath: string,
    outputPath: string,
    durationSec: number,
    kenBurns: { direction: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'; zoomFactor: number },
    colorGrade?: ColorGrade,
  ): Promise<PostProcessResult> {
    if (!this.ffmpegAvailable) return { outputPath: imagePath, durationSec: 0 };

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fps = 24;
    const totalFrames = Math.ceil(durationSec * fps);
    const z = kenBurns.zoomFactor;

    let zoompan: string;
    switch (kenBurns.direction) {
      case 'zoom_in':
        zoompan = `zoompan=z='1+${((z - 1) / totalFrames).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
        break;
      case 'zoom_out':
        zoompan = `zoompan=z='${z}-${((z - 1) / totalFrames).toFixed(6)}*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
        break;
      case 'pan_left':
        zoompan = `zoompan=z='${z}':x='iw*${z}-iw-on*${((z - 1) * 2 / totalFrames).toFixed(6)}*iw':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
        break;
      case 'pan_right':
        zoompan = `zoompan=z='${z}':x='on*${((z - 1) * 2 / totalFrames).toFixed(6)}*iw':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=1080x1920:fps=${fps}`;
        break;
    }

    const filters = [zoompan];
    if (colorGrade && colorGrade !== 'neutral') {
      const cf = COLOR_FILTERS[colorGrade];
      if (cf) filters.push(cf);
    }

    const args = [
      '-loop', '1', '-i', imagePath,
      '-vf', filters.join(','),
      '-t', durationSec.toFixed(2),
      '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-an', '-y', outputPath,
    ];

    try {
      await execFileAsync('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 });
      this.logger.debug(`Ken Burns 完成: ${kenBurns.direction} ${durationSec}s → ${outputPath}`);
    } catch (err: any) {
      this.logger.error(`Ken Burns 失败: ${err.stderr?.slice(-300) ?? err.message}`);
      return { outputPath: imagePath, durationSec: 0 };
    }

    return { outputPath, durationSec };
  }

  /** 检测是否需要后处理（任一选项非默认值时返回 true） */
  needsProcessing(opts: PostProcessOptions): boolean {
    if (opts.kenBurns) return true;
    if (opts.specialTechnique) return true;
    if (opts.colorGrade && opts.colorGrade !== 'neutral') return true;
    if (opts.stabilize) return true;
    if (opts.speedFactor && opts.speedFactor !== 1.0) return true;
    return false;
  }

  private async probeDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
      ]);
      return parseFloat(stdout.trim()) || 0;
    } catch { return 0; }
  }

  /** FFmpeg atempo 限制在 0.5-2.0 之间，超出需要链式 */
  private clampAtempo(speed: number): string {
    if (speed >= 0.5 && speed <= 2.0) return speed.toFixed(2);
    if (speed < 0.5) return `${(0.5).toFixed(2)},atempo=${(speed / 0.5).toFixed(2)}`;
    return `${(2.0).toFixed(2)},atempo=${(speed / 2.0).toFixed(2)}`;
  }
}
