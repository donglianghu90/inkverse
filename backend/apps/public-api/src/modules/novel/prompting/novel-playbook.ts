/**
 * 提示词片段与上下文构建器。
 * 设计目标：给予写作自由度，减少机械约束，保留质量底线。
 */
import {
  StoryState,
  ChapterIntent,
  StorySeed,
  RoughOutline,
  CrystallizedBible,
  MiniArc,
  MiniArcChapterBeat,
  StyleAnchor,
  WritingLesson,
} from '../schemas/novel-state.schemas';

// ---------------------------------------------------------------------------
// Core playbooks — shared across agents
// ---------------------------------------------------------------------------

export const WRITING_SOUL_PLAYBOOK = `写作灵魂准则：
1) 所有正文必须使用简体中文。禁止输出任何元叙述。
2) 代入感是命根子：写任何场景前先问"读者读到这里会代入谁的视角"，然后用那个人的感官去写。
3) 情绪先行：先确定"读者读到这里应该是什么心情"，再倒推用什么细节引发那种心情。
4) 角色的行为必须从人物性格中自然流出，不得被剧情强行驱动。
5) 不完美原则：真实的人有口误、犹豫、前后矛盾。角色不要太理性、太自知——"他意识到自己在害怕"这种话真人不会想。
6) 允许在写作过程中产生计划外的灵感——好的意外比严格执行计划更重要。`;

export const PROSE_CRAFT_PLAYBOOK = `
【一、展示而非讲述】
规则：每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。
- 不要写"他心中一惊"→ 写具体反应（筷子从手中滑落、脚步顿了一下、瞳孔骤缩）
- 不要写"她很美"→ 写旁人的反应（酒楼掌柜多看了两眼、路人差点撞上柱子）
- 不要写"气氛很紧张"→ 写感官细节（安静到能听见自己咽口水的声音）

【二、对白技法】
- 潜台词：角色说的和想的不一定一样。越重要的话，越不会直说。
- 每句对话至少完成两个任务：推进剧情+展示性格，或传递信息+制造冲突。
- 权力差异影响语气：强者说短句、陈述语气；弱者说长句、试探语气。
- 沉默也是对话：角色不回应的时刻，往往比说了什么更有力量。
- 对白标签要变化："说"只占一半，其余用动作代替（攥着杯子、偏过头、嗤笑一声）。
- 允许打断、省略、跑题——真实对话不是轮流发言。

【三、句式节奏】
- 紧张时刻用短句。平静时刻用长句。长短交替像呼吸。
- 一段之内避免连续三句以同样方式开头。
- 重要信息出现前，放一个短段单独成段——制造视觉停顿。
- 战斗场景：短句+断句+画面感。日常场景：长句+细节+氛围。

【四、感官叠加——让读者"身临其境"】
- 每个重要场景至少调动两种以上感官（视觉+听觉+触觉/嗅觉/味觉）。
- 坏：他走进山洞，里面很暗。→ 好：脚下踩到什么柔软的东西，潮湿的空气裹着一股甜腐的气味涌来，远处水滴落入积水的声音被洞壁放大成空洞的回声。
- 气温、风、光线方向、地面质感——这些看似无关的细节是沉浸感的基石。

【五、环境映射情绪——景随心动】
- 角色高兴时不要写"他很高兴"→ 写"日光正好，街边的槐花不知什么时候开了"。
- 角色压抑时不要写"气氛沉重"→ 写"天色暗了下来，巷子里的风比刚才凉了些"。
- 环境和人物的情绪形成共振，读者会不自觉地被带入那种心境。

【六、留白术——什么都不说，反而最有力量】
- 不是所有情绪都需要写出来。"他望着那个方向很久，没有说话。"比200字心理描写更震撼。
- 关键时刻的停顿、沉默、省略号——给读者想象空间。
- 坏："他心里充满了悲伤和不舍。"→ 好："他站在原地，直到那道背影消失在雨幕中。然后他低头，擦了擦鞋上的泥。"

【七、旁观者烘托——用不同层次的反应衬托关键时刻】
- 重大事件发生时，按认知层级递进写旁观者反应：不知情者茫然→知情者震动→权威者动容。
- 每一层的反应都要具体不同：有人手中物品跌落、有人不自觉后退一步、有人站了起来、有人说不出话。
- 旁观者的碎语（"这……怎么可能？""他什么时候……"）是读者获得满足感的重要通道。

【八、金句意识——每隔几章，要有一句让读者想截图的话】
- 金句不是文艺腔，是浓缩了角色性格和当下处境的一句话。
- 好的金句特征：简短、有力、有态度、放在特殊语境下才有味道。
- 金句出现在关键转折点：反转前、誓言时、生死抉择时、多年后重逢时。

【九、杀死AI味】
以下表达每章每个最多出现一次（超出即扣分）：
"不由得""心中一凛""眼中闪过""与此同时""值得一提""总而言之""深吸一口气""空气仿佛凝固""嘴角微微上扬""不禁""缓缓开口""微微一笑""目光深邃"

深层AI味（比套话更隐蔽，更致命）：
- 角色对自己的情绪过于自知（"他意识到自己在嫉妒"——真人不会这么想）
- 事件发展过于顺滑，没有"卡壳"和意外
- 所有角色的内心戏都像在写论文（"一方面…另一方面…"）
- 过于对称工整的结构（"先A再B然后C"的三段式）
- 缺少"废话"——真实对话中的停顿、重复、词不达意
`;

/** 根据目标字数动态生成章节节奏准则 */
export function buildChapterRhythmPlaybook(targetWords = 3000): string {
  return `章节节奏准则：

章内三幕结构（每章${targetWords}字内也要有起承转合）：
- 开头段（约15-25%）：承接上章+建立本章悬念/目标。第一段就要有"微钩子"。高潮章可缩短开头快速进入核心冲突；铺垫章可适当拉长建立氛围。
- 中段（约50-65%）：推进并升级矛盾。每个段落至少包含一个动作推进、关系变化或信息增量。
- 收尾段（约15-25%）：章内小高潮+钩子。信息密度最高的部分。比例灵活——悬念揭晓章可用更长的收尾来制造冲击。

呼吸节奏：
- 连续2-3段紧张段落后，需要一个"呼吸点"——一句幽默、一个微小的温情细节、一个安静的观察——然后猛然拉回紧张。
- 这个呼吸点让读者放松一瞬，下一波紧张感才能更强烈。
- 高潮段中穿插一个不协调的微小细节反而能增强真实感。

硬规则：
1) 开场必须承接上章的未决问题或钩子。
2) 尾段抛出未解决的强张力。
3) 优先中短段落。
4) 禁止连续三段使用相同句式开头。
5) 场景/视角切换时用环境描写做自然过渡，不要硬切。`;
}

export const CONTINUITY_BASELINE_PLAYBOOK = `连续性底线：
1) 角色姓名、称呼必须与已有记录一致。
2) 已死亡/退场角色不得现身参与当前动作线。
3) 休眠角色不得直接现身。
4) "计划回归但未到章"的角色仅允许伏笔提及。
5) 不得产生不可能的空间位移或战力跳级。`;

export const THREAD_AWARENESS_PLAYBOOK = `伏线意识：
1) 不要为了"制造悬念"而无节制开新坑。
2) 对逾期伏线优先推进或回收。
3) 回收伏线时必须兑现前置铺垫，不得硬回收。
4) 新伏线必须服务当前冲突。`;

