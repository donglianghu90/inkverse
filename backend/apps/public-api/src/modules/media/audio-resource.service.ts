/** BGM/SFX 音频资源映射 — 语义标签→音频文件URL，支持 OSS 或本地文件 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import * as path from 'path';
import * as fs from 'fs';
import type { AudioSegment } from './interfaces/audio.interface';

export type { AudioSegment } from './interfaces/audio.interface';

const DEFAULT_BGM: Record<string, string> = { // mood → 文件名（相对于 audioBaseDir）
  tension_building: 'bgm/tension.mp3', romantic_sweet: 'bgm/romantic.mp3',
  epic_reveal: 'bgm/epic.mp3', sad_piano: 'bgm/sad-piano.mp3',
  comedy_light: 'bgm/comedy.mp3', action_intense: 'bgm/action.mp3',
  mysterious: 'bgm/mysterious.mp3', triumphant: 'bgm/triumphant.mp3',
  heartbreak: 'bgm/heartbreak.mp3', silence: '',
};

const DEFAULT_SFX: Record<string, string> = { // sound → 文件名
  door_slam: 'sfx/door-slam.mp3', glass_break: 'sfx/glass-break.mp3',
  slap: 'sfx/slap.mp3', phone_ring: 'sfx/phone-ring.mp3',
  car_engine: 'sfx/car-engine.mp3', footsteps: 'sfx/footsteps.mp3',
  rain: 'sfx/rain.mp3', thunder: 'sfx/thunder.mp3',
  crowd_gasp: 'sfx/crowd-gasp.mp3', heartbeat: 'sfx/heartbeat.mp3',
  wind: 'sfx/wind.mp3', typing: 'sfx/typing.mp3',
};

const DEFAULT_AMBIENCE: Record<string, string> = {
  office_quiet: 'ambience/office.mp3', rain_heavy: 'ambience/rain-heavy.mp3',
  rain_light: 'ambience/rain-light.mp3', crowd_murmur: 'ambience/crowd.mp3',
  night_crickets: 'ambience/crickets.mp3', traffic: 'ambience/traffic.mp3',
  restaurant_bg: 'ambience/restaurant.mp3', wind: 'ambience/wind.mp3',
};

@Injectable()
export class AudioResourceService implements OnModuleInit {
  private readonly logger = new Logger('AudioResource');
  private audioBaseUrl = ''; // OSS 或本地 HTTP 前缀
  private audioBaseDir = ''; // 本地文件目录
  private bgmMap = new Map<string, string>();
  private sfxMap = new Map<string, string>();
  private ambienceMap = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const media = (this.configService.get('media') ?? {}) as Record<string, unknown>;
    const audio = (media.audio ?? {}) as Record<string, unknown>;
    this.audioBaseUrl = String(audio.baseUrl || '');
    this.audioBaseDir = String(audio.baseDir || path.join(process.cwd(), 'assets', 'audio'));

    Object.entries(DEFAULT_BGM).forEach(([k, v]) => { if (v) this.bgmMap.set(k, v); });
    Object.entries(DEFAULT_SFX).forEach(([k, v]) => { if (v) this.sfxMap.set(k, v); });
    Object.entries(DEFAULT_AMBIENCE).forEach(([k, v]) => { if (v) this.ambienceMap.set(k, v); });

    // 加载自定义映射（如果存在）
    const customPath = path.join(this.audioBaseDir, 'mapping.json');
    if (fs.existsSync(customPath)) {
      try {
        const custom = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
        if (custom.bgm) Object.entries(custom.bgm).forEach(([k, v]) => this.bgmMap.set(k, String(v)));
        if (custom.sfx) Object.entries(custom.sfx).forEach(([k, v]) => this.sfxMap.set(k, String(v)));
        if (custom.ambience) Object.entries(custom.ambience).forEach(([k, v]) => this.ambienceMap.set(k, String(v)));
        this.logger.log(`加载自定义音频映射: ${customPath}`);
      } catch { this.logger.warn(`音频映射文件解析失败: ${customPath}`); }
    }
    this.logger.log(`音频资源: BGM=${this.bgmMap.size} SFX=${this.sfxMap.size} Ambience=${this.ambienceMap.size} | baseDir=${this.audioBaseDir}`);
  }

  resolveBgm(mood: string): string | null {
    const file = this.bgmMap.get(mood);
    return file ? this.resolveUrl(file) : null;
  }

  resolveSfx(sound: string): string | null {
    const file = this.sfxMap.get(sound);
    return file ? this.resolveUrl(file) : null;
  }

  resolveAmbience(ambience: string): string | null {
    const file = this.ambienceMap.get(ambience);
    return file ? this.resolveUrl(file) : null;
  }

  /** 检查本地文件是否存在 */
  fileExists(relPath: string): boolean {
    return fs.existsSync(path.join(this.audioBaseDir, relPath));
  }

  private resolveUrl(val: string): string {
    if (val.startsWith('http://') || val.startsWith('https://')) return val; // 绝对 URL 直接返回
    if (this.audioBaseUrl) return `${this.audioBaseUrl}/${val}`;
    return path.join(this.audioBaseDir, val);
  }
}
