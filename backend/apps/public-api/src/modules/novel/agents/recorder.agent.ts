/**
 * 记录员角色（步骤 5）：
 * 从最终章节中被动提取：
 * - 新出现的角色/地点/道具（世界发现）
 * - 已有角色的状态变更
 * - 伏线开合变化
 * - 关系/时间线/事实增量
 * - 章节摘要
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import {
  StoryStateV2,
  MaintenanceState,
} from '../schemas/novel-v2.schemas';
import {
  ChapterDraft,
  LoreRecord,
  loreRecordSchema,
} from '../schemas/novel.schemas';
import {
  CONTINUITY_BASELINE_PLAYBOOK,
  THREAD_AWARENESS_PLAYBOOK,
  buildCompactContextV2,
} from '../prompting/novel-playbook-v2';

@Injectable()
export class RecorderAgent {
  constructor(private readonly llm: LlmService) {}

  async record(
    state: StoryStateV2,
    draft: ChapterDraft,
  ): Promise<LoreRecord> {
    const context = buildCompactContextV2(state, {
      maxCharacters: 10,
      maxChapterSummaries: 5,
      maxOpenThreads: 12,
      maxTimelineEvents: 15,
    });

    const existingCharacterIds = state.characters.map((c) => c.id);
    const existingCharacterNames = state.characters.map((c) => c.name);
    const existingLocationIds = state.locations.map((l) => l.id);
    const existingItemIds = state.items.map((i) => i.id);

    return this.llm.generateStructured({
      taskName: 'chapter-recorder',
      schema: loreRecordSchema,
      tags: ['workflow', 'chapter', 'record'],
      metadata: {
        bookId: state.bookId,
        chapterNumber: draft.chapterNumber,
      },
      systemPrompt: `你是设定记录官。
请从刚写完的章节中提取客观事实变更。你是被动记录，不是主动创造。

关键职责：

一、世界发现（最重要）
正文中出现了上下文角色表里不存在的新角色、新地点或新道具时，必须在对应字段中注册：
- newCharacters: 新角色（必须有 id、name、role、archetype、personalityTags）
  - id 格式："char_" + 角色名拼音或简称（如 char_laowang）
  - role: 判断角色在故事中的定位（protagonist/supporting/villain/npc）
  - 只注册在正文中有实际动作或对白的角色，路人甲不注册
  - nameOrigin: 名字的由来或含义（如果正文有提及）
  - age: 年龄或年龄描述（如"十七岁少年"、"中年"）
  - gender: 性别
  - appearance: 从正文提取的外貌一句话描述（如"一头银白长发，肤色苍白，身材瘦高"）
  - outfit: 首次出场的服饰描述（如"一袭黑色长袍，腰佩青铜古剑"）
  - ability: 首次展现的能力（如"会使用火系法术"）
- newLocations: 新地点
  - id 格式："loc_" + 地名拼音或简称
- newItems: 新道具/物品
  - id 格式："item_" + 物品拼音或简称

二、已有角色状态更新
- characterLifecycleDeltas: 已有角色的位置、状态、等级、持有物、生命周期变化
- 只更新已有角色（编号在上下文角色表中的角色）
- 不要为新角色写 lifecycleDelta（新角色用 newCharacters 注册）

三、角色档案提取（极其重要——角色一致性的基础）
- characterProfileDeltas: 从正文中提取角色的外貌/能力/成长等细节
- field 类型说明：
  - "appearance"：外貌描写（肤色、五官、身高、体型、发型、发色、瞳色、标志性特征）
  - "outfit"：服饰变化（新衣服、装备、造型变化）
  - "hairstyle"：发型变化
  - "ability_gain"：获得新能力/技能
  - "ability_upgrade"：已有能力升级/突破
  - "injury"：受伤/伤疤（影响外貌的持久变化）
  - "personality_shift"：性格变化（经历事件后的成长/转变）
  - "hobby_discovered"：发现新爱好/习惯
  - "backstory_revealed"：背景故事揭露（过去的经历/出身）
- description: 具体描述（从正文中提炼，用简洁但具体的中文）
  - 好的：「一头银白色的及肩长发，左眼下方有一颗小痣」
  - 差的：「很帅」
- isChange: 这是一个变化（true=角色的某个方面发生了改变）还是首次描述（false=首次记录这个信息）
- 规则：
  - 首次出场的角色：提取所有能从正文中找到的外貌/服饰/年龄信息
  - 已有角色：只记录本章新增的细节或变化（不要重复已知信息）
  - 每个角色每章最多 3 个 profileDelta（只提取正文中明确描写的）
  - 新角色的外貌必须从 newCharacters 的 appearance 字段和 profileDeltas 双重记录

三b、角色声音提取（重要）
- characterVoiceDeltas: 提取角色在本章中最有辨识度的对白
- sampleDialogue: 一句完整的、最能体现该角色说话风格的原文对白
- speechPatternNote: 简短描述此角色说话特点（如"反问句多"、"语气轻佻"、"军人式简洁"）
- verbalTic: 口头禅或习惯用语（如果有的话）
- 每章最多提取 2-3 个角色的声音样本（选最有特色的）
- 只提取在本章中有实际对白的角色

四、读者悬念追踪（重要）
- curiosityDeltas: 记录本章中对读者悬念的变化
- "seed"：正文中抛出了一个读者会好奇的新问题/新谜团
  - 必须提供 question（读者心中的问题，如"主角的身世到底是什么？"）
  - curiosityId 格式：cur_ + 简短关键词（如 cur_shenshin）
- "tease"：对一个已有悬念进行了提示/暗示但没完全揭晓
  - curiosityId 引用上下文中已有的悬念 ID
- "payoff"：一个悬念被回答/揭晓了
  - satisfactionType: full_answer=完全回答, partial_reveal=部分揭露, twist=反转, subversion=颠覆
- 每章通常有 0-3 个 curiosityDeltas
- 不要把角色动机当悬念——只记录读者视角的"想知道但还不知道"

五、信息差追踪（极其重要——上瘾的秘密武器）
- informationGapDeltas: 追踪"谁知道什么秘密"
- "create"：本章中产生了一个角色之间或角色与读者之间的信息不对称
  - gapId 格式：gap_ + 关键词
  - secret: 具体的秘密内容
  - knownBy: 知道这个秘密的角色ID列表（加 "reader" 如果读者也知道）
  - unknownTo: 不知道的角色ID列表（加 "reader" 如果读者不知道）
  - type: dramatic_irony=读者知道角色不知道, mystery=读者和角色都不知道,
    betrayal_setup=某角色暗中背叛, hidden_identity=身份隐瞒,
    secret_plan=密谋, misunderstanding=误解
  - dramaticPotential: 这个信息差揭晓时的戏剧冲击力
- "reveal"：一个信息差被消除了（某人知道了真相）
- "expand"：信息差扩大了（更多人卷入这个秘密，或秘密变得更严重）

六、爽感事件标记（重要）
- satisfactionEvents: 标记本章中让读者"爽"的时刻
- type: face_slap=打脸, power_reveal=亮底牌, breakthrough=突破,
  mystery_reveal=揭秘, revenge=复仇, reunion=重逢,
  treasure=收获, recognition=获认可, emotional_catharsis=情感宣泄
- intensity: minor=小爽, medium=中爽, major=大爽, climactic=高潮级爽
- scale: 爽感的影响规模——极其重要！
  - personal=个人层面（自己变强、个人恩怨）
  - group=小团体（在一群人面前证明自己）
  - faction=势力级（在整个宗门/组织面前震惊众人）
  - regional=区域级（在一个城市/区域扬名）
  - national=国级（震动一个国家/大势力）
  - continental=大陆级（名震大陆）
  - world=世界级（影响整个世界）
- audienceImpact: 可选，这个爽点对旁观者/围观者的影响描述
- 如果本章没有爽点也正常（铺垫章可以没有），不要硬凑

七、伏笔回溯机会（如果发现的话）
- foreshadowingOpportunities: 如果本章发生了一个重要的揭晓/转折，检查是否有机会在更早的章节中添加暗示
- 例如：本章揭示"张三是卧底"，建议在第3章张三第一次出场时加一个可疑的细节
- targetChapterNumber: 建议在哪一章插入伏笔
- suggestedContent: 建议插入的具体文字（一句话）
- insertAfterParagraph: 建议在第几段之后插入（0=最开头）
- reason: 为什么这个伏笔能让读者回味
- 每章最多 0-1 个回溯建议，不是每章都需要

八、时间追踪
- timeDelta: 记录本章中时间的流逝
  - daysElapsed: 本章叙事中经过了多少天（0=同一天内, 1=第二天, 等等）
  - endTimeOfDay: 本章结束时的时间段（dawn/morning/noon/afternoon/dusk/evening/night/late_night）
  - seasonChange: 如果本章中季节发生了变化
  - calendarNote: 如果正文提到具体日期/节日/纪年

九、称呼记录
- addressDeltas: 记录角色之间的称呼方式
- 只记录首次出现的称呼或称呼变化（如从"陌生人"变成"师兄"）
- address: 实际使用的称呼（如"老头子"、"师尊"、"小子"）
- 不要编造——只记录正文中角色实际说出的称呼

十、场景快照
- sceneSnapshot: 本章结束时的物理现场状态
  - locationId/locationName: 最后一个场景的地点
  - timeOfDay: 结束时的时间
  - weather: 天气状况
  - presentCharacterIds: 最后一个场景中在场的角色
  - ongoingAction: 正在发生什么（如"众人围着篝火休息"）
  - emotionalTone: 情绪氛围

十一、地点/道具细节
- locationProfileDeltas: 从正文中提取地点的新细节（地形、气候、感官、建筑、文化、历史、连接关系）
- itemProfileDeltas: 从正文中提取道具的新细节（外观、来历、限制、进化）
- 只记录正文中实际描写了的——不要编造

十二、势力/组织追踪（极其重要——世界社会结构的骨架）
- factionDeltas: 追踪宗门/家族/帝国/公会等组织的变化
- "create"：正文中出现了新的组织/势力
  - factionId 格式：fac_ + 名称简写
  - factionName：势力名称
  - factionType：sect(宗门)/family(家族)/empire(帝国)/guild(公会)/army(军队)/corporation(公司)/tribe(部落)/other
  - description：简短描述
- "member_join"：角色加入了某组织
  - characterId：角色编号
  - rank：在组织中的等级/头衔
- "member_leave"：角色离开/被逐出某组织
- "rank_change"：角色在组织内的等级变化（升职/降级）
- "relation_change"：两个势力之间的关系变化
  - targetFactionId：对方势力编号
  - relationType：alliance(结盟)/rivalry(敌对)/war(交战)/subsidiary(附属)/neutral(中立)/trade(贸易)/vassal(臣属)
  - relationStrength：-10 到 10
- "update"：势力信息更新（如门规、领地变化等）
- 规则：只记录正文中明确提及的势力信息，不要推测

十三、角色承诺/Flag 追踪（极其重要——防止角色"健忘"）
- commitmentDeltas: 追踪角色立下的誓言、承诺、威胁、自我限制
- "create"：角色在正文中立下了新的承诺/flag
  - commitmentId 格式：cmt_ + 关键词
  - characterId：谁立的
  - type: vow(誓言)/promise(承诺)/threat(威胁)/self_restriction(自我限制)/goal(目标)/debt(欠债)/prophecy(预言)
  - content：承诺的具体内容（原文概括）
  - targetCharacterId：对谁立的（如果有）
  - deadline：时间期限（如果提到，如"三年后"、"比武大会之前"）
- "fulfill"：一个承诺被兑现了
- "break"：一个承诺被打破了（重要的戏剧时刻！）
- "progress"：向承诺迈进了一步
- "expire"：承诺因故失效（比如目标人死了）
- 注意：
  - "我要变强"不算承诺（太模糊），"我要在比武大会上打败师兄"才算
  - "三年后我回来找你"必须记录 deadline
  - 角色的核心目标（如"为父报仇"）是最重要的承诺
  - 每章最多 2 个新 commitment（只提取明确的）

十四、反重复短语提取
- 注意正文中出现的特别有辨识度的表达方式（比喻、动作描写、神态描写）
- 如果某些表达和上下文中"禁止重复使用的近期表达"列表中的措辞高度相似，这是一个问题，请标注

十五、伏线/关系/事件/事实记录（同之前）

${CONTINUITY_BASELINE_PLAYBOOK}

${THREAD_AWARENESS_PLAYBOOK}`,
      userPrompt: `章节前故事状态：
${JSON.stringify(context, null, 2)}

已有角色编号列表：${JSON.stringify(existingCharacterIds)}
已有角色姓名列表：${JSON.stringify(existingCharacterNames)}
已有地点编号列表：${JSON.stringify(existingLocationIds)}
已有道具编号列表：${JSON.stringify(existingItemIds)}

本章正文：
章节号：${draft.chapterNumber}
标题：${draft.title}
正文：
${draft.content}

记录规则：
- 新角色：正文中出现了不在「已有角色姓名列表」中的角色，且该角色有动作或对白，必须写入 newCharacters。
- 新地点：正文中出现了不在「已有地点编号列表」中的新场所，必须写入 newLocations。
- 新道具：正文中出现了不在「已有道具编号列表」中的新物品/武器/道具，必须写入 newItems。
- 伏线标签必须具体且稳定。若已有同名伏线，复用 threadId。
- 人设事实写入 characterFactDeltas，新角色的事实也要写（用新角色的 id）。
- 弱证据事实 confidence 低于 0.65。
- 别名变化写入 characterAliasDeltas。
- 角色档案：提取正文中对角色外貌、服饰、能力的具体描写，写入 characterProfileDeltas。新角色必须提取首次外貌描写。
- 角色声音：选取本章中 2-3 个最有辨识度的角色对白写入 characterVoiceDeltas。
- 势力/组织：正文中出现的组织/团体写入 factionDeltas。角色加入/离开/晋升组织也要记录。
- 角色承诺：角色立下的承诺、誓言、威胁等写入 commitmentDeltas。承诺兑现或打破也必须记录。
- 关系增量含双方角色编号、类型、强度。新角色与已有角色之间的关系也要写。
- 时间线事件含标题、摘要、涉及角色编号。
- 摘要必须简洁客观，禁止赞美性语言。
- 爽感事件（satisfactionEvents）：识别本章中让读者感到"爽"的时刻。本书可用的爽感类型：
${state.bookPromptProfile.satisfactionTypes.map((s) => `  · ${s.id}（${s.label}）：${s.description}`).join('\n')}
- 钩子分类（hookClassification）：必须判定本章结尾钩子的类型。本书可用的钩子类型：
${state.bookPromptProfile.hookTypes.map((h) => `  · ${h.id}（${h.label}）：${h.description}`).join('\n')}`,
      temperature: 0.3,
    });
  }

  /**
   * Update maintenance counters based on lore record deltas.
   */
  updateMaintenanceCounters(
    current: MaintenanceState,
    lore: LoreRecord,
  ): MaintenanceState {
    const newCharacters = (lore.newCharacters ?? []).length;
    const newLocations = (lore.newLocations ?? []).length;
    const newThreads = lore.plotThreadDeltas.filter(
      (d) => d.action === 'open',
    ).length;
    const newFacts = (lore.characterFactDeltas ?? []).filter(
      (d) => d.action === 'add',
    ).length;

    return {
      ...current,
      newCharactersSinceLastMaintenance: current.newCharactersSinceLastMaintenance + newCharacters,
      newLocationsSinceLastMaintenance: current.newLocationsSinceLastMaintenance + newLocations,
      newThreadsSinceLastMaintenance: current.newThreadsSinceLastMaintenance + newThreads,
      newFactsSinceLastMaintenance: current.newFactsSinceLastMaintenance + newFacts,
    };
  }
}
