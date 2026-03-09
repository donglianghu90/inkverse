import React, { useState, useCallback, useEffect, useRef } from 'react';
import { history } from '@umijs/max';
import { message } from 'antd';
import {
  ArrowLeft, ArrowRight, Sparkles, Loader2, Film, Users, Target,
  Settings2, Check, AlertTriangle, RotateCcw, Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  createDrama, retryCreateDrama, getDrama, getCreateDramaSseUrl, listDramaGenreTemplates,
  enhanceDramaIdea, generateDramaGoal, recommendGenreAndAudience,
  type CreateDramaParams, type DramaGenreTemplate, type DramaSseEvent,
} from '@/services/drama';
import { getToken } from '@/services/auth';

// ─── 视觉风格库（分类 + 缩略渐变色） ────────────────────────────────────────────
// thumbnailUrl 可选：设置后展示真实预览图，否则用 gradient + emoji 做占位

interface StyleOption {
  value: string;
  label: string;
  desc: string;
  gradient: string;
  emoji: string;
  aiHint: string;
  featured?: boolean;
  thumbnailUrl?: string;
}

interface StyleCategory {
  key: string;
  label: string;
  styles: StyleOption[];
}

const STYLE_CATEGORIES: StyleCategory[] = [
  {
    key: '3d', label: '3D 风格',
    styles: [
      { value: '3d_fantasy', label: '3D玄幻', desc: '东方玄幻', emoji: '🐉', featured: true,
        gradient: 'linear-gradient(135deg, #1a0533 0%, #4a1a7a 40%, #7b2ff7 100%)',
        aiHint: '3D 东方玄幻风格：仙侠修真世界，流光溢彩的法术特效，精致 CG 渲染，磅礴仙境山川，高饱和紫金色调' },
      { value: '3d_british', label: '3D英式', desc: '英伦复古', emoji: '🏰', featured: true,
        gradient: 'linear-gradient(135deg, #2d1b0e 0%, #6b4423 40%, #b8860b 100%)',
        aiHint: '3D 英式复古风格：维多利亚时代建筑质感，暖褐色调，皮革与金属材质，精致绅士美学，皮克斯级渲染品质' },
      { value: '3d_chibi', label: '3DQ版', desc: '萌系卡通', emoji: '🧸', featured: true,
        gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #ffecd2 100%)',
        aiHint: '3D Q版卡通风格：大头小身萌系比例，圆润可爱造型，糖果色系，精致卡通渲染，适合全年龄内容' },
      { value: '3d_realistic', label: '3D写实', desc: '超写实CG', emoji: '💎', featured: true,
        gradient: 'linear-gradient(135deg, #0c0c0c 0%, #434343 50%, #8e8e8e 100%)',
        aiHint: '写实 3D 风格：超写实 CG 渲染，皮肤毛孔级细节，PBR 材质，电影特效级别视觉效果，照片级光影' },
      { value: '3d_voxel', label: '3D方块世界', desc: '体素风格', emoji: '🧱',
        gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 50%, #4facfe 100%)',
        aiHint: '3D 方块体素风格：Minecraft 式方块美学，低多边形像素体素组合，明亮清新色彩，轻松游戏风格' },
      { value: '3d_mobile_game', label: '3D手游', desc: '手游画质', emoji: '📱',
        gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        aiHint: '3D 手游风格：精致 NPR 渲染，偏卡通但细节丰富，鲜艳色彩，现代手机游戏画面质感' },
      { value: '3d_toon_render', label: '3D漫染2D', desc: '卡通渲染', emoji: '🎨', featured: true,
        gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 50%, #a8edea 100%)',
        aiHint: '3D 卡通渲染风格：3D 建模 + 赛璐璐着色，保留手绘 2D 质感的立体动画，色彩鲜明，线条清晰' },
      { value: '3d_japanese_npr', label: '日式3D漫染', desc: '日系NPR', emoji: '🌸', featured: true,
        gradient: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 50%, #c2e9fb 100%)',
        aiHint: '日式 3D NPR 风格：日本动画公司级 3D 渲染，非写实赛璐璐着色，柔和光影，动漫角色精致立体感' },
      { value: '3d_cyberpunk', label: '3D赛博', desc: '霓虹未来', emoji: '🤖',
        gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 40%, #24243e 70%, #00d2ff 100%)',
        aiHint: '3D 赛博朋克风格：霓虹灯光，高科技低生活，暗紫蓝青色调，未来都市夜景，机械改造美学，3D 渲染' },
      { value: '3d_disney', label: '3D迪士尼', desc: '皮克斯质感', emoji: '✨',
        gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 50%, #ffecd2 100%)',
        aiHint: '3D 迪士尼/皮克斯风格：圆润柔和角色设计，温暖明亮色彩，电影级 3D 渲染，富有表情的角色动画' },
    ],
  },
  {
    key: '2d_anime', label: '2D 动漫',
    styles: [
      { value: '2d_anime', label: '2D动漫', desc: '日系手绘', emoji: '✨', featured: true,
        gradient: 'linear-gradient(135deg, #ff6b6b 0%, #ffa07a 40%, #ffd93d 100%)',
        aiHint: '2D 日系动漫风格：手绘线条，明亮饱和色彩，大眼角色设计，清新治愈或热血风格' },
      { value: '2d_film', label: '2D电影', desc: '电影感动画', emoji: '🎞️', featured: true,
        gradient: 'linear-gradient(135deg, #141e30 0%, #243b55 50%, #4b6584 100%)',
        aiHint: '2D 电影感动画风格：宽画幅电影构图，精致背景美术，细腻光影层次，高级感手绘动画，如新海诚式' },
      { value: '2d_fantasy_anime', label: '2D奇幻动画', desc: '魔幻冒险', emoji: '🗡️',
        gradient: 'linear-gradient(135deg, #1d2b64 0%, #f8cdda 50%, #fbab7e 100%)',
        aiHint: '2D 奇幻动画风格：魔法与冒险主题，华丽特效，鲜艳明快色彩，欧式奇幻与日系动漫的融合' },
      { value: '2d_retro_anime', label: '2D复古动画', desc: '80/90年代', emoji: '📺', featured: true,
        gradient: 'linear-gradient(135deg, #e8d5b7 0%, #d4a574 40%, #b8860b 70%, #8b6914 100%)',
        aiHint: '2D 复古动画风格：80-90年代经典动画质感，胶片颗粒感，暖色调偏黄，怀旧线条，老派赛璐璐着色' },
      { value: '2d_british_anime', label: '2D英式动画', desc: '英伦风情', emoji: '🫖',
        gradient: 'linear-gradient(135deg, #355c7d 0%, #6c5b7b 50%, #c06c84 100%)',
        aiHint: '2D 英式动画风格：优雅含蓄的英伦美学，柔和水彩质感，精致角色设计，温暖淡雅色调' },
      { value: '2d_ghibli', label: '2D吉卜力', desc: '温暖治愈', emoji: '🌿', featured: true,
        gradient: 'linear-gradient(135deg, #56ab2f 0%, #a8e063 40%, #f7f8f8 70%, #87ceeb 100%)',
        aiHint: '吉卜力风格：温暖自然的手绘动画，柔和光线，自然系色彩，充满生命力的场景细节，宫崎骏式' },
      { value: '2d_korean_anime', label: '2D韩式动画', desc: '韩系唯美', emoji: '🌙',
        gradient: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 50%, #c2e9fb 100%)',
        aiHint: '2D 韩式动画风格：柔美唯美画风，粉蓝紫淡雅色调，精致五官细节，韩国 Webtoon 式角色设计' },
      { value: '2d_action', label: '2D热血动画', desc: '少年漫画', emoji: '🔥', featured: true,
        gradient: 'linear-gradient(135deg, #ff0844 0%, #ffb199 40%, #f7971e 100%)',
        aiHint: '2D 热血动画风格：强烈动作线条，高对比度着色，速度线与爆发特效，少年漫画式激燃画面' },
      { value: '2d_cybercity', label: '2D灵境都市', desc: '赛博都市', emoji: '🌃', featured: true,
        gradient: 'linear-gradient(135deg, #0f0c29 0%, #302b63 30%, #24243e 60%, #e94560 100%)',
        aiHint: '2D 赛博都市风格：未来都市夜景，霓虹灯与暗巷，高科技都市背景，暗色调配亮色霓虹点缀，2D 赛璐璐' },
      { value: '2d_sports', label: '2D篮球高手', desc: '运动漫画', emoji: '🏀',
        gradient: 'linear-gradient(135deg, #f5af19 0%, #f12711 50%, #e44d26 100%)',
        aiHint: '2D 运动漫画风格：井上雄彦式写实人体比例，运动动态线，热血竞技氛围，90年代经典运动漫画质感' },
      { value: '2d_tezuka', label: '2D手冢治虫', desc: '经典大师', emoji: '🎭',
        gradient: 'linear-gradient(135deg, #f5f5f5 0%, #d4d4d4 40%, #333333 100%)',
        aiHint: '2D 手冢治虫风格：经典日本漫画之父画风，圆润线条，大眼夸张表情，简洁高效的叙事画面' },
      { value: '2d_thick_line', label: '2D粗线条', desc: '粗犷有力', emoji: '✏️', featured: true,
        gradient: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 50%, #c4e0e5 100%)',
        aiHint: '2D 粗线条风格：粗黑大胆描边，强烈视觉冲击，简约但有力的角色造型，高对比黑白搭配少量色彩' },
      { value: '2d_death_note', label: '2D死神', desc: '暗黑悬疑', emoji: '💀',
        gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 40%, #16213e 70%, #e94560 100%)',
        aiHint: '2D 暗黑悬疑动漫风格：高对比暗色调，锐利线条，阴影浓重，死亡笔记/死神式暗黑美学，哥特氛围' },
      { value: '2d_shoujo', label: '2D少女漫画', desc: '浪漫柔美', emoji: '🌹',
        gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 30%, #ff9a9e 60%, #fecfef 100%)',
        aiHint: '2D 少女漫画风格：柔美花朵背景，闪亮大眼，纤细优雅线条，粉色系浪漫色调，CLAMP 式华丽' },
      { value: '2d_horror', label: '2D诡异恐怖', desc: '恐怖惊悚', emoji: '👻',
        gradient: 'linear-gradient(135deg, #1a1a1a 0%, #2d1f3d 30%, #4a0e0e 60%, #000000 100%)',
        aiHint: '2D 恐怖漫画风格：阴暗扭曲画面，不安定线条，伊藤润二式恐怖美学，暗红与黑色为主，惊悚氛围' },
      { value: '2d_chibi', label: '2DQ版', desc: '萌系可爱', emoji: '🍡',
        gradient: 'linear-gradient(135deg, #f6d5f7 0%, #fbe9d7 40%, #a6c0fe 100%)',
        aiHint: '2D Q版风格：超可爱大头小身比例，圆润简约线条，糖果般明亮色彩，表情丰富夸张，萌系治愈' },
    ],
  },
  {
    key: '2d_art', label: '2D 画风',
    styles: [
      { value: 'chinese_ink', label: '水墨古风', desc: '国画意境', emoji: '🖌️', featured: true,
        gradient: 'linear-gradient(135deg, #f5f5f0 0%, #d4cfc4 30%, #8b8680 60%, #2c2c2c 100%)',
        aiHint: '水墨古风风格：中国传统水墨画质感，意境深远，笔墨晕染，文人画的淡雅氛围，留白构图' },
      { value: 'chinese_style', label: '国风插画', desc: '敦煌华美', emoji: '🏮', featured: true,
        gradient: 'linear-gradient(135deg, #bf0a30 0%, #c62828 30%, #e65100 60%, #ffd600 100%)',
        aiHint: '国风插画风格：中国传统工笔彩绘，敦煌壁画美感，华丽色彩，精致装饰纹样，红金色调' },
      { value: '2d_gongbi', label: '2D工笔风', desc: '精致工笔', emoji: '🎋', featured: true,
        gradient: 'linear-gradient(135deg, #f8f4e8 0%, #d4c5a0 30%, #b8860b 60%, #654321 100%)',
        aiHint: '2D 工笔画风格：中国传统工笔重彩，精致细腻线描，矿物颜料质感，绢本设色，典雅古典' },
      { value: '2d_watercolor', label: '2D水彩', desc: '清透柔和', emoji: '💧',
        gradient: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 25%, #f8bbd0 50%, #fff9c4 75%, #e8f5e9 100%)',
        aiHint: '2D 水彩风格：透明水彩晕染质感，清透柔和色彩，纸张纹理，自然流动的色彩过渡，文艺清新' },
      { value: '2d_pixel', label: '2D像素', desc: '复古游戏', emoji: '🎮',
        gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 30%, #0f3460 60%, #e94560 100%)',
        aiHint: '像素艺术风格：8-bit/16-bit 复古游戏美学，格子化像素色块，复古游戏色盘，怀旧电子游戏感' },
      { value: '2d_simple', label: '2D简画', desc: '极简风格', emoji: '〰️',
        gradient: 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 40%, #e0e0e0 100%)',
        aiHint: '2D 极简简画风格：最少线条勾勒，大面积留白，黑白为主偶有点缀色，简约而不简单的高级感' },
      { value: '2d_sketch', label: '2D简单线条', desc: '素描手绘', emoji: '✍️',
        gradient: 'linear-gradient(135deg, #f5f0e8 0%, #e6ddd0 40%, #c4b8a8 70%, #8b7e6e 100%)',
        aiHint: '2D 素描手绘风格：铅笔手绘质感，纸张纹理，淡雅灰色调，速写式人物，文艺素描风' },
      { value: '2d_british_comic', label: '2D英式漫画', desc: '波普彩色', emoji: '📖',
        gradient: 'linear-gradient(135deg, #f7ec13 0%, #ff3366 30%, #00b4d8 60%, #06d6a0 100%)',
        aiHint: '2D 英式漫画风格：粗黑描边线条，高饱和波普色彩，网点效果，夸张表情，动感张力构图' },
      { value: '2d_rubber_hose', label: '2D橡皮管', desc: '弹性复古', emoji: '🎪',
        gradient: 'linear-gradient(135deg, #f9e8c0 0%, #e8c97a 30%, #8b6914 60%, #3c280d 100%)',
        aiHint: '2D 橡皮管动画风格：1920-30 年代早期动画美学，弯曲弹性四肢，圆形大眼，黑白胶片质感，复古欢快' },
      { value: '2d_golden', label: '黄金光堂', desc: '华丽光效', emoji: '👑',
        gradient: 'linear-gradient(135deg, #462523 0%, #cb9b51 22%, #f6e27a 45%, #cb9b51 67%, #462523 100%)',
        aiHint: '黄金光堂风格：华丽金色光效，奢华宫殿质感，金属光泽渲染，暖金色调，高贵典雅的视觉盛宴' },
    ],
  },
  {
    key: 'live_action', label: '真人实拍',
    styles: [
      { value: 'live_action', label: '真人电影', desc: '高清写实', emoji: '🎬', featured: true,
        gradient: 'linear-gradient(135deg, #1c1c1c 0%, #363636 40%, #5a5a5a 70%, #0066cc 100%)',
        aiHint: '真人影视风格：高清写实摄影质感，电影级光影，演员面部细节丰富，适合都市/现代题材' },
      { value: 'period_live', label: '真人古装', desc: '古典历史', emoji: '🏯', featured: true,
        gradient: 'linear-gradient(135deg, #3e2723 0%, #795548 30%, #a1887f 60%, #d7ccc8 100%)',
        aiHint: '真人古装风格：中国古典历史质感，古风服饰，柔和暖调光影，水墨晕染般的自然美感' },
      { value: 'hk_film', label: '真人香港片', desc: '港风经典', emoji: '🌆',
        gradient: 'linear-gradient(135deg, #1a1a2e 0%, #e94560 30%, #0f3460 60%, #16213e 100%)',
        aiHint: '真人香港电影风格：80-90年代港片美学，霓虹街景，胶片质感，高对比度调色，王家卫式迷离光影' },
      { value: 'retro_wuxia', label: '真人复古武侠', desc: '武侠江湖', emoji: '⚔️',
        gradient: 'linear-gradient(135deg, #2c1810 0%, #5d4037 30%, #795548 60%, #a1887f 80%, #efebe9 100%)',
        aiHint: '真人复古武侠风格：经典武侠片美学，胶片暖色调，大漠孤烟/竹林飞瀑场景，武打动作质感，侠客江湖' },
      { value: 'western_film', label: '欧美大片', desc: '好莱坞风', emoji: '🎥', featured: true,
        gradient: 'linear-gradient(135deg, #000428 0%, #004e92 40%, #2196f3 100%)',
        aiHint: '欧美好莱坞大片风格：高对比度调色，宽画幅电影构图，戏剧性光影，商业片视觉语言，IMAX 质感' },
    ],
  },
  {
    key: 'stop_motion', label: '定格动画',
    styles: [
      { value: 'stop_motion', label: '定格动画', desc: '手工质感', emoji: '🎞️', featured: true,
        gradient: 'linear-gradient(135deg, #c9b18c 0%, #e8d5b7 30%, #f5ebe0 60%, #d5c4a1 100%)',
        aiHint: '定格动画风格：手工制作质感，实物模型感，帧帧拍摄的微妙抖动，温暖手作美感' },
      { value: 'clay_stop', label: '粘土定格', desc: '黏土世界', emoji: '🫕', featured: true,
        gradient: 'linear-gradient(135deg, #ff8a65 0%, #ffab91 30%, #ffccbc 60%, #fbe9e7 100%)',
        aiHint: '粘土定格动画风格：彩色黏土角色，手指捏制纹理，阿德曼动画式质感，圆润可爱的黏土世界' },
      { value: 'lego_stop', label: '积木定格', desc: '乐高风格', emoji: '🧱',
        gradient: 'linear-gradient(135deg, #f44336 0%, #ffeb3b 25%, #4caf50 50%, #2196f3 75%, #ff9800 100%)',
        aiHint: '积木定格动画风格：乐高积木质感，鲜艳塑料色彩，方块化场景与角色，玩具模型般的趣味世界' },
      { value: 'felt_stop', label: '毛毡定格', desc: '毛绒温暖', emoji: '🧶', featured: true,
        gradient: 'linear-gradient(135deg, #e8d5b7 0%, #f48fb1 30%, #ce93d8 60%, #81d4fa 100%)',
        aiHint: '毛毡定格动画风格：毛毡/羊毛材质质感，针织温暖感，柔和模糊边缘，手工缝制美感，温馨可爱' },
      { value: 'paper_stop', label: '纸艺定格', desc: '剪纸风格', emoji: '📃',
        gradient: 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 30%, #ffe082 60%, #ff6f00 100%)',
        aiHint: '纸艺定格动画风格：剪纸与折纸质感，层叠纸张立体感，皮影戏式光影，纸张纹理，中国剪纸艺术' },
    ],
  },
];