/** 根据题材Profile动态生成首章约束 */
export function buildFirstChaptersPlaybook(hasGoldenFinger?: boolean): string {
  return `首章特殊约束（仅适用于前 3 章）：

黄金开局模板（第一章）：
- 冷启动挑战：第1章没有前文上下文、没有文风锚点、世界观几乎空白——你必须在零基础上同时完成"建立世界+塑造角色+制造冲突"三件事，用行动和感官细节替代背景说明。
- 第一段必须在100字内建立"不公/异常/危机"——让读者立刻产生情绪（愤怒/好奇/紧张）。
- 主角的第一个动作/选择必须让目标读者认同（"我也会这么做"或"我好想这么做"）。
${hasGoldenFinger ? '- 前500字内必须暗示金手指/特殊能力的存在（不必展示，暗示即可）。' : '- 前500字内必须暗示主角的核心优势或独特之处（性格/技能/资源/秘密），让读者期待后续发展。'}
- 前500字内必须建立核心冲突感——读者要知道"主角面对什么困境"，冲突越具体越好。
- 世界观契约：第一章让读者知道"这个世界的规则是什么，我在这里能期待什么"。
- 世界观差异自然嵌入，禁止百科式铺陈。
- 文风定调：第1章的叙事腔调将成为全书基调，选择最能匹配题材和读者期待的声音，保持全章语感一致。

性格锚点（前两章）：
- 主角必须通过一个具体的选择（而非内心独白）展示核心性格。
- 好的性格锚点：面对不公时的反应、对弱者的态度、在压力下的选择。
- 坏的性格锚点：大段内心独白告诉读者"我是一个什么样的人"。

硬规则：
1) 前三章每章钩子力度加倍——让读者绝对不会在第3章之前弃书。
2) 前三章不得出现超过3个非主线角色——信息过载是新书最大杀手。
3) 第一章结尾必须有一个"改变一切"的事件/发现/到来。`;
}

export const REVIEWER_RUBRIC_PLAYBOOK = `评审打分标尺（0-10）：
9-10：强烈追更欲，几乎无缺陷。
7-8：可追更，有少量可修复缺陷。
5-6：可读但平庸，影响留存。
0-4：重大缺陷，建议重修。`;

export const EDITOR_DISCIPLINE_PLAYBOOK = `编辑纪律：
1) 优先修复审阅指出的具体问题。
2) 保留已验证的事实与因果链。
3) 不得削弱已有强钩子，除非替换为更强钩子。
4) 不得改动章号与章名，除非明确要求。

主动提升职责（在修复问题之余）：
5) 找到最平淡的2-3段，用更有画面感/感官更丰富的方式重新表达。
6) 检查关键对话是否有"潜台词"层次——角色说的话是否太直白？
7) 确保章内有情绪弧线——从A情绪到B情绪，而非情绪平坦。
8) 如果正文中有"告诉"而非"展示"的段落，改为展示。`;

export const CHARACTER_ARC_PLAYBOOK = `角色弧线意识：

矛盾内核（最重要）：
- 每个重要角色都有一个不可调和的内在矛盾——想做好人但生在乱世，想保护所有人但力量不够，渴望自由却背负责任。
- 这个矛盾是角色做出所有选择的根源，也是读者持续关注他的理由。
- "以小见大"的性格展示：不要用大段内心独白展示性格——通过一个微小的选择（在街上看到乞丐的反应、独处时的小习惯）来暗示角色的内核。

成长规则：
1) 成长不是线性的。角色可以两步前进一步后退：一个变勇敢的角色也可以突然怯懦，这恰恰真实。
2) 关系是双向的。A对B的态度变化，同时应该影响B对A的反应。
3) 角色间的"化学反应"：两个特定角色在一起时应该有独特的互动方式——只属于他们的玩笑、默契或紧张感。

硬规则：
4) 情绪逻辑不可违反：角色的情绪反应必须和刚经历的事件匹配。刚失去至亲不能下一段就谈笑风生，除非有明确的压抑/伪装理由。
5) "扁平化警报"：如果一个角色连续多章只是功能性出场，需要给他一个展现内心的时刻。
6) 重要角色应定期经历"内心考验"——选择、妥协、发现、醒悟。频率与故事节奏匹配，不要为了"到时间了"而强行安排。`;

// ---------------------------------------------------------------------------
// Chapter type templates — detailed structural guidance per chapter archetype
// ---------------------------------------------------------------------------

export const CHAPTER_TYPE_TEMPLATES: Record<string, string> = {
  climax: `=== 高潮章写作模板 ===
你现在处于最兴奋的创作状态。想象读者在屏幕前攥紧拳头。每一个字都要像子弹一样射出去。

结构（按顺序）：
1)【先抑——最后的压力】：对手/困境达到顶峰，局势看似不可挽回。这段要写得让读者也觉得"完了"。
2)【转折信号】：一个微小但关键的变化——关键信息到来、某人出现、主角做出决定、一个被遗忘的线索重新浮现。转折要小，但读者能感觉到风向变了。
3)【爆发序列】：核心冲突正面对决。环境反应先于人物反应——周围事物的变化→气氛的骤变→空气中的张力。用短句、断句、动作密集。
4)【多层次反应】：不同角色用不同方式反应——根据题材选择最合适的呈现方式（旁观者震惊、知情者异常行为、亲密者情绪决堤等）。每一层用具体的动作/表情/细节，避免重复同一种反应。
5)【金句收尾】：一句让读者想截图的话。简短、有力、有态度。
6)【安静的余韵】：所有人沉默。一个微小的环境细节（风声、水声、远处的响动）打破沉默。

节奏：短句为主，段落要短，留白要多。让读者的眼睛飞速滑过页面。`,

  setup: `=== 铺垫章写作模板 ===
你是一个耐心的猎人在布置陷阱。每句话都在不动声色地引导读者走向你想要他们去的地方。

核心任务是"勾起好奇"，不是"说明信息"。
- 新角色登场要有悬念：先展示行为的反常，再慢慢揭示原因。
- 多埋线索，少给答案。读者应该带着"这是怎么回事？"的心情读完。
- 信息通过角色的自然行为和对话流出，禁止百科式介绍。

铺垫章也要有吸引力：
- 即使在铺垫中，段落间要频繁穿插"微钩子"——一句反常的话、一个未解释的现象、一个角色的异常反应。不能让读者连续读太多段落而没有任何好奇点。
- 铺垫章的钩子往往是"信息型"——读者发现了一条线索，但不知道它意味着什么。
- 角色间的日常互动是建立情感基础的最佳时机。`,

  rising: `=== 升温章写作模板 ===
矛盾加剧但不爆发——像弹簧被越压越紧。读者应该感觉到"马上要出事了"。

- 压力递进：每个场景的紧张感比上一个稍高。信息一点点揭露，威胁一步步逼近。
- 角色间的裂痕开始显现：意见分歧、信任动摇、被迫的选择。
- 适合展示角色的内心挣扎和两难抉择——他们在高潮前的最后犹豫。
- 制造"不可避免"的感觉：读者能预见冲突要来，但不知道会以什么方式爆发。
- 倒计时感：时间压力、截止日期、敌人在靠近。`,

  relief: `=== 过渡/喘息章写作模板 ===
暴风雨后的平静。读者需要喘口气，但你仍然在暗中为下一场风暴布局。

- 角色间的日常互动、幽默、温情——这些才是读者真正爱上角色的时刻。
- 暗线推进：在轻松的表象下，至少推进一条暗线（一封信、一个路人的闲话、远方的异象）。
- 关系发展的黄金时机：感情线在这里推进最自然。
- 暗示下一场风暴：让读者在轻松中隐隐感到不安（一个被忽略的细节、一句双关的话）。
- 节奏慢但信息密度不低——用细节丰富世界观，用小事展示角色性格。`,
};

