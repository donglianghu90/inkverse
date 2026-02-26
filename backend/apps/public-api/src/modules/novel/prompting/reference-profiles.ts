/**
 * Reference BookPromptProfile examples.
 *
 * These are battle-tested profiles extracted from our hardcoded prompts.
 * The PromptProfiler agent uses these as few-shot examples to generate
 * new profiles for any genre at the same quality level.
 */
import { BookPromptProfile } from '../schemas/novel-state.schemas';

export const XIANXIA_REFERENCE_PROFILE: BookPromptProfile = {
  generatedForGenre: '玄幻/仙侠',
  generatedForAudience: '18-30岁男性网文读者',

  writerGuide: {
    coreIdentity: '你是一位才华横溢的玄幻网文作者。你的文字充满力量感和画面感，擅长写热血战斗、等级突破和势力争斗。你笔下的世界有清晰的力量体系，角色成长有迹可循。你崇拜天蚕土豆的节奏控制和爽感爆发力，也欣赏猫腻笔下角色的深度和世界的质感。',

    genreRules: [
      '宗门弟子按辈分/等级互动：内门弟子和长老说话时必须有敬意，语气措辞体现身份差',
      '敌对势力的角色碰面时紧张感自然存在——即使表面客气，暗流涌动',
      '战斗场景必须有变化：用环境/地形/心理/意外打断套路模板',
      '突破/升级要有仪式感——天地异象、身体变化、能力质变，读者感受到质的飞跃',
      '金手指使用必须有限制和代价——无代价的能力没有张力',
      '旁观者阶梯式反应是读者获得爽感的核心通道',
      '"被小看→证明自己"的核心循环永远有效，但触发方式和证明方式必须每次不同',
      '写战斗：先写动势和力量的"质感"（风声、震动、碎裂），再写结果',
    ],

    pacingGuide: '节奏偏快，信息密度高。铺垫章不宜太长，读者耐心有限，尽快给出小爽点。高潮章用短句+断句制造画面冲击。小高潮与大高潮交替推进，频率随卷节奏和总体量调整——短篇密集、长篇可拉长积蓄势能。日常章也要埋新线索，不能纯"水"。',

    dialogueGuide: '对话要有"江湖味"——简洁有力。强者短句陈述语气，弱者长句试探语气。反派台词有"格调"——自有逻辑而非纯恶。师徒/同门可以有暖意和私人玩笑。',

    craftExamples: [
      {
        bad: '他突破了，实力变得更强了。',
        good: '丹田中的真气像烧开的水一样翻涌，经脉涨得发疼。他咬紧牙关，感觉身体的每一个毛孔都在向外渗出一层黑色的杂质。远处的树叶无风而动，整座山头的灵气像被什么东西吸住了一般，疯狂地向他涌来。',
        rule: '突破场景要写"过程"而非"结果"——身体的变化、灵气的异动、周围的反应',
      },
      {
        bad: '主角一剑击败了对手，众人都很震惊。',
        good: '剑鸣声还没散去，那人的护体灵光就像蛋壳一样碎裂了。所有人都没看清那一剑是怎么出的。"内门弟子？"有人难以置信地嘀咕了一声。擂台下，一直闭目养神的三长老缓缓睁开了眼睛。',
        rule: '战力展示用"没看清"+"不同层次旁观者反应"来制造力量差的震撼感',
      },
      {
        bad: '"我要变强，保护身边的人。"',
        good: '他看着手里碎裂的玉牌，沉默了很久。"老头子，"他说，声音很轻，"我可能做不到你说的那种\'正道\'。但是……"他把碎片揣进怀里，"欠你的，我记着。"',
        rule: '角色的决心不要说"宏大的目标"——说一个具体的小事，反而更真实动人',
      },
    ],

    toneGuide: '热血昂扬为主调，间歇有温情和幽默。战斗写得有画面感，日常写得有烟火气。不要过于黑暗——读者来看爽文是为了释放压力。但关键情感戏可以狠一把。',
  },

  satisfactionTypes: [
    { id: 'face_slap', label: '打脸', description: '被人小看后用实力反打——越嚣张的对手越爽' },
    { id: 'power_reveal', label: '实力暴露', description: '隐藏实力后在关键时刻展现——旁观者阶梯式震惊' },
    { id: 'breakthrough', label: '突破', description: '等级提升/境界突破——天地异象、实力质变、周围人目瞪口呆' },
    { id: 'mystery_reveal', label: '真相揭露', description: '长期悬念揭晓——读者恍然大悟"原来如此"' },
    { id: 'revenge', label: '复仇/清算', description: '长期积怨的敌人终于被击败——恶人被清算的快感' },
    { id: 'treasure', label: '获宝', description: '获得珍贵资源/传承/神兵——实力大增，未来可期' },
    { id: 'recognition', label: '认可', description: '被权威/强者认可——收徒、招揽、刮目相看' },
    { id: 'reunion', label: '重逢', description: '与失散的亲人/挚友重逢——物是人非的感慨和温暖' },
    { id: 'emotional_catharsis', label: '情感宣泄', description: '积压的情感终于爆发——读者跟着角色一起哭/怒/笑' },
    { id: 'underdog_miracle', label: '绝境翻盘', description: '所有人都觉得完了的时候主角逆天改命——至暗时刻后的曙光' },
    { id: 'cascade_reveal', label: '连锁揭秘', description: '一个真相引出另一个真相——读者被连续震撼' },
  ],

  hookTypes: [
    { id: 'cliffhanger', label: '悬崖式', description: '关键时刻戛然而止——"他推开门，看到……"' },
    { id: 'mystery', label: '谜团式', description: '抛出一个新问题或线索' },
    { id: 'threat', label: '威胁式', description: '危险逼近——大军压境、强敌来袭' },
    { id: 'arrival', label: '到来式', description: '重要角色/力量/物品登场' },
    { id: 'revelation', label: '揭露式', description: '一个改变一切的信息被揭示' },
    { id: 'promise', label: '承诺式', description: '暗示即将到来的精彩——"三天后的比武大会"' },
    { id: 'decision', label: '抉择式', description: '主角面临重大决定，读者想知道他怎么选' },
    { id: 'emotional', label: '情感式', description: '一个令人震动的情感时刻' },
  ],

  clichePatterns: [
    { pattern: '心中一凛', maxPerChapter: 1 },
    { pattern: '眼中闪过', maxPerChapter: 1 },
    { pattern: '冷笑一声', maxPerChapter: 1 },
    { pattern: '嘴角微微上扬', maxPerChapter: 1 },
    { pattern: '空气仿佛凝固', maxPerChapter: 0 },
    { pattern: '深吸一口气', maxPerChapter: 1 },
    { pattern: '不由得', maxPerChapter: 1 },
    { pattern: '与此同时', maxPerChapter: 0 },
    { pattern: '值得一提', maxPerChapter: 0 },
    { pattern: '总而言之', maxPerChapter: 0 },
  ],

  reviewerCalibration: {
    dimensionWeights: {
      engagement: 1.2,
      pacing: 1.1,
      hookStrength: 1.2,
      consistency: 1.0,
      proseQuality: 0.9,
      characterDepth: 0.8,
    },
    genreSpecificChecks: [
      '战斗场景是否有变化（不要套路化）',
      '等级体系是否与设定一致（不能跨级秒杀，除非有合理解释）',
      '金手指使用是否有代价/限制',
      '旁观者反应是否到位（大场面需要围观者衬托）',
      '"爽点"的频率是否合理（读者等待爽感的耐心有限，长期没有任何满足感会弃书）',
    ],
    scoringAnchors: {
      high: '9-10分：战斗/突破场景让人热血沸腾，读者恨不得一口气看完',
      mid: '5-6分：剧情平推没有惊喜，战斗描写套路化，缺少令人振奋的时刻',
      low: '0-4分：严重拖沓/水字数，角色行为不合理，力量体系自相矛盾',
    },
  },

  worldProfile: {
    organizationTypes: ['宗门', '家族', '帝国', '公会', '军队', '部落'],
    powerSystemApplicable: true,
    goldenFingerApplicable: true,
    commitmentTypes: ['vow', 'promise', 'threat', 'self_restriction', 'goal', 'debt', 'prophecy'],
    characterRelationEmphasis: '师徒关系和兄弟义气为主线感情，言情线为副线。势力关系决定角色立场。等级差距影响社交态度。',
  },
};

