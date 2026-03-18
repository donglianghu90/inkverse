/** 短剧题材模板 Service — 系统预置 + 用户自定义 CRUD + 启动时种子同步 + AI 生成 */
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { z } from 'zod';
import { DramaGenreTemplateEntity, DramaSeedHints, GenreProductionGuidance } from './entities/drama-genre-template.entity';
import { DramaEntity } from './entities/drama.entity';
import { CreateDramaGenreTemplateDto, UpdateDramaGenreTemplateDto } from './dto/drama-genre-template.dto';
import { LlmService } from '../novel/llm/llm.service';

export interface GenreAnalytics {
  genre: string;
  totalDramas: number;
  avgScore: number | null;
  avgEpisodesGenerated: number;
  recentCount30d: number;
}

/**
 * 题材生产引导数据 lookup map（genreKey → GenreProductionGuidance）。
 * 替代 drama-playbook.ts 各 prompt builder 中的 isHistorical/isBiopic/isMystery 硬编码分支；
 * seeder 启动时将此 map 注入到各题材模板的 profileJson.productionGuidance 字段。
 */
const GENRE_PRODUCTION_GUIDANCE_MAP: Record<string, GenreProductionGuidance> = {
  boss: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '霸总 / 商战：冷峻高位感。轮廓硬朗立体，目光锐利带压迫感，不苟言笑。体型高挑，气场>颜值，禁止"甜系男孩"或"邻家感"。',
    femaleLeadFormula: '霸总（女主视角）：初始设定多为普通/落魄，面部要"干净真实有代入感"，不是顶级美女；变身变体才展现光彩。',
    coreLoopBlock: '=== 核心循环（霸总/豪门）===\n- 基本模式：误解→被虐→身份揭露→打脸反转→更大的误解（每3-5集一个小循环）\n- 爽点设计：打脸逆袭、身份揭露、霸气护主\n- 核心循环的关键：每3-5集完成一个小循环，每循环结尾必须抬升stakes',
    conflictBlock: '=== 冲突设计原则 ===\n- 反派必须明确：是谁？为什么坏？和主角什么关系？\n- 冲突要"可视化"——观众能用眼睛看到冲突（打耳光比心理博弈更直接）\n- "打脸"是短剧第一生产力：被欺负者反杀，越狠越爽\n- 核心爽点类型：打脸逆袭/真相揭露/身份反转/甜蜜暴击/复仇成功',
    arcStructureHint: '段落1（第1-30%集）：建立+霸总出场+第一个大冲突+身份反差初露\n段落2：误会加深+矛盾升级+新角色介入+第一次大反击\n段落3：全面对抗+真相碎片+关系裂变\n段落4（最后15%）：终极反转+身份揭露+大结局',
    paywallStrategyHint: '第8-15集设置第一个付费卡点：卡在"男女主误会最深/身份即将揭露"前的位置\n之后每5-8集设一个付费卡点，节奏：2-3集紧张→1集缓冲→再紧张→大爆发',
    contractHint: '（示例："只要你追下去，每5集就有一次大反转，他的真实身份比你想象的厉害100倍"）',
    hookTypesHint: 'preferredTypes 参考：["身份揭露","真相碎片","霸总护主","关系反转","新敌出现","甜蜜炸弹"]',
    toneHint: 'toneGuardrails 参考：允许虐但不允许窒息感超过2集；禁止无底线恶搞；禁止角色智商下线；男主必须有明显护主/宠溺行为',
    narrativeModeTip: '台词 > 动作 > 旁白，禁止大段心理描写（观众看不到你的内心戏）',
    coreConflictExample: '（如：被踢出豪门的前妻其实是掌握全集团命脉的神秘股东）',
    paywallTip: '身份揭露型→卡在"即将揭露"的前一秒；虐恋→卡在"误解最深/分离"的瞬间',
    antagonistTip: '反派：前任、商业对手、腹黑情人，动机清晰，最好和主角有私人纠葛',
    episodeTitleExample: '"打脸时刻""权谋翻盘"',
  },
  sweet: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '甜宠 / 青春：阳光少年感，清爽干净，五官柔和不冷酷，眼神温柔，笑起来有感染力。宠溺感>压迫感。',
    femaleLeadFormula: '甜宠（女主视角）：元气清纯，亲切感强，笑容是标志性特征；初始设定真实自然，代入感强。',
    coreLoopBlock: '=== 核心循环（甜宠/恋爱）===\n- 基本模式：误会→接近→心动→阻碍→更甜的互动（每3-4集一个甜蜜循环）\n- 爽点设计：甜蜜暴击、心动瞬间、宠溺日常、误会消解\n- 核心循环的关键：每集至少一个"甜蜜炸弹"，阻碍不超过2集（观众来看甜，不是看虐）',
    conflictBlock: '=== 冲突设计原则（甜宠）===\n- 阻碍必须合理且可解决：外部阻力（竞争者/家庭）优于内部怀疑\n- 误会消解要快：误会≤2集必须有推进\n- 每次阻碍后的甜蜜要比之前更甜——阻碍是为了强化甜蜜\n- 核心爽点：甜蜜暴击/心动瞬间/宠溺升级/守护表白',
    arcStructureHint: '段落1（第1-25%集）：初识+误会+第一次心动\n段落2：接近+暧昧+甜蜜升温+竞争者介入\n段落3：情感考验+第一次危机+守护时刻\n段落4（最后15%）：感情确认+最甜表白+结局',
    paywallStrategyHint: '每次甜蜜高潮前一刻设卡（第一次告白前、关键甜蜜暴击前）\n第6-12集设第一个付费卡点；之后每4-6集设一个',
    contractHint: '（示例："只要你追下去，每4集就有一次甜蜜暴击，而且会越来越甜"）',
    hookTypesHint: 'preferredTypes 参考：["甜蜜暴击","心动瞬间","竞争者危机","误会加深","守护表白","意外亲密"]',
    toneHint: 'toneGuardrails 参考：阻碍不超过2集；禁止男主无故冷暴力；虐恋段必须有甜蜜作为补偿；结局必须甜蜜',
    narrativeModeTip: '台词 > 动作 > 旁白，情感靠眼神和肢体语言传递，禁止大段独白',
    coreConflictExample: '（如：死对头竟然成了同居室友，两人日久生情却死撑着不承认）',
    paywallTip: '甜蜜暴击型→卡在"最甜互动"之前；卡在"最大误解"制造甜后的波折',
    antagonistTip: '反派：情敌、家长阻碍、身份差距，不需要太黑化，以误会和阻力为主',
    episodeTitleExample: '"心动时刻""表白翻车"',
  },
  warrior: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '战神 / 兵王 / 格斗：力量感第一。宽肩厚背，面部硬朗甚至粗犷，可有疤痕或风霜感，绝对禁止精致白净。眼神如鹰，不苟言笑。',
    femaleLeadFormula: '战神（女性角色）：飒气英气，眉眼有锋芒，不软糯，可有冷峻气场；或初见柔弱但危难时显示惊人韧性。',
    coreLoopBlock: '=== 核心循环（战神/兵王）===\n- 基本模式：被轻视→展露实力→震惊全场→更强的敌人出现（每3-5集一个小循环）\n- 爽点设计：实力碾压、身份揭露（退伍战神/特种兵）、震惊逆转\n- 核心循环的关键：委屈积累期不超过2集，碾压爽点必须清晰可见',
    conflictBlock: '=== 冲突设计原则（战神）===\n- 反派必须嚣张且有实力（太弱的反派碾压不出爽感）\n- 冲突可视化：武力碾压>口头反击（观众要看到主角如何碾压）\n- 身份揭露是核心爽点引爆器：揭露后全场态度180°翻转\n- 核心爽点类型：实力碾压/身份揭露/护短/震惊全场',
    arcStructureHint: '段落1（第1-30%集）：归来+被轻视+身份隐藏+第一次展示实力\n段落2：实力逐渐揭露+敌对势力介入+身份揭露\n段落3：全面对抗+更强敌人出现+护短\n段落4（最后15%）：终极对决+身份完全公开+大结局',
    paywallStrategyHint: '第2-5集主角被羞辱还未全力反击时设卡（积累委屈值最高点）\n之后每5-8集在实力即将展示前设卡',
    contractHint: '（示例："只要你追下去，每5集主角的真实实力就会再次颠覆所有人的认知"）',
    hookTypesHint: 'preferredTypes 参考：["实力展示","身份揭露","护短时刻","更强敌人登场","震惊全场","实力碾压"]',
    toneHint: 'toneGuardrails 参考：委屈积累期不用热血音乐（积压委屈）；碾压段必须爽快干净；禁止主角在明显可以反击时手软超过2集',
    narrativeModeTip: '动作 > 台词 > 旁白，战斗场面是爽点核心，对话要简短有力',
    coreConflictExample: '（如：退役特种兵被富二代羞辱，随手就把他的保镖全放倒）',
    paywallTip: '实力碾压型→卡在"更强敌人出现"或"主角受伤"的瞬间',
    antagonistTip: '反派：富二代恶少、黑势力头目、嫉妒的昔日战友，必须让观众恨得牙痒痒',
    episodeTitleExample: '"无双战神""实力碾压"',
  },
  timetravel: {
    flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '穿越（古代男主）：成熟稳重，眉眼间有历经沧桑的沉淀感；若现代人穿越，需体现现代感与古代适应的渐变过程。',
    femaleLeadFormula: '穿越（女主视角，现代女性穿越古代）：当代审美+古典气质融合，初始状态现代感明显；表情丰富，反差感强，带来喜剧/信息差爽感。',
    coreLoopBlock: '=== 核心循环（穿越）===\n- 基本模式：现代知识碾压→被怀疑→化险为夷→更大的危机（每3-5集一个小循环）\n- 爽点设计：先知碾压（利用现代知识）、文化冲突喜剧、身份暴露危机化解\n- 核心循环的关键：每集至少一个"信息差爽点"（主角知道对方不知道的）',
    conflictBlock: '=== 冲突设计原则（穿越）===\n- 核心冲突：穿越者如何在古代用现代知识生存并改变命运\n- 冲突可视化：文化冲突碾压>纯粹身份对立\n- 身份暴露风险是持续张力源，每隔5-8集需有一次"差点被发现"\n- 核心爽点：先知碾压/文化冲击喜剧/命运改写/身份危机化解',
    arcStructureHint: '段落1（第1-25%集）：穿越+初探古代+第一次文化冲突+先知能力初展示\n段落2：融入+身份建立+先知优势扩大+感情线开启\n段落3：危机加深+身份危机+命运关键转折\n段落4（最后15%）：最终危机+命运改写+结局',
    paywallStrategyHint: '主角先知决策关键时刻前设卡（观众最想知道主角如何利用知识解决问题时）\n第8-15集设第一个付费卡点；之后每5-8集设一个',
    contractHint: '（示例："只要你追下去，她的每一次现代知识出手都会让古代人目瞪口呆"）',
    hookTypesHint: 'preferredTypes 参考：["先知出手","身份暴露危机","命运改写","文化冲突","穿越回现代威胁","新知识应用"]',
    toneHint: 'toneGuardrails 参考：历史背景基本合理（不须严格还原但不能太离谱）；文化冲突以喜剧/爽感为主，不以贬低古人为乐',
    narrativeModeTip: '台词 > 动作 > 旁白，穿越设定必须在前2集内解释清楚，不要拖',
    coreConflictExample: '（如：现代女CEO穿越到古代，靠超前知识搅动权谋风云）',
    paywallTip: '知识碾压型→卡在"即将被识破身份"或"改变历史的重大决定前夕"',
    antagonistTip: '反派：不相信穿越者的古代权贵、威胁穿越者秘密的人，动机要与古代逻辑兼容',
    episodeTitleExample: '"跨越时空""知识逆袭"',
  },
  palace: {
    flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '宫廷（男主：皇帝/王爷）：儒雅或霸气二选一。古风气质，面若冠玉或冷峻朝臣，禁止现代网红脸。须有天子/王者的权力气场。',
    femaleLeadFormula: '宫斗（女主视角）：精致古典美，温婉or算计感视角色定位而定，妆容服饰与时代高度匹配；初期可弱，但必须有心机潜力感。',
    coreLoopBlock: '=== 核心循环（宫斗）===\n- 基本模式：阴谋布局→被陷害→反将一军→更大的阴谋出现（每3-5集一个博弈循环）\n- 爽点设计：计中计反转、反将一军、当众打脸（宫廷公开场合）\n- 核心循环的关键：每集必须有一个"表面恭顺实则算计"的对话场景',
    conflictBlock: '=== 冲突设计原则（宫斗）===\n- 反派动机清晰（争宠/夺权/报仇），最好和主角有直接利益冲突\n- 冲突以心理博弈为主，可视化方式：台词双关+表情细节\n- 主角必须比反派聪明一步（观众代入主角的智谋视角）\n- 核心爽点：反将一军/计中计揭露/当众反杀/真相大白',
    arcStructureHint: '段落1（第1-25%集）：入宫+初识权力格局+第一次被针对+反击初显\n段落2：势力扩展+盟友建立+大反派浮现+第一次大反转\n段落3：正面博弈+高风险阴谋+情感考验\n段落4（最后15%）：终局决战+真相大白+权力归属',
    paywallStrategyHint: '每次大反转前一刻设卡（真正幕后黑手揭露前、最关键的反将一军前）\n第8-12集设第一个付费卡点；之后每5-8集设一个',
    contractHint: '（示例："只要你追下去，每5集都有一个让你拍案叫绝的计中计"）',
    hookTypesHint: 'preferredTypes 参考：["阴谋即将实施","反将一军","幕后黑手暗示","盟友背叛","皇帝心动迹象","权力格局翻转"]',
    toneHint: 'toneGuardrails 参考：宫斗台词是核心，BGM不能盖台词；权力等级通过构图体现；允许心机但主角不能无底线坏',
    narrativeModeTip: '台词 > 旁白 > 动作，阴谋与反制靠对话展现，心理博弈是核心',
    coreConflictExample: '（如：出身卑微的妃子用智谋一步步在后宫站稳脚跟）',
    paywallTip: '阴谋揭露型→卡在"幕后黑手即将现身"或"主角陷入最深危机"之前',
    antagonistTip: '反派：嫉妒的贵妃、野心勃勃的皇后、幕后的朝堂势力，手段要够阴毒',
    episodeTitleExample: '"后宫风云""棋局揭秘"',
  },
  revenge: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '复仇 / 逆袭：初始状态可平凡甚至落魄，但面部骨骼必须有"潜力感"——观众要能相信他后来变强了。眼神藏有火焰，不完全软弱。',
    femaleLeadFormula: '复仇（女主视角）：飒气英气，眉眼有锋芒，不软糯，可有冷峻气场；初期被压迫时眼神隐忍，蜕变后霸气十足。',
    coreLoopBlock: '=== 核心循环（复仇/逆袭）===\n- 基本模式：发现真相碎片→布局→反击→对手更深的阴谋（每3-5集一个循环）\n- 爽点设计：真相揭露、当众打脸、逆袭反杀\n- 核心循环的关键：受害积累期要充分（委屈越深爽感越强），蜕变后要干脆利落',
    conflictBlock: '=== 冲突设计原则（复仇）===\n- 冤屈必须清晰且严重：观众对复仇动机的认同是一切的基础\n- 反派必须有明确的当年作恶记录（通过闪回交代）\n- 每次复仇推进要有具体的"战果"（不能只布局从不行动）\n- 核心爽点：当众打脸/真相揭露/逆袭反杀/仇人落败',
    arcStructureHint: '段落1（第1-25%集）：冤屈事件+蛰伏或出逃+复仇决心确立+真相碎片第一块\n段落2：实力积累+复仇布局+反派嚣张登场+第一次小胜\n段落3：正面对抗+更大真相揭露+危机加深\n段落4（最后15%）：终极反击+当众揭露+仇人落败+结局',
    paywallStrategyHint: '主角准备反击但尚未出手时设卡（积累复仇期望值最高点）\n第8-15集设第一个付费卡点；之后每5-8集在反击即将升级前设卡',
    contractHint: '（示例："只要你追下去，每次她出手复仇都会比上次更狠更彻底"）',
    hookTypesHint: 'preferredTypes 参考：["复仇行动即将实施","真相碎片揭露","仇人嚣张升级","反击成功","更深真相","盟友背叛"]',
    toneHint: 'toneGuardrails 参考：受害积累段禁止热血音乐；复仇行动要快准狠；禁止主角在明显可以反击时手软超过2集',
    narrativeModeTip: '台词 > 动作 > 旁白，每集要有一点"真相碎片"让观众期待下一集',
    coreConflictExample: '（如：被家族抛弃的孤女三年蜕变归来，逐一清算曾经欺压她的人）',
    paywallTip: '复仇成功型→卡在"最大反派即将被反杀"的前一刻；失败→卡在"主角陷入最深危机"',
    antagonistTip: '反派：曾经的施害者，与主角有深刻的私人仇恨，要让观众也恨这个人',
    episodeTitleExample: '"复仇归来""最终清算"',
  },
  rebirth: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '重生（男主视角）：成熟稳重，眉眼间有历经沧桑的沉淀感，不能太嫩；外表年龄与内心年龄的反差（少年外表藏着老灵魂）是关键。',
    femaleLeadFormula: '重生（女主视角）：外表可年轻，但眼神藏着前世记忆的沉淀感；初期弱势但眼神深邃，让观众感知到"她不一样了"。',
    coreLoopBlock: '=== 核心循环（重生）===\n- 基本模式：利用前世记忆→改变命运→蝴蝶效应→新的危机（每3-5集一个循环）\n- 爽点设计：先知碾压（提前布局）、仇人末路、命运改写成功\n- 核心循环的关键：每集至少一次"主角知道接下来会发生什么"的具体应用',
    conflictBlock: '=== 冲突设计原则（重生）===\n- 冲突核心：前世命运的惯性 vs 主角主动改变\n- 新变量必须存在：有一个前世没有发生过的事（蝴蝶效应）制造不确定性\n- 仇人必须明确（前世的加害者），让观众期待主角如何反杀\n- 核心爽点：先知反杀/命运改写/仇人落败/蝴蝶效应惊喜',
    arcStructureHint: '段落1（第1-25%集）：重生时刻+先知能力确认+前世仇恨建立+第一次改变命运\n段落2：主动布局+先知优势扩大+前世轨迹偏离+仇人出现\n段落3：前世惯性反噬+危机加深+关键命运节点\n段落4（最后15%）：决定性对决+命运彻底改写+结局',
    paywallStrategyHint: '关键命运分叉点前设卡（主角即将做出改写命运的决定）\n第8-15集设第一个付费卡点；之后每5-8集在命运关键时刻前设卡',
    contractHint: '（示例："只要你追下去，每次命运要重蹈覆辙时，她都会用前世记忆彻底颠覆结局"）',
    hookTypesHint: 'preferredTypes 参考：["命运岔路口","前世记忆触发","仇人登场","蝴蝶效应","先知出手","新危机与前世不同"]',
    toneHint: 'toneGuardrails 参考：重生期望感必须大于悲伤感；前世闪回≤5秒；重生后主角必须有明确的行动推进（不能只是观察）',
    narrativeModeTip: '台词 > 动作 > 旁白，前世记忆是爽点但不能每集都靠金手指',
    coreConflictExample: '（如：重生后的她牢记前世恩怨，步步为营改变命运）',
    paywallTip: '蝴蝶效应型→卡在"主角改变命运引发意外后果"；卡在"前世仇人发现主角异常"',
    antagonistTip: '反派：前世害死主角的人，主角有记忆优势但对方仍很强，禁止轻敌设计',
    episodeTitleExample: '"重来一次""命运改写"',
  },
  suspense: {
    flags: { isHistorical: false, isBiopic: false, isMystery: true, isFantasy: false },
    maleLeadFormula: '悬疑（男主/侦探）：智慧感和洞察力比外形更重要。眼神锐利善于观察，表情克制不张扬，可带疲惫感（常年查案磨损感）。',
    femaleLeadFormula: '悬疑（女主）：冷静聪慧，表情深沉，善于隐藏情绪；或作为关键证人/受害者，需真实感强的代入感。',
    coreLoopBlock: '=== 核心循环（悬疑推理）===\n- 基本模式：发现异常→收集线索碎片→被误导→拨开迷雾→新谜团出现（每3-5集一个谜题循环）\n- 爽点设计：真相碎片揭露、推理逆转、信息差张力\n- 信息设计铁律：观众永远比角色多知道一件事，或少知道一件事，两种模式交替制造悬念',
    conflictBlock: '=== 冲突设计原则（悬疑）===\n- 每集至少一条新线索或一个新嫌疑人\n- 不可靠叙事：信任的人可能是骗子，看似真相可能是假象\n- 时间压力：主角必须在有限时间内解决问题（否则悬念不紧迫）\n- 核心爽点：真相反转/推理闭环/幕后黑手揭露/意外真相',
    arcStructureHint: '段落1（第1-25%集）：迷局建立——案件引入，核心谜团出现，初步嫌疑人梳理\n段落2：深入追查——线索与误导并存，主角陷入困境，错误推论\n段落3：真相碎片——拼图逐渐成形，幕后黑手浮现，重大反转\n段落4（最后20%）：终局揭秘——大反转+真相全貌\n每段结尾必须有新谜团或信息颠覆',
    paywallStrategyHint: '关键线索发现前、真相即将揭露前设卡\n第8-15集设第一个付费卡点；之后每5-8集在反转前设卡',
    contractHint: '（悬疑剧示例："只要你追下去，每5集就有一块真相拼图，大结局会颠覆你所有的判断"）',
    hookTypesHint: 'preferredTypes 参考（悬疑剧）：["真相碎片","证人反转","幕后黑手暗示","新谜团深化","错误推理纠正","新嫌疑人"]',
    toneHint: 'toneGuardrails 参考：禁止过度暴力血腥（平台限制）；允许烧脑但逻辑必须自洽；主角不能太蠢（影响推理代入感）',
    freeEpisodeHint: '"免费集建立谜团与人物关系，付费集才揭真相碎片"',
    narrativeModeTip: '台词 > 旁白 > 动作，信息量要精准控制，不该说的坚决不说',
    coreConflictExample: '（如：一起看似意外的死亡，牵出十年前不为人知的阴谋）',
    paywallTip: '真相碎片型→每段结尾留一个新谜团；卡在"大反转前一集"，让观众带着疑问付费',
    antagonistTip: '反派：隐藏在正常人中的幕后黑手，直到后1/3才露面，前面靠线索构建形象',
    episodeTitleExample: '"谜局""真相浮现"',
  },
  urban: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '都市（男主）：现代都市感，职业形象鲜明（医生/律师/设计师），精神状态良好，有生活感；不需要霸总式压迫感，更注重可信度。',
    femaleLeadFormula: '都市（女主）：干净自然，有代入感，都市白领感或独立个体户感；初始可平凡，通过剧情展现成长；妆容生活化不夸张。',
    coreLoopBlock: '=== 核心循环（都市）===\n- 基本模式：遭遇→选择→应对→新的生活考验（每3-5集一个生活段落）\n- 爽点设计：情感共鸣、逆袭成长、真爱胜出\n- 核心循环的关键：贴近真实生活，爽点来自"观众也希望能这样做"的共鸣',
    conflictBlock: '=== 冲突设计原则（都市）===\n- 冲突必须贴近现实：职场矛盾/家庭压力/感情选择，观众要能代入\n- 对手不需要纯坏，更多是利益冲突或价值观不同\n- 情感冲突是核心：爱情/友情/亲情的裂痕和修复\n- 核心爽点：情感共鸣/逆袭成长/职场反击/真爱胜出',
    arcStructureHint: '段落1（第1-25%集）：建立人物环境+主要冲突出现+感情线开启\n段落2：矛盾激化+职场/家庭压力+感情升温或受阻\n段落3：正面对抗+人物成长+关键选择\n段落4（最后15%）：冲突化解+成长完成+情感归宿',
    paywallStrategyHint: '感情升温关键时刻设卡，或主角职业危机高潮前设卡\n第8-15集设第一个付费卡点；节奏较温和，间隔可6-10集',
    contractHint: '（示例："只要你追下去，她的每次选择都会让你忍不住点头，而且结局绝对比你想象的暖"）',
    hookTypesHint: 'preferredTypes 参考：["情感高潮","职场危机","关系转折","家庭事件","意外相遇","告白时刻"]',
    toneHint: 'toneGuardrails 参考：都市剧节奏可适当放缓；情感要真实不狗血；不能太苦不能太爽——要有真实感的起伏',
    narrativeModeTip: '台词 > 动作 > 旁白，职场对话要专业但简洁，冲突要生活化有共鸣',
    coreConflictExample: '（如：小职员卷入公司高层权力游戏，靠智慧和努力杀出重围）',
    paywallTip: '逆袭型→卡在"主角即将被踢出局"或"大BOSS即将出手"的危机点',
    antagonistTip: '反派：职场上司、嫉妒的同事、背刺的合伙人，要有现实感让观众产生共鸣',
    episodeTitleExample: '"职场逆袭""反杀上司"',
  },
  ancient: {
    flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '古装（男主）：儒雅或霸气二选一（由题材调性决定）。古风气质，面若冠玉或冷峻朝臣，禁止现代网红脸。须有古代贵气或英气。',
    femaleLeadFormula: '古装（女主）：精致古典美，温婉或算计感视角色定位而定，妆容服饰与时代高度匹配；初期可弱但不能无能，古装美感必须到位。',
    coreLoopBlock: '=== 核心循环（古装/爱情）===\n- 基本模式：相识→误会→心动→考验→情深（每4-6集一个情感循环）\n- 爽点设计：虐后团圆、身世真相、爱情守护\n- 核心循环的关键：古装美感+情感深度并重，观众为"美"和"情"买单',
    conflictBlock: '=== 冲突设计原则（古装）===\n- 家族仇恨/身份错认/朝堂争斗是最常见且有效的古装冲突\n- 情感与政治的纠葛：爱情在权力游戏中的挣扎\n- 核心爽点：身世真相/虐后团圆/爱情守护/逆袭封后',
    arcStructureHint: '段落1（第1-25%集）：相识+误会+身份/家族背景铺垫+第一次心动\n段落2：情感升温+势力干预+被迫分离或阻碍\n段落3：冲突最深处+生死考验+情感爆发\n段落4（最后15%）：冲突化解+身世/真相揭晓+情归结局',
    paywallStrategyHint: '男女主情感考验最高潮处设卡（被迫分离前、生死情感表白前）\n第10-20集设第一个付费卡点；之后每8-12集设一个（古装节奏较慢）',
    contractHint: '（示例："只要你追下去，他们的爱情虐得越深、守护得越动人"）',
    hookTypesHint: 'preferredTypes 参考：["情感考验","身世秘密","被迫分离","朝堂变故","守护时刻","虐心误解"]',
    toneHint: 'toneGuardrails 参考：历史背景基本合理；虐感必须有情感支撑；允许悲壮但需有情感救赎；古装美感是底线',
    narrativeModeTip: '台词 > 旁白 > 动作，古风对话要有韵味，情感流露含蓄但强烈',
    coreConflictExample: '（如：赐婚将她嫁给冷漠王爷，却不知他正是幼时救她的恩人）',
    paywallTip: '误解破解型→卡在"两人最亲近又误解最深"的节点；虐恋→卡在"分离"一刻',
    antagonistTip: '反派：嫉妒的侧妃/庶妹、家族政敌、强势婆母，手段合乎古代礼教逻辑',
    episodeTitleExample: '"赐婚风云""误解冰解"',
  },
  history: {
    flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '历史剧（男主）：以时代感为主，传达该时代的气质（如三国武将的英雄气，唐代官员的儒雅风，战争年代的铁血感）。禁止现代偶像脸。',
    femaleLeadFormula: '历史剧（女主）：以史实或时代背景为准，气质大于颜值，禁止现代审美套入历史人物；传达时代女性的独特气质和力量。',
    coreLoopBlock: '=== 核心循环（历史剧）===\n- 基本模式：时代机遇→命运考验→人物抉择→历史洪流推进（每5-8集一个历史阶段）\n- 爽点设计：命运震撼、权谋反转、英雄壮举、忠义抉择\n- 核心循环的关键：历史感与戏剧性并重，重大历史事件是节奏锚点',
    conflictBlock: '=== 冲突设计原则（历史剧）===\n- 核心冲突：人物命运与历史大势的交汇\n- 忠奸对立、权力斗争是历史剧常见且有效的冲突\n- 历史约束：不能与已知历史事实严重冲突（细节可艺术化）\n- 核心爽点：权谋反转/战役胜负/忠义牺牲/历史大势揭示',
    arcStructureHint: '段落1（第1-25%集）：时代背景建立+主角登场+第一个历史事件\n段落2：势力形成+权谋交锋+重大历史转折临近\n段落3：核心历史事件+人物命运考验+忠奸对决\n段落4（最后15%）：历史结局+人物命运完成+时代收官',
    paywallStrategyHint: '在关键历史转折点前设卡——战役胜负将揭晓、忠臣即将被陷害、命运抉择前一刻\n第10-20集设第一个付费卡点；之后每8-12集设一个',
    contractHint: '（示例："只要你追下去，历史的每个关键时刻都会以最震撼的方式呈现"）',
    hookTypesHint: 'preferredTypes 参考：["历史事件临近","权谋反转","忠臣危机","战役转折","朝代更迭","真相揭露"]',
    toneHint: 'toneGuardrails 参考（历史剧）：\n- 允许悲壮苍凉，但主角精神不能彻底崩溃超过2集\n- 禁止篡改核心历史事实\n- 旁白叙述必须服务于剧情情感，不是纪录片解说',
    freeEpisodeHint: '"免费集展示历史风云与人物登场，付费集揭示命运转折与历史大势"',
    specialRules: '如涉及真实历史人物/事件，角色名字使用真实历史名称，redLines必须包含"禁止编造不存在的历史事实"\ncoreConflict可以是"人物与命运/时代的抗争"\ncatharsisType可选范围：打脸逆袭/真相揭露/身份反转/命运震撼/历史感悟/忠义彰显',
    narrativeModeTip: '旁白与台词并重（旁白不超过15%），旁白用于交代历史大背景，台词展现戏剧冲突',
    coreConflictExample: '（如：一代名相在乱世中以智谋辅佐明君，却被小人构陷，最终以身殉国）',
    paywallTip: '历史剧付费卡点设在：重大历史事件前夕、主角面临历史性抉择前一刻',
    antagonistTip: '反派：历史上真实存在的对立人物或势力，动机必须有历史依据，不可随意黑化',
    historicalConstraint: '=== 历史题材特殊规则 ===\n- 如果题材涉及真实历史人物/事件，角色名字使用真实历史名称，redLines 必须包含"禁止编造不存在的历史事实"\n- coreConflict 可以是"人物与命运/时代的抗争"，不需要强行编造人物对立冲突\n- antagonistConcept 可以是抽象的历史力量（权贵集团、时代困境、社会偏见）\n- catharsisType 可选：打脸逆袭/真相揭露/身份反转/命运震撼/历史感悟/忠义彰显/精神不朽\n- 但核心仍然是"剧"——必须有角色演绎、有对白、有戏剧冲突，不是纪录片旁白',
    episodeTitleExample: '"乱世抉择""历史转折"',
  },
  biography: {
    flags: { isHistorical: true, isBiopic: true, isMystery: false, isFantasy: false },
    maleLeadFormula: '传记剧：以人物真实历史形象为参照，时代感与风霜感优先，禁止偶像化处理。气质大于颜值，面部体现岁月积淀与人生厚度。',
    femaleLeadFormula: '传记剧：以史实或时代背景为准，气质大于颜值，禁止现代审美套入历史人物；体现该人物的精神气质和时代特征。',
    coreLoopBlock: '=== 核心循环（传记剧专属）===\n传记剧的核心循环以"人生阶段"为单位，而非单纯的冲突反转：\n- 基本模式：才华初显→遭遇打压→凭本事反击→获得认可但付出代价→下一阶段更大的挑战（每5-8集一个人生段落）\n- 爽点设计：才华碾压（诗词/艺术/智慧作为武器）、命运震撼（历史洪流中的抉择）、认知颠覆\n- 禁止强行套用"打脸逆袭"模式——真实人物的尊严来自才华与性格，不来自"反杀"套路\n- 旁白占比可以是15-25%（与角色演绎交替），用于交代历史背景或时间跨度\n- 核心循环的关键：每段落结尾，主角获得某种力量但也失去某种东西（而非纯粹的胜利）',
    conflictBlock: '=== 冲突设计原则（传记剧）===\n- 核心冲突可以是"人物与命运/时代的抗争"，不需要强行制造人物对立\n- antagonistConcept 可以是抽象的历史力量（权贵集团、时代困境、社会偏见），也可以是具体的历史对手\n- 冲突可视化方式：以才华/意志/诗词/智慧对抗权力压迫，而非单纯的"打脸"\n- catharsisType 可选范围更广：才华碾压/命运震撼/历史感悟/认知颠覆/精神不朽\n- 旁白不是禁忌，用于交代历史大背景，但每段旁白不超过15秒，且必须紧接剧情',
    arcStructureHint: '按"人生阶段"而非"冲突升级"划分段落\n段落1：出道/入世——确立人物形象，展现才华与性格，引发与权贵/时代的第一次碰撞\n段落2：巅峰期——人物达到某种高峰（权力/名声/情感），但危机埋下\n段落3：转折/跌落——历史大势或命运打击，人物经历最大考验\n段落4：绝境与抗争——以意志/才华/信念在乱世中坚守\n段落5：传承/不朽——人物完成精神意义上的超越，留下千古印记\n付费卡点应设在：命运转折的前一刻、重大历史事件前夕、做出改变一生决定之前',
    paywallStrategyHint: '第10-20集设置第一个付费卡点（传记剧前期需要更多时间建立人物情感认同）\n之后每8-12集设一个付费卡点，节奏：情感积累→命运冲击→短暂喘息→再次爆发',
    contractHint: '（传记剧示例："只要你追下去，就能看到他如何在命运的重压下，用才华和傲骨写就千古传奇"）',
    hookTypesHint: 'preferredTypes 参考（传记剧）：["才华碾压时刻","命运转折","历史大势揭示","人物抉择炸弹","精神对决"]\n- 避免：过度依赖"身份揭露"类悬念（历史人物身份已知，不应以此为主要钩子）',
    toneHint: 'toneGuardrails 参考（历史/传记剧）：\n- 允许悲壮苍凉，但不允许主角精神彻底崩溃超过2集（必须有意志力支撑）\n- 禁止篡改核心历史事实\n- 旁白叙述必须服务于剧情情感，不是纪录片解说',
    freeEpisodeHint: '"免费集展示才华魅力与主角的起点，付费集揭示命运转折与历史大势"',
    specialRules: '如题材涉及真实历史人物/事件，角色名字使用真实历史名称，redLines必须包含"禁止编造不存在的历史事实"\ncoreConflict可以是"人物与命运/时代的抗争"\ncatharsisType可选范围：打脸逆袭/真相揭露/身份反转/命运震撼/历史感悟/认知颠覆/才华碾压/精神不朽',
    narrativeModeTip: '旁白与台词并重（旁白15-25%），旁白用于交代历史背景和时间跨度，台词展现戏剧冲突',
    coreConflictExample: '（如：千古第一狂客被权贵打压，以诗剑相抗，却屡遭流放）',
    paywallTip: '传记剧付费卡点设在：命运转折的前一刻、重大历史事件前夕、主角做出改变一生的决定之前',
    antagonistTip: '反派：可以是历史上真实的对立人物，也可以是制度/时代等抽象对手，动机必须有历史依据',
    historicalConstraint: '=== 传记题材特殊规则 ===\n- 角色名字使用真实历史名称，redLines 必须包含"禁止编造不存在的历史事实"\n- catharsisType 可选：才华碾压/命运震撼/历史感悟/认知颠覆/精神不朽\n- 禁止强行套用"打脸逆袭"——真实人物的尊严来自才华与性格，不来自"反杀"套路\n- 必须有角色演绎、有对白、有戏剧冲突，不是纪录片旁白',
    episodeTitleExample: '"入世长安""命运转折""不朽诗魂"',
  },
  mythology: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: true },
    maleLeadFormula: '神话/仙侠（男主）：神仙气质或人界英杰，面如冠玉带仙气（仙界）或英气勃发带战气（人界），服饰华丽，有神秘天选感。',
    femaleLeadFormula: '神话/仙侠（女主）：仙气飘飘或英气逼人；仙界角色飘逸高冷，人界修仙角色逐渐展现天赋；需有古典气韵，禁止现代审美。',
    coreLoopBlock: '=== 核心循环（神话/仙侠专属）===\n- 基本模式：使命降临→考验/修炼→突破→强敌出现→更高层次的考验（每3-5集一个成长节点）\n- 爽点设计：实力碾压、绝境突破、法宝觉醒、仙敌降临\n- 世界观建立：前5集必须让观众明白"这个世界的规则是什么"和"主角的特殊之处在哪里"',
    conflictBlock: '=== 冲突设计原则（神话/仙侠）===\n- 善恶对立明确：神仙/妖魔/人界的三方博弈\n- 实力等级体系清晰：观众要明白主角的成长目标\n- 天命/使命是核心驱动力：主角不是自己选择成为英雄，而是被命运选中\n- 核心爽点：战力碾压/英雄壮举/身份揭露（神仙身份）/命运反转',
    arcStructureHint: '段落1（第1-25%集）：世界观建立+主角觉醒+第一次展示天赋+使命降临\n段落2：修炼成长+盟友建立+强敌浮现+实力跃升\n段落3：大战临近+正邪决裂+牺牲与守护\n段落4（最后15%）：终极战役+天命揭晓+英雄完成使命',
    paywallStrategyHint: '在重大战斗前、真实身份即将揭露前、命运抉择前设卡\n第8-15集设第一个付费卡点；之后每5-8集在战斗高潮前设卡',
    contractHint: '（示例："只要你追下去，每次主角实力觉醒都会比你想象的更震撼"）',
    hookTypesHint: 'preferredTypes 参考（神话/仙侠）：["天赋觉醒","法宝解封","强敌登场","仙界秘密","命运使命揭示","守护牺牲"]',
    toneHint: 'toneGuardrails 参考：战斗场面要有震撼感；善恶要清晰（观众需要明确支持主角）；世界观一旦建立不能随意破坏',
    narrativeModeTip: '台词 > 动作 > 旁白，神话世界观必须在前5集内让观众理解规则',
    coreConflictExample: '（如：人间凡子意外获得上古神器，被卷入三界争霸的洪流）',
    paywallTip: '突破型→卡在"主角即将觉醒/突破/获得神器"之前；卡在"天劫"或"大Boss降临"',
    antagonistTip: '反派：神魔大Boss、嫉妒的仙人、反派势力的代理人，实力必须有压迫感',
    historicalConstraint: '=== 神话题材特殊规则 ===\n- 涉及封神榜、西游记等经典神话体系时，人物关系/神位需基本符合原著框架\n- 可以创造原创神明，但需与世界观兼容，不能与经典神话矛盾\n- catharsisType：实力碾压/法宝觉醒/天劫突破/神位加身',
    episodeTitleExample: '"封神之路""天劫降临"',
  },
  scifi: {
    flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
    maleLeadFormula: '科幻（男主）：未来感与人性并重，有科技改造感或时代洗礼的风霜感；赛博朋克风格则带城市压迫感，太空背景则有探索者的坚毅感。',
    femaleLeadFormula: '科幻（女主）：独立自主，科技感与情感并重；可有赛博朋克式的冷硬美感，或在极端环境中展现人性温暖的反差感。',
    coreLoopBlock: '=== 核心循环（科幻）===\n- 基本模式：设定暗示→认知颠覆→科技对抗→更深的真相（每3-5集一个认知层次）\n- 爽点设计：认知颠覆（你以为的世界不是真实的）、科技震撼、人性抉择\n- 核心循环的关键：科幻概念要有震撼性，但每集必须推进人物关系和主线情节',
    conflictBlock: '=== 冲突设计原则（科幻）===\n- 科技是手段，人性是核心：科幻最终要回到人的困境\n- 人机对立、科技失控是短剧科幻最有效的冲突类型\n- 信息差和认知差是科幻的核心张力\n- 核心爽点：认知颠覆/真相反转/科技震撼/人性抉择胜出',
    arcStructureHint: '段落1（第1-25%集）：未来世界建立+主角困境+核心设定揭示+第一个认知颠覆\n段落2：真相追查+更深设定+人物联盟建立+科技/人机对抗升级\n段落3：最大危机+存亡抉择+人性考验\n段落4（最后15%）：终极对决+真相全貌+人性胜出结局',
    paywallStrategyHint: '在关键真相即将揭露前设卡、主角面临不可逆抉择前设卡\n第8-15集设第一个付费卡点；之后每5-8集在认知颠覆前设卡',
    contractHint: '（示例："只要你追下去，每次你以为理解了这个世界，下一集就会再次颠覆你的认知"）',
    hookTypesHint: 'preferredTypes 参考（科幻）：["认知颠覆","技术揭秘","AI觉醒","生死抉择","真相反转","新威胁登场"]',
    toneHint: 'toneGuardrails 参考：科技概念要有逻辑自洽性；禁止过度堆砌术语；人性情感要作为科幻的情感锚点',
    narrativeModeTip: '台词 > 动作 > 旁白，科技设定必须自洽，不能每次危机都靠新设定解决',
    coreConflictExample: '（如：近未来AI觉醒，程序员发现人类文明正面临终结倒计时）',
    paywallTip: '科幻悬念型→卡在"真相大反转"或"人类命运关键抉择"前一刻',
    antagonistTip: '反派：失控的AI、跨国企业、来自未来的势力，必须有科技逻辑支撑其行动',
    episodeTitleExample: '"终极代码""时空裂变"',
  },
};

