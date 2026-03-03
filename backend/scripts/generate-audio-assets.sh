#!/bin/bash
# 生成短剧音频素材 — 每种情绪/音效有独特声学特征，先 WAV 再转 MP3 避免编码器断言
set -e
DIR="$(cd "$(dirname "$0")/../assets/audio" && pwd)"
TMP="$DIR/.tmp"
mkdir -p "$TMP"
echo "生成音频到: $DIR"

gen() {
  local out="$1"; shift
  local wav="$TMP/$(basename "$out" .mp3).wav"
  ffmpeg -y -loglevel error "$@" "$wav"
  ffmpeg -y -loglevel error -i "$wav" -codec:a libmp3lame -q:a 4 "$out"
  rm -f "$wav"
  echo "  ✓ $(basename "$out")"
}

# ═══ BGM (30s) ═══
echo "▶ BGM..."
gen "$DIR/bgm/tension.mp3"     -f lavfi -i "sine=f=120:d=30" -af "volume=0.3,tremolo=f=2:d=0.4,lowpass=f=300"
gen "$DIR/bgm/romantic.mp3"    -f lavfi -i "sine=f=440:d=30" -af "volume=0.2,vibrato=f=5:d=0.3,lowpass=f=2000"
gen "$DIR/bgm/epic.mp3"        -f lavfi -i "sine=f=200:d=30" -af "volume=0.25,tremolo=f=1:d=0.5,equalizer=f=800:t=q:w=1:g=5"
gen "$DIR/bgm/sad-piano.mp3"   -f lavfi -i "sine=f=262:d=30" -af "volume=0.15,vibrato=f=3:d=0.3,afade=t=in:d=3,afade=t=out:st=27:d=3"
gen "$DIR/bgm/comedy.mp3"      -f lavfi -i "sine=f=523:d=30" -af "volume=0.2,tremolo=f=6:d=0.3"
gen "$DIR/bgm/action.mp3"      -f lavfi -i "sine=f=180:d=30" -af "volume=0.3,tremolo=f=10:d=0.5,highpass=f=80"
gen "$DIR/bgm/mysterious.mp3"  -f lavfi -i "sine=f=233:d=30" -af "volume=0.2,vibrato=f=2:d=0.5,lowpass=f=800"
gen "$DIR/bgm/triumphant.mp3"  -f lavfi -i "sine=f=392:d=30" -af "volume=0.25,tremolo=f=3:d=0.2"
gen "$DIR/bgm/heartbreak.mp3"  -f lavfi -i "sine=f=330:d=30" -af "volume=0.15,vibrato=f=4:d=0.3,afade=t=in:d=2,afade=t=out:st=26:d=4"

# ═══ SFX (2-3s) ═══
echo "▶ SFX..."
gen "$DIR/sfx/door-slam.mp3"   -f lavfi -i "anoisesrc=c=brown:d=0.5" -af "volume=0.6,highpass=f=200,afade=t=out:d=0.3"
gen "$DIR/sfx/glass-break.mp3" -f lavfi -i "anoisesrc=c=white:d=1" -af "volume=0.4,highpass=f=3000,afade=t=out:d=0.7"
gen "$DIR/sfx/slap.mp3"        -f lavfi -i "anoisesrc=c=pink:d=0.3" -af "volume=0.5,highpass=f=1000,afade=t=out:d=0.2"
gen "$DIR/sfx/phone-ring.mp3"  -f lavfi -i "sine=f=440:d=3" -af "volume=0.3,tremolo=f=20:d=0.9"
gen "$DIR/sfx/car-engine.mp3"  -f lavfi -i "anoisesrc=c=brown:d=3" -af "volume=0.25,lowpass=f=200,tremolo=f=15:d=0.3"
gen "$DIR/sfx/footsteps.mp3"   -f lavfi -i "anoisesrc=c=pink:d=3" -af "volume=0.15,highpass=f=500,tremolo=f=4:d=0.9"
gen "$DIR/sfx/rain.mp3"        -f lavfi -i "anoisesrc=c=pink:d=3" -af "volume=0.2,lowpass=f=5000,highpass=f=500"
gen "$DIR/sfx/thunder.mp3"     -f lavfi -i "anoisesrc=c=brown:d=2" -af "volume=0.5,lowpass=f=300,afade=t=out:d=1.5"
gen "$DIR/sfx/crowd-gasp.mp3"  -f lavfi -i "anoisesrc=c=white:d=0.8" -af "volume=0.3,bandpass=f=2000:w=1000,afade=t=out:d=0.5"
gen "$DIR/sfx/heartbeat.mp3"   -f lavfi -i "sine=f=60:d=3" -af "volume=0.35,tremolo=f=1.2:d=0.9"
gen "$DIR/sfx/wind.mp3"        -f lavfi -i "anoisesrc=c=pink:d=3" -af "volume=0.18,lowpass=f=800,tremolo=f=0.5:d=0.5"
gen "$DIR/sfx/typing.mp3"      -f lavfi -i "anoisesrc=c=white:d=3" -af "volume=0.1,highpass=f=2000,tremolo=f=12:d=0.9"

# ═══ Ambience (30s) ═══
echo "▶ Ambience..."
gen "$DIR/ambience/office.mp3"      -f lavfi -i "anoisesrc=c=brown:d=30" -af "volume=0.04,lowpass=f=500"
gen "$DIR/ambience/rain-heavy.mp3"  -f lavfi -i "anoisesrc=c=pink:d=30" -af "volume=0.3,lowpass=f=6000,highpass=f=300"
gen "$DIR/ambience/rain-light.mp3"  -f lavfi -i "anoisesrc=c=pink:d=30" -af "volume=0.12,lowpass=f=4000,highpass=f=500"
gen "$DIR/ambience/crowd.mp3"       -f lavfi -i "anoisesrc=c=pink:d=30" -af "volume=0.1,bandpass=f=1500:w=2000"
gen "$DIR/ambience/crickets.mp3"    -f lavfi -i "sine=f=4000:d=30" -af "volume=0.06,tremolo=f=3:d=0.9"
gen "$DIR/ambience/traffic.mp3"     -f lavfi -i "anoisesrc=c=brown:d=30" -af "volume=0.15,lowpass=f=1000,tremolo=f=0.2:d=0.3"
gen "$DIR/ambience/restaurant.mp3"  -f lavfi -i "anoisesrc=c=pink:d=30" -af "volume=0.08,bandpass=f=2000:w=3000"
gen "$DIR/ambience/wind.mp3"        -f lavfi -i "anoisesrc=c=pink:d=30" -af "volume=0.15,lowpass=f=600,tremolo=f=0.3:d=0.5"

rm -rf "$TMP"
echo ""
echo "✅ 全部生成完成"
find "$DIR" -name "*.mp3" | wc -l | xargs -I{} echo "共 {} 个文件"
du -sh "$DIR"