// ---------------------------------------------------------------------------
// Context builders for V2 state
// ---------------------------------------------------------------------------

export function buildSeedContext(seed: StorySeed): Record<string, unknown> {
  return {
    书名: seed.title,
    类型: seed.genre,
    目标读者: seed.targetAudience,
    一句话梗概: seed.logline,
    每章目标字数: seed.targetChapterWordCount ?? 3000,
    计划总章数: seed.plannedTotalChapters ?? { min: 500, max: 800 },
    主角概念: {
      姓名: seed.protagonistConcept.name,
      处境: seed.protagonistConcept.situation,
      核心渴望: seed.protagonistConcept.coreDesire,
      性格: seed.protagonistConcept.personality,
    },
    调性: seed.tone,
    核心冲突方向: seed.coreConflictDirection,
    ...(seed.mainStoryGoal ? { 主线目标: seed.mainStoryGoal } : {}),
    红线: seed.redLines,
  };
}

export function buildOutlineContext(outline: RoughOutline): Record<string, unknown> {
  return {
    预估总章数: outline.estimatedTotalChapters ?? 600,
    故事节点: outline.points.map((p) => ({
      阶段: p.phase,
      描述: p.description,
      暂定章节范围: p.tentativeChapterRange,
    })),
    结局方向: outline.endingDirection,
  };
}

export function buildBibleContext(bible: CrystallizedBible): Record<string, unknown> {
  return {
    版本: bible.version,
    结晶章节: bible.crystallizedAtChapter,
    书名: bible.title,
    类型: bible.genre,
    一句话梗概: bible.logline,
    世界规则: bible.worldRules,
    力量体系: bible.powerSystem.map((level) => ({
      境界名: level.levelName,
      序号: level.levelRank,
      描述: level.description,
      边界: level.boundary,
    })),
    红线: bible.redLines,
    核心冲突: bible.mainConflict,
    叙事风格: bible.narrativeStyle,
    已确立事实: bible.establishedFacts,
  };
}

interface CompactContextV2Options {
  maxCharacters?: number;
  maxChapterSummaries?: number;
  maxOpenThreads?: number;
  maxTimelineEvents?: number;
  maxRecentKpi?: number;
}

const ROLE_LABEL: Record<string, string> = {
  protagonist: '主角',
  supporting: '配角',
  villain: '反派',
  npc: '路人',
};

const LIFECYCLE_LABEL: Record<string, string> = {
  active: '活跃',
  dormant: '休眠',
  dead: '死亡',
  exited: '退场',
  return_planned: '计划回归',
};

const THREAD_STATUS_LABEL: Record<string, string> = {
  open: '未回收',
  payoff: '已回收',
  expired: '过期',
};