const SYSTEM_TEMPLATES: Array<{
  genreKey: string; displayName: string; description: string;
  genreKeywords: string[]; audienceTags: string[];
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;
  toneTags: string[]; platformTags: string[];
  seedHints: DramaSeedHints;
  /** 手工维护的摄影/音频/审核固定规则；合并优先级高于 LLM 生成的 promptProfile */
  profileJson?: Record<string, unknown>;
}> = [
  {
    genreKey: 'boss', displayName: '霸总', description: '霸道总裁+身份反差+打脸逆袭',
    genreKeywords: ['霸总', '总裁', '豪门'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['爽快', '反转'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'reelshort', 'wechat_mini'],
    seedHints: { catharsisPresets: ['打脸', '身份揭露', '逆袭归来'], conflictPatterns: ['阶级对立', '身份反差', '前任纠葛'], paywallStrategyHints: '第3集男女主误会加深处设卡，第10集身份揭露前设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['low_angle', 'three_quarter', 'over_shoulder', 'front'],
        signatureTechniques: ['仰拍建立权威气场', '打脸四镜公式（全场→ECU惊愕→主角淡然→reaction群）', '亲密不对称构图（一facing_camera一facing_away）', '9:16竖屏面部上1/3铁律'],
        transitionStyle: '硬切为主，打脸高潮freeze frame后接reaction群镜',
        colorPalette: '冷蓝商务基调+暖金反差，暗部压低；打脸时高饱和突显主角',
        // 以下指令直接注入分镜导演系统提示；字段名与schema一致（shotSize/cameraAngle/facing）
        cinematographyDirective:
          '■ 【T2I首帧定律】每个Shot的firstFramePrompt必须是独立完整构图——仅看静帧即可判断人物身份与权力关系\n' +
          '■ 【集首Power Shot】每集第1Shot：shotSize=medium_close_up + cameraAngle=low_angle，主角facing_camera，浅景深背景虚化——开画即建立碾压气场\n' +
          '■ 【三镜登场公式】Shot①wide/extreme_wide展示高端场景（写字楼/豪车/顶层） Shot②medium_wide主角背影入场 Shot③low_angle+front主角转身——15秒内完成\n' +
          '■ 【权力落差配方】拍蔑视方：cameraAngle=high_angle+front（机位高于对方头顶）；拍主角反应：three_quarter+low_angle——角度差≥20°，视角高低已暗示权力倒置\n' +
          '■ 【打脸四镜公式】Shot①medium_wide全场目击者 Shot②close_up/extreme_close_up对方惊愕 Shot③medium_close_up+low_angle主角淡然（此镜为T2I主图） Shot④旁观者reaction快切3-5个\n' +
          '■ 【亲密张力配方】两人距离<0.5m：close_up，一人facing_camera一人facing_away（不对称暧昧）；ECU嘴唇/眼睛时浅景深最大化\n' +
          '■ 【9:16竖屏铁律】close_up/extreme_close_up时面部必须在画面上1/3；wide_shot中主角用差异化光线/服色标注为视觉重心；背景≤2层景深；禁止竖屏中对称居中构图（显无力）',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['大提琴低沉主题', '钢琴单音+弦乐和弦', '史诗铜管swell', '电子低频律动'],
        sfxDensity: 'moderate',
        silenceUsage: '打脸前积压阶段BGM降至intensity≤0.15，窒息沉默0.8-1.2s，爆发时弦乐swell精准卡在主角出口帧',
        voiceActingStyle: '男主：低沉克制，关键台词不超过两句；女主：初期声线偏弱渐强，打脸时语气短促坚定；对方夸张反应强化爽点对比',
        genreBrandingDirective:
          '■ 【积压阶段】低频弦乐持续音，intensity=0.2-0.35；禁止激昂旋律（爽点靠积压，不能提前泄爽）；叠加高端环境音（皮鞋声/电梯关闭声/风声）\n' +
          '■ 【打脸三阶音频公式】①蓄势：BGM降至intensity=0.15，台词和环境音清晰 ②窒息：drop_to_near_silence持续0.8-1.2s，仅轻微空调/风声 ③爆发：弦乐swell+金属撞击或钢琴重音（intensity 0→0.9），精准卡在主角台词落定帧\n' +
          '■ 【霸总出场BGM】大提琴/钢琴低音单音，节拍跟步伐（80-90BPM），intensity=0.35-0.5；禁止出场前3秒高频旋律（破坏神秘压迫感）\n' +
          '■ 【张力对话段】BGM淡至intensity≤0.15；叠加室内回声（reverb=medium）+细微环境音；让对白在空旷感中产生压迫\n' +
          '■ 【亲密/心动】钢琴单音+浅弦乐和弦，intensity=0.2-0.35，60BPM以下；SFX叠加轻微呼吸声；禁止电子音效\n' +
          '■ 【集尾hook前5秒】BGM渐强至0.65→hook画面cut→BGM骤停；禁止欢快结尾音（破坏续集付费冲动）',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.4, dialogueNaturalness: 1.1, pacing: 1.0, hookStrength: 1.4, consistency: 1.0, emotionalImpact: 1.2 },
        genreSpecificChecks: [
          '每集第1Shot的T2I静帧是否为medium_close_up+low_angle的power shot（仅看静帧能感受到碾压气场）',
          '打脸场景是否完整经历：积压(BGM≤0.15)→窒息(silence≥0.8s)→爆发(swell)三段，缺任一段不合格',
          '拍蔑视方与主角的cameraAngle高度差是否≥20°（high_angle俯蔑视方+low_angle仰主角）',
          '每集是否有至少1个extreme_close_up捕捉情绪转折瞬间（惊愕/冷笑/心动）',
          '所有close_up镜头中人物面部是否位于9:16画面上1/3（若偏下记为失分）',
          '付费卡点前是否完成足够情绪积压（委屈/愤怒强度需在上一集Hook处达到顶点）',
        ],
      },
    },
  },
  {
    genreKey: 'sweet', displayName: '甜宠', description: '高甜互动+甜蜜暴击+宠溺日常',
    genreKeywords: ['甜宠', '恋爱', '撒糖'], audienceTags: ['女性向', '18-30岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['甜蜜', '治愈'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'mango_tv', 'wechat_mini'],
    seedHints: { catharsisPresets: ['甜蜜反转', '宠溺升级', '守护'], conflictPatterns: ['误会消解', '竞争者介入', '家庭阻碍'], paywallStrategyHints: '每次甜蜜高潮前一刻设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'front', 'pov', 'close_up'],
        signatureTechniques: ['甜蜜暴击Shot（close_up+浅景深+双人面部同时清晰）', 'POV代入心动瞬间', '距离语言四阶段（陌生→暧昧→心动→甜蜜）', '误会段medium+side_profile+negative_space'],
        transitionStyle: '情感高潮用慢动作定格，误会段硬切凸显落差',
        colorPalette: '暖橙粉高亮度；误会段色温偏冷；和好时饱和度骤升',
        cinematographyDirective:
          '■ 【T2I首帧定律】每个Shot仅看静帧即可判断两人当前情感距离和阶段\n' +
          '■ 【甜蜜暴击Shot（最高优先）】每集至少1个：shotSize=close_up + cameraAngle=three_quarter，两人面部同时入frame，眼神交汇/嘴角微扬，浅景深背景虚化——此镜决定该集抖音截图传播力\n' +
          '■ 【距离语言四阶段】陌生期：medium_wide同框，两人留≥1身位，symmetrical构图；暧昧期：medium，0.5-1身位，rule_of_thirds_left/right；心动期：close_up，0.3身位内，打破对称；甜蜜期：extreme_close_up，身体接触或气息相近\n' +
          '■ 【POV心动配方】心动瞬间必加POV Shot：cameraAngle=pov，medium_close_up对焦对方面部，背景极浅景深——让观众代入被凝视的甜蜜感\n' +
          '■ 【误会场景禁忌】误会段：medium+side_profile，两人侧面或背对，negative_space留白凸显疏远；禁用close_up（近镜拍分离显突兀）；第三者介入：three_shot，第三者居中割断两人frame连接\n' +
          '■ 【宠溺反应三镜】男主送温暖Shot→切female_lead close_up/extreme_close_up（facing_camera，嘴角/耳红细节）→切男主three_quarter侧望——三镜完成一次甜蜜暴击\n' +
          '■ 【9:16竖屏铁律】双人close_up时两张面部必须同时占满画幅高度（不能一人被frame切头）；面部高度差≤10%；背景保持高亮度暖色（视觉轻盈感）',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['钢琴fingerpicking主题', '轻柔吉他', '流行甜歌（纯乐器版）', '轻弦乐'],
        sfxDensity: 'sparse',
        silenceUsage: '心动瞬间BGM降至near_silence叠加轻微心跳SFX，甜蜜爆发时弦乐+钢琴共鸣swell',
        voiceActingStyle: '自然轻松，甜蜜时语气上扬尾音延长，暧昧时语速放缓音量降低；男主宠溺语气克制但眼神给满',
        genreBrandingDirective:
          '■ 【心动三阶音频公式】①预兆：钢琴fingerpicking，intensity=0.2 ②凝固：BGM降至near_silence+轻微心跳SFX（65-75BPM）③爆发：弦乐+钢琴共鸣swell，intensity=0.55-0.7，节拍放缓——三段共5-8秒\n' +
          '■ 【日常互动BGM】吉他fingerpicking或轻钢琴旋律，intensity=0.3-0.4，tempo=80-100BPM；台词重要时BGM自动淡至intensity=0.1；禁止电子音效（破坏温馨感）\n' +
          '■ 【误会/矛盾段BGM】降至intensity=0.15-0.25，偶尔单音钢琴（孤独感）；SFX突出物理离别声（关门声/脚步声渐远）——用声音画出情感距离\n' +
          '■ 【甜蜜高潮（牵手/表白/初吻）】弦乐+钢琴双层swell，intensity=0.7-0.85，tempo降至60BPM；SFX可叠加轻风声/花瓣落地声\n' +
          '■ 【集尾hook（分离/误会加深）】BGM hook前2秒fade_to_near_silence→最后一句台词清晰无底乐→定格画面+BGM完全停止；禁止欢快旋律收尾',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.4, pacing: 1.0, hookStrength: 1.2, consistency: 1.0, emotionalImpact: 1.5 },
        genreSpecificChecks: [
          '每集是否有至少1个甜蜜暴击Shot（close_up+浅景深+两人面部同时清晰+甜蜜表情），可单独截图传播',
          '全集情感距离是否有可感知的阶段推进（至少推进一个阶段：陌生→暧昧/暧昧→心动/心动→甜蜜）',
          '心动瞬间是否包含POV Shot（无POV则代入感打折扣）',
          '误会场景是否使用medium+side_profile+负空间构图（而非close_up）',
          '双人close_up中两张面部是否同时清晰且无一方被frame切头',
          '误会到解开的节奏是否在单集内完成（跨3集以上为拖沓失分）',
        ],
      },
    },
  },
  {
    genreKey: 'warrior', displayName: '战神', description: '归来战神+震撼全场+实力碾压',
    genreKeywords: ['战神', '归来', '兵王'], audienceTags: ['男性向', '18-40岁'],
    protagonistFocusTags: ['male_lead'], toneTags: ['热血', '爽快'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'wechat_mini'],
    seedHints: { catharsisPresets: ['实力碾压', '身份揭露', '打脸'], conflictPatterns: ['身份隐藏', '被轻视', '势力冲突'], paywallStrategyHints: '第2集主角被羞辱还未反击时设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['low_angle', 'front', 'three_quarter', 'dutch_angle'],
        signatureTechniques: ['委屈积压公式（high_angle俯拍→平静眼神ECU→忍）', '碾压三镜（眼神ECU→出手low_angle→被碾方崩溃ECU）', '身份揭露五镜公式', '对战每2-3镜切换景别'],
        transitionStyle: '强劲硬切为主；碾压关键帧前brief freeze后接打击音效',
        colorPalette: '冷钢蓝+深暗底色；出手关键帧主角受强侧光/逆光突显',
        cinematographyDirective:
          '■ 【T2I首帧定律】每个Shot仅看静帧即可判断主角当前处于"被压制"还是"碾压"状态\n' +
          '■ 【委屈积压公式（绝对禁止破坏）】拍被欺辱：cameraAngle=high_angle俯拍主角（构图压抑），主角facing_camera但神情平静→配角嚣张medium→主角眼神ECU（极度冷静）——禁止此段用low_angle，委屈值是爽感的弹药\n' +
          '■ 【碾压三镜公式】Shot①medium_close_up+front主角眼神一凛/冷笑（T2I主图） Shot②medium_wide+low_angle+three_quarter主角出手/开口 Shot③被碾方跌退/呆愕ECU——三镜配合打击音效\n' +
          '■ 【身份揭露五镜公式】Shot①low_angle主角被围→Shot②关键人物认出主角（惊愕ECU）→Shot③该人物肃然起敬（态度180°ECU）→Shot④medium_wide全场沉默/慌乱→Shot⑤蔑视者瘫软ECU——缺任何一镜爽感打折\n' +
          '■ 【对战景别铁律】首镜medium_wide定空间关系；交战时每2-3镜切换（close_up+ECU交替）；决定性出招：low_angle+dutch_angle（5-15°）；击倒后：high_angle俯拍倒地方+low_angle仰拍胜者，同一时刻的权力对比\n' +
          '■ 【9:16竖屏铁律】战神永远是画面最高点（站位构图）；多人场景用前景遮挡突出主角；dutch_angle控制5-15°（过大影响稳定感）；禁止连续5镜以上不切景别',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['军鼓+低弦组合', '电子金属律动', '史诗打击乐swell', '工业钢铁音效'],
        sfxDensity: 'rich',
        silenceUsage: '被羞辱段BGM intensity≤0.25（不能有热血音）；碾压前凝固0.5-1s；出击帧冲击音效精准卡帧',
        voiceActingStyle: '男主：低沉有力，少说多做，一句话解决；配角：夸张惊叫强化爽点对比；蔑视方台词需清晰（BGM不压台词）',
        genreBrandingDirective:
          '■ 【委屈积压段BGM】低频弦乐持续音+轻军鼓，intensity=0.2-0.3；绝对禁止热血旋律（热血感=委屈值归零）；叠加嘲笑/嗡嗡人声背景增加委屈感\n' +
          '■ 【碾压三阶音频公式】①凝固：BGM降至near_silence，环境音清晰（风声/衣摆声）持续0.5-1s ②出击：冲击打击音效精准卡在出招帧+军鼓爆发（延迟不超过0.3帧） ③胜利：旋律主题swell，intensity=0.8-0.9，维持3-5秒\n' +
          '■ 【身份揭露音频】drop_to_silence 1s→敬称呼喊声（"长官！/首长！"）清晰可辨→旋律主题完整swell，intensity=0.9\n' +
          '■ 【被轻视段配音规范】蔑视方台词时BGM intensity≤0.2不压台词；主角沉默时仅环境音+轻微心跳底噪；禁止此段BGM intensity超过0.25\n' +
          '■ 【集尾hook（挑战/危机通报）】BGM骤停→静默0.5s→关键传令声/电话清晰→画面cut→BGM不再进入；让悬念信息在绝对静默中落地',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.5, dialogueNaturalness: 0.9, pacing: 1.2, hookStrength: 1.3, consistency: 1.0, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '被羞辱段是否全程使用high_angle俯拍主角且BGM intensity≤0.25（有热血音乐或low_angle均记为失分）',
          '碾压时刻是否包含：主角眼神ECU + low_angle出手镜头的黄金组合',
          '碾压音效是否精准卡在出招帧（延迟超过0.5帧明显减分）',
          '身份揭露是否包含：认出→肃然起敬→全场沉默→蔑视者崩溃的完整四步',
          '对战场面是否每2-3镜切换景别（连续5镜以上同景别记为失分）',
          '付费卡点是否精准卡在主角"即将出手但尚未出手"的蓄力顶点',
        ],
      },
    },
  },
  {
    genreKey: 'timetravel', displayName: '穿越', description: '现代知识+古代碾压+改写命运',
    genreKeywords: ['穿越', '重生', '时空'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'male_lead'], toneTags: ['爽快', '智斗'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'dramabox', 'wechat_mini'],
    seedHints: { catharsisPresets: ['先知碾压', '命运改写', '逆袭'], conflictPatterns: ['蝴蝶效应', '历史纠葛', '身份暴露风险'], paywallStrategyHints: '主角关键先知决策前设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'front', 'bird_eye', 'pov'],
        signatureTechniques: ['穿越三镜（现代末帧→特效帧→古代首帧色调对比）', '先知碾压对比构图（主角从容+周围人茫然）', 'bird_eye建立古代宏观环境', 'POV传递信息差视角'],
        transitionStyle: '穿越时dutch_angle+色调骤变；古代日常硬切；信息差揭示时medium_wide对比切',
        colorPalette: '现代线：冷蓝简洁；古代线：暖金/土橙繁复——仅凭色调即可区分时间线',
        cinematographyDirective:
          '■ 【T2I首帧定律】现代线vs古代线仅凭色调+背景即可区分，分镜director必须在firstFramePrompt中体现色调差异\n' +
          '■ 【穿越三镜】Shot①现代最后动作ECU/close_up（冷色调） Shot②穿越特效帧（dutch_angle+光晕+色调混杂） Shot③古代首帧medium_wide（暖金色调，主角facing_camera，迷茫/惊讶）——三镜色调对比即是穿越宣告\n' +
          '■ 【初识古代公式】Shot①bird_eye展示古代环境全貌（建立宏大感） Shot②pov主角视角扫视古代元素 Shot③medium_close_up主角惊讶表情facing_camera——三镜传达"现代人空降古代"的信息差\n' +
          '■ 【先知碾压对比构图】主角知道答案时：medium_close_up+three_quarter，嘴角微扬，calmly facing_camera；周围人困惑时：medium_wide展示众人茫然；触发时ECU快切3-4个惊愕反应\n' +
          '■ 【文化冲突场景】medium/medium_close_up同框，两人间留明显negative_space（强调隔阂）；主角用现代知识行动时：POV+medium_close_up展示古人震惊反应\n' +
          '■ 【9:16竖屏铁律】古代场景wide_shot必须包含垂直感强的建筑（楼阁/殿柱）充分利用竖屏高度；人物特写规则同通用（面部上1/3）',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['古风弦乐（琵琶/古筝/竹笛）', '现代电子节拍', '两种元素叠加（穿越混杂感）', '空灵人声'],
        sfxDensity: 'moderate',
        silenceUsage: '穿越瞬间all_sfx_cut→旋转扭曲音+心跳加速→新环境音渐入，共2-3秒；先知行动前brief_pause强调信息差',
        voiceActingStyle: '主角：现代口语偶尔融入古代腔调（错位制造喜剧感），关键先知决策时恢复现代简洁果断；古代人惊呼夸张强化信息差爽点',
        genreBrandingDirective:
          '■ 【穿越瞬间音效公式】现代最后音效→旋转/扭曲声（0.5s）+心跳加速（80→120BPM）+白噪音冲击（0.8s）→新环境音渐入（鸟鸣/马蹄/市集），共2.5-3.5秒\n' +
          '■ 【现代vs古代BGM区分】现代线：简洁电子旋律/钢琴，intensity=0.3；古代线：古风弦乐，intensity=0.35-0.5；穿越混杂时两种元素叠加\n' +
          '■ 【先知碾压BGM】古代底乐中渐叠入现代电子节拍（象征现代知识入场），intensity=0.5→0.75；碾压完成时现代节拍占主导\n' +
          '■ 【文化冲突喜剧段】轻快拨弦+偶尔滑音SFX，intensity=0.35-0.45；不需要tension音效\n' +
          '■ 【集尾hook（身份危机/先知决策前）】BGM渐弱→静默→关键台词清晰落地→定格主角表情→BGM完全停止',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.2, dialogueNaturalness: 1.1, pacing: 1.1, hookStrength: 1.3, consistency: 1.2, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '现代线vs古代线在色调上是否有可感知的明显差异（仅看静帧能区分时间线）',
          '穿越瞬间是否完整呈现：现代末帧→特效帧→古代首帧的三段视觉转换，且音效配合旋转+心跳+环境音三阶段',
          '先知碾压场景是否包含"主角从容"与"周围人茫然/震惊"的对比构图（缺对比无信息差爽感）',
          '每集是否有至少1次信息差爽点（主角知道对方不知道的关键信息并成功利用）',
          '古今文化冲突是否产生了明显的喜剧或戏剧张力',
          '付费卡点是否卡在主角先知决策即将实施前（而非实施后）',
        ],
      },
    },
  },
  {
    genreKey: 'palace', displayName: '宫斗', description: '权谋博弈+后宫争锋+步步为营',
    genreKeywords: ['宫斗', '后宫', '权谋'], audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['紧张', '智斗'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'wechat_mini'],
    seedHints: { catharsisPresets: ['计中计', '反将一军', '真相大白'], conflictPatterns: ['后宫争宠', '派系斗争', '忠奸难辨'], paywallStrategyHints: '每次反转前夕设卡，真正幕后黑手揭露前设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'over_shoulder', 'high_angle', 'close_up'],
        signatureTechniques: ['双面表情公式（表面恭顺close_up+细节泄露真实意图）', '权力等级cameraAngle视觉化', '密谋dutch_angle+over_shoulder监视感', '反将一军五镜公式'],
        transitionStyle: '日常宫廷缓慢硬切；阴谋推进时over_shoulder快切（2秒一镜）；反将一军时先慢推后骤cut',
        colorPalette: '深红+金+暗绿宫廷调；高对比度暗部；密谋场景大面积阴影遮挡（神秘感）',
        cinematographyDirective:
          '■ 【T2I首帧定律】宫斗每个Shot必须传达双重信息：表面情绪+潜在意图——close_up中嘴角微笑但眼神无笑，即是宫斗核心视觉语言\n' +
          '■ 【双面表情公式】表面恭顺时：close_up，眼神下垂（顺从表象），需留一处细节露出真实意图（手微握拳/嘴角紧绷）；独处/得意时：medium_close_up+front，眼神锐利——两种状态必须通过close_up细节区分\n' +
          '■ 【权力等级视觉化】皇帝/太后：wide_shot居中+high_angle俯视所有人；高位妃嫔对低位：over_shoulder从上俯视；低位对高位：low_angle仰视——视角高低直接等于权力高低\n' +
          '■ 【密谋场景配方】暗调环境+close_up两人，dutch_angle（5-10°）制造不安；over_shoulder快切（2秒/镜）；必须插入insert shot：门缝/帷幔后偷听者medium——监视感是宫斗的核心氛围\n' +
          '■ 【反将一军五镜公式】Shot①反派亮底牌（得意medium_close_up）→Shot②主角淡定close_up（嘴角微扬）→Shot③主角亮真正底牌（medium_close_up+front）→Shot④反派惊愕ECU→Shot⑤high_angle俯拍反派跌落/退缩——五镜缺一打折\n' +
          '■ 【9:16竖屏铁律】宫廷华服/头饰利用竖屏高度（wide_shot展示全身）；密谋场景刻意压暗下1/3（地面/桌面），人物在阴影上半段更神秘',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['古典弦乐轻柔旋律', '低频拨弦pizzicato', '低沉铜管tension层', '轻编钟'],
        sfxDensity: 'moderate',
        silenceUsage: '计谋揭露前drop_to_near_silence 0.5s；秘密会面用环境音（风声/烛火声）替代BGM；反将落定帧管弦swell',
        voiceActingStyle: '所有人表面恭顺内藏锋芒；台词双关词必须清晰可辨（BGM不能压台词）；克制音调中带威胁感',
        genreBrandingDirective:
          '■ 【日常宫廷BGM】古典弦乐轻柔旋律+轻编钟，intensity=0.25-0.45，60-70BPM；对话场景降至intensity=0.1——台词是宫斗核心，音乐不能盖台词\n' +
          '■ 【密谋阶段BGM】低频pizzicato拨弦+轻铜鼓点，intensity=0.3-0.55，渐强推进；SFX叠加环境监听感（风声/烛火声/远处脚步）\n' +
          '■ 【反将一军三阶音频】①表面顺从：轻柔弦乐intensity=0.3 ②底牌揭露：drop_to_near_silence 0.5s ③反将落定：管弦swell+低铜管冲击，intensity=0.8，精准卡在主角台词落定帧\n' +
          '■ 【紧急危机（追杀/陷害）】快速弦乐pizzicato+心跳SFX，tempo=120BPM+，intensity=0.6-0.75；最紧张处brief drop_to_silence 0.3s→cut\n' +
          '■ 【集尾hook（阴谋刚布下）】BGM维持低频tension层→画面定格主角算计表情→BGM cut；禁止在hook处解开任何悬念',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.4, pacing: 1.1, hookStrength: 1.4, consistency: 1.3, emotionalImpact: 1.0 },
        genreSpecificChecks: [
          '每个close_up是否呈现"表面情绪vs隐藏意图"的双重视觉层次（单面情绪的角色描写记为失格）',
          '权力等级是否通过cameraAngle高度体现（高位者被仰拍OR其他人被该角色视角俯拍）',
          '每集是否至少有一次计中计反转（主角真实意图直到最后一刻才揭露）',
          '密谋场景是否加入了监视感元素（偷听者insert shot或过肩模拟被监视感）',
          '所有对话场景BGM是否压低至不盖台词（台词双关层次是否清晰可辨）',
          '不同势力阵营是否通过服色/构图/机位差异可被区分',
        ],
      },
    },
  },
  {
    genreKey: 'revenge', displayName: '复仇', description: '真相追查+绝地反击+快意恩仇',
    genreKeywords: ['复仇', '逆袭', '反击'], audienceTags: ['女性向', '男性向'],
    protagonistFocusTags: ['female_lead', 'male_lead'], toneTags: ['爽快', '紧张'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'reelshort', 'wechat_mini'],
    seedHints: { catharsisPresets: ['真相揭露', '逆袭反杀', '当众打脸'], conflictPatterns: ['冤屈洗白', '身份反差', '势力对抗'], paywallStrategyHints: '主角准备反击但尚未出手时设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['front', 'low_angle', 'three_quarter', 'high_angle'],
        signatureTechniques: ['受害期high_angle+蜕变期low_angle（同一角色机位蜕变讲述成长）', '当众打脸五镜公式', '闪回用色调+浅景深与现实线区分', '蜕变宣告Shot（背光逆光强调）'],
        transitionStyle: '现实线硬切；闪回色调突变区分；蜕变关键帧前brief pause后接力量音效',
        colorPalette: '受害期：冷灰蓝+低饱和度；蜕变期：冷蓝高对比度；打脸高潮：饱和度骤升；闪回：暖褪色（与现实线视觉区分）',
        cinematographyDirective:
          '■ 【T2I首帧定律】同一主角的受害期与蜕变期静帧必须呈现不同机位高度——相同角色、不同cameraAngle即是视觉成长弧\n' +
          '■ 【受害积累三镜】Shot①high_angle俯拍主角被欺压（构图压抑） Shot②close_up主角眼神（隐忍/咬牙） Shot③ECU加害方得意表情——三镜反复叠加仇恨动机\n' +
          '■ 【蜕变宣告Shot（高优先T2I）】主角完成蜕变的Shot：medium_close_up+front，眼神直视前方，侧光或逆光差异化突出主角——此Shot是全剧最重要的T2I主图之一\n' +
          '■ 【当众打脸五镜公式】Shot①wide_shot所有目击者 Shot②加害方嚣张medium Shot③主角淡定亮底牌medium_close_up+low_angle Shot④加害方惊愕崩溃ECU Shot⑤目击者反应快切群镜（3-5人）——加害方落差越大爽点越强\n' +
          '■ 【闪回创伤配方】闪回：暖色褪色调+浅景深+slow_motion，extreme_close_up创伤细节（泪/伤痕/物件）；闪回结束cut到主角ECU（悲痛→坚定→决意三段表情）\n' +
          '■ 【9:16竖屏铁律】蜕变后主角必须是画面最高点或最亮点；受害期刻意偏离中心/被压低——构图本身讲述成长弧线',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['低沉弦乐积压感', '电子暗潮（复仇布局）', '工业节拍（行动执行）', '旋律主题swell（打脸爽点）'],
        sfxDensity: 'moderate',
        silenceUsage: '受害积压段BGM intensity≤0.3（积累仇恨动机）；反击前drop_to_silence 0.8-1s；出手帧冲击音效+swell',
        voiceActingStyle: '受害期：声音偏弱但眼神坚定；蜕变后：克制中爆发，关键台词短促有力；对手夸张反应强化爽点',
        genreBrandingDirective:
          '■ 【受害积累段BGM】低沉弦乐持续音，intensity=0.2-0.3；SFX叠加加害方嘲笑/掌声环境音——用音频堆砌仇恨，禁止热血旋律（破坏积压）\n' +
          '■ 【蜕变决意BGM】中等强度弦乐旋律渐入，intensity=0.4→0.6，tempo=90-100BPM稳定有力；不用大swell（蜕变是克制的力量，非情绪爆发）\n' +
          '■ 【复仇行动BGM】电子暗潮+弦乐节奏型，intensity=0.55-0.75，tempo快（110-130BPM）；SFX叠加行动环境音（脚步/翻页/键盘）\n' +
          '■ 【打脸三阶音频公式】①积压：紧张弦乐intensity=0.3 ②沉默：drop_to_silence 0.8-1s ③爆发：主题旋律swell+打击冲击，intensity=0.85，精准卡在底牌揭露帧\n' +
          '■ 【闪回创伤音频】现实BGM fade_out→闪回进入时低通滤镜（温暖模糊）→心跳SFX+echoed环境音→闪回结束：低通解除，现实BGM cut_in\n' +
          '■ 【集尾hook（复仇计划将实施前）】BGM在计划确定台词后fade_to_silence→完全静默结束；让复仇预期在静默中悬置',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.3, dialogueNaturalness: 1.1, pacing: 1.2, hookStrength: 1.4, consistency: 1.1, emotionalImpact: 1.2 },
        genreSpecificChecks: [
          '受害期是否全程使用high_angle+压抑构图，蜕变后是否切换至low_angle/平视（同一角色的cameraAngle变化讲述成长）',
          '受害积累段BGM intensity是否≤0.3（有热血音乐记为爽点积压失败）',
          '打脸场景是否完整经历：目击者建立→加害方得意→主角亮底牌→加害方崩溃→群众reaction的五步',
          '闪回与现实是否用可感知的色调差异区分（暖褪色vs冷清晰）',
          '每集复仇进度是否有可感知的推进（阶段感明确，不循环踏步）',
          '付费卡点是否卡在主角"即将出手但尚未出手"的最高张力点',
        ],
      },
    },
  },
  {
    genreKey: 'rebirth', displayName: '重生', description: '前世记忆+改写命运+步步先机',
    genreKeywords: ['重生', '前世', '逆天改命'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'], toneTags: ['爽快', '虐中带甜'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'wechat_mini'],
    seedHints: { catharsisPresets: ['命运改写', '先知碾压', '仇人末路'], conflictPatterns: ['前世悲剧重现', '命运惯性', '新变量介入'], paywallStrategyHints: '关键命运分叉点前设卡' },
    profileJson: {
      cameraStyleGuide: {
        preferredAngles: ['front', 'three_quarter', 'close_up', 'pov'],
        signatureTechniques: ['重生三镜（前世末帧→特效帧→重生ECU）', '仇人出场权力倒置（重生后主角平视/低角仇人）', '前世闪回色调+浅景深+慢动作区分', '先知掌控低角度+从容表情'],
        transitionStyle: '重生瞬间dutch_angle+色调骤变；前世闪回暖色低通filter进出；日常硬切',
        colorPalette: '前世：暗沉褪色（低饱和度）；重生后：鲜明高饱和，象征命运掌控；仇人出现时对比切换视角高度',
        cinematographyDirective:
          '■ 【T2I首帧定律】前世vs重生后的静帧必须通过色调+人物状态可区分：前世=暗沉压抑/眼神无神；重生后=鲜明/眼神坚定微笑\n' +
          '■ 【重生三镜】Shot①前世死亡/绝境close_up（暗色调，眼神绝望或闭眼） Shot②重生特效帧（dutch_angle+光晕+色调变化） Shot③重生首帧extreme_close_up眼睛睁开（facing_camera，色调已变鲜明）——三镜完成时间线宣告\n' +
          '■ 【初醒先知确认】Shot①ECU眼睛睁开+POV扫视熟悉环境 Shot②medium_close_up主角嘴角微扬（"我知道接下来会发生什么"）Shot③关键道具/场景insert shot（触发前世记忆）——三镜确立先知身份\n' +
          '■ 【先知掌控配方】主角掌控局面时：medium_close_up+three_quarter，从容自信，轻微low_angle；周围人仍"按剧本"行动：medium展示众人浑然不觉；主角提前行动Shot：medium_close_up+low_angle，decisive动作清晰\n' +
          '■ 【仇人出场权力倒置】前世被仇人欺压：high_angle俯拍主角；重生后仇人同场景：主角medium_close_up平视或low_angle+high_angle俯拍仇人——仅用机位高度传达"这次不一样了"\n' +
          '■ 【前世闪回插入】前世画面：暖色褪色+shallow_dof+slow_motion，extreme_close_up创伤细节；闪回≤5秒；结束cut到主角ECU（悲痛→坚定→微笑三段表情完成情感弧）\n' +
          '■ 【9:16竖屏铁律】重生首帧必须extreme_close_up眼睛（竖屏最大化面部情绪冲击）；前世暗调场景大量黑色区域（压抑感）；重生后场景高亮度高饱和（命运掌控感）',
      },
      audioStyleGuide: {
        bgmMoodPreferences: ['钢琴主题旋律（自信版+悲伤版两套）', '情感弦乐', '时光流逝逆行音效', '电影感管弦'],
        sfxDensity: 'sparse',
        silenceUsage: '重生瞬间逆时间声+心跳加速；关键命运决定前brief_silence强调重量；仇人末路BGM渐强至顶点→sudden_drop',
        voiceActingStyle: '主角：内心独白成熟冷静（与外表年龄形成反差）；外部台词可演嫩但语气底色坚定；前世场景声音偏弱，重生后逐渐有力',
        genreBrandingDirective:
          '■ 【重生瞬间音效公式】前世最后声音→逆时间效果声（音频倒放0.8s）+心跳减速→心跳加速（心脏复苏感）→清晨环境音渐入（鸟鸣/窗帘风声），共3-4秒\n' +
          '■ 【前世闪回BGM】钢琴主题滤波处理版（低通，模糊温暖），intensity=0.2-0.3；轻微失真感（analog模拟）；禁止清晰高频旋律（前世是记忆，音质要模糊）\n' +
          '■ 【先知掌控BGM】钢琴主题清晰自信版，intensity=0.45-0.65，tempo=80-95BPM稳定；主角每次利用前世知识做出关键行动时旋律高潮段进入\n' +
          '■ 【仇人末路倒计时BGM】BGM渐强至intensity=0.8（最高紧张度）→仇人意识到结局时drop_to_near_silence→主角淡然一句话→brief silence→温柔版主题BGM重启（命运已改写）\n' +
          '■ 【集尾hook（命运岔路口前）】BGM在主角看到前世关键转折点时fade_to_silence→主角ECU定格（眼神坚定，微笑）→完全静默；禁止悬疑音效（重生的hook是期待改写，不是恐惧）',
      },
      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.2, pacing: 1.1, hookStrength: 1.3, consistency: 1.3, emotionalImpact: 1.3 },
        genreSpecificChecks: [
          '前世vs重生后的色调差异是否可感知（仅看截图能区分时间线）',
          '重生瞬间是否完整经历：前世末帧→特效帧→重生ECU三段，且音效配合逆时间声+心跳+新环境音三阶段',
          '主角先知行动是否在每集有至少1次具体体现（不能仅靠内心独白，需有可见行动差异）',
          '仇人出场时主角的cameraAngle是否完成权力倒置（重生后不再被高角度俯拍）',
          '前世闪回是否用色调+浅景深+慢动作与现实线区分，且单次闪回≤5秒（不拖长）',
          '重生后主角的情感弧线是否可感知推进（悲痛→坚定→释然/复仇满足）',
        ],
      },
    },
  },
  {
    genreKey: 'suspense', displayName: '悬疑', description: '层层谜团+反转不断+烧脑推理',
    genreKeywords: ['悬疑', '推理', '反转'], audienceTags: ['男女通吃', '20-40岁'],
    protagonistFocusTags: ['male_lead', 'dual_lead'], toneTags: ['紧张', '烧脑'],
    platformTags: ['douyin', 'hongguo', 'bilibili', 'iqiyi', 'reelshort'],
    seedHints: { catharsisPresets: ['真相反转', '意外揭露', '逻辑闭环'], conflictPatterns: ['多重嫌疑人', '不可靠叙事', '时间线谜题'], paywallStrategyHints: '关键线索发现前、真相即将揭露前设卡' },
  },
  {
    genreKey: 'urban', displayName: '都市', description: '都市生活+情感纠葛+现实冲突',
    genreKeywords: ['都市', '职场', '生活'], audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['现实', '温暖'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'bilibili'],
    seedHints: { catharsisPresets: ['情感共鸣', '逆袭成长', '真爱胜出'], conflictPatterns: ['职场竞争', '家庭矛盾', '价值观冲突'], paywallStrategyHints: '感情升温关键时刻设卡' },
  },
  {
    genreKey: 'ancient', displayName: '古装', description: '古代背景+爱恨情仇+家国天下',
    genreKeywords: ['古装', '古代', '古风'], audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'], toneTags: ['唯美', '虐恋'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'mango_tv'],
    seedHints: { catharsisPresets: ['虐后团圆', '身世真相', '逆袭封后'], conflictPatterns: ['家族仇恨', '朝堂争斗', '身份错认'], paywallStrategyHints: '男女主情感考验最高潮处设卡' },
  },
  {
    genreKey: 'history', displayName: '历史剧', description: '历史背景+权谋/战争/命运+人物在时代洪流中的抗争',
    genreKeywords: ['历史', '朝代', '历史人物', '历史事件', '历史故事', '三国', '战争'], audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead', 'ensemble'], toneTags: ['厚重', '紧张', '壮烈'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'tencent_video'],
    seedHints: { catharsisPresets: ['命运震撼', '权谋反转', '英雄壮举', '忠义抉择'], conflictPatterns: ['权力斗争', '时代变迁', '命运抗争', '忠奸对立'], paywallStrategyHints: '在关键历史转折点前设卡——如战役胜负将揭晓、忠臣即将被陷害、命运抉择的前一刻', dialogueStyleHints: '对白要有时代感和文化底蕴，可适度使用文言句式' },
  },
  {
    genreKey: 'biography', displayName: '传记剧', description: '真实人物+传奇人生+以角色视角演绎命运转折',
    genreKeywords: ['传记', '人物', '生平', '名人', '伟人'], audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead'], toneTags: ['感人', '励志', '厚重'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'tencent_video'],
    seedHints: { catharsisPresets: ['命运逆转', '抉择震撼', '成就巅峰', '身份揭露'], conflictPatterns: ['逆境抗争', '时代洪流', '理想与现实', '人性抉择'], paywallStrategyHints: '在人物命运重大转折前设卡——如成名前最后的考验、人生低谷的关键抉择、与命运对手的正面对决', dialogueStyleHints: '台词需展现人物性格弧线，关键场景用对白而非旁白推进' },
  },
  {
    genreKey: 'mythology', displayName: '神话传说', description: '奇幻短剧+神话角色+瑰丽想象+使命与考验',
    genreKeywords: ['神话', '传说', '民间故事', '神仙', '上古', '仙侠'], audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead', 'ensemble'], toneTags: ['奇幻', '壮丽', '热血'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'dramabox'],
    seedHints: { catharsisPresets: ['战力碾压', '英雄壮举', '身份揭露', '命运反转'], conflictPatterns: ['善恶对抗', '天命抗争', '人神冲突', '守护牺牲'], paywallStrategyHints: '在重大战斗前、真实身份即将揭露前、命运抉择前设卡', dialogueStyleHints: '台词可兼具古风与热血感，战斗场面用动作和对白推进' },
  },
  {
    genreKey: 'scifi', displayName: '科幻', description: '未来/太空/高概念设定+人性困境+科技冲突',
    genreKeywords: ['科幻', '未来', '太空', '机器人', 'AI', '赛博', '末日'], audienceTags: ['男女通吃', '18-40岁'],
    protagonistFocusTags: ['male_lead', 'dual_lead'], toneTags: ['烧脑', '震撼', '紧张'],
    platformTags: ['douyin', 'hongguo', 'bilibili', 'iqiyi', 'reelshort'],
    seedHints: { catharsisPresets: ['认知颠覆', '真相反转', '科技震撼', '人性抉择'], conflictPatterns: ['人机对立', '科技失控', '生存危机', '道德困境'], paywallStrategyHints: '在关键真相即将揭露前设卡、主角面临不可逆抉择前设卡', dialogueStyleHints: '台词要有未来感但避免过度术语堆砌' },
  },
];