const ALL_STYLES = STYLE_CATEGORIES.flatMap(c => c.styles);

const GENRE_ICONS: Record<string, string> = {
  boss: '💼', sweet: '🍬', warrior: '⚔️', timetravel: '🌀', palace: '👑',
  revenge: '🔥', rebirth: '🔄', suspense: '🔍', urban: '🏙️', ancient: '🏮',
  history_edu: '📜', biography: '👤', mythology: '🐉', science: '🔬',
};

const PLATFORM_PRESETS = [
  { value: 'douyin' as const, label: '抖音', defaultAspect: '9:16' as const, defaultDuration: 120, desc: '竖屏·60-120秒' },
  { value: 'kuaishou' as const, label: '快手', defaultAspect: '9:16' as const, defaultDuration: 120, desc: '竖屏·60-120秒' },
  { value: 'hongguo' as const, label: '红果短剧', defaultAspect: '9:16' as const, defaultDuration: 180, desc: '竖屏·2-3分钟' },
  { value: 'wechat_mini' as const, label: '微信小程序', defaultAspect: '9:16' as const, defaultDuration: 180, desc: '竖屏·2-3分钟' },
  { value: 'bilibili' as const, label: 'B站', defaultAspect: '16:9' as const, defaultDuration: 300, desc: '横屏·3-5分钟' },
  { value: 'tencent_video' as const, label: '腾讯视频', defaultAspect: '16:9' as const, defaultDuration: 300, desc: '横屏·3-5分钟' },
  { value: 'mango_tv' as const, label: '芒果TV', defaultAspect: '16:9' as const, defaultDuration: 300, desc: '横屏·3-5分钟' },
  { value: 'iqiyi' as const, label: '爱奇艺', defaultAspect: '16:9' as const, defaultDuration: 300, desc: '横屏·3-5分钟' },
  { value: 'reelshort' as const, label: 'ReelShort', defaultAspect: '9:16' as const, defaultDuration: 120, desc: '竖屏·海外付费' },
  { value: 'dramabox' as const, label: 'DramaBox', defaultAspect: '9:16' as const, defaultDuration: 180, desc: '竖屏·海外付费' },
  { value: 'generic' as const, label: '通用', defaultAspect: '9:16' as const, defaultDuration: 180, desc: '默认竖屏配置' },
];

