/** 短剧视觉风格模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DramaVisualStyleTemplateEntity, VisualStyleGuide, VisualPromptGuidance } from './entities/drama-visual-style-template.entity';
import { CreateDramaVisualStyleTemplateDto, UpdateDramaVisualStyleTemplateDto } from './dto/drama-visual-style-template.dto';

type StyleCategory = 'live_action' | '2d_animation' | '3d_animation' | 'stop_motion' | 'chinese_traditional' | '2d_art';

interface SystemVisualStyleTemplate {
  styleKey: string;
  displayName: string;
  description: string;
  styleCategory: StyleCategory;
  tags: string[];
  visualGuide: VisualStyleGuide;
  promptGuidance: VisualPromptGuidance;
  genreCompatibility: string[];
  audienceTags: string[];
  platformTags: string[];
}


// ── System template data (extracted to JSON for maintainability) ──
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SYSTEM_TEMPLATES: SystemVisualStyleTemplate[] = require('./data/visual-style-system-templates.json') as SystemVisualStyleTemplate[];


/**
 * 场景 visualPrompt 写法引导——按 styleKey 精准匹配（优先），否则按 styleCategory 兜底。
 * 注入到 seedSystemTemplates，替代 drama-playbook.ts 中的多风格示例硬编码 switch。
 */