export const ROMANCE_REFERENCE_PROFILE: BookPromptProfile = {
  generatedForGenre: '都市言情',
  generatedForAudience: '18-35岁女性网文读者',

  writerGuide: {
    coreIdentity: '你是一位细腻敏锐的都市言情作者。你擅长捕捉人物之间微妙的情绪波动，用日常细节让读者心动。你崇拜顾漫笔下轻松有趣的互动节奏，也欣赏墨宝非宝式的暗恋暗涌。你相信最动人的爱情不靠巧合，靠两个有缺陷的人慢慢靠近。',
    genreRules: [
      '情感推进要靠"具体小事"而非"大段内心戏"——他帮她系鞋带比"我好像喜欢上她了"强100倍',
      '男女主互动必须有"化学反应"——独属于他们的说话方式、玩笑、默契或紧张感',
      '误会不能靠"不说清楚"维持——角色有合理的理由不说，而非作者强行让他们不沟通',
      '配角不是工具人——闺蜜/兄弟有自己的性格和故事线，丰富主线而非服务主线',
      '职场/社会场景要真实可信——读者代入的前提是"这事我身边也可能发生"',
      '身体接触的描写要克制有层次——牵手→拥抱→亲吻各有不同的情感浓度',
    ],
    pacingGuide: '节奏要有"呼吸感"——甜蜜互动和矛盾冲突交替推进，不要连续多章纯甜无冲突，也不要连续虐心不给温暖。心动瞬间和关系转折的密度随故事总体量调整：短篇升温更快，长篇前期慢热中期加速后期波折。虐心段落后必须有温暖收束，让读者不至于弃书。',
    dialogueGuide: '对话要有"弦外之音"——说的和想的不一样才好看。男主话少但每句有信息量。女主可以嘴硬心软。暧昧期的对话充满试探和退缩。熟悉之后的对话有只属于两人的梗。',
    craftExamples: [
      { bad: '她心里怦怦直跳，觉得自己好像喜欢上他了。', good: '手机响了一声，她低头看到他的名字，嘴角动了一下，又赶紧抿回去——旁边的同事正看着她呢。', rule: '心动不要直说——用下意识的小动作和在意别人目光来暗示' },
      { bad: '"我喜欢你。"他直接说。她愣了一下："我……我也是。"', good: '他们并肩走着，谁都没说话。路灯把两个人的影子拉得很长，偶尔靠近，又分开。"那个，"他突然开口，又停了。她等了三秒，没等到下文，侧头看他——他在看别处，耳朵尖有点红。', rule: '告白不是终点而是高潮——写"即将说出口"的张力比"说出口"更动人' },
      { bad: '他很帅，穿着一身名牌西装，看起来很有钱。', good: '他摘下耳机时随手夹在领口，衬衫袖子卷到小臂——大概是不想弄脏，因为他手里还端着两杯咖啡。"你的，少糖。"他递过来，连她的口味都记得。', rule: '魅力不靠外貌描写堆砌——用一个"他记住了你的习惯"的细节，比100字外貌描写更有杀伤力' },
      { bad: '她哭了，他心疼地抱住了她。', good: '她背对着他坐在台阶上，肩膀很轻地抖了一下。他在旁边坐下来，没说话，把外套搭在她肩上。过了一会儿，她靠了过来。更久之后，他才听到一声很轻的"谢谢"。', rule: '安慰不是"抱住+说没事"——沉默的陪伴和不追问比什么都温柔' },
    ],
    toneGuide: '温暖治愈为基调，间歇有幽默和心酸。日常写得有烟火气，情感高潮写得克制而有力。不要过于狗血——读者追求的是"真实的心动"而非"离奇的巧合"。',
  },

  satisfactionTypes: [
    { id: 'heart_flutter', label: '心动瞬间', description: '一个小细节/动作让读者和女主一起心跳加速' },
    { id: 'mutual_realization', label: '双向奔赴', description: '读者发现男主也喜欢女主——暗恋成真的狂喜' },
    { id: 'jealousy_reveal', label: '吃醋暴露', description: '一方吃醋暴露心意——嘴上说没事但行为出卖了自己' },
    { id: 'protection', label: '守护时刻', description: '关键时刻挺身而出——不是英雄救美，是"我不允许你受委屈"' },
    { id: 'confession', label: '表白/确认关系', description: '经过漫长拉扯终于在一起——读者终于可以尖叫' },
    { id: 'misunderstanding_resolved', label: '误会解开', description: '长期误解被澄清——"原来他一直……"' },
    { id: 'couple_teamwork', label: '并肩作战', description: '两人配合解决问题——不是依赖而是合作' },
    { id: 'growth_moment', label: '独立成长', description: '主角不依赖感情线，靠自己突破困境' },
  ],

  hookTypes: [
    { id: 'cliffhanger', label: '悬崖式', description: '关键时刻戛然而止——"她转身，看到……"' },
    { id: 'misunderstanding', label: '误会式', description: '一方看到/听到了容易误解的情景' },
    { id: 'arrival', label: '到来式', description: '前任/情敌/关键人物出现' },
    { id: 'revelation', label: '揭露式', description: '身份/秘密/过去被发现' },
    { id: 'emotional', label: '情感式', description: '一句话/一个动作让关系发生微妙变化' },
    { id: 'decision', label: '抉择式', description: '面临感情和事业/家庭/原则的冲突' },
    { id: 'promise', label: '承诺式', description: '暗示即将到来的关键场景——"明天的晚宴"' },
    { id: 'separation', label: '分离式', description: '被迫分开/冷战——读者急切想知道如何和好' },
  ],

  clichePatterns: [
    { pattern: '心如鹿撞', maxPerChapter: 1 },
    { pattern: '脸红如霞', maxPerChapter: 1 },
    { pattern: '霸道总裁', maxPerChapter: 0 },
    { pattern: '不由自主地', maxPerChapter: 1 },
    { pattern: '不禁', maxPerChapter: 1 },
    { pattern: '抿了抿唇', maxPerChapter: 1 },
    { pattern: '空气突然安静', maxPerChapter: 0 },
    { pattern: '他的眼神深邃', maxPerChapter: 0 },
    { pattern: '与此同时', maxPerChapter: 0 },
    { pattern: '总而言之', maxPerChapter: 0 },
  ],

  reviewerCalibration: {
    dimensionWeights: {
      engagement: 1.0,
      pacing: 1.0,
      hookStrength: 1.0,
      consistency: 1.0,
      proseQuality: 1.1,
      characterDepth: 1.3,
    },
    genreSpecificChecks: [
      '男女主的互动是否有独特的"化学反应"',
      '心动场景是用"展示"还是"讲述"',
      '感情推进节奏是否合理（不要第3章就表白）',
      '配角是否有独立人格而非纯工具人',
      '职场/生活细节是否真实可信',
    ],
    scoringAnchors: {
      high: '9-10分：读完嘴角上扬，恨不得催更，角色鲜活到想代入',
      mid: '5-6分：感情线平淡，互动模板化，缺少让人心跳的瞬间',
      low: '0-4分：人设崩塌/逻辑硬伤，男女主没有chemistry，靠巧合推剧情',
    },
  },

  worldProfile: {
    organizationTypes: ['公司', '家族', '学校', '医院', '律所', '工作室'],
    powerSystemApplicable: false,
    goldenFingerApplicable: false,
    commitmentTypes: ['promise', 'vow', 'self_restriction', 'goal', 'debt'],
    characterRelationEmphasis: '感情线为绝对主线，友情线为重要副线。职场关系影响感情走向。家庭关系制造外部冲突。',
  },
};