const DURATION_PRESETS = [
  { value: 120, label: '2 分钟', desc: '节奏最快' },
  { value: 180, label: '3 分钟', desc: '标准时长' },
  { value: 300, label: '5 分钟', desc: '深度叙事' },
];

const SCALE_PRESETS = [
  { min: 40, max: 60, label: '40-60 集', desc: '紧凑型' },
  { min: 60, max: 100, label: '60-100 集', desc: '标准型' },
  { min: 100, max: 150, label: '100-150 集', desc: '长线型' },
];

const GENERATION_MODE_PRESETS = [
  { value: 'fast' as const, label: '极速', desc: '更快出片，质量门槛更宽松' },
  { value: 'balanced' as const, label: '均衡', desc: '速度与质量平衡（推荐）' },
  { value: 'quality' as const, label: '高质', desc: '更严格质量与重试，耗时更长' },
];

const AUDIENCE_PRESETS = [
  { label: '18-30 岁女性', tags: ['女性向', '18-30岁'] },
  { label: '18-30 岁男性', tags: ['男性向', '18-30岁'] },
  { label: '25-40 岁女性', tags: ['女性向', '25-40岁'] },
  { label: '全年龄', tags: ['男女通吃'] },
];

const PROTAGONIST_FOCUS = [
  { value: 'female_lead' as const, label: '女主向' },
  { value: 'male_lead' as const, label: '男主向' },
  { value: 'dual_lead' as const, label: '双主角' },
  { value: 'ensemble' as const, label: '群像' },
];