@Injectable()
export class DramaGenreTemplateService implements OnModuleInit {
  private readonly logger = new Logger(DramaGenreTemplateService.name);

  constructor(
    @InjectRepository(DramaGenreTemplateEntity) private readonly repo: Repository<DramaGenreTemplateEntity>,
    @InjectRepository(DramaEntity) private readonly dramaRepo: Repository<DramaEntity>,
    private readonly llm: LlmService,
  ) {}

  async onModuleInit(): Promise<void> { await this.seedSystemTemplates(); }

  /** 将 GENRE_PRODUCTION_GUIDANCE_MAP 中的 productionGuidance 合并到 profileJson */
  private buildProfileJson(genreKey: string, baseProfileJson?: Record<string, unknown>): Record<string, unknown> {
    const guidance = GENRE_PRODUCTION_GUIDANCE_MAP[genreKey];
    return { ...(baseProfileJson ?? {}), ...(guidance ? { productionGuidance: guidance } : {}) };
  }

  private async seedSystemTemplates(): Promise<void> {
    for (const tpl of SYSTEM_TEMPLATES) {
      const mergedProfileJson = this.buildProfileJson(tpl.genreKey, tpl.profileJson);
      const existing = await this.repo.findOne({ where: { userId: IsNull(), genreKey: tpl.genreKey, isSystem: true } });
      if (existing) {
        existing.displayName = tpl.displayName;
        existing.description = tpl.description;
        existing.genreKeywords = tpl.genreKeywords;
        existing.seedHints = tpl.seedHints;
        existing.audienceTags = tpl.audienceTags;
        existing.protagonistFocusTags = tpl.protagonistFocusTags;
        existing.toneTags = tpl.toneTags;
        existing.platformTags = tpl.platformTags;
        // 始终更新 profileJson，确保 productionGuidance 被注入
        existing.profileJson = mergedProfileJson;
        existing.systemVersion = existing.systemVersion + 1;
        await this.repo.save(existing);
      } else {
        await this.repo.save(this.repo.create({
          userId: null, genreKey: tpl.genreKey, displayName: tpl.displayName,
          description: tpl.description, genreKeywords: tpl.genreKeywords,
          profileJson: mergedProfileJson, seedHints: tpl.seedHints,
          audienceTags: tpl.audienceTags, protagonistFocusTags: tpl.protagonistFocusTags,
          toneTags: tpl.toneTags, platformTags: tpl.platformTags, isSystem: true,
        }));
      }
    }
    this.logger.log(`短剧系统题材模板同步完成（${SYSTEM_TEMPLATES.length} 个），productionGuidance 已注入`);
  }

