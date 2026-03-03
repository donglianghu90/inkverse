/** FFmpeg 视频合成 — Shot视频 + 转场 + TTS + BGM(分段action) + SFX + 环境音 + 字幕 → 完整单集视频 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageService } from './local-storage.service';

const execFileAsync = promisify(execFile);

export interface ComposeShotInput {
  shotId: string;
  videoPath: string; // 本地文件路径或 URL
  ttsAudioPath?: string; // TTS 语音文件
  durationSec: number;
  transition: string; // cut / fade_black / fade_white / dissolve / wipe_left / wipe_right / flash / match_cut
  subtitle?: { text: string; style: string };
  bgmPath?: string;
  bgmIntensity?: number; // 0-1
  bgmAction?: string; // continue / fade_in / fade_out / swell / drop_to_silence / cut
  sfxPaths?: string[];
  ambiencePath?: string;
}

export interface ComposeEpisodeInput {
  episodeId: string;
  shots: ComposeShotInput[];
  outputPath: string;
  aspectRatio?: string; // 9:16 / 16:9
  fps?: number;
}

export interface ComposeResult {
  outputPath: string;
  durationSec: number;
  fileSizeMb: number;
}

const XFADE_DURATION = 0.5; // 转场过渡时长(秒)
const ENCODE_ARGS = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']; // V8: 统一编码参数

/** 将 Shot.transition 映射为 FFmpeg xfade 类型 */
const XFADE_MAP: Record<string, string> = {
  fade_black: 'fadeblack', fade_white: 'fadewhite', dissolve: 'dissolve',
  wipe_left: 'wipeleft', wipe_right: 'wiperight', flash: 'fadewhite',
};

@Injectable()
export class VideoComposerService implements OnModuleInit {
  private readonly logger = new Logger('VideoComposer');
  private ffmpegAvailable = false;
  private tmpDir = '';

  constructor(@Optional() private readonly storage?: LocalStorageService) {}

  onModuleInit() {
    this.tmpDir = this.storage ? this.storage.resolve('tmp') : path.join(os.tmpdir(), 'inkverse-compose');
    if (!fs.existsSync(this.tmpDir)) fs.mkdirSync(this.tmpDir, { recursive: true });
    this.checkFfmpeg();
  }

  private async checkFfmpeg() {
    try {
      await execFileAsync('ffmpeg', ['-version']);
      this.ffmpegAvailable = true;
      this.logger.log('FFmpeg 可用');
    } catch {
      this.ffmpegAvailable = false;
      this.logger.warn('FFmpeg 未安装，视频合成功能不可用。请安装 ffmpeg: brew install ffmpeg');
    }
  }

  isAvailable(): boolean { return this.ffmpegAvailable; }

  /** 合成完整单集视频 — 转场拼接→混合全部音轨→硬字幕→输出 */
  async compose(input: ComposeEpisodeInput): Promise<ComposeResult> {
    if (!this.ffmpegAvailable) throw new Error('FFmpeg 未安装，无法合成视频');
    const { shots, outputPath } = input;
    if (!shots.length) throw new Error('无 Shot 视频输入');

    const workDir = path.join(this.tmpDir, input.episodeId);
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    try {
      const localShots = await this.ensureLocalFiles(shots, workDir);
      const concatPath = await this.concatWithTransitions(localShots, workDir); // V1: 含转场
      const withAudioPath = await this.mixAllAudio(concatPath, localShots, workDir); // V2+V3: TTS+BGM分段+SFX+环境音
      const finalPath = await this.addSubtitles(withAudioPath, localShots, workDir, outputPath, input.aspectRatio); // V7: 适配竖屏
      const stat = fs.statSync(finalPath);
      const duration = await this.getVideoDuration(finalPath);
      this.logger.log(`合成完成: ${finalPath} | ${duration.toFixed(1)}s | ${(stat.size / 1048576).toFixed(1)}MB`);
      return { outputPath: finalPath, durationSec: duration, fileSizeMb: stat.size / 1048576 };
    } finally {
      this.cleanup(workDir);
    }
  }

  // ═══ Step 1: 下载远程文件 ═══