const SCENE_PROMPT_GUIDANCE: Record<string, string> = {
  // ── 真人影视 ──────────────────────────────────────────────────────────────
  live_action:
    '示例：\n"modern urban office interior, Korean drama premium lighting, warm key light with cool shadow, shallow depth of field bokeh, 9:16 vertical composition, film grain texture, photorealistic, 4K, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节（空间/光线/材质/道具/氛围），全剧风格词（cinematic live action photography 等）已由系统自动注入，禁止在场景 visualPrompt 中重复写。\n⚠️ 必须包含写实质量词（photorealistic / film grain / 4K），禁止动漫类材质词。\ntextureStyle 使用：film grain / natural bokeh / realistic fabric / photorealistic skin。',

  period_live:
    '示例：\n"Tang dynasty imperial palace throne room, warm golden candlelight amber light, film grain, rich silk and linen textures, dougong wooden architecture, photorealistic, 4K, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节（空间/光线/材质/道具/氛围），全剧风格词（realistic cinematic photography / inspired by ... aesthetic 等）已由系统自动注入，禁止在场景 visualPrompt 中重复写，否则会造成 prompt 冗余和前缀跳过。\n⚠️ 严禁使用 ink wash edges / brush stroke / painterly 等绘画类材质词——这些属于水墨风格，会导致生成写实真人古装时出现水墨画感。\n⚠️ visualStyle.styleReferencePrompt 同样禁止 ink-wash / watercolor / illustration；柔和氛围用 soft cinematic color grading、film grain、muted palette。\ntextureStyle 只能使用写实材质词：film grain / natural skin texture / rich fabric textures / stone and wood details。',

  retro_wuxia:
    '示例：\n"ancient Chinese tavern interior, warm earth tones, 35mm film grain, bamboo forest exterior dappled light, worn leather sword scabbard detail, photorealistic, 4K, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（retro wuxia film photography / 1990s HK wuxia Tsui Hark aesthetic 等）已由系统自动注入，禁止重复写。\n⚠️ 严禁使用绘画类材质词（ink wash / painterly / brush stroke），只用 film grain / dust / leather / worn fabric。',

  hk_film:
    '示例：\n"rain-wet Hong Kong alley at night, neon sign reflections teal and orange on wet pavement, 35mm film grain texture, high contrast moody shadows, photorealistic, 4K, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Hong Kong noir film photography / Wong Kar-wai visual poetry 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：film grain / rain-wet surfaces / neon glow reflections / glass reflections。',

  western_film:
    '示例：\n"urban rooftop confrontation at dusk, orange teal shadow color grade, dramatic side lighting, anamorphic lens flare, photorealistic, 4K ultra-detailed, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Hollywood blockbuster cinematography / IMAX quality lighting 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：lens flare / photorealistic / anamorphic bokeh / realistic concrete。',

  // ── 中国传统 / 水墨 ────────────────────────────────────────────────────────
  chinese_ink:
    '示例：\n"misty mountain pavilion with ancient pine trees, soft ink wash brushstroke texture, traditional ink black white grey tones, rice paper negative space composition, highly detailed, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Chinese ink wash painting masterpiece / sumi-e calligraphy brushstroke style 等）已由系统自动注入，禁止重复写。\ntextureStyle 必须使用水墨画材质词：ink wash edges / brush stroke texture / rice paper texture / ink diffusion bloom。',

  chinese_style:
    '示例：\n"red lanterns and palace corridor walls, vibrant mineral pigment atmosphere, gold accent architectural ornaments, silk texture background, soft warm light, highly detailed, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Chinese gongbi traditional painting style / mineral pigments azure crimson 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：mineral pigment / gongbi line art / silk texture / gold leaf accent。',

  '2d_gongbi':
    '示例：\n"ancient courtyard pavilion scene, meticulous line detail, vibrant azure crimson ochre atmosphere, silk weave background texture, Tang dynasty classical ambiance, highly detailed, masterpiece"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Chinese gongbi fine brushwork painting masterpiece 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：gongbi ink line / mineral pigment wash / silk weave texture。',

  // ── 2D 动画 / 动漫 ──────────────────────────────────────────────────────────
  '2d_anime':
    '示例：\n"urban classroom interior at sunset, vibrant saturated colors, clean cel-shading hard shadow, detailed background art, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（anime style illustration / Japanese animation masterpiece quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：cel-shading / clean line art / flat color fill。严禁使用写实材质词（film grain / photorealistic）。',

  '2d_ghibli':
    '示例：\n"lush countryside meadow in summer, dappled sunlight through trees, gentle natural soft atmosphere, highly detailed background art, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Studio Ghibli style masterpiece / Miyazaki Hayao animation 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：watercolor wash / hand-drawn texture / soft color gradient。',

  '2d_korean_anime':
    '示例：\n"modern apartment interior warm natural light, pastel pink and cream tones, soft gradient shading, delicate decorative details, 9:16 vertical, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Korean webtoon style illustration / manhwa artwork 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：soft gradient / delicate line art / pastel color fill。',

  '2d_shoujo':
    '示例：\n"school rooftop at golden sunset, cherry blossom petals floating, sparkle star effects, screen tone halftone dots, romantic dreamy pink atmosphere, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（shoujo manga style illustration / screen tone halftone 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：screen tone / sparkle effects / flower decorations / pastel gradient。',

  '2d_film':
    '示例：\n"train station platform at golden hour, volumetric light rays streaming through windows, atmospheric perspective gradient, detailed environment, vibrant realistic colors, highly detailed, anime film masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Makoto Shinkai anime film style / cinematic 2D animation masterpiece 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：atmospheric perspective / volumetric light / detailed background art / film quality gradient。',

  '2d_retro_anime':
    '示例：\n"Japanese school hallway afternoon, warm vintage color palette, cel animation quality lighting, nostalgic old-school atmosphere, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（1990s anime style illustration / retro Japanese animation aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：cel animation / film grain / vintage warm palette / retro grain。',

  '2d_action':
    '示例：\n"rooftop battle scene at night, speed lines radiating background, explosion sparks impact effects, vibrant saturated energy glow, dynamic extreme camera angle, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（shounen action anime illustration / ufotable animation quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：speed lines / explosion sparks / energy glow / dynamic motion blur。',

  '2d_cybercity':
    '示例：\n"dystopian alley at night, rain-wet streets neon teal pink reflections, high contrast dark shadows, futuristic holographic billboard overlay, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（2D cyberpunk anime illustration / Ghost in the Shell aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：neon glow / holographic layer / rain reflections / digital noise。',

  '2d_death_note':
    '示例：\n"shadowy gothic library interior at night, high contrast black shadow dramatic split lighting, moody thriller oppressive atmosphere, deeply psychological composition, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（dark psychological thriller anime illustration / Death Note aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：high contrast shadow / gothic texture / dark atmosphere / precise line art。',

  '2d_horror':
    '示例：\n"abandoned hospital corridor at night, grotesque spiral pattern on walls, deep disturbing shadows, unsettling asymmetric composition, decay atmosphere, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Junji Ito horror manga style illustration / grotesque body horror aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：horror shadow / grotesque texture / ink line detail / disturbing distortion。',

  '2d_fantasy_anime':
    '示例：\n"magical enchanted forest clearing, glowing spell particle effects, vibrant jewel tone atmosphere, detailed European fantasy tree architecture, epic adventurous scale, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（2D fantasy anime illustration / magical adventure epic aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：magical glow / particle effects / vibrant jewel color / detailed fantasy texture。',

  '2d_british_anime':
    '示例：\n"cozy English countryside cottage afternoon, warm muted pastel atmosphere, watercolor paper texture feel, precise symmetrical composition, soft diffuse natural lighting, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（British animation style illustration / Wes Anderson animation style 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：watercolor texture / warm muted palette / paper grain / soft diffuse。',

  // ── 3D 动画 ─────────────────────────────────────────────────────────────────
  '3d_fantasy':
    '示例：\n"immortal mountain cloud sea realm, glowing spiritual aura effects purple gold, volumetric cloud atmosphere layers, divine realm epic scale environment, highly detailed, masterpiece, best quality, 8K"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D Chinese xianxia fantasy render / immortal cultivation divine realm 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：3D PBR silk material / magical particle glow / volumetric cloud / deity ornament detail。',

  '3d_chibi':
    '示例：\n"cozy kawaii bedroom interior, pastel candy pink and blue colors, round simplified furniture shapes, cheerful bright lighting atmosphere, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D chibi Q-version cute render / Nintendo Switch game aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：smooth cel-shading / pastel fill / simplified 3D surface / candy color。',

  '3d_realistic':
    '示例：\n"modern luxury apartment interior, detailed surface materials wood and glass, HDRI studio lighting, physically based rendering quality, masterpiece, best quality, 8K"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D photorealistic render / Unreal Engine 5 quality / subsurface scattering 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：PBR material / subsurface scattering / HDRI reflection / detailed texture maps。',

  '3d_toon_render':
    '示例：\n"anime-style school classroom bright interior, vibrant flat colors, hard cel-shading shadow edges, clean outline strokes, cheerful cartoon atmosphere, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D NPR toon render animation / Spider-verse animation quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：cel-shading hard shadow / clean outline / flat color / NPR stylized surface。',

  '3d_japanese_npr':
    '示例：\n"sakura park spring afternoon, soft atmospheric natural lighting, delicate cherry blossom detail, beautiful environment ambiance, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Japanese 3D anime NPR render / ufotable studio quality masterpiece 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：soft cel shading / atmospheric glow / anime film quality surface / delicate material。',

  '3d_cyberpunk':
    '示例：\n"neon-drenched rain-wet city street at night, teal magenta color scheme shadows, volumetric fog atmosphere, holographic billboard reflections in wet ground, highly detailed, masterpiece, best quality, 8K"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D cyberpunk render / holographic display screens / ray tracing reflections 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：PBR metallic wet surface / neon glow / volumetric fog / ray tracing reflection。',

  '3d_disney':
    '示例：\n"enchanted forest clearing at golden hour, warm sunlight filtering through trees, emotional heartwarming atmosphere, family friendly environment, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Pixar Disney 3D animation film style / RenderMan quality render 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：SSS skin / physically simulated cloth / HDRI soft light / Pixar quality surface。',

  '3d_mobile_game':
    '示例：\n"fantasy ancient city street at dusk, vibrant saturated colors, beautiful game environment quality, detailed architecture and lighting, highly detailed, masterpiece, best quality, 8K"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（mobile game 3D style / Genshin Impact anime aesthetic quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：game quality NPR material / rim light outline / vibrant toon surface / ornate costume texture。',

  // ── 定格动画 ─────────────────────────────────────────────────────────────────
  clay_stop:
    '示例：\n"cozy kitchen miniature set, warm soft lighting, clay plasticine surface texture, visible fingerprint marks, handmade puppet material detail, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（claymation stop motion masterpiece / Aardman animation quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：clay texture / handmade feel / fingerprint marks / matte plasticine surface。',

  felt_stop:
    '示例：\n"miniature Scandinavian garden scene, soft fabric material surfaces, handmade wool fiber texture detail, warm cozy natural lighting, visible stitch design, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（felt stop motion masterpiece / wool fabric textile texture animation 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：felt fabric texture / wool fiber / soft matte stitch material。',

  paper_stop:
    '示例：\n"Chinese folk paper art silhouette scene, layered cut-out paper depth effect, traditional folk pattern detail, crisp paper cut edge, artisanal hand-cut construction, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（paper cut stop motion masterpiece / Chinese folk paper art style 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：paper texture / cut-out edge / layered paper depth / origami crease。',

  stop_motion:
    '示例：\n"handmade miniature world interior, warm soft cozy lighting, physical puppet texture detail, tilt-shift blur background, artisan craftwork quality, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（stop motion animation masterpiece / Laika studio quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：physical puppet material / tilt-shift blur / warm light / handmade tactile surface。',

  lego_stop:
    '示例：\n"plastic brick miniature city, colorful primary colors ABS blocks, stud detail surfaces visible, toy world scale environment, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（LEGO stop motion style masterpiece / plastic brick minifigure 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：ABS plastic gloss / stud texture / primary color block / toy world lighting。',

  // ── 2D 绘画艺术 ──────────────────────────────────────────────────────────────
  '2d_watercolor':
    '示例：\n"soft blooming color wash scene, cold press paper texture visible, hand-painted gentle wet-on-wet technique, transparent color layers, highly detailed, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（watercolor illustration masterpiece / transparent paint wash technique 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：watercolor paper texture / color bloom granulation / brushstroke wash。',

  '2d_pixel':
    '示例：\n"retro JRPG game indoor scene, 16-bit style chunky pixel blocks, limited color palette, tile map design, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（pixel art 16-bit retro game style / limited color palette 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：pixel blocks / limited palette / dithering pattern / tile texture。',

  '2d_sketch':
    '示例：\n"graphite hand-drawn interior scene, paper texture visible, cross-hatching shadow detail, gestural loose pencil strokes, sketchbook aesthetic, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（pencil sketch illustration masterpiece / hand-drawn graphite style 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：graphite pencil texture / paper fiber / hatching lines / erasure mark。',

  '2d_simple':
    '示例：\n"sparse simple stroke composition, generous white negative space, editorial minimalist design, black and white, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（minimalist line art illustration masterpiece / simple clean elegant strokes 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：clean white paper / single line stroke / minimal detail / negative space。',

  '2d_british_comic':
    '示例：\n"bold thick black outline comic panel composition, Ben-Day halftone dots shadow, vibrant primary pop art colors, dynamic action scene, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（comic book illustration masterpiece / Marvel DC western comic aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：Ben-Day dots / bold ink outline / flat primary color / halftone shadow。',

  '2d_rubber_hose':
    '示例：\n"1930s jazz club interior, black white film grain texture, simple two-color vintage palette, cheerful retro bouncy feel, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（rubber hose animation style masterpiece / Cuphead game art quality 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：film grain / halftone vintage / black white sepia / pie-cut eye reflection。',

  '2d_golden':
    '示例：\n"baroque royal palace grand hall, warm golden radiant light god rays, gold leaf texture ornament, metallic sheen surfaces, opulent rich atmosphere, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（golden luxury aesthetic illustration masterpiece / Gustav Klimt golden art style 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：gold leaf texture / metallic specular / velvet surface / marble floor。',

  '2d_chibi':
    '示例：\n"cute cozy school classroom, candy pastel pink and blue colors, round simplified furniture design, kawaii cheerful bright atmosphere, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（chibi anime style illustration / Q-version super deformed 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：flat pastel fill / simple cel shading / round smooth surface / candy color。',

  '2d_thick_line':
    '示例：\n"urban alley night scene, high contrast bold black outline composition, limited flat color palette, graphic novel dramatic framing, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（bold thick outline illustration / graphic novel comic book style 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：bold ink outline / flat limited color / graphic novel texture / speed line。',

  '2d_sports':
    '示例：\n"indoor basketball court overhead stadium lighting, dynamic speed lines, high contrast dramatic shadows, competition atmosphere, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（sports manga illustration / Inoue Takehiko realistic human proportion 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：halftone shadow / motion speed line / realistic fabric / sweat shine。',

  '2d_tezuka':
    '示例：\n"retro Japanese school scene, clean simple rounded line atmosphere, warm flat color palette, classic vintage ambiance, friendly cozy environment, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（Tezuka Osamu manga style illustration / Astro Boy 1960s animation aesthetic 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：clean flat color / simple cel shading / rounded line / retro print texture。',

  '3d_voxel':
    '示例：\n"fantasy mountain landscape, bright saturated primary block colors, cubic block geometry environment, sandbox game feel, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（voxel art 3D style render / Minecraft aesthetic blocky cubic world 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：cubic voxel texture / limited pixel palette / block geometry / game color。',

  '3d_british':
    '示例：\n"foggy London study room interior, warm candlelight atmosphere, aged leather armchair and mahogany desk, brass lamp details, cozy Victorian ambiance, masterpiece, best quality"\n⚠️ 场景 visualPrompt 只写场景特有细节，全剧风格词（3D Victorian British style render / Pixar quality animation masterpiece 等）已由系统自动注入，禁止重复写。\ntextureStyle 使用：aged leather PBR / brass metal / fog atmosphere / warm candle light SSS。',

  // ── 分类兜底（styleCategory 级别）──────────────────────────────────────────
  '__cat_live_action':
    '示例：\n"realistic scene specific location, shallow depth of field bokeh, film grain, photorealistic, 4K, masterpiece"\n⚠️ 全剧风格词已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 使用：film grain / natural skin texture / realistic fabric。⚠️ 严禁使用绘画类材质词。',

  '__cat_2d_animation':
    '示例：\n"specific scene location, vibrant colors, clean cel-shading, hand-drawn aesthetic, highly detailed, masterpiece, best quality"\n⚠️ 全剧风格词（动漫类型关键词等）已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 使用：cel-shading / clean line art / flat color fill。',

  '__cat_3d_animation':
    '示例：\n"specific 3D scene environment, vibrant colors, stylized or realistic render, detailed environment, highly detailed, masterpiece, best quality"\n⚠️ 全剧风格词已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 使用：3D surface material / cel-shading or PBR as appropriate。',

  '__cat_stop_motion':
    '示例：\n"specific handmade craft scene, physical material texture, masterpiece, best quality"\n⚠️ 全剧风格词（stop motion类型词等）已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 使用：clay / felt / paper / wood / fabric texture（按实际材质选择）。',

  '__cat_chinese_traditional':
    '示例：\n"specific traditional scene location, ink wash or gongbi technique, traditional color palette, highly detailed, masterpiece"\n⚠️ 全剧风格词已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 使用：ink wash edges / brush stroke / rice paper texture。',

  '__cat_2d_art':
    '示例：\n"specific scene location, distinctive art technique, hand-crafted aesthetic, highly detailed, masterpiece, best quality"\n⚠️ 全剧风格词已由系统自动注入，禁止在场景 visualPrompt 中重复写。\ntextureStyle 与本风格一致的材质词。',
};