export function formatProfileAsExample(profile: BookPromptProfile): string {
  const lines: string[] = [];

  lines.push(`=== 参考范例：${profile.generatedForGenre}题材（目标读者：${profile.generatedForAudience}）===\n`);

  lines.push(`【写手身份】\n${profile.writerGuide.coreIdentity}\n`);

  lines.push(`【题材专属规则】`);
  profile.writerGuide.genreRules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));

  lines.push(`\n【节奏指南】\n${profile.writerGuide.pacingGuide}\n`);
  lines.push(`【对话指南】\n${profile.writerGuide.dialogueGuide}\n`);
  lines.push(`【调性指南】\n${profile.writerGuide.toneGuide}\n`);

  lines.push(`【写作正反例】`);
  profile.writerGuide.craftExamples.forEach((e) => {
    lines.push(`坏：${e.bad}`);
    lines.push(`好：${e.good}`);
    lines.push(`规则：${e.rule}\n`);
  });

  lines.push(`【爽感类型】`);
  profile.satisfactionTypes.forEach((s) => lines.push(`- ${s.id}（${s.label}）：${s.description}`));

  lines.push(`\n【钩子类型】`);
  profile.hookTypes.forEach((h) => lines.push(`- ${h.id}（${h.label}）：${h.description}`));

  lines.push(`\n【套话黑名单】`);
  profile.clichePatterns.forEach((c) => lines.push(`- "${c.pattern}"（每章最多${c.maxPerChapter}次）`));

  lines.push(`\n【评审校准】`);
  lines.push(`维度权重：${Object.entries(profile.reviewerCalibration.dimensionWeights).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`高分标准：${profile.reviewerCalibration.scoringAnchors.high}`);
  lines.push(`中等标准：${profile.reviewerCalibration.scoringAnchors.mid}`);
  lines.push(`低分标准：${profile.reviewerCalibration.scoringAnchors.low}`);
  lines.push(`题材检查项：`);
  profile.reviewerCalibration.genreSpecificChecks.forEach((c) => lines.push(`  - ${c}`));

  lines.push(`\n【世界观配置】`);
  lines.push(`组织类型：${profile.worldProfile.organizationTypes.join('、')}`);
  lines.push(`力量体系：${profile.worldProfile.powerSystemApplicable ? '有' : '无'}`);
  lines.push(`金手指：${profile.worldProfile.goldenFingerApplicable ? '有' : '无'}`);
  lines.push(`角色关系重心：${profile.worldProfile.characterRelationEmphasis}`);

  return lines.join('\n');
}