export function buildCompactContext(
  state: StoryState,
  options: CompactContextV2Options = {},
): Record<string, unknown> {
  const limits = {
    maxCharacters: options.maxCharacters ?? 10,
    maxChapterSummaries: options.maxChapterSummaries ?? 6,
    maxOpenThreads: options.maxOpenThreads ?? 10,
    maxTimelineEvents: options.maxTimelineEvents ?? 15,
    maxRecentKpi: options.maxRecentKpi ?? 5,
  };

  const plotThreadLedger = state.plotThreadLedger ?? [];
  const timelineEvents = state.timelineEvents ?? [];
  const chapterNumber = state.chapterCursor;

  const openThreads = plotThreadLedger
    .filter((t) => t.status === 'open')
    .sort((a, b) => b.lastTouchedChapter - a.lastTouchedChapter)
    .slice(0, limits.maxOpenThreads);

  const overdueThreads = openThreads.filter(
    (t) => t.plannedPayoffEndChapter !== null && chapterNumber > t.plannedPayoffEndChapter,
  );

  const recentEvents = [...timelineEvents]
    .sort((a, b) =>
      a.chapterNumber === b.chapterNumber
        ? b.sequence - a.sequence
        : b.chapterNumber - a.chapterNumber,
    )
    .slice(0, limits.maxTimelineEvents);

  const recentKpi = state.kpiHistory.slice(-limits.maxRecentKpi);

  const blockedCharacterIds = state.characters
    .filter((c) => {
      const lifecycle = c.status.lifecycleStatus ?? 'active';
      const canRef = c.status.dormantReference ?? false;
      return (
        ((lifecycle === 'dead' || lifecycle === 'exited') && !canRef) ||
        (lifecycle === 'dormant' && !canRef)
      );
    })
    .map((c) => c.id);

  const foreshadowOnlyIds = state.characters
    .filter((c) => {
      const lifecycle = c.status.lifecycleStatus ?? 'active';
      const planned = c.status.plannedReturnChapter ?? null;
      return lifecycle === 'return_planned' && planned !== null && planned > chapterNumber;
    })
    .map((c) => c.id);

  const visibleCharacters = [...state.characters]
    .filter((c) => !blockedCharacterIds.includes(c.id))
    .sort((a, b) => {
      const aLead = a.role === 'protagonist' ? 10 : 0;
      const bLead = b.role === 'protagonist' ? 10 : 0;
      return bLead - aLead || (b.status.lastSeenChapter ?? 0) - (a.status.lastSeenChapter ?? 0);
    })
    .slice(0, limits.maxCharacters);

  const estTotal = state.roughOutline.estimatedTotalChapters ?? 600;
  const result: Record<string, unknown> = {
    书籍编号: state.bookId,
    当前章号: chapterNumber,
    总体进度: `第${chapterNumber}章 / 计划${estTotal}章（${((chapterNumber / estTotal) * 100).toFixed(1)}%）`,
    种子信息: buildSeedContext(state.seed),
    粗大纲: buildOutlineContext(state.roughOutline),
  };

  if (state.bible) {
    result['故事圣经'] = {
      书名: state.bible.title,
      类型: state.bible.genre,
      一句话梗概: state.bible.logline,
      世界规则: state.bible.worldRules,
      红线: state.bible.redLines,
      核心冲突: state.bible.mainConflict,
    };
  }

  result['连续性记忆'] = {
    上一章钩子: state.lastHook,
    近期章节摘要: state.chapterSummaries
      .slice(-limits.maxChapterSummaries)
      .map((e) => `[第${e.chapterNumber}章] ${e.summary}`),
  };

  result['角色表'] = visibleCharacters.map((c) => {
    const p = c.profile;
    const entry: Record<string, unknown> = {
      编号: c.id,
      姓名: c.name,
      别名: c.aliases ?? [],
      角色定位: ROLE_LABEL[c.role] ?? c.role,
      性格标签: c.personalityTags,
      生命周期: LIFECYCLE_LABEL[c.status.lifecycleStatus ?? 'active'],
      当前状态: c.status.state,
      所在地点: c.status.locationId,
    };
    if (p) {
      if (p.age) entry['年龄'] = p.age;
      if (p.gender) entry['性别'] = p.gender;
      if (p.facialFeatures) entry['外貌'] = p.facialFeatures;
      if (p.hairStyle || p.hairColor) entry['发型'] = [p.hairColor, p.hairStyle].filter(Boolean).join(' ');
      if (p.skinTone) entry['肤色'] = p.skinTone;
      if (p.build || p.height) entry['体型'] = [p.height, p.build].filter(Boolean).join(', ');
      if (p.typicalOutfit) entry['当前服饰'] = p.typicalOutfit;
      if (p.signatureAccessory) entry['标志配饰'] = p.signatureAccessory;
      if (p.distinguishingMarks?.length) entry['标志特征'] = p.distinguishingMarks;
      if (p.hobbies?.length) entry['爱好'] = p.hobbies;
      if (p.abilities?.length) entry['能力'] = p.abilities.map((a) => `${a.name}(${a.level})`);
      if (p.coreContradiction) entry['核心矛盾'] = p.coreContradiction;
      if (p.backstory) entry['已知背景'] = p.backstory;
    }
    return entry;
  });

  result['连载约束'] = {
    禁止出场角色编号: blockedCharacterIds,
    仅可伏笔提及编号: foreshadowOnlyIds,
  };

  result['开放伏线'] = openThreads.map((t) => ({
    伏线编号: t.id,
    标签: t.label,
    状态: THREAD_STATUS_LABEL[t.status] ?? t.status,
    铺设章节: t.setupChapter,
    最近触达: t.lastTouchedChapter,
    回收窗口: t.plannedPayoffEndChapter
      ? `${t.plannedPayoffStartChapter ?? '?'}-${t.plannedPayoffEndChapter}`
      : '未定',
  }));

  if (overdueThreads.length > 0) {
    result['逾期伏线警告'] = overdueThreads.map((t) => t.label);
  }

  result['近期事件'] = recentEvents.map((e) => ({
    章节: e.chapterNumber,
    事件: e.title,
    摘要: e.summary,
  }));

  if (recentKpi.length > 0) {
    result['近期质量趋势'] = recentKpi.map((k, i, arr) => ({
      章序号: chapterNumber - (arr.length - i),
      质量分: k.qualityScore,
      读者总分: k.overallScore,
    }));
  }

  if (state.locations.length > 0) {
    result['地点表'] = state.locations.slice(0, 12).map((l) => {
      const entry: Record<string, unknown> = {
        编号: l.id,
        名称: l.name,
        描述: l.description,
      };
      const p = l.profile;
      if (p) {
        if (p.terrain) entry['地形'] = p.terrain;
        if (p.climate) entry['气候'] = p.climate;
        if (p.architecture) entry['建筑'] = p.architecture;
        if (p.sensoryDetails?.atmosphere) entry['氛围'] = p.sensoryDetails.atmosphere;
        if (p.culture) entry['文化'] = p.culture;
      }
      return entry;
    });
  }

  if (state.items.length > 0) {
    result['道具表'] = state.items.slice(0, 10).map((item) => {
      const entry: Record<string, unknown> = {
        编号: item.id,
        名称: item.name,
        效果: item.effect,
        持有者: item.ownerId,
      };
      const p = item.profile;
      if (p) {
        if (p.appearance) entry['外观'] = p.appearance;
        if (p.origin) entry['来历'] = p.origin;
        if (p.limitations) entry['限制'] = p.limitations;
        if (p.rarity) entry['稀有度'] = p.rarity;
      }
      return entry;
    });
  }

  if (state.storyClock) {
    const SEASON_LABEL: Record<string, string> = {
      spring: '春', summer: '夏', autumn: '秋', winter: '冬', unknown: '未知',
    };
    const TOD_LABEL: Record<string, string> = {
      dawn: '黎明', morning: '上午', noon: '正午', afternoon: '下午',
      dusk: '黄昏', evening: '傍晚', night: '夜晚', late_night: '深夜',
    };
    result['故事时间'] = {
      故事第几天: state.storyClock.currentDay,
      当前时段: TOD_LABEL[state.storyClock.currentTimeOfDay] ?? state.storyClock.currentTimeOfDay,
      季节: SEASON_LABEL[state.storyClock.season] ?? state.storyClock.season,
      ...(state.storyClock.calendarNote ? { 纪年备注: state.storyClock.calendarNote } : {}),
    };
  }

  if (state.lastSceneSnapshot) {
    result['上章结束场景'] = {
      地点: state.lastSceneSnapshot.locationName ?? state.lastSceneSnapshot.locationId ?? '未知',
      时间: state.lastSceneSnapshot.timeOfDay ?? '未知',
      天气: state.lastSceneSnapshot.weather ?? '未知',
      在场角色: state.lastSceneSnapshot.presentCharacterIds,
      正在发生: state.lastSceneSnapshot.ongoingAction ?? '',
      情绪氛围: state.lastSceneSnapshot.emotionalTone ?? '',
    };
  }

  const addressMatrix = state.addressMatrix ?? [];
  if (addressMatrix.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    result['称呼矩阵'] = addressMatrix.slice(0, 30).map((a) => ({
      谁: charNameMap.get(a.fromCharacterId) ?? a.fromCharacterId,
      叫谁: charNameMap.get(a.toCharacterId) ?? a.toCharacterId,
      称呼: a.address,
    }));
  }

  if (state.goldenFinger) {
    result['金手指'] = {
      名称: state.goldenFinger.name,
      概念: state.goldenFinger.concept,
      当前阶段: state.goldenFinger.currentStage,
      限制: state.goldenFinger.limitations,
      ...(state.goldenFinger.evolutionPath?.length ? {
        进化路径: state.goldenFinger.evolutionPath.map((e) => ({
          阶段: e.stage,
          新能力: e.newCapability,
          ...(e.unlockedAtChapter ? { 解锁章: e.unlockedAtChapter } : {}),
        })),
      } : {}),
    };
  }

  if (state.seed.readerPersona) {
    const rp = state.seed.readerPersona;
    result['读者画像'] = {
      核心幻想: rp.coreFantasy,
      代入锚点: rp.projectionAnchor,
      触发场景: rp.triggerScenes,
      情感需求: rp.emotionalNeeds,
    };
  }

  if (state.currentArc) {
    result['当前卷计划'] = buildArcContext(state.currentArc, chapterNumber);
  }

  if (state.styleAnchor) {
    result['文风锚点'] = buildStyleAnchorContext(state.styleAnchor);
  }

  const activeGaps = (state.informationLedger ?? { activeGaps: [] }).activeGaps;
  if (activeGaps.length > 0) {
    result['信息差'] = activeGaps.map((g) => ({
      编号: g.id,
      秘密: g.secret,
      类型: g.type,
      知情者: g.knownBy,
      不知情者: g.unknownTo,
      戏剧冲击力: g.dramaticPotential,
      存在章数: chapterNumber - g.seededAtChapter,
    }));
  }

  const FACTION_TYPE_LABEL: Record<string, string> = {
    sect: '宗门', family: '家族', empire: '帝国', guild: '公会',
    army: '军队', corporation: '公司', tribe: '部落', other: '势力',
  };
  const FACTION_REL_LABEL: Record<string, string> = {
    alliance: '结盟', rivalry: '敌对', war: '交战', subsidiary: '附属',
    neutral: '中立', trade: '贸易', vassal: '臣属',
  };
  const factions = state.factions ?? [];
  if (factions.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    result['势力表'] = factions.slice(0, 10).map((f) => {
      const entry: Record<string, unknown> = {
        编号: f.id,
        名称: f.name,
        类型: FACTION_TYPE_LABEL[f.type] ?? f.type,
        描述: f.description,
      };
      if (f.leaderId) entry['首领'] = charNameMap.get(f.leaderId) ?? f.leaderId;
      if (f.members.length > 0) {
        entry['成员'] = f.members.slice(0, 8).map((m) => ({
          角色: charNameMap.get(m.characterId) ?? m.characterId,
          等级: m.rank,
        }));
      }
      if (f.hierarchy.length > 0) entry['等级制度'] = f.hierarchy;
      if (f.rules.length > 0) entry['门规'] = f.rules;
      if (f.relations.length > 0) {
        const factionNameMap = new Map(factions.map((ff) => [ff.id, ff.name]));
        entry['关系'] = f.relations.map((r) => ({
          对方: factionNameMap.get(r.targetFactionId) ?? r.targetFactionId,
          关系: FACTION_REL_LABEL[r.relationType] ?? r.relationType,
        }));
      }
      return entry;
    });
  }

  const COMMIT_TYPE_LABEL: Record<string, string> = {
    vow: '誓言', promise: '承诺', threat: '威胁',
    self_restriction: '自我限制', goal: '目标', debt: '欠债', prophecy: '预言',
  };
  const activeCommitments = (state.activeCommitments ?? []).filter(
    (c) => c.status === 'active',
  );
  if (activeCommitments.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    result['角色承诺/Flag'] = activeCommitments.slice(0, 10).map((c) => {
      const entry: Record<string, unknown> = {
        角色: charNameMap.get(c.characterId) ?? c.characterId,
        类型: COMMIT_TYPE_LABEL[c.type] ?? c.type,
        内容: c.content,
        紧迫度: c.urgency,
        立下章节: c.seededAtChapter,
      };
      if (c.targetCharacterId) entry['对象'] = charNameMap.get(c.targetCharacterId) ?? c.targetCharacterId;
      if (c.deadline) entry['期限'] = c.deadline;
      return entry;
    });
  }

  const recentPhrases = state.recentDistinctivePhrases ?? [];
  if (recentPhrases.length > 0) {
    result['禁止重复使用的近期表达'] = recentPhrases.slice(-20);
  }

  return result;
}