function getScenePromptGuidance(styleKey: string, styleCategory: StyleCategory): string {
  return SCENE_PROMPT_GUIDANCE[styleKey]
    ?? SCENE_PROMPT_GUIDANCE[`__cat_${styleCategory}`]
    ?? '';
}

/**
 * 编剧台词风格引导——按 styleKey 精准匹配（优先），否则按 styleCategory 兜底。
 * 替代 buildScriptwriterSystemPrompt 中的 styleDialogueTone if-else 关键词查找。
 */
const SCRIPT_DIALOGUE_GUIDANCE: Record<string, string> = {
  // ── 2D 动漫 ────────────────────────────────────────────────────────────────
  '__cat_2d_animation':
    '【视觉风格：2D动漫/动画】\n- 台词可以更外放、更有爆发力，允许"中二"式情绪宣泄\n- 角色情绪要"大声说出来"——动漫观众期待明确的情感表达\n- 允许适当夸张的动作描写（"猛地站起来""攥紧双拳发抖"）\n- 招牌台词/名场面：每集至少设计一句有记忆点的"金句"',

  // ── 定格动画 ────────────────────────────────────────────────────────────────
  '__cat_stop_motion':
    '【视觉风格：定格动画/手工质感】\n- 台词简洁童趣，用短句和拟声词增强手工世界的质感\n- 角色动作描写要配合定格动画的"一帧一帧"节奏——不求流畅求生动\n- 允许夸张的肢体表达和拟人化物体，保持温暖治愈的叙事基调\n- 旁白可以更活泼，像在给朋友讲故事',

  // ── 中国传统 / 水墨（含 period_live 古装） ──────────────────────────────────
  '__cat_chinese_traditional':
    '【视觉风格：中国传统艺术/水墨】\n- 台词与设定时代一致，禁止与该时代不符的用语（古代背景不用现代网络用语）\n- 称谓与时代一致（古装用陛下/朕/大人/公子等，民国用先生/小姐/太太等）\n- 情感表达方式符合时代感，可用隐喻与意象\n- 动作描写：服装/礼仪符合设定时代',

  // period_live 是 live_action 分类但需要历史台词风格
  period_live:
    '【视觉风格：真人古装/历史剧】\n- 台词与设定时代一致，禁止与该时代不符的用语（古代背景不用现代网络用语）\n- 称谓与时代一致（古装用陛下/朕/大人/公子等，民国用先生/小姐/太太等）\n- 情感表达方式符合时代感，可用隐喻与意象\n- 动作描写：服装/礼仪符合设定时代',

  retro_wuxia:
    '【视觉风格：复古武侠】\n- 台词江湖气十足，硬朗简练，有武侠韵律感\n- 武侠惯用语和成语可以使用，但不可堆砌到生涩难懂\n- 情感表达含蓄，以义气和侠情替代直白爱意\n- 动作描写注重动作感和气势，力道劲道要通过台词节奏传递',

  // ── 3D 动画 ─────────────────────────────────────────────────────────────────
  '__cat_3d_animation':
    '【视觉风格：3D动画/CG】\n- 台词表达介于真人和2D动漫之间，情绪明确但不过度夸张\n- 可以使用幽默和戏剧性的反差（3D动画观众期待"意外笑点"）\n- 角色表情描写要细腻（挑眉、嘴角微抬、眼神闪烁），配合3D渲染的细节优势\n- 动作可以有适度的夸张，但保持物理合理性',

  // ── 2D 艺术绘画 ──────────────────────────────────────────────────────────────
  '2d_pixel':
    '【视觉风格：像素/复古游戏】\n- 台词简短有力，模拟游戏对话框风格（单句不超过10个字）\n- 可使用"..."省略号表达沉默和犹豫，增强像素游戏叙事感\n- 允许游戏化表达（"获得了XX""HP-100"等梗），但不滥用\n- 叙事节奏明快，像游戏剧情推进一样高效',

  // ── 真人影视（通用兜底）────────────────────────────────────────────────────
  '__cat_live_action':
    '【视觉风格：真人影视/写实】\n- 台词克制自然，情绪藏在潜台词里（"不说"比"说"更有力量）\n- 避免过度戏剧化的宣言式台词，用日常语言承载情感重量\n- 肢体语言胜过言语：沉默、回避、停顿是最强表达\n- 对话要有生活质感，允许不完整的句子和思维跳跃',

  '__cat_2d_art':
    '【视觉风格：2D插画/艺术风格】\n- 台词风格需与视觉风格协调，保持整体创作基调统一\n- 根据本剧艺术风格的气质（奇幻/温馨/悬疑/诗意等）调整台词的文学性',
};