  private async ensureLocalFiles(shots: ComposeShotInput[], workDir: string): Promise<ComposeShotInput[]> {
    const result: ComposeShotInput[] = [];
    for (const shot of shots) {
      let videoPath = shot.videoPath;
      if (videoPath.startsWith('http')) {
        const localPath = path.join(workDir, `${shot.shotId}.mp4`);
        await this.downloadFile(videoPath, localPath);
        videoPath = localPath;
      }
      result.push({ ...shot, videoPath });
    }
    return result;
  }

  // ═══ Step 2: 转场拼接（V1 — xfade 滤镜） ═══

  private async concatWithTransitions(shots: ComposeShotInput[], workDir: string): Promise<string> {
    if (shots.length === 1) return shots[0].videoPath;

    const hasTransition = shots.some((s, i) => i < shots.length - 1 && s.transition !== 'cut' && XFADE_MAP[s.transition]);
    if (!hasTransition) return this.simpleConcatShots(shots, workDir); // 全部 cut 时用流拷贝

    // 先统一所有输入视频的编码（xfade 要求同格式）
    const normalizedPaths = await this.normalizeInputVideos(shots, workDir);
    const inputs: string[] = [];
    normalizedPaths.forEach(p => inputs.push('-i', p));

    // 构建 xfade 链式滤镜：[0:v][1:v]xfade=...[v01]; [v01][2:v]xfade=...[v012]; ...
    const filters: string[] = [];
    let prevLabel = '0:v';
    let timeOffset = shots[0].durationSec;

    for (let i = 1; i < shots.length; i++) {
      const tr = shots[i - 1].transition;
      const xfadeType = XFADE_MAP[tr];
      const outLabel = i === shots.length - 1 ? '[vout]' : `[v${i}]`;

      if (xfadeType) {
        const offset = Math.max(timeOffset - XFADE_DURATION, 0);
        filters.push(`[${prevLabel}][${i}:v]xfade=transition=${xfadeType}:duration=${XFADE_DURATION}:offset=${offset.toFixed(3)}${outLabel}`);
        timeOffset += shots[i].durationSec - XFADE_DURATION;
      } else { // cut — 直接拼接
        filters.push(`[${prevLabel}][${i}:v]concat=n=2:v=1:a=0${outLabel}`);
        timeOffset += shots[i].durationSec;
      }
      prevLabel = outLabel.replace(/[\[\]]/g, '');
    }

    // 音频流简单 concat
    const audioLabels = shots.map((_, i) => `[${i}:a]`).join('');
    filters.push(`${audioLabels}concat=n=${shots.length}:v=0:a=1[aout]`);

    const output = path.join(workDir, 'transitions.mp4');
    await this.ffmpeg([
      ...inputs, '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]', ...ENCODE_ARGS, '-y', output,
    ]);
    return output;
  }

  /** 全 cut 时使用流拷贝 concat */
  private async simpleConcatShots(shots: ComposeShotInput[], workDir: string): Promise<string> {
    const listFile = path.join(workDir, 'concat.txt');
    fs.writeFileSync(listFile, shots.map(s => `file '${s.videoPath.replace(/'/g, "'\\''")}'`).join('\n'));
    const output = path.join(workDir, 'concat.mp4');
    await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', output]);
    return output;
  }