/**
 * Prose-style context builder — same data as buildCompactContext but ~40% fewer tokens.
 * Uses natural language + condensed notation instead of verbose JSON.
 */
export function buildCompactContextProse(
  state: StoryState,
  options: CompactContextV2Options = {},
): string {
  const limits = {
    maxCharacters: options.maxCharacters ?? 10,
    maxChapterSummaries: options.maxChapterSummaries ?? 6,
    maxOpenThreads: options.maxOpenThreads ?? 10,
    maxTimelineEvents: options.maxTimelineEvents ?? 15,
  };

  const chapterNumber = state.chapterCursor;
  const lines: string[] = [];

  const totalEst = state.roughOutline.estimatedTotalChapters ?? 600;
  const progress = ((chapterNumber / totalEst) * 100).toFixed(1);
  const totalWords = state.seed.targetChapterWordCount ?? 3000;

  lines.push(`=== 基本信息 ===`);
  lines.push(`书名：${state.seed.title}｜类型：${state.seed.genre}｜读者：${state.seed.targetAudience}`);
  lines.push(`当前第${chapterNumber}章（计划${totalEst}章，进度${progress}%，每章约${totalWords}字）`);
  lines.push(`梗概：${state.seed.logline}`);
  lines.push(`核心冲突：${state.seed.coreConflictDirection}`);
  if (state.seed.redLines?.length) lines.push(`红线：${state.seed.redLines.join('；')}`);

  if (state.bible) {
    lines.push(`\n=== 故事圣经 ===`);
    lines.push(`世界规则：${state.bible.worldRules.join('；')}`);
    if (state.bible.mainConflict) lines.push(`核心冲突：${state.bible.mainConflict}`);
    if (state.bible.powerSystem?.length) {
      lines.push(`力量体系：${state.bible.powerSystem.map((l) => `${l.levelName}(${l.levelRank})`).join(' → ')}`);
    }
    if (state.bible.redLines?.length) lines.push(`红线：${state.bible.redLines.join('；')}`);
  }

  lines.push(`\n=== 连续性记忆 ===`);
  if (state.lastHook) lines.push(`上一章钩子：${state.lastHook}`);
  const recentSummaries = state.chapterSummaries.slice(-limits.maxChapterSummaries);
  if (recentSummaries.length > 0) {
    lines.push(`近期章节：`);
    recentSummaries.forEach((s) => lines.push(`  [第${s.chapterNumber}章] ${s.summary}`));
  }

  const blockedIds = new Set(
    state.characters
      .filter((c) => {
        const lc = c.status.lifecycleStatus ?? 'active';
        const canRef = c.status.dormantReference ?? false;
        return ((lc === 'dead' || lc === 'exited') && !canRef) || (lc === 'dormant' && !canRef);
      })
      .map((c) => c.name),
  );
  const foreshadowOnly = state.characters
    .filter((c) => {
      const lc = c.status.lifecycleStatus ?? 'active';
      const planned = c.status.plannedReturnChapter ?? null;
      return lc === 'return_planned' && planned !== null && planned > chapterNumber;
    })
    .map((c) => c.name);

  const visibleCharacters = [...state.characters]
    .filter((c) => !blockedIds.has(c.name))
    .sort((a, b) => {
      const aLead = a.role === 'protagonist' ? 10 : 0;
      const bLead = b.role === 'protagonist' ? 10 : 0;
      return bLead - aLead || (b.status.lastSeenChapter ?? 0) - (a.status.lastSeenChapter ?? 0);
    })
    .slice(0, limits.maxCharacters);

  lines.push(`\n=== 角色表（${visibleCharacters.length}人） ===`);
  visibleCharacters.forEach((c) => {
    const tags: string[] = [];
    tags.push(ROLE_LABEL[c.role] ?? c.role);
    tags.push(LIFECYCLE_LABEL[c.status.lifecycleStatus ?? 'active']);
    if (c.personalityTags?.length) tags.push(c.personalityTags.join('/'));
    const p = c.profile;
    if (p) {
      if (p.age) tags.push(`${p.age}岁`);
      if (p.gender) tags.push(p.gender);
      if (p.facialFeatures) tags.push(`外貌:${p.facialFeatures}`);
      if (p.hairColor || p.hairStyle) tags.push(`发:${[p.hairColor, p.hairStyle].filter(Boolean).join(' ')}`);
      if (p.build) tags.push(`体型:${p.build}`);
      if (p.typicalOutfit) tags.push(`穿:${p.typicalOutfit}`);
      if (p.distinguishingMarks?.length) tags.push(`标志:${p.distinguishingMarks.join(',')}`);
      if (p.abilities?.length) tags.push(`能力:${p.abilities.map((a) => `${a.name}(${a.level})`).join(',')}`);
      if (p.coreContradiction) tags.push(`矛盾:${p.coreContradiction}`);
    }
    if (c.factionId) {
      const faction = (state.factions ?? []).find((f) => f.id === c.factionId);
      if (faction) tags.push(`势力:${faction.name}${c.factionRank ? '/' + c.factionRank : ''}`);
    }
    lines.push(`• ${c.name}${c.aliases?.length ? '(' + c.aliases.join('/') + ')' : ''} — ${tags.join('，')}${c.status.state ? '。当前：' + c.status.state : ''}`);
  });

  if (blockedIds.size > 0) lines.push(`禁止出场：${[...blockedIds].join('、')}`);
  if (foreshadowOnly.length > 0) lines.push(`仅可伏笔提及：${foreshadowOnly.join('、')}`);

  const plotThreadLedger = state.plotThreadLedger ?? [];
  const openThreads = plotThreadLedger
    .filter((t) => t.status === 'open')
    .sort((a, b) => b.lastTouchedChapter - a.lastTouchedChapter)
    .slice(0, limits.maxOpenThreads);

  if (openThreads.length > 0) {
    lines.push(`\n=== 开放伏线（${openThreads.length}条） ===`);
    openThreads.forEach((t) => {
      const overdue = t.plannedPayoffEndChapter && chapterNumber > t.plannedPayoffEndChapter;
      lines.push(`• ${t.label}（设于第${t.setupChapter}章，最近第${t.lastTouchedChapter}章）${overdue ? '⚠️逾期！' : ''}`);
    });
  }

  const timelineEvents = state.timelineEvents ?? [];
  const recentEvents = [...timelineEvents]
    .sort((a, b) => a.chapterNumber === b.chapterNumber ? b.sequence - a.sequence : b.chapterNumber - a.chapterNumber)
    .slice(0, limits.maxTimelineEvents);

  if (recentEvents.length > 0) {
    lines.push(`\n=== 近期事件 ===`);
    recentEvents.forEach((e) => lines.push(`[第${e.chapterNumber}章] ${e.title}：${e.summary}`));
  }

  if (state.locations.length > 0) {
    lines.push(`\n=== 地点表 ===`);
    state.locations.slice(0, 12).forEach((l) => {
      const details: string[] = [l.description];
      const p = l.profile;
      if (p) {
        if (p.terrain) details.push(`地形:${p.terrain}`);
        if (p.climate) details.push(`气候:${p.climate}`);
        if (p.sensoryDetails?.atmosphere) details.push(`氛围:${p.sensoryDetails.atmosphere}`);
      }
      lines.push(`• ${l.name} — ${details.join('，')}`);
    });
  }

  if (state.items.length > 0) {
    lines.push(`\n=== 道具表 ===`);
    state.items.slice(0, 10).forEach((item) => {
      const ownerChar = state.characters.find((c) => c.id === item.ownerId);
      lines.push(`• ${item.name}（持有者:${ownerChar?.name ?? item.ownerId}）— ${item.effect}`);
    });
  }

  if (state.storyClock) {
    const SEASON = { spring: '春', summer: '夏', autumn: '秋', winter: '冬', unknown: '未知' } as Record<string, string>;
    const TOD = {
      dawn: '黎明', morning: '上午', noon: '正午', afternoon: '下午',
      dusk: '黄昏', evening: '傍晚', night: '夜晚', late_night: '深夜',
    } as Record<string, string>;
    lines.push(`\n=== 故事时间 ===`);
    lines.push(`第${state.storyClock.currentDay}天，${TOD[state.storyClock.currentTimeOfDay] ?? state.storyClock.currentTimeOfDay}，${SEASON[state.storyClock.season] ?? state.storyClock.season}季`);
  }

  if (state.lastSceneSnapshot) {
    const ss = state.lastSceneSnapshot;
    const presentNames = ss.presentCharacterIds
      .map((id) => state.characters.find((c) => c.id === id)?.name ?? id)
      .join('、');
    lines.push(`\n=== 上章结束场景 ===`);
    lines.push(`地点：${ss.locationName ?? ss.locationId ?? '未知'}，时间：${ss.timeOfDay ?? '未知'}，天气：${ss.weather ?? '未知'}`);
    lines.push(`在场：${presentNames}`);
    if (ss.ongoingAction) lines.push(`正在发生：${ss.ongoingAction}`);
    if (ss.emotionalTone) lines.push(`氛围：${ss.emotionalTone}`);
  }

  const addressMatrix = state.addressMatrix ?? [];
  if (addressMatrix.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    lines.push(`\n=== 称呼矩阵 ===`);
    addressMatrix.slice(0, 30).forEach((a) => {
      lines.push(`${charNameMap.get(a.fromCharacterId) ?? a.fromCharacterId} → ${charNameMap.get(a.toCharacterId) ?? a.toCharacterId}：「${a.address}」`);
    });
  }

  if (state.goldenFinger) {
    const gf = state.goldenFinger;
    lines.push(`\n=== 金手指 ===`);
    lines.push(`${gf.name}：${gf.concept}（当前阶段：${gf.currentStage}）`);
    if (gf.limitations?.length) lines.push(`限制：${gf.limitations.join('；')}`);
  }

  if (state.seed.readerPersona) {
    const rp = state.seed.readerPersona;
    lines.push(`\n=== 读者画像 ===`);
    lines.push(`核心幻想：${rp.coreFantasy}`);
    lines.push(`代入锚点：${rp.projectionAnchor}`);
    if (rp.triggerScenes?.length) lines.push(`触发场景：${rp.triggerScenes.join('；')}`);
    if (rp.emotionalNeeds?.length) lines.push(`情感需求：${rp.emotionalNeeds.join('；')}`);
  }

  if (state.currentArc) {
    const arc = state.currentArc;
    const currentBeat = arc.chapterBeats.find((b) => b.chapterNumber === chapterNumber);
    lines.push(`\n=== 当前卷 ===`);
    lines.push(`${arc.arcTitle}（第${arc.startChapter}-${arc.plannedEndChapter}章，高潮第${arc.climaxChapter}章）`);
    lines.push(`核心张力：${arc.coreTension}`);
    if (arc.emotionalTheme) lines.push(`情感主题：${arc.emotionalTheme}`);
    if (currentBeat) {
      const TENSION_MAP = { setup: '铺垫', escalation: '升级', twist: '转折', climax: '高潮', aftermath: '善后', transition: '过渡' } as Record<string, string>;
      const SAT_MAP = { none: '无', minor_payoff: '小爽', major_payoff: '大爽', emotional_peak: '情感高潮', relief: '喘息' } as Record<string, string>;
      lines.push(`本章节拍：${TENSION_MAP[currentBeat.role] ?? currentBeat.role}，张力${currentBeat.tensionLevel}/10，爽感${SAT_MAP[currentBeat.satisfactionType] ?? currentBeat.satisfactionType}`);
      lines.push(`目标：${currentBeat.briefGoal}`);
    }
  }

  if (state.styleAnchor) {
    const sa = state.styleAnchor;
    lines.push(`\n=== 文风锚点 ===`);
    lines.push(`腔调：${sa.narrativeVoice}，节奏：${sa.pacePreference}，对话风格：${sa.dialogueStyle}`);
    if (sa.pov) lines.push(`视角：${POV_LABEL[sa.pov] ?? sa.pov}${sa.povSwitchRules ? '，切换规则：' + sa.povSwitchRules : ''}`);
  }

  const factions = state.factions ?? [];
  if (factions.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    lines.push(`\n=== 势力表 ===`);
    factions.slice(0, 10).forEach((f) => {
      const FTYPE = { sect: '宗门', family: '家族', empire: '帝国', guild: '公会', army: '军队', corporation: '公司', tribe: '部落', other: '势力' } as Record<string, string>;
      const leader = f.leaderId ? charNameMap.get(f.leaderId) ?? f.leaderId : '无';
      lines.push(`• ${f.name}（${FTYPE[f.type] ?? f.type}，首领:${leader}）— ${f.description}`);
      if (f.hierarchy.length > 0) lines.push(`  等级：${f.hierarchy.join(' → ')}`);
      if (f.relations.length > 0) {
        const FREL = { alliance: '盟', rivalry: '敌', war: '战', subsidiary: '附', neutral: '中', trade: '商', vassal: '臣' } as Record<string, string>;
        const factionNameMap = new Map(factions.map((ff) => [ff.id, ff.name]));
        lines.push(`  关系：${f.relations.map((r) => `${factionNameMap.get(r.targetFactionId) ?? r.targetFactionId}[${FREL[r.relationType] ?? r.relationType}]`).join('，')}`);
      }
    });
  }

  const activeCommitments = (state.activeCommitments ?? []).filter((c) => c.status === 'active');
  if (activeCommitments.length > 0) {
    const charNameMap = new Map(state.characters.map((c) => [c.id, c.name]));
    const CTYPE = { vow: '誓', promise: '诺', threat: '胁', self_restriction: '戒', goal: '目标', debt: '债', prophecy: '谶' } as Record<string, string>;
    lines.push(`\n=== 角色承诺/Flag ===`);
    activeCommitments.slice(0, 10).forEach((c) => {
      const target = c.targetCharacterId ? ` → ${charNameMap.get(c.targetCharacterId) ?? c.targetCharacterId}` : '';
      lines.push(`• ${charNameMap.get(c.characterId) ?? c.characterId}[${CTYPE[c.type] ?? c.type}${target}]：${c.content}（紧迫度:${c.urgency}）`);
    });
  }

  const recentPhrases = state.recentDistinctivePhrases ?? [];
  if (recentPhrases.length > 0) {
    lines.push(`\n=== 禁用表达（本章不得使用） ===`);
    lines.push(recentPhrases.slice(-20).join('、'));
  }

  return lines.join('\n');
}