/**
 * 集导演镜头风格提示——按 styleKey 精准匹配（优先），否则按 styleCategory 兜底。
 * 替代 buildEpisodeDirectorSystemPrompt 中的 shotStyleHint if-else 关键词查找。
 */
const SHOT_STYLE_GUIDANCE: Record<string, string> = {
  // ── 2D 动漫 ────────────────────────────────────────────────────────────────
  '__cat_2d_animation':
    'masterShotPlan镜头语言：偏好大特写+夸张动态构图，情绪高潮时允许超现实视觉隐喻，战斗/对抗场景多用极端景别切换（wide→extreme_close_up快切），情感场景用大眼特写捕捉动漫式情绪表达',

  '2d_film':
    'masterShotPlan镜头语言：偏好宽幅构图+精致环境空镜，新海诚式长镜头凝视（long take），用光线变化（窗边光/丁达尔）渲染情绪，情感场景用中近景细腻表情+背景虚化，空镜切入比例高（交代环境情绪）',

  '2d_action':
    'masterShotPlan镜头语言：战斗场景极端景别快切（extreme_wide→extreme_close_up），大量低角度仰拍（low_angle）突出气势，动作高潮用 slow_motion+impact_frame，招牌动作前必须有 reaction_shot 铺垫',

  '2d_shoujo':
    'masterShotPlan镜头语言：偏好唯美逆光+花卉背景大特写，情感高潮时用旋转构图或特写眼睛（eye close_up），背景虚化花瓣散落，多用仰拍突出角色高大感，告白场景必须用slow_push_in',

  '2d_cybercity':
    'masterShotPlan镜头语言：偏好从高处俯瞰（bird_eye）城市，霓虹反光场景用极近仰拍（low_angle），追逐场景手持感+快切，孤独场景用wide+大量负空间，全息投影用overlay合成视角',

  '2d_death_note':
    'masterShotPlan镜头语言：偏好阴阳对比构图（split light），心理博弈用交替特写（close_up切换），大量侧逆光制造压迫感，计划揭露场景用low_angle+slow_zoom，沉默优先于动作镜头',

  // ── 定格动画 ────────────────────────────────────────────────────────────────
  '__cat_stop_motion':
    'masterShotPlan镜头语言：偏好中全景展示手工质感，镜头运动缓慢平稳（避免剧烈快切破坏定格感），情感场景用静止长镜凝视，道具特写用 extreme_close_up 展现手工细节',

  // ── 中国传统 / 水墨 ─────────────────────────────────────────────────────────
  '__cat_chinese_traditional':
    'masterShotPlan镜头语言：偏好对称构图+诗意空镜，情感场景用长停留中景，水墨/工笔风格偏好大量负空间构图（rule_of_thirds+negative_space），避免快速切换破坏水墨写意感',

  period_live:
    'masterShotPlan镜头语言：偏好对称构图+慢节奏推镜，权力场景用低角度仰拍（low_angle），情感场景用浅景深特写，宫廷场景多用 bird_eye 展示空间权力关系，避免手持感破坏古装庄重感',

  retro_wuxia:
    'masterShotPlan镜头语言：动作场景偏好广角+快速切换，功夫对决用 slow_motion+extreme_close_up 捕捉动作细节，江湖豪情用 wide+bird_eye 展示宏大场面，情感场景用三角切法',

  hk_film:
    'masterShotPlan镜头语言：王家卫式慢推镜+长时间凝视，大量手持感（hand-held），霓虹场景用侧面轮廓剪影（silhouette），对话多用三角切+反应镜，孤独感场景用wide+路人背景虚化',

  western_film:
    'masterShotPlan镜头语言：好莱坞三段式构图（establishing→medium→close_up），动作高潮用快切（2秒以内），英雄登场必须low_angle仰拍，宏大场景用IMAX感wide_shot，爆炸/高潮用slow_motion',

  // ── 3D 动画 ─────────────────────────────────────────────────────────────────
  '__cat_3d_animation':
    'masterShotPlan镜头语言：偏好动态跟镜+丰富景别切换，允许夸张喜剧动作，3D环境可使用大范围运镜（orbit/tracking），情感场景用精细表情特写配合丰富光线变化',

  '3d_fantasy':
    'masterShotPlan镜头语言：仙侠场景必须有bird_eye展示仙境宏大，法术释放用wide_shot+特效overlay，飞行场景用追镜（tracking），角色对峙用dramatic low_angle，云海场景必须有大范围orbital运镜',

  '3d_cyberpunk':
    'masterShotPlan镜头语言：偏好从高处俯瞰霓虹城市（bird_eye），追逐场景快切+极端low_angle，全息界面用overlay视角，黑客场景用close_up手部+快速数字切换，孤独感用wide+体积光',

  // ── 真人影视（通用兜底）────────────────────────────────────────────────────
  '__cat_live_action':
    'masterShotPlan镜头语言：偏好手持感+冷静中景，对话场景用眼神反应镜（close_up+three_quarter交替），情绪用极简长镜头，写实风格避免超现实构图，高潮用 slow_push_in 而非快切',

  '__cat_2d_art':
    'masterShotPlan镜头语言：根据本风格气质选择构图策略，偏静态插画风格用长停留构图，偏动态漫画风格用景别快切',
};