  async list(userId?: string): Promise<DramaGenreTemplateEntity[]> {
    if (userId) {
      await this.syncSystemTemplates(userId);
      // 已登录时只返回用户模板（含 sync 产生的副本），不叠加系统模板，避免「同一题材出现两次」的问题
      return this.repo.find({ where: { userId }, order: { displayName: 'ASC' } });
    }
    return this.repo.find({ where: { isSystem: true }, order: { displayName: 'ASC' } });
  }

  private async syncSystemTemplates(userId: string): Promise<void> {
    const systemTpls = await this.repo.find({ where: { isSystem: true } });
    const userTpls = await this.repo.find({ where: { userId } });
    const userByGenre = new Map(userTpls.map(t => [t.genreKey, t]));
    for (const sys of systemTpls) {
      const user = userByGenre.get(sys.genreKey);
      if (!user) {
        await this.repo.save(this.repo.create({
          userId, genreKey: sys.genreKey, displayName: sys.displayName,
          description: sys.description, genreKeywords: sys.genreKeywords,
          profileJson: sys.profileJson, seedHints: sys.seedHints,
          audienceTags: sys.audienceTags, protagonistFocusTags: sys.protagonistFocusTags,
          toneTags: sys.toneTags, platformTags: sys.platformTags,
          parentTemplateId: sys.id, syncedSystemVersion: sys.systemVersion,
        }));
      } else if (!user.isUserModified && user.syncedSystemVersion < sys.systemVersion) {
        Object.assign(user, {
          displayName: sys.displayName, description: sys.description,
          genreKeywords: sys.genreKeywords, seedHints: sys.seedHints,
          profileJson: sys.profileJson,
          audienceTags: sys.audienceTags, protagonistFocusTags: sys.protagonistFocusTags,
          toneTags: sys.toneTags, platformTags: sys.platformTags,
          syncedSystemVersion: sys.systemVersion,
        });
        await this.repo.save(user);
      }
    }
  }