const ROLE_LABEL_ARC: Record<string, string> = {
  setup: '铺垫',
  escalation: '升级',
  twist: '转折',
  climax: '高潮',
  aftermath: '善后',
  transition: '过渡',
};

const SATISFACTION_LABEL: Record<string, string> = {
  none: '无',
  minor_payoff: '小爽点',
  major_payoff: '大爽点',
  emotional_peak: '情感高潮',
  relief: '喘息',
};

export function buildArcContext(arc: MiniArc, currentChapter: number): Record<string, unknown> {
  const currentBeat = arc.chapterBeats.find((b) => b.chapterNumber === currentChapter);
  const remainingBeats = arc.chapterBeats
    .filter((b) => b.chapterNumber >= currentChapter)
    .slice(0, 5);

  return {
    卷标题: arc.arcTitle,
    卷类型: arc.arcType,
    触发理由: arc.triggerReason || '未指定',
    入场条件: arc.entryCondition || '未指定',
    出场条件: arc.exitCondition || '未指定',
    核心张力: arc.coreTension,
    情感主题: arc.emotionalTheme || '未指定',
    必回收伏线: arc.mustPayoffThreadIds ?? [],
    收益代价: arc.rewardLossLedger ?? { expectedGains: [], expectedCosts: [], irreversibleChanges: [] },
    反派里程碑: arc.antagonistMilestones ?? [],
    高潮章: arc.climaxChapter,
    当前进度: `第${currentChapter}章 / 计划${arc.startChapter}-${arc.plannedEndChapter}章`,
    本章节拍: currentBeat ? {
      角色: ROLE_LABEL_ARC[currentBeat.role] ?? currentBeat.role,
      张力等级: currentBeat.tensionLevel,
      目标: currentBeat.briefGoal,
      爽感类型: SATISFACTION_LABEL[currentBeat.satisfactionType] ?? currentBeat.satisfactionType,
    } : '无（超出当前卷计划范围）',
    后续节拍预览: remainingBeats.slice(1).map((b) => ({
      章: b.chapterNumber,
      角色: ROLE_LABEL_ARC[b.role] ?? b.role,
      张力: b.tensionLevel,
    })),
  };
}