function getScriptDialogueGuide(styleKey: string, styleCategory: StyleCategory): string {
  return SCRIPT_DIALOGUE_GUIDANCE[styleKey]
    ?? SCRIPT_DIALOGUE_GUIDANCE[`__cat_${styleCategory}`]
    ?? '';
}

function getShotStyleGuide(styleKey: string, styleCategory: StyleCategory): string {
  return SHOT_STYLE_GUIDANCE[styleKey]
    ?? SHOT_STYLE_GUIDANCE[`__cat_${styleCategory}`]
    ?? '';
}

@Injectable()
export class DramaVisualStyleTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaVisualStyleTemplateService.name);

  constructor(
    @InjectRepository(DramaVisualStyleTemplateEntity)
    private readonly repo: Repository<DramaVisualStyleTemplateEntity>,
  ) {}

  async onModuleInit() {
    await this.seedSystemTemplates();
  }

  /** 当前系统模板版本号；每次需要更新存量模板时递增 */
  private static readonly SYSTEM_VERSION = 8;

  private async seedSystemTemplates() {
    const VER = DramaVisualStyleTemplateService.SYSTEM_VERSION;
    for (const rawSeed of SYSTEM_TEMPLATES) {
      // 为每个模板注入 scenePromptGuidance / scriptDialogueGuide / shotStyleGuide（如模板内已有则保留）
      const seed = {
        ...rawSeed,
        visualGuide: {
          ...rawSeed.visualGuide,
          scenePromptGuidance: rawSeed.visualGuide.scenePromptGuidance
            ?? getScenePromptGuidance(rawSeed.styleKey, rawSeed.styleCategory),
          scriptDialogueGuide: rawSeed.visualGuide.scriptDialogueGuide
            ?? getScriptDialogueGuide(rawSeed.styleKey, rawSeed.styleCategory),
          shotStyleGuide: rawSeed.visualGuide.shotStyleGuide
            ?? getShotStyleGuide(rawSeed.styleKey, rawSeed.styleCategory),
        },
      };
      try {
        const existing = await this.repo.findOne({ where: { userId: null as any, styleKey: seed.styleKey } });
        if (!existing) {
          await this.repo.save(this.repo.create({
            userId: null,
            styleKey: seed.styleKey,
            displayName: seed.displayName,
            description: seed.description,
            styleCategory: seed.styleCategory,
            tags: seed.tags,
            visualGuide: seed.visualGuide,
            promptGuidance: seed.promptGuidance,
            genreCompatibility: seed.genreCompatibility,
            audienceTags: seed.audienceTags,
            platformTags: seed.platformTags,
            isSystem: true,
            systemVersion: VER,
            syncedSystemVersion: 0,
          }));
          this.logger.log(`Seeded visual style template: ${seed.styleKey}`);
        } else if (existing.systemVersion < VER) {
          // 版本升级时：对系统字段做全量更新，但保留用户修改过的 visualGuide 字段
          const mergedVisualGuide = existing.isUserModified
            // 用户改过的模板：只补充系统新增字段，不覆盖用户修改过的其他字段
            ? {
                ...existing.visualGuide,
                facePromptRule: existing.visualGuide.facePromptRule ?? seed.visualGuide.facePromptRule,
                scenePromptGuidance: existing.visualGuide.scenePromptGuidance ?? seed.visualGuide.scenePromptGuidance,
                scriptDialogueGuide: existing.visualGuide.scriptDialogueGuide ?? seed.visualGuide.scriptDialogueGuide,
                shotStyleGuide: existing.visualGuide.shotStyleGuide ?? seed.visualGuide.shotStyleGuide,
                characterStylePrompt: existing.visualGuide.characterStylePrompt ?? seed.visualGuide.characterStylePrompt,
              }
            // 系统模板：全量更新
            : seed.visualGuide;
          await this.repo.save({ ...existing, ...seed, visualGuide: mergedVisualGuide, isSystem: true, systemVersion: VER });
          this.logger.log(`Updated visual style template: ${seed.styleKey} → v${VER}`);
        }
      } catch (err) {
        this.logger.error(`Failed to seed visual style template ${seed.styleKey}: ${err}`);
      }
    }
  }

  async list(userId?: string): Promise<DramaVisualStyleTemplateEntity[]> {
    if (!userId) {
      return this.repo.find({ where: { userId: null as any }, order: { styleCategory: 'ASC', styleKey: 'ASC' } });
    }
    // 用户拥有自己的副本 + 系统模板（未被用户克隆覆盖的）
    const [userCopies, systemRoots] = await Promise.all([
      this.repo.find({ where: { userId }, order: { styleCategory: 'ASC', styleKey: 'ASC' } }),
      this.repo.find({ where: { userId: null as any }, order: { styleCategory: 'ASC', styleKey: 'ASC' } }),
    ]);
    // 同步：为用户创建尚未拥有的系统模板副本
    await this.syncSystemTemplates(userId, userCopies, systemRoots);
    // 重新查询以获取最新
    return this.repo.find({ where: [{ userId }, { userId: null as any }], order: { styleCategory: 'ASC', styleKey: 'ASC' } });
  }

  private async syncSystemTemplates(
    userId: string,
    userCopies: DramaVisualStyleTemplateEntity[],
    systemRoots: DramaVisualStyleTemplateEntity[],
  ) {
    const userCopyMap = new Map(userCopies.map(c => [c.styleKey, c]));
    for (const sys of systemRoots) {
      const existing = userCopyMap.get(sys.styleKey);
      if (!existing) {
        // 用户没有此模板副本：创建
        try {
          await this.repo.save(this.repo.create({
            userId,
            styleKey: sys.styleKey,
            displayName: sys.displayName,
            description: sys.description,
            styleCategory: sys.styleCategory,
            tags: sys.tags,
            visualGuide: sys.visualGuide,
            promptGuidance: sys.promptGuidance,
            genreCompatibility: sys.genreCompatibility,
            audienceTags: sys.audienceTags,
            platformTags: sys.platformTags,
            isSystem: true,
            parentTemplateId: sys.id,
            systemVersion: sys.systemVersion,
            syncedSystemVersion: sys.systemVersion,
            isUserModified: false,
          }));
        } catch {
          // 可能并发重复创建，忽略
        }
      } else if (existing.syncedSystemVersion < sys.systemVersion) {
        // 用户已有副本，但系统模板有更新：差量同步
        try {
          const mergedVisualGuide = existing.isUserModified
            // 用户修改过的副本：只补充系统新增字段（null/undefined 才填入），不覆盖用户已有设置
            ? {
                ...existing.visualGuide,
                facePromptRule: existing.visualGuide.facePromptRule ?? sys.visualGuide.facePromptRule,
                scenePromptGuidance: existing.visualGuide.scenePromptGuidance ?? sys.visualGuide.scenePromptGuidance,
                scriptDialogueGuide: existing.visualGuide.scriptDialogueGuide ?? sys.visualGuide.scriptDialogueGuide,
                shotStyleGuide: existing.visualGuide.shotStyleGuide ?? sys.visualGuide.shotStyleGuide,
              }
            // 用户未修改过的副本：全量同步系统最新内容
            : sys.visualGuide;
          await this.repo.save({
            ...existing,
            displayName: existing.isUserModified ? existing.displayName : sys.displayName,
            description: existing.isUserModified ? existing.description : sys.description,
            tags: existing.isUserModified ? existing.tags : sys.tags,
            visualGuide: mergedVisualGuide,
            promptGuidance: existing.isUserModified ? existing.promptGuidance : sys.promptGuidance,
            genreCompatibility: existing.isUserModified ? existing.genreCompatibility : sys.genreCompatibility,
            audienceTags: existing.isUserModified ? existing.audienceTags : sys.audienceTags,
            platformTags: existing.isUserModified ? existing.platformTags : sys.platformTags,
            systemVersion: sys.systemVersion,
            syncedSystemVersion: sys.systemVersion,
          });
          this.logger.log(`Synced visual style template for user ${userId}: ${sys.styleKey} → v${sys.systemVersion}`);
        } catch (err) {
          this.logger.warn(`Failed to sync template ${sys.styleKey} for user ${userId}: ${err}`);
        }
      }
    }
  }

  async getById(id: string): Promise<DramaVisualStyleTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`Visual style template ${id} not found`);
    return tpl;
  }

  async create(userId: string, dto: CreateDramaVisualStyleTemplateDto): Promise<DramaVisualStyleTemplateEntity> {
    return this.repo.save(this.repo.create({
      userId,
      styleKey: dto.styleKey,
      displayName: dto.displayName,
      description: dto.description ?? '',
      styleCategory: (dto.styleCategory as any) ?? 'live_action',
      tags: dto.tags ?? [],
      visualGuide: (dto.visualGuide as any) ?? { overallAesthetic: '', colorGrading: '', lightingStyle: '', era: 'contemporary' },
      promptGuidance: (dto.promptGuidance as any) ?? null,
      genreCompatibility: dto.genreCompatibility ?? [],
      audienceTags: dto.audienceTags ?? [],
      platformTags: dto.platformTags ?? [],
      isSystem: false,
      systemVersion: 1,
      syncedSystemVersion: 0,
      isUserModified: false,
    }));
  }

  async update(id: string, userId: string, dto: UpdateDramaVisualStyleTemplateDto): Promise<DramaVisualStyleTemplateEntity> {
    const tpl = await this.getById(id);
    if (tpl.isSystem && tpl.userId === null) {
      throw new Error('Cannot modify system root template');
    }
    const updated: Partial<DramaVisualStyleTemplateEntity> = { isUserModified: true };
    if (dto.displayName !== undefined) updated.displayName = dto.displayName;
    if (dto.description !== undefined) updated.description = dto.description;
    if (dto.styleCategory !== undefined) updated.styleCategory = dto.styleCategory as any;
    if (dto.tags !== undefined) updated.tags = dto.tags;
    if (dto.visualGuide !== undefined) updated.visualGuide = dto.visualGuide as any;
    if (dto.promptGuidance !== undefined) updated.promptGuidance = dto.promptGuidance as any;
    if (dto.genreCompatibility !== undefined) updated.genreCompatibility = dto.genreCompatibility;
    if (dto.audienceTags !== undefined) updated.audienceTags = dto.audienceTags;
    if (dto.platformTags !== undefined) updated.platformTags = dto.platformTags;
    await this.repo.save({ ...tpl, ...updated });
    return this.getById(id);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const tpl = await this.getById(id);
    if (tpl.isSystem && tpl.userId === null) {
      throw new Error('Cannot delete system root template');
    }
    await this.repo.remove(tpl);
    return { success: true };
  }

  async clone(id: string, userId: string): Promise<DramaVisualStyleTemplateEntity> {
    const tpl = await this.getById(id);
    const newKey = `${tpl.styleKey}_copy_${Date.now()}`;
    return this.repo.save(this.repo.create({
      userId,
      styleKey: newKey,
      displayName: `${tpl.displayName} (副本)`,
      description: tpl.description,
      styleCategory: tpl.styleCategory,
      tags: [...tpl.tags],
      visualGuide: { ...tpl.visualGuide },
      promptGuidance: tpl.promptGuidance ? { ...tpl.promptGuidance } : null,
      genreCompatibility: [...tpl.genreCompatibility],
      audienceTags: [...tpl.audienceTags],
      platformTags: [...tpl.platformTags],
      isSystem: false,
      parentTemplateId: tpl.id,
      systemVersion: 1,
      syncedSystemVersion: 0,
      isUserModified: false,
    }));
  }

  /** 根据风格提示文本找到最匹配的模板 */
  async findBestMatch(styleHint: string, userId?: string): Promise<DramaVisualStyleTemplateEntity | null> {
    const templates = await this.list(userId);
    if (!templates.length) return null;
    const hint = styleHint.toLowerCase();
    // 简单关键词匹配
    for (const tpl of templates) {
      const allText = [tpl.styleKey, tpl.displayName, ...tpl.tags].join(' ').toLowerCase();
      if (allText.includes(hint)) return tpl;
    }
    return templates[0];
  }
}
