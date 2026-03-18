/** FFmpeg 视频合成 — Shot视频 + 后处理 + 转场 + TTS + BGM(分段action) + SFX + 环境音 + 字幕 → 完整单集视频 */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalStorageService } from './local-storage.service';
import { VideoPostProcessorService } from './video-post-processor.service';
import type { ComposeShotInput, ComposeEpisodeInput, ComposeResult } from './interfaces/video-composer.interface';

export type { ComposeShotInput, ComposeEpisodeInput, ComposeResult } from './interfaces/video-composer.interface';

const execFileAsync = promisify(execFile);

const DEFAULT_XFADE_DURATION = 0.5; // 默认转场过渡时长(秒)
const ENCODE_ARGS = ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']; // V8: 统一编码参数

/** 将 Shot.transition 映射为 FFmpeg xfade 类型 */
const XFADE_MAP: Record<string, string> = {
  fade_black: 'fadeblack', fade_white: 'fadewhite', dissolve: 'dissolve',
  wipe_left: 'wipeleft', wipe_right: 'wiperight', flash: 'fadewhite',
  match_cut: 'dissolve',
};

/** match_cut 使用极短 dissolve 实现视觉匹配过渡 */
const MATCH_CUT_DURATION = 0.15;

@Injectable()
export class VideoComposerService implements OnModuleInit {
  private readonly logger = new Logger('VideoComposer');
  private ffmpegAvailable = false;
  private tmpDir = '';

  constructor(
    @Optional() private readonly storage?: LocalStorageService,
    @Optional() private readonly postProcessor?: VideoPostProcessorService,
  ) {}

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
      const trimmedShots = await this.applyInShotTrim(localShots, workDir);
      const processedShots = await this.postProcessShots(trimmedShots, workDir);
      const concatPath = await this.concatWithTransitions(processedShots, workDir);
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

  // ═══ Step 1.5a: In-shot Trim（精确切点裁剪） ═══

  private async applyInShotTrim(shots: ComposeShotInput[], workDir: string): Promise<ComposeShotInput[]> {
    const result: ComposeShotInput[] = [];
    for (const shot of shots) {
      if (shot.trimInSec != null || shot.trimOutSec != null) {
        const inPt = shot.trimInSec ?? 0;
        const outPt = shot.trimOutSec ?? shot.durationSec;
        if (inPt > 0 || outPt < shot.durationSec) {
          try {
            const outPath = path.join(workDir, `trim_${shot.shotId}.mp4`);
            const trimDur = Math.max(0.5, outPt - inPt);
            await this.ffmpeg([
              '-i', shot.videoPath, '-ss', inPt.toFixed(3), '-t', trimDur.toFixed(3),
              ...ENCODE_ARGS, '-y', outPath,
            ]);
            result.push({ ...shot, videoPath: outPath, durationSec: trimDur });
            this.logger.debug(`Shot ${shot.shotId} trimmed: ${inPt.toFixed(2)}s-${outPt.toFixed(2)}s (${trimDur.toFixed(2)}s)`);
            continue;
          } catch (err) {
            this.logger.warn(`Shot ${shot.shotId} trim failed, using original: ${(err as Error).message}`);
          }
        }
      }
      result.push(shot);
    }
    return result;
  }

  // ═══ Step 1.5b: Per-shot 后处理（调色/特效/速度/稳定化） ═══

