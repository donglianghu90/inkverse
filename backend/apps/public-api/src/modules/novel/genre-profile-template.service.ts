/** 题材 Profile 模板管理服务 — 用户私有模板 + 系统种子自动同步 + 增量更新 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { GenreProfileTemplateEntity, SeedAnalyzerHints, CachedAgentSections } from './entities/genre-profile-template.entity';
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
}

const SYSTEM_SEEDS: SystemSeed[] = [
  // ── 有手写 Profile + Playbook 的标杆题材 ──
  {
    genreKey: 'xianxia', displayName: '玄幻/仙侠', description: '仙侠修真、异界大陆、魔法世界、神魔大战、灵气复苏',
    genreKeywords: ['玄幻', '仙侠', '修仙', '魔法', '异世界', '穿越', '重生', '系统', '升级', '战斗', '神魔', '灵气复苏', 'fantasy'],
    profile: XIANXIA_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['逆袭式：被小看→积蓄→关键爆发→震惊众人→更大舞台→再被小看'],
      goldenFingerGuidance: '玄幻金手指应是修炼/血脉/器物类，进化路径是境界突破，限制是灵气/资质/天劫。',
      worldBuildingDirectives: '需要完整的修炼等级体系、宗门/势力层级、天材地宝体系，地图从小到大逐步展开。',
    },
    ruleAtoms: playbookDictToAtoms(XIANXIA_PLAYBOOKS),
  },
  {
    genreKey: 'romance', displayName: '言情/爱情', description: '现代言情、古代言情、穿越言情、重生言情、豪门甜宠、暗恋、悬疑情感',
    genreKeywords: ['言情', '恋爱', '青春', '甜宠', 'romance', '婚恋', '暗恋', '总裁', '豪门', '先婚后爱', '破镜重圆', '失忆', '穿越言情', '重生言情'],
    profile: ROMANCE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['情感式：误解→接近→摩擦→心动→外部阻碍→更深纠葛'],
      goldenFingerGuidance: '言情通常不需要金手指，角色魅力本身就是驱动力。如需要可设为特殊才能/家世背景。',
      worldBuildingDirectives: '都市背景需真实感，职场/校园/家庭关系网要立体，社会阶层差异制造冲突。',
    },
    ruleAtoms: playbookDictToAtoms(ROMANCE_PLAYBOOKS),
  },
  {
    genreKey: 'mystery', displayName: '悬疑/推理', description: '侦探推理、犯罪心理、法律推理、谋杀谜案、破案故事',
    genreKeywords: ['悬疑', '推理', '侦探', '刑侦', '犯罪', '谋杀', 'mystery', 'thriller', '惊悚', '探案', '破案', '密室', '法律'],
    profile: MYSTERY_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['解谜式：发现异常→追查→更大谜团→碎片答案→世界观扩大'],
      goldenFingerGuidance: '悬疑通常不需要超自然金手指。可以是超强观察力/逻辑推理能力/特殊信息渠道。',
      worldBuildingDirectives: '需要严密的逻辑链，线索必须公平呈现，反转要合理不能硬编。',
    },
    ruleAtoms: playbookDictToAtoms(MYSTERY_PLAYBOOKS),
  },
  {
    genreKey: 'urban', displayName: '现实题材', description: '都市、青春校园、家庭、职场、成长、社会、情感',
    genreKeywords: ['都市', '现实', '商战', '权谋', '职场', '日常', '异能', '青春', '校园', '家庭', '成长', '社会', 'urban'],
    profile: URBAN_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '博弈式（商战/权谋）：布局→试探→对手反击→绝境→翻盘→更大棋局',
        '成长式（都市日常）：挑战→挣扎→小突破→新认知→更大挑战',
      ],
      goldenFingerGuidance: '都市金手指可以是重生记忆、系统面板、特殊人脉/信息渠道，要与现实逻辑不冲突。',
      worldBuildingDirectives: '现实背景需要真实感，商业/政治/社会规则要可信，权力结构要立体。',
    },
    ruleAtoms: playbookDictToAtoms(URBAN_PLAYBOOKS),
  },
  {
    genreKey: 'historical', displayName: '历史', description: '正史历史、架空历史、历史传奇、古风传奇、三国隋唐宋',
    genreKeywords: ['历史', '架空', '宫斗', '朝堂', '三国', '大明', '大唐', '秦', '隋唐', '宋', '古风', '传奇', 'historical'],
    profile: HISTORICAL_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '博弈式（朝堂/宫斗）：布局→试探→对手反击→绝境→翻盘→更大棋局',
        '传奇式（人物传记）：出身→磨难→崛起→巅峰→抉择→落幕',
      ],
      goldenFingerGuidance: '历史金手指通常是穿越者的现代知识/记忆，限制是历史惯性和人心复杂性。',
      worldBuildingDirectives: '历史背景需符合时代质感（语言、制度、生活细节），架空需自洽的政治/军事体系。',
    },
    ruleAtoms: playbookDictToAtoms(HISTORICAL_PLAYBOOKS),
  },
  {
    genreKey: 'western-fantasy', displayName: '西方奇幻', description: '魔法史诗、中世纪奇幻、魔幻现实主义、灵异神怪',
    genreKeywords: ['西方奇幻', '魔法', '史诗', '中世纪', '魔幻现实', '灵异', '神怪', '精灵', '龙', '骑士', 'epic fantasy'],
    profile: WESTERN_FANTASY_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '史诗式：预言/召唤→集结同伴→试炼→黑暗势力逼近→最终决战→新纪元',
        '成长式：天赋觉醒→魔法学院→禁忌知识→阴谋揭露→选择阵营→改变世界',
      ],
      goldenFingerGuidance: '西方奇幻金手指是血脉/预言/神器类，进化路径是魔法等级/元素掌控，限制是魔力消耗和禁忌代价。',
      worldBuildingDirectives: '需要种族体系（人类/精灵/矮人等）、魔法规则、神祇信仰、王国势力版图，史诗感和宏大世界观是核心。',
    },
    ruleAtoms: playbookDictToAtoms(WESTERN_FANTASY_PLAYBOOKS),
  },
  {
    genreKey: 'sci-fi', displayName: '科幻', description: '硬科幻、软科幻、赛博朋克、星际战争、未来世界、平行宇宙、人工智能',
    genreKeywords: ['科幻', 'sci-fi', '星际', '太空', '赛博朋克', '末世', '废土', '机甲', '人工智能', 'AI', '克隆', '基因', '平行宇宙', '未来'],
    profile: SCI_FI_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '探索式（硬科幻）：发现未知现象→科学假设→实验验证→更深层谜团→认知突破→世界观升级',
        '生存式（末世/废土）：危机降临→求生挣扎→建立据点→新威胁→技术进化→社会重建',
        '科技博弈式（星际/赛博朋克）：技术差距→情报收集→逆向突破→短暂优势→对手迭代→更大格局',
      ],
      goldenFingerGuidance: '科幻金手指应是科技/信息/知识类（AI助手、未来科技数据库、基因编辑能力），进化路径是技术迭代而非境界突破，限制是物理定律和资源瓶颈。',
      worldBuildingDirectives: '世界观需要一套内自洽的科技树/文明等级体系，不同势力的技术路线要有差异化，避免"魔法化科技"。距离感、时间尺度、能源约束要有体现。',
    },
    ruleAtoms: playbookDictToAtoms(SCI_FI_PLAYBOOKS),
  },
  {
    genreKey: 'wuxia', displayName: '武侠', description: '传统武侠、新武侠、江湖复仇、门派恩怨',
    genreKeywords: ['武侠', '江湖', '门派', '复仇', '侠客', '武功', '刀剑', '恩怨', '新武侠', 'wuxia'],
    profile: WUXIA_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '复仇式：灭门/陷害→流浪习武→结交豪杰→揭露真相→最终对决→江湖归隐',
        '成长式：少年入江湖→拜师学艺→卷入纷争→武功突破→侠义抉择→一代宗师',
      ],
      goldenFingerGuidance: '武侠金手指是秘籍/奇遇/名师类，进化路径是武功境界（招式→内力→意境），限制是经脉/体质/心境。',
      worldBuildingDirectives: '需要江湖势力格局（门派/帮会/朝廷）、武功体系（内功/外功/轻功/暗器）、江湖规矩和道义体系。',
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
    genreKey: 'horror', displayName: '恐怖/惊悚', description: '都市惊悚、心理恐惧、克苏鲁、无限流、生存恐怖',
    genreKeywords: ['恐怖', '克苏鲁', '无限流', 'horror', '惊悚', '求生', '心理恐惧', '生存', '恐怖游戏'],
    profile: HORROR_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['生存式：规则发现→求生验证→暂时安全→规则变化→更深恐惧→真相逼近'],
      goldenFingerGuidance: '恐怖金手指可以是特殊感知/规则解读能力/诡异道具，限制是使用代价和理智值消耗。',
      worldBuildingDirectives: '需要一套内自洽的"诡异规则"体系，恐惧来源于未知而非血腥，信息控制和压迫感是核心。',
    },
    ruleAtoms: playbookDictToAtoms(HORROR_PLAYBOOKS),
  },
  {
    genreKey: 'supernatural', displayName: '灵异/超自然', description: '鬼故事、灵媒通灵、诡异事件、民间鬼怪',
    genreKeywords: ['灵异', '超自然', '鬼', '鬼怪', '通灵', '灵媒', '诡异', '阴阳', '民间', '驱邪', '风水', 'supernatural'],
    profile: SUPERNATURAL_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '探秘式：遭遇异象→半信半疑→能力觉醒→接触灵界→揭示因果→平衡阴阳',
        '除灵式：接到委托→调查异象→发现真相→对抗恶灵→化解怨念→留下悬念',
      ],
      goldenFingerGuidance: '灵异金手指是阴阳眼/通灵体质/祖传术法类，进化路径是灵力等级/术法精通，限制是阳寿消耗/因果反噬/阴阳失衡。',
      worldBuildingDirectives: '需要阴阳两界体系、灵力/术法规则、民间传说融入、鬼怪等级分类，神秘感和敬畏感是核心，不是纯恐惧而是"奇"。',
    },
    ruleAtoms: playbookDictToAtoms(SUPERNATURAL_PLAYBOOKS),
  },
  {
    genreKey: 'adventure', displayName: '冒险/探险', description: '荒野求生、宝藏探险、末世探险、极限挑战',
    genreKeywords: ['冒险', '探险', '荒野', '求生', '宝藏', '末世', '极限', '探索', 'adventure', '盗墓', '寻宝'],
    profile: ADVENTURE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '探索式：线索发现→组队出发→未知危险→同伴考验→宝藏/真相→更大谜团',
        '求生式：灾难降临→资源争夺→建立据点→外部威胁→突围/迁徙→新世界',
      ],
      goldenFingerGuidance: '冒险金手指可以是特殊感知/古地图/先祖遗物/求生天赋，限制是体力/资源/环境极端条件。',
      worldBuildingDirectives: '需要丰富的地理环境（丛林/沙漠/深海/地下城）、生态系统、古文明遗迹，未知感和发现感是核心驱动力。',
    },
    ruleAtoms: playbookDictToAtoms(ADVENTURE_PLAYBOOKS),
  },
  {
    genreKey: 'game', displayName: '游戏/电竞', description: '虚拟游戏世界、MMORPG、电竞选手成长、游戏攻略流',
    genreKeywords: ['游戏', '电竞', '网游', '虚拟现实', 'VR', '系统流', 'game', '副本', '公会', 'MMORPG', '攻略'],
    profile: GAME_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: ['升级式：发现隐藏机制→独特流派→副本挑战→排名攀升→巅峰对决→新版本/新世界'],
      goldenFingerGuidance: '游戏金手指可以是隐藏职业/BUG利用/GM权限/前世记忆，限制是游戏规则和版本更新。',
      worldBuildingDirectives: '需要完整的游戏系统（职业/技能/装备/副本），需要竞技生态（公会/排名/赛事）。',
    },
    ruleAtoms: playbookDictToAtoms(GAME_PLAYBOOKS),
  },
  {
    genreKey: 'sports', displayName: '体育/竞技', description: '篮球、足球、搏击、体育励志',
    genreKeywords: ['体育', '篮球', '足球', '搏击', '拳击', '跑步', '竞技', '励志', '运动', 'sports', '赛车'],
    profile: SPORTS_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '成长式：天赋/热爱→训练磨砺→首次比赛→挫折低谷→突破极限→巅峰对决',
        '团队式：加入队伍→磨合冲突→战术成型→淘汰赛→决赛→冠军/传承',
      ],
      goldenFingerGuidance: '体育金手指可以是身体天赋/前世记忆/数据分析能力，限制是伤病/体能极限/心理压力。',
      worldBuildingDirectives: '需要真实的运动规则体系、联赛/锦标赛架构、训练体系，热血和汗水的真实感是核心。',
    },
    ruleAtoms: playbookDictToAtoms(SPORTS_PLAYBOOKS),
  },
  {
    genreKey: 'superpower', displayName: '超能力/魔法', description: '超能力者、魔法学院、少年觉醒',
    genreKeywords: ['超能力', '异能', '魔法学院', '觉醒', '超人', '变异', '能力者', 'superpower', '学院'],
    profile: SUPERPOWER_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '觉醒式：普通人→意外觉醒→能力失控→学习控制→卷入阵营斗争→守护/改变世界',
        '学院式：入学→分班/测试→天赋展露→校内竞争→外部威胁入侵→毕业大考',
      ],
      goldenFingerGuidance: '超能力金手指是独特/稀有能力类型，进化路径是能力等级/新用法开发，限制是身体负荷/副作用/能量消耗。',
      worldBuildingDirectives: '需要能力分类体系（元素/精神/身体强化等）、能力者社会组织（学院/政府机构/地下组织）、普通人与能力者的社会关系。',
    },
    ruleAtoms: playbookDictToAtoms(SUPERPOWER_PLAYBOOKS),
  },
  {
    genreKey: 'epic', displayName: '史诗/传奇', description: '王朝兴衰、大陆征伐、神话再造',
    genreKeywords: ['史诗', '传奇', '王朝', '征伐', '神话', '英雄', '命运', '帝国', 'epic', '群像'],
    profile: EPIC_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '王朝式：乱世→群雄并起→合纵连横→统一/分裂→盛世/衰亡→新纪元',
        '英雄式：预言/使命→集结→试炼→牺牲→最终决战→传说流传',
      ],
      goldenFingerGuidance: '史诗通常不需要个人金手指，驱动力是命运/血脉/天命，限制是历史洪流和人心向背。',
      worldBuildingDirectives: '需要宏大的世界版图、多种族/文明体系、神话传说体系、王朝更迭规律，格局感和命运感是核心。',
    },
    ruleAtoms: playbookDictToAtoms(EPIC_PLAYBOOKS),
  },
  {
    genreKey: 'fantasy-romance', displayName: '幻想爱情', description: '穿越恋爱、虚拟恋爱、神话恋爱',
    genreKeywords: ['穿越恋爱', '虚拟恋爱', '神话恋爱', '仙恋', '人妖恋', '跨时空', '异世恋', 'fantasy romance'],
    profile: FANTASY_ROMANCE_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '跨界式：意外穿越→身份隐藏→相遇心动→世界观冲突→选择留下/离开→跨越界限在一起',
        '宿命式：前世纠葛→今生重逢→记忆觉醒→命运阻碍→打破宿命→永恒之爱',
      ],
      goldenFingerGuidance: '幻想爱情金手指可以是穿越能力/前世记忆/神力，限制是时空规则/神界律法/回归代价。',
      worldBuildingDirectives: '需要两个世界的对比设定（现代vs古代/人间vs仙界），跨界规则和代价，爱情与世界规则的冲突是核心张力。',
    },
    ruleAtoms: playbookDictToAtoms(FANTASY_ROMANCE_PLAYBOOKS),
  },
  {
    genreKey: 'children', displayName: '儿童/少儿文学', description: '动物故事、成长寓言、幻想冒险',
    genreKeywords: ['儿童', '少儿', '童话', '动物', '成长', '寓言', '幻想', '冒险', 'children', '少年'],
    profile: CHILDREN_REFERENCE_PROFILE,
    seedHints: {
      coreLoopPatterns: [
        '成长式：好奇心→冒险出发→遇到困难→友谊/勇气→克服挑战→成长领悟',
        '奇遇式：发现秘密世界→结交伙伴→承担使命→团队合作→拯救/守护→回归日常',
      ],
      goldenFingerGuidance: '儿童文学金手指应是想象力/善良/勇气/友谊等品质驱动，限制是年龄认知和成长阶段。',
      worldBuildingDirectives: '世界观要充满想象力和温暖感，善恶分明但不简单化，动物/精灵/魔法元素增加趣味性，教育意义自然融入而非说教。',
    },
    ruleAtoms: playbookDictToAtoms(CHILDREN_PLAYBOOKS),
  },
];

@Injectable()
export class GenreProfileTemplateService implements OnModuleInit {
  private readonly logger = new Logger(GenreProfileTemplateService.name);

  constructor(
    @InjectRepository(GenreProfileTemplateEntity)
    private readonly repo: Repository<GenreProfileTemplateEntity>,
    private readonly llm: LlmService,
    private readonly promptProfiler: PromptProfilerAgent,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSystemTemplates();
  }

  async seedSystemTemplates(): Promise<void> { // 启动时同步系统预置模板；增量补充所有空字段（v2: genreKey 修正）
    const pending: SystemSeed[] = [];
    const profilePending: { seed: SystemSeed; entity: GenreProfileTemplateEntity }[] = [];
    for (const seed of SYSTEM_SEEDS) {
      const exists = await this.repo.findOneBy({ userId: IsNull() as any, genreKey: seed.genreKey });
      if (exists) {
        let needSave = false;
        if (seed.ruleAtoms?.length && JSON.stringify(exists.ruleAtoms ?? []) !== JSON.stringify(seed.ruleAtoms)) {
          exists.ruleAtoms = seed.ruleAtoms;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 ruleAtoms: ${seed.displayName}`);
        }
        const profileEmpty = !exists.profileJson || !Object.keys(exists.profileJson).length || !('writerGuide' in exists.profileJson);
        if (seed.profile && JSON.stringify(exists.profileJson ?? {}) !== JSON.stringify(seed.profile as unknown as Record<string, unknown>)) {
          exists.profileJson = seed.profile as unknown as Record<string, unknown>;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 profileJson: ${seed.displayName}`);
        } else if (profileEmpty && !seed.profile) {
          profilePending.push({ seed, entity: exists });
        }
        const desiredCache = GenreProfileTemplateService.buildDefaultAgentSections(exists.ruleAtoms ?? [], seed.genreKey);
        if (JSON.stringify(exists.cachedAgentSections ?? null) !== JSON.stringify(desiredCache)) {
          exists.cachedAgentSections = desiredCache;
          needSave = true;
          this.logger.log(`[seed] 系统模板已同步 cachedAgentSections: ${seed.displayName}`);
        }
        if (needSave) { exists.systemVersion += 1; await this.repo.save(exists); }
        continue;
      }
      if (seed.profile) {
        const entity = await this.repo.save(this.repo.create({
          userId: null, genreKey: seed.genreKey, displayName: seed.displayName,
          description: seed.description, genreKeywords: seed.genreKeywords,
          profileJson: seed.profile as unknown as Record<string, unknown>,
          seedHints: seed.seedHints, ruleAtoms: seed.ruleAtoms ?? [],
          cachedAgentSections: GenreProfileTemplateService.buildDefaultAgentSections(seed.ruleAtoms, seed.genreKey),
          isSystem: true, parentTemplateId: null, systemVersion: 1,
        }));
        this.logger.log(`[seed] 系统模板已创建(含默认 agentSections): ${seed.displayName}`);
      } else {
        pending.push(seed);
      }
    }
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
          isSystem: false, parentTemplateId: sys.id,
          systemVersion: 1, syncedSystemVersion: sys.systemVersion, isUserModified: false,
        }));
        continue;
      }
      const versionBehind = sys.systemVersion > existing.syncedSystemVersion;
      const agentOutdated = JSON.stringify(existing.cachedAgentSections ?? null) !== JSON.stringify(sys.cachedAgentSections ?? null);
      if ((versionBehind || agentOutdated) && !existing.isUserModified) {
        existing.displayName = sys.displayName; existing.description = sys.description;
        existing.genreKeywords = [...sys.genreKeywords];
        existing.profileJson = JSON.parse(JSON.stringify(sys.profileJson));
        existing.seedHints = sys.seedHints ? JSON.parse(JSON.stringify(sys.seedHints)) : null;
        existing.ruleAtoms = sys.ruleAtoms?.length ? JSON.parse(JSON.stringify(sys.ruleAtoms)) : [];
        existing.cachedAgentSections = sys.cachedAgentSections ? JSON.parse(JSON.stringify(sys.cachedAgentSections)) : null;
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
  }): Promise<GenreProfileTemplateEntity> {
    const existing = await this.repo.findOneBy({ userId, genreKey: dto.genreKey });
    if (existing) throw new BadRequestException(`你已有 genreKey="${dto.genreKey}" 的模板，请编辑或删除后重建`);
    return this.repo.save(this.repo.create({
      userId, genreKey: dto.genreKey, displayName: dto.displayName,
      description: dto.description ?? '', genreKeywords: dto.genreKeywords ?? [],
      profileJson: dto.profileJson, seedHints: dto.seedHints ?? null,
      ruleAtoms: dto.ruleAtoms ?? [], isSystem: false, parentTemplateId: null,
    }));
  }

  async update(id: string, userId: string, dto: {
    displayName?: string; description?: string; genreKeywords?: string[];
    profileJson?: Record<string, unknown>; seedHints?: SeedAnalyzerHints;
    ruleAtoms?: RuleAtom[]; cachedAgentSections?: CachedAgentSections;
  }): Promise<GenreProfileTemplateEntity> {
    const entity = await this.getById(id);
    if (entity.userId !== userId) throw new BadRequestException('只能编辑自己的模板');
    if (dto.displayName !== undefined) entity.displayName = dto.displayName;
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.genreKeywords !== undefined) entity.genreKeywords = dto.genreKeywords;
    if (dto.profileJson !== undefined) entity.profileJson = dto.profileJson;
    if (dto.seedHints !== undefined) entity.seedHints = dto.seedHints;
    if (dto.ruleAtoms !== undefined) entity.ruleAtoms = dto.ruleAtoms;
    if (dto.cachedAgentSections !== undefined) entity.cachedAgentSections = dto.cachedAgentSections;
    const profileOrRulesChanged = dto.profileJson !== undefined || dto.ruleAtoms !== undefined;
    if (profileOrRulesChanged) entity.cachedAgentSections = null;
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
      isSystem: false, parentTemplateId: source.parentTemplateId ?? source.id,
      syncedSystemVersion: source.syncedSystemVersion, isUserModified: false,
    }));
  }

  async findBestMatch(genre: string, userId?: string): Promise<GenreProfileTemplateEntity | null> {
    if (userId) await this.syncSystemTemplates(userId); // 确保用户模板已同步
    const all = userId ? await this.repo.findBy({ userId }) : await this.repo.findBy({ isSystem: true });
    const g = genre.toLowerCase();
    for (const t of all) {
      if (t.genreKeywords.some((kw) => g.includes(kw.toLowerCase()))) return t;
    }
    return all[0] ?? null; // 无精确匹配时返回第一个兜底
  }

  async getSeedHintsForGenre(genre: string, userId?: string): Promise<SeedAnalyzerHints | null> {
    const tpl = await this.findBestMatch(genre, userId);
    if (tpl?.seedHints) return tpl.seedHints;
    const g = genre.toLowerCase();
    const staticMatch = SYSTEM_SEEDS.find((s) => s.genreKeywords.some((kw) => g.includes(kw)));
    return staticMatch?.seedHints ?? null;
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
    targetAudience?: string; baseTemplateId?: string;
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
      systemPrompt: enrichedSystemPrompt,
      userPrompt: `题材：${dto.genreName}\n目标读者：${dto.targetAudience ?? '通用网文读者'}\n\n请生成完整 BookPromptProfile JSON。generatedForGenre 填 "${dto.genreName}"，generatedForAudience 填目标读者描述。`,
      temperature: 0.6,
    });

    const seedHints: SeedAnalyzerHints = {
      coreLoopPatterns: portrait.suggestedCoreLoops,
      goldenFingerGuidance: portrait.goldenFingerStyle,
      worldBuildingDirectives: portrait.worldBuildingStyle,
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
