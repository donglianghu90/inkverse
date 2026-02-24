/**
 * V2 提示词片段与上下文构建器。
 * 设计目标：给予写作自由度，减少机械约束，保留质量底线。
 */
import {
  StoryStateV2,
  ChapterIntent,
  StorySeed,
  RoughOutline,
  CrystallizedBible,
  MiniArc,
  MiniArcChapterBeat,
  StyleAnchor,
} from '../schemas/novel-v2.schemas';

// ---------------------------------------------------------------------------
// Core playbooks — shared across agents
// ---------------------------------------------------------------------------

export const WRITING_SOUL_PLAYBOOK = `写作灵魂准则：
1) 所有正文必须使用简体中文。
2) 禁止输出任何"作为人工智能"之类元叙述。
3) 角色的行为必须从人物性格中自然流出，不得被剧情强行驱动。
4) 允许在写作过程中产生计划外的灵感——好的意外比严格执行计划更重要。`;

export const PROSE_CRAFT_PLAYBOOK = `
【展示而非讲述——这是区分好文和平庸的唯一最大因素】

坏："他非常愤怒。"
好："他的拳头攥紧，指节发白，牙关咬得咯咯作响。"

坏："她很伤心，眼泪流了下来。"
好："她背过身去，肩膀细微地抖了一下。半晌，才用手背快速抹了一下眼角，声音却稳得不自然：'我没事。'"

坏："这个地方很危险。"
好："地面上散落着半截生锈的刀刃，空气中弥漫着铁锈和腐肉混合的气味。远处有什么东西发出低沉的、像是在磨牙的声响。"

坏："他很强大，众人都很震惊。"
好："剑气横扫，三丈之内的碎石腾空而起。内门弟子们几乎同时后退了一步，有人的杯子'啪'地碎在地上，却没有人低头去看。"

规则：每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。

【对白技法——对话是网文的灵魂】

坏（信息传递式对白）：
"这是我从城外带回来的情报，敌人有三千人，预计明天到达。"

好（有性格、有潜台词的对白）：
"城外那帮孙子，"李二狗把一张皱巴巴的纸拍在桌上，"三千多号人，最迟明儿个就到。"他顿了顿，"你猜他们先头部队是谁带的？"

坏（角色说话方式相同）：
张三说："我们应该马上出发。"
李四说："我认为你说得对，我们不应该再等了。"

好（性格可区分）：
张三把剑往桌上一拍："走！"
李四推了推眼镜，慢条斯理道："急什么，我算过了，巳时出发和卯时出发，到虎牢关的时间只差半炷香。不如等我把饭吃完。"

规则：
- 对白要有潜台词——角色说的和想的不一定一样。
- 每句对话至少完成两个任务：推进剧情+展示性格，或者传递信息+制造冲突。
- 避免"直球式信息传递"——没有人说话像在念报告。
- 对白标签要变化："说"只占对话标签的一半，其余用动作代替（他攥着杯子、她偏过头、他嗤笑一声）。
- 允许打断、省略、突然转移话题——真实对话不是轮流发言。

【句式节奏——像音乐一样有起伏】

坏（句式单一）：
他走进了房间。他看到了桌上的信。他拿起了信。他打开了信。他的脸色变了。

好（长短交替，形成节奏）：
他推开门。
房间里比他预想的要暗得多，窗帘被人从里面拉上了，只在角落漏出一线发黄的光。桌上放着什么东西——不是他期待的酒壶，而是一封信，信封上没有署名，只用朱砂画了一个他再熟悉不过的符号。
他的手停在半空中。

规则：
- 紧张时刻用短句。平静时刻用长句。
- 一段之内，避免连续三个句子以同样的方式开头（"他……他……他……"）。
- 重要信息出现前，放一个短段或一句话单独成段——制造视觉停顿。
- 战斗场景：短句+断句+画面感。日常场景：长句+细节+氛围。

【杀死AI味——让读者分不出是人还是AI写的】

以下表达在本章中每个最多出现一次（超出则是AI味）：
- "不由得"、"心中一凛"、"眼中闪过"
- "与此同时"、"值得一提"、"总而言之"
- "仿佛"连续出现超过2次
- "他/她深吸一口气"
- "空气仿佛凝固"
- "嘴角微微上扬"

替代方案：
- 不要写"他心中一惊"→ 写具体反应（筷子从手中滑落、脚步顿了一下、瞳孔骤缩）
- 不要写"她很美"→ 写旁人的反应（酒楼掌柜多看了两眼、路人差点撞上柱子）
- 不要写"气氛很紧张"→ 写感官细节（安静到能听见自己咽口水的声音）
`;

export const CHAPTER_RHYTHM_V2_PLAYBOOK = `章节节奏准则：
1) 开场前两段必须承接上章的未决问题或钩子，避免跳场。
2) 中段持续推进：每个段落至少包含一个动作推进、关系变化或信息增量。
3) 尾段抛出未解决的强张力，让读者想看下一章。
4) 优先中短段落，保持高信息密度。
5) 避免连续三段使用相同句式开头。`;

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

export const FIRST_CHAPTERS_V2_PLAYBOOK = `首章特殊约束（仅适用于前 3 章）：
1) 第一章第一段必须在 100 字内建立核心冲突或吸引力场景。
2) 主角必须在前两章完成"性格锚点"展示。
3) 世界观差异自然嵌入，不得百科式铺陈。
4) 前三章每章钩子力度加倍。
5) 前三章不得出现超过 3 个非主线角色。`;

export const REVIEWER_RUBRIC_PLAYBOOK = `评审打分标尺（0-10）：
9-10：强烈追更欲，几乎无缺陷。
7-8：可追更，有少量可修复缺陷。
5-6：可读但平庸，影响留存。
0-4：重大缺陷，建议重修。`;

export const EDITOR_DISCIPLINE_PLAYBOOK = `编辑纪律：
1) 只修改审阅指出的具体问题，不做无关改写。
2) 保留已验证的事实与因果链。
3) 不得削弱已有强钩子，除非替换为更强钩子。
4) 修改的同时顺带提升文风，但不改变叙事结构。
5) 不得改动章号与章名，除非明确要求。`;

export const CHARACTER_ARC_PLAYBOOK = `角色弧线意识：
1) 角色不是剧情的道具。每个重要角色都有自己的欲望、恐惧和矛盾。
2) "扁平化警报"：如果一个角色连续多章只是功能性出场（传递信息、打配合），需要给他一个展现内心的时刻。
3) 成长不是线性的。角色可以两步前进一步后退：一个变勇敢的角色也可以突然怯懦，这恰恰让人物真实。
4) 关系是双向的。A对B的态度变化，同时应该影响B对A的反应。
5) 情绪逻辑是硬规则：角色的情绪反应必须和他刚经历的事件匹配。刚失去至亲不能下一段就谈笑风生，除非有明确的压抑/伪装理由。
6) 每隔 3-5 章，至少有一个角色需要经历一次小的"内心考验"——选择、妥协、发现、醒悟。`;

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

export function buildCompactContextV2(
  state: StoryStateV2,
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
 * Prose-style context builder — same data as buildCompactContextV2 but ~40% fewer tokens.
 * Uses natural language + condensed notation instead of verbose JSON.
 */
export function buildCompactContextProse(
  state: StoryStateV2,
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
    核心张力: arc.coreTension,
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
export function buildCharacterArcContext(state: StoryStateV2): Record<string, unknown>[] {
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

export function buildKpiTrendHintsV2(state: StoryStateV2): string[] {
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