  private async postProcessShots(shots: ComposeShotInput[], workDir: string): Promise<ComposeShotInput[]> {
    if (!this.postProcessor?.isAvailable()) return shots;

    const result: ComposeShotInput[] = [];
    for (const shot of shots) {
      if (shot.postProcess && this.postProcessor.needsProcessing(shot.postProcess)) {
        try {
          const outPath = path.join(workDir, `pp_${shot.shotId}.mp4`);
          const ppResult = await this.postProcessor.processShot(shot.videoPath, outPath, {
            ...shot.postProcess,
            durationSec: shot.durationSec,
          });
          result.push({ ...shot, videoPath: ppResult.outputPath, durationSec: ppResult.durationSec || shot.durationSec });
          this.logger.debug(`Shot ${shot.shotId} 后处理完成: ${shot.postProcess.colorGrade ?? '-'} | speed=${shot.postProcess.speedFactor ?? 1}`);
        } catch (err) {
          this.logger.warn(`Shot ${shot.shotId} 后处理失败，使用原始视频: ${(err as Error).message}`);
          result.push(shot);
        }
      } else {
        result.push(shot);
      }
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

    const filters: string[] = [];
    let prevLabel = '0:v';
    let timeOffset = shots[0].durationSec;

    for (let i = 1; i < shots.length; i++) {
      const tr = shots[i - 1].transition;
      const xfadeType = XFADE_MAP[tr];
      const outLabel = i === shots.length - 1 ? '[vout]' : `[v${i}]`;

      if (xfadeType) {
        const isMatchCut = shots[i - 1].transition === 'match_cut';
        const xDur = isMatchCut ? MATCH_CUT_DURATION : (shots[i - 1].transitionDurationSec ?? DEFAULT_XFADE_DURATION);
        const offset = Math.max(timeOffset - xDur, 0);
        filters.push(`[${prevLabel}][${i}:v]xfade=transition=${xfadeType}:duration=${xDur}:offset=${offset.toFixed(3)}${outLabel}`);
        timeOffset += shots[i].durationSec - xDur;
      } else {
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
    // Use basename only — FFmpeg resolves concat.txt entries relative to the list file's directory (workDir),
    // so using a full/relative CWD path would produce a doubled path prefix.
    fs.writeFileSync(listFile, shots.map(s => `file '${path.basename(s.videoPath).replace(/'/g, "'\\''")}'`).join('\n'));
    const output = path.join(workDir, 'concat.mp4');
    await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-y', output]);
    return output;
  }

  /** 统一输入视频为相同编码/分辨率 + 色彩空间归一化（xfade 要求一致格式） */
  private async normalizeInputVideos(shots: ComposeShotInput[], workDir: string): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const out = path.join(workDir, `norm_${i}.mp4`);
      // 使用 colorspace + colorrange 统一色彩空间为 BT.709，防止不同 AI 模型输出的色域差异导致视觉跳变
      await this.ffmpeg([
        '-i', shots[i].videoPath,
        '-vf', 'colorspace=bt709:iall=bt601-6-625:fast=1,colorrange=tv',
        ...ENCODE_ARGS, '-y', out,
      ]);
      paths.push(out);
    }
    return paths;
  }

  // ═══ Step 3: 混合全部音轨（V9 — TTS + BGM自动ducking + SFX + 环境音 + 响度归一化） ═══

  private async mixAllAudio(videoPath: string, shots: ComposeShotInput[], workDir: string): Promise<string> {
    const inputs = ['-i', videoPath];
    const filters: string[] = [];
    const hasOriginalAudio = await this.hasAudioStream(videoPath);
    const audioStreams: string[] = hasOriginalAudio ? ['[0:a]'] : [];
    let inputIdx = 1;

    // ── 预计算 TTS 活跃时间区间（用于 BGM ducking） ──
    const ttsRegions: Array<{ startSec: number; endSec: number }> = [];
    let regionOffset = 0;
    for (const shot of shots) {
      if (shot.ttsAudioPath && fs.existsSync(shot.ttsAudioPath)) {
        ttsRegions.push({ startSec: regionOffset, endSec: regionOffset + shot.durationSec });
      }
      regionOffset += shot.durationSec;
    }

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

    // ── BGM 分段（V9 — ducking: TTS 播放时自动降至 15%，无 TTS 时恢复正常音量） ──
    offset = 0;
    const bgmStreams: string[] = [];
    let currentBgm = '', currentBgmStart = 0, currentBgmIntensity = 0.3, currentBgmAction = 'continue';
    const BGM_DUCK_RATIO = 0.15; // TTS 活跃时 BGM 降至原音量的 15%
    const BGM_DUCK_ATTACK = 0.3; // ducking 淡入时间(秒)
    const BGM_DUCK_RELEASE = 0.5; // ducking 恢复时间(秒)

    const buildDuckingFilter = (segStart: number, segDur: number, baseVolume: number): string => {
      if (!ttsRegions.length) return `volume=${baseVolume}`;
      // 构建基于时间的音量表达式：TTS 活跃区间内降低音量
      const duckedVolume = baseVolume * BGM_DUCK_RATIO;
      const volumeExprs: string[] = [];
      for (const region of ttsRegions) {
        const relStart = region.startSec - segStart;
        const relEnd = region.endSec - segStart;
        if (relEnd <= 0 || relStart >= segDur) continue;
        const s = Math.max(0, relStart);
        const e = Math.min(segDur, relEnd);
        // 平滑过渡：attack 前渐降，release 后渐升
        const attackStart = Math.max(0, s - BGM_DUCK_ATTACK);
        const releaseEnd = Math.min(segDur, e + BGM_DUCK_RELEASE);
        volumeExprs.push(`between(t,${attackStart.toFixed(3)},${releaseEnd.toFixed(3)})`);
      }
      if (!volumeExprs.length) return `volume=${baseVolume}`;
      const duckExpr = volumeExprs.join('+');
      return `volume='if(${duckExpr},${duckedVolume.toFixed(4)},${baseVolume})'`;
    };

    const flushBgm = (endOffset: number) => {
      if (!currentBgm || !fs.existsSync(currentBgm)) return;
      inputs.push('-i', currentBgm);
      const dur = endOffset - currentBgmStart;
      const delayMs = Math.round(currentBgmStart * 1000);
      const label = `bgm${inputIdx}`;
      const duckFilter = buildDuckingFilter(currentBgmStart, dur, currentBgmIntensity);
      let fadeFilter = `[${inputIdx}:a]aloop=loop=-1:size=2e+09,atrim=0:${dur.toFixed(3)},adelay=${delayMs}|${delayMs},${duckFilter}`;
      if (currentBgmAction === 'fade_in') fadeFilter += `,afade=t=in:d=1.5`;
      else if (currentBgmAction === 'fade_out') fadeFilter += `,afade=t=out:st=${Math.max(dur - 2, 0).toFixed(3)}:d=2`;
      else if (currentBgmAction === 'swell') fadeFilter += `,volume=1.5:enable='between(t,0,1)'`;
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
        flushBgm(offset + 0.5);
        currentBgm = '';
      }
      offset += shot.durationSec;
    }
    if (currentBgm) flushBgm(offset);

    if (bgmStreams.length) {
      filters.push(`${bgmStreams.join('')}amix=inputs=${bgmStreams.length}:duration=longest:normalize=0[bgm_mix]`);
      audioStreams.push('[bgm_mix]');
    }

    // ── SFX 音效 ──
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

    // ── 环境音 ──
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

    if (audioStreams.length === 0) return videoPath;

    const output = path.join(workDir, 'with_audio.mp4');

    let finalAudioLabel: string;
    if (audioStreams.length === 1) {
      finalAudioLabel = audioStreams[0];
    } else {
      finalAudioLabel = '[pre_norm]';
      filters.push(`${audioStreams.join('')}amix=inputs=${audioStreams.length}:duration=first:dropout_transition=2:normalize=0${finalAudioLabel}`);
    }

    // V9: 响度归一化 — 使用 loudnorm 统一输出响度至 -16 LUFS（短视频平台标准）
    const normLabel = '[final_audio]';
    filters.push(`${finalAudioLabel}loudnorm=I=-16:TP=-1.5:LRA=11${normLabel}`);

    const ffArgs = [...inputs, ...(filters.length ? ['-filter_complex', filters.join(';')] : []), '-map', '0:v', '-map', normLabel, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', output];
    await this.ffmpeg(ffArgs);
    return output;
  }

  // ═══ Step 4: 字幕（V10 — 多风格 + 情绪字号 + 逐字出现） ═══

  private async addSubtitles(videoPath: string, shots: ComposeShotInput[], workDir: string, outputPath: string, aspectRatio?: string): Promise<string> {
    const subtitleShots = shots.filter(s => s.subtitle?.text);
    if (!subtitleShots.length) {
      fs.copyFileSync(videoPath, outputPath);
      return outputPath;
    }

    const isVertical = aspectRatio === '9:16' || aspectRatio === '3:4';
    const resX = isVertical ? 1080 : 1920;
    const resY = isVertical ? 1920 : 1080;
    const baseSize = isVertical ? 40 : 48;
    const marginV = isVertical ? 60 : 30;

    const assPath = path.join(workDir, 'subs.ass');
    let offset = 0;
    const events: string[] = [];
    for (const shot of shots) {
      if (shot.subtitle?.text) {
        const start = this.formatAssTime(offset);
        const end = this.formatAssTime(offset + shot.durationSec);
        const text = shot.subtitle.text;
        const st = shot.subtitle.style || 'normal';

        switch (st) {
          case 'emphasis':
            events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,{\\b1}${text}`);
            break;
          case 'whisper':
            events.push(`Dialogue: 0,${start},${end},Whisper,,0,0,0,,${text}`);
            break;
          case 'scream':
            events.push(`Dialogue: 0,${start},${end},Scream,,0,0,0,,${text}`);
            break;
          case 'narrator':
            events.push(`Dialogue: 0,${start},${end},Narrator,,0,0,0,,${text}`);
            break;
          case 'time_skip': {
            const mid = this.formatAssTime(offset + shot.durationSec * 0.1);
            const fadeEnd = this.formatAssTime(offset + shot.durationSec * 0.8);
            events.push(`Dialogue: 0,${start},${mid},TimeSkip,,0,0,0,,{\\fad(0,300)}${text}`);
            events.push(`Dialogue: 0,${mid},${fadeEnd},TimeSkip,,0,0,0,,${text}`);
            events.push(`Dialogue: 0,${fadeEnd},${end},TimeSkip,,0,0,0,,{\\fad(300,0)}${text}`);
            break;
          }
          default:
            if (shot.subtitle.karaoke && text.length <= 30) {
              const chars = [...text];
              const charDur = Math.floor((shot.durationSec * 100) / chars.length);
              const kTags = chars.map(c => `{\\kf${charDur}}${c}`).join('');
              events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${kTags}`);
            } else {
              events.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
            }
        }
      }
      offset += shot.durationSec;
    }