  /** 统一输入视频为相同编码/分辨率（xfade 要求） */
  private async normalizeInputVideos(shots: ComposeShotInput[], workDir: string): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const out = path.join(workDir, `norm_${i}.mp4`);
      await this.ffmpeg(['-i', shots[i].videoPath, ...ENCODE_ARGS, '-y', out]);
      paths.push(out);
    }
    return paths;
  }

  // ═══ Step 3: 混合全部音轨（V2+V3 — TTS + BGM分段 + SFX + 环境音） ═══

  private async mixAllAudio(videoPath: string, shots: ComposeShotInput[], workDir: string): Promise<string> {
    const inputs = ['-i', videoPath];
    const filters: string[] = [];
    const audioStreams: string[] = ['[0:a]']; // 原始音轨
    let inputIdx = 1;

    // ── TTS 台词音轨 ──
    let offset = 0;
    const ttsStreams: string[] = [];
    for (const shot of shots) {
      if (shot.ttsAudioPath && fs.existsSync(shot.ttsAudioPath)) {
        inputs.push('-i', shot.ttsAudioPath);
        const delayMs = Math.round(offset * 1000);
        const label = `tts${inputIdx}`;
        filters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=1.0[${label}]`);
        ttsStreams.push(`[${label}]`);
        inputIdx++;
      }
      offset += shot.durationSec;
    }
    if (ttsStreams.length) {
      filters.push(`${ttsStreams.join('')}amix=inputs=${ttsStreams.length}:duration=longest:normalize=0[tts_mix]`);
      audioStreams.push('[tts_mix]');
    }

    // ── BGM 分段（V3 — 按 bgmAction 处理 fade_in/fade_out/swell/drop_to_silence） ──
    offset = 0;
    const bgmStreams: string[] = [];
    let currentBgm = '', currentBgmStart = 0, currentBgmIntensity = 0.3, currentBgmAction = 'continue';
    const flushBgm = (endOffset: number) => {
      if (!currentBgm || !fs.existsSync(currentBgm)) return;
      inputs.push('-i', currentBgm);
      const dur = endOffset - currentBgmStart;
      const delayMs = Math.round(currentBgmStart * 1000);
      const label = `bgm${inputIdx}`;
      let fadeFilter = `[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${dur.toFixed(3)},adelay=${delayMs}|${delayMs},volume=${currentBgmIntensity}`;
      if (currentBgmAction === 'fade_in') fadeFilter += `,afade=t=in:d=1.5`;
      else if (currentBgmAction === 'fade_out') fadeFilter += `,afade=t=out:st=${Math.max(dur - 2, 0).toFixed(3)}:d=2`;
      else if (currentBgmAction === 'swell') fadeFilter += `,volume=1.5:enable='between(t,0,1)'`; // 前1秒音量涌起
      else if (currentBgmAction === 'drop_to_silence') fadeFilter += `,afade=t=out:st=0:d=0.5`;
      fadeFilter += `[${label}]`;
      filters.push(fadeFilter);
      bgmStreams.push(`[${label}]`);
      inputIdx++;
    };

    for (const shot of shots) {
      const newBgm = shot.bgmPath && fs.existsSync(shot.bgmPath) ? shot.bgmPath : '';
      const newAction = shot.bgmAction ?? 'continue';

      if (newBgm && (newBgm !== currentBgm || newAction !== 'continue')) {
        if (currentBgm) flushBgm(offset);
        currentBgm = newBgm;
        currentBgmStart = offset;
        currentBgmIntensity = shot.bgmIntensity ?? 0.3;
        currentBgmAction = newAction;
      } else if (!newBgm && currentBgm && newAction === 'drop_to_silence') {
        currentBgmAction = 'drop_to_silence';
        flushBgm(offset + 0.5); // 0.5s 快速淡出
        currentBgm = '';
      }
      offset += shot.durationSec;
    }
    if (currentBgm) flushBgm(offset);

    if (bgmStreams.length) {
      filters.push(`${bgmStreams.join('')}amix=inputs=${bgmStreams.length}:duration=longest:normalize=0[bgm_mix]`);
      audioStreams.push('[bgm_mix]');
    }

    // ── SFX 音效（V2） ──
    offset = 0;
    const sfxStreams: string[] = [];
    for (const shot of shots) {
      if (shot.sfxPaths?.length) {
        for (const sfxPath of shot.sfxPaths) {
          if (!fs.existsSync(sfxPath)) continue;
          inputs.push('-i', sfxPath);
          const delayMs = Math.round(offset * 1000);
          const label = `sfx${inputIdx}`;
          filters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs},volume=0.8[${label}]`);
          sfxStreams.push(`[${label}]`);
          inputIdx++;
        }
      }
      offset += shot.durationSec;
    }
    if (sfxStreams.length) {
      filters.push(`${sfxStreams.join('')}amix=inputs=${sfxStreams.length}:duration=longest:normalize=0[sfx_mix]`);
      audioStreams.push('[sfx_mix]');
    }

    // ── 环境音（V2） ──
    offset = 0;
    const ambStreams: string[] = [];
    let currentAmb = '', currentAmbStart = 0;
    const flushAmb = (endOffset: number) => {
      if (!currentAmb || !fs.existsSync(currentAmb)) return;
      inputs.push('-i', currentAmb);
      const dur = endOffset - currentAmbStart;
      const delayMs = Math.round(currentAmbStart * 1000);
      const label = `amb${inputIdx}`;
      filters.push(`[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${dur.toFixed(3)},adelay=${delayMs}|${delayMs},volume=0.15,afade=t=in:d=1,afade=t=out:st=${Math.max(dur - 1, 0).toFixed(3)}:d=1[${label}]`);
      ambStreams.push(`[${label}]`);
      inputIdx++;
    };

    for (const shot of shots) {
      const newAmb = shot.ambiencePath && fs.existsSync(shot.ambiencePath) ? shot.ambiencePath : '';
      if (newAmb !== currentAmb) {
        if (currentAmb) flushAmb(offset);
        currentAmb = newAmb;
        currentAmbStart = offset;
      }
      offset += shot.durationSec;
    }
    if (currentAmb) flushAmb(offset);

    if (ambStreams.length) {
      filters.push(`${ambStreams.join('')}amix=inputs=${ambStreams.length}:duration=longest:normalize=0[amb_mix]`);
      audioStreams.push('[amb_mix]');
    }

    // ── 无额外音轨则直接返回 ──
    if (audioStreams.length <= 1) return videoPath;

    // ── 最终混合 ──
    filters.push(`${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=2:normalize=0[final_audio]`);

    const output = path.join(workDir, 'with_audio.mp4');
    await this.ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[final_audio]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', output]);
    return output;
  }

  // ═══ Step 4: 字幕（V7 — 适配竖屏） ═══

  private async addSubtitles(videoPath: string, shots: ComposeShotInput[], workDir: string, outputPath: string, aspectRatio?: string): Promise<string> {
    const subtitleShots = shots.filter(s => s.subtitle?.text);
    if (!subtitleShots.length) {
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }

    const isVertical = aspectRatio === '9:16' || aspectRatio === '3:4';
    const resX = isVertical ? 1080 : 1920;
    const resY = isVertical ? 1920 : 1080;
    const fontSize = isVertical ? 40 : 48;
    const marginV = isVertical ? 60 : 30;

    const assPath = path.join(workDir, 'subs.ass');
    let offset = 0;
    const events: string[] = [];
    for (const shot of shots) {
      if (shot.subtitle?.text) {
        const start = this.formatAssTime(offset);
        const end = this.formatAssTime(offset + shot.durationSec);
        const style = shot.subtitle.style === 'emphasis' ? '{\\b1}' : shot.subtitle.style === 'whisper' ? '{\\alpha&H80&}' : '';
        events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${style}${shot.subtitle.text}`);
      }
      offset += shot.durationSec;
    }
    const assContent = [
      `[Script Info]`, `ScriptType: v4.00+`, `PlayResX: ${resX}`, `PlayResY: ${resY}`, ``,
      `[V4+ Styles]`,
      `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`,
      `Style: Default,Noto Sans SC,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,${marginV},1`, ``,
      `[Events]`,
      `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`,
      ...events,
    ].join('\n');
    fs.writeFileSync(assPath, assContent);

    await this.ffmpeg(['-i', videoPath, '-vf', `ass=${assPath}`, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-y', outputPath]);
    return outputPath;
  }

  // ═══ 工具方法 ═══

  private async ffmpeg(args: string[]): Promise<void> {
    try {
      await execFileAsync('ffmpeg', args, { maxBuffer: 50 * 1024 * 1024 });
    } catch (err: any) {
      const stderr = err.stderr?.slice(-500) ?? err.message;
      this.logger.error(`FFmpeg 执行失败: ${stderr}`);
      throw new Error(`FFmpeg 错误: ${stderr}`);
    }
  }

  private async getVideoDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
      return parseFloat(stdout.trim()) || 0;
    } catch { return 0; }
  }

  private async downloadFile(url: string, dest: string): Promise<void> {
    const axios = (await import('axios')).default;
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120_000 });
    fs.writeFileSync(dest, res.data);
  }

  private formatAssTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }

  private cleanup(workDir: string) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}