const POV_LABEL: Record<string, string> = {
  first_person: '第一人称',
  third_person_limited: '第三人称限制视角',
  third_person_omniscient: '第三人称全知视角',
  multi_pov: '多视角切换',
};

export function buildStyleAnchorContext(anchor: StyleAnchor): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    叙事腔调: anchor.narrativeVoice,
    节奏偏好: anchor.pacePreference,
    对话风格: anchor.dialogueStyle,
    风格样本: anchor.sampleParagraphs,
    叙事视角: POV_LABEL[anchor.pov] ?? anchor.pov,
  };
  if (anchor.povSwitchRules) ctx['视角切换规则'] = anchor.povSwitchRules;
  return ctx;
}

const DENSITY_LABEL: Record<string, string> = { sparse: '疏朗', moderate: '适中', dense: '细密' };

/** 深层文风DNA注入 — 为写作Agent构建可操作的风格指令。 */
export function buildStyleDNA(anchor: StyleAnchor, sceneType?: string): string {
  const lines: string[] = ['=== 文风DNA（本书灵魂，严格遵循） ==='];
  lines.push(`腔调：${anchor.narrativeVoice}`);
  lines.push(`节奏：${anchor.pacePreference}，对话：${anchor.dialogueStyle}`);
  if (anchor.pov) lines.push(`视角：${POV_LABEL[anchor.pov] ?? anchor.pov}${anchor.povSwitchRules ? '，切换规则：' + anchor.povSwitchRules : ''}`);

  const tex = anchor.proseTexture;
  if (tex) {
    const texParts: string[] = [];
    if (tex.metaphorStyle) texParts.push(`修辞：${tex.metaphorStyle}`);
    if (tex.descriptionApproach) texParts.push(`描写：${tex.descriptionApproach}`);
    if (tex.emotionTechnique) texParts.push(`情绪：${tex.emotionTechnique}`);
    if (tex.transitionStyle) texParts.push(`过渡：${tex.transitionStyle}`);
    if (texParts.length > 0) lines.push(texParts.join('｜'));
  }

  const sig = anchor.signatureTechniques ?? [];
  if (sig.length > 0) {
    lines.push('招牌技法（本书特色，适当使用）：');
    sig.forEach((t) => lines.push(`  • ${t.name}：${t.description}${t.example ? '（如：' + t.example.slice(0, 80) + '）' : ''}`));
  }

  const rhythm = anchor.rhythmSignature;
  if (rhythm) {
    const rParts: string[] = [];
    if (rhythm.actionPace) rParts.push(`动作戏：${rhythm.actionPace}`);
    if (rhythm.quietPace) rParts.push(`文戏：${rhythm.quietPace}`);
    if (rParts.length > 0) lines.push(`节奏签名：${rParts.join('，')}`);
  }

  if (sceneType && anchor.proseDensityMap) {
    const dm = anchor.proseDensityMap;
    const densityKey = sceneType === 'action' ? dm.action : sceneType === 'dialogue_driven' ? dm.dialogue
      : sceneType === 'emotional' ? dm.emotion : sceneType === 'transition' ? dm.transition : dm.worldbuilding;
    if (densityKey) lines.push(`本场景描写密度：${DENSITY_LABEL[densityKey] ?? densityKey}`);
  }

  if (anchor.sampleParagraphs?.length) {
    lines.push('文风参考（模仿质感，不照抄）：');
    anchor.sampleParagraphs.slice(0, 2).forEach((p) => lines.push(`「${p.slice(0, 200)}」`));
  }

  const anti = anchor.antiPatterns ?? [];
  if (anti.length > 0) lines.push(`禁用表达（本书DNA禁止）：${anti.join('、')}`);

  return lines.join('\n');
}

export function buildIntentContext(intent: ChapterIntent): Record<string, unknown> {
  return {
    章节号: intent.chapterNumber,
    本章目标: intent.goals,
    情绪方向: intent.emotionDirection,
    钩子方向: intent.hookDirection,
    承接上章: intent.carryoverFromLastChapter,
    字数范围: `${intent.wordCountRange.min}-${intent.wordCountRange.max}`,
    伏线指引: {
      优先伏线: intent.threadGuidance.priorityThreadLabels,
      新坑上限: intent.threadGuidance.maxNewThreads,
      建议: intent.threadGuidance.advice,
    },
    角色弧线指引: {
      聚焦角色: intent.characterArcGuidance.focusCharacterIds,
      弧线提示: intent.characterArcGuidance.arcHints.map((h) => ({
        角色: h.characterName,
        提示: h.hint,
        优先级: h.priority,
      })),
      情绪逻辑备注: intent.characterArcGuidance.emotionalLogicNotes,
    },
  };
}