const STEPS = [
  { title: '核心创意', icon: Sparkles, desc: '描述你的创作灵感' },
  { title: '类型与受众', icon: Users, desc: '选择题材、平台与受众' },
  { title: '视觉风格', icon: Palette, desc: '选择画面美学风格' },
  { title: '主线与标题', icon: Target, desc: '定义叙事主线和标题' },
  { title: '规模配置', icon: Settings2, desc: '集数和时长设置' },
];

const GEN_STEPS = [
  { label: '种子分析', step: 'create_0' },
  { label: '总导演规划大纲', step: 'create_1' },
  { label: '视觉资产设计', step: 'create_2' },
  { label: '生成角色定妆照', step: 'create_3' },
  { label: '编剧手册+策略', step: 'create_4' },
  { label: '完成', step: 'create_5' },
];

interface FormState extends CreateDramaParams { customAudience: string; useCustomAudience: boolean; selectedVisualStyle: string; }

const CreateDrama: React.FC = () => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [genSteps, setGenSteps] = useState(GEN_STEPS.map(s => ({ ...s, done: false })));
  const [genError, setGenError] = useState<string | null>(null);
  const failedDramaIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const [enhancing, setEnhancing] = useState(false);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [originalIdea, setOriginalIdea] = useState('');
  const [generatingGoal, setGeneratingGoal] = useState(false);
  const [goalAlternatives, setGoalAlternatives] = useState<string[]>([]);
  const [recommending, setRecommending] = useState(false);

  const [templates, setTemplates] = useState<DramaGenreTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  useEffect(() => {
    setTemplatesLoading(true);
    listDramaGenreTemplates().then(setTemplates).catch(() => {}).finally(() => setTemplatesLoading(false));
  }, []);

  const [form, setForm] = useState<FormState>({
    mainIdea: '', genre: '', targetAudience: '', protagonistFocus: 'female_lead',
    tonePreference: '', audienceTags: [], titleHint: '', mainStoryGoal: '',
    platformTarget: 'generic', aspectRatio: '9:16',
    targetEpisodeDurationSec: 180, plannedMinEpisodes: 60, plannedMaxEpisodes: 100,
    generationMode: 'balanced',
    customAudience: '', useCustomAudience: false, selectedVisualStyle: '',
  });

  const effectiveAudience = form.useCustomAudience ? form.customAudience : form.targetAudience;
  const isGenerating = step === 5;
  const formStepCount = STEPS.length;

  const canNext = useCallback(() => {
    if (step === 0) return (form.mainIdea ?? '').trim().length >= 10;
    if (step === 1) return (form.genre ?? '').trim().length > 0 && (effectiveAudience ?? '').trim().length > 0;
    if (step === 2) return true; // style is optional
    if (step === 3) return true;
    if (step === 4) return true;
    return false;
  }, [step, form, effectiveAudience]);

  const handleEnhance = async () => {
    if ((form.mainIdea ?? '').trim().length < 5) return;
    setEnhancing(true);
    setOriginalIdea(form.mainIdea);
    try {
      const result = await enhanceDramaIdea(form.mainIdea, form.genre || undefined);
      if (result?.enhanced) {
        setForm(prev => ({ ...prev, mainIdea: result.enhanced }));
        setHighlights(result.highlights ?? []);
      }
    } catch { /* keep original */ }
    finally { setEnhancing(false); }
  };

  const handleRevertIdea = () => {
    if (originalIdea) { setForm(prev => ({ ...prev, mainIdea: originalIdea })); setHighlights([]); setOriginalIdea(''); }
  };

  const handleGenerateGoal = async () => {
    if (!form.genre || !effectiveAudience || !form.mainIdea) return;
    setGeneratingGoal(true);
    try {
      const result = await generateDramaGoal(form.mainIdea, form.genre, effectiveAudience);
      if (result?.goal) { setForm(prev => ({ ...prev, mainStoryGoal: result.goal })); setGoalAlternatives(result.alternatives ?? []); }
    } catch { /* keep empty */ }
    finally { setGeneratingGoal(false); }
  };

  const handleRecommendGenreAudience = async () => {
    if (!(form.mainIdea ?? '').trim()) return;
    setRecommending(true);
    try {
      const r = await recommendGenreAndAudience(form.mainIdea);
      const tpl = templates.find(t => t.displayName === r.genreDisplayName);
      const audienceTags = AUDIENCE_PRESETS.find(a => a.label === r.targetAudience)?.tags ?? [];
      const matchedVisualStyle = r.suggestedVisualStyle && ALL_STYLES.find(s => s.value === r.suggestedVisualStyle)
        ? r.suggestedVisualStyle : '';
      const matchedDuration = r.targetEpisodeDurationSec && DURATION_PRESETS.find(d => d.value === r.targetEpisodeDurationSec)
        ? r.targetEpisodeDurationSec : 0;
      const matchedScale = r.plannedEpisodes && SCALE_PRESETS.find(s => s.min === r.plannedEpisodes!.min && s.max === r.plannedEpisodes!.max)
        ? r.plannedEpisodes : null;
      setForm(prev => ({
        ...prev, genre: r.genreDisplayName, genreTemplateId: tpl?.id ?? prev.genreTemplateId,
        platformTarget: r.platformTarget as FormState['platformTarget'],
        targetAudience: r.targetAudience, audienceTags,
        protagonistFocus: r.protagonistFocus as FormState['protagonistFocus'],
        selectedVisualStyle: matchedVisualStyle || prev.selectedVisualStyle,
        aspectRatio: r.aspectRatio ?? prev.aspectRatio,
        targetEpisodeDurationSec: matchedDuration || prev.targetEpisodeDurationSec,
        plannedMinEpisodes: matchedScale?.min ?? prev.plannedMinEpisodes,
        plannedMaxEpisodes: matchedScale?.max ?? prev.plannedMaxEpisodes,
      }));
      message.success('已根据创意智能推荐');
    } catch { message.error('推荐失败'); }
    finally { setRecommending(false); }
  };

  const handleSubmit = async () => {
    const isRetry = !!(genError && failedDramaIdRef.current);
    setStep(5);
    setLoading(true);
    setGenProgress(0);
    if (!isRetry) setGenError(null);
    setGenSteps(GEN_STEPS.map(s => ({ ...s, done: false })));

    const params: CreateDramaParams = {
      mainIdea: form.mainIdea, genre: form.genre, targetAudience: effectiveAudience,
      protagonistFocus: form.protagonistFocus, tonePreference: form.tonePreference || undefined,
      audienceTags: form.audienceTags?.length ? form.audienceTags : undefined,
      titleHint: form.titleHint || undefined, mainStoryGoal: form.mainStoryGoal || undefined,
      platformTarget: form.platformTarget, aspectRatio: form.aspectRatio,
      targetEpisodeDurationSec: form.targetEpisodeDurationSec,
      plannedMinEpisodes: form.plannedMinEpisodes, plannedMaxEpisodes: form.plannedMaxEpisodes,
      generationMode: form.generationMode,
      genreTemplateId: form.genreTemplateId || undefined,
      visualStyleHint: form.selectedVisualStyle
        ? ALL_STYLES.find(s => s.value === form.selectedVisualStyle)?.aiHint || undefined
        : undefined,
    };

    const STALE_MS = 600_000;
    let staleTimer!: ReturnType<typeof setTimeout>;
    let dramaId: string | undefined;
    const controller = new AbortController();
    abortRef.current = controller;
    const touchStale = () => { clearTimeout(staleTimer); staleTimer = setTimeout(() => controller.abort(), STALE_MS); };

    try {
      if (isRetry) {
        dramaId = failedDramaIdRef.current!;
        await retryCreateDrama(dramaId);
        setGenError(null);
      } else {
        failedDramaIdRef.current = null;
        const res = await createDrama(params);
        dramaId = res.dramaId;
      }
      if (!dramaId) throw new Error('创建失败：dramaId缺失');
      const currentDramaId = dramaId;
      touchStale();

      const response = await fetch(getCreateDramaSseUrl(currentDramaId), {
        method: 'GET',
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${getToken()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        clearTimeout(staleTimer);
        const poll = async () => {
          for (let i = 0; i < 120; i++) {
            await new Promise(r => setTimeout(r, 3000));
            try {
              const d = await getDrama(currentDramaId) as any;
              if (d?.state?.seed) {
                setGenSteps(prev => prev.map(s => ({ ...s, done: true })));
                setGenProgress(100);
                message.success('短剧创建成功');
                setTimeout(() => history.push(`/novel/drama/${currentDramaId}`), 600);
                return;
              }
            } catch { /* retry */ }
          }
          failedDramaIdRef.current = currentDramaId;
          setGenError('创建超时');
          setLoading(false);
        };
        poll();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalHandled = false;

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        touchStale();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim()) as DramaSseEvent;
            if (payload._type === 'heartbeat' || payload._type === 'info') continue;
            if (payload._type === 'error' || payload.error || payload.terminalStatus === 'failed') {
              clearTimeout(staleTimer);
              failedDramaIdRef.current = currentDramaId;
              const msg = payload.error || payload.message || '创建失败';
              setGenError(msg);
              setLoading(false);
              return;
            }
            if (payload._type === 'progress') {
              const idx = payload.stepIndex ?? -1;
              const total = payload.totalSteps ?? 0;
              const progress = total > 0
                ? Math.round(((idx + (payload.done ? 1 : 0.5)) / total) * 100)
                : 0;
              setGenProgress(progress);
              if (idx >= 0) {
                setGenSteps(prev => prev.map((s, i) => {
                  if (i < idx) return { ...s, done: true };
                  if (i === idx) return { ...s, done: payload.done ?? false };
                  return s;
                }));
              }
              continue;
            }
            if (payload._type === 'result') {
              terminalHandled = true;
              clearTimeout(staleTimer);
              failedDramaIdRef.current = null;
              setGenProgress(100);
              setGenSteps(prev => prev.map(s => ({ ...s, done: true })));
              message.success(payload.message || '短剧创建成功');
              setTimeout(() => history.push(`/novel/drama/${currentDramaId}`), 600);
              return;
            }
          } catch { /* skip malformed */ }
        }
      }

      clearTimeout(staleTimer);
      if (!terminalHandled) {
        failedDramaIdRef.current = currentDramaId;
        setGenError('创建连接中断，请重试');
        setLoading(false);
      }
    } catch (error: any) {
      clearTimeout(staleTimer!);
      if (dramaId) failedDramaIdRef.current = dramaId;
      const errMsg = error?.message || '创建失败';
      message.error(errMsg);
      setGenError(errMsg);
      setLoading(false);
    }
  };

  const goBack = () => {
    if (isGenerating) return;
    if (step > 0) setStep(step - 1);
    else history.push('/novel/dramas');
  };

  // ─── Style thumbnail card ─────────────────────────────────────────
  const StyleCard: React.FC<{ style: StyleOption }> = ({ style }) => {
    const isSelected = form.selectedVisualStyle === style.value;
    return (
      <button
        type="button"
        onClick={() => setForm({ ...form, selectedVisualStyle: isSelected ? '' : style.value })}
        className={cn(
          'group relative flex flex-col rounded-xl overflow-hidden border-2 transition-all duration-200',
          'hover:scale-[1.03] hover:shadow-md active:scale-100',
          isSelected
            ? 'border-primary ring-2 ring-primary/30 shadow-lg shadow-primary/10'
            : 'border-transparent hover:border-primary/40',
        )}
      >
        {/* Thumbnail */}
        <div
          className="relative aspect-[4/3] w-full flex items-center justify-center overflow-hidden"
          style={{ background: style.thumbnailUrl ? undefined : style.gradient }}
        >
          {style.thumbnailUrl ? (
            <img src={style.thumbnailUrl} alt={style.label} className="w-full h-full object-cover" />
          ) : (
            <span className="text-3xl drop-shadow-lg select-none">{style.emoji}</span>
          )}
          {/* Featured badge */}
          {style.featured && (
            <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/90 text-white leading-none">
              精选
            </span>
          )}
          {/* Selected overlay */}
          {isSelected && (
            <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                <Check className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>
        {/* Label */}
        <div className={cn(
          'px-1.5 py-1.5 text-center transition-colors',
          isSelected ? 'bg-primary/10' : 'bg-card',
        )}>
          <p className={cn('text-[11px] font-semibold leading-tight truncate', isSelected && 'text-primary')}>
            {style.label}
          </p>
          <p className="text-[9px] text-muted-foreground leading-tight mt-0.5 truncate">{style.desc}</p>
        </div>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-8 pb-24 sm:pb-8">
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5 -ml-2" onClick={goBack} disabled={loading}>
        <ArrowLeft className="h-4 w-4" />{step > 0 && !isGenerating ? '上一步' : '返回'}
      </Button>

      {!isGenerating && (
        <div className="hidden sm:block mb-6">
          <div className="flex items-center">
            {STEPS.map((s, i) => {
              const StepIcon = s.icon;
              return (
                <React.Fragment key={s.title}>
                  <button type="button" className={cn('flex items-center gap-2.5 transition-all shrink-0', i < step && 'cursor-pointer group', i > step && 'cursor-default')} onClick={() => i < step && setStep(i)} disabled={i > step}>
                    <div className={cn('flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-all duration-300', i < step ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : i === step ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/20 shadow-md shadow-primary/20' : 'bg-muted text-muted-foreground')}>
                      {i < step ? <Check className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
                    </div>
                    <div className="hidden md:block text-left">
                      <p className={cn('text-sm font-semibold leading-tight', i === step ? 'text-foreground' : i < step ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground')}>{s.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{s.desc}</p>
                    </div>
                  </button>
                  {i < STEPS.length - 1 && <div className="flex-1 mx-3 md:mx-4"><div className={cn('h-0.5 rounded-full transition-colors duration-300', i < step ? 'bg-primary/60' : 'bg-border')} /></div>}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {!isGenerating && (
        <div className="sm:hidden mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 text-white font-bold text-sm shadow-sm shrink-0">{step + 1}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{STEPS[step]?.title}</p>
              <p className="text-xs text-muted-foreground">{STEPS[step]?.desc}</p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{step + 1}/{formStepCount}</span>
          </div>
          <div className="mt-3 flex gap-1">
            {Array.from({ length: formStepCount }).map((_, i) => (
              <div key={i} className={cn('h-1 flex-1 rounded-full transition-all duration-300', i <= step ? 'bg-violet-500' : 'bg-muted')} />
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Core Idea */}
      {step === 0 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">你的创作灵感是什么？</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">越具体越好——可以是短剧故事、历史人物介绍、科普知识、神话传说等任何内容。AI 会据此构建完整的内容世界。</p>
          </div>
          <Card className="border-primary/15 bg-primary/5">
            <CardContent className="p-4 text-sm">
              <div className="flex items-start gap-2"><Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" /><div><p className="font-medium text-foreground">这一步做什么？</p><p className="mt-1 text-muted-foreground">用一段话描述你想做的内容，AI 会据此生成世界观、角色和剧情。例如：<strong>短剧故事</strong>（人物身份、核心冲突、反转爽点）、<strong>历史人物</strong>（如李白的一生）、<strong>科普知识</strong>（如宇宙大爆炸）、<strong>神话传说</strong>（如哪吒闹海）。</p></div></div>
            </CardContent>
          </Card>
          <div className="space-y-2">
            <Label>核心创意</Label>
            <Textarea placeholder={"例如：\n• 短剧：隐瞒首富独女身份下嫁三年，被婆婆羞辱净身出户，暴雨夜登上劳斯莱斯归来继承千亿集团...\n• 历史：介绍诗仙李白的一生，从蜀中少年到赐金放还，展现盛唐诗人的命运与才华...\n• 科普：揭秘人类大脑的奥秘，用趣味故事讲解记忆、梦境和意识的科学原理..."} className="min-h-[140px] text-sm resize-none" disabled={enhancing} value={form.mainIdea} onChange={(e) => { setForm({ ...form, mainIdea: e.target.value }); if (highlights.length > 0) { setHighlights([]); setOriginalIdea(''); } }} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{(form.mainIdea ?? '').length} 字 · 建议至少 20 字</p>
              <div className="flex items-center gap-1.5 shrink-0">
                {originalIdea && <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground" onClick={handleRevertIdea}><ArrowLeft className="h-3 w-3" />还原</Button>}
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={(form.mainIdea ?? '').trim().length < 5 || enhancing} onClick={handleEnhance}>
                  {enhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {enhancing ? 'AI 优化中...' : 'AI 美化创意'}
                </Button>
              </div>
            </div>
          </div>

          {highlights.length > 0 && (
            <Card className="border-emerald-200/60 bg-gradient-to-br from-emerald-50 via-white to-teal-50/50 dark:border-emerald-800/40 dark:from-emerald-950/40 dark:via-background dark:to-teal-950/20">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">AI 创意增强</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] h-5 px-1.5 bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 border-0">{highlights.length} 项优化</Badge>
                </div>
                <div className="space-y-2.5">
                  {highlights.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 animate-fade-in" style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}>
                      <span className="shrink-0 mt-[3px] flex items-center justify-center w-5 h-5 rounded-md bg-emerald-500/10 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{i + 1}</span>
                      <p className="text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-300/90">{h}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step 2: Genre & Audience */}
      {step === 1 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">选择题材与目标观众</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">根据上一步的创意，选择最匹配的题材和受众，AI 会据此调整内容风格和节奏。</p>
          </div>
          <Card className="border-primary/15 bg-primary/5">
            <CardContent className="p-4 text-sm">
              <div className="flex items-start gap-2"><Users className="h-4 w-4 text-primary shrink-0 mt-0.5" /><div><p className="font-medium text-foreground">如何选择？</p><p className="mt-1 text-muted-foreground"><strong>题材</strong>：选与创意最贴合的（短剧故事→霸总/都市等，历史内容→历史教育/人物传记，科普→科普知识）。<strong>平台</strong>：抖音/快手节奏更快，ReelShort 偏海外。<strong>观众</strong>：短剧按性别/年龄选择，知识/教育类通常选全年龄。<strong>叙事聚焦</strong>：女主向=以女主视角为主，群像=多角色/知识类。</p><Button variant="outline" size="sm" className="mt-3 gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={!(form.mainIdea ?? '').trim() || recommending} onClick={handleRecommendGenreAudience}>{recommending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{recommending ? 'AI 推荐中...' : 'AI 智能推荐'}</Button></div></div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div><Label>内容题材</Label><p className="text-xs text-muted-foreground mt-0.5">选与创意最匹配的，点击卡片即可</p></div>
              <button type="button" className="text-xs text-primary hover:underline shrink-0" onClick={() => history.push('/novel/templates')}>管理题材模板</button>
            </div>
            {templatesLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin" />加载题材模板...</div>
            ) : templates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {templates.map(t => (
                  <button key={t.id} type="button" className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all hover:border-primary/50',
                    form.genreTemplateId === t.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                  )} onClick={() => setForm({ ...form, genre: t.displayName, genreTemplateId: t.id })}>
                    <span className="text-lg">{GENRE_ICONS[t.genreKey] ?? '📝'}</span>
                    <span className="text-xs font-medium">{t.displayName}</span>
                    <span className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</span>
                    {!t.isSystem && <span className="text-[9px] text-primary/60">自定义</span>}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <p>暂无题材模板，请先去<button type="button" className="text-primary hover:underline mx-1" onClick={() => history.push('/novel/templates')}>题材模板管理</button>添加</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div><Label>主投平台</Label><p className="text-xs text-muted-foreground mt-0.5">自动匹配画幅和推荐时长，后续可投多平台</p></div>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_PRESETS.map(p => (
                <Badge key={p.value} variant={form.platformTarget === p.value ? 'default' : 'outline'}
                  className={cn('cursor-pointer px-3 py-1.5 text-xs', form.platformTarget === p.value && 'ring-2 ring-primary/20')}
                  onClick={() => {
                    const nearest = DURATION_PRESETS.reduce((a, b) => Math.abs(b.value - p.defaultDuration) < Math.abs(a.value - p.defaultDuration) ? b : a);
                    setForm(prev => ({ ...prev, platformTarget: p.value, aspectRatio: p.defaultAspect, targetEpisodeDurationSec: nearest.value }));
                  }}
                >{p.label}<span className="ml-1 opacity-60 text-[10px]">{p.desc}</span></Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div><Label>目标观众</Label><p className="text-xs text-muted-foreground mt-0.5">决定剧情走向和爽点设计，选主受众即可</p></div>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_PRESETS.map(a => (
                <Badge key={a.label} variant={form.targetAudience === a.label ? 'default' : 'outline'}
                  className={cn('cursor-pointer px-3 py-1.5 text-xs', form.targetAudience === a.label && 'ring-2 ring-primary/20')}
                  onClick={() => setForm({ ...form, targetAudience: a.label, audienceTags: a.tags })}
                >{a.label}</Badge>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div><Label>叙事聚焦</Label><p className="text-xs text-muted-foreground mt-0.5">决定主角视角和叙事重心</p></div>
            <div className="grid grid-cols-4 gap-2">
              {PROTAGONIST_FOCUS.map(opt => (
                <button key={opt.value} type="button" className={cn(
                  'rounded-lg border p-2 text-center text-xs font-medium transition-all',
                  form.protagonistFocus === opt.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, protagonistFocus: opt.value })}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Visual Style Gallery */}
      {step === 2 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold">选择视觉风格</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  决定整部剧的美学基调，AI 会据此生成角色设定和场景描述
                </p>
              </div>
              {form.selectedVisualStyle && (
                <Button
                  variant="ghost" size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => setForm({ ...form, selectedVisualStyle: '' })}
                >
                  清除选择
                </Button>
              )}
            </div>
          </div>

          {/* Selected style preview */}
          {form.selectedVisualStyle && (() => {
            const sel = ALL_STYLES.find(s => s.value === form.selectedVisualStyle);
            if (!sel) return null;
            return (
              <Card className="border-primary/30 bg-primary/5 overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4">
                    <div
                      className="shrink-0 w-16 h-12 rounded-lg flex items-center justify-center overflow-hidden"
                      style={{ background: sel.thumbnailUrl ? undefined : sel.gradient }}
                    >
                      {sel.thumbnailUrl
                        ? <img src={sel.thumbnailUrl} alt={sel.label} className="w-full h-full object-cover" />
                        : <span className="text-2xl">{sel.emoji}</span>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-bold text-primary">{sel.label}</span>
                        <span className="text-xs text-muted-foreground">· {sel.desc}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{sel.aiHint}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Style categories */}
          {STYLE_CATEGORIES.map(category => (
            <div key={category.key} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">{category.label}</h3>
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] text-muted-foreground tabular-nums">{category.styles.length} 款</span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                {category.styles.map(style => (
                  <StyleCard key={style.value} style={style} />
                ))}
              </div>
            </div>
          ))}

          {!form.selectedVisualStyle && (
            <p className="text-xs text-muted-foreground/70 italic text-center pt-2">
              不选择则由 AI 根据题材自动决定视觉风格
            </p>
          )}
        </div>
      )}

      {/* Step 4: Goal & Title */}
      {step === 3 && (
        <div className="animate-fade-in space-y-5">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Target className="h-6 w-6 text-primary shrink-0" />
              <h2 className="text-xl sm:text-2xl font-bold">叙事主线与标题</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground pl-9">贯穿全剧的叙事主线——短剧是核心冲突，教育/科普类是叙事脉络。可以自己写，也可以让 AI 帮你生成。</p>
          </div>
          <div className="space-y-2">
            <Label>叙事主线（可选）</Label>
            <Textarea placeholder={"例如：\n• 短剧：女主揭露豪门家族的真相...\n• 历史：从少年蜀中到赐金放还，展现李白在盛唐的诗意人生...\n• 科普：从微观粒子到宇宙尽头，揭示物质世界的终极奥秘..."} className="min-h-[100px] text-sm resize-none" value={form.mainStoryGoal} onChange={(e) => { setForm({ ...form, mainStoryGoal: e.target.value }); if (goalAlternatives.length > 0) setGoalAlternatives([]); }} />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/5" disabled={generatingGoal} onClick={handleGenerateGoal}>
                {generatingGoal ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {generatingGoal ? 'AI 生成中...' : 'AI 生成目标'}
              </Button>
            </div>
          </div>

          {goalAlternatives.length > 0 && (
            <Card className="border-primary/15 bg-gradient-to-br from-primary/3 to-transparent">
              <CardContent className="p-3.5 sm:p-4 space-y-2">
                <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><p className="text-xs font-semibold text-foreground">AI 备选方案（点击替换）</p></div>
                <div className="space-y-1.5">
                  {goalAlternatives.map((alt, i) => (
                    <button type="button" key={i} className="w-full text-left rounded-lg border border-border bg-background/70 px-3 py-2.5 text-sm text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-foreground" onClick={() => { setForm(prev => ({ ...prev, mainStoryGoal: alt })); setGoalAlternatives([]); }}>{alt}</button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            <Label>标题灵感（可选）</Label>
            <Input placeholder="如「闪婚后，陆总每天求复合」或「诗仙李白」" value={form.titleHint} onChange={(e) => setForm({ ...form, titleHint: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>调性偏好（可选）</Label>
            <Input placeholder="如：爽快反转、虐中带甜、知性厚重、趣味科普" value={form.tonePreference ?? ''} onChange={(e) => setForm({ ...form, tonePreference: e.target.value })} />
          </div>
        </div>
      )}

      {/* Step 5: Scale Config */}
      {step === 4 && (
        <div className="animate-fade-in space-y-5">
          <h2 className="text-xl sm:text-2xl font-bold">规模配置</h2>

          {/* Aspect Ratio */}
          <div className="space-y-3">
            <div><Label>画面比例</Label><p className="text-xs text-muted-foreground mt-0.5">决定视频的显示方向，影响构图风格</p></div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { value: '9:16' as const, label: '竖屏', desc: '短视频 · 抖音 / 快手', shape: { w: 36, h: 64 } },
                { value: '16:9' as const, label: '横屏', desc: '影视感 · 宽屏叙事', shape: { w: 64, h: 36 } },
              ] as const).map(opt => (
                <button key={opt.value} type="button"
                  className={cn(
                    'flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center transition-all hover:border-primary/50',
                    form.aspectRatio === opt.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                  )}
                  onClick={() => setForm({ ...form, aspectRatio: opt.value })}
                >
                  <div
                    className={cn(
                      'rounded border-2 transition-colors',
                      form.aspectRatio === opt.value ? 'border-primary bg-primary/15' : 'border-muted-foreground/30 bg-muted/40',
                    )}
                    style={{ width: opt.shape.w / 5, height: opt.shape.h / 5 }}
                  />
                  <div>
                    <p className="text-sm font-semibold">{opt.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{opt.value} · {opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>每集目标时长</Label>
            <div className="grid grid-cols-3 gap-2">
              {DURATION_PRESETS.map(d => (
                <button key={d.value} type="button" className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all',
                  form.targetEpisodeDurationSec === d.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, targetEpisodeDurationSec: d.value })}>
                  <span className="text-lg font-bold">{d.label}</span>
                  <span className="text-[11px] text-muted-foreground">{d.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <Label>总集数规模</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCALE_PRESETS.map(s => (
                <button key={s.label} type="button" className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all',
                  form.plannedMinEpisodes === s.min && form.plannedMaxEpisodes === s.max ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                )} onClick={() => setForm({ ...form, plannedMinEpisodes: s.min, plannedMaxEpisodes: s.max })}>
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="text-[11px] text-muted-foreground">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <Label>生成模式</Label>
              <p className="text-xs text-muted-foreground mt-0.5">影响图片/视频并发、重试与质量校验强度</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {GENERATION_MODE_PRESETS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all',
                    form.generationMode === opt.value ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border',
                  )}
                  onClick={() => setForm({ ...form, generationMode: opt.value })}
                >
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Card className="border-primary/15 bg-gradient-to-br from-primary/3 to-transparent">
            <CardContent className="p-4 space-y-2.5 text-sm">
              <div className="flex items-center gap-2 mb-3"><Film className="h-4 w-4 text-primary" /><span className="font-semibold">创建摘要</span></div>
              {[
                { label: '创意', value: form.mainIdea.slice(0, 60) + (form.mainIdea.length > 60 ? '...' : ''), clamp: true },
                { label: '题材', value: form.genre || '—' },
                { label: '风格', value: ALL_STYLES.find(s => s.value === form.selectedVisualStyle)?.label || 'AI 自动' },
                { label: '平台', value: PLATFORM_PRESETS.find(p => p.value === form.platformTarget)?.label || '通用' },
                { label: '观众', value: effectiveAudience || '—' },
                { label: '冲突', value: form.mainStoryGoal || '—', clamp: true },
                { label: '生成', value: GENERATION_MODE_PRESETS.find(m => m.value === form.generationMode)?.label || '均衡' },
                { label: '时长', value: `${(form.targetEpisodeDurationSec ?? 180) / 60} 分钟/集` },
                { label: '集数', value: `${form.plannedMinEpisodes}-${form.plannedMaxEpisodes} 集` },
              ].map(({ label, value, clamp }) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="shrink-0 w-12 text-primary/80 font-semibold text-xs">{label}</span>
                  <span className={cn('text-muted-foreground', clamp && 'line-clamp-2')}>{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Generating */}
      {isGenerating && (
        <div className="animate-fade-in flex flex-col items-center py-10 space-y-6">
          <Film className="h-16 w-16 text-violet-500 animate-pulse" />
          <div className="text-center">
            <h2 className="text-xl sm:text-2xl font-bold">AI 正在构建你的短剧</h2>
            <p className="mt-2 text-sm text-muted-foreground">正在为「{form.genre}」题材构建世界观和编剧手册，这通常需要 1-3 分钟...</p>
          </div>

          <div className="w-full max-w-md space-y-4 px-4">
            {genError ? (
              <div className="flex flex-col items-center space-y-4 pt-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40"><AlertTriangle className="h-6 w-6 text-red-500" /></div>
                <p className="text-center text-sm text-red-600 dark:text-red-400">{genError}</p>
                <div className="flex gap-3">
                  <Button variant="outline" size="sm" onClick={() => { setGenError(null); setStep(4); }}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />返回修改</Button>
                  <Button size="sm" onClick={handleSubmit}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />重试</Button>
                </div>
              </div>
            ) : (
              <>
                <Progress value={genProgress} className="h-2" />
                <p className="text-center text-sm text-muted-foreground">{Math.round(genProgress)}%</p>
                <div className="space-y-3 pt-4">
                  {genSteps.map((gs, i) => {
                    const isActive = !gs.done && (i === 0 || genSteps[i - 1]?.done);
                    return (
                      <div key={i} className="flex items-center gap-3">
                        {gs.done ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50"><Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /></div>
                        ) : isActive ? (
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : (
                          <div className="h-6 w-6 rounded-full border-2 border-muted" />
                        )}
                        <span className={cn('text-sm', gs.done ? 'text-foreground font-medium' : isActive ? 'text-foreground' : 'text-muted-foreground')}>{gs.label}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Navigation — Desktop */}
      {!isGenerating && (
        <>
          <div className="mt-8 hidden sm:flex justify-between items-center">
            <div>{step > 0 && <Button variant="ghost" size="lg" className="gap-2 text-muted-foreground hover:text-foreground" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" />上一步</Button>}</div>
            {step === formStepCount - 1 ? (
              <Button size="lg" className="gap-2" disabled={!canNext() || loading} onClick={handleSubmit}><Sparkles className="h-4 w-4" />开始创建</Button>
            ) : (
              <Button size="lg" className="gap-2" disabled={!canNext()} onClick={() => setStep(step + 1)}>下一步<ArrowRight className="h-4 w-4" /></Button>
            )}
          </div>

          {/* Navigation — Mobile: fixed bottom */}
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur-lg px-4 py-3 sm:hidden">
            <div className="flex gap-2">
              {step > 0 && <Button variant="outline" size="lg" className="gap-1" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" /></Button>}
              {step === formStepCount - 1 ? (
                <Button size="lg" className="flex-1 gap-2" disabled={!canNext() || loading} onClick={handleSubmit}><Sparkles className="h-4 w-4" />开始创建</Button>
              ) : (
                <Button size="lg" className="flex-1 gap-2" disabled={!canNext()} onClick={() => setStep(step + 1)}>下一步<ArrowRight className="h-4 w-4" /></Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CreateDrama;
