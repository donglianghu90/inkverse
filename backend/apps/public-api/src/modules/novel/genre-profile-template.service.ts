/** 题材 Profile 模板管理服务 — 用户私有模板 + 系统种子自动同步 + 增量更新 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@packages/modules';
import {
  GenreProfileTemplateEntity,
  SeedAnalyzerHints,
  CachedAgentSections,
  AudienceDirectiveMeta,
} from './entities/genre-profile-template.entity';
import { bookPromptProfileSchema, BookPromptProfile } from './schemas/novel-state.schemas';
import { LlmService } from './llm/llm.service';
import { PromptProfilerAgent } from './agents/prompt-profiler.agent';
import { formatProfileAsExample } from './prompting/reference-profiles';
import { buildDefaultRulePack } from './prompting/default-templates';
import { GENRE_AGENT_OVERRIDES } from './prompting/genre-agent-overrides';
import { XIANXIA_REFERENCE_PROFILE, ROMANCE_REFERENCE_PROFILE, MYSTERY_REFERENCE_PROFILE } from './prompting/reference-profiles';
import {
  URBAN_REFERENCE_PROFILE, HISTORICAL_REFERENCE_PROFILE, WESTERN_FANTASY_REFERENCE_PROFILE,
  SCI_FI_REFERENCE_PROFILE, WUXIA_REFERENCE_PROFILE, MILITARY_REFERENCE_PROFILE,
  HORROR_REFERENCE_PROFILE, SUPERNATURAL_REFERENCE_PROFILE, ADVENTURE_REFERENCE_PROFILE,
  GAME_REFERENCE_PROFILE, SPORTS_REFERENCE_PROFILE, SUPERPOWER_REFERENCE_PROFILE,
  EPIC_REFERENCE_PROFILE, FANTASY_ROMANCE_REFERENCE_PROFILE, CHILDREN_REFERENCE_PROFILE,
  XUANHUAN_REFERENCE_PROFILE, URBAN_ROMANCE_REFERENCE_PROFILE, ANCIENT_ROMANCE_REFERENCE_PROFILE,
  INFINITE_FLOW_REFERENCE_PROFILE, LIGHT_NOVEL_REFERENCE_PROFILE, POST_APOCALYPTIC_REFERENCE_PROFILE,
  SUSPENSE_THRILLER_REFERENCE_PROFILE, ESPORTS_REFERENCE_PROFILE, VRMMO_REFERENCE_PROFILE
} from './prompting/genre-reference-profiles';
import {
  URBAN_PLAYBOOKS, HISTORICAL_PLAYBOOKS, WUXIA_PLAYBOOKS, MILITARY_PLAYBOOKS,
  WESTERN_FANTASY_PLAYBOOKS, SCI_FI_PLAYBOOKS, HORROR_PLAYBOOKS, SUPERNATURAL_PLAYBOOKS,
  ADVENTURE_PLAYBOOKS, GAME_PLAYBOOKS, SPORTS_PLAYBOOKS, SUPERPOWER_PLAYBOOKS,
  EPIC_PLAYBOOKS, FANTASY_ROMANCE_PLAYBOOKS, CHILDREN_PLAYBOOKS,
} from './prompting/genre-playbook-seeds';
import { z } from 'zod';
import { RuleAtom, CATEGORY_TO_OUTPUT_KEY } from './schemas/rule-engine.schemas';
import { parsePlaybookTextToAtoms } from './prompting/default-rule-atoms';

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = normalizeJsonValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
  }
  return value;
}

function isSameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeJsonValue(a)) === JSON.stringify(normalizeJsonValue(b));
}

// ---------------------------------------------------------------------------
// 题材定制 Playbook — 全部 7 种规则按题材深度定制
// ---------------------------------------------------------------------------

const XIANXIA_PLAYBOOKS: Record<string, string> = {
  PROSE_CRAFT_PLAYBOOK: `【一、展示而非讲述】
规则：每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。
- ❌ "他心中一惊" → ✅ 手中灵剑嗡鸣，剑尖微偏了半寸
- ❌ "她很美" → ✅ 街边卖符篆的老修士下意识多看了两眼，手里画错了一笔
- ❌ "气氛很紧张" → ✅ 方圆十丈内的灵气骤然稀薄，像被一只无形的手攥住

【二、对白技法】
- 潜台词：修仙者身份差距越大，越不会直说。长老一句"你资质尚可"可能是极高评价。
- 每句对话至少完成两任务：推进剧情+展示修为/性格，或传递信息+制造冲突。
- 权力语态：大能用短句、陈述语气甚至沉默施压；低境说长句、试探语气、称呼恭敬。
- 宗门/势力用语要有辨识度——不同势力的口头禅和措辞习惯应有差异。
- 允许打断、沉默、以灵力传音替代开口——战斗中的对话要极简。

【三、句式节奏】
- 战斗/突破：短句+断句+画面感。灵力碰撞用通感（"像吞了一口沸水"而非"灵力激荡"）。
- 修炼/感悟：中长句+意象+内视。描写灵气运行要有体感而非数据。
- 日常互动：长句+细节+氛围。宗门日常让读者感受到"生活在这个世界"。
- 重要信息出现前放一个短段单独成段——制造视觉停顿。

【四、感官叠加——让读者"身临其境"】
- 每个重要场景至少调动两种感官。修仙世界独有感官：灵识扫描的"触感"、功法运行的体感、天材地宝的灵气波动。
- ❌ 他走进洞府 → ✅ 脚下踩到松软的灵草残叶，潮湿的灵气裹着一股甜腐的草药味涌来，洞壁上的照明石发出幽蓝微光，把他的影子拉得忽长忽短

【五、环境映射情绪——景随心动】
- 修仙世界的"景"更丰富：天象变化、灵气浓淡、灵兽反应都能映射角色心境。
- ❌ "他心情沉重" → ✅ "山间的雾不知何时浓了起来，连灵鹤都收了翅落在枝头不愿飞"

【六、留白术】
- "他望着那柄残剑很久，没有说话。"比200字心理描写更震撼。
- 突破/顿悟的关键瞬间用留白——让读者自己想象那种超越。

【七、多层次烘托——用不同修为层级的反应衬托关键时刻】
- 重大事件（突破/战斗/显露底牌）时，按修为层级递进写旁观者反应：
  低境弟子茫然不解→内门弟子震动→长老站起→太上长老睁眼/表情变化。
- 每一层反应要具体不同：有人手中玉简跌落、有人不自觉后退一步、有人站了起来、有人说不出话。
- 旁观者碎语（"这……怎么可能？""他什么时候……"）是读者获得爽感的重要通道。

【八、金句意识】
- 金句出现在关键转折：突破前、立誓时、生死抉择、多年后重逢。
- 好的金句：简短、有力、有态度、放在修炼语境下才有味道。

【九、杀死AI味】
以下表达每章最多出现一次：
"不由得""心中一凛""眼中闪过""与此同时""深吸一口气""空气仿佛凝固""嘴角微微上扬""不禁""缓缓开口""微微一笑""目光深邃""灵力波动""气息暴涨""浑身一震""瞳孔骤缩"
深层AI味：
- 角色对自己修为/情绪过于自知（"他意识到自己突破了"——真实修炼不会这么清醒）
- 战斗过于回合制（你一招我一招轮流来）
- 所有势力的反应都一样（"全场哗然"出现3次以上）
- 突破/战斗没有代价感`,

  CHARACTER_ARC_PLAYBOOK: `角色弧线意识（玄幻）：

矛盾内核：
- 每个重要角色都有一个不可调和的内在矛盾——想变强但惧怕失去人性，想守护所有人但力量不够，渴望自由却背负血脉宿命。
- 修仙者的矛盾比凡人更极端：寿命越长越孤独，实力越强越不敢信任。

成长规则：
1) 成长不是线性的。角色可以两步前进一步后退：突破后反而迷茫，得到力量后害怕代价。
2) 关系随修为变化。修为差距拉大后，曾经的同门/朋友关系会微妙变化。
3) 角色间的"化学反应"要有修仙世界特色——共患难、互为道侣、师徒传承、道不同的渐行渐远。

硬规则：
4) 情绪逻辑不可违反。刚经历生死大战不能下一段就心平气和地修炼，除非明确的压抑/伪装理由。
5) 境界提升应伴随心境变化——不只是战力数字变化，还有看世界的方式变了。
6) 重要角色应定期经历"心魔考验"——这是修仙世界最自然的内心戏窗口。`,

  WRITING_SOUL_PLAYBOOK: `写作灵魂准则（玄幻）：
1) 所有正文必须使用简体中文。禁止输出任何元叙述。
2) 代入感是命根子：写任何场景前先问"读者是代入主角的视角"，用主角的感官和认知水平去写——主角不知道的设定，不要上帝视角告知。
3) 情绪先行：先确定"读者读到这里应该是热血/紧张/期待/震撼中的哪个"，再倒推用什么细节引发那种情绪。
4) 角色行为从性格+修为中自然流出：一个谨慎的筑基修士不会主动挑衅元婴期强者。
5) 不完美原则：真实的修仙者有判断失误、贪念、固执——不要让角色太理性太自知。
6) 允许计划外灵感——好的意外（一个NPC突然有了个性、一场战斗打出了意料之外的结果）比严格执行计划更重要。`,

  EDITOR_DISCIPLINE_PLAYBOOK: `编辑纪律（玄幻）：
1) 优先修复审阅指出的具体问题，保留已验证的事实与因果链。
2) 不得削弱已有强钩子，除非替换为更强钩子。不得改动章号与章名。
3) 战斗场景提升：找到最平淡的打斗段落，用更有冲击力的动势描写（风声/震动/碎裂的质感）重写。
4) 突破/升级场景提升：检查是否有"过程感"（身体变化→灵气异动→周围反应），缺失则补充。
5) 旁观者反应检查：大场面是否有阶梯式围观反应？缺失则在自然位置补入2-3句不同层级的反应。
6) 对话潜台词检查：关键对话是否太直白？修仙者的身份差距是否体现在语气中？
7) 确保章内有情绪弧线——从A情绪到B情绪，战斗章也要有心理层次而非纯打。`,

  REVIEWER_RUBRIC_PLAYBOOK: `评审打分标尺（玄幻，0-10）：
9-10：战斗/突破让人热血沸腾，旁观者反应到位，金句让人想截图，读完恨不得一口气看下一章。
7-8：剧情推进有力，战斗有变化不套路，角色行为合理，有1-2个记忆点。
5-6：剧情平推没有惊喜，战斗描写套路化（你一招我一招），缺少令人振奋的时刻，读者可能走神。
3-4：严重拖沓/水字数，角色行为不合理，力量体系自相矛盾，突破没有代价感。
0-2：完全脱离设定，角色崩坏，读者无法代入。`,

  CONTINUITY_BASELINE_PLAYBOOK: `连续性底线（玄幻）：
1) 角色姓名、称呼、道号必须与已有记录一致。
2) 已死亡/退场角色不得现身参与当前动作线。休眠角色不得直接现身。
3) 不得产生不可能的空间位移——角色不能瞬间跨越需要数日路程的距离（除非有传送阵等设定支撑）。
4) 修为等级不能无故跳级——筑基不能突然使出元婴期法术，除非有金手指/秘宝等合理解释。
5) 灵气/法宝/功法设定必须前后一致——已确立的能力边界不能随意突破。
6) 宗门/势力关系不能无故翻转——敌对势力突然结盟需要充分铺垫。`,

  THREAD_AWARENESS_PLAYBOOK: `伏线意识（玄幻）：
1) 不要为了"制造悬念"而无节制开新坑——修仙世界线索多但读者记忆有限。
2) 对逾期伏线优先推进或回收：身世之谜、血脉秘密、师门阴谋等长线不能拖太久。
3) 回收伏线时必须兑现前置铺垫——早期埋下的神秘老者/残破功法/异常天象，揭晓时要让读者"恍然大悟"。
4) 新伏线必须服务当前冲突——不要在战斗卷突然开一条修炼感悟线。
5) 力量体系伏线（隐藏血脉/封印记忆/上古传承）是玄幻最有效的长线钩子，但每卷最多活跃2-3条。`,
};

const ROMANCE_PLAYBOOKS: Record<string, string> = {
  PROSE_CRAFT_PLAYBOOK: `【一、展示而非讲述】
规则：每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。
- ❌ "她心动了" → ✅ 她发现自己不自觉地在人群中寻找那个背影，找到了才松了口气
- ❌ "他很紧张" → ✅ 他把那句话在心里排练了五遍，等真的面对面了却说了句完全不同的
- ❌ "气氛暧昧" → ✅ 安静得能听到他翻书的声音，她盯着手机屏幕，一个字也没读进去

【二、对白技法】
- 潜台词是言情的灵魂："我没事"可能是"我很在意但不想承认"；"随便你"可能是"我在等你挽留"。
- 每句对话至少完成两任务：推进感情线+展示性格，或传递信息+制造误会/心动。
- 权力关系影响语气：暗恋方说话更小心、更试探；被追方更随意但偶尔流露在意。
- 微信/短信对话是独特形式——打字速度、已读不回、撤回消息都是叙事工具。
- 对白中的停顿比内容更重要：没说出口的话、突然转移话题、答非所问。

【三、句式节奏】
- 心动瞬间：短句+断句+时间放慢感。一个微小的动作值得一个独立段落。
- 日常相处：中长句+细节+温度感。让读者感受到"这就是恋爱中的样子"。
- 争吵/分离：短句+留白+情绪克制比爆发更有冲击力。
- 重要告白/真情流露前，放一个安静的环境描写段——制造仪式感。

【四、感官叠加——让读者"身临其境"】
- 言情的感官重点：触觉（不经意的肢体接触）、嗅觉（对方身上的气味）、听觉（声音的变化）。
- ❌ 他们并肩走 → ✅ 她能感觉到他的手臂偶尔蹭到自己的袖子，冬天的大衣下透过来一点体温

【五、环境映射情绪】
- ❌ "她心情很好" → ✅ "今天的奶茶好像比平时甜，阳光也恰好照在她常坐的那个位子"
- ❌ "他很失落" → ✅ "雨不知道什么时候停了，街灯亮了起来，他才发现自己在这里站了很久"

【六、留白术】
- "他看了她很久。然后说，走吧。"比一大段内心独白更动人。
- 关键情感转折后的沉默——给读者和角色共同消化的空间。

【七、闺蜜/损友烘托——用不同亲密度的人衬托感情变化】
- 感情线的重要进展，用亲友反应来放大读者体验：
  闺蜜的敏锐察觉→旁观者的善意打趣→长辈的态度变化→对手的不安。
- 每一层反应要自然：闺蜜用试探性提问、同事用调侃、父母用"最近气色不错"。
- 闺蜜/好友是读者的代言人——她们的追问和八卦满足了读者想知道细节的欲望。

【八、金句意识】
- 金句出现在感情关键节点：确认心意、表白、重逢、告别、放手。
- 好的言情金句：简短、克制、有情感余韵、脱离语境也能让人心动。

【九、杀死AI味】
以下表达每章最多出现一次：
"不由得""心中一凛""嘴角上扬""心如鹿撞""怦然心动""不禁""微微红了脸""目光交汇""电流般""紧张地""小鹿乱撞""粉红泡泡"
深层AI味：
- 所有心动都用同一种反应（脸红+心跳加速）——不同性格的心动方式不同
- 角色对感情过于自知（"她意识到自己爱上了他"——真实的人往往最后一个明白）
- 误会冲突太刻意（刚好撞见、刚好听到半句话）——巧合可以有但要有铺垫
- 感情推进过于均匀（每章进一步）——应有停滞、后退、突然加速`,

  CHARACTER_ARC_PLAYBOOK: `角色弧线意识（言情）：

矛盾内核：
- 每个重要角色都有一个不可调和的内在矛盾——想靠近但害怕受伤，渴望被爱但不相信爱，想独立但又依赖对方。
- 感情中的矛盾往往来自过去的创伤、家庭影响、自我认知偏差。

成长规则：
1) 感情不是线性推进。可以两步前进一步后退：刚确认心意又因为过去的阴影退缩。
2) 关系是双向的。一方的改变会触发另一方的变化——A开始主动，B反而变得不安。
3) 角色间的"化学反应"要有独特性——只属于他们的互动模式、玩笑、默契或紧张感。
4) 配角的感情线不是主线的复制品——应有不同的相处模式和矛盾类型。

硬规则：
5) 情绪逻辑不可违反。刚经历分手/背叛不能下一段就笑容满面地约会新对象。
6) "扁平化警报"：如果配角连续多章只是功能性出场（传话/调侃），需要给他一个展现内心的时刻。
7) 感情进展要与角色成长同步——不是"在一起"就完了，关系中的磨合才是真正的故事。`,

  WRITING_SOUL_PLAYBOOK: `写作灵魂准则（言情）：
1) 所有正文必须使用简体中文。禁止输出任何元叙述。
2) 代入感是命根子：写任何场景前先问"读者代入的是谁的视角"——言情通常双视角切换，两人都要有内心戏但不能同时展示。
3) 情绪先行：先确定"读者读到这里应该是心动/紧张/心疼/甜蜜中的哪个"，再倒推用什么细节引发。
4) 角色行为从性格+经历中流出：一个在感情中受过伤的人不会轻易说"我喜欢你"。
5) 不完美原则：真实的人在感情中会口是心非、犹豫、做错选择——完美的恋爱对象不真实。
6) 允许计划外灵感——两个角色互动时产生的意外化学反应，比剧情大纲上写的"这里心动"更有价值。`,

  EDITOR_DISCIPLINE_PLAYBOOK: `编辑纪律（言情）：
1) 优先修复审阅指出的具体问题，保留已验证的事实与因果链。
2) 不得削弱已有强钩子，除非替换为更强钩子。不得改动章号与章名。
3) 心动场景提升：找到最平淡的互动段落，用更有温度的感官细节（不经意的触碰/气味/声音变化）重写。
4) 对话潜台词检查：关键对话是否太直白？"我没事"背后是否有"我很在意"？暗恋方是否比被追方更小心翼翼？
5) 情感节奏检查：是否连续多章纯甜无冲突？是否连续虐心不给温暖？确保甜蜜与矛盾交替。
6) 配角功能检查：闺蜜/好友是否沦为纯工具人？在自然位置补入她们的独立反应和追问。
7) 确保章内有情绪弧线——从A情绪到B情绪，日常章也要有微妙的心理变化。`,

  REVIEWER_RUBRIC_PLAYBOOK: `评审打分标尺（言情，0-10）：
9-10：读完嘴角上扬想催更，CP化学反应强烈到想代入，有让人想截图的心动瞬间或金句。
7-8：感情线推进自然，互动有独特感，角色鲜活有辨识度，有1-2个记忆点。
5-6：感情线平淡，互动模板化（脸红+心跳），缺少让人心跳的瞬间，配角沦为工具人。
3-4：人设崩塌/逻辑硬伤，男女主没有chemistry，靠巧合推剧情，误会冲突太刻意。
0-2：完全不合理的感情发展，角色行为无法理解，读者无法代入。`,

  CONTINUITY_BASELINE_PLAYBOOK: `连续性底线（言情）：
1) 角色姓名、称呼、昵称必须与已有记录一致——情侣间的专属称呼尤其重要。
2) 已分手/退场角色不得无故出现在当前互动中。
3) 感情进度不能倒退无因——已确认心意不能下一章突然当陌生人（除非有明确的外部原因）。
4) 职场/校园/家庭背景设定必须前后一致——角色的工作内容、家庭关系、朋友圈不能矛盾。
5) 时间线逻辑：约会/事件的时间顺序不能混乱，季节/节日要与情节匹配。
6) 角色的过往创伤/性格特质必须一致——前文说"不信任异性"，后文不能无铺垫地完全敞开。`,

  THREAD_AWARENESS_PLAYBOOK: `伏线意识（言情）：
1) 不要为了"制造误会"而无节制开新坑——言情的伏线应服务于感情推进。
2) 情感暗线优先：暗恋的蛛丝马迹、角色过去的创伤、家庭秘密等长线要有节奏地推进。
3) 回收伏线时必须有情感冲击——早期埋下的误会/秘密揭晓时，读者应该"心疼"或"恍然大悟"。
4) 新伏线必须服务当前感情阶段——暧昧期开的线和热恋期开的线类型不同。
5) 前任/情敌/家庭阻碍等外部伏线每卷最多活跃1-2条，避免狗血堆砌。`,
};

const MYSTERY_PLAYBOOKS: Record<string, string> = {
  PROSE_CRAFT_PLAYBOOK: `【一、展示而非讲述】
规则：每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。
- ❌ "他觉得可疑" → ✅ 他的视线在那张照片上停留了三秒——桌上其他东西都蒙了灰，只有相框是干净的
- ❌ "气氛紧张" → ✅ 审讯室的日光灯微微闪了一下，对面的人手指停止了无意识的敲击
- ❌ "她在撒谎" → ✅ 她回答得太流畅了，像背课文——真正回忆的人会停顿、会修正

【二、对白技法】
- 审讯/问询：每句话都是攻防。提问者控制节奏，受询者的"不说什么"比"说什么"更重要。
- 信息不对称是核心：知情者的回避、半真半假、答非所问——都是线索。
- 权力关系在悬疑中表现为信息差：掌握真相的人最沉默，什么都不知道的人最多话。
- 日常对话中埋线索：一句看似无关的闲聊，几十章后可能是关键证据。
- 多人对话时用不同反应揭示嫌疑——谁在回避话题？谁的反应不自然？

【三、句式节奏】
- 发现线索/推理：中等句式，冷静、精确、观察式笔触。每一个细节都可能有用。
- 追逐/危机：极短句+断句+感官碎片。不给读者和角色喘息的空间。
- 揭露真相：先用长句铺设氛围，到关键那一句用短句戛然而止。
- 日常过渡中保持微妙的不安感——看似平静但有一处细节"不对"。

【四、感官叠加——让读者"身临其境"】
- 悬疑的感官重点：视觉细节（不对劲的东西）、听觉（不该有的声音/不该静的时候很静）、嗅觉（血腥味/化学品/异常气味）。
- ❌ 他检查了现场 → ✅ 地板上有一道不自然的擦痕，终点消失在书柜下方。房间里有种淡淡的漂白水味，但浴室的清洁剂架上只有过期的洗发水

【五、环境映射情绪——制造氛围】
- 悬疑的环境不是"映射角色情绪"，而是"制造读者情绪"——用环境暗示危险/诡异。
- ❌ "他心里不安" → ✅ "走廊尽头的灯不知道什么时候灭了，剩下的灯管发出微弱的嗡嗡声"

【六、留白术——悬疑的核心技法】
- 最可怕的不是展示，而是暗示后留白。"他打开了那扇门。"后面不写门后是什么——让读者自己想象。
- 关键推理的最后一步留给读者——给出所有线索但不明说结论，让读者自己"啊！"。

【七、知情者梯度烘托——用不同知情程度的人揭示真相层次】
- 真相揭露时，按知情程度递进写各方反应：
  完全不知情者困惑→知道部分的人脸色巨变→自以为知道全貌的人崩溃→真正的知情者异常平静。
- 每一层反应要具体不同：有人反复确认、有人本能后退、有人开始找借口、有人沉默太久。
- 嫌疑人群中有人的反应"不对"——但不点明哪里不对，留给读者捕捉。

【八、金句意识】
- 金句出现在真相揭露、逻辑闭环、角色面具碎裂的时刻。
- 好的悬疑金句：简短、冰冷、让人脊背发凉、回想起来才发现早有暗示。

【九、杀死AI味】
以下表达每章最多出现一次：
"不由得""心中一凛""眼中闪过""与此同时""深吸一口气""空气仿佛凝固""不禁""缓缓开口""目光锐利""陷入沉思""拨开迷雾""真相浮出水面""细思极恐"
深层AI味：
- 侦探/主角推理过于顺畅（现实中推理是反复试错的过程）
- 线索出现太巧合太及时（刚需要就出现）——好的线索应该"一直在那里但被忽视"
- 所有嫌疑人的可疑行为都太明显——真正的嫌疑人往往表现得最正常
- 揭露真相时大段独白解释——应通过场景重现和证据链让真相自己浮现`,

  CHARACTER_ARC_PLAYBOOK: `角色弧线意识（悬疑）：

矛盾内核：
- 每个重要角色都有双面性——白天的社会身份 vs 暗处的秘密。调查者也有自己的阴影。
- 悬疑中最好的角色矛盾：为了正义不得不用非正义手段，知道真相但说出来会伤害更多人。

成长规则：
1) 调查者在追查过程中被真相改变——从旁观变成当事人，从确信变成怀疑。
2) 嫌疑人不是扁平的"好人/坏人"——每个人都有合理的动机和不得已。
3) 角色间的"化学反应"在悬疑中表现为信任博弈——谁在试探谁？谁先暴露？

硬规则：
4) 情绪逻辑不可违反。目睹惨烈现场不能下一段就冷静分析——除非角色本身就有情感疏离特质（且这个特质本身就是故事的一部分）。
5) "面具剥落"是悬疑角色最好的弧线——从"表面身份"逐层揭示"真实自我"。
6) 受害者不能只是"案件的触发器"——即使已经不在了，通过回忆/证据让读者理解他们是真实的人。`,

  WRITING_SOUL_PLAYBOOK: `写作灵魂准则（悬疑）：
1) 所有正文必须使用简体中文。禁止输出任何元叙述。
2) 信息控制是命根子：写任何场景前先问"读者目前知道多少？这个场景应该让他们多知道一点还是更困惑？"——精确控制信息释放节奏。
3) 公平原则：所有关键线索必须在揭晓前展示过（哪怕不起眼），禁止"天降线索"式解谜。
4) 角色行为从动机中自然流出：每个人做的每件事都有原因，即使那个原因暂时不被读者知道。
5) 不完美原则：调查者会走错方向、会被误导、会因个人偏见忽略关键信息——完美的推理机器不是好角色。
6) 允许计划外灵感——一个角色的反常反应可能暗示了计划之外但更好的真相路径。`,

  EDITOR_DISCIPLINE_PLAYBOOK: `编辑纪律（悬疑）：
1) 优先修复审阅指出的具体问题，保留已验证的事实与因果链。
2) 不得削弱已有强钩子，除非替换为更强钩子。不得改动章号与章名。
3) 线索隐蔽性检查：关键线索是否太明显？好的线索应该"一直在那里但被忽视"——在自然位置用日常细节包裹。
4) 逻辑严密性检查：时间线是否矛盾？证据链是否断裂？嫌疑人的不在场证明是否自洽？
5) 误导层次提升：表面误导是否太容易看穿？在自然位置补入更深层的误导——让聪明读者也判断错误。
6) 氛围营造检查：日常场景是否有微妙的不安感？在平静段落中补入1-2处"不对劲"的细节。
7) 确保章内有信息弧线——从已知到新疑问，每章结束时读者的认知应该发生变化。`,

  REVIEWER_RUBRIC_PLAYBOOK: `评审打分标尺（悬疑，0-10）：
9-10：读完脊背发凉想从头再读一遍找线索，反转让人拍案叫绝，线索链完美闭合无漏洞。
7-8：推理过程有说服力，线索铺设公平，有1-2个让人意外的发现，嫌疑人动机合理。
5-6：推理过程平庸，真相在意料之中，缺少"被骗"的快感，线索铺设过于明显或过于隐蔽。
3-4：逻辑漏洞明显，线索不公平/强行反转，嫌疑人动机牵强，推理靠巧合而非逻辑。
0-2：完全不合逻辑，真相无法自圆其说，读者感觉被愚弄而非被震撼。`,

  CONTINUITY_BASELINE_PLAYBOOK: `连续性底线（悬疑）：
1) 角色姓名、身份、职业必须与已有记录一致。
2) 已死亡/退场角色不得现身——除非是回忆/证据重现，且必须明确标注时间线。
3) 时间线绝对不能矛盾——案发时间、不在场证明、事件先后顺序是悬疑的生命线。
4) 物证/痕迹不能凭空消失或出现——已确立的现场状态必须前后一致。
5) 角色的知情范围必须严格管控——A不知道的信息，A的行为不能暗示他知道（除非他就是知情者）。
6) 已揭露的线索不能被遗忘——侦探/主角发现的关键证据必须在后续推理中被引用。`,

  THREAD_AWARENESS_PLAYBOOK: `伏线意识（悬疑）：
1) 线索链是悬疑的核心伏线——每条线索的铺设、发现、串联都要有节奏。
2) 公平原则：关键线索必须在揭晓前至少出现过一次（哪怕不起眼），禁止"天降线索"。
3) 误导线也是伏线——红鲱鱼需要精心设计，揭穿时读者应该"啊，我被骗了"而非"这也太随便了"。
4) 嫌疑人的秘密是分层伏线——每个嫌疑人都有自己的秘密，不一定与案件相关，但揭露时丰富角色。
5) 长线悬念（连环案/幕后黑手/主角自身的秘密）每卷最多活跃1-2条，信息释放要精确控制。`,
};

const OUTPUT_KEY_TO_CATEGORY: Record<string, RuleAtom['category']> = Object.fromEntries(
  Object.entries(CATEGORY_TO_OUTPUT_KEY).map(([c, k]) => [k, c as RuleAtom['category']]),
);
const PLAYBOOK_AGENT_MAP: Record<string, string[]> = {
  PROSE_CRAFT_PLAYBOOK: ['creative-writer', 'scene-stitcher', 'reviewer', 'editor'],
  WRITING_SOUL_PLAYBOOK: ['creative-writer'], CHARACTER_ARC_PLAYBOOK: ['creative-writer', 'reviewer'],
  EDITOR_DISCIPLINE_PLAYBOOK: ['editor'], REVIEWER_RUBRIC_PLAYBOOK: ['reviewer'],
  CONTINUITY_BASELINE_PLAYBOOK: ['reviewer', 'editor'],
  THREAD_AWARENESS_PLAYBOOK: ['creative-writer', 'intent', 'scene-planner'],
};
function playbookDictToAtoms(dict: Record<string, string>): RuleAtom[] {
  const atoms: RuleAtom[] = [];
  for (const [key, text] of Object.entries(dict)) {
    const cat = OUTPUT_KEY_TO_CATEGORY[key];
    if (!cat || !text?.trim()) continue;
    atoms.push(...parsePlaybookTextToAtoms(text, cat, key, PLAYBOOK_AGENT_MAP[key] ?? ['creative-writer'], 'genre'));
  }
  return atoms;
}

interface SystemSeed {
  genreKey: string; displayName: string; description: string;
  genreKeywords: string[]; profile: BookPromptProfile | null;
  seedHints: SeedAnalyzerHints | null;
  ruleAtoms?: RuleAtom[];
  audienceMeta?: AudienceDirectiveMeta;
}

function getDefaultNamingDefaultsForGenre(genreLike: string): NonNullable<SeedAnalyzerHints['namingDefaults']> {
  const g = genreLike.toLowerCase();
  if (/(仙侠|玄幻|修仙|武侠|xianxia|xuanhuan|wuxia)/.test(g)) {
    return {
      personNameStyle: '二到三字中文名，优先自然/五行意象，避免现代英文拼写',
      locationNameStyle: '地貌+方位或意象组合（如“北陵”“落霞谷”）',
      abilityNameStyle: '能力名偏古风意象或功法体系术语，避免现代口语化命名',
      factionNameStyle: '宗门/世家/王朝式命名，统一世界观语感',
      examples: { personNames: ['凌霜', '顾长歌', '沈青岚'], locationNames: ['落霞谷', '北陵城'] },
      taboos: ['英文名', '现代网络梗命名'],
    };
  }
  if (/(西方奇幻|western-fantasy|奇幻|fantasy)/.test(g)) {
    return {
      personNameStyle: '可中可西但需同文明音韵统一（人类/精灵/矮人命名规则分层）',
      locationNameStyle: '王国/城邦/遗迹命名统一语系，避免中西混搭突兀',
      abilityNameStyle: '法术/技能命名需符合同一语系与文明风格',
      factionNameStyle: '骑士团/公会/王室/教团等组织命名需层级清晰',
      examples: { personNames: ['Arthur Vale', 'Elyra', 'Thorne'], locationNames: ['Silverkeep', 'Ashen Vale'] },
      taboos: ['中西命名体系混杂', '无语系规律的生造词'],
    };
  }
  if (/(科幻|sci-fi|scifi|赛博|机甲|星际)/.test(g)) {
    return {
      personNameStyle: '姓名/代号并存，允许编号或呼号，保持组织体系一致',
      locationNameStyle: '空间站/殖民地/舰队基地命名，突出科技感与层级',
      abilityNameStyle: '科技能力/协议/模块命名应简洁清晰并可追踪',
      factionNameStyle: '公司/舰队/议会/研究所命名需体现组织功能',
      examples: { personNames: ['林序-07', '韩霁', 'Kestrel'], locationNames: ['天枢轨道站', 'C-12殖民环'] },
      taboos: ['玄幻式功法命名', '缺乏系统性的编号规则'],
    };
  }
  if (/(战争\/军事|军事|military|战争|谍战|特种兵)/.test(g)) {
    return {
      personNameStyle: '简洁有辨识度，结合军衔/代号/呼号，避免花哨',
      locationNameStyle: '战区/防线/据点命名，强调方位与战术语义',
      abilityNameStyle: '装备/战术/行动代号命名需专业且可落地',
      factionNameStyle: '军团/战区/情报系统命名应体现编制关系',
      examples: { personNames: ['周烈', '“灰狼”沈拓', '顾砚'], locationNames: ['北境三号防线', '青岚前进基地'] },
      taboos: ['娱乐化昵称堆叠', '脱离军事语境的中二称号'],
    };
  }
  if (/(悬疑推理|mystery|悬疑|推理|侦探|犯罪)/.test(g)) {
    return {
      personNameStyle: '现代常用姓名，简洁清晰便于推理线索追踪',
      locationNameStyle: '现实城市/街区/建筑命名，强调空间定位与封闭感',
      abilityNameStyle: '线索/推理工具/作案手法命名需逻辑自洽',
      factionNameStyle: '警署/律所/犯罪组织命名需层级清晰',
      examples: { personNames: ['陆铮', '宋枝', '周谨'], locationNames: ['临港分局', '白鹤公寓'] },
      taboos: ['超自然化命名', '脱离现实的花哨称号'],
    };
  }
  if (/(无限流|infinite-flow|规则怪谈|恐怖|灵异|悬疑惊悚|suspense-thriller|horror|supernatural)/.test(g)) {
    return {
      personNameStyle: '优先短名/代号，便于高压副本中快速识别与记忆',
      locationNameStyle: '副本/禁区/规则场命名短促明确，带危险提示感',
      abilityNameStyle: '规则/诅咒/道具命名应可执行且有边界',
      factionNameStyle: '调查局/结社/隐秘组织命名需暗示信息差',
      examples: { personNames: ['许岚', '“白鸦”', '周祁'], locationNames: ['第四病栋', '雾港12号站'] },
      taboos: ['过长难记代号', '无规则定义的抽象术语'],
    };
  }
  if (/(末世危机|post-apocalyptic|末世|废土)/.test(g)) {
    return {
      personNameStyle: '生存语感优先，可带绰号但不过度中二',
      locationNameStyle: '避难所/据点/污染区命名一眼可懂',
      abilityNameStyle: '资源/改造/异化能力命名需体现代价与限制',
      factionNameStyle: '避难所联盟/掠夺团/净化组织命名应体现生存立场',
      examples: { personNames: ['沈砾', '“扳手”阿川', '林昼'], locationNames: ['黎明避难所', '黑雨污染区'] },
      taboos: ['无生存语境的唯美命名', '灾难等级定义混乱'],
    };
  }
  if (/(电子竞技|虚拟网游|体育竞技|esports|vrmmo|sports|game)/.test(g)) {
    return {
      personNameStyle: '本名+ID双轨命名，ID需短、好读、可传播',
      locationNameStyle: '赛场/俱乐部/服务器地名，强调赛事与运营语境',
      abilityNameStyle: '战术/流派/技能命名应可复用且便于解说',
      factionNameStyle: '战队/俱乐部/公会命名需风格统一',
      examples: { personNames: ['陈临(ID:Lin)', '苏禾(ID:Hex)', '宋野(ID:Apex)'], locationNames: ['星环联赛主舞台', '曙光一区'] },
      taboos: ['难读ID', '脱离竞技语境的玄幻称号'],
    };
  }
  if (/(轻小说|light-novel|二次元)/.test(g)) {
    return {
      personNameStyle: '轻巧顺口、可带一点梗感，但避免过度夸张',
      locationNameStyle: '校园/社团/街区命名可爱且清晰，保持日常感',
      abilityNameStyle: '能力/设定名可轻量中二，但需保持自洽',
      factionNameStyle: '学生会/社团/组织命名应有角色辨识度',
      examples: { personNames: ['白川悠', '林可奈', '顾时雨'], locationNames: ['樱丘学园', '银杏商店街'] },
      taboos: ['过度堆梗', '音译生硬且不可读'],
    };
  }
  if (/(冒险\/探险|adventure|冒险|探险|盗墓|寻宝)/.test(g)) {
    return {
      personNameStyle: '短而硬朗、便于队内称呼，绰号可体现技能分工',
      locationNameStyle: '遗迹/禁区/海域/山脉命名应突出地理风险与未知感',
      abilityNameStyle: '工具/机关/线索系统命名需可追踪',
      factionNameStyle: '探险团/考古队/地下组织命名需功能清晰',
      examples: { personNames: ['顾野', '“罗盘”林策', '唐砾'], locationNames: ['黑帆海沟', '沉星遗迹'] },
      taboos: ['同质化地名', '缺少方位与风险信息'],
    };
  }
  if (/(超能力\/异能|superpower|异能|超能力|觉醒|学院)/.test(g)) {
    return {
      personNameStyle: '现代名为主，可配能力代号，避免中二堆词',
      locationNameStyle: '学院/研究所/管控区命名需体现制度与阵营差异',
      abilityNameStyle: '能力名需体现触发条件/代价，避免无边界词汇',
      factionNameStyle: '学院派/官方机构/地下势力命名应阵营分明',
      examples: { personNames: ['季衡', '宁初', '代号“棱镜”'], locationNames: ['新曜异能学院', '第七收容区'] },
      taboos: ['无代价无边界的能力命名', '重复度过高的代号'],
    };
  }
  if (/(史诗\/传奇|epic|史诗|传奇|群像|王朝兴衰)/.test(g)) {
    return {
      personNameStyle: '可采用名/姓/称号并行体系，主角群命名要区分文明来源',
      locationNameStyle: '帝国/城邦/古战场命名强调历史纵深与地缘格局',
      abilityNameStyle: '权柄/誓约/古器命名需体现文明层级',
      factionNameStyle: '王朝/议会/教团/部族命名需体现政治关系',
      examples: { personNames: ['阿列斯·维恩', '裴烬', '“北境之狮”岑岳'], locationNames: ['赤曜帝国', '白霜长垣'] },
      taboos: ['无文明差异的同质命名', '缺乏历史感的现代词汇'],
    };
  }
  if (/(儿童\/少儿文学|children|儿童|少儿|童话)/.test(g)) {
    return {
      personNameStyle: '亲切易读、发音明快，避免生僻字与过复杂称号',
      locationNameStyle: '场景名应具画面感与温暖想象，便于低龄读者记忆',
      abilityNameStyle: '魔法/道具名应直观正向，避免恐怖化表达',
      factionNameStyle: '学校/家庭/伙伴组织命名应温暖清晰',
      examples: { personNames: ['小满', '豆豆', '安安'], locationNames: ['彩虹镇', '风铃森林'] },
      taboos: ['黑暗化命名', '难读难记生僻字'],
    };
  }
  if (/(古代言情|ancient-romance|古言|宫斗|宅斗)/.test(g)) {
    return {
      personNameStyle: '古风中文名，可结合名/字/号体系，避免现代口语化命名',
      locationNameStyle: '府邸/州郡/宫苑命名，符合古代礼制与地理语感',
      abilityNameStyle: '技能/谋略/礼法术语命名贴合古代语境',
      factionNameStyle: '家族/后宫/朝堂势力命名应体现尊卑秩序',
      examples: { personNames: ['沈清辞', '裴砚之', '谢明昭'], locationNames: ['长乐宫', '临安侯府'] },
      taboos: ['现代口头禅命名', '英文缩写'],
    };
  }
  if (/(幻想言情|fantasy-romance|幻言|穿越恋爱|仙侠恋|神魔恋)/.test(g)) {
    return {
      personNameStyle: '古风与幻想混合命名，保留诗性与宿命感',
      locationNameStyle: '仙域/神域/秘境命名，强调唯美与层级',
      abilityNameStyle: '术法/血脉/契约命名需服务情感主线',
      factionNameStyle: '仙门/神族/魔域命名需阵营清晰',
      examples: { personNames: ['姬扶月', '谢无咎', '云照晚'], locationNames: ['太初天阙', '忘川镜海'] },
      taboos: ['硬科技感命名', '破坏仙侠语感的现代词'],
    };
  }
  if (/(都市现实|都市|urban(?!-romance)|神豪|职场|年代文|重生都市)/.test(g)) {
    return {
      personNameStyle: '现代常用中文名，简洁大气，符合都市精英/逆袭者气质',
      locationNameStyle: '现代城市地标/商圈/公司命名，突出社会阶层与财富感',
      abilityNameStyle: '商业/社交/信息能力命名应贴合现代语境',
      factionNameStyle: '公司/家族/圈层组织命名需体现阶级关系',
      examples: { personNames: ['顾辰', '林北', '秦墨'], locationNames: ['华庭国际', '滨江CBD'] },
      taboos: ['玄幻式命名', '脱离都市语境的中二表达'],
    };
  }
  if (/(现代言情|urban-romance|现言|言情|romance)/.test(g)) {
    return {
      personNameStyle: '现代常见中文名，简洁顺口，避免古风生僻字',
      locationNameStyle: '现代城市/街区/地标命名，贴近现实语境',
      abilityNameStyle: '若存在超常设定，命名应偏生活化，避免中二浮夸',
      factionNameStyle: '公司/家族/圈层组织命名，符合现代语境',
      examples: { personNames: ['程予安', '陆知夏', '周言'], locationNames: ['滨江公寓', '临江路'] },
      taboos: ['古风生僻字堆叠', '中二式称号'],
    };
  }
  if (/(历史|权谋|historical|架空|种田|争霸)/.test(g)) {
    return {
      personNameStyle: '古代语感中文名，可结合名/字/号体系',
      locationNameStyle: '州郡城池/关隘风格命名，符合古代政区语感',
      abilityNameStyle: '技能/兵法/谋略命名应贴合古代语境',
      factionNameStyle: '朝廷/藩镇/家族/门阀式命名',
      examples: { personNames: ['谢玄机', '裴慎', '柳明昭'], locationNames: ['青州', '雁门关'] },
      taboos: ['现代词汇直译', '英文缩写'],
    };
  }
  return {
    personNameStyle: '符合题材语境且易记的人名，避免突兀跨风格命名',
    locationNameStyle: '与世界观语境一致的地名，保持同一文明命名规律',
    examples: { personNames: ['林湛', '许未央', '顾遥'], locationNames: ['旧港区', '灰塔城'] },
    taboos: ['跨题材突兀命名'],
  };
}

function ensureSeedHintsNamingDefaults(
  seedHints: SeedAnalyzerHints | null | undefined,
  genreLike: string,
): SeedAnalyzerHints {
  const base = seedHints ?? {};
  return {
    ...base,
    namingDefaults: base.namingDefaults ?? getDefaultNamingDefaultsForGenre(genreLike),
  };
}

const GENRE_AUDIENCE_META: Record<string, AudienceDirectiveMeta> = {
  'xianxia': {
    audienceTags: ['修仙', '升级', '长生', '法宝', '道心', '杀伐果断'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['苍凉', '宏大', '残酷', '超脱'],
    relationshipDensity: 'low', // 修仙者多孤独，情感线偏淡或为点缀
    hardConstraints: ['不能圣母', '战力体系不能崩坏', '必须有境界突破的爽感'],
    softPreferences: ['喜欢看捡漏/夺宝', '喜欢看越阶挑战的底牌揭晓'],
  },
  'xuanhuan': {
    audienceTags: ['热血', '装逼打脸', '退婚流', '无敌', '越阶挑战'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['热血', '爽快', '霸气'],
    relationshipDensity: 'medium', // 兄弟情、红颜知己较多
    hardConstraints: ['绝不能憋屈', '反派必须被狠狠打脸', '升级速度要快'],
    softPreferences: ['喜欢看拍卖会装逼', '喜欢看震惊路人'],
  },
  'urban': {
    audienceTags: ['神豪', '逆袭', '职场', '捡漏', '扮猪吃虎'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['轻松', '爽快', '接地气'],
    relationshipDensity: 'high', // 社交、人脉、红颜知己是核心
    hardConstraints: ['不能有太长期的压抑', '装逼要自然不能太生硬', '社会逻辑不能太离谱'],
    softPreferences: ['喜欢看前倨后恭', '喜欢看金钱碾压'],
  },
  'historical': {
    audienceTags: ['争霸', '种田', '科技碾压', '权谋', '改变历史'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['厚重', '爽快', '热血'],
    relationshipDensity: 'high', // 君臣、名将、后宫
    hardConstraints: ['常识不能犯低级错误', '不能强行降智古人', '科技树攀升要有过渡'],
    softPreferences: ['喜欢看古人震惊', '喜欢收服历史名将'],
  },
  'western-fantasy': {
    audienceTags: ['魔法', '史诗', '冒险', '异族', '领主'],
    protagonistFocusTags: ['male_lead', 'ensemble'],
    toneTags: ['宏大', '神秘', '史诗感'],
    relationshipDensity: 'medium', // 冒险小队羁绊
    hardConstraints: ['魔法体系必须自洽', '世界观不能太单薄'],
    softPreferences: ['喜欢看不同种族的文化碰撞', '喜欢看古老遗迹的探索'],
  },
  'sci-fi': {
    audienceTags: ['机甲', '星战', '赛博朋克', '基因进化', '废土'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['冷峻', '震撼', '宏大'],
    relationshipDensity: 'low', // 更关注技术和宇宙探索
    hardConstraints: ['科技设定不能自相矛盾', '不能写成披着科幻皮的修仙'],
    softPreferences: ['喜欢看巨舰大炮的对轰', '喜欢看高科技碾压低维文明'],
  },
  'wuxia': {
    audienceTags: ['极道', '加点', '江湖', '杀伐果断', '肌肉碾压'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['热血', '暴力', '江湖气'],
    relationshipDensity: 'medium', // 师徒、兄弟、仇敌
    hardConstraints: ['不能圣母', '武打描写必须有力量感', '主角不能太憋屈'],
    softPreferences: ['喜欢看拳拳到肉的打斗', '喜欢看加点带来的瞬间提升'],
  },
  'military': {
    audienceTags: ['军事', '战争', '谍战', '特种兵', '热血'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['铁血', '悲壮', '热血'],
    relationshipDensity: 'medium', // 战友情、上下级、敌我博弈
    hardConstraints: ['军事常识不能出错', '战争残酷性要真实', '不能美化战争'],
    softPreferences: ['喜欢看以少胜多', '喜欢看战术博弈'],
  },
  'mystery': {
    audienceTags: ['悬疑', '反转', '推理', '智斗', '细思极恐'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['压抑', '冷冽', '紧张'],
    relationshipDensity: 'low', // 主要是主角与凶手/谜题的博弈
    hardConstraints: ['逻辑必须严密', '反转必须有伏笔', '不能机械降神'],
    softPreferences: ['喜欢看智商碾压', '喜欢看意料之外的真相'],
  },
  'infinite-flow': {
    audienceTags: ['主神空间', '副本', '智斗', '杀伐果断', '强化'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['紧张', '绝望', '爽快'],
    relationshipDensity: 'medium', // 团队内部的信任与背叛
    hardConstraints: ['主角绝不能圣母', '副本规则必须有解', '强化必须有明显提升'],
    softPreferences: ['喜欢看卡BUG破局', '喜欢看反杀资深者/背叛者'],
  },
  'light-novel': {
    audienceTags: ['二次元', '吐槽', '反套路', '日常', '修罗场'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['轻松', '搞笑', '治愈'],
    relationshipDensity: 'high', // 角色互动是核心
    hardConstraints: ['角色人设不能崩', '不能太苦大仇深', '梗要自然'],
    softPreferences: ['喜欢看全员迪化(脑补)', '喜欢看修罗场'],
  },
  'post-apocalyptic': {
    audienceTags: ['末世', '丧尸', '囤物资', '庇护所', '杀伐果断'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['压抑', '残酷', '爽快'],
    relationshipDensity: 'low', // 极度缺乏信任
    hardConstraints: ['绝对不能有圣母情节', '物资消耗逻辑要合理', '主角必须自私'],
    softPreferences: ['喜欢看疯狂囤货', '喜欢看安全屋升级', '喜欢看反杀白眼狼'],
  },
  'suspense-thriller': {
    audienceTags: ['惊悚', '心理战', '连环杀手', '不可靠叙事'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['阴暗', '压抑', '疯狂'],
    relationshipDensity: 'medium', // 施害者与受害者的心理羁绊
    hardConstraints: ['动机必须立得住', '不能强行降智', '氛围不能断'],
    softPreferences: ['喜欢看高智商犯罪', '喜欢看心理防线崩溃'],
  },
  'horror': {
    audienceTags: ['规则怪谈', '克苏鲁', '逃生', '细思极恐'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['诡异', '绝望', '刺激'],
    relationshipDensity: 'low', // 孤独求生为主
    hardConstraints: ['不能靠纯血浆吓人', '规则必须有逻辑', '主角必须有反抗余地'],
    softPreferences: ['喜欢看日常中的异常', '喜欢看利用规则反杀诡异'],
  },
  'supernatural': {
    audienceTags: ['民俗', '风水', '鬼故事', '温情', '捉鬼'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['阴森', '神秘', '温情'],
    relationshipDensity: 'medium', // 人鬼情未了，师徒传承
    hardConstraints: ['民俗设定不能太离谱', '不能全都是坏鬼'],
    softPreferences: ['喜欢看鬼故事背后的真相', '喜欢看民间法术的展示'],
  },
  'adventure': {
    audienceTags: ['探险', '盗墓', '寻宝', '秘境', '求生'],
    protagonistFocusTags: ['male_lead', 'ensemble'],
    toneTags: ['神秘', '紧张', '震撼'],
    relationshipDensity: 'medium', // 探险小队的生死羁绊
    hardConstraints: ['地理/环境设定要合理', '危险不能全靠人为制造'],
    softPreferences: ['喜欢看发现未知文明的震撼', '喜欢看破解古老机关'],
  },
  'esports': {
    audienceTags: ['电竞', '比赛', '操作', '团队', '热血'],
    protagonistFocusTags: ['male_lead', 'ensemble'],
    toneTags: ['热血', '激情', '青春'],
    relationshipDensity: 'high', // 战队兄弟情是核心
    hardConstraints: ['游戏战术不能太外行', '不能全靠主角一个人一打五'],
    softPreferences: ['喜欢看极限反杀', '喜欢看夺冠时的全场欢呼'],
  },
  'vrmmo': {
    audienceTags: ['网游', '首杀', '爆装备', '隐藏职业', '公会战'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['爽快', '热血', '探索'],
    relationshipDensity: 'medium', // 公会兄弟与敌对势力
    hardConstraints: ['数值体系不能崩坏', '现实与游戏的逻辑要自洽'],
    softPreferences: ['喜欢看爆出极品神器的瞬间', '喜欢看全服通告的装逼感'],
  },
  'sports': {
    audienceTags: ['竞技', '热血', '成长', '突破极限', '冠军'],
    protagonistFocusTags: ['male_lead', 'ensemble'],
    toneTags: ['励志', '热血', '感动'],
    relationshipDensity: 'medium', // 队友、教练、对手
    hardConstraints: ['运动常识不能错', '不能完全靠开挂不训练'],
    softPreferences: ['喜欢看绝杀时刻', '喜欢看伤病复出后的王者归来'],
  },
  'superpower': {
    audienceTags: ['异能', '学院', '都市奇幻', '脑洞', '进化'],
    protagonistFocusTags: ['male_lead', 'ensemble'],
    toneTags: ['热血', '青春', '奇幻'],
    relationshipDensity: 'high', // 学院生活、团队合作
    hardConstraints: ['能力设定必须有代价/限制', '不能战力膨胀太快'],
    softPreferences: ['喜欢看弱能力玩出花', '喜欢看能力觉醒时的震惊全场'],
  },
  'epic': {
    audienceTags: ['群像', '权力游戏', '战争', '王朝兴衰', '宏大叙事'],
    protagonistFocusTags: ['ensemble'],
    toneTags: ['厚重', '悲壮', '史诗感'],
    relationshipDensity: 'high', // 复杂的家族、政治、盟友关系
    hardConstraints: ['多线叙事不能乱', '重要角色的死亡要有意义', '不能是单一爽文'],
    softPreferences: ['喜欢看大场面的战役', '喜欢看智商在线的权力博弈'],
  },
  'urban-romance': {
    audienceTags: ['甜宠', '撩人', '马甲', '破镜重圆', '打脸绿茶'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['高甜', '苏爽', '拉扯'],
    relationshipDensity: 'high', // 绝对核心是男女主互动
    hardConstraints: ['男主绝不能油腻', '女主不能是纯傻白甜', '误会必须长嘴能解开'],
    softPreferences: ['喜欢看男主吃醋', '喜欢看女主掉马甲震惊全场', '喜欢看极致偏爱'],
  },
  'ancient-romance': {
    audienceTags: ['宅斗', '宫斗', '重生复仇', '权臣', '王爷'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['古风', '步步惊心', '深情'],
    relationshipDensity: 'high', // 家族关系、后宫争斗、男女主
    hardConstraints: ['必须符合古代礼法逻辑', '女主反击必须有理有据', '文风不能太白话'],
    softPreferences: ['喜欢看手撕极品亲戚', '喜欢看男主用权力护妻', '喜欢看重生虐渣'],
  },
  'fantasy-romance': {
    audienceTags: ['仙侠恋', '虐恋', '师徒', '宿命', '三生三世'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['唯美', '虐心', '仙气'],
    relationshipDensity: 'high', // 跨越种族/阶级的绝对羁绊
    hardConstraints: ['虐心不能强行降智', '世界观设定必须服务于感情线', '必须HE'],
    softPreferences: ['喜欢看追妻火葬场', '喜欢看男主为女主对抗天下', '喜欢看身份反转'],
  },
  'children': {
    audienceTags: ['童话', '冒险', '魔法', '友谊', '成长'],
    protagonistFocusTags: ['ensemble'],
    toneTags: ['温暖', '明亮', '奇妙'],
    relationshipDensity: 'high', // 伙伴、宠物、家人
    hardConstraints: ['语言必须适合儿童', '不能有过度恐怖血腥', '不能生硬说教'],
    softPreferences: ['喜欢看奇妙的魔法设定', '喜欢看伙伴间的互助', '喜欢看战胜坏人'],
  },
};

const RAW_SYSTEM_SEEDS: SystemSeed[] = [
  // ── 有手写 Profile + Playbook 的标杆题材 ──
  {
    genreKey: 'xianxia', displayName: '仙侠', description: '传统仙侠、凡人流、洪荒流、修真文明',
    genreKeywords: ['仙侠', '修真', '凡人流', '长生', '法宝', '飞升', '天劫', '宗门', '道心', 'xianxia'],
    profile: XIANXIA_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['修真式：获取资源→闭关突破→外出历练/秘境寻宝→遭遇强敌→反杀夺宝'],
      goldenFingerGuidance: '仙侠金手指多为辅助修炼类（如神秘小瓶、熟练度面板），强调"财侣法地"的积累。',
      worldBuildingDirectives: '需要严密的境界体系（炼气、筑基、金丹等）和残酷的修真界黑森林法则。',
    },
    ruleAtoms: playbookDictToAtoms(XIANXIA_PLAYBOOKS),
  },
  {
    genreKey: 'xuanhuan', displayName: '玄幻', description: '东方玄幻、异界大陆、高武世界、御兽流',
    genreKeywords: ['玄幻', '异界', '高武', '血脉', '系统', '无敌', '退婚流', '装逼打脸', 'fantasy'],
    profile: XUANHUAN_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['逆袭式：被小看→获得奇遇→修炼升级→大比/决战打脸→换地图'],
      goldenFingerGuidance: '玄幻金手指应极其强大（老爷爷、至尊骨、顶级血脉），是越阶挑战的资本。',
      worldBuildingDirectives: '地图从小到大无限套娃（下界、上界、神界），力量体系多元（斗气、魂力等）。',
    },
    ruleAtoms: playbookDictToAtoms(XIANXIA_PLAYBOOKS),
  },
  {
    genreKey: 'urban', displayName: '都市现实', description: '都市重生、神豪、职场逆袭、捡漏、年代文',
    genreKeywords: ['都市', '现实', '神豪', '重生', '职场', '捡漏', '打脸', '年代文', 'urban'],
    profile: URBAN_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['逆袭式：现实困境→获得金手指/重生→财富地位跃升→打脸势利眼'],
      goldenFingerGuidance: '都市金手指多为神豪系统、未来记忆、透视眼等，直接转化为现实利益。',
      worldBuildingDirectives: '以现代社会为背景，强调金钱、人脉、权力的运作逻辑和阶层差异。',
    },
    ruleAtoms: playbookDictToAtoms(URBAN_PLAYBOOKS),
  },
  {
    genreKey: 'historical', displayName: '历史', description: '架空历史、朝堂权谋、种田争霸、科技碾压',
    genreKeywords: ['历史', '架空', '穿越', '权谋', '种田', '争霸', '科技', '名将', 'historical'],
    profile: HISTORICAL_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['争霸式：地狱开局→发明创造/展现才华→震惊古人→掌握权力→平定天下'],
      goldenFingerGuidance: '历史文最大的金手指是"现代知识"和"历史走向的先知"，偶尔辅以系统。',
      worldBuildingDirectives: '需要符合时代背景的服饰、礼仪、制度，以及合理的科技树攀升逻辑。',
    },
    ruleAtoms: playbookDictToAtoms(HISTORICAL_PLAYBOOKS),
  },
  {
    genreKey: 'western-fantasy', displayName: '西方奇幻', description: '剑与魔法、史诗奇幻、领主种田、异族',
    genreKeywords: ['奇幻', '魔法', '剑与魔法', '精灵', '巨龙', '领主', '史诗', 'western-fantasy'],
    profile: WESTERN_FANTASY_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['冒险式：接到使命→组建团队→探索未知→对抗邪恶势力'],
      goldenFingerGuidance: '西幻金手指多为特殊血脉、唯一魔法天赋或领主系统。',
      worldBuildingDirectives: '需要构建完整的魔法体系、多种族文化差异和神明/信仰体系。',
    },
    ruleAtoms: playbookDictToAtoms(WESTERN_FANTASY_PLAYBOOKS),
  },
  {
    genreKey: 'sci-fi', displayName: '科幻', description: '星际机甲、赛博朋克、基因飞升、末世废土',
    genreKeywords: ['科幻', '星际', '机甲', '赛博朋克', '基因', '进化', '废土', 'sci-fi'],
    profile: SCI_FI_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['进化式：生存危机→科技/基因突破→阶层跃升→星际争霸'],
      goldenFingerGuidance: '科幻金手指多为高级智脑、基因药剂、机械合成系统。',
      worldBuildingDirectives: '需要硬核的科技设定，强调科技对社会结构和人性的影响。',
    },
    ruleAtoms: playbookDictToAtoms(SCI_FI_PLAYBOOKS),
  },
  {
    genreKey: 'wuxia', displayName: '武侠', description: '传统武侠、高武世界、极道流、面板加点',
    genreKeywords: ['武侠', '高武', '极道', '江湖', '面板', '加点', '杀伐果断', 'wuxia'],
    profile: WUXIA_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['复仇/升级式：结怨→闭关加点→出关碾压→卷入更大江湖纷争'],
      goldenFingerGuidance: '武侠金手指多为熟练度面板、武学融合系统，强调"一力降十会"。',
      worldBuildingDirectives: '需要构建门派势力、江湖规矩和充满破坏力的武学体系。',
    },
    ruleAtoms: playbookDictToAtoms(WUXIA_PLAYBOOKS),
  },
  {
    genreKey: 'military', displayName: '战争/军事', description: '历史战争、现代战场、未来战争、特种兵、战争策略',
    genreKeywords: ['军事', '战争', '特种兵', '军旅', '战场', '策略', '谍战', '抗战', 'military', '战略'],
    profile: MILITARY_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '征战式：新兵入伍→首战洗礼→晋升指挥→战略博弈→决定性战役→战后重建',
        '谍战式：潜伏→情报收集→信任危机→身份暴露风险→关键抉择→任务完成',
      ],
      goldenFingerGuidance: '军事金手指可以是穿越者的现代军事知识、特殊战术天赋、情报网络，限制是后勤/兵力/政治约束。',
      worldBuildingDirectives: '需要真实可信的军事体系（编制/武器/战术）、地缘政治格局、后勤补给链，战争的残酷性和人性复杂性并重。',
    },
    ruleAtoms: playbookDictToAtoms(MILITARY_PLAYBOOKS),
  },
  {
    genreKey: 'mystery', displayName: '悬疑推理', description: '侦探推理、高智商犯罪、民俗悬疑、规则怪谈',
    genreKeywords: ['悬疑', '推理', '侦探', '犯罪', '智斗', '反转', 'mystery'],
    profile: MYSTERY_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['解谜式：发现异常→陷入危机→寻找线索→逻辑推理→反转破局'],
      goldenFingerGuidance: '悬疑文通常不依赖超自然金手指，主角的"高智商"和"观察力"就是外挂。',
      worldBuildingDirectives: '需要严密的逻辑链条、公平的线索呈现和意料之外的反转。',
    },
    ruleAtoms: playbookDictToAtoms(MYSTERY_PLAYBOOKS),
  },
  {
    genreKey: 'infinite-flow', displayName: '无限流', description: '主神空间、副本生存、诸天万界、轮回者',
    genreKeywords: ['无限流', '主神空间', '副本', '生存', '轮回', '智斗', '强化', 'infinite-flow'],
    profile: INFINITE_FLOW_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['轮回式：进入副本→摸索规则→智斗破局→回归结算→强化升级'],
      goldenFingerGuidance: '无限流金手指多为先知优势（知道剧情）或特殊天赋（如百倍奖励）。',
      worldBuildingDirectives: '需要设计风格各异的副本世界和严密的积分兑换/强化体系。',
    },
    ruleAtoms: playbookDictToAtoms(HORROR_PLAYBOOKS),
  },
  {
    genreKey: 'light-novel', displayName: '轻小说', description: '二次元、搞笑吐槽、反套路、日常修罗场',
    genreKeywords: ['轻小说', '二次元', '搞笑', '吐槽', '反套路', '日常', '修罗场', 'light-novel'],
    profile: LIGHT_NOVEL_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['日常式：平静日常→突发奇葩事件→全员脑补/搞笑解决→回归日常'],
      goldenFingerGuidance: '轻小说金手指往往带有搞笑属性（如"绝对选项"、"只会平A"）。',
      worldBuildingDirectives: '世界观可以夸张离谱，重点是角色属性的碰撞和轻松幽默的氛围。',
    },
    ruleAtoms: playbookDictToAtoms(URBAN_PLAYBOOKS),
  },
  {
    genreKey: 'post-apocalyptic', displayName: '末世危机', description: '丧尸末日、天灾求生、废土重建、囤物资',
    genreKeywords: ['末世', '丧尸', '天灾', '废土', '生存', '囤物资', '庇护所', 'post-apocalyptic'],
    profile: POST_APOCALYPTIC_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['生存式：危机爆发→疯狂囤货→建立庇护所→抵御尸潮/掠夺者'],
      goldenFingerGuidance: '末世金手指多为无限空间、合成系统、避难所升级系统。',
      worldBuildingDirectives: '需要营造物资极度匮乏、秩序崩坏、人性险恶的压抑氛围。',
    },
    ruleAtoms: playbookDictToAtoms(HORROR_PLAYBOOKS),
  },
  {
    genreKey: 'suspense-thriller', displayName: '悬疑惊悚', description: '心理惊悚、连环杀手、不可靠叙事、密室逃脱',
    genreKeywords: ['惊悚', '心理战', '连环杀手', '密室', '不可靠叙事', 'suspense-thriller'],
    profile: SUSPENSE_THRILLER_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['逃生式：陷入绝境→心理博弈→发现盲点→极限反杀/逃脱'],
      goldenFingerGuidance: '惊悚文极少有金手指，强调普通人在极端压力下的心理素质和智商。',
      worldBuildingDirectives: '需要营造极度压抑、封闭的空间感和细思极恐的心理氛围。',
    },
    ruleAtoms: playbookDictToAtoms(MYSTERY_PLAYBOOKS),
  },
  {
    genreKey: 'horror', displayName: '恐怖/规则怪谈', description: '规则怪谈、克苏鲁、民俗恐怖、灵异复苏',
    genreKeywords: ['恐怖', '规则怪谈', '克苏鲁', '灵异', '惊悚', '逃生', 'horror'],
    profile: HORROR_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['解谜求生式：发现异常→触碰规则→试错/献祭→找到漏洞→极限反杀'],
      goldenFingerGuidance: '恐怖文金手指多为提示系统、免疫污染、特殊道具（如染血的斧头）。',
      worldBuildingDirectives: '需要设计看似荒诞但逻辑自洽的怪谈规则，以及不可名状的恐惧感。',
    },
    ruleAtoms: playbookDictToAtoms(HORROR_PLAYBOOKS),
  },
  {
    genreKey: 'supernatural', displayName: '灵异/民俗', description: '风水秘术、捉鬼驱邪、民间传说、阴阳眼',
    genreKeywords: ['灵异', '民俗', '风水', '捉鬼', '道术', '阴阳眼', 'supernatural'],
    profile: SUPERNATURAL_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['单元剧式：接受委托→调查灵异事件→斗法/解开心结→超度/消灭'],
      goldenFingerGuidance: '灵异文金手指多为阴阳眼、祖传道术、神秘法器。',
      worldBuildingDirectives: '需要融入真实的民间习俗、风水八卦，营造"日常中的超自然"感。',
    },
    ruleAtoms: playbookDictToAtoms(SUPERNATURAL_PLAYBOOKS),
  },
  {
    genreKey: 'adventure', displayName: '冒险/探险', description: '盗墓寻宝、荒野求生、秘境探索、深海/太空探险',
    genreKeywords: ['冒险', '探险', '盗墓', '寻宝', '求生', '秘境', 'adventure'],
    profile: ADVENTURE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['探索式：获得线索→组建团队→克服自然天险→破解机关→获得宝藏/真相'],
      goldenFingerGuidance: '探险文金手指多为寻宝雷达、古老血脉、动植物沟通能力。',
      worldBuildingDirectives: '需要极其真实的地理/环境描写和专业的求生/探险知识。',
    },
    ruleAtoms: playbookDictToAtoms(ADVENTURE_PLAYBOOKS),
  },
  {
    genreKey: 'esports', displayName: '电子竞技', description: 'MOBA、FPS、职业联赛、冠军梦、退役复出',
    genreKeywords: ['电竞', '游戏', '比赛', '操作', '团队', '冠军', 'esports'],
    profile: ESPORTS_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['竞技式：日常训练→遭遇强敌→战术/操作突破→赢得比赛→冲击冠军'],
      goldenFingerGuidance: '电竞文金手指多为超强反应速度、战术模拟器、重生带回的先知版本理解。',
      worldBuildingDirectives: '需要真实的电竞生态（俱乐部、转会、舆论）和硬核的游戏战术描写。',
    },
    ruleAtoms: playbookDictToAtoms(GAME_PLAYBOOKS),
  },
  {
    genreKey: 'vrmmo', displayName: '虚拟网游', description: '全息网游、数据流、首杀、隐藏职业、公会争霸',
    genreKeywords: ['网游', '虚拟现实', '数据流', '首杀', '隐藏职业', '公会', 'vrmmo'],
    profile: VRMMO_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['升级打宝式：练级→触发隐藏任务→获得极品装备→公会战装逼'],
      goldenFingerGuidance: '网游文金手指多为唯一隐藏职业、超高幸运值、重生带来的攻略记忆。',
      worldBuildingDirectives: '需要严谨的数值体系、丰富的技能设定和庞大的玩家公会生态。',
    },
    ruleAtoms: playbookDictToAtoms(GAME_PLAYBOOKS),
  },
  {
    genreKey: 'sports', displayName: '体育竞技', description: '篮球、足球、田径、热血青春、体坛巨星',
    genreKeywords: ['体育', '竞技', '运动', '热血', '冠军', '巨星', 'sports'],
    profile: SPORTS_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['成长式：刻苦训练→遭遇挫折/伤病→突破极限→赛场绝杀'],
      goldenFingerGuidance: '体育文金手指多为身体素质强化系统、球星技能抽取面板。',
      worldBuildingDirectives: '需要专业的运动知识、真实的赛事赛制和令人热血沸腾的赛场描写。',
    },
    ruleAtoms: playbookDictToAtoms(SPORTS_PLAYBOOKS),
  },
  {
    genreKey: 'superpower', displayName: '超能力/异能', description: '都市异能、灵气复苏、异能学院、超级英雄',
    genreKeywords: ['超能力', '异能', '魔法学院', '觉醒', '超人', '变异', '能力者', 'superpower', '学院'],
    profile: SUPERPOWER_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['觉醒式：普通人→意外觉醒→能力失控→学习控制→卷入阵营斗争→守护/改变世界',
      '学院式：入学→分班/测试→天赋展露→校内竞争→外部威胁入侵→毕业大考'],
      goldenFingerGuidance: '超能力金手指是独特/稀有能力类型，进化路径是能力等级/新用法开发，限制是身体负荷/副作用/能量消耗。',
      worldBuildingDirectives: '需要能力分类体系（元素/精神/身体强化等）、能力者社会组织（学院/政府机构/地下组织）、普通人与能力者的社会关系。',
    },
    ruleAtoms: playbookDictToAtoms(SUPERPOWER_PLAYBOOKS),
  },
  {
    genreKey: 'epic', displayName: '史诗/传奇', description: '群像剧、权力游戏、王朝兴衰、文明碰撞',
    genreKeywords: ['史诗', '群像', '权谋', '战争', '王朝', '命运', 'epic'],
    profile: EPIC_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['多线交织式：多方势力布局→矛盾激化→爆发全面战争→旧秩序毁灭/新秩序建立'],
      goldenFingerGuidance: '史诗文极少有个人金手指，主角的"金手指"往往是其血脉、领袖魅力或时代气运。',
      worldBuildingDirectives: '需要极其宏大的世界观、错综复杂的势力关系和深刻的命运悲剧感。',
    },
    ruleAtoms: playbookDictToAtoms(EPIC_PLAYBOOKS),
  },
  {
    genreKey: 'urban-romance', displayName: '现代言情', description: '霸总甜宠、娱乐圈马甲、破镜重圆、先婚后爱',
    genreKeywords: ['现言', '甜宠', '霸总', '马甲', '娱乐圈', '破镜重圆', 'urban-romance'],
    profile: URBAN_ROMANCE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['拉扯式：相遇/重逢→暧昧试探→误会/危机→确认心意→高甜撒糖'],
      goldenFingerGuidance: '现言金手指多为女主的隐藏马甲（神医/黑客/顶级设计师）或男主的无底线偏爱。',
      worldBuildingDirectives: '需要营造浪漫的都市氛围，强调男女主之间的性张力和情绪价值。',
    },
    ruleAtoms: playbookDictToAtoms(ROMANCE_PLAYBOOKS),
  },
  {
    genreKey: 'ancient-romance', displayName: '古代言情', description: '宅斗宫斗、重生复仇、权臣宠妻、替嫁联姻',
    genreKeywords: ['古言', '宅斗', '宫斗', '重生', '复仇', '权臣', '王爷', 'ancient-romance'],
    profile: ANCIENT_ROMANCE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['复仇逆袭式：遭遇算计/重生→隐忍布局→绝地反击打脸→收获权力与爱情'],
      goldenFingerGuidance: '古言金手指多为重生先知、随身空间/灵泉，或男主滔天的权势。',
      worldBuildingDirectives: '需要符合古代封建礼教的背景，强调嫡庶尊卑和后宅/朝堂的阴谋算计。',
    },
    ruleAtoms: playbookDictToAtoms(ROMANCE_PLAYBOOKS),
  },
  {
    genreKey: 'fantasy-romance', displayName: '幻想言情', description: '仙侠虐恋、师徒禁忌、三生三世、人妖相恋',
    genreKeywords: ['幻言', '仙侠恋', '虐恋', '师徒', '宿命', '神魔', 'fantasy-romance'],
    profile: FANTASY_ROMANCE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['宿命式：相遇/收徒→暗生情愫→身份暴露/大劫降临→生离死别→重生/重逢'],
      goldenFingerGuidance: '幻言金手指多为女主隐藏的逆天血脉（如上古神女）或男主三界最强的战力。',
      worldBuildingDirectives: '需要唯美仙气的世界观，设定服务于制造跨越种族/宿命的爱情阻碍。',
    },
    ruleAtoms: playbookDictToAtoms(ROMANCE_PLAYBOOKS),
  },
  {
    genreKey: 'children', displayName: '儿童/少儿文学', description: '童话、魔法校园、动物拟人、成长冒险',
    genreKeywords: ['少儿', '童话', '魔法', '冒险', '友谊', '成长', 'children'],
    profile: CHILDREN_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['成长冒险式：平静生活→发现秘密/遇到麻烦→和小伙伴一起解决→获得成长'],
      goldenFingerGuidance: '少儿文金手指多为神奇的道具（如魔法棒）、会说话的动物伙伴。',
      worldBuildingDirectives: '需要充满想象力、色彩明亮的世界，传递勇敢、善良、友谊等正向价值观。',
    },
    ruleAtoms: playbookDictToAtoms(CHILDREN_PLAYBOOKS),
  },
];

const SYSTEM_SEEDS: SystemSeed[] = RAW_SYSTEM_SEEDS.map((seed) => ({
  ...seed,
  seedHints: {
    ...(seed.seedHints ?? {}),
    namingDefaults: seed.seedHints?.namingDefaults ?? getDefaultNamingDefaultsForGenre(seed.genreKey),
  },
  audienceMeta: seed.audienceMeta ?? GENRE_AUDIENCE_META[seed.genreKey] ?? GENRE_AUDIENCE_META.urban,
}));

@Injectable()
export class GenreProfileTemplateService implements OnModuleInit {
  private readonly logger = new Logger(GenreProfileTemplateService.name);
  private readonly matchingEnabled: boolean;
  private readonly maxAudienceInfluence: number;
  private readonly weightGenre: number;
  private readonly weightAudience: number;
  private readonly weightFocus: number;
  private readonly weightTone: number;

  constructor(
    @InjectRepository(GenreProfileTemplateEntity)
    private readonly repo: Repository<GenreProfileTemplateEntity>,
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    private readonly promptProfiler: PromptProfilerAgent,
  ) {
    this.matchingEnabled = this.config.get<boolean>('novel.audienceStrategy.enabled') !== false;
    this.maxAudienceInfluence = this.getNumCfg('novel.audienceStrategy.maxAudienceInfluence', 0.35);
    this.weightGenre = this.getNumCfg('novel.audienceStrategy.weight.genre', 0.55);
    this.weightAudience = this.getNumCfg('novel.audienceStrategy.weight.audience', 0.25);
    this.weightFocus = this.getNumCfg('novel.audienceStrategy.weight.protagonistFocus', 0.1);
    this.weightTone = this.getNumCfg('novel.audienceStrategy.weight.tone', 0.1);
  }

  async onModuleInit(): Promise<void> {
    await this.seedSystemTemplates();
    await this.backfillMissingNamingDefaults();
  }

  private getNumCfg(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    const val = Number(raw);
    return Number.isFinite(val) ? val : fallback;
  }

  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  private normalizeTags(tags?: string[]): string[] {
    return (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  }

  private mergeAudienceMeta(entity: GenreProfileTemplateEntity, meta?: Partial<AudienceDirectiveMeta>): void {
    if (!meta) return;
    if (meta.audienceTags) entity.audienceTags = meta.audienceTags;
    if (meta.protagonistFocusTags) entity.protagonistFocusTags = meta.protagonistFocusTags;
    if (meta.toneTags) entity.toneTags = meta.toneTags;
    if (meta.relationshipDensity) entity.relationshipDensity = meta.relationshipDensity;
    if (meta.hardConstraints) entity.hardConstraints = meta.hardConstraints;
    if (meta.softPreferences) entity.softPreferences = meta.softPreferences;
  }

  private resolveWeightsForGenre(genre: string): { genre: number; audience: number; focus: number; tone: number } {
    const g = genre.toLowerCase();
    const isHistorical = g.includes('历史') || g.includes('historical');
    const isMystery = g.includes('悬疑') || g.includes('推理') || g.includes('mystery');
    const isMilitary = g.includes('军事') || g.includes('战争') || g.includes('military');
    if (isHistorical || isMystery || isMilitary) return { genre: 0.65, audience: 0.2, focus: 0.1, tone: 0.05 };
    const isRomance = g.includes('言情') || g.includes('romance') || g.includes('爱情');
    if (isRomance) return { genre: 0.45, audience: 0.35, focus: 0.1, tone: 0.1 };
    return { genre: this.weightGenre, audience: this.weightAudience, focus: this.weightFocus, tone: this.weightTone };
  }

  private scoreTemplateMatch(
    template: GenreProfileTemplateEntity,
    input: { genre: string; targetAudience?: string; protagonistFocus?: string; tonePreference?: string; audienceTags?: string[] },
  ): { total: number; detail: Record<string, number> } {
    const genreText = input.genre.toLowerCase();
    const audienceText = (input.targetAudience ?? '').toLowerCase();
    const toneText = (input.tonePreference ?? '').toLowerCase();
    const inputTags = new Set(this.normalizeTags(input.audienceTags));
    const tplAudienceList = template.audienceTags ?? [];
    const tplFocusList = template.protagonistFocusTags ?? [];
    const tplToneList = template.toneTags ?? [];
    const tplAudience = new Set(this.normalizeTags(tplAudienceList));
    const tplTone = new Set(this.normalizeTags(tplToneList));
    const genreScore = (template.genreKeywords ?? []).some((kw) => genreText.includes(kw.toLowerCase())) ? 1 : 0;
    let audienceScore = 0;
    if (audienceText && tplAudienceList.length) {
      const matched = tplAudienceList.filter((tag) => audienceText.includes(tag.toLowerCase())).length;
      audienceScore = matched / Math.max(1, tplAudienceList.length);
    }
    if (inputTags.size > 0 && tplAudience.size > 0) {
      let overlap = 0;
      for (const tag of inputTags) if (tplAudience.has(tag)) overlap += 1;
      audienceScore = Math.max(audienceScore, overlap / Math.max(1, inputTags.size));
    }
    let focusScore = 0;
    if (input.protagonistFocus && tplFocusList.length) {
      focusScore = tplFocusList.includes(input.protagonistFocus as any) ? 1 : 0;
    }
    let toneScore = 0;
    if (toneText && tplToneList.length) {
      const matched = tplToneList.filter((tag) => toneText.includes(tag.toLowerCase())).length;
      toneScore = matched / Math.max(1, tplToneList.length);
    }
    const w = this.resolveWeightsForGenre(input.genre);
    const cappedAudienceWeight = Math.min(w.audience, this.maxAudienceInfluence);
    const total = this.clamp(
      genreScore * w.genre + audienceScore * cappedAudienceWeight + focusScore * w.focus + toneScore * w.tone,
      0,
      1,
    );
    return {
      total,
      detail: {
        genre: Number((genreScore * w.genre).toFixed(4)),
        audience: Number((audienceScore * cappedAudienceWeight).toFixed(4)),
        protagonistFocus: Number((focusScore * w.focus).toFixed(4)),
        tone: Number((toneScore * w.tone).toFixed(4)),
      },
    };
  }

  async seedSystemTemplates(): Promise<void> { // 启动时同步系统预置模板；增量补充所有空字段（v2: genreKey 修正）
    const pending: SystemSeed[] = [];
    const profilePending: { seed: SystemSeed; entity: GenreProfileTemplateEntity }[] = [];
    let updatedCount = 0;
    let createdCount = 0;
    for (const seed of SYSTEM_SEEDS) {
      const exists = await this.repo.findOneBy({ userId: IsNull() as any, genreKey: seed.genreKey });
      if (exists) {
        let needSave = false;
        if (exists.displayName !== seed.displayName || exists.description !== seed.description || !isSameJson(exists.genreKeywords, seed.genreKeywords)) {
          exists.displayName = seed.displayName;
          exists.description = seed.description;
          exists.genreKeywords = seed.genreKeywords;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 displayName/description/genreKeywords: ${seed.displayName}`);
        }
        if (seed.ruleAtoms?.length && !isSameJson(exists.ruleAtoms ?? [], seed.ruleAtoms)) {
          exists.ruleAtoms = seed.ruleAtoms;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 ruleAtoms: ${seed.displayName}`);
        }
        const profileEmpty = !exists.profileJson || !Object.keys(exists.profileJson).length || !('writerGuide' in exists.profileJson);
        if (seed.profile && !isSameJson(exists.profileJson ?? {}, seed.profile as unknown as Record<string, unknown>)) {
          exists.profileJson = seed.profile as unknown as Record<string, unknown>;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 profileJson: ${seed.displayName}`);
        } else if (profileEmpty && !seed.profile) {
          profilePending.push({ seed, entity: exists });
        }
        const desiredCache = GenreProfileTemplateService.buildDefaultAgentSections(exists.ruleAtoms ?? [], seed.genreKey);
        if (!isSameJson(exists.cachedAgentSections ?? null, desiredCache)) {
          exists.cachedAgentSections = desiredCache;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 cachedAgentSections: ${seed.displayName}`);
        }
        if (!isSameJson({
          audienceTags: exists.audienceTags ?? [],
          protagonistFocusTags: exists.protagonistFocusTags ?? [],
          toneTags: exists.toneTags ?? [],
          relationshipDensity: exists.relationshipDensity ?? 'medium',
          hardConstraints: exists.hardConstraints ?? [],
          softPreferences: exists.softPreferences ?? [],
        }, seed.audienceMeta)) {
          this.mergeAudienceMeta(exists, seed.audienceMeta);
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 audienceMeta: ${seed.displayName}`);
        }
        if (seed.seedHints && !isSameJson(exists.seedHints ?? {}, seed.seedHints)) {
          exists.seedHints = seed.seedHints;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 seedHints: ${seed.displayName}`);
        }
        if (needSave) {
          exists.systemVersion += 1;
          await this.repo.save(exists);
          updatedCount += 1;
        }
        continue;
      }
      if (seed.profile) {
        await this.repo.save(this.repo.create({
          userId: null, genreKey: seed.genreKey, displayName: seed.displayName,
          description: seed.description, genreKeywords: seed.genreKeywords,
          profileJson: seed.profile as unknown as Record<string, unknown>,
          seedHints: seed.seedHints, ruleAtoms: seed.ruleAtoms ?? [],
          cachedAgentSections: GenreProfileTemplateService.buildDefaultAgentSections(seed.ruleAtoms, seed.genreKey),
          audienceTags: seed.audienceMeta?.audienceTags ?? [],
          protagonistFocusTags: seed.audienceMeta?.protagonistFocusTags ?? [],
          toneTags: seed.audienceMeta?.toneTags ?? [],
          relationshipDensity: seed.audienceMeta?.relationshipDensity ?? 'medium',
          hardConstraints: seed.audienceMeta?.hardConstraints ?? [],
          softPreferences: seed.audienceMeta?.softPreferences ?? [],
          isSystem: true, parentTemplateId: null, systemVersion: 1,
        }));
        createdCount += 1;
        this.logger.log(`[seed] 系统模板已创建(含默认 agentSections): ${seed.displayName}`);
      } else {
        pending.push(seed);
      }
    }
    this.logger.log(`[seed] 启动同步完成: updated=${updatedCount}, created=${createdCount}, pendingAi=${pending.length}, emptyProfileAi=${profilePending.length}`);
    if (pending.length) {
      this.logger.log(`[seed] ${pending.length} 个题材需 AI 生成 Profile，开始后台生成...`);
      this.aiSeedPending(pending).catch((err) => this.logger.error(`[seed] AI 批量生成异常: ${err.message}`));
    }
    if (profilePending.length) {
      this.logger.log(`[seed] ${profilePending.length} 个题材 Profile 为空，后台 AI 补充生成...`);
      this.aiRefreshEmptyProfiles(profilePending).catch((err) => this.logger.error(`[seed] AI 补充 Profile 异常: ${err.message}`));
    }
  }

  static buildDefaultAgentSections(ruleAtoms?: RuleAtom[], genreKey?: string): CachedAgentSections {
    const pack = buildDefaultRulePack(ruleAtoms);
    const sections: Array<{ agentId: string; key: string; content: string }> = [];
    for (const [agentId, cfg] of Object.entries(pack.agents)) {
      for (const sec of cfg.sections) {
        if (!sec.isLocked) sections.push({ agentId, key: sec.key, content: sec.content });
      }
    }
    if (genreKey && GENRE_AGENT_OVERRIDES[genreKey]) {
      for (const ov of GENRE_AGENT_OVERRIDES[genreKey]) {
        const idx = sections.findIndex((s) => s.agentId === ov.agentId && s.key === ov.key);
        if (idx >= 0) sections[idx] = { ...ov };
        else sections.push({ ...ov });
      }
    }
    return { sections, ruleAtoms: ruleAtoms ?? [] };
  }

  private async aiRefreshEmptyProfiles(items: { seed: SystemSeed; entity: GenreProfileTemplateEntity }[]): Promise<void> {
    for (const { seed, entity } of items) {
      try {
        this.logger.log(`[seed] AI 补充 Profile: ${seed.displayName}...`);
        const result = await this.aiGenerate({ genreName: seed.displayName, styleDescription: seed.description, targetAudience: '通用网文读者' });
        entity.profileJson = result.profileJson;
        entity.seedHints = entity.seedHints ?? result.seedHints;
        entity.cachedAgentSections = result.cachedAgentSections ?? entity.cachedAgentSections;
        this.mergeAudienceMeta(entity, seed.audienceMeta);
        entity.systemVersion += 1;
        await this.repo.save(entity);
        this.logger.log(`[seed] AI 补充 Profile 完成: ${seed.displayName} (v${entity.systemVersion})`);
      } catch (err: any) {
        this.logger.warn(`[seed] AI 补充 Profile 失败: ${seed.displayName} — ${err.message}`);
      }
    }
  }

  private async aiSeedPending(seeds: SystemSeed[]): Promise<void> {
    for (const seed of seeds) {
      let profileJson: Record<string, unknown> = {};
      let ruleAtoms: RuleAtom[] = seed.ruleAtoms?.length ? seed.ruleAtoms : []; // 手写 ruleAtoms 优先
      let cachedAgentSections: CachedAgentSections | null = null;
      let seedHints = seed.seedHints;
      try {
        this.logger.log(`[seed] AI 生成中: ${seed.displayName}...`);
        const result = await this.aiGenerate({ genreName: seed.displayName, styleDescription: seed.description, targetAudience: '通用网文读者' });
        profileJson = result.profileJson;
        if (!seed.ruleAtoms?.length) ruleAtoms = result.ruleAtoms; // 仅无手写数据时用 AI 生成
        cachedAgentSections = result.cachedAgentSections ?? null;
        seedHints = seed.seedHints ?? result.seedHints;
        this.logger.log(`[seed] AI 生成完成: ${seed.displayName}`);
      } catch (err: any) {
        this.logger.warn(`[seed] AI 生成失败（用空 Profile 兜底入库）: ${seed.displayName} — ${err.message}`);
      }
      await this.repo.save(this.repo.create({
        userId: null, genreKey: seed.genreKey, displayName: seed.displayName,
        description: seed.description, genreKeywords: seed.genreKeywords,
        profileJson, seedHints, ruleAtoms, cachedAgentSections,
        audienceTags: seed.audienceMeta?.audienceTags ?? [],
        protagonistFocusTags: seed.audienceMeta?.protagonistFocusTags ?? [],
        toneTags: seed.audienceMeta?.toneTags ?? [],
        relationshipDensity: seed.audienceMeta?.relationshipDensity ?? 'medium',
        hardConstraints: seed.audienceMeta?.hardConstraints ?? [],
        softPreferences: seed.audienceMeta?.softPreferences ?? [],
        isSystem: true, parentTemplateId: null, systemVersion: 1,
      }));
    }
  }

  async list(userId: string): Promise<(GenreProfileTemplateEntity & { hasSystemUpdate?: boolean })[]> {
    await this.syncSystemTemplates(userId); // 增量同步：首次拉起或系统新增/更新模板时自动补齐
    const userTpls = await this.repo.find({ where: { userId }, order: { displayName: 'ASC' } });
    const systemTpls = await this.repo.find({ where: { userId: IsNull() as any, isSystem: true } });
    const sysMap = new Map(systemTpls.map((s) => [s.id, s]));
    return userTpls.map((t) => {
      const sys = t.parentTemplateId ? sysMap.get(t.parentTemplateId) : null;
      const hasSystemUpdate = sys ? sys.systemVersion > t.syncedSystemVersion && t.isUserModified : false;
      return Object.assign(t, { hasSystemUpdate });
    });
  }

  /** 将所有系统种子模板同步到用户名下（幂等，缺失的新建，未改动的静默更新） */
  async syncSystemTemplates(userId: string): Promise<void> {
    const systemTpls = await this.repo.find({ where: { userId: IsNull() as any, isSystem: true } });
    const userTpls = await this.repo.find({ where: { userId } });
    const userByParent = new Map(userTpls.filter((t) => t.parentTemplateId).map((t) => [t.parentTemplateId!, t]));
    for (const sys of systemTpls) {
      const existing = userByParent.get(sys.id);
      if (!existing) {
        await this.repo.save(this.repo.create({
          userId, genreKey: sys.genreKey, displayName: sys.displayName, description: sys.description,
          genreKeywords: [...sys.genreKeywords], profileJson: JSON.parse(JSON.stringify(sys.profileJson)),
          seedHints: sys.seedHints ? JSON.parse(JSON.stringify(sys.seedHints)) : null,
          ruleAtoms: sys.ruleAtoms?.length ? JSON.parse(JSON.stringify(sys.ruleAtoms)) : [],
          cachedAgentSections: sys.cachedAgentSections ? JSON.parse(JSON.stringify(sys.cachedAgentSections)) : null,
          audienceTags: [...(sys.audienceTags ?? [])],
          protagonistFocusTags: [...(sys.protagonistFocusTags ?? [])],
          toneTags: [...(sys.toneTags ?? [])],
          relationshipDensity: sys.relationshipDensity ?? 'medium',
          hardConstraints: [...(sys.hardConstraints ?? [])],
          softPreferences: [...(sys.softPreferences ?? [])],
          isSystem: false, parentTemplateId: sys.id,
          systemVersion: 1, syncedSystemVersion: sys.systemVersion, isUserModified: false,
        }));
        continue;
      }
      const versionBehind = sys.systemVersion > existing.syncedSystemVersion;
      const agentOutdated = !isSameJson(existing.cachedAgentSections ?? null, sys.cachedAgentSections ?? null);
      if ((versionBehind || agentOutdated) && !existing.isUserModified) {
        existing.displayName = sys.displayName; existing.description = sys.description;
        existing.genreKeywords = [...sys.genreKeywords];
        existing.profileJson = JSON.parse(JSON.stringify(sys.profileJson));
        existing.seedHints = sys.seedHints ? JSON.parse(JSON.stringify(sys.seedHints)) : null;
        existing.ruleAtoms = sys.ruleAtoms?.length ? JSON.parse(JSON.stringify(sys.ruleAtoms)) : [];
        existing.cachedAgentSections = sys.cachedAgentSections ? JSON.parse(JSON.stringify(sys.cachedAgentSections)) : null;
        existing.audienceTags = [...(sys.audienceTags ?? [])];
        existing.protagonistFocusTags = [...(sys.protagonistFocusTags ?? [])];
        existing.toneTags = [...(sys.toneTags ?? [])];
        existing.relationshipDensity = sys.relationshipDensity ?? 'medium';
        existing.hardConstraints = [...(sys.hardConstraints ?? [])];
        existing.softPreferences = [...(sys.softPreferences ?? [])];
        existing.syncedSystemVersion = sys.systemVersion;
        await this.repo.save(existing);
      }
    }
  }

  async getById(id: string): Promise<GenreProfileTemplateEntity> {
    const entity = await this.repo.findOneBy({ id });
    if (!entity) throw new NotFoundException(`模板不存在: ${id}`);
    return entity;
  }

  async create(userId: string, dto: {
    genreKey: string; displayName: string; description?: string;
    genreKeywords?: string[]; profileJson: Record<string, unknown>;
    seedHints?: SeedAnalyzerHints; ruleAtoms?: RuleAtom[];
    audienceMeta?: Partial<AudienceDirectiveMeta>;
  }): Promise<GenreProfileTemplateEntity> {
    const existing = await this.repo.findOneBy({ userId, genreKey: dto.genreKey });
    if (existing) throw new BadRequestException(`你已有 genreKey="${dto.genreKey}" 的模板，请编辑或删除后重建`);
    if (!dto.audienceMeta?.audienceTags?.length || !dto.audienceMeta?.protagonistFocusTags?.length || !dto.audienceMeta?.toneTags?.length) {
      throw new BadRequestException('新建模板必须提供 audienceMeta（audienceTags/protagonistFocusTags/toneTags）');
    }
    return this.repo.save(this.repo.create({
      userId, genreKey: dto.genreKey, displayName: dto.displayName,
      description: dto.description ?? '', genreKeywords: dto.genreKeywords ?? [],
      profileJson: dto.profileJson, seedHints: ensureSeedHintsNamingDefaults(dto.seedHints, dto.genreKey),
      ruleAtoms: dto.ruleAtoms ?? [], isSystem: false, parentTemplateId: null,
      audienceTags: dto.audienceMeta.audienceTags ?? [],
      protagonistFocusTags: dto.audienceMeta.protagonistFocusTags ?? [],
      toneTags: dto.audienceMeta.toneTags ?? [],
      relationshipDensity: dto.audienceMeta.relationshipDensity ?? 'medium',
      hardConstraints: dto.audienceMeta.hardConstraints ?? [],
      softPreferences: dto.audienceMeta.softPreferences ?? [],
    }));
  }

  async update(id: string, userId: string, dto: {
    displayName?: string; description?: string; genreKeywords?: string[];
    profileJson?: Record<string, unknown>; seedHints?: SeedAnalyzerHints;
    ruleAtoms?: RuleAtom[]; cachedAgentSections?: CachedAgentSections;
    audienceMeta?: Partial<AudienceDirectiveMeta>;
  }): Promise<GenreProfileTemplateEntity> {
    const entity = await this.getById(id);
    if (entity.userId !== userId) throw new BadRequestException('只能编辑自己的模板');
    if (dto.displayName !== undefined) entity.displayName = dto.displayName;
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.genreKeywords !== undefined) entity.genreKeywords = dto.genreKeywords;
    if (dto.profileJson !== undefined) entity.profileJson = dto.profileJson;
    if (dto.seedHints !== undefined) entity.seedHints = ensureSeedHintsNamingDefaults(dto.seedHints, entity.genreKey);
    if (dto.ruleAtoms !== undefined) entity.ruleAtoms = dto.ruleAtoms;
    if (dto.cachedAgentSections !== undefined) entity.cachedAgentSections = dto.cachedAgentSections;
    if (dto.audienceMeta) this.mergeAudienceMeta(entity, dto.audienceMeta);
    const profileOrRulesChanged = dto.profileJson !== undefined || dto.ruleAtoms !== undefined;
    if (profileOrRulesChanged) entity.cachedAgentSections = null;
    entity.seedHints = ensureSeedHintsNamingDefaults(entity.seedHints, entity.genreKey);
    entity.isUserModified = true;
    return this.repo.save(entity);
  }

  async remove(id: string, userId: string): Promise<void> {
    const entity = await this.getById(id);
    if (entity.userId !== userId) throw new BadRequestException('只能删除自己的模板');
    await this.repo.remove(entity);
  }

  /** 获取用户模板与源系统模板的差异 */
  async getSystemDiff(id: string, userId: string): Promise<{ userTemplate: GenreProfileTemplateEntity; systemTemplate: GenreProfileTemplateEntity } | null> {
    const entity = await this.getById(id);
    if (entity.userId !== userId || !entity.parentTemplateId) return null;
    const sys = await this.repo.findOneBy({ id: entity.parentTemplateId });
    if (!sys) return null;
    return { userTemplate: entity, systemTemplate: sys };
  }

  /** 用系统最新版覆盖用户模板（重置为系统版本） */
  async syncFromSystem(id: string, userId: string): Promise<GenreProfileTemplateEntity> {
    const entity = await this.getById(id);
    if (entity.userId !== userId || !entity.parentTemplateId) throw new BadRequestException('此模板无法同步系统版本');
    const sys = await this.repo.findOneBy({ id: entity.parentTemplateId });
    if (!sys) throw new NotFoundException('源系统模板不存在');
    entity.displayName = sys.displayName; entity.description = sys.description;
    entity.genreKeywords = [...sys.genreKeywords];
    entity.profileJson = JSON.parse(JSON.stringify(sys.profileJson));
    entity.seedHints = sys.seedHints ? JSON.parse(JSON.stringify(sys.seedHints)) : null;
    entity.ruleAtoms = sys.ruleAtoms?.length ? JSON.parse(JSON.stringify(sys.ruleAtoms)) : [];
    entity.cachedAgentSections = sys.cachedAgentSections ? JSON.parse(JSON.stringify(sys.cachedAgentSections)) : null;
    entity.audienceTags = [...(sys.audienceTags ?? [])];
    entity.protagonistFocusTags = [...(sys.protagonistFocusTags ?? [])];
    entity.toneTags = [...(sys.toneTags ?? [])];
    entity.relationshipDensity = sys.relationshipDensity ?? 'medium';
    entity.hardConstraints = [...(sys.hardConstraints ?? [])];
    entity.softPreferences = [...(sys.softPreferences ?? [])];
    entity.syncedSystemVersion = sys.systemVersion;
    entity.isUserModified = false;
    return this.repo.save(entity);
  }

  async clone(id: string, userId: string): Promise<GenreProfileTemplateEntity> {
    const source = await this.getById(id);
    const newKey = `${source.genreKey}_${Date.now().toString(36)}`;
    return this.repo.save(this.repo.create({
      userId, genreKey: newKey, displayName: `${source.displayName}（副本）`,
      description: source.description, genreKeywords: [...source.genreKeywords],
      profileJson: JSON.parse(JSON.stringify(source.profileJson)),
      seedHints: source.seedHints ? JSON.parse(JSON.stringify(source.seedHints)) : null,
      ruleAtoms: source.ruleAtoms?.length ? JSON.parse(JSON.stringify(source.ruleAtoms)) : [],
      cachedAgentSections: source.cachedAgentSections ? JSON.parse(JSON.stringify(source.cachedAgentSections)) : null,
      audienceTags: [...(source.audienceTags ?? [])],
      protagonistFocusTags: [...(source.protagonistFocusTags ?? [])],
      toneTags: [...(source.toneTags ?? [])],
      relationshipDensity: source.relationshipDensity ?? 'medium',
      hardConstraints: [...(source.hardConstraints ?? [])],
      softPreferences: [...(source.softPreferences ?? [])],
      isSystem: false, parentTemplateId: source.parentTemplateId ?? source.id,
      syncedSystemVersion: source.syncedSystemVersion, isUserModified: false,
    }));
  }

  async findBestMatchWithScore(
    input: { genre: string; targetAudience?: string; protagonistFocus?: string; tonePreference?: string; audienceTags?: string[] },
    userId?: string,
  ): Promise<{ template: GenreProfileTemplateEntity | null; score: number; detail?: Record<string, number> }> {
    if (userId) await this.syncSystemTemplates(userId); // 确保用户模板已同步
    const all = userId ? await this.repo.findBy({ userId }) : await this.repo.findBy({ isSystem: true });
    if (!all.length) return { template: null, score: 0 };
    if (!this.matchingEnabled) return { template: all[0], score: 1, detail: { genre: 1, audience: 0, protagonistFocus: 0, tone: 0 } };
    let winner = all[0];
    let winnerScore = -1;
    let winnerDetail: Record<string, number> | undefined;
    for (const t of all) {
      const scored = this.scoreTemplateMatch(t, input);
      if (scored.total > winnerScore) {
        winner = t;
        winnerScore = scored.total;
        winnerDetail = scored.detail;
      }
    }
    return { template: winner, score: Number(winnerScore.toFixed(4)), detail: winnerDetail };
  }

  async findBestMatch(
    genreOrInput: string | { genre: string; targetAudience?: string; protagonistFocus?: string; tonePreference?: string; audienceTags?: string[] },
    userId?: string,
  ): Promise<GenreProfileTemplateEntity | null> {
    const input = typeof genreOrInput === 'string' ? { genre: genreOrInput } : genreOrInput;
    const result = await this.findBestMatchWithScore(input, userId);
    return result.template;
  }

  async getSeedHintsForGenre(
    genreOrInput: string | { genre: string; targetAudience?: string; protagonistFocus?: string; tonePreference?: string; audienceTags?: string[] },
    userId?: string,
  ): Promise<SeedAnalyzerHints | null> {
    const tpl = await this.findBestMatch(genreOrInput, userId);
    if (tpl?.seedHints) return ensureSeedHintsNamingDefaults(tpl.seedHints, tpl.genreKey);
    const g = (typeof genreOrInput === 'string' ? genreOrInput : genreOrInput.genre).toLowerCase();
    const staticMatch = SYSTEM_SEEDS.find((s) => s.genreKeywords.some((kw) => g.includes(kw)));
    if (staticMatch?.seedHints) return ensureSeedHintsNamingDefaults(staticMatch.seedHints, staticMatch.genreKey);
    return ensureSeedHintsNamingDefaults(null, g);
  }

  private async backfillMissingNamingDefaults(): Promise<void> {
    const all = await this.repo.find();
    let patched = 0;
    for (const tpl of all) {
      const next = ensureSeedHintsNamingDefaults(tpl.seedHints, tpl.genreKey || tpl.displayName);
      if (!isSameJson(tpl.seedHints ?? {}, next)) {
        tpl.seedHints = next;
        await this.repo.save(tpl);
        patched += 1;
      }
    }
    if (patched > 0) this.logger.log(`[seedHints] 已回填 namingDefaults: ${patched} 条模板`);
  }

  /** 确保模板有 cachedAgentSections（无则从默认模板+题材覆盖填充），供 createBook 直接使用 */
  async ensureCachedAgentSections(tpl: GenreProfileTemplateEntity): Promise<CachedAgentSections> {
    if (tpl.cachedAgentSections?.sections?.length) return tpl.cachedAgentSections;
    tpl.cachedAgentSections = GenreProfileTemplateService.buildDefaultAgentSections(tpl.ruleAtoms, tpl.genreKey);
    await this.repo.save(tpl);
    this.logger.log(`[ensureCache] 模板 ${tpl.displayName} 已填充题材定制 agentSections (${tpl.cachedAgentSections.sections.length} 条)`);
    return tpl.cachedAgentSections;
  }

  async aiGenerate(dto: {
    genreName: string; styleDescription?: string; referenceWorks?: string[];
    targetAudience?: string; baseTemplateId?: string; userId?: string;
  }): Promise<{ profileJson: Record<string, unknown>; seedHints: SeedAnalyzerHints; ruleAtoms: RuleAtom[]; cachedAgentSections: CachedAgentSections | null }> {
    let baseRef: string | null = null;
    if (dto.baseTemplateId) {
      const base = await this.getById(dto.baseTemplateId);
      baseRef = formatProfileAsExample(base.profileJson as unknown as BookPromptProfile);
    }
    // 第一阶段：生成轻量题材画像
    const portraitSchema = z.object({
      coreIdentitySummary: z.string(),
      keyGenreTraits: z.array(z.string()).min(3),
      satisfactionKeywords: z.array(z.string()).min(3),
      hookKeywords: z.array(z.string()).min(3),
      clicheKeywords: z.array(z.string()).min(3),
      referenceAuthors: z.array(z.string()),
      suggestedCoreLoops: z.array(z.string()).min(1),
      goldenFingerStyle: z.string(),
      worldBuildingStyle: z.string(),
    });
    const portrait = await this.llm.generateStructured({
      taskName: 'genre-portrait',
      schema: portraitSchema,
      tags: ['setup', 'genre-portrait'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位资深网文编辑，精通各类题材的写作规律。请根据用户描述的题材生成一份"题材画像"——提炼该题材最核心的特征。`,
      userPrompt: `题材：${dto.genreName}
${dto.styleDescription ? `风格描述：${dto.styleDescription}` : ''}
${dto.referenceWorks?.length ? `参考作品：${dto.referenceWorks.join('、')}` : ''}
${dto.targetAudience ? `目标读者：${dto.targetAudience}` : ''}

请生成题材画像 JSON：
- coreIdentitySummary: 一段话描述理想写手身份
- keyGenreTraits: 5-8个题材核心特征
- satisfactionKeywords: 5-8个读者爽感关键词
- hookKeywords: 5-8个章末钩子关键词
- clicheKeywords: 5-8个该题材常见套话
- referenceAuthors: 该题材代表作家
- suggestedCoreLoops: 1-3个核心循环模式（格式："名称：步骤描述"）
- goldenFingerStyle: 金手指风格建议
- worldBuildingStyle: 世界观构建建议`,
      temperature: 0.5,
    });

    // 第二阶段：用画像生成完整 BookPromptProfile
    const enrichedSystemPrompt = `你是一位资深的网文编辑总监。请为「${dto.genreName}」题材生成完整的 BookPromptProfile。

=== 题材画像（第一阶段分析结果） ===
写手身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.satisfactionKeywords.join('、')}
钩子关键词：${portrait.hookKeywords.join('、')}
代表作家：${portrait.referenceAuthors.join('、')}

${baseRef ? `=== 参考范例 ===\n${baseRef}\n` : ''}

=== 输出要求 ===
生成完整的 BookPromptProfile JSON，所有内容必须为「${dto.genreName}」题材量身定制：
1. writerGuide: coreIdentity/genreRules(5-8条)/pacingGuide/dialogueGuide/craftExamples(4-6组bad/good/rule)/toneGuide
2. satisfactionTypes(5-8种): id/label/description
3. hookTypes(5-8种): id/label/description
4. clichePatterns(8+): pattern/maxPerChapter
5. reviewerCalibration: dimensionWeights(根据题材调权重)/genreSpecificChecks/scoringAnchors
6. worldProfile: organizationTypes/powerSystemApplicable/goldenFingerApplicable/commitmentTypes/characterRelationEmphasis
7. styleReferenceTexts(2-3段): 理想文风示范
8. chapterTypeTemplates: climax/setup/rising/relief 四种模板
9. firstChaptersStrategy: 前3章策略
10. audienceReactionGuide: 观众反应写法`;

    const profileRaw = await this.llm.generateStructured({
      taskName: 'genre-profile-ai-generate',
      schema: bookPromptProfileSchema,
      tags: ['setup', 'profile', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: enrichedSystemPrompt,
      userPrompt: `题材：${dto.genreName}\n目标读者：${dto.targetAudience ?? '通用网文读者'}\n\n请生成完整 BookPromptProfile JSON。generatedForGenre 填 "${dto.genreName}"，generatedForAudience 填目标读者描述。`,
      temperature: 0.6,
    });

    const seedHints: SeedAnalyzerHints = {
      coreLoopPatterns: portrait.suggestedCoreLoops,
      goldenFingerGuidance: portrait.goldenFingerStyle,
      worldBuildingDirectives: portrait.worldBuildingStyle,
      namingDefaults: getDefaultNamingDefaultsForGenre(dto.genreName),
    };

    // 第三阶段：生成题材定制 Playbook（全部 7 种）
    const playbookSchema = z.object({
      PROSE_CRAFT_PLAYBOOK: z.string(),
      CHARACTER_ARC_PLAYBOOK: z.string(),
      WRITING_SOUL_PLAYBOOK: z.string(),
      EDITOR_DISCIPLINE_PLAYBOOK: z.string(),
      REVIEWER_RUBRIC_PLAYBOOK: z.string(),
      CONTINUITY_BASELINE_PLAYBOOK: z.string(),
      THREAD_AWARENESS_PLAYBOOK: z.string(),
    });
    const playbooks = await this.llm.generateStructured({
      taskName: 'genre-playbook-generate',
      schema: playbookSchema,
      tags: ['setup', 'playbook', 'ai-generate'],
      metadata: { userId: dto.userId },
      systemPrompt: `你是一位资深网文编辑总监。请为「${dto.genreName}」题材生成7个 Playbook 的题材定制版。

写手身份：${portrait.coreIdentitySummary}
核心特征：${portrait.keyGenreTraits.join('、')}
爽感关键词：${portrait.satisfactionKeywords.join('、')}

每个 Playbook 必须为该题材量身定制——正反例、术语、评分锚点都要用该题材的语境。`,
      userPrompt: `请生成 JSON，包含以下7个字段（每个为完整的 Playbook 文本）：

1. PROSE_CRAFT_PLAYBOOK（800-1500字）：9个技法——展示而非讲述（用题材场景做正反例）、对白技法（匹配题材社交模式）、句式节奏（匹配题材张力模式）、感官叠加（题材独有感官）、环境映射情绪、留白术、多层次烘托（用题材最自然的烘托方式，不要照搬玄幻的"修为层级反应"）、金句意识、杀死AI味（加该题材特有套话黑名单）。

2. CHARACTER_ARC_PLAYBOOK（200-500字）：矛盾内核（题材特有的角色矛盾类型）、成长规则（3-4条）、硬规则（3-4条）。

3. WRITING_SOUL_PLAYBOOK（200-500字）：6条写作灵魂准则，第2-4条必须针对该题材的核心体验定制。

4. EDITOR_DISCIPLINE_PLAYBOOK（200-400字）：7条编辑纪律——前2条通用（修复问题+保护钩子），后5条针对该题材的提升方向（如言情提升心动细节，悬疑提升线索隐蔽性，玄幻提升战斗画面感）。

5. REVIEWER_RUBRIC_PLAYBOOK（100-300字）：0-10分5档评分标尺——每一档用该题材特有的体验锚定（如言情9分="CP化学反应强烈到想代入"，悬疑9分="线索链完美闭合让人拍案叫绝"）。

6. CONTINUITY_BASELINE_PLAYBOOK（50-200字）：6条连续性底线——前3条通用（角色名一致/死亡规则/空间逻辑），后3条针对该题材特有的一致性要求（如悬疑的时间线/物证一致性，言情的感情进度一致性）。

7. THREAD_AWARENESS_PLAYBOOK（50-200字）：5条伏线意识——第1条通用（不乱开坑），后4条针对该题材特有的伏线类型和回收方式（如悬疑的线索链，言情的情感暗线，玄幻的力量体系伏线）。`,
      temperature: 0.5,
    });

    // 第四阶段：将 AI 生成的 playbook 文本转为 RuleAtom[]
    const ruleAtoms = playbookDictToAtoms(playbooks as Record<string, string>);

    // 第五阶段：生成 cachedAgentSections（用于 createBook 直接跳过 LLM 调用）
    let cachedAgentSections: CachedAgentSections | null = null;
    try {
      const profile = profileRaw as unknown as BookPromptProfile;
      cachedAgentSections = await this.promptProfiler.generateAgentSections(dto.genreName, profile, ruleAtoms);
      this.logger.log(`[aiGenerate] cachedAgentSections 已生成: ${dto.genreName}`);
    } catch (err: any) {
      this.logger.warn(`[aiGenerate] cachedAgentSections 生成失败（不影响模板创建）: ${err.message}`);
    }

    return {
      profileJson: profileRaw as unknown as Record<string, unknown>,
      seedHints, ruleAtoms, cachedAgentSections,
    };
  }

  /** 数据迁移：将现有 playbook_overrides 文本解析为 ruleAtoms（一次性执行） */
  async migratePlaybookOverridesToRuleAtoms(): Promise<{ migrated: number; skipped: number }> {
    const all = await this.repo.find();
    let migrated = 0, skipped = 0;
    for (const tpl of all) {
      if (tpl.ruleAtoms?.length) { skipped++; continue; }
      const raw = (tpl as any).playbookOverrides ?? (tpl as any).playbook_overrides;
      if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) { skipped++; continue; }
      tpl.ruleAtoms = playbookDictToAtoms(raw as Record<string, string>);
      await this.repo.save(tpl);
      migrated++;
      this.logger.log(`[migrate] 模板 ${tpl.displayName} 已迁移 ${tpl.ruleAtoms.length} 条 RuleAtom`);
    }
    return { migrated, skipped };
  }
}