    const screamSize = Math.round(baseSize * 1.5);
    const whisperSize = Math.round(baseSize * 0.8);
    const narratorSize = Math.round(baseSize * 0.9);
    const timeSkipSize = Math.round(baseSize * 1.8);

    const assContent = [
      `[Script Info]`, `ScriptType: v4.00+`, `PlayResX: ${resX}`, `PlayResY: ${resY}`, ``,
      `[V4+ Styles]`,
      `Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`,
      `Style: Default,Noto Sans SC,${baseSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,${marginV},1`,
      `Style: Whisper,Noto Sans SC,${whisperSize},&H80FFFFFF,&H000000FF,&H40000000,&H80000000,0,1,0,0,100,100,1,0,1,1,0,2,10,10,${marginV},1`,
      `Style: Scream,Noto Sans SC,${screamSize},&H0000DDFF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,${marginV},1`,
      `Style: Narrator,Noto Sans SC,${narratorSize},&H00E0E0E0,&H000000FF,&H00000000,&H80000000,0,1,0,0,100,100,0.5,0,1,1.5,1,8,10,10,${Math.round(marginV * 0.6)},1`,
      `Style: TimeSkip,Noto Sans SC,${timeSkipSize},&H00AACCFF,&H000000FF,&H00000000,&HC0000000,-1,0,0,0,100,100,3,0,1,3,2,5,10,10,${Math.round(resY * 0.4)},1`,
      ``,
      `[Events]`,
      `Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`,
      ...events,
    ].join('\n');
    fs.writeFileSync(assPath, assContent);

    const absAssPath = path.resolve(assPath).replace(/\\/g, '/').replace(/'/g, "\\'");
    await this.ffmpeg(['-i', videoPath, '-vf', `ass='${absAssPath}'`, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-y', outputPath]);
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

  private async hasAudioStream(filePath: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath,
      ]);
      return stdout.trim() === 'audio';
    } catch { return false; }
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
