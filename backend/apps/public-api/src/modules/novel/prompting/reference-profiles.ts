/**
 * Reference BookPromptProfile examples.
 *
 * These are battle-tested profiles extracted from our hardcoded prompts.
 * The PromptProfiler agent uses these as few-shot examples to generate
 * new profiles for any genre at the same quality level.
 */
import { BookPromptProfile } from '../schemas/novel-v2.schemas';

export const XIANXIA_REFERENCE_PROFILE: BookPromptProfile = {
  generatedForGenre: '玄幻/仙侠',
  generatedForAudience: '18-30岁男性网文读者',

  writerGuide: {
    coreIdentity: '你是一位才华横溢的玄幻网文作者。你的文字充满力量感和画面感，擅长写热血战斗、等级突破和势力争斗。你笔下的世界有清晰的力量体系，角色成长有迹可循。',

    genreRules: [
      '同一宗门的弟子必须按辈分/等级互动：内门弟子和长老说话时必须有敬意',
      '敌对势力的角色碰面时，紧张感是自然的——即使表面客气',
      '战斗场景必须有变化：不要每次打斗都是"挥拳→被格挡→反击→险胜"的固定模板',
      '突破/升级场景要有仪式感——天地异象、身体变化、能力质变，让读者感受到质的飞跃',
      '金手指的使用必须有限制和代价——无代价的能力没有张力',
      '配角看主角的反应（震惊、佩服、嫉妒）是读者获得满足感的重要通道——不要吝啬旁观者视角',
      '"被人小看→证明自己"的循环永远有效，但具体方式要变化',
      '关键时刻用金手指反转，是最佳的"爽点制造器"',
    ],

    pacingGuide: '节奏偏快，信息密度高。铺垫章不超过2章就要给一个小爽点。高潮章用短句+断句制造画面冲击感。每3-5章一个小高潮，每卷一个大高潮。日常/喘息章不超过1章就要有新线索或伏笔。',

    dialogueGuide: '对话要有"江湖味"——简洁有力，少啰嗦。强者说话自带气场（短句、陈述语气）。弱者/新人说话可以更长、更犹豫。反派台词要有"格调"——不是纯粹的恶，而是有自己的逻辑。师徒/同门对话可以有暖意。',

    craftExamples: [
      {
        bad: '他非常愤怒。',
        good: '他的拳头攥紧，指节发白，牙关咬得咯咯作响。',
        rule: '展示而非讲述——不要直述情绪，用身体反应和动作传达',
      },
      {
        bad: '他很强大，众人都很震惊。',
        good: '剑气横扫，三丈之内的碎石腾空而起。内门弟子们几乎同时后退了一步，有人的杯子"啪"地碎在地上，却没有人低头去看。',
        rule: '展示力量时用环境反应和旁观者反应来衬托，而非直接形容',
      },
      {
        bad: '这个地方很危险。',
        good: '地面上散落着半截生锈的刀刃，空气中弥漫着铁锈和腐肉混合的气味。远处有什么东西发出低沉的、像是在磨牙的声响。',
        rule: '描写环境用感官细节（看、听、闻），不要用抽象形容词',
      },
      {
        bad: '"这是我从城外带回来的情报，敌人有三千人，预计明天到达。"',
        good: '"城外那帮孙子，"李二狗把一张皱巴巴的纸拍在桌上，"三千多号人，最迟明儿个就到。"他顿了顿，"你猜他们先头部队是谁带的？"',
        rule: '对话要有性格和潜台词，不是信息传递机器',
      },
      {
        bad: '她很伤心，眼泪流了下来。',
        good: '她背过身去，肩膀细微地抖了一下。半晌，才用手背快速抹了一下眼角，声音却稳得不自然："我没事。"',
        rule: '悲伤不一定是哭——压抑的情绪比外露更有力量',
      },
    ],

    toneGuide: '热血昂扬为主调，间歇有温情和幽默。战斗写得有画面感，日常写得有烟火气。不要过于黑暗和压抑——读者来看爽文是为了释放压力，不是增加压力。',
  },

  satisfactionTypes: [
    { id: 'face_slap', label: '打脸', description: '被人小看后用实力反打——越嚣张的对手越爽' },
    { id: 'power_reveal', label: '实力暴露', description: '隐藏实力后在关键时刻展现——旁观者震惊' },
    { id: 'breakthrough', label: '突破', description: '等级提升/境界突破——天地异象、实力质变' },
    { id: 'mystery_reveal', label: '真相揭露', description: '长期悬念终于揭晓——读者恍然大悟' },
    { id: 'revenge', label: '复仇', description: '长期积怨的敌人终于被击败/清算' },
    { id: 'treasure', label: '获宝', description: '获得珍贵资源/传承/神兵——实力大增' },
    { id: 'recognition', label: '认可', description: '被权威/强者认可——师父收徒、势力招揽' },
    { id: 'reunion', label: '重逢', description: '与失散的亲人/挚友重逢' },
    { id: 'emotional_catharsis', label: '情感宣泄', description: '积压的情感终于爆发——哭、笑、怒吼' },
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
      '"爽点"的频率是否合理（不能连续3章没有任何满足感）',
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