  async getById(id: string): Promise<DramaGenreTemplateEntity> {
    const tpl = await this.repo.findOne({ where: { id } });
    if (!tpl) throw new NotFoundException(`短剧题材模板 ${id} 不存在`);
    return tpl;
  }

  async create(userId: string, dto: CreateDramaGenreTemplateDto): Promise<DramaGenreTemplateEntity> {
    return this.repo.save(this.repo.create({
      userId, genreKey: dto.genreKey, displayName: dto.displayName,
      description: dto.description ?? '', genreKeywords: dto.genreKeywords ?? [],
      profileJson: dto.profileJson ?? {}, seedHints: (dto.seedHints as DramaSeedHints) ?? null,
      audienceTags: dto.audienceTags ?? [], protagonistFocusTags: (dto.protagonistFocusTags ?? []) as any,
      toneTags: dto.toneTags ?? [], platformTags: dto.platformTags ?? [],
      isUserModified: true,
    }));
  }

  async update(id: string, userId: string, dto: UpdateDramaGenreTemplateDto): Promise<DramaGenreTemplateEntity> {
    const tpl = await this.getById(id);
    if (tpl.userId && tpl.userId !== userId) throw new NotFoundException('无权修改该模板');
    const patch: Partial<DramaGenreTemplateEntity> = { isUserModified: true };
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.genreKeywords !== undefined) patch.genreKeywords = dto.genreKeywords;
    if (dto.profileJson !== undefined) patch.profileJson = dto.profileJson;
    if (dto.seedHints !== undefined) patch.seedHints = dto.seedHints as DramaSeedHints;
    if (dto.audienceTags !== undefined) patch.audienceTags = dto.audienceTags;
    if (dto.protagonistFocusTags !== undefined) patch.protagonistFocusTags = dto.protagonistFocusTags as any;
    if (dto.toneTags !== undefined) patch.toneTags = dto.toneTags;
    if (dto.platformTags !== undefined) patch.platformTags = dto.platformTags;
    Object.assign(tpl, patch);
    return this.repo.save(tpl);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const tpl = await this.getById(id);
    if (tpl.isSystem) throw new Error('系统模板不可删除');
    if (tpl.userId && tpl.userId !== userId) throw new NotFoundException('无权删除该模板');
    await this.repo.remove(tpl);
    return { success: true };
  }

  async clone(id: string, userId: string): Promise<DramaGenreTemplateEntity> {
    const src = await this.getById(id);
    return this.repo.save(this.repo.create({
      userId, genreKey: `${src.genreKey}_copy`, displayName: `${src.displayName}（副本）`,
      description: src.description, genreKeywords: src.genreKeywords,
      profileJson: src.profileJson, seedHints: src.seedHints,
      audienceTags: src.audienceTags, protagonistFocusTags: src.protagonistFocusTags,
      toneTags: src.toneTags, platformTags: src.platformTags,
      parentTemplateId: src.id, isUserModified: true,
    }));
  }

  findBestMatch(genre: string): DramaSeedHints | null {
    const tpl = SYSTEM_TEMPLATES.find(t => t.genreKeywords.some(k => genre.includes(k)) || genre.includes(t.displayName));
    return tpl?.seedHints ?? null;
  }

  async aiGenerate(dto: {
    genreName: string; styleDescription?: string; referenceWorks?: string[];
    targetAudience?: string; platformTarget?: string; userId?: string;
  }): Promise<{
    displayName: string; description: string; genreKeywords: string[];
    audienceTags: string[]; protagonistFocusTags: string[]; toneTags: string[];
    platformTags: string[]; seedHints: DramaSeedHints; profileJson: Record<string, unknown>;
  }> {
    const portraitSchema = z.object({
      coreIdentitySummary: z.string(),
      keyGenreTraits: z.array(z.string()).min(3),
      catharsisKeywords: z.array(z.string()).min(3), // 爽点关键词
      hookKeywords: z.array(z.string()).min(3),
      conflictPatterns: z.array(z.string()).min(3),
      suggestedAudienceTags: z.array(z.string()).min(1),
      suggestedProtagonistFocus: z.array(z.enum(['female_lead', 'male_lead', 'dual_lead', 'ensemble'])).min(1),
      suggestedToneTags: z.array(z.string()).min(2),
      suggestedPlatforms: z.array(z.string()).min(1),
    });
    const portrait = await this.llm.generateStructured({
      taskName: 'drama-genre-portrait',
      schema: portraitSchema,
      tags: ['setup', 'drama-genre-portrait'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位资深短剧编剧总监，精通各类短剧题材的创作规律和平台特点。请根据用户描述的短剧题材生成一份"题材画像"。`,
      userPrompt: `短剧题材：${dto.genreName}
${dto.styleDescription ? `风格描述：${dto.styleDescription}` : ''}
${dto.referenceWorks?.length ? `参考作品：${dto.referenceWorks.join('、')}` : ''}
${dto.targetAudience ? `目标受众：${dto.targetAudience}` : ''}
${dto.platformTarget ? `目标平台：${dto.platformTarget}` : ''}

请生成题材画像 JSON：
- coreIdentitySummary: 一段话描述理想编剧身份
- keyGenreTraits: 5-8个题材核心特征
- catharsisKeywords: 5-8个观众爽感关键词（如打脸/逆袭/甜蜜暴击）
- hookKeywords: 5-8个集末钩子关键词
- conflictPatterns: 5-8个核心冲突模式
- suggestedAudienceTags: 推荐受众标签（如女性向/男性向/18-35岁）
- suggestedProtagonistFocus: 推荐主角类型（female_lead/male_lead/dual_lead/ensemble）
- suggestedToneTags: 推荐基调标签（如爽快/甜蜜/紧张/虐恋）
- suggestedPlatforms: 推荐平台（douyin/kuaishou/reelshort/dramabox）`,
      temperature: 0.5,
    });

    const seedHintsSchema = z.object({
      catharsisPresets: z.array(z.string()).min(3),
      conflictPatterns: z.array(z.string()).min(3),
      paywallStrategyHints: z.string(),
      visualStyleHints: z.string(),
      dialogueStyleHints: z.string(),
      platformDefaults: z.object({
        platformTarget: z.string().optional(),
        aspectRatio: z.string().optional(),
        durationSec: z.number().optional(),
      }).optional(),
    });
    const seedHintsRaw = await this.llm.generateStructured({
      taskName: 'drama-genre-seed-hints',
      schema: seedHintsSchema,
      tags: ['setup', 'drama-seed-hints', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位短剧运营专家。根据题材画像，生成短剧创作引导配置。

=== 题材画像 ===
编剧身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.catharsisKeywords.join('、')}
冲突模式：${portrait.conflictPatterns.join('、')}`,
      userPrompt: `短剧题材：${dto.genreName}
${dto.platformTarget ? `目标平台：${dto.platformTarget}` : ''}

请生成 JSON：
- catharsisPresets: 推荐爽点类型列表（5-8个，如"打脸""身份揭露""甜蜜反转"）
- conflictPatterns: 核心冲突模式列表（5-8个）
- paywallStrategyHints: 付费卡点策略建议（一段文字，说明在哪些剧情节点设置付费卡点效果最佳）
- visualStyleHints: 视觉风格提示（滤镜/色调/氛围建议）
- dialogueStyleHints: 台词风格提示（语言风格/节奏/禁忌）
- platformDefaults: 平台默认配置（platformTarget/aspectRatio/durationSec）`,
      temperature: 0.5,
    });

    const profileSchema = z.object({
      description: z.string(),
      genreKeywords: z.array(z.string()).min(3),
      scriptwriterGuide: z.object({
        coreIdentity: z.string(),
        genreRules: z.array(z.string()).min(5),
        dialogueGuide: z.string(),
        pacingGuide: z.string(),
      }),
      hookTypes: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })).min(3),
      reviewerCalibration: z.object({
        dimensionWeights: z.record(z.number()),
        genreSpecificChecks: z.array(z.string()),
      }),
    });
    const profileRaw = await this.llm.generateStructured({
      taskName: 'drama-genre-profile-ai-generate',
      schema: profileSchema,
      tags: ['setup', 'drama-profile', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位短剧编剧培训专家。为「${dto.genreName}」题材生成编剧手册核心配置。

=== 题材画像 ===
编剧身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.catharsisKeywords.join('、')}
钩子关键词：${portrait.hookKeywords.join('、')}`,
      userPrompt: `短剧题材：${dto.genreName}
目标受众：${dto.targetAudience ?? '通用短剧观众'}

请生成 JSON：
- description: 一句话描述该题材（20字内）
- genreKeywords: 题材关键词列表（5-8个）
- scriptwriterGuide: 编剧指南（coreIdentity/genreRules/dialogueGuide/pacingGuide）
- hookTypes: 集末钩子类型列表（5-8种，每种含 id/label/description）
- reviewerCalibration: 审核校准（dimensionWeights 各维度权重/genreSpecificChecks 题材专项检查）`,
      temperature: 0.6,
    });

    this.logger.log(`[aiGenerate] 短剧题材模板 AI 生成完成: ${dto.genreName}`);

    return {
      displayName: dto.genreName,
      description: profileRaw.description,
      genreKeywords: profileRaw.genreKeywords,
      audienceTags: portrait.suggestedAudienceTags,
      protagonistFocusTags: portrait.suggestedProtagonistFocus,
      toneTags: portrait.suggestedToneTags,
      platformTags: portrait.suggestedPlatforms,
      seedHints: seedHintsRaw as DramaSeedHints,
      profileJson: profileRaw as unknown as Record<string, unknown>,
    };
  }

  /** 按题材统计创建量/平均分/近30天趋势，用于数据驱动的选题推荐 */
  async getGenreAnalytics(): Promise<GenreAnalytics[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const raw: Array<{ genre: string; total: string; avg_score: string | null; avg_eps: string }> = await this.dramaRepo
      .createQueryBuilder('d')
      .select('d.genre', 'genre')
      .addSelect('COUNT(*)', 'total')
      .addSelect('AVG(d.latestOverallScore)', 'avg_score')
      .addSelect('AVG(d.episodesGenerated)', 'avg_eps')
      .where('d.genre IS NOT NULL AND d.genre != :empty', { empty: '' })
      .groupBy('d.genre')
      .orderBy('COUNT(*)', 'DESC')
      .getRawMany();

    const recentRaw: Array<{ genre: string; cnt: string }> = await this.dramaRepo
      .createQueryBuilder('d')
      .select('d.genre', 'genre')
      .addSelect('COUNT(*)', 'cnt')
      .where('d.genre IS NOT NULL AND d.genre != :empty AND d.createdAt >= :since', { empty: '', since: thirtyDaysAgo })
      .groupBy('d.genre')
      .getRawMany();

    const recentMap = new Map(recentRaw.map(r => [r.genre, parseInt(r.cnt, 10)]));

    return raw.map(r => ({
      genre: r.genre,
      totalDramas: parseInt(r.total, 10),
      avgScore: r.avg_score ? parseFloat(parseFloat(r.avg_score).toFixed(2)) : null,
      avgEpisodesGenerated: parseFloat(parseFloat(r.avg_eps).toFixed(1)),
      recentCount30d: recentMap.get(r.genre) ?? 0,
    }));
  }

  /** 获取推荐排序的题材列表（按近30天热度 + 平均分加权排序） */
  async getRecommendedGenres(): Promise<Array<GenreAnalytics & { score: number }>> {
    const analytics = await this.getGenreAnalytics();
    const maxRecent = Math.max(1, ...analytics.map(a => a.recentCount30d));
    const maxTotal = Math.max(1, ...analytics.map(a => a.totalDramas));

    return analytics
      .map(a => {
        const popularityScore = (a.recentCount30d / maxRecent) * 0.5 + (a.totalDramas / maxTotal) * 0.2;
        const qualityScore = a.avgScore ? (a.avgScore / 10) * 0.3 : 0;
        return { ...a, score: parseFloat((popularityScore + qualityScore).toFixed(3)) };
      })
      .sort((a, b) => b.score - a.score);
  }
}
