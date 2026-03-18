/** BGM/SFX 音频资源映射 — 语义标签→音频文件URL，支持 OSS 或本地文件 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@packages/modules';
import * as path from 'path';
import * as fs from 'fs';
import type { AudioSegment } from './interfaces/audio.interface';

export type { AudioSegment } from './interfaces/audio.interface';

// ─── BGM 素材库 (mood → 文件路径) ───
const DEFAULT_BGM: Record<string, string> = {
  tension_building: 'bgm/tension.mp3', romantic_sweet: 'bgm/romantic.mp3',
  epic_reveal: 'bgm/epic.mp3', sad_piano: 'bgm/sad-piano.mp3',
  comedy_light: 'bgm/comedy.mp3', action_intense: 'bgm/action.mp3',
  mysterious: 'bgm/mysterious.mp3', triumphant: 'bgm/triumphant.mp3',
  heartbreak: 'bgm/heartbreak.mp3', silence: '',
  dark_suspense: 'bgm/dark-suspense.mp3', gentle_warmth: 'bgm/gentle-warmth.mp3',
  epic_battle: 'bgm/epic-battle.mp3', melancholy: 'bgm/melancholy.mp3',
  playful: 'bgm/playful.mp3', dramatic_reveal: 'bgm/dramatic-reveal.mp3',
  horror_ambient: 'bgm/horror-ambient.mp3', nostalgic: 'bgm/nostalgic.mp3',
};

// ─── BGM BPM 索引 (mood → BPM, 用于 beat-sync 剪辑参考) ───
const BGM_BPM: Record<string, number> = {
  tension_building: 100, romantic_sweet: 72, epic_reveal: 130,
  sad_piano: 60, comedy_light: 120, action_intense: 140,
  mysterious: 80, triumphant: 128, heartbreak: 65,
  dark_suspense: 90, gentle_warmth: 76, epic_battle: 150,
  melancholy: 56, playful: 115, dramatic_reveal: 110,
  horror_ambient: 70, nostalgic: 68,
};

// ─── SFX 素材库 (sound → 文件路径, 大幅扩展) ───
const DEFAULT_SFX: Record<string, string> = {
  // 物理碰撞
  door_slam: 'sfx/door-slam.mp3', door_open: 'sfx/door-open.mp3', door_creak: 'sfx/door-creak.mp3',
  glass_break: 'sfx/glass-break.mp3', glass_clink: 'sfx/glass-clink.mp3',
  slap: 'sfx/slap.mp3', punch: 'sfx/punch.mp3', impact: 'sfx/impact.mp3',
  // 生活场景
  phone_ring: 'sfx/phone-ring.mp3', phone_vibrate: 'sfx/phone-vibrate.mp3', phone_hangup: 'sfx/phone-hangup.mp3',
  car_engine: 'sfx/car-engine.mp3', car_door: 'sfx/car-door.mp3', car_brake: 'sfx/car-brake.mp3',
  footsteps: 'sfx/footsteps.mp3', footsteps_heels: 'sfx/footsteps-heels.mp3', footsteps_running: 'sfx/footsteps-running.mp3',
  typing: 'sfx/typing.mp3', pen_writing: 'sfx/pen-writing.mp3', paper_tear: 'sfx/paper-tear.mp3', paper_crumple: 'sfx/paper-crumple.mp3',
  cup_clink: 'sfx/cup-clink.mp3', cup_set_down: 'sfx/cup-set-down.mp3',
  // 自然/天气
  rain: 'sfx/rain.mp3', thunder: 'sfx/thunder.mp3', wind: 'sfx/wind.mp3', water_drip: 'sfx/water-drip.mp3',
  // 人声/情绪
  crowd_gasp: 'sfx/crowd-gasp.mp3', crowd_cheer: 'sfx/crowd-cheer.mp3', crowd_whisper: 'sfx/crowd-whisper.mp3',
  baby_cry: 'sfx/baby-cry.mp3', sigh: 'sfx/sigh.mp3', gasp: 'sfx/gasp.mp3', sob: 'sfx/sob.mp3',
  // 身体反应
  heartbeat: 'sfx/heartbeat.mp3', heartbeat_fast: 'sfx/heartbeat-fast.mp3',
  heavy_breathing: 'sfx/heavy-breathing.mp3', gulp: 'sfx/gulp.mp3',
  // 戏剧化
  clock_ticking: 'sfx/clock-ticking.mp3', bell_toll: 'sfx/bell-toll.mp3',
  sword_draw: 'sfx/sword-draw.mp3', sword_clash: 'sfx/sword-clash.mp3',
  explosion: 'sfx/explosion.mp3', whoosh: 'sfx/whoosh.mp3',
  camera_shutter: 'sfx/camera-shutter.mp3', notification: 'sfx/notification.mp3',
  // 抽象情绪强调 (用于后期混音增强)
  low_rumble: 'sfx/low-rumble.mp3', riser: 'sfx/riser.mp3', reverse_cymbal: 'sfx/reverse-cymbal.mp3',
  stinger: 'sfx/stinger.mp3', hit_impact: 'sfx/hit-impact.mp3',
};

// ─── 环境音素材库 ───
const DEFAULT_AMBIENCE: Record<string, string> = {
  office_quiet: 'ambience/office.mp3', rain_heavy: 'ambience/rain-heavy.mp3',
  rain_light: 'ambience/rain-light.mp3', crowd_murmur: 'ambience/crowd.mp3',
  night_crickets: 'ambience/crickets.mp3', traffic: 'ambience/traffic.mp3',
  restaurant_bg: 'ambience/restaurant.mp3', wind: 'ambience/wind.mp3',
  forest: 'ambience/forest.mp3', ocean_waves: 'ambience/ocean.mp3',
  fire_crackling: 'ambience/fire.mp3', market_bustle: 'ambience/market.mp3',
  hospital: 'ambience/hospital.mp3', classroom: 'ambience/classroom.mp3',
  construction: 'ambience/construction.mp3', river_stream: 'ambience/river.mp3',
  night_city: 'ambience/night-city.mp3', temple_bells: 'ambience/temple.mp3',
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

  /** 获取 BGM 的 BPM（每分钟节拍数），用于 beat-sync 剪辑对齐 */
  getBgmBpm(mood: string): number | null {
    return BGM_BPM[mood] ?? null;
  }

  /** 获取 BGM 的每拍时长（秒），用于计算剪辑切点 */
  getBeatIntervalSec(mood: string): number | null {
    const bpm = this.getBgmBpm(mood);
    return bpm ? 60 / bpm : null;
  }

  resolveSfx(sound: string): string | null {
    const file = this.sfxMap.get(sound);
    if (file) return this.resolveUrl(file);
    // 模糊匹配：将 LLM 可能生成的变体名映射到已有素材
    const normalized = sound.toLowerCase().replace(/[_\s-]+/g, '_');
    for (const [key, val] of this.sfxMap) {
      if (normalized.includes(key) || key.includes(normalized)) return this.resolveUrl(val);
    }
    return null;
  }

  resolveAmbience(ambience: string): string | null {
    const file = this.ambienceMap.get(ambience);
    if (file) return this.resolveUrl(file);
    const normalized = ambience.toLowerCase().replace(/[_\s-]+/g, '_');
    for (const [key, val] of this.ambienceMap) {
      if (normalized.includes(key) || key.includes(normalized)) return this.resolveUrl(val);
    }
    return null;
  }

  /** 检查本地文件是否存在 */
  fileExists(relPath: string): boolean {
    return fs.existsSync(path.join(this.audioBaseDir, relPath));
  }

  /** 列出所有可用的 BGM mood 标签 */
  listBgmMoods(): string[] { return [...this.bgmMap.keys()]; }

  /** 列出所有可用的 SFX sound 标签 */
  listSfxSounds(): string[] { return [...this.sfxMap.keys()]; }

  /** 列出所有可用的环境音标签 */
  listAmbienceTypes(): string[] { return [...this.ambienceMap.keys()]; }

  private resolveUrl(val: string): string {
    if (val.startsWith('http://') || val.startsWith('https://')) return val; // 绝对 URL 直接返回
    if (this.audioBaseUrl) return `${this.audioBaseUrl}/${val}`;
    return path.join(this.audioBaseDir, val);
  }
}