/**
 * Analyze character arc needs: identify flat characters, staleness, and emotional debt.
 * Returns structured data for IntentAgent to reason about.
 */
export function buildCharacterArcContext(state: StoryState): Record<string, unknown>[] {
  const chapterNumber = state.chapterCursor;
  const facts = state.characterFactLedger ?? [];
  const summaries = state.chapterSummaries;

  const activeChars = state.characters.filter((c) => {
    const lc = c.status.lifecycleStatus ?? 'active';
    return lc === 'active' || lc === 'return_planned';
  });

  return activeChars.map((c) => {
    const firstSeen = c.status.firstSeenChapter ?? 1;
    const lastSeen = c.status.lastSeenChapter ?? chapterNumber - 1;
    const chaptersSinceLastSeen = chapterNumber - lastSeen;
    const totalChaptersPresent = lastSeen - firstSeen + 1;

    const charFacts = facts.filter((f) => f.characterId === c.id && f.status !== 'deprecated');
    const characterizationDepth = charFacts.length;

    const recentSummariesMentioningChar = summaries
      .slice(-5)
      .filter((s) => s.summary.includes(c.name));

    const relationships = (state.relationGraph ?? []).filter(
      (r) => (r.fromCharacterId === c.id || r.toCharacterId === c.id) && r.status === 'active',
    );

    const warnings: string[] = [];

    if (c.role !== 'npc' && totalChaptersPresent >= 3 && characterizationDepth < 2) {
      warnings.push('角色扁平化：出场多章但缺乏深度刻画，需要展示内心世界');
    }
    if (c.role !== 'npc' && chaptersSinceLastSeen >= 3) {
      warnings.push(`角色遗忘：已 ${chaptersSinceLastSeen} 章未出场，需要回归或伏笔提及`);
    }
    if (c.role === 'protagonist' && recentSummariesMentioningChar.length >= 3) {
      const allFunctional = charFacts.every(
        (f) => f.category !== 'motivation' && f.category !== 'belief' && f.category !== 'secret',
      );
      if (allFunctional) {
        warnings.push('主角深度不足：缺少动机/信念/秘密类事实，需要心理描写');
      }
    }

    return {
      角色编号: c.id,
      姓名: c.name,
      角色定位: c.role,
      性格标签: c.personalityTags,
      出场章数: totalChaptersPresent,
      未出场章数: chaptersSinceLastSeen,
      刻画深度: characterizationDepth,
      关系数量: relationships.length,
      弧线预警: warnings.length > 0 ? warnings : undefined,
    };
  });
}

/** 为场景级写作构建深度角色声音矩阵 — 情绪调变 + 权力语态 + 叙事动作。 */
export function buildCharacterVoiceMatrix(state: StoryState, presentCharacterIds: string[]): string {
  const charMap = new Map(state.characters.map((c) => [c.id, c]));
  const lines: string[] = [];

  for (const id of presentCharacterIds) {
    const c = charMap.get(id);
    if (!c?.voice) continue;
    const v = c.voice;
    const parts: string[] = [`【${c.name}】${v.speechPattern}`];
    if (v.verbalTics?.length) parts.push(`口头禅：${v.verbalTics.join('/')}`);

    if (v.emotionalVoiceMap?.length) {
      const psych = c.psychology;
      const currentMood = psych?.currentMood ?? '平静';
      const relevant = v.emotionalVoiceMap.find((e) => currentMood.includes(e.emotion));
      if (relevant) parts.push(`[当前${relevant.emotion}]：${relevant.voiceShift}（保留：${relevant.corePreserved}）`);
      else parts.push(`情绪调变：${v.emotionalVoiceMap.map((e) => `${e.emotion}→${e.voiceShift.slice(0, 20)}`).join('；')}`);
    }

    const pdv = v.powerDynamicVoice;
    if (pdv && (pdv.toSuperior || pdv.toEqual || pdv.toInferior || pdv.toEnemy)) {
      const pdParts: string[] = [];
      if (pdv.toSuperior) pdParts.push(`↑上级：${pdv.toSuperior}`);
      if (pdv.toEqual) pdParts.push(`=同辈：${pdv.toEqual}`);
      if (pdv.toInferior) pdParts.push(`↓下位：${pdv.toInferior}`);
      if (pdv.toEnemy) pdParts.push(`⚔敌人：${pdv.toEnemy}`);
      parts.push(`权力语态：${pdParts.join('，')}`);
    }

    const na = v.narrativeActions;
    if (na) {
      if (na.signatureGestures?.length) parts.push(`招牌动作：${na.signatureGestures.join('、')}`);
      if (na.physicalTics?.length) parts.push(`下意识：${na.physicalTics.join('、')}`);
      if (na.thoughtPatterns) parts.push(`内心戏：${na.thoughtPatterns}`);
    }

    if (v.catchphrases?.length) parts.push(`经典语录：${v.catchphrases.map((p) => `"${p}"`).join(' ')}`);
    if (v.voiceEvolution?.length) {
      const latest = v.voiceEvolution[v.voiceEvolution.length - 1];
      parts.push(`声音进化(ch${latest.chapterNumber})：${latest.change}`);
    }

    lines.push(parts.join('\n  '));
  }
  return lines.length > 0 ? `=== 角色声音DNA（遮住名字能猜出是谁） ===\n${lines.join('\n')}` : '';
}

export function buildKpiTrendHints(state: StoryState): string[] {
  const recent = state.kpiHistory.slice(-5);
  if (recent.length < 2) return [];

  const hints: string[] = [];
  const scores = recent.map((k) => k.qualityScore);
  const overall = recent.map((k) => k.overallScore);

  const declining = (arr: number[]) =>
    arr.length >= 3 && arr[arr.length - 1] < arr[arr.length - 2] && arr[arr.length - 2] < arr[arr.length - 3];

  if (declining(scores)) {
    hints.push(`【质量预警】近三章质量分持续下滑(${scores.slice(-3).join('→')})，注意段落信息密度和句式多样性。`);
  }
  if (declining(overall)) {
    hints.push(`【留存预警】近三章读者评分持续下滑(${overall.slice(-3).join('→')})，强化钩子和冲突升级。`);
  }

  const avgQuality = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avgQuality < 6.5) {
    hints.push(`【整体质量偏低】近期平均质量分 ${avgQuality.toFixed(1)}，提升对话辨识度和动作描写精度。`);
  }

  return hints;
}

/** 从累积写作教训中构建写作指导片段 — 优先注入高置信度+与当前场景相关的教训。 */
export function buildWritingLessonsHint(lessons: WritingLesson[], relevantCategories?: string[]): string {
  if (!lessons.length) return '';
  const sorted = [...lessons].sort((a, b) => {
    const conf = { strong: 3, confirmed: 2, tentative: 1 };
    return (conf[b.confidence] ?? 0) - (conf[a.confidence] ?? 0);
  });
  const filtered = relevantCategories
    ? sorted.filter((l) => relevantCategories.includes(l.category))
    : sorted;
  const top = filtered.slice(0, 8);
  if (!top.length) return '';
  const lines = ['=== 写作教训（从历史数据中学到的）==='];
  for (const l of top) {
    const tag = l.confidence === 'strong' ? '★' : l.confidence === 'confirmed' ? '●' : '○';
    lines.push(`${tag} [${l.category}] ${l.actionable}`);
  }
  return lines.join('\n');
}
