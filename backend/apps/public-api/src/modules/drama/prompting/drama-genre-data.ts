/**
 * 短剧题材模板统一数据源
 * =====================
 * 每个题材只有 ONE 条记录，包含全部信息：
 *   - 模板元数据（displayName / description / tags）
 *   - seedHints（爽点/冲突/付费策略）
 *   - profile.productionGuidance（编剧生产引导，原 GENRE_PRODUCTION_GUIDANCE_MAP）
 *   - profile.profilerGuide（Profiler 专家身份，原 GENRE_PROFILER_GUIDES）
 *   - profile.profilerExamples（分段/情感节拍/节奏模板，原 GENRE_PROFILER_EXAMPLES）
 *   - profile.cameraStyleGuide（分镜摄影导演指令，原 SYSTEM_TEMPLATES profileJson）
 *   - profile.audioStyleGuide（音频风格，原 SYSTEM_TEMPLATES profileJson）
 *   - profile.reviewerCalibration（审核校准，原 SYSTEM_TEMPLATES profileJson）
 *
 * 使用方：
 *   drama-genre-template.service.ts  → seedSystemTemplates / findBestMatch
 *   drama-playbook.ts                → buildProfilerSystemPrompt 等
 */

import type {
  DramaSeedHints,
  GenreProductionGuidance,
  GenreProfilerExamples,
  GenreArchetypePreset,
  GenreFullProfile,
} from '../entities/drama-genre-template.entity';
import { BASE_AGENT_SYSTEM_PROMPTS } from './drama-agent-system-prompts';
import {
  BOSS_STORYBOARD_PROMPT,
  BOSS_ARC_DIRECTOR_PROMPT,
  BOSS_EPISODE_DIRECTOR_PROMPT,
  BOSS_AUDIO_DIRECTOR_PROMPT,
  BOSS_SCRIPT_REVIEWER_PROMPT,
  BOSS_PACING_ANALYZER_PROMPT,
  BOSS_CONTINUITY_GUARD_PROMPT,
  BOSS_HOOK_CRAFTER_PROMPT,
  BOSS_SCRIPTWRITER_PROMPT,
  BOSS_DIALOGUE_COACH_PROMPT,
  BOSS_SCRIPT_EDITOR_PROMPT,
  BOSS_EPISODE_RECORDER_PROMPT,
} from './genres/boss.prompts';
import {
  SWEET_STORYBOARD_PROMPT,
  SWEET_ARC_DIRECTOR_PROMPT,
  SWEET_EPISODE_DIRECTOR_PROMPT,
  SWEET_AUDIO_DIRECTOR_PROMPT,
  SWEET_SCRIPT_REVIEWER_PROMPT,
  SWEET_PACING_ANALYZER_PROMPT,
  SWEET_CONTINUITY_GUARD_PROMPT,
  SWEET_HOOK_CRAFTER_PROMPT,
  SWEET_SCRIPTWRITER_PROMPT,
  SWEET_DIALOGUE_COACH_PROMPT,
  SWEET_SCRIPT_EDITOR_PROMPT,
  SWEET_EPISODE_RECORDER_PROMPT,
} from './genres/sweet.prompts';
import {
  WARRIOR_STORYBOARD_PROMPT,
  WARRIOR_ARC_DIRECTOR_PROMPT,
  WARRIOR_EPISODE_DIRECTOR_PROMPT,
  WARRIOR_AUDIO_DIRECTOR_PROMPT,
  WARRIOR_SCRIPT_REVIEWER_PROMPT,
  WARRIOR_PACING_ANALYZER_PROMPT,
  WARRIOR_CONTINUITY_GUARD_PROMPT,
  WARRIOR_HOOK_CRAFTER_PROMPT,
  WARRIOR_SCRIPTWRITER_PROMPT,
  WARRIOR_DIALOGUE_COACH_PROMPT,
  WARRIOR_SCRIPT_EDITOR_PROMPT,
  WARRIOR_EPISODE_RECORDER_PROMPT,
} from './genres/warrior.prompts';
import {
  TIMETRAVEL_STORYBOARD_PROMPT,
  TIMETRAVEL_ARC_DIRECTOR_PROMPT,
  TIMETRAVEL_EPISODE_DIRECTOR_PROMPT,
  TIMETRAVEL_AUDIO_DIRECTOR_PROMPT,
  TIMETRAVEL_SCRIPT_REVIEWER_PROMPT,
  TIMETRAVEL_PACING_ANALYZER_PROMPT,
  TIMETRAVEL_CONTINUITY_GUARD_PROMPT,
  TIMETRAVEL_HOOK_CRAFTER_PROMPT,
  TIMETRAVEL_SCRIPTWRITER_PROMPT,
  TIMETRAVEL_DIALOGUE_COACH_PROMPT,
  TIMETRAVEL_SCRIPT_EDITOR_PROMPT,
  TIMETRAVEL_EPISODE_RECORDER_PROMPT,
} from './genres/timetravel.prompts';
import {
  PALACE_STORYBOARD_PROMPT,
  PALACE_ARC_DIRECTOR_PROMPT,
  PALACE_EPISODE_DIRECTOR_PROMPT,
  PALACE_AUDIO_DIRECTOR_PROMPT,
  PALACE_SCRIPT_REVIEWER_PROMPT,
  PALACE_PACING_ANALYZER_PROMPT,
  PALACE_CONTINUITY_GUARD_PROMPT,
  PALACE_HOOK_CRAFTER_PROMPT,
  PALACE_SCRIPTWRITER_PROMPT,
  PALACE_DIALOGUE_COACH_PROMPT,
  PALACE_SCRIPT_EDITOR_PROMPT,
  PALACE_EPISODE_RECORDER_PROMPT,
} from './genres/palace.prompts';
import {
  REVENGE_STORYBOARD_PROMPT,
  REVENGE_ARC_DIRECTOR_PROMPT,
  REVENGE_EPISODE_DIRECTOR_PROMPT,
  REVENGE_AUDIO_DIRECTOR_PROMPT,
  REVENGE_SCRIPT_REVIEWER_PROMPT,
  REVENGE_PACING_ANALYZER_PROMPT,
  REVENGE_CONTINUITY_GUARD_PROMPT,
  REVENGE_HOOK_CRAFTER_PROMPT,
  REVENGE_SCRIPTWRITER_PROMPT,
  REVENGE_DIALOGUE_COACH_PROMPT,
  REVENGE_SCRIPT_EDITOR_PROMPT,
  REVENGE_EPISODE_RECORDER_PROMPT,
} from './genres/revenge.prompts';
import {
  REBIRTH_STORYBOARD_PROMPT,
  REBIRTH_ARC_DIRECTOR_PROMPT,
  REBIRTH_EPISODE_DIRECTOR_PROMPT,
  REBIRTH_AUDIO_DIRECTOR_PROMPT,
  REBIRTH_SCRIPT_REVIEWER_PROMPT,
  REBIRTH_PACING_ANALYZER_PROMPT,
  REBIRTH_CONTINUITY_GUARD_PROMPT,
  REBIRTH_HOOK_CRAFTER_PROMPT,
  REBIRTH_SCRIPTWRITER_PROMPT,
  REBIRTH_DIALOGUE_COACH_PROMPT,
  REBIRTH_SCRIPT_EDITOR_PROMPT,
  REBIRTH_EPISODE_RECORDER_PROMPT,
} from './genres/rebirth.prompts';
import {
  SUSPENSE_STORYBOARD_PROMPT,
  SUSPENSE_ARC_DIRECTOR_PROMPT,
  SUSPENSE_EPISODE_DIRECTOR_PROMPT,
  SUSPENSE_AUDIO_DIRECTOR_PROMPT,
  SUSPENSE_SCRIPT_REVIEWER_PROMPT,
  SUSPENSE_PACING_ANALYZER_PROMPT,
  SUSPENSE_CONTINUITY_GUARD_PROMPT,
  SUSPENSE_HOOK_CRAFTER_PROMPT,
  SUSPENSE_SCRIPTWRITER_PROMPT,
  SUSPENSE_DIALOGUE_COACH_PROMPT,
  SUSPENSE_SCRIPT_EDITOR_PROMPT,
  SUSPENSE_EPISODE_RECORDER_PROMPT,
} from './genres/suspense.prompts';
import {
  URBAN_STORYBOARD_PROMPT,
  URBAN_ARC_DIRECTOR_PROMPT,
  URBAN_EPISODE_DIRECTOR_PROMPT,
  URBAN_AUDIO_DIRECTOR_PROMPT,
  URBAN_SCRIPT_REVIEWER_PROMPT,
  URBAN_PACING_ANALYZER_PROMPT,
  URBAN_CONTINUITY_GUARD_PROMPT,
  URBAN_HOOK_CRAFTER_PROMPT,
  URBAN_SCRIPTWRITER_PROMPT,
  URBAN_DIALOGUE_COACH_PROMPT,
  URBAN_SCRIPT_EDITOR_PROMPT,
  URBAN_EPISODE_RECORDER_PROMPT,
} from './genres/urban.prompts';
import {
  ANCIENT_STORYBOARD_PROMPT,
  ANCIENT_ARC_DIRECTOR_PROMPT,
  ANCIENT_EPISODE_DIRECTOR_PROMPT,
  ANCIENT_AUDIO_DIRECTOR_PROMPT,
  ANCIENT_SCRIPT_REVIEWER_PROMPT,
  ANCIENT_PACING_ANALYZER_PROMPT,
  ANCIENT_CONTINUITY_GUARD_PROMPT,
  ANCIENT_HOOK_CRAFTER_PROMPT,
  ANCIENT_SCRIPTWRITER_PROMPT,
  ANCIENT_DIALOGUE_COACH_PROMPT,
  ANCIENT_SCRIPT_EDITOR_PROMPT,
  ANCIENT_EPISODE_RECORDER_PROMPT,
} from './genres/ancient.prompts';
import {
  HISTORY_STORYBOARD_PROMPT,
  HISTORY_ARC_DIRECTOR_PROMPT,
  HISTORY_EPISODE_DIRECTOR_PROMPT,
  HISTORY_AUDIO_DIRECTOR_PROMPT,
  HISTORY_SCRIPT_REVIEWER_PROMPT,
  HISTORY_PACING_ANALYZER_PROMPT,
  HISTORY_CONTINUITY_GUARD_PROMPT,
  HISTORY_HOOK_CRAFTER_PROMPT,
  HISTORY_SCRIPTWRITER_PROMPT,
  HISTORY_DIALOGUE_COACH_PROMPT,
  HISTORY_SCRIPT_EDITOR_PROMPT,
  HISTORY_EPISODE_RECORDER_PROMPT,
} from './genres/history.prompts';
import {
  BIOGRAPHY_STORYBOARD_PROMPT,
  BIOGRAPHY_ARC_DIRECTOR_PROMPT,
  BIOGRAPHY_EPISODE_DIRECTOR_PROMPT,
  BIOGRAPHY_AUDIO_DIRECTOR_PROMPT,
  BIOGRAPHY_SCRIPT_REVIEWER_PROMPT,
  BIOGRAPHY_PACING_ANALYZER_PROMPT,
  BIOGRAPHY_CONTINUITY_GUARD_PROMPT,
  BIOGRAPHY_HOOK_CRAFTER_PROMPT,
  BIOGRAPHY_SCRIPTWRITER_PROMPT,
  BIOGRAPHY_DIALOGUE_COACH_PROMPT,
  BIOGRAPHY_SCRIPT_EDITOR_PROMPT,
  BIOGRAPHY_EPISODE_RECORDER_PROMPT,
} from './genres/biography.prompts';
import {
  MYTHOLOGY_STORYBOARD_PROMPT,
  MYTHOLOGY_ARC_DIRECTOR_PROMPT,
  MYTHOLOGY_EPISODE_DIRECTOR_PROMPT,
  MYTHOLOGY_AUDIO_DIRECTOR_PROMPT,
  MYTHOLOGY_SCRIPT_REVIEWER_PROMPT,
  MYTHOLOGY_PACING_ANALYZER_PROMPT,
  MYTHOLOGY_CONTINUITY_GUARD_PROMPT,
  MYTHOLOGY_HOOK_CRAFTER_PROMPT,
  MYTHOLOGY_SCRIPTWRITER_PROMPT,
  MYTHOLOGY_DIALOGUE_COACH_PROMPT,
  MYTHOLOGY_SCRIPT_EDITOR_PROMPT,
  MYTHOLOGY_EPISODE_RECORDER_PROMPT,
} from './genres/mythology.prompts';
import {
  SCIFI_STORYBOARD_PROMPT,
  SCIFI_ARC_DIRECTOR_PROMPT,
  SCIFI_EPISODE_DIRECTOR_PROMPT,
  SCIFI_AUDIO_DIRECTOR_PROMPT,
  SCIFI_SCRIPT_REVIEWER_PROMPT,
  SCIFI_PACING_ANALYZER_PROMPT,
  SCIFI_CONTINUITY_GUARD_PROMPT,
  SCIFI_HOOK_CRAFTER_PROMPT,
  SCIFI_SCRIPTWRITER_PROMPT,
  SCIFI_DIALOGUE_COACH_PROMPT,
  SCIFI_SCRIPT_EDITOR_PROMPT,
  SCIFI_EPISODE_RECORDER_PROMPT,
} from './genres/scifi.prompts';

export interface GenreTemplateEntry {
  displayName: string;
  description: string;
  genreKeywords: string[];
  audienceTags: string[];
  protagonistFocusTags: Array<'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble'>;
  toneTags: string[];
  platformTags: string[];
  seedHints: DramaSeedHints;
  /** 写入 drama_genre_templates.profile_json 的完整对象 */
  profile: GenreFullProfile;
}

export const GENRE_TEMPLATES: Record<string, GenreTemplateEntry> = {

  // ─────────────────────────── boss ───────────────────────────
  boss: {
    displayName: '霸总',
    description: '霸道总裁+身份反差+打脸逆袭',
    genreKeywords: ['霸总', '总裁', '豪门'],
    audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'],
    toneTags: ['爽快', '反转'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'reelshort', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['打脸', '身份揭露', '逆袭归来'],
      conflictPatterns: ['阶级对立', '身份反差', '前任纠葛'],
      paywallStrategyHints: '第8-10集男女主误会最深处设卡，第15-18集身份揭露前设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是霸总/商战/权力短剧编剧手册生成专家。本次任务：为霸总题材生成编剧手册。
【编剧思维框架】权力高度差与积压-爆发节奏是核心；打脸的爽感来自积压深度而非爆发激烈度；主角越"不费力淡漠"越爽。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通权力美学与情感积压的霸总编剧；每场戏都在回答"谁更有权力"；积压四阶段（误解→积累→触发→打脸）必须完整
- genreRules 必须包含（至少5条）：① 权力高度差叙事铁律（每个Scene的镜头设计都要体现谁占上风）② 霸总"淡然不费力"铁律（打脸时不激动/不庆祝/不解释）③ 积压节奏控制（积压段禁止热血BGM，不能泄爽）④ 身份揭露的节奏与触发机制 ⑤ 爱情线与权力线的交织方式
- dialogueGuide：现代都市白话；霸总台词短促有力（5-10字/句）；威胁不明说，权力不解释；禁止说教/弱势感台词
- visualNarrativeGuide：第一帧=权力符号（合同/背影）；打脸时主角台词越短越强（沉默代替台词）；对方惊愕反应比主角行动更重要
- forbiddenPatterns：打脸后主角激动庆祝/解释理由；霸总角色使用弱势场景开场；15字以上的直白表白台词`,

      profilerExamples: {
        genreName: '霸总/商战',
        segmentPrinciples:
          '① 段落感来自"权力积压→打脸→更高对手出现"循环，赌注逐段升级（声誉→产业→生死）\n' +
          '② 每段开头建立新对手的威胁（wide展示权力格局），让观众感到"这次更难"\n' +
          '③ 打脸场精炼短促，情感积压场允许慢节奏，快慢比约1:2\n' +
          '④ 段末钩子偏"身份揭露"或"出卖"型\n' +
          '⑤ 段落间过渡用场景切换+职位/资产变化的视觉符号，暗示主角地位跃升',
        emotionBeatTable:
          '| beatId | 时间段   | emotion      | intensity | trigger                                     |\n' +
          '|--------|----------|--------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | shock        | 0.8       | 开场炸弹（发现陷阱/不平等/秘密）                    |\n' +
          '| eb_2   | 8%-20%   | anxiety      | 0.55      | 主角决定是否正面应对                                |\n' +
          '| eb_3   | 20%-35%  | surface_calm | 0.3       | 假装无所谓，实则暗中布局                            |\n' +
          '| eb_4   | 35%-50%  | tension      | 0.65      | 对方话/行动开始露出破绽                             |\n' +
          '| eb_5   | 50%-55%  | silence      | 0.0       | 对视2秒（无BGM），谁先开口谁输                      |\n' +
          '| eb_6   | 55%-75%  | power_flip   | 0.92      | 主角淡然打出底牌（台词≤8字，medium+low_angle）      |\n' +
          '| eb_7   | 75%-85%  | collapse     | 0.7       | 对方惊愕崩溃（ECU反应脸×3）                         |\n' +
          '| eb_8   | 85%-95%  | dominance    | 0.45      | 主角不庆祝，淡然离场/转身                           |\n' +
          '| eb_9   | 95%-100% | new_threat   | 0.8       | 更大对手/新危机出现（集末钩子）                     |',
        rhythmTemplate:
          '全剧：开场10%霸总格局与主角处境→铺垫25%积压（误解/情感/陷阱）→上升25%反击布局→高潮25%打脸爆发→落幕15%新威胁引入\n' +
          '单集：前8%权力格局/上集悬念回应→中65%积压升温（2-3个小冲突叠加）→后27%打脸+集末悬念\n' +
          '允许慢区：情感线允许1-2集节奏放缓，但禁止整集无冲突推进',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'plot_cliffhanger',
            conflictType: 'interpersonal',
            characterEvolution: 'status',
            visualTone: 'glamorous',
            adaptationNotes: `- 台词 > 动作 > 旁白，禁止大段心理描写（观众看不到你的内心戏）
- 霸总台词短促有力（5-10字/句），威胁绝不明说，以沉默和行动代替言辞；禁止弱势感台词
- 主角打脸/逆袭时：不激动、不庆祝、不解释，淡然比愤怒更有压迫感
- 集末钩子：卡在"身份即将揭露前一秒"或"误会升至最深时"截断，禁止温馨结尾
- 角色地位随剧情提升需在服装/场景/他人态度中外显可见（status evolution）
- 节奏模式：开场10%快速建立权力冲突 → 积压20%克制蓄力（禁热血BGM，禁泄爽） → 上升30%逐级加码 → 高潮25%打脸爆发 → 缓冲+钩子15%态度松动+新威胁
- 记录重点：权力天平倾向；积压深度；身份碎片节点；男主护主行为时机`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "plot_cliffhanger"\n   conflictType: "interpersonal"\n   characterEvolution: "status"\n   visualTone: "glamorous"\n   adaptationNotes 基线：\n   - 台词 > 动作 > 旁白，禁止大段心理描写（观众看不到你的内心戏）\n   - 霸总台词短促有力（5-10字/句），威胁绝不明说，以沉默和行动代替言辞；禁止弱势感台词\n   - 主角打脸/逆袭时：不激动、不庆祝、不解释，淡然比愤怒更有压迫感\n   - 集末钩子：卡在"身份即将揭露前一秒"或"误会升至最深时"截断，禁止温馨结尾\n   - 角色地位随剧情提升需在服装/场景/他人态度中外显可见（status evolution）\n   - 节奏模式：开场10%快速建立权力冲突 → 积压20%克制蓄力（禁热血BGM，禁泄爽） → 上升30%逐级加码 → 高潮25%打脸爆发 → 缓冲+钩子15%态度松动+新威胁\n   - 记录重点：权力天平倾向；积压深度；身份碎片节点；男主护主行为时机`,

      agentSoulPrompts: {
        scriptwriterCoreIdentityHint: '精通权力美学与情感积压的霸总编剧——每场戏都在回答"谁更有权力"，积压四阶段（误解→积累→触发→打脸）必须完整',
        scriptwriterGenreRulesHint: [
          '权力高度差叙事铁律（每个Scene的镜头设计都要体现谁占上风，台词也是）',
          '霸总"淡然不费力"铁律（打脸时不激动/不庆祝/不解释，沉默>台词）',
          '积压节奏控制（积压段禁止热血BGM，不能提前泄爽）',
          '身份揭露的节奏机制（每段落至少一次身份碎片泄露，卡在揭露前一秒）',
          '爱情线与权力线的交织方式（情感场景必须保持权力不对称，宠溺不等于放弃压制感）',
        ],
        dialogueStyleHint: '现代都市白话；霸总台词短促有力（5-10字/句）；威胁不明说，权力不解释；禁止说教/弱势感台词；反派台词阴冷柔和，暗含算计',
        arcDirectorAdaptationHint: '每段落的核心是"权力积压→打脸→更高对手出现"循环，赌注逐段从声誉→产业→生死升级。段末钩子必须是"身份揭露"或"出卖"型，不接受温馨收尾。段落间过渡用职位/资产变化的视觉符号暗示主角地位跃升',
        episodeDirectorAdaptationHint: '单集节奏：前8%权力格局/上集悬念回应→中65%积压升温（2-3个小冲突叠加，禁止热血BGM）→后27%打脸+集末悬念。emotionBeats必须包含eb_5 silence=0（无BGM对视）和eb_6 power_flip≥0.9（淡然打出底牌）',
        hookCrafterHint: '霸总最强钩子类型：identity_reveal（身份即将揭露前截断）、power_shift（力量逆转）、betrayal_hint（内鬼暗示）。付费卡点必须卡在"观众已经看到一半真相，必须付费才能知道另一半"的信息断层处',
      },

      cameraStyleGuide: {
        preferredAngles: ['low_angle', 'three_quarter', 'over_shoulder', 'front'],
        signatureTechniques: ['仰拍建立权威气场', '打脸四镜公式（全场→ECU惊愕→主角淡然→reaction群）', '亲密不对称构图（一facing_camera一facing_away）', '9:16竖屏面部上1/3铁律'],
        transitionStyle: '硬切为主，打脸高潮freeze frame后接reaction群镜',
        cameraRuntime: {
          climax:
            '■ 【霸总高潮=淡然打脸四步】Shot①wide+bird_eye（全场环境，对方得意）→Shot②medium+low_angle主角（眼神淡然，嘴角微勾）→Shot③close_up+front反应镜（对方变色/惊愕，high_angle+fast_push）→Shot④medium+low_angle主角static定格\n' +
            '■ 核心差异：霸总高潮的爽点是"不费力"——specialTechnique=slow_motion用在对方惊愕脸而非主角出手动作；禁止主角在高潮镜头中有激动情绪或大动作',
          confrontation:
            '■ 【霸总对峙=权力落差构图三阶段】① 积压：对方medium+high_angle+主角medium+low_angle ② 底牌展示：主角medium+front ③ 落定：主角side_profile+slow_pull_back',
          romantic:
            '■ 【霸总情感场景=权力不对称构图】心动瞬间绝不对称：一人facing_camera，一人facing_away——打破平等关系，保留权力美学\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['大提琴低沉主题', '钢琴单音+弦乐和弦', '史诗铜管swell', '电子低频律动'],
        sfxDensity: 'moderate',
        silenceUsage: '打脸前积压阶段BGM降至intensity≤0.15，窒息沉默0.8-1.2s，爆发时弦乐swell精准卡在主角出口帧',
        voiceActingStyle: '男主：低沉克制，关键台词不超过两句；女主：初期声线偏弱渐强，打脸时语气短促坚定',
        genreBrandingDirective:
          '■ 【积压阶段】低频弦乐持续音，intensity=0.2-0.35；禁止激昂旋律\n' +
          '■ 【打脸三阶音频公式】①蓄势：BGM降至intensity=0.15 ②窒息：drop_to_near_silence持续0.8-1.2s ③爆发：弦乐swell+金属撞击\n' +
          '■ 【霸总出场BGM】大提琴/钢琴低音单音，intensity=0.35-0.5；禁止出场前3秒高频旋律\n' +
          '■ 【集尾hook前5秒】BGM渐强至0.65→hook画面cut→BGM骤停',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.4, dialogueNaturalness: 1.1, pacing: 1.0, hookStrength: 1.4, consistency: 1.0, emotionalImpact: 1.2 },
        genreSpecificChecks: [
          '每集第1Shot的T2I静帧是否为medium_close_up+low_angle的power shot',
          '打脸场景是否完整经历：积压(BGM≤0.15)→窒息(silence≥0.8s)→爆发(swell)三段',
          '拍蔑视方与主角的cameraAngle高度差是否≥20°',
          '每集是否有至少1个extreme_close_up捕捉情绪转折瞬间',
          '所有close_up镜头中人物面部是否位于9:16画面上1/3',
          '付费卡点前是否完成足够情绪积压',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是权力高度差——主角赌注从"声誉→产业→生死"逐段递进
② 每段落以一个新的更强权力对手为核心矛盾，前boss被击倒后更大boss出场
③ 段落长度8-15集，高潮集在段落后1/3（打脸/身份揭露集）
④ 付费卡点固定模式：误会最深处或"即将揭露"前一秒
⑤ 段末必须留一个更大权力威胁或身份谜团，驱动下一段`,
        characterArcPrinciples: `- 女主弧线：每段从"被压制/轻视"到"某项实力暴露"，但总体身份未全揭露
- 男主弧线：每段态度冷漠→护主但嘴硬→逐渐心动，节奏比剧情滞后1段
- 反派弧线：前期嚣张→中期计谋失败→末段被完全打脸；第2段引入动机使其立体
- 配角弧线：至少一个配角在某段从"站反派一边"转变为"倒向主角"`,
        conflictRhythm: `- 段落前1/3：新权力对手登场+对主角蔑视/打压+主角初步反击
- 段落中1/3：1-2集积压期（主角被压制，BGM克制）→1集打脸爆发→1-2集缓冲（男主态度松动）
- 段落后1/3：身份碎片揭露→更大阴谋浮现→段末身份谜团
- 付费节奏：积压2-3集→爆发1集→卡在爆发前或更大谜团刚出现处`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【霸总/商战专属情绪节拍——权力积压→打脸爆发模式】
| beatId | 时间段   | emotion          | intensity | trigger                              |
|--------|----------|------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | power_pressure   | 0.75      | 反派/高位者登场并蔑视主角              |
| eb_2   | 8%-22%   | suppression      | 0.55      | 主角被压制，积压委屈（BGM≤0.15）      |
| eb_3   | 22%-38%  | simmering_anger  | 0.65      | 主角内心临界，观众感知到"快爆了"       |
| eb_4   | 38%-50%  | false_calm       | 0.3       | 主角表面平静（静默，BGM drop）        |
| eb_5   | 50%-55%  | silence          | 0.0       | 打脸前窒息静默（≥1秒无声）            |
| eb_6   | 55%-72%  | catharsis        | 0.95      | 打脸/身份揭露爆发（BGM swell）        |
| eb_7   | 72%-85%  | aftermath_power  | 0.7       | 全场震惊，男主态度改变                 |
| eb_8   | 85%-95%  | resolve          | 0.55      | 主角确立新目标                        |
| eb_9   | 95%-100% | new_threat       | 0.8       | 更大权力威胁出现（集末钩子）           |`,
        tensionCurveNotes: `- 积压段（前50%）BGM必须克制（≤0.15），让打脸爆发形成最大落差
- 打脸场（55%-72%）是全集最密集切镜区，1-2秒/Shot
- 禁止在积压段插入高强度BGM，否则观众"情绪提前泄压"
- 每集至少有1次intensity=0（打脸前静默）作为情绪锚点`,
        hookPatterns: `- 身份揭露型：揭露身份信息的前一秒截断（"她竟然是……"画面定格）
- 出卖型：盟友当面出卖主角，下集才有回应
- 阶级反转型：主角展示更高实力/财力，但对方还不知道
- 情感钩：男主刚准备松口，新对手介入迫使他又变冷`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%强冲突建立→铺垫20%权力压制积压→上升25%初次打脸+新威胁→高潮30%身份揭露+大决战→落幕17%结局
单集：前8%上集回应/新威胁→中55%积压+冲突升级→后37%打脸爆发+集末钩子
理想快慢比：打脸爆发段(快)：积压段(慢)≈1:2`,
        paceIndicators: `- 霸总剧"慢"是合理的：积压段允许连续3-4集慢节奏（观众在积累"欠债感"）
- 打脸段连续3Shot以上未切镜=drag（打脸必须快）
- 积压段BGM≥0.5 = 节奏控制失误（观众提前情绪泄压）
- 全集无任何intensity=0的Shot = 缺少情绪锚点，打脸爆发效果大减`,
      },
      agentSystemPrompts: {
        'storyboard-director': BOSS_STORYBOARD_PROMPT,
        'arc-director': BOSS_ARC_DIRECTOR_PROMPT,
        'episode-director': BOSS_EPISODE_DIRECTOR_PROMPT,
        'audio-director': BOSS_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': BOSS_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': BOSS_PACING_ANALYZER_PROMPT,
        'continuity-guard': BOSS_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': BOSS_HOOK_CRAFTER_PROMPT,
        'scriptwriter': BOSS_SCRIPTWRITER_PROMPT,
        'dialogue-coach': BOSS_DIALOGUE_COACH_PROMPT,
        'script-editor': BOSS_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': BOSS_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── sweet ───────────────────────────
  sweet: {
    displayName: '甜宠',
    description: '高甜互动+甜蜜暴击+宠溺日常',
    genreKeywords: ['甜宠', '恋爱', '撒糖'],
    audienceTags: ['女性向', '18-30岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['甜蜜', '治愈'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'mango_tv', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['甜蜜反转', '宠溺升级', '守护'],
      conflictPatterns: ['误会消解', '竞争者介入', '家庭阻碍'],
      paywallStrategyHints: '每次甜蜜高潮前一刻设卡',
    },
    profile: {
      productionGuidance: {
        flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
        maleLeadFormula: '甜宠 / 青春：阳光少年感，清爽干净，五官柔和不冷酷，眼神温柔，笑起来有感染力。宠溺感>压迫感。',
        femaleLeadFormula: '甜宠（女主视角）：元气清纯，亲切感强，笑容是标志性特征；初始设定真实自然，代入感强。',
        coreLoopBlock: '=== 核心循环（甜宠/恋爱）===\n- 基本模式：误会→接近→心动→阻碍→更甜的互动（每3-4集一个甜蜜循环）\n- 爽点设计：甜蜜暴击、心动瞬间、宠溺日常、误会消解\n- 核心循环的关键：每集至少一个"甜蜜炸弹"，阻碍不超过2集',
        conflictBlock: '=== 冲突设计原则（甜宠）===\n- 阻碍必须合理且可解决：外部阻力（竞争者/家庭）优于内部怀疑\n- 误会消解要快：误会≤2集必须有推进\n- 每次阻碍后的甜蜜要比之前更甜——阻碍是为了强化甜蜜\n- 核心爽点：甜蜜暴击/心动瞬间/宠溺升级/守护表白',
        arcStructureHint: '段落1（第1-25%集）：初识+误会+第一次心动\n段落2：接近+暧昧+甜蜜升温+竞争者介入\n段落3：情感考验+第一次危机+守护时刻\n段落4（最后15%）：感情确认+最甜表白+结局',
        paywallStrategyHint: '每次甜蜜高潮前一刻设卡（第一次告白前、关键甜蜜暴击前）\n第6-12集设第一个付费卡点；之后每4-6集设一个',
        contractHint: '（示例："只要你追下去，每3集就有一个你会反复截图的甜蜜瞬间——而且越到后面越让你喘不过气"）',
        hookTypesHint: 'preferredTypes 参考：["甜蜜暴击","心动瞬间","竞争者危机","误会加深","守护表白","意外亲密"]',
        toneHint: 'toneGuardrails 参考：阻碍不超过2集；禁止男主无故冷暴力；虐恋段必须有甜蜜作为补偿；结局必须甜蜜',
        narrativeModeTip: '台词 > 动作 > 旁白，情感靠眼神和肢体语言传递，禁止大段独白',
        coreConflictExample: '（如：死对头竟然成了同居室友，两人日久生情却死撑着不承认）',
        paywallTip: '甜蜜暴击型→卡在"最甜互动"之前；卡在"最大误解"制造甜后的波折',
        antagonistTip: '反派：情敌、家长阻碍、身份差距，不需要太黑化，以误会和阻力为主',
        episodeTitleExample: '"心动时刻""表白翻车"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是甜宠/恋爱短剧编剧手册生成专家。本次任务：为甜宠题材生成编剧手册。
【编剧思维框架】情感距离变化是唯一的叙事主线（medium_wide→close_up的缩进=整剧节奏）；每集至少一个"可截图传播的甜蜜暴击moment"是核心KPI；误会=拉开距离→和好=缩短距离→甜蜜暴击=打穿距离。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通情感距离叙事与甜蜜暴击节奏的甜宠编剧；甜蜜暴击shot的设计（close_up+两人同帧+浅景深）是衡量每集成功的指标
- genreRules 必须包含（至少5条）：① 甜蜜暴击铁律（每集至少1个标志性甜蜜场景）② 误会设计规范（误会要"合理"，不能让主角显得愚蠢）③ 男主宠溺行为的升级节奏 ④ 情感发展速度与观众期待匹配 ⑤ 禁止"玛丽苏一步到位"
- dialogueGuide：轻松日常白话；男主台词克制但行动暖心（话少事多）；甜蜜宣言要有创意；禁止黑暗苦情台词
- visualNarrativeGuide：第一帧=甜蜜预期建立；甜蜜暴击shot是每集核心设计点；误会段的视觉疏离感（wide+side_profile+negative_space）
- forbiddenPatterns：误会拖超过3集；主角无理由拒绝宠溺；黑暗/重口情节；悲剧/虐心结局`,

      profilerExamples: {
        genreName: '甜宠/恋爱',
        segmentPrinciples:
          '① 段落感来自"情感距离缩短的一个阶段"（陌生→接近→心动→告白→磨合），每段推进一个情感刻度\n' +
          '② 每段开头建立"新的甜蜜契机"（新场景/新任务/新误会），让观众期待这段怎么撩\n' +
          '③ 甜蜜暴击场与误会拉开场约1:1，误会设计必须"合理"\n' +
          '④ 段末钩子偏"下一个甜蜜契机暗示"或"情感层级跃升的前夕"\n' +
          '⑤ 段落间过渡用轻松的场景切换，暗示时间流逝与情感温度变化',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | anticipation  | 0.6       | 期待互动（暗示甜蜜钩子的道具ECU）                   |\n' +
          '| eb_2   | 8%-20%   | proximity     | 0.5       | 物理接近/意外接触（二人距离缩短）                    |\n' +
          '| eb_3   | 20%-35%  | misunderstand | 0.35      | 小误会拉开距离（但不真的伤感）                       |\n' +
          '| eb_4   | 35%-50%  | effort_show   | 0.6       | 男主默默行动（话少但事多）                           |\n' +
          '| eb_5   | 50%-55%  | heart_skip    | 0.0       | 心动瞬间——女主愣住（slow_motion+浅景深）            |\n' +
          '| eb_6   | 55%-75%  | sweet_bomb    | 0.9       | 甜蜜暴击moment（close_up+同框+BGM swell）          |\n' +
          '| eb_7   | 75%-85%  | resolve       | 0.6       | 误会化解，情感推进一步                               |\n' +
          '| eb_8   | 85%-95%  | warm_ending   | 0.4       | 轻松温暖收尾                                        |\n' +
          '| eb_9   | 95%-100% | next_hook     | 0.7       | 下集互动钩子（新误会/新接近机会）                   |',
        rhythmTemplate:
          '全剧：开场8%甜蜜钩子建立期待→铺垫20%误会设计→上升30%情感推进→高潮25%甜蜜暴击集中爆发→落幕17%情感稳定+留下一段悬念\n' +
          '单集：前8%期待建立→中65%误会+暗中宠溺行动→后27%甜蜜暴击+下集互动钩子\n' +
          '允许慢区：误会段允许1-2集放缓情感推进，但基调必须保持轻盈，禁止黑暗苦情场面',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'emotional_peak',
            conflictType: 'interpersonal',
            characterEvolution: 'relationship',
            visualTone: 'glamorous',
            adaptationNotes: `- 每集必须有一个"甜蜜暴击"时刻：close_up + 两人同帧 + 浅景深；这是衡量每集成功的核心指标
- 台词轻盈自然，禁止霸道总裁语气，鼓励"假装冷漠但暗中关心"的克制表达
- 集末钩子偏好"情感炸弹"型：误会刚化解时遭遇新变故，或暖心moment被打断
- 误会设计轻薄化：不超过2集，避免窒息感；误会化解要有"一个动作胜千言"的视觉锚点
- 角色关系可见性变化：肢体距离缩近 / 称谓变化 / 主动保护行为出现（relationship evolution）
- 节奏模式：开场10%甜蜜初遇+矛盾苗头 → 拉扯30%误会-化解小循环 → 上升25%关系确认前最大障碍 → 高潮20%甜蜜炸弹+障碍化解 → 甜蜜收尾15%
- 记录重点：甜蜜暴击时刻；误会起止节点；关系亲密度里程碑`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "emotional_peak"\n   conflictType: "interpersonal"\n   characterEvolution: "relationship"\n   visualTone: "glamorous"\n   adaptationNotes 基线：\n   - 每集必须有一个"甜蜜暴击"时刻：close_up + 两人同帧 + 浅景深；这是衡量每集成功的核心指标\n   - 台词轻盈自然，禁止霸道总裁语气，鼓励"假装冷漠但暗中关心"的克制表达\n   - 集末钩子偏好"情感炸弹"型：误会刚化解时遭遇新变故，或暖心moment被打断\n   - 误会设计轻薄化：不超过2集，避免窒息感；误会化解要有"一个动作胜千言"的视觉锚点\n   - 角色关系可见性变化：肢体距离缩近 / 称谓变化 / 主动保护行为出现（relationship evolution）\n   - 节奏模式：开场10%甜蜜初遇+矛盾苗头 → 拉扯30%误会-化解小循环 → 上升25%关系确认前最大障碍 → 高潮20%甜蜜炸弹+障碍化解 → 甜蜜收尾15%\n   - 记录重点：甜蜜暴击时刻；误会起止节点；关系亲密度里程碑`,

      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'front', 'pov', 'close_up'],
        signatureTechniques: ['甜蜜暴击Shot（close_up+浅景深+双人面部同时清晰）', 'POV代入心动瞬间', '距离语言四阶段（陌生→暧昧→心动→甜蜜）', '误会段medium+side_profile+negative_space'],
        transitionStyle: '情感高潮用慢动作定格，误会段硬切凸显落差',
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['钢琴fingerpicking主题', '轻柔吉他', '流行甜歌（纯乐器版）', '轻弦乐'],
        sfxDensity: 'sparse',
        silenceUsage: '心动瞬间BGM降至near_silence叠加轻微心跳SFX，甜蜜爆发时弦乐+钢琴共鸣swell',
        voiceActingStyle: '自然轻松，甜蜜时语气上扬尾音延长，暧昧时语速放缓音量降低',
        genreBrandingDirective:
          '■ 【心动三阶音频公式】①预兆：钢琴fingerpicking，intensity=0.2 ②凝固：BGM降至near_silence+轻微心跳SFX ③爆发：弦乐+钢琴共鸣swell，intensity=0.55-0.7\n' +
          '■ 【误会/矛盾段BGM】降至intensity=0.15-0.25；SFX突出物理离别声\n' +
          '■ 【甜蜜高潮】弦乐+钢琴双层swell，intensity=0.7-0.85，tempo降至60BPM\n' +
          '■ 【集尾hook】BGM hook前2秒fade_to_near_silence→最后一句台词清晰无底乐→定格画面+BGM完全停止',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.4, pacing: 1.0, hookStrength: 1.2, consistency: 1.0, emotionalImpact: 1.5 },
        genreSpecificChecks: [
          '每集是否有至少1个甜蜜暴击Shot（close_up+浅景深+两人面部同时清晰），可单独截图传播',
          '全集情感距离是否有可感知的阶段推进',
          '心动瞬间是否包含POV Shot',
          '误会场景是否使用medium+side_profile+负空间构图',
          '双人close_up中两张面部是否同时清晰且无一方被frame切头',
          '误会到解开的节奏是否在单集内完成',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是甜蜜升温曲线——每段结束两人关系推进一个阶段（陌生→暧昧→心动→确认）
② 每段落以一个新的阻碍作为考验，阻碍解除后甜蜜比之前更甜
③ 段落长度6-12集，甜蜜高潮集在段落后1/3
④ 阻碍存续不超过2集，必须快速消解后给予更多甜蜜作为补偿
⑤ 段末钩子偏"关系即将突破"或"新阻碍介入"，驱动下一段`,
        characterArcPrinciples: `- 女主弧线：每段从"对感情的困惑/怀疑"到"接受一步的温暖"，不断靠近
- 男主弧线：每段从"若无其事/嘴硬"到"无意间的宠溺暴露"
- 情敌弧线：存在感不超过2段，以制造甜蜜张力为目的，不过度抢戏
- 配角弧线：闺蜜/损友负责喜剧节奏，每段至少有一次推波助澜的行动`,
        conflictRhythm: `- 段落前1/3：新阻碍建立+两人被迫靠近的新场景
- 段落中1/3：阻碍造成误解或距离→甜蜜反差场（越阻碍越靠近）
- 段落后1/3：阻碍化解→本段最甜场景→新阻碍暗示
- 节奏铁律：阻碍≤2集，甜蜜≥3集，甜:阻≈3:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【甜宠专属情绪节拍——心动积累→甜蜜暴击模式】
| beatId | 时间段   | emotion        | intensity | trigger                              |
|--------|----------|----------------|-----------|--------------------------------------|
| eb_1   | 0%-10%   | daily_cute     | 0.5       | 日常甜蜜互动开场（轻松建立氛围）        |
| eb_2   | 10%-25%  | shy_attraction | 0.55      | 主角眼神/动作心动迹象                  |
| eb_3   | 25%-40%  | obstacle       | 0.45      | 误会或阻碍介入（短暂低落）              |
| eb_4   | 40%-55%  | longing        | 0.6       | 阻碍中反而更想靠近                     |
| eb_5   | 55%-60%  | sweet_silence  | 0.35      | 两人短暂无言（目光交汇，BGM轻柔）       |
| eb_6   | 60%-78%  | sweet_bomb     | 0.9       | 甜蜜暴击（突然宠溺/表白/心动确认）      |
| eb_7   | 78%-90%  | warmth         | 0.7       | 余韵甜蜜，观众"嗑到了"                 |
| eb_8   | 90%-100% | next_obstacle  | 0.55      | 新阻碍/新甜蜜预告（集末钩子）          |`,
        tensionCurveNotes: `- 阻碍段（25%-55%）必须短暂，不超过全集35%时长
- 甜蜜暴击（60%-78%）是全集情绪顶点，BGM用romantic_sweet+intensity≥0.8
- 禁止在阻碍段用heartbreak BGM——甜宠基调要保持，最多用"淡淡遗憾"
- 全集至少有1次"意外肢体接触"或"无意间心动"作为甜蜜锚点`,
        hookPatterns: `- 甜蜜未完成型：快要表白/亲吻时被打断
- 情敌介入型：新竞争者出现，下集才知道结果
- 秘密将暴露型：主角快要发现对方心意的证据，定格在发现一半
- 升温型：本集最甜后暗示"下一集更甜"`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场10%初见心动→铺垫20%暧昧升温→上升25%第一阻碍+情感确认→高潮25%最甜表白→落幕20%甜蜜结局
单集：前10%上集衔接/新甜蜜场景→中55%甜蜜互动+短暂阻碍→后35%甜蜜暴击+集末钩子
理想甜:阻比例≈3:1（甜蜜段为主，阻碍只作调味）`,
        paceIndicators: `- 阻碍段持续超过2集=节奏失衡（甜宠观众会流失）
- 甜蜜暴击场景少于3Shot=甜蜜力度不足
- 全集无任何intensity≥0.8的甜蜜shot=本集价值缺失
- 连续3集无新甜蜜互动=阻碍过长，立即触发甜蜜补偿机制`,
      },
      agentSystemPrompts: {
        'storyboard-director': SWEET_STORYBOARD_PROMPT,
        'arc-director': SWEET_ARC_DIRECTOR_PROMPT,
        'episode-director': SWEET_EPISODE_DIRECTOR_PROMPT,
        'audio-director': SWEET_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': SWEET_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': SWEET_PACING_ANALYZER_PROMPT,
        'continuity-guard': SWEET_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': SWEET_HOOK_CRAFTER_PROMPT,
        'scriptwriter': SWEET_SCRIPTWRITER_PROMPT,
        'dialogue-coach': SWEET_DIALOGUE_COACH_PROMPT,
        'script-editor': SWEET_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': SWEET_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── warrior ───────────────────────────
  warrior: {
    displayName: '战神',
    description: '归来战神+震撼全场+实力碾压',
    genreKeywords: ['战神', '归来', '兵王'],
    audienceTags: ['男性向', '18-40岁'],
    protagonistFocusTags: ['male_lead'],
    toneTags: ['热血', '爽快'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['实力碾压', '身份揭露', '打脸'],
      conflictPatterns: ['身份隐藏', '被轻视', '势力冲突'],
      paywallStrategyHints: '第5-8集主角被逼到极限、即将爆发但尚未出手时设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是战神归来/兵王短剧编剧手册生成专家。本次任务：为战神题材生成编剧手册。
【编剧思维框架】积压-碾压成长弧是唯一叙事引擎；积压越久→碾压时低仰机位出现就有多爽；碾压时"不费力的平静"是最强爽点。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通委屈积压与碾压爽感的战神编剧；主角的强大必须先被完全"藏起来"才能"炸开"；低仰镜头出现是全剧气氛转变的信号
- genreRules 必须包含（至少5条）：① 积压段必须有足够深度（被蔑视/被误解的时长直接影响碾压爽感）② 碾压一定"不费力"（激动/大喊=严重扣分）③ 身份揭露节奏（不能太早泄底，不能拖太久失去期待）④ 军事/战场元素的融入规范 ⑤ 周围人的集体反应是碾压效果的放大器
- dialogueGuide：主角台词极简短促（碾压时3-5字最强力，silence是最好的台词）；积压段配角蔑视台词要"够傲慢"；禁止主角解释自己的能力或军功
- visualNarrativeGuide：第一帧=积压起点（被围/被蔑视的场景）；碾压前必须有主角1-2个"意味深长的平静close_up"；碾压后不拍主角的喜悦
- forbiddenPatterns：碾压时主角激动大喊；积压段给主角低仰镜头暗示实力；主角主动解释自己的背景实力`,

      profilerExamples: {
        genreName: '战神/兵王',
        segmentPrinciples:
          '① 段落感来自"积压深度递增→碾压力量感"，每段委屈比上段更深（职场→家庭→生死）\n' +
          '② 每段开头建立新的蔑视场景（主角再次被低估），让观众进入"积压模式"\n' +
          '③ 铺垫（被蔑视）场与碾压场约3:1，铺垫场禁止任何主角强势镜头\n' +
          '④ 段末钩子偏"更强实力暗示"或"隐藏身份层层剥开"\n' +
          '⑤ 段落间过渡用时间跳跃+新蔑视场景，暗示主角在暗中积累但观众未见',
        emotionBeatTable:
          '| beatId | 时间段   | emotion      | intensity | trigger                                     |\n' +
          '|--------|----------|--------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | humiliation  | 0.7       | 主角被蔑视/被误解/被压制                            |\n' +
          '| eb_2   | 8%-20%   | suppressed   | 0.5       | 主角隐忍不发（观众积累愤怒）                         |\n' +
          '| eb_3   | 20%-35%  | deeper_humil | 0.65      | 对方变本加厉（更嚣张）                              |\n' +
          '| eb_4   | 35%-50%  | trigger      | 0.7       | 触发点——有人触及绝对底线                            |\n' +
          '| eb_5   | 50%-55%  | silence      | 0.0       | 主角静止1-2秒（最危险的信号）                       |\n' +
          '| eb_6   | 55%-75%  | crushing     | 0.95      | 战神身份显现，碾压全场（low_angle+fast_cut）        |\n' +
          '| eb_7   | 75%-85%  | shock        | 0.75      | 全场人目瞪口呆（集体反应镜头）                      |\n' +
          '| eb_8   | 85%-95%  | calm_power   | 0.45      | 主角不庆祝，从容背身离去                            |\n' +
          '| eb_9   | 95%-100% | identity_hint| 0.8       | 隐藏更深实力/身份被暗示（集末钩子）                 |',
        rhythmTemplate:
          '全剧：开场10%建立"伪弱者"状态→铺垫35%层层积压→上升20%初次碾压→高潮20%终极身份揭露+最强碾压→落幕15%留更大舞台\n' +
          '单集：前10%被蔑视场景→中55%积压加深+触发点前置→后35%碾压爆发+从容收尾+集末钩子\n' +
          '允许慢区：积压段允许连续2-3集无大碾压，但每集必须有小积压事件支撑',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'interpersonal',
            characterEvolution: 'power_level',
            visualTone: 'epic',
            adaptationNotes: `- 主角的强大必须先被完全"藏起来"才能"炸开"：被轻视→忍耐→触发→碾压是核心节奏
- 战神身份揭露方式：低仰镜头出现是气氛转变信号；敌人的震惊反应比主角行动更重要
- 台词：极简有力，战神不解释、不废话，沉默代替辩白；配角嘲讽密度越高、打脸爽感越大
- 集末钩子：身份即将揭露/实力即将展示前截断（revelation型）
- 实力提升需在视觉上可见：低仰角度切换 / 对手态度骤变 / 周围人反应（power_level evolution）
- 节奏模式：开场10%弱势处境建立 → 积压25%被欺压蓄力（禁提前泄底） → 上升30%身份碎片逐渐暴露 → 高潮25%全面碾压 → 新威胁+钩子10%
- 记录重点：欺压积压深度；身份碎片揭露节点；战力对比可视化时机`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "interpersonal"\n   characterEvolution: "power_level"\n   visualTone: "epic"\n   adaptationNotes 基线：\n   - 主角的强大必须先被完全"藏起来"才能"炸开"：被轻视→忍耐→触发→碾压是核心节奏\n   - 战神身份揭露方式：低仰镜头出现是气氛转变信号；敌人的震惊反应比主角行动更重要\n   - 台词：极简有力，战神不解释、不废话，沉默代替辩白；配角嘲讽密度越高、打脸爽感越大\n   - 集末钩子：身份即将揭露/实力即将展示前截断（revelation型）\n   - 实力提升需在视觉上可见：低仰角度切换 / 对手态度骤变 / 周围人反应（power_level evolution）\n   - 节奏模式：开场10%弱势处境建立 → 积压25%被欺压蓄力（禁提前泄底） → 上升30%身份碎片逐渐暴露 → 高潮25%全面碾压 → 新威胁+钩子10%\n   - 记录重点：欺压积压深度；身份碎片揭露节点；战力对比可视化时机`,

      cameraStyleGuide: {
        preferredAngles: ['low_angle', 'front', 'three_quarter', 'dutch_angle'],
        signatureTechniques: ['委屈积压公式（high_angle俯拍→平静眼神ECU→忍）', '碾压三镜（眼神ECU→出手low_angle→被碾方崩溃ECU）', '身份揭露五镜公式', '对战每2-3镜切换景别'],
        transitionStyle: '强劲硬切为主；碾压关键帧前brief freeze后接打击音效',
        cameraRuntime: {
          climax:
            '■ 【战神高潮=碾压三镜公式】Shot①被轻视高峰：主角close_up+front，眼神从平静到凛冽→Shot②出招关键动作：low_angle+dutch_angle+fast_push→Shot③胜负定格：medium_close_up+low_angle+static平静立于废墟\n' +
            '■ 战神高潮禁止：主角在高潮镜头有激动表情/大喊大叫/庆祝动作',
          confrontation:
            '■ 【战神对峙=暴风雨前的寂静】wide两人对立→主角ECU眼神淡然（static，比对方更冷静）→对方medium+high_angle',
          romantic:
            '■ 【战神情感场景（稀少但精准）】每集最多1-2个，否则破坏"冷硬"人设\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['军鼓+低弦组合', '电子金属律动', '史诗打击乐swell', '工业钢铁音效'],
        sfxDensity: 'rich',
        silenceUsage: '被羞辱段BGM intensity≤0.25；碾压前凝固0.5-1s；出击帧冲击音效精准卡帧',
        voiceActingStyle: '男主：低沉有力，少说多做，一句话解决；配角：夸张惊叫强化爽点对比',
        genreBrandingDirective:
          '■ 【委屈积压段BGM】低频弦乐持续音+轻军鼓，intensity=0.2-0.3；绝对禁止热血旋律\n' +
          '■ 【碾压三阶音频公式】①凝固：BGM降至near_silence 0.5-1s ②出击：冲击打击音效精准卡帧 ③胜利：旋律主题swell，intensity=0.8-0.9\n' +
          '■ 【身份揭露音频】drop_to_silence 1s→敬称呼喊声清晰→旋律主题完整swell，intensity=0.9',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.5, dialogueNaturalness: 0.9, pacing: 1.2, hookStrength: 1.3, consistency: 1.0, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '被羞辱段是否全程使用high_angle俯拍主角且BGM intensity≤0.25',
          '碾压时刻是否包含：主角眼神ECU + low_angle出手镜头的黄金组合',
          '碾压音效是否精准卡在出招帧',
          '身份揭露是否包含：认出→肃然起敬→全场沉默→蔑视者崩溃的完整四步',
          '对战场面是否每2-3镜切换景别',
          '付费卡点是否精准卡在主角"即将出手但尚未出手"的蓄力顶点',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是实力层级递进——每段主角碾压当前层级后，遭遇更高层级的敌人
② 委屈积累段不超过2集，碾压爽点必须清晰且干净
③ 段落长度8-15集，高潮集在后1/3（身份揭露/终极碾压集）
④ 每段必须有一次"实力震惊全场"的高光时刻
⑤ 段末钩子偏"更强敌人出现"或"新威胁来自最信任的人"`,
        characterArcPrinciples: `- 主角弧线：每段从"被轻视/受辱"到"展示特定层级实力"，但总实力上限未揭露
- 护短对象弧线：每段被欺负的人/事不同，主角护短的范围逐段扩大
- 反派弧线：前期嚣张→被碾压后逃跑→引入更大反派
- 配角（战友/徒弟）弧线：见证主角实力→逐渐死心塌地→关键时刻助力`,
        conflictRhythm: `- 段落前1/3：新反派登场+羞辱/挑衅主角+主角受委屈（BGM积压）
- 段落中1/3：主角被逼到极限→开始反击（节奏加速）→中间阶段实力展示
- 段落后1/3：终极碾压+身份震惊全场→更强敌人出现→段末付费钩
- 节奏铁律：委屈≤2集→爆发1-2集→收尾1集，快慢比约1:1:0.5`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【战神/兵王专属情绪节拍——委屈积压→实力碾压模式】
| beatId | 时间段   | emotion           | intensity | trigger                              |
|--------|----------|-------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | provocation       | 0.7       | 反派登场挑衅/羞辱（建立憎恨感）         |
| eb_2   | 8%-25%   | suppressed_anger  | 0.55      | 主角受辱但隐忍（观众积累怒气）          |
| eb_3   | 25%-40%  | escalation        | 0.65      | 反派变本加厉，或护短对象受伤            |
| eb_4   | 40%-50%  | breaking_point    | 0.8       | 主角触发底线（眼神变冷，BGM降至零）     |
| eb_5   | 50%-55%  | silence           | 0.0       | 爆发前1秒绝对静默                      |
| eb_6   | 55%-75%  | dominance         | 0.95      | 实力碾压爆发（快切，BGM epic swell）    |
| eb_7   | 75%-85%  | shock_aftermath   | 0.75      | 全场震惊，反派/围观者态度180°翻转       |
| eb_8   | 85%-95%  | calm_after_storm  | 0.5       | 主角冷静收场（反差萌）                  |
| eb_9   | 95%-100% | new_challenger    | 0.8       | 更强敌人出现（集末钩子）               |`,
        tensionCurveNotes: `- 委屈积压段（前50%）动作戏必须克制，否则爽感提前泄露
- 碾压段（55%-75%）每Shot≤2秒，动作快切+BGM高强度
- 禁止碾压段超过15Shot——太长会让观众麻木
- "破防"瞬间（eb_4到eb_5）的过渡必须有明确视觉信号：眼神改变+BGM骤停`,
        hookPatterns: `- 更强挑战者型：刚碾压完反派，更强的人出现
- 背叛型：战友/信任的人出卖主角，引发下集复仇
- 护短危机型：主角不在时，重要的人遭遇危险
- 身份即将全揭露型：主角真实背景快要被人拼出`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%归来/归隐+被轻视→铺垫22%委屈积累+局部实力展示→上升25%逐步揭露身份→高潮30%全面爆发+终极对决→落幕15%
单集：前8%上集衔接/新挑衅→中55%积压+中间实力展示→后37%碾压爆发+集末更强挑战者
委屈段:碾压段:余震段≈2:1:0.5`,
        paceIndicators: `- 委屈段连续超过3集无任何小爽点=观众流失（必须每集有小的实力展示）
- 碾压段超过20Shot未切镜=视觉疲劳
- 动作场景Shot平均时长>4秒=节奏过慢（战神剧动作场景Shot应≤2.5秒）
- 全集无intensity=0的Shot=缺乏爆发前蓄力感`,
      },
      agentSystemPrompts: {
        'storyboard-director': WARRIOR_STORYBOARD_PROMPT,
        'arc-director': WARRIOR_ARC_DIRECTOR_PROMPT,
        'episode-director': WARRIOR_EPISODE_DIRECTOR_PROMPT,
        'audio-director': WARRIOR_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': WARRIOR_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': WARRIOR_PACING_ANALYZER_PROMPT,
        'continuity-guard': WARRIOR_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': WARRIOR_HOOK_CRAFTER_PROMPT,
        'scriptwriter': WARRIOR_SCRIPTWRITER_PROMPT,
        'dialogue-coach': WARRIOR_DIALOGUE_COACH_PROMPT,
        'script-editor': WARRIOR_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': WARRIOR_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── timetravel ───────────────────────────
  timetravel: {
    displayName: '穿越',
    description: '现代知识+古代碾压+改写命运',
    genreKeywords: ['穿越', '时空', '时间旅行'],
    audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'male_lead'],
    toneTags: ['爽快', '智斗'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'dramabox', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['先知碾压', '命运改写', '逆袭'],
      conflictPatterns: ['蝴蝶效应', '历史纠葛', '身份暴露风险'],
      paywallStrategyHints: '主角关键先知决策前设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是穿越/时空短剧编剧手册生成专家。本次任务：为穿越题材生成编剧手册。
【编剧思维框架】现代知识vs古代局限的信息差是最核心的爽感来源；色调对比区分时间线是视觉第一原则（现代=冷蓝/古代=暖金）；主角的从容 vs 周围人的茫然是标志性构图。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通时间线对比与先知信息差碾压叙事的穿越编剧；主角的先知碾压是整剧爽感核心；用色调区分时间线是基本功
- genreRules 必须包含（至少5条）：① 现代vs古代双色调铁律（仅凭色调无需字幕区分时间线）② 先知信息差节奏（主角"预言"触发→周围人反应的节奏控制）③ 穿越机制的建立与一致性 ④ 现代知识在古代场景的使用边界 ⑤ 先知碾压的"从容"姿态vs周围人的"茫然"对比构图规范
- dialogueGuide：双线台词风格截然不同（现代=白话直接/古代=半文半白）；主角穿越初期有语言适应期；禁止穿越后立即无缝使用古代语言
- visualNarrativeGuide：第一帧必须清晰体现时间线色调；穿越瞬间的"0.5秒静默"是最强时间转换信号；先知行动的"从容close_up"对比周围人ECU惊愕
- forbiddenPatterns：现代古代线色调无区分；主角穿越后立即流利古文（无适应期）；现代台词出现在古代场景`,

      profilerExamples: {
        genreName: '穿越/时空',
        segmentPrinciples:
          '① 段落感来自"先知范围扩大→超出预知的变量出现→再次掌控"的使用与失效循环\n' +
          '② 每段开头用色调切换锚定当前时间线，旁白交代时间跨度\n' +
          '③ 先知布局场（主角从容+周围人茫然对比）与历史偏差修正场约2:1\n' +
          '④ 段末钩子偏"超出主角预知的事件出现"或"历史变量引入新人物"\n' +
          '⑤ 段落间过渡用"穿越特效帧+色调骤变"，明确标记时间线跳跃',
        emotionBeatTable:
          '| beatId | 时间段   | emotion        | intensity | trigger                                     |\n' +
          '|--------|----------|----------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | disorientation | 0.8       | 穿越瞬间（色调骤变+静默0.5秒）                      |\n' +
          '| eb_2   | 8%-20%   | adaptation     | 0.5       | 主角适应古代/未来环境（语言/服饰冲突感）             |\n' +
          '| eb_3   | 20%-35%  | calm_knowing   | 0.35      | 主角发现自己"先知"（淡定vs周围人茫然）               |\n' +
          '| eb_4   | 35%-50%  | foreknow_trap  | 0.65      | 利用先知优势布局，周围人不理解                       |\n' +
          '| eb_5   | 50%-55%  | silence        | 0.0       | 主角静等历史按预期发展（从容等待）                   |\n' +
          '| eb_6   | 55%-75%  | foreknow_win   | 0.92      | 预言应验，先知碾压（周围人目瞪口呆）                 |\n' +
          '| eb_7   | 75%-85%  | ripple         | 0.7       | 历史改变的涟漪——出现意外偏差（紧张）                 |\n' +
          '| eb_8   | 85%-95%  | adjustment     | 0.5       | 主角冷静修正（凭借超出常人的信息优势）               |\n' +
          '| eb_9   | 95%-100% | unknown_future | 0.85      | 超出主角预知范围的事件出现（集末钩子）               |',
        rhythmTemplate:
          '全剧：开场10%穿越瞬间建立色调规则→铺垫20%环境适应与先知能力建立→上升30%利用先知优势改写命运→高潮25%超预知变量出现+应对→落幕15%新穿越/历史岔路口\n' +
          '单集：前8%色调切换锚定时间线→中65%先知布局展开→后27%预言应验或偏差修正+集末超预知事件\n' +
          '允许慢区：穿越适应段（前2-3集）允许节奏偏慢，允许语言/礼仪冲突的轻喜剧场面',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0.1,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'interpersonal',
            characterEvolution: 'status',
            visualTone: 'period',
            adaptationNotes: `   - 旁白叙述占比约10%，用于锚定时间线跳跃节点和穿越背景说明，不超过每集2-3次
- 时间线对比是核心爽感：先知碾压（主角知道"剧情走向"）= 信息差最大化利用
- 色调/滤镜用于区分时间线：现代冷调（冷蓝简洁）vs古代暖调（暖金/土橙繁复），切换必须清晰可辨
- 史实元素以"灵感来源"处理：服饰/称谓符合朝代基调，重大事件可艺术化，禁止编造不存在的历史人物
- 集末钩子偏好"即将改变命运/刚察觉异常"型（revelation）
- 角色地位变化通过身份适应过程外显：从现代人"格格不入"到"游刃有余"（status evolution）
- 节奏模式：开场10%穿越触发+时代冲击 → 适应20%学习规则+积累筹码 → 上升30%主动干预历史/关系 → 高潮25%命运改写时刻 → 新线索+回家悬念15%
- 记录重点：先知信息差使用时机；时间线标记；命运改变里程碑`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0.1\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "interpersonal"\n   characterEvolution: "status"\n   visualTone: "period"\n   adaptationNotes 基线：\n   - 旁白叙述占比约10%，用于锚定时间线跳跃节点和穿越背景说明，不超过每集2-3次\n   - 时间线对比是核心爽感：先知碾压（主角知道"剧情走向"）= 信息差最大化利用\n   - 色调/滤镜用于区分时间线：现代冷调（冷蓝简洁）vs古代暖调（暖金/土橙繁复），切换必须清晰可辨\n   - 史实元素以"灵感来源"处理：服饰/称谓符合朝代基调，重大事件可艺术化，禁止编造不存在的历史人物\n   - 集末钩子偏好"即将改变命运/刚察觉异常"型（revelation）\n   - 角色地位变化通过身份适应过程外显：从现代人"格格不入"到"游刃有余"（status evolution）\n   - 节奏模式：开场10%穿越触发+时代冲击 → 适应20%学习规则+积累筹码 → 上升30%主动干预历史/关系 → 高潮25%命运改写时刻 → 新线索+回家悬念15%\n   - 记录重点：先知信息差使用时机；时间线标记；命运改变里程碑`,

      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'front', 'bird_eye', 'pov'],
        signatureTechniques: ['穿越三镜（现代末帧→特效帧→古代首帧色调对比）', '先知碾压对比构图（主角从容+周围人茫然）', 'bird_eye建立古代宏观环境', 'POV传递信息差视角'],
        transitionStyle: '穿越时dutch_angle+色调骤变；古代日常硬切；信息差揭示时medium_wide对比切',
        cameraRuntime: {
          revelation: '■ 【穿越揭秘=色调骤变三镜公式】Shot①揭秘前正常视角→Shot②穿越信息揭露：dutch_angle+色调突变→Shot③新时间线wide+crane_up，色调稳定',
          climax: '■ 【穿越高潮=先知碾压落地四镜】Shot①主角谋划终于执行（medium_close_up+front）→Shot②关键证据/先知信息公开（insert_shot）→Shot③对方崩溃反应（ECU快切）→Shot④wide+crane_up拉出',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['古风弦乐（琵琶/古筝/竹笛）', '现代电子节拍', '两种元素叠加（穿越混杂感）', '空灵人声'],
        sfxDensity: 'moderate',
        silenceUsage: '穿越瞬间all_sfx_cut→旋转扭曲音+心跳加速→新环境音渐入，共2-3秒',
        voiceActingStyle: '主角：现代口语偶尔融入古代腔调（错位制造喜剧感），关键先知决策时恢复现代简洁果断',
        genreBrandingDirective:
          '■ 【穿越瞬间音效公式】现代最后音效→旋转/扭曲声（0.5s）+心跳加速→新环境音渐入，共2.5-3.5秒\n' +
          '■ 【现代vs古代BGM区分】现代线：简洁电子旋律，intensity=0.3；古代线：古风弦乐，intensity=0.35-0.5\n' +
          '■ 【集尾hook】BGM渐弱→静默→关键台词清晰落地→定格主角表情→BGM完全停止',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.2, dialogueNaturalness: 1.1, pacing: 1.1, hookStrength: 1.3, consistency: 1.2, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '现代线vs古代线在色调上是否有可感知的明显差异（仅看静帧能区分时间线）',
          '穿越瞬间是否完整呈现：现代末帧→特效帧→古代首帧的三段视觉转换',
          '先知碾压场景是否包含"主角从容"与"周围人茫然/震惊"的对比构图',
          '每集是否有至少1次信息差爽点',
          '付费卡点是否卡在主角先知决策即将实施前',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是"知识/先知优势"的应用场景递进——从个人生存→改变关键人物→影响历史走向
② 每段落有一个"身份暴露危机"的高潮，主角用现代知识化解
③ 段落长度8-15集，高潮集在后1/3（先知碾压或命运改写集）
④ 历史/古代背景的"障碍"逐段升级（宫廷规矩→权力斗争→史诗危机）
⑤ 段末留"现代知识的下一个应用悬念"或"身份危机未解决"`,
        characterArcPrinciples: `- 穿越主角弧线：每段从"格格不入"到"逐渐找到古代生存法则"，但保留现代视角的特别
- 古代男主弧线：每段从"对主角困惑"到"被某个现代行为震撼/折服"
- 古代反派弧线：对穿越者的身份怀疑逐渐增强，构成持续威胁
- 古代盟友弧线：帮主角融入，但本身也受现代视角改变`,
        conflictRhythm: `- 段落前1/3：新的古代障碍/危机+主角面对信息差困境
- 段落中1/3：现代知识应用初步尝试+身份危机升级
- 段落后1/3：先知碾压/命运改写的高光时刻+新的历史困局
- 节奏特点：喜剧文化冲突段(慢)：先知碾压段(快)≈2:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【穿越专属情绪节拍——信息差困境→先知碾压模式】
| beatId | 时间段   | emotion            | intensity | trigger                              |
|--------|----------|--------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | fish_out_of_water  | 0.6       | 现代人面对古代场景的信息差困境          |
| eb_2   | 8%-25%   | adaptation         | 0.45      | 主角利用现代知识试探性应对              |
| eb_3   | 25%-40%  | identity_threat    | 0.7       | 身份被怀疑/古代规则威胁               |
| eb_4   | 40%-52%  | crisis_peak        | 0.8       | 危机升至顶点（主角即将被识破）          |
| eb_5   | 52%-58%  | silence            | 0.0       | 关键先知应用前的静默（观众屏息）        |
| eb_6   | 58%-75%  | knowledge_crush    | 0.9       | 现代知识碾压古人（对方目瞪口呆）        |
| eb_7   | 75%-85%  | cultural_shock     | 0.65      | 古代人震惊反应+新认知建立              |
| eb_8   | 85%-95%  | resolve            | 0.5       | 主角局势稳固，但新知识点悬念埋入       |
| eb_9   | 95%-100% | next_crisis        | 0.75      | 新的古代危机出现（集末钩子）           |`,
        tensionCurveNotes: `- 文化冲突喜剧段节奏可相对宽松（4-6秒/Shot），让观众享受信息差趣味
- 先知碾压段（58%-75%）需要快切+强BGM，与喜剧段形成鲜明对比
- 身份危机场景必须用dutch_angle/over_shoulder制造不安感
- 每集至少1次"只有主角和观众知道"的镜头（主观POV+会心一笑）`,
        hookPatterns: `- 身份危机型：主角身份快要被识破，下集才知道能否化解
- 先知窘境型：主角知道即将发生的坏事，但无法改变
- 历史改写型：主角的行动改变了某个历史走向，后果未知
- 现代物品暴露型：现代物品快要被人发现`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%穿越+初探古代→铺垫22%文化适应+身份建立→上升25%先知优势扩大+感情线→高潮30%命运改写+身份危机→落幕15%
单集：前8%上集衔接/新古代危机→中60%文化冲突+应对尝试+危机升级→后32%先知解决+集末新困局
文化喜剧段:先知碾压段≈2:1`,
        paceIndicators: `- 穿越剧允许文化冲突喜剧段节奏较慢（每Shot 4-6秒）
- 先知应用场景少于每集2次=节奏感缺失（观众觉得"穿越没用"）
- 连续3集无身份危机=张力消解（必须保持身份暴露威胁）
- 历史背景说明段>3Shot=节奏拖沓（融入剧情，不要单独讲解）`,
      },
      agentSystemPrompts: {
        'storyboard-director': TIMETRAVEL_STORYBOARD_PROMPT,
        'arc-director': TIMETRAVEL_ARC_DIRECTOR_PROMPT,
        'episode-director': TIMETRAVEL_EPISODE_DIRECTOR_PROMPT,
        'audio-director': TIMETRAVEL_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': TIMETRAVEL_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': TIMETRAVEL_PACING_ANALYZER_PROMPT,
        'continuity-guard': TIMETRAVEL_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': TIMETRAVEL_HOOK_CRAFTER_PROMPT,
        'scriptwriter': TIMETRAVEL_SCRIPTWRITER_PROMPT,
        'dialogue-coach': TIMETRAVEL_DIALOGUE_COACH_PROMPT,
        'script-editor': TIMETRAVEL_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': TIMETRAVEL_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── palace ───────────────────────────
  palace: {
    displayName: '宫斗',
    description: '权谋博弈+后宫争锋+步步为营',
    genreKeywords: ['宫斗', '后宫', '权谋'],
    audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead'],
    toneTags: ['紧张', '智斗'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['计中计', '反将一军', '真相大白'],
      conflictPatterns: ['后宫争宠', '派系斗争', '忠奸难辨'],
      paywallStrategyHints: '每次反转前夕设卡，真正幕后黑手揭露前设卡',
    },
    profile: {
      productionGuidance: {
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
        coreConflictExample: '（如：出身寒门的选秀女被皇后打压入冷宫，却发现皇后最大秘密，以此为筹码反将一军，以"温顺"为面具，步步蚕食后宫格局）',
        paywallTip: '阴谋揭露型→卡在"幕后黑手即将现身"或"主角陷入最深危机"之前',
        antagonistTip: '反派：嫉妒的贵妃、野心勃勃的皇后、幕后的朝堂势力，手段要够阴毒',
        episodeTitleExample: '"后宫风云""棋局揭秘"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是宫斗/权谋短剧编剧手册生成专家。本次任务：为宫斗题材生成编剧手册。
【编剧思维框架】宫廷没有直接冲突，只有话语权的微妙蚕食；每句台词都有表面义和隐藏义；反将一军的爽感来自对手"以为赢了"的假象被彻底打破。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通双面表情叙事与宫廷权谋博弈的宫斗编剧；每段对话都是政治的；主角的"淡定嘴角微扬"比任何激烈言辞都更有杀伤力
- genreRules 必须包含（至少5条）：① 双面台词铁律（每句重要台词都有字面义+潜台词）② 权力层级视觉规范（谁站哪，谁先开口，谁先行礼）③ 宫廷信息差管控 ④ 反将一军的节奏控制（反派得意→主角淡定→亮底牌→反派崩溃）⑤ 证据/底牌的揭出时机
- dialogueGuide：古典雅致语言；表面客气实含针意；宫斗的威胁从不明说；禁止直白告白/直接威胁/现代白话
- visualNarrativeGuide：第一帧=宫廷权力格局wide；主角淡定close_up比言语更强；密谋场景必须有偷听者视角的insert_shot
- forbiddenPatterns：宫斗角色直说出自己的意图；直接肉体冲突解决问题；台词用现代白话`,

      profilerExamples: {
        genreName: '宫斗/权谋',
        segmentPrinciples:
          '① 段落感来自"博弈层级升高"（宫闱争宠→朝堂权力→废立储君→江山更迭），每段棋盘更大\n' +
          '② 每段开头建立宫廷权力格局（wide展示阵营），交代"这段谁对阵谁、谁知道什么"\n' +
          '③ 暗战（台词机锋/信息差博弈）与明斗约3:1，频繁肉体冲突消耗宫斗神秘感\n' +
          '④ 段末钩子偏"身份揭穿"或"底牌被翻"，让对方"以为赢了"的假象破裂\n' +
          '⑤ 段落间过渡用宫廷礼仪场景+权力符号变化，暗示格局转变',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | surface_peace | 0.25      | 宫廷日常（和平表象下的暗流）                         |\n' +
          '| eb_2   | 8%-20%   | unease        | 0.45      | 察觉对方台词里的双重含义                             |\n' +
          '| eb_3   | 20%-35%  | false_warmth  | 0.3       | 宾主尽欢，却各有算计                                 |\n' +
          '| eb_4   | 35%-50%  | veiled_trap   | 0.65      | 对方出招，将主角逼入两难                             |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 静默对视——谁先开口谁输（无BGM）                     |\n' +
          '| eb_6   | 55%-75%  | scheme_reveal | 0.92      | 主角亮出底牌，反将一军                               |\n' +
          '| eb_7   | 75%-85%  | opponent_fail | 0.7       | 对手意识到已被将死，面色大变                         |\n' +
          '| eb_8   | 85%-95%  | composure     | 0.4       | 主角依旧淡定，嘴角微扬                               |\n' +
          '| eb_9   | 95%-100% | bigger_game   | 0.8       | 更大棋局阴影降临（集末钩子）                         |',
        rhythmTemplate:
          '全剧：开场10%建立宫廷权力格局→铺垫25%信息差布局→上升25%博弈升级+阵营变化→高潮20%最终对决/真相揭露→落幕20%新局引入\n' +
          '单集：前8%宫廷礼仪场景建立权力感→中65%台词机锋（2-3轮交锋，一进一退）→后27%反将一军+集末新棋局\n' +
          '允许慢区：信息布局段允许节奏放慢，但每场台词必须有双层含义，禁止平铺直叙',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'rise_and_fall',
            narrationRatio: 0,
            factConstraint: 'inspired_by',
            hookMechanism: 'plot_cliffhanger',
            conflictType: 'interpersonal',
            characterEvolution: 'status',
            visualTone: 'period',
            adaptationNotes: `- 每段对话都是政治博弈：沉默与眼神比台词更有力；所有示好背后必须有动机
- 台词风格：古典白话（不必全文言但有宫廷腔调）；称谓规范（娘娘/臣妾/陛下/皇后娘娘）；威胁不明说而是引用规矩
- 集末钩子：联盟刚建立时出现背叛信号；计谋即将得手时遭遇变故（plot_cliffhanger）
- 史实元素以灵感来源处理：宫廷规制/朝代背景符合基调，人物关系可虚构
- 叙事弧线"兴衰型"：主角从卑微→权力顶端→维持/衰落，阶段分明（rise_and_fall）
- 地位变化外显：宫廷礼仪/服饰等级/他人跪拜与态度（status evolution）
- 节奏模式：开场10%建立权力格局 → 谋势30%积累盟友+埋棋子 → 上升25%计谋交锋加速 → 高潮20%最大反转+地位逆转 → 新势力平衡+钩子15%
- 记录重点：权力关系图；盟友/敌人站队变化；计谋链条完整性`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "rise_and_fall"\n   narrationRatio: 0\n   factConstraint: "inspired_by"\n   hookMechanism: "plot_cliffhanger"\n   conflictType: "interpersonal"\n   characterEvolution: "status"\n   visualTone: "period"\n   adaptationNotes 基线：\n   - 每段对话都是政治博弈：沉默与眼神比台词更有力；所有示好背后必须有动机\n   - 台词风格：古典白话（不必全文言但有宫廷腔调）；称谓规范（娘娘/臣妾/陛下/皇后娘娘）；威胁不明说而是引用规矩\n   - 集末钩子：联盟刚建立时出现背叛信号；计谋即将得手时遭遇变故（plot_cliffhanger）\n   - 史实元素以灵感来源处理：宫廷规制/朝代背景符合基调，人物关系可虚构\n   - 叙事弧线"兴衰型"：主角从卑微→权力顶端→维持/衰落，阶段分明（rise_and_fall）\n   - 地位变化外显：宫廷礼仪/服饰等级/他人跪拜与态度（status evolution）\n   - 节奏模式：开场10%建立权力格局 → 谋势30%积累盟友+埋棋子 → 上升25%计谋交锋加速 → 高潮20%最大反转+地位逆转 → 新势力平衡+钩子15%\n   - 记录重点：权力关系图；盟友/敌人站队变化；计谋链条完整性`,

      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'over_shoulder', 'high_angle', 'close_up'],
        signatureTechniques: ['双面表情公式（表面恭顺close_up+细节泄露真实意图）', '权力等级cameraAngle视觉化', '密谋dutch_angle+over_shoulder监视感', '反将一军五镜公式'],
        transitionStyle: '日常宫廷缓慢硬切；阴谋推进时over_shoulder快切；反将一军时先慢推后骤cut',
        cameraRuntime: {
          confrontation: '■ 【宫斗对峙=反将一军五镜公式】Shot①反派亮底牌→Shot②主角淡定close_up（嘴角微扬）→Shot③主角亮真正底牌→Shot④反派惊愕ECU→Shot⑤high_angle俯拍反派跌落/退缩',
          revelation: '■ 【宫斗揭秘=底牌揭露三阶段】① 表面恭顺阶段 ② 底牌揭出瞬间：medium_close_up+front+极short的slow_motion ③ 权力翻转后：high_angle俯拍反派，主角medium+front+static',
          climax: '■ 【宫斗高潮=当众揭穿四镜】Shot①当众局面wide→Shot②主角亮最后底牌（medium_close_up+front+crane_up）→Shot③全场反应wide→Shot④高位者重新认定close_up',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['古典弦乐轻柔旋律', '低频拨弦pizzicato', '低沉铜管tension层', '轻编钟'],
        sfxDensity: 'moderate',
        silenceUsage: '计谋揭露前drop_to_near_silence 0.5s；秘密会面用环境音（风声/烛火声）替代BGM；反将落定帧管弦swell',
        voiceActingStyle: '所有人表面恭顺内藏锋芒；台词双关词必须清晰可辨（BGM不能压台词）',
        genreBrandingDirective:
          '■ 【日常宫廷BGM】古典弦乐轻柔旋律+轻编钟，intensity=0.25-0.45，对话场景降至intensity=0.1\n' +
          '■ 【反将一军三阶音频】①表面顺从：轻柔弦乐 ②底牌揭露：drop_to_near_silence 0.5s ③反将落定：管弦swell+低铜管冲击，intensity=0.8',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.4, pacing: 1.1, hookStrength: 1.4, consistency: 1.3, emotionalImpact: 1.0 },
        genreSpecificChecks: [
          '每个close_up是否呈现"表面情绪vs隐藏意图"的双重视觉层次',
          '权力等级是否通过cameraAngle高度体现',
          '每集是否至少有一次计中计反转',
          '密谋场景是否加入了监视感元素',
          '所有对话场景BGM是否压低至不盖台词',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是宫廷权力层级的攀升——每段主角接触到更高层级的权力角逐
② 每段落有一个"生死危机+权谋化解"的高潮，手段比前一段更老练
③ 段落长度8-15集，高潮集在后1/3（权谋反转/圣心争夺集）
④ 每段末尾必须改变宫廷权力格局（某派系倒台/新势力崛起）
⑤ 感情线与权谋线交织，感情推进以权谋胜利为契机`,
        characterArcPrinciples: `- 女主弧线：每段从"弱者/棋子"到"掌握某项关键筹码"，但仍不是权力顶点
- 男主（帝王/权贵）弧线：每段从"利用女主"到"逐渐倚重/在意"，感情线滞后于权谋线
- 反派（妃嫔/朝臣）弧线：每段以一个具体的反派被铲除为节点
- 谋士/盟友弧线：帮助主角的人可能反目，每段至少一次立场考验`,
        conflictRhythm: `- 段落前1/3：新的宫廷阴谋/针对主角的陷害开始
- 段落中1/3：危机逐步升级，主角试探应对+反制棋局布置
- 段落后1/3：权谋反转+反派落败+新的权力格局浮现
- 节奏特点：谋划铺垫段(慢)：反转爆发段(快)≈2:1；台词密度>动作密度`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【宫斗专属情绪节拍——暗流涌动→权谋反转模式】
| beatId | 时间段   | emotion           | intensity | trigger                              |
|--------|----------|-------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | court_politics    | 0.65      | 宫廷权力场景建立，暗流涌动              |
| eb_2   | 8%-25%   | scheming          | 0.55      | 反派/主角各自谋划，信息差建立           |
| eb_3   | 25%-40%  | trap_activated    | 0.75      | 陷害/阴谋启动，主角陷入危机            |
| eb_4   | 40%-52%  | crisis_peak       | 0.85      | 危机升至顶点（生死/圣心关头）          |
| eb_5   | 52%-58%  | calculation       | 0.4       | 主角暗中布置反制，表面顺从（低BGM）     |
| eb_6   | 58%-75%  | reversal          | 0.9       | 权谋反转爆发（反派以为成功，实则已输）  |
| eb_7   | 75%-85%  | power_shift       | 0.7       | 宫廷格局变化，各方重新站队             |
| eb_8   | 85%-95%  | resolve           | 0.5       | 主角确立新优势，但留一个未解决的威胁    |
| eb_9   | 95%-100% | new_intrigue      | 0.75      | 新阴谋/新对手出现（集末钩子）          |`,
        tensionCurveNotes: `- 宫斗剧"谋划段"节奏可较慢（台词密集，每Shot 4-7秒）
- 反转爆发段（58%-75%）用快切+台词停顿+反派惊呆的close_up
- 宫廷场景always用high_angle/low_angle交替表达权力关系
- 密谋场景必须用over_shoulder/dutch_angle制造监视感`,
        hookPatterns: `- 阴谋曝光型：主角发现针对自己的新阴谋，但还不知全貌
- 圣心悬疑型：帝王态度的暧昧信号，下集才知真实意图
- 盟友反目型：信任的人出卖主角
- 权力格局倒转型：某强势派系突然覆灭，新势力填入`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%入宫/入局+宫廷格局建立→铺垫22%生存磨砺+初步谋划→上升25%首次权谋胜利+感情线→高潮30%终极权力争夺→落幕15%
单集：前8%上集衔接/宫廷新动向→中65%谋划+危机升级+反制布置→后27%反转+新格局
宫斗允许谋划段稍慢，但每集必须有一个信息爆料或反转`,
        paceIndicators: `- 宫斗剧允许台词密集段Shot时长达5-8秒（谋划博弈感）
- 连续3集无任何权力格局变化=节奏拖沓（必须每集有宫廷动向）
- 反转场景少于3Shot=爆发力不足
- 生死危机场景平均Shot>5秒=缺乏紧迫感（危机场用2-3秒快切）`,
      },
      agentSystemPrompts: {
        'storyboard-director': PALACE_STORYBOARD_PROMPT,
        'arc-director': PALACE_ARC_DIRECTOR_PROMPT,
        'episode-director': PALACE_EPISODE_DIRECTOR_PROMPT,
        'audio-director': PALACE_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': PALACE_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': PALACE_PACING_ANALYZER_PROMPT,
        'continuity-guard': PALACE_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': PALACE_HOOK_CRAFTER_PROMPT,
        'scriptwriter': PALACE_SCRIPTWRITER_PROMPT,
        'dialogue-coach': PALACE_DIALOGUE_COACH_PROMPT,
        'script-editor': PALACE_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': PALACE_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── revenge ───────────────────────────
  revenge: {
    displayName: '复仇',
    description: '真相追查+绝地反击+快意恩仇',
    genreKeywords: ['复仇', '逆袭', '反击'],
    audienceTags: ['女性向', '男性向'],
    protagonistFocusTags: ['female_lead', 'male_lead'],
    toneTags: ['爽快', '紧张'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'reelshort', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['真相揭露', '逆袭反杀', '当众打脸'],
      conflictPatterns: ['冤屈洗白', '身份反差', '势力对抗'],
      paywallStrategyHints: '主角准备反击但尚未出手时设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是复仇/逆袭短剧编剧手册生成专家。本次任务：为复仇题材生成编剧手册。
【编剧思维框架】受害→蜕变→反杀成长弧是整剧结构；积累了多久的high_angle委屈，low_angle出现时就有多爽；证据/真相是复仇叙事的核心节拍器。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通成长弧摄影语言的复仇编剧；cameraAngle的高度变化是主角所处弧线阶段的视觉日记；证据链积累→真相揭露是核心叙事节拍
- genreRules 必须包含（至少5条）：① 成长弧cameraAngle铁律（受害=high_angle俯拍/蜕变=平视/反杀=low_angle仰拍）② 证据链积累与揭露的节奏 ③ 受害期隐忍规范（不哭不叫，默默积累，拳头握紧不爆发）④ 蜕变转折的视觉信号设计 ⑤ 反杀时极简台词原则
- dialogueGuide：受害期主角台词被动隐忍；蜕变后变克制有力；反杀时说一句定音台词然后沉默；仇人的嚣张台词要"够作"积累观众愤怒
- visualNarrativeGuide：第一帧=受害最低谷ECU（建立积压起点）；证据insert_shot是核心叙事时刻；反杀后主角沉默定格比任何庆祝更有力
- forbiddenPatterns：受害段主角激动哭闹（破坏隐忍感）；证据无铺垫直接出现；反杀后主角长篇解释原委`,

      profilerExamples: {
        genreName: '复仇/逆袭',
        segmentPrinciples:
          '① 段落感来自"受害积压→证据积累→反杀揭露"三段式，每段积压层级更深（个人→家族→制度）\n' +
          '② 每段开头用high_angle建立主角当前弱势状态（积压起点）\n' +
          '③ 隐忍积累场（high_angle+暗色调）与反杀揭露场（low_angle）约2:1，积压段禁止主角激烈反应\n' +
          '④ 段末钩子偏"更深幕后黑手出现"或"核心证据碎片被发现"\n' +
          '⑤ 段落间过渡用cameraAngle高度渐变（high→平视→low），标记主角所处弧线阶段',
        emotionBeatTable:
          '| beatId | 时间段   | emotion      | intensity | trigger                                     |\n' +
          '|--------|----------|--------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | victim_low   | 0.75      | 受害起点（主角处于最低点，high_angle）              |\n' +
          '| eb_2   | 8%-20%   | endurance    | 0.5       | 隐忍（默默握拳，不爆发）                            |\n' +
          '| eb_3   | 20%-35%  | deeper_wound | 0.65      | 伤害加深（对手变本加厉）                            |\n' +
          '| eb_4   | 35%-50%  | clue_found   | 0.6       | 发现关键证据/真相碎片                               |\n' +
          '| eb_5   | 50%-55%  | silence      | 0.0       | 主角看着证据停住（"够了"的静默）                    |\n' +
          '| eb_6   | 55%-75%  | turn_reveal  | 0.95      | 反转揭露（证据落地，主角low_angle出现）             |\n' +
          '| eb_7   | 75%-85%  | collapse     | 0.7       | 对手崩溃（失去权力/被揭露/众叛亲离）                |\n' +
          '| eb_8   | 85%-95%  | define_line  | 0.5       | 主角说一句定音台词，然后沉默                        |\n' +
          '| eb_9   | 95%-100% | deeper_truth | 0.85      | 更深层真相/更大幕后黑手出现（集末钩子）             |',
        rhythmTemplate:
          '全剧：开场8%最低谷受害起点→铺垫30%隐忍积累（high_angle+暗色调）→上升25%蜕变阶段（平视机位）→高潮22%反杀+证据公开→落幕15%留更深真相\n' +
          '单集：前8%受害/被压制场景→中55%证据积累+隐忍表演→后37%反转揭露+定音台词+集末更深真相\n' +
          '允许慢区：隐忍积累段允许连续2-3集无大反转，但每集必须有至少1个证据碎片发现',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'good_vs_evil',
            characterEvolution: 'power_level',
            visualTone: 'gritty',
            adaptationNotes: `- 复仇链条必须可追踪：观众每集能感知到"离目标近了几步"；证据链积累是核心节拍
- 台词风格：压抑有力，仇恨用克制表达；主角台词越少越有力，禁止独白倾诉复仇宣言
- 集末钩子：真相碎片刚拼出一块时截断（revelation），或仇人刚察觉被跟踪时截断
- 善恶对立明确：反派动机必须可理解，不能只是"坏"；主角的正义感须有具体代价
- 实力成长需外显可见：从弱势被压到逐步具备对抗能力（power_level evolution）
- 视觉调性偏粗粝真实感（gritty）：低饱和度，环境压抑，禁止华丽滤镜
- 节奏模式：开场10%仇恨起点建立 → 蛰伏25%积累力量（禁早期爽点泄底） → 上升30%证据链推进+局部反击 → 高潮25%终极对决 → 真相揭露+钩子10%
- 记录重点：证据链完整性；复仇进度百分比；反派知情程度`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "good_vs_evil"\n   characterEvolution: "power_level"\n   visualTone: "gritty"\n   adaptationNotes 基线：\n   - 复仇链条必须可追踪：观众每集能感知到"离目标近了几步"；证据链积累是核心节拍\n   - 台词风格：压抑有力，仇恨用克制表达；主角台词越少越有力，禁止独白倾诉复仇宣言\n   - 集末钩子：真相碎片刚拼出一块时截断（revelation），或仇人刚察觉被跟踪时截断\n   - 善恶对立明确：反派动机必须可理解，不能只是"坏"；主角的正义感须有具体代价\n   - 实力成长需外显可见：从弱势被压到逐步具备对抗能力（power_level evolution）\n   - 视觉调性偏粗粝真实感（gritty）：低饱和度，环境压抑，禁止华丽滤镜\n   - 节奏模式：开场10%仇恨起点建立 → 蛰伏25%积累力量（禁早期爽点泄底） → 上升30%证据链推进+局部反击 → 高潮25%终极对决 → 真相揭露+钩子10%\n   - 记录重点：证据链完整性；复仇进度百分比；反派知情程度`,

      cameraStyleGuide: {
        preferredAngles: ['front', 'low_angle', 'three_quarter', 'high_angle'],
        signatureTechniques: ['受害期high_angle+蜕变期low_angle（同一角色机位蜕变讲述成长）', '当众打脸五镜公式', '闪回用色调+浅景深与现实线区分', '蜕变宣告Shot（背光逆光强调）'],
        transitionStyle: '现实线硬切；闪回色调突变区分；蜕变关键帧前brief pause后接力量音效',
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['低沉弦乐积压感', '电子暗潮（复仇布局）', '工业节拍（行动执行）', '旋律主题swell（打脸爽点）'],
        sfxDensity: 'moderate',
        silenceUsage: '受害积压段BGM intensity≤0.3；反击前drop_to_silence 0.8-1s；出手帧冲击音效+swell',
        voiceActingStyle: '受害期：声音偏弱但眼神坚定；蜕变后：克制中爆发，关键台词短促有力',
        genreBrandingDirective:
          '■ 【受害积累段BGM】低沉弦乐持续音，intensity=0.2-0.3；禁止热血旋律\n' +
          '■ 【打脸三阶音频公式】①积压：紧张弦乐intensity=0.3 ②沉默：drop_to_silence 0.8-1s ③爆发：主题旋律swell+打击冲击，intensity=0.85',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.3, dialogueNaturalness: 1.1, pacing: 1.2, hookStrength: 1.4, consistency: 1.1, emotionalImpact: 1.2 },
        genreSpecificChecks: [
          '受害期是否全程使用high_angle+压抑构图，蜕变后是否切换至low_angle/平视',
          '受害积累段BGM intensity是否≤0.3',
          '打脸场景是否完整经历：目击者建立→加害方得意→主角亮底牌→加害方崩溃→群众reaction的五步',
          '闪回与现实是否用可感知的色调差异区分',
          '付费卡点是否卡在主角"即将出手但尚未出手"的最高张力点',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是"复仇赌注递进"——每段主角复仇的一个具体目标被清算
② 每段有一个"昔日加害者认出/认不出主角"的高潮，是最大爽点
③ 段落长度8-15集，高潮集在后1/3（清算/打脸集）
④ 每段主角身份伪装加深一层，被发现风险也递增
⑤ 段末留"更大仇人浮现"或"复仇计划出现变数"`,
        characterArcPrinciples: `- 主角弧线：每段清算一个具体仇人，但情感代价也递增（逐渐走向"赢了世界失去自己"的边缘）
- 仇人弧线：每段一个仇人被清算，但每个清算后揭露出更大的幕后
- 帮手（男主）弧线：从工具关系→情感联结，每段在"是否帮主角复仇"上有立场考验
- 无辜者弧线：卷入复仇的无辜者，让主角产生道德困境，防止复仇剧流于纯爽`,
        conflictRhythm: `- 段落前1/3：复仇目标的新计划+主角埋伏/接近
- 段落中1/3：执行过程中的变数（被怀疑/新信息打乱计划）
- 段落后1/3：清算爆发+仇人反应+新层级仇人揭露
- 节奏特点：潜伏谋划段(慢)：清算爆发段(快)≈1.5:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【复仇专属情绪节拍——潜伏蓄力→清算爆发模式】
| beatId | 时间段   | emotion          | intensity | trigger                              |
|--------|----------|------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | cold_resolve     | 0.7       | 主角带着复仇意志潜伏（冷静危险感）      |
| eb_2   | 8%-25%   | infiltration     | 0.55      | 接近目标过程，微妙信息差               |
| eb_3   | 25%-40%  | risk             | 0.7       | 被怀疑/计划出现变数（不安感）          |
| eb_4   | 40%-52%  | crisis           | 0.8       | 身份快要暴露/计划快要失败             |
| eb_5   | 52%-58%  | silence          | 0.0       | 清算前绝对静默                        |
| eb_6   | 58%-75%  | reckoning        | 0.95      | 清算爆发：仇人认出→主角揭示身份→反转  |
| eb_7   | 75%-85%  | shock_shame      | 0.75      | 仇人的恐惧/羞辱/崩溃                  |
| eb_8   | 85%-95%  | cold_satisfaction| 0.55      | 主角冷静"收网"，观众爽感沉淀          |
| eb_9   | 95%-100% | next_level       | 0.8       | 更大幕后/新层级仇人出现（集末钩子）    |`,
        tensionCurveNotes: `- 潜伏段必须保持"冷静危险感"，BGM用低频弦乐，不用兴奋节奏型
- 清算爆发段（58%-75%）比霸总打脸更冷峻，不是爆发式而是"碾压式"
- 仇人认出主角的瞬间是全集最重要帧——必须是ECU+slow_push_in
- 主角复仇台词要简短有力，禁止长篇控诉（复仇越冷静越爽）`,
        hookPatterns: `- 身份险些暴露型：仇人快要认出主角，下集才知结果
- 更大幕后型：清算完一个仇人，发现更大的黑幕
- 复仇代价型：主角的行动伤害到无辜者，出现道德困境
- 盟友背叛型：帮助复仇的人出于自身利益背刺`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%受辱/家破+复仇起点→铺垫20%蓄力准备+假身份建立→上升25%第一次清算+新层级→高潮32%终极大仇清算→落幕15%
单集：前8%上集衔接/新目标出现→中58%潜伏接近+变数→后34%清算+集末新层级
潜伏段:清算段:余韵段≈1.5:1:0.5`,
        paceIndicators: `- 复仇剧潜伏段允许Shot时长4-7秒（营造紧绷感，不是拖沓）
- 连续3集无任何清算或实质性复仇推进=节奏过慢
- 清算场景低于3个镜头切换=力度不足（清算场必须是全集最快切段）
- 复仇台词超过10字/句=失去冷峻感（简短冷然才是复仇风格）`,
      },
      agentSystemPrompts: {
        'storyboard-director': REVENGE_STORYBOARD_PROMPT,
        'arc-director': REVENGE_ARC_DIRECTOR_PROMPT,
        'episode-director': REVENGE_EPISODE_DIRECTOR_PROMPT,
        'audio-director': REVENGE_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': REVENGE_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': REVENGE_PACING_ANALYZER_PROMPT,
        'continuity-guard': REVENGE_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': REVENGE_HOOK_CRAFTER_PROMPT,
        'scriptwriter': REVENGE_SCRIPTWRITER_PROMPT,
        'dialogue-coach': REVENGE_DIALOGUE_COACH_PROMPT,
        'script-editor': REVENGE_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': REVENGE_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── rebirth ───────────────────────────
  rebirth: {
    displayName: '重生',
    description: '前世记忆+改写命运+步步先机',
    genreKeywords: ['重生', '前世', '逆天改命'],
    audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead'],
    toneTags: ['爽快', '虐中带甜'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'wechat_mini'],
    seedHints: {
      catharsisPresets: ['命运改写', '先知碾压', '仇人末路'],
      conflictPatterns: ['前世悲剧重现', '命运惯性', '新变量介入'],
      paywallStrategyHints: '关键命运分叉点前设卡',
    },
    profile: {
      productionGuidance: {
        flags: { isHistorical: false, isBiopic: false, isMystery: false, isFantasy: false },
        maleLeadFormula: '重生（男主视角）：成熟稳重，眉眼间有历经沧桑的沉淀感，不能太嫩；外表年龄与内心年龄的反差（少年外表藏着老灵魂）是关键。',
        femaleLeadFormula: '重生（女主视角）：外表可年轻，但眼神藏着前世记忆的沉淀感；初期弱势但眼神深邃，让观众感知到"她不一样了"。',
        coreLoopBlock: '=== 核心循环（重生）===\n- 基本模式：利用前世记忆→改变命运→蝴蝶效应→新的危机（每3-5集一个循环）\n- 爽点设计：先知碾压（提前布局）、仇人末路、命运改写成功\n- 核心循环的关键：每集至少一次"主角知道接下来会发生什么"的具体应用',
        conflictBlock: '=== 冲突设计原则（重生）===\n- 冲突核心：前世命运的惯性 vs 主角主动改变\n- 新变量必须存在：有一个前世没有发生过的事（蝴蝶效应）制造不确定性\n- 仇人必须明确（前世的加害者），让观众期待主角如何反杀\n- 核心爽点：先知反杀/命运改写/仇人落败/蝴蝶效应惊喜',
        arcStructureHint: '段落1（第1-25%集）：重生时刻+先知能力确认+前世仇恨建立+第一次改变命运\n段落2：主动布局+先知优势扩大+前世轨迹偏离+仇人出现\n段落3：前世惯性反噬+危机加深+关键命运节点\n段落4（最后15%）：决定性对决+命运彻底改写+结局',
        paywallStrategyHint: '关键命运分叉点前设卡（主角即将做出改写命运的决定）\n第8-15集设第一个付费卡点；之后每5-8集在命运关键时刻前设卡',
        contractHint: '（示例："只要你追下去，每次命运要重蹈覆辙时，她都会用前世记忆彻底颠覆结局"）',
        hookTypesHint: 'preferredTypes 参考：["命运岔路口","前世记忆触发","仇人登场","蝴蝶效应","先知出手","新危机与前世不同"]',
        toneHint: 'toneGuardrails 参考：重生期望感必须大于悲伤感；前世闪回≤5秒；重生后主角必须有明确的行动推进',
        narrativeModeTip: '台词 > 动作 > 旁白，前世记忆是爽点但不能每集都靠金手指',
        coreConflictExample: '（如：被亲姐和男友联手害死的商界女强人，重生回婚前三年，用前世记忆提前布局——对方以为的必赢之局，她早就换了底牌）',
        paywallTip: '蝴蝶效应型→卡在"主角改变命运引发意外后果"；卡在"前世仇人发现主角异常"',
        antagonistTip: '反派：前世害死主角的人，主角有记忆优势但对方仍很强，禁止轻敌设计',
        episodeTitleExample: '"重来一次""命运改写"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是重生/逆袭短剧编剧手册生成专家。本次任务：为重生题材生成编剧手册。
【编剧思维框架】前世创伤→重生决心→命运改写是三段不可分割的叙事链；前世high_angle+暗色调 vs 重生后low_angle+鲜明色调的对比，是整剧的视觉成长弧；每个"改变"必须让观众感受到"这一次不同了"。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通双时间线叙事与命运改写弧的重生编剧；前世记忆驱动当前行动是核心叙事逻辑；"我早就知道了"的克制碾压是爽感核心
- genreRules 必须包含（至少5条）：① 双色调铁律（前世暗沉/重生鲜明，色调+机位高度即时间线区分）② 前世记忆闪回规范（≤5秒/暗色调/slow_motion/必须以创伤ECU开头结尾回到当下）③ 命运岔路口的视觉化处理 ④ "我早就知道"碾压节奏 ⑤ 仇人面前的克制布局
- dialogueGuide：重生主角台词有"已知结局"的淡然；前世相关台词带创伤感；禁止重生后立即嚣张报复（应是克制的暗暗布局）
- visualNarrativeGuide：第一帧=主角ECU眼睛睁开slow_motion（色调骤变=重生信号）；前世命运物件的insert_shot是叙事锚点；仇人面前主角克制平静比愤怒爆发更强
- forbiddenPatterns：前世重生场景色调相同；重生后立即大喊复仇；闪回超过5秒`,

      profilerExamples: {
        genreName: '重生/逆袭',
        segmentPrinciples:
          '① 段落感来自"改写前世结局的一个维度"，每段锁定一个关键命运节点（婚姻→产业→生死）\n' +
          '② 每段开头用前世闪回（暗色调≤5秒）触发主角"这一次不同了"的驱动力\n' +
          '③ 伪弱者布局场（暗中布置）与命运改写场约2:1，布局场必须给出具体改写行动\n' +
          '④ 段末钩子偏"出现前世记忆中没有的变量"（超出预知范围）\n' +
          '⑤ 段落间过渡用前世/今世对比蒙太奇，强调主角走在不同的命运分支上',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | memory_flash  | 0.9       | 前世创伤闪回（暗色调slow_motion≤5秒）               |\n' +
          '| eb_2   | 8%-20%   | resolution    | 0.65      | 主角确认"这一次不同了"（目光坚定ECU）                |\n' +
          '| eb_3   | 20%-35%  | surface_weak  | 0.3       | 主角伪装弱势，暗中观察                               |\n' +
          '| eb_4   | 35%-50%  | layout        | 0.6       | 利用前世记忆提前布局                                 |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 面对前世仇人，主角静止（"我早就知道了"）             |\n' +
          '| eb_6   | 55%-75%  | fate_rewrite  | 0.95      | 命运改写（前世/今世对比蒙太奇，结局截然不同）        |\n' +
          '| eb_7   | 75%-85%  | triumph       | 0.7       | 仇人落败（不知道自己已经输了）                       |\n' +
          '| eb_8   | 85%-95%  | composure     | 0.45      | 主角克制，不庆祝（还有更深的棋局）                   |\n' +
          '| eb_9   | 95%-100% | new_unknown   | 0.85      | 出现前世记忆中没有的变量（集末钩子）                 |',
        rhythmTemplate:
          '全剧：开场8%前世创伤闪回建立驱动力→铺垫20%伪弱者状态与暗中布局→上升30%逐步改写前世结局→高潮25%与前世命运的决定性对比→落幕17%前世记忆之外的未知领域\n' +
          '单集：前8%前世记忆触发（暗色调ECU）→中65%命运布局推进+与前世平行对比→后27%命运改写高潮+集末新变量\n' +
          '允许慢区：情感修复/与仇人周旋场允许2集放缓，用前世对比蒙太奇维持情感密度',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0.05,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'interpersonal',
            characterEvolution: 'status',
            visualTone: 'glamorous',
            adaptationNotes: `- 旁白叙述占比约5%，用于前世记忆闪回时的简短背景锚定（每集不超过1-2次）
- 前世记忆驱动当前行动是核心叙事逻辑："我早就知道了"的克制碾压是爽感核心
- 台词风格：表面与重生前相似，实则隐藏先知优势；不能让敌人察觉已重生
- 集末钩子：刚改变命运节点时发现新威胁（revelation），或前世惨剧即将重演前截断
- 地位变化外显：从"被所有人轻视"到"逐步掌控局面"（status evolution）
- 前世/今世时间线对比：可用简短闪回（3-5s）作为情感锚点，不宜过长
- 节奏模式：开场10%前世结局+重生触发 → 布局25%利用先知改写关键节点 → 上升30%关键命运岔路 → 高潮25%终极改写时刻 → 新未知威胁+钩子10%
- 记录重点：前世vs今世节点对比；先知信息差使用；命运改写里程碑`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0.05\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "interpersonal"\n   characterEvolution: "status"\n   visualTone: "glamorous"\n   adaptationNotes 基线：\n   - 旁白叙述占比约5%，用于前世记忆闪回时的简短背景锚定（每集不超过1-2次）\n   - 前世记忆驱动当前行动是核心叙事逻辑："我早就知道了"的克制碾压是爽感核心\n   - 台词风格：表面与重生前相似，实则隐藏先知优势；不能让敌人察觉已重生\n   - 集末钩子：刚改变命运节点时发现新威胁（revelation），或前世惨剧即将重演前截断\n   - 地位变化外显：从"被所有人轻视"到"逐步掌控局面"（status evolution）\n   - 前世/今世时间线对比：可用简短闪回（3-5s）作为情感锚点，不宜过长\n   - 节奏模式：开场10%前世结局+重生触发 → 布局25%利用先知改写关键节点 → 上升30%关键命运岔路 → 高潮25%终极改写时刻 → 新未知威胁+钩子10%\n   - 记录重点：前世vs今世节点对比；先知信息差使用；命运改写里程碑`,

      cameraStyleGuide: {
        preferredAngles: ['front', 'three_quarter', 'close_up', 'pov'],
        signatureTechniques: ['重生三镜（前世末帧→特效帧→重生ECU）', '仇人出场权力倒置（重生后主角平视/低角仇人）', '前世闪回色调+浅景深+慢动作区分', '先知掌控低角度+从容表情'],
        transitionStyle: '重生瞬间dutch_angle+色调骤变；前世闪回暖色低通filter进出；日常硬切',
        cameraRuntime: {
          revelation: '■ 【重生揭秘=前世记忆触发三镜公式】Shot①重生当下close_up→Shot②前世记忆闪回ECU（暖色低饱和+slow_motion，≤3秒）→Shot③重生主角ECU重回现实（色调骤然鲜明，眼神悲痛→坚定）',
          climax: '■ 【重生高潮=命运改写落地四镜】Shot①前世溃败/死亡（暗色调闪回，≤2秒）→Shot②重生主角在同一时刻做出不同选择（鲜明色调，low_angle）→Shot③对手/仇人ECU惊愕→Shot④wide+crane_up格局重建\n■ qualityTier: "golden"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['钢琴主题旋律（自信版+悲伤版两套）', '情感弦乐', '时光流逝逆行音效', '电影感管弦'],
        sfxDensity: 'sparse',
        silenceUsage: '重生瞬间逆时间声+心跳加速；关键命运决定前brief_silence强调重量',
        voiceActingStyle: '主角：内心独白成熟冷静（与外表年龄形成反差）；前世场景声音偏弱，重生后逐渐有力',
        genreBrandingDirective:
          '■ 【重生瞬间音效公式】前世最后声音→逆时间效果声（音频倒放0.8s）+心跳减速→心跳加速→清晨环境音渐入，共3-4秒\n' +
          '■ 【前世闪回BGM】钢琴主题滤波处理版（低通，模糊温暖），intensity=0.2-0.3；禁止清晰高频旋律\n' +
          '■ 【集尾hook（命运岔路口前）】BGM在主角看到前世关键转折点时fade_to_silence→主角ECU定格→完全静默',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.2, pacing: 1.1, hookStrength: 1.3, consistency: 1.3, emotionalImpact: 1.3 },
        genreSpecificChecks: [
          '前世vs重生后的色调差异是否可感知（仅看截图能区分时间线）',
          '重生瞬间是否完整经历：前世末帧→特效帧→重生ECU三段',
          '主角先知行动是否在每集有至少1次具体体现',
          '仇人出场时主角的cameraAngle是否完成权力倒置',
          '前世闪回是否用色调+浅景深+慢动作与现实线区分，且单次闪回≤5秒',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是"重生知识的应用场景"——从个人命运→家族危机→更大阴谋
② 每段主角用前世记忆破解一个具体的"命运陷阱"，同时揭露更深的幕后
③ 段落长度8-15集，高潮集在后1/3（最大命运改写集）
④ 每段仇人不知道主角重生，信息差是核心爽感来源
⑤ 段末留"前世没见到的真相"或"主角无法改变的命运悬念"`,
        characterArcPrinciples: `- 主角弧线：每段从"重蹈前世陷阱"危机到"先知破局"，但也会出现前世没有的变数
- 仇人弧线：每段主角暗中消除一个威胁，但仇人还不知道自己已经输了
- 男主弧线：前世可能是伤害主角的人，重生后逐渐发现真相并改变
- 闺蜜/家人弧线：重生后主角对其态度改变，对方困惑，逐渐了解真相`,
        conflictRhythm: `- 段落前1/3：前世的某个关键节点复现+主角面对"是否改变"的选择
- 段落中1/3：先知应对过程中出现前世没有的变量（阴谋比前世更深）
- 段落后1/3：命运改写成功+更深层真相揭露
- 特殊节奏：前世闪回段(极慢，≤5秒/闪回)：先知应对段(快)≈1:3`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【重生专属情绪节拍——命运复现→先知改写模式】
| beatId | 时间段   | emotion            | intensity | trigger                              |
|--------|----------|--------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | deja_vu_dread      | 0.7       | 前世关键节点复现（主角认出，观众看懂） |
| eb_2   | 8%-22%   | foreknowledge      | 0.5       | 主角知道接下来会发生什么（信息差萌）   |
| eb_3   | 22%-38%  | trap_incoming      | 0.75      | 陷阱开始运转，前世结局在逼近          |
| eb_4   | 38%-52%  | pivot_decision     | 0.8       | 主角做出改变命运的关键决定            |
| eb_5   | 52%-58%  | silence            | 0.0       | 改写命运前的屏息静默                  |
| eb_6   | 58%-75%  | fate_rewrite       | 0.95      | 先知破局爆发（仇人计划落空，全场震惊） |
| eb_7   | 75%-85%  | revelation         | 0.7       | 更深层阴谋/前世真相碎片揭露           |
| eb_8   | 85%-95%  | cold_resolve       | 0.55      | 主角确定下一步计划                    |
| eb_9   | 95%-100% | unknown_variable   | 0.8       | 前世没有发生的变量出现（集末钩子）     |`,
        tensionCurveNotes: `- 前世闪回必须用视觉滤镜明确标注（去饱和/低对比），且单次≤5秒
- 先知破局段（58%-75%）是全集最高密度切镜区
- "命运改写瞬间"必须与前世对应场景形成视觉呼应（同景别/反角度）
- 每集"仇人还不知道自己已经输了"的时刻是独特爽感，必须用主角视角POV强化`,
        hookPatterns: `- 前世变量型：出现前世没有发生过的事，打乱主角的先知计划
- 真相碎片型：揭露前世某个误解的真相（仇人可能另有苦衷）
- 男主困境型：男主即将犯下前世的同样错误，主角是否提醒
- 先知极限型：主角的前世记忆到了某个时间节点就断了（未知领域）`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%前世惨死+重生瞬间→铺垫20%时间线确认+初步复仇/改命→上升25%命运改写扩大→高潮32%前世最大悲剧改写→落幕15%
单集：前8%上集衔接/前世节点复现→中60%陷阱+先知应对+关键决定→后32%命运改写+新变量
前世闪回只在情绪锚点出现，全集不超过2次且每次≤5秒`,
        paceIndicators: `- 前世闪回超过5秒/次=节奏中断（打乱当下时间线沉浸感）
- 连续3集无命运改写或先知关键应用=节奏失速
- 重生剧允许"主角独处回忆"稍慢（前世信息整合），但不超过4Shot
- 先知破局场景快慢必须极端对比：破局前最慢→破局瞬间最快`,
      },
      agentSystemPrompts: {
        'storyboard-director': REBIRTH_STORYBOARD_PROMPT,
        'arc-director': REBIRTH_ARC_DIRECTOR_PROMPT,
        'episode-director': REBIRTH_EPISODE_DIRECTOR_PROMPT,
        'audio-director': REBIRTH_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': REBIRTH_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': REBIRTH_PACING_ANALYZER_PROMPT,
        'continuity-guard': REBIRTH_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': REBIRTH_HOOK_CRAFTER_PROMPT,
        'scriptwriter': REBIRTH_SCRIPTWRITER_PROMPT,
        'dialogue-coach': REBIRTH_DIALOGUE_COACH_PROMPT,
        'script-editor': REBIRTH_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': REBIRTH_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── suspense ───────────────────────────
  suspense: {
    displayName: '悬疑',
    description: '层层谜团+反转不断+烧脑推理',
    genreKeywords: ['悬疑', '推理', '反转'],
    audienceTags: ['男女通吃', '20-40岁'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['紧张', '烧脑'],
    platformTags: ['douyin', 'hongguo', 'bilibili', 'iqiyi', 'reelshort'],
    seedHints: {
      catharsisPresets: ['真相反转', '意外揭露', '逻辑闭环'],
      conflictPatterns: ['多重嫌疑人', '不可靠叙事', '时间线谜题'],
      paywallStrategyHints: '关键线索发现前、真相即将揭露前设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是悬疑/推理短剧编剧手册生成专家。本次任务：为悬疑题材生成编剧手册。
【编剧思维框架】信息差是核心——观众永远比角色多知道一件事或少知道一件事；每集至少一条新线索或一个新嫌疑人；不可靠叙事：信任的人可能是骗子。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通信息差与推理闭环的悬疑编剧；观众对真相的期待是唯一叙事引擎；逻辑必须自洽
- genreRules 必须包含（至少5条）：① 每集至少一条新线索或新嫌疑人 ② 不可靠叙事规范 ③ 时间压力（主角必须在有限时间内解决）④ 真相反转的节奏控制 ⑤ 信息差地图（谁知道什么，观众要比哪个角色先/后知道）
- dialogueGuide：信息量精准控制，不该说的坚决不说；悬念台词从不明说答案；禁止过早泄露关键信息
- visualNarrativeGuide：第一帧=谜团建立或关键证物ECU；窥视构图（dutch_angle/over_shoulder）强化不安感；密谋场景必须有监视感
- forbiddenPatterns：主角太蠢影响推理代入感；逻辑硬伤；过度暴力血腥；结局前强行引入全新设定解围（"开后门"）；每集都揭示真相让悬念提前耗尽；嫌疑人太少导致观众秒猜凶手`,

      profilerExamples: {
        genreName: '悬疑/推理',
        segmentPrinciples:
          '① 段落感来自"谜团层级升高"（表象案件→幕后黑手→更大阴谋），每段信息量递增\n' +
          '② 每段开头建立新谜团或新嫌疑人，交代"观众目前知道多少"\n' +
          '③ 线索揭露场与误导场约1:1，每集至少一条新线索\n' +
          '④ 段末钩子偏"真相碎片"或"新证人反转"\n' +
          '⑤ 段落间过渡用关键证物/地点重现，暗示信息差变化',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | unease        | 0.7       | 异常发现/新线索暗示（dutch_angle窥视感）             |\n' +
          '| eb_2   | 8%-20%   | curiosity     | 0.5       | 主角开始追查，观众跟随                             |\n' +
          '| eb_3   | 20%-35%  | suspicion     | 0.6       | 新嫌疑人/误导线索出现                              |\n' +
          '| eb_4   | 35%-50%  | tension       | 0.75      | 关键证人/证据即将揭露                              |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 揭露前静默（无BGM，悬念最大化）                     |\n' +
          '| eb_6   | 55%-75%  | revelation    | 0.9       | 真相碎片/证词反转（认知颠覆）                       |\n' +
          '| eb_7   | 75%-85%  | aftermath     | 0.6       | 主角/观众消化新信息                                |\n' +
          '| eb_8   | 85%-95%  | new_question  | 0.5       | 更大谜团浮现                                      |\n' +
          '| eb_9   | 95%-100% | cliffhanger   | 0.85      | 新线索/新威胁出现（集末钩子）                       |',
        rhythmTemplate:
          '全剧：开场8%谜团建立→铺垫25%线索积累（信息密度高）→上升27%关键揭露→高潮25%大反转→落幕15%新谜团\n' +
          '单集：前8%上集悬念回应/新线索→中60%追查与误导交织→后32%揭露+集末新钩子\n' +
          '允许慢区：推理铺垫段信息密度高但节奏中等，禁止平铺直叙',
      } satisfies GenreProfilerExamples,
          genreArchetypePreset: {
            narrativeArc: 'mystery_reveal',
            narrationRatio: 0.05,
            factConstraint: 'none',
            hookMechanism: 'mystery',
            conflictType: 'good_vs_evil',
            characterEvolution: 'costume_only',
            visualTone: 'dark',
            adaptationNotes: `- 旁白叙述占比约5%，用于时间线锚定和信息差管控，声音质感压抑克制
- 叙事引擎：观众对真相的期待 = 唯一驱动力；每集必须回收1个疑问、抛出2个新疑问
- 信息差管控：观众永远比主角少知道一件事（或多知道一件事，两者选一，全剧统一）
- 台词风格：暗语、双关、省略；反派不主动暴露；证人/目击者说话总有所保留
- 集末钩子：谜团刚深化一层时截断（mystery型），禁止用情感炸弹收尾
- 逻辑必须自洽：每集信息在结局前应能推导出答案；禁止开后门/设置无法提前感知的设定
- 节奏模式：开场10%事件触发+第一个疑问 → 调查30%线索积累（中等节奏但信息密度高） → 上升25%假答案被推翻+更大真相浮现 → 高潮20%真相揭露 → 余波+新谜团10%
- 记录重点：信息差地图（谁知道什么）；线索链完整性；逻辑自洽检验`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "mystery_reveal"\n   narrationRatio: 0.05\n   factConstraint: "none"\n   hookMechanism: "mystery"\n   conflictType: "good_vs_evil"\n   characterEvolution: "costume_only"\n   visualTone: "dark"\n   adaptationNotes 基线：\n   - 旁白叙述占比约5%，用于时间线锚定和信息差管控，声音质感压抑克制\n   - 叙事引擎：观众对真相的期待 = 唯一驱动力；每集必须回收1个疑问、抛出2个新疑问\n   - 信息差管控：观众永远比主角少知道一件事（或多知道一件事，两者选一，全剧统一）\n   - 台词风格：暗语、双关、省略；反派不主动暴露；证人/目击者说话总有所保留\n   - 集末钩子：谜团刚深化一层时截断（mystery型），禁止用情感炸弹收尾\n   - 逻辑必须自洽：每集信息在结局前应能推导出答案；禁止开后门/设置无法提前感知的设定\n   - 节奏模式：开场10%事件触发+第一个疑问 → 调查30%线索积累（中等节奏但信息密度高） → 上升25%假答案被推翻+更大真相浮现 → 高潮20%真相揭露 → 余波+新谜团10%\n   - 记录重点：信息差地图（谁知道什么）；线索链完整性；逻辑自洽检验`,

      cameraStyleGuide: {
        preferredAngles: ['dutch_angle', 'over_shoulder', 'pov', 'close_up', 'high_angle'],
        signatureTechniques: ['窥视监视感构图（dutch_angle+over_shoulder偷听场景）', '证物线索ECU insert_shot（真相揭露前必有）', '不可靠叙事POV+失焦处理（主观视角可能有偏差时）', '真相反转dolly_zoom（认知颠覆瞬间）'],
        transitionStyle: '线索揭露前brief_pause后硬切；认知颠覆时dolly_zoom+dutch_angle；推理回溯段快速montage',
        cameraRuntime: {
          revelation:
            '■ 【悬疑揭秘=真相反转四镜公式】Shot①"确信"状态medium+static（主角以为掌握全部） → Shot②异常细节insert_shot ECU（线索植入） → Shot③dolly_zoom+dutch_angle（认知崩塌） → Shot④主角ECU重组认知+新的追查方向',
          confrontation:
            '■ 【悬疑审讯=信息博弈三阶段】① 建立位置：medium_wide两人，审讯者背光占优 ② 交锋：over_shoulder快切，ECU捕捉微表情破绽 ③ 破防/信息获取：close_up嫌疑人面部+slow_push_in',
          climax:
            '■ 【悬疑高潮=真相全貌揭露四镜】Shot①推理回溯montage（insert_shot线索串联快切） → Shot②幕后黑手ECU（第一次正面展示） → Shot③wide格局重建（各方关系清晰化） → Shot④主角medium+front定格（案件解决/新谜团开启）',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['极简弦乐持续音（tension层）', '钢琴单音断奏', '低频环境drone', '电子ambient（信息处理感）', '稀疏打击乐节拍'],
        sfxDensity: 'moderate',
        silenceUsage: '关键真相揭露前drop_to_silence 1-2s（比其他题材更长）；偷听密谋场景用环境音代替BGM；真相落定后brief_silence让观众消化',
        voiceActingStyle: '主角（侦探/调查者）：克制冷静，关键推理时语速略慢；证人/嫌疑人：说话有所保留，句末常被打断；反派：正常腔调，不暴露自己',
        genreBrandingDirective:
          '■ 【推理铺垫段BGM】极简弦乐持续音+低频drone，intensity=0.2-0.35；禁止旋律性强的BGM（影响观众推理思考）\n' +
          '■ 【证物发现三阶音频】①日常：轻ambient ②发现异常：BGM骤停（drop_to_silence 0.5s）③认知建立：短促弦乐stinger，intensity=0.6\n' +
          '■ 【真相反转音频公式】①假设阶段：低密度ambient ②颠覆瞬间：dissonant弦乐stinger+BGM骤停 ③重组：新主题旋律缓慢建立\n' +
          '■ 【追逐/危机段BGM】电子节拍+弦乐快速律动，intensity=0.7-0.85；SFX环境音同步\n' +
          '■ 【集尾hook】BGM在新谜团揭示前fade_to_near_silence→关键台词/画面清晰落地→BGM骤停，定格疑问',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.0, dialogueNaturalness: 1.3, pacing: 1.2, hookStrength: 1.5, consistency: 1.5, emotionalImpact: 0.9 },
        genreSpecificChecks: [
          '每集是否有至少1条新线索或新嫌疑人信息（悬疑节奏核心指标）',
          '全集信息差地图是否一致：观众知道的和主角知道的边界是否清晰',
          '真相反转场景是否使用了dolly_zoom或dutch_angle（而非普通cut）',
          '密谋/偷听场景是否有窥视感构图（over_shoulder/门缝/遮挡物）',
          '集末钩子是否是谜团深化型而非情感炸弹型',
          '全剧逻辑链是否自洽——前集信息是否能在结局前推导出答案，无"开后门"设定',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是谜团层级升高——从表象案件→幕后黑手→更大组织阴谋
② 每段落必须有一次"关键证人/证物"反转，颠覆前一段的结论
③ 段落长度8-15集，高潮集在后1/3（大反转/真相碎片爆发集）
④ 每段末尾留一个全新谜团，且必须比前段更大
⑤ 信息管理：每段观众获得的信息总量要超过角色，或刚好相反，交替制造悬念`,
        characterArcPrinciples: `- 主角（侦探/调查者）弧线：每段推翻前段的错误推论，逐渐接近真相
- 幕后黑手弧线：每段通过线索构建其存在感，直到后1/3才露面
- 嫌疑人弧线：每段至少一个"嫌疑人"被洗白或被证实，格局清晰
- 配角（受害者/目击者）弧线：关键证人的态度改变是每段节点`,
        conflictRhythm: `- 段落前1/3：新谜团/新嫌疑人建立+主角初步追查
- 段落中1/3：关键线索出现+被误导+推论错误（信息密度高，节奏中等）
- 段落后1/3：真相碎片爆发+大反转+更大谜团抛出
- 节奏特点：推理铺垫段（信息密度高但节奏稳）：反转爆发段（快切，情绪飞跃）≈2:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【悬疑/推理专属情绪节拍——线索追查→真相反转模式】
| beatId | 时间段   | emotion       | intensity | trigger                              |
|--------|----------|---------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | unease        | 0.7       | 异常发现/新线索暗示（dutch_angle）     |
| eb_2   | 8%-22%   | curiosity     | 0.5       | 主角开始追查，观众跟随逻辑             |
| eb_3   | 22%-38%  | suspicion     | 0.65      | 新嫌疑人/误导线索出现                  |
| eb_4   | 38%-52%  | tension       | 0.8       | 关键证人/证物即将揭露                  |
| eb_5   | 52%-58%  | silence       | 0.0       | 揭露前绝对静默（信息张力最大化）       |
| eb_6   | 58%-75%  | revelation    | 0.95      | 真相碎片/证词反转（认知颠覆）          |
| eb_7   | 75%-85%  | recalibration | 0.6       | 主角/观众重新整理信息                  |
| eb_8   | 85%-95%  | new_question  | 0.55      | 更大谜团浮现                          |
| eb_9   | 95%-100% | dread         | 0.85      | 幕后威胁逼近（集末钩子）               |`,
        tensionCurveNotes: `- 推理段（前52%）信息密度高但节奏稳（每Shot 3-5秒），让观众思考
- 真相反转段（58%-75%）快切+BGM骤变，制造认知颠覆冲击
- 禁止在线索揭露前加悬疑BGM——真相前的静默比BGM更有力
- "不可靠叙事"场景用主观POV+失焦处理，标记"主角视角可能有偏差"`,
        hookPatterns: `- 真相碎片型：揭露关键线索后立即截断，下集才知含义
- 嫌疑人反转型：以为是凶手的人被证实无辜，但同时出现更可疑的人
- 幕后暗示型：镜头扫过幕后黑手但观众不知道（只有二刷才发现）
- 威胁升级型：调查者本人成为幕后势力的目标`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%谜团建立→铺垫25%线索积累（信息密度高）→上升27%关键揭露+主角危机→高潮25%大反转+真相全貌→落幕15%
单集：前8%上集悬念回应/新线索→中60%追查与误导交织→后32%揭露+集末新钩子
推理铺垫段可接受节奏偏中等（观众在思考），禁止平铺直叙无信息`,
        paceIndicators: `- 悬疑剧允许Shot时长3-6秒（推理需要观众观察细节）
- 每集少于2个新线索或信息点=推进不足（悬疑剧必须每集有信息增量）
- 连续5Shot都是4-5秒且无台词=拖沓（推理段要有信息密度，不是视觉留白）
- 全集高强度（intensity≥0.7）超过50%=节奏过满，失去悬疑的克制感`,
      },
      agentSystemPrompts: {
        'storyboard-director': SUSPENSE_STORYBOARD_PROMPT,
        'arc-director': SUSPENSE_ARC_DIRECTOR_PROMPT,
        'episode-director': SUSPENSE_EPISODE_DIRECTOR_PROMPT,
        'audio-director': SUSPENSE_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': SUSPENSE_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': SUSPENSE_PACING_ANALYZER_PROMPT,
        'continuity-guard': SUSPENSE_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': SUSPENSE_HOOK_CRAFTER_PROMPT,
        'scriptwriter': SUSPENSE_SCRIPTWRITER_PROMPT,
        'dialogue-coach': SUSPENSE_DIALOGUE_COACH_PROMPT,
        'script-editor': SUSPENSE_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': SUSPENSE_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── urban ───────────────────────────
  urban: {
    displayName: '都市',
    description: '都市生活+情感纠葛+现实冲突',
    genreKeywords: ['都市', '职场', '生活'],
    audienceTags: ['女性向', '25-40岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['现实', '温暖'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'bilibili'],
    seedHints: {
      catharsisPresets: ['情感共鸣', '逆袭成长', '真爱胜出'],
      conflictPatterns: ['职场竞争', '家庭矛盾', '价值观冲突'],
      paywallStrategyHints: '感情升温关键时刻设卡',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是都市/职场短剧编剧手册生成专家。本次任务：为都市题材生成编剧手册。
【编剧思维框架】贴近真实生活，爽点来自"观众也希望能这样做"的共鸣；冲突必须生活化有共鸣；情感冲突是核心。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通都市情感与职场叙事的编剧；冲突贴近现实：职场/家庭/感情选择；节奏可适当放缓
- genreRules 必须包含（至少5条）：① 冲突生活化有共鸣 ② 对手不需要纯坏，更多是利益/价值观冲突 ③ 情感线（爱情/友情/亲情）是核心 ④ 逆袭节奏与真实感平衡 ⑤ 禁止脱离现实的天降金手指
- dialogueGuide：职场对话专业但简洁；现代白话；禁止古风/网络烂梗过度使用
- visualNarrativeGuide：第一帧=都市场景建立（办公室/街道/家居）；情感靠眼神和肢体传递；冲突要可视化
- forbiddenPatterns：太苦或太爽失去真实感；角色智商为剧情服务；脱离现实的逆袭`,

      profilerExamples: {
        genreName: '都市/职场',
        segmentPrinciples:
          '① 段落感来自"生活考验升级"（职场→家庭→情感抉择），每段冲突更贴近观众\n' +
          '② 每段开头建立新的生活场景，让观众产生"我也遇到过"的代入感\n' +
          '③ 情感场与冲突场约1:1，节奏较霸总/战神温和\n' +
          '④ 段末钩子偏"关系转折"或"职业/人生抉择"\n' +
          '⑤ 段落间过渡用场景切换+时间推进，暗示生活延续',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | daily_stress  | 0.55      | 职场/家庭日常压力建立                          |\n' +
          '| eb_2   | 8%-20%   | dilemma       | 0.5       | 主角面临选择，观众代入                         |\n' +
          '| eb_3   | 20%-35%  | effort        | 0.45      | 主角尝试应对，有小进展                         |\n' +
          '| eb_4   | 35%-50%  | setback       | 0.65      | 挫折出现，冲突升级                              |\n' +
          '| eb_5   | 50%-55%  | reflection    | 0.35      | 主角独处/与友人交流，情感沉淀                   |\n' +
          '| eb_6   | 55%-75%  | breakthrough  | 0.8       | 逆袭/成长/关系突破                             |\n' +
          '| eb_7   | 75%-85%  | warmth        | 0.6       | 情感共鸣时刻                                   |\n' +
          '| eb_8   | 85%-95%  | resolve       | 0.5       | 主角做出选择，观众认同                          |\n' +
          '| eb_9   | 95%-100% | next_chapter  | 0.65      | 新考验/新关系阶段暗示（集末钩子）               |',
        rhythmTemplate:
          '全剧：开场10%人物与处境建立→铺垫25%生活考验积累→上升25%冲突升级→高潮25%逆袭/成长→落幕15%情感余韵\n' +
          '单集：前8%上集衔接/新场景→中65%冲突与情感交织→后27%突破+集末新章节\n' +
          '允许慢区：情感铺垫允许2集放缓，需有真实感共鸣',
      } satisfies GenreProfilerExamples,
          genreArchetypePreset: {
            narrativeArc: 'life_journey',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'emotional_peak',
            conflictType: 'society',
            characterEvolution: 'relationship',
            visualTone: 'glamorous',
            adaptationNotes: `- 冲突贴近现实：职场PUA/家庭矛盾/感情选择，避免夸张权力斗争
- 台词风格：现代白话，自然口语；禁止过度戏剧化腔调；情感宣泄用行动代替大段独白
- 集末钩子偏好"情感炸弹"型：人物关系刚拉近时遭遇误解，或重大选择前截断
- 节奏可适当放缓：允许2-3集铺垫人物关系；但每5集内必须有一个情感高点
- 人生旅程型叙事（life_journey）：以人物阶段性成长推进，而非单一冲突解决
- 节奏模式：开场10%人物处境建立 → 生活铺垫20%（关系积累，节奏稍慢但情感密度渐增） → 上升30%核心矛盾爆发 → 高潮25%关系/人生抉择 → 成长收尾+钩子15%
- 记录重点：人物内在成长里程碑；关系变化节点；社会矛盾代入感`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "life_journey"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "emotional_peak"\n   conflictType: "society"\n   characterEvolution: "relationship"\n   visualTone: "glamorous"\n   adaptationNotes 基线：\n   - 冲突贴近现实：职场PUA/家庭矛盾/感情选择，避免夸张权力斗争\n   - 台词风格：现代白话，自然口语；禁止过度戏剧化腔调；情感宣泄用行动代替大段独白\n   - 集末钩子偏好"情感炸弹"型：人物关系刚拉近时遭遇误解，或重大选择前截断\n   - 节奏可适当放缓：允许2-3集铺垫人物关系；但每5集内必须有一个情感高点\n   - 人生旅程型叙事（life_journey）：以人物阶段性成长推进，而非单一冲突解决\n   - 节奏模式：开场10%人物处境建立 → 生活铺垫20%（关系积累，节奏稍慢但情感密度渐增） → 上升30%核心矛盾爆发 → 高潮25%关系/人生抉择 → 成长收尾+钩子15%\n   - 记录重点：人物内在成长里程碑；关系变化节点；社会矛盾代入感`,

      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'front', 'pov', 'close_up', 'over_shoulder'],
        signatureTechniques: ['情感共鸣close_up（自然光+轻微柔焦，面部表情是核心）', '职场压力构图（high_angle+冷白日光灯）', 'POV生活代入（主观视角体验日常困境）', '两人情感距离四阶段（陌生medium_wide→熟悉medium→亲近close_up→依赖同帧）'],
        transitionStyle: '日常生活硬切；情感高峰slow_push_in；时间流逝dissolve+环境光线变化',
        cameraRuntime: {
          climax:
            '■ 【都市高潮=情感决裂或关系突破】Shot①wide建立场景（两人在某个有意义的地点）→Shot②close_up面部情绪（不解释，让观众感受）→Shot③over_shoulder或two_shot（说出关键的话或做出关键行动）→Shot④close_up对方反应',
          confrontation:
            '■ 【都市对峙=生活化冲突三阶段】① 积压：over_shoulder+medium，两人保持距离 ② 爆发：handheld轻晃+close_up快切（情绪失控的真实感） ③ 落定：fixed_shot一人背影/另一人面部',
          romantic:
            '■ 【都市情感场景=真实距离语言】心动：medium→close_up的缓慢推进，自然光，眼神游移；表白：two_shot同帧+near_silence+slow_push_in\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['现代流行轻钢琴+吉他', '都市indie风格', '轻电子ambient', '生活感弦乐', '纯器乐流行曲'],
        sfxDensity: 'sparse',
        silenceUsage: '情感沉淀时near_silence+生活环境音（交通/咖啡机/雨声）；争吵/冲突时BGM cut_out只剩环境音；告白/关键时刻前brief_silence',
        voiceActingStyle: '自然口语化，禁止戏剧化腔调；职场对话简洁利落；情感场景语速放缓、停顿增多；争吵时语速加快但保持生活感',
        genreBrandingDirective:
          '■ 【生活场景BGM】轻钢琴+吉他fingerpicking，intensity=0.15-0.3；必须有生活环境底音（咖啡馆/办公室ambient）\n' +
          '■ 【职场冲突BGM】轻微紧张弦乐，intensity=0.3-0.45；或BGM cut_out只剩环境音（更真实）\n' +
          '■ 【情感高峰三阶音频】①铺垫：轻柔吉他/钢琴 intensity=0.2 ②酝酿：BGM降至near_silence ③爆发：弦乐+钢琴swell，intensity=0.6-0.75，tempo慢\n' +
          '■ 【集尾hook前3秒】BGM fade_to_near_silence→关键台词/情感动作清晰落地→定格→BGM完全停止',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 0.9, dialogueNaturalness: 1.5, pacing: 1.1, hookStrength: 1.2, consistency: 1.0, emotionalImpact: 1.5 },
        genreSpecificChecks: [
          '台词是否自然口语化，没有霸总式/宫廷式腔调',
          '每集是否有至少1个"观众有感同身受"的生活细节场景',
          '情感共鸣Shot是否使用自然光+close_up，而非强戏剧化打光',
          '职场冲突场景是否保持真实感（over_shoulder+高压构图），而非霸总式权力碾压',
          '每5集内是否有一个情感高点（避免节奏过于平淡）',
          '人物关系推进是否在服装/场景/肢体距离上有可见变化',
        ],
      },
      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是生活维度的递进——从职场→家庭→情感→人生抉择
② 每段落以一个主角成长或关系转变为里程碑
③ 段落长度6-12集，高潮集在后1/3（重大选择/关系突破集）
④ 每段节奏比霸总/战神慢30%，允许情感铺垫
⑤ 段末留"新的生活考验"或"关系升温后的新阻力"`,
        characterArcPrinciples: `- 主角弧线：每段完成一次具体成长（职业蜕变/情感觉悟/人生观念改变）
- 感情对象弧线：每段从"距离感"到"靠近一步"，真实缓慢
- 反派（竞争对手/职场上司）弧线：不需要纯坏，更多是价值观冲突
- 闺蜜/家人弧线：每段提供情感支撑，有自己的生活线`,
        conflictRhythm: `- 段落前1/3：新的生活困境/挑战出现
- 段落中1/3：应对+情感线升温+小的挫折
- 段落后1/3：阶段性突破+情感升温+新生活考验暗示
- 节奏特点：情感段与冲突段约1:1，无绝对的爽点式爆发`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【都市/职场专属情绪节拍——生活压力→情感共鸣模式】
| beatId | 时间段   | emotion       | intensity | trigger                              |
|--------|----------|---------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | daily_stress  | 0.55      | 职场/家庭日常压力建立（贴近真实）       |
| eb_2   | 8%-22%   | dilemma       | 0.5       | 主角面临选择，观众代入                 |
| eb_3   | 22%-38%  | effort        | 0.45      | 主角尝试应对，有小进展                 |
| eb_4   | 38%-52%  | setback       | 0.65      | 挫折出现，冲突升级                     |
| eb_5   | 52%-58%  | reflection    | 0.35      | 主角独处/与友人交流，情感沉淀          |
| eb_6   | 58%-75%  | breakthrough  | 0.8       | 逆袭/成长/关系突破                    |
| eb_7   | 75%-85%  | warmth        | 0.6       | 情感共鸣时刻，观众产生代入认同         |
| eb_8   | 85%-95%  | resolve       | 0.5       | 主角做出选择，观众认同                 |
| eb_9   | 95%-100% | next_chapter  | 0.65      | 新考验/新关系阶段暗示（集末钩子）       |`,
        tensionCurveNotes: `- 都市剧允许intensity整体偏中等（0.4-0.7为主），生活感比爽感重要
- 情感共鸣场（75%-85%）是全集情绪高点，用暖色调+轻柔BGM
- 职场冲突场保持真实感：无霸道碾压，有据可循的反击
- 每集至少有1个"观众有感同身受"的生活细节`,
        hookPatterns: `- 关系转折型：情感升温后出现关系考验，下集才知结果
- 职业危机型：重要机会/工作面临威胁
- 真心话型：主角快要说出真实想法，被打断
- 生活共鸣型：留下让观众思考"我也面对过"的问题`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场10%人物与处境建立→铺垫25%生活考验积累→上升25%冲突升级+感情进展→高潮25%逆袭/成长/感情确认→落幕15%
单集：前8%上集衔接/新场景→中65%冲突与情感交织→后27%突破+集末新章节
都市剧整体节奏比霸总/战神慢20-30%，情感铺垫允许2集放缓`,
        paceIndicators: `- 都市剧Shot时长3-6秒均合理（比动作类慢）
- 连续3集无任何情感推进或冲突升级=节奏停滞
- 全集intensity≥0.8超过25%=节奏过强，失去生活感
- 情感共鸣场少于2个Shot停留>4秒=情感不够到位（需要留给观众感受的空间）`,
      },
      agentSystemPrompts: {
        'storyboard-director': URBAN_STORYBOARD_PROMPT,
        'arc-director': URBAN_ARC_DIRECTOR_PROMPT,
        'episode-director': URBAN_EPISODE_DIRECTOR_PROMPT,
        'audio-director': URBAN_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': URBAN_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': URBAN_PACING_ANALYZER_PROMPT,
        'continuity-guard': URBAN_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': URBAN_HOOK_CRAFTER_PROMPT,
        'scriptwriter': URBAN_SCRIPTWRITER_PROMPT,
        'dialogue-coach': URBAN_DIALOGUE_COACH_PROMPT,
        'script-editor': URBAN_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': URBAN_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── ancient ───────────────────────────
  ancient: {
    displayName: '古装',
    description: '古代背景+爱恨情仇+家国天下',
    genreKeywords: ['古装', '古代', '古风'],
    audienceTags: ['女性向', '18-35岁'],
    protagonistFocusTags: ['female_lead', 'dual_lead'],
    toneTags: ['唯美', '虐恋'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'tencent_video', 'mango_tv'],
    seedHints: {
      catharsisPresets: ['虐后团圆', '身世真相', '逆袭封后'],
      conflictPatterns: ['家族仇恨', '朝堂争斗', '身份错认'],
      paywallStrategyHints: '男女主情感考验最高潮处设卡',
    },
    profile: {
      productionGuidance: {
        flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
        maleLeadFormula: '古装（男主）：儒雅或霸气二选一（由题材调性决定）。古风气质，面若冠玉或冷峻朝臣，禁止现代网红脸。须有古代贵气或英气。',
        femaleLeadFormula: '古装（女主）：精致古典美，温婉或算计感视角色定位而定，妆容服饰与时代高度匹配；初期可弱但不能无能，古装美感必须到位。',
        coreLoopBlock: '=== 核心循环（古装/爱情）===\n- 基本模式：相识→误会→心动→考验→情深（每4-6集一个情感循环）\n- 爽点设计：虐后团圆、身世真相、爱情守护\n- 核心循环的关键：古装美感+情感深度并重，观众为"美"和"情"买单',
        conflictBlock: '=== 冲突设计原则（古装）===\n- 家族仇恨/身份错认/朝堂争斗是最常见且有效的古装冲突\n- 情感与政治的纠葛：爱情在权力游戏中的挣扎\n- 核心爽点：身世真相/虐后团圆/爱情守护/逆袭封后',
        arcStructureHint: '段落1（第1-25%集）：相识+误会+身份/家族背景铺垫+第一次心动\n段落2：情感升温+势力干预+被迫分离或阻碍\n段落3：冲突最深处+生死考验+情感爆发\n段落4（最后15%）：冲突化解+身世/真相揭晓+情归结局',
        paywallStrategyHint: '男女主情感考验最高潮处设卡（被迫分离前、生死情感表白前）\n第10-20集设第一个付费卡点；之后每8-12集设一个（古装节奏较慢）',
        contractHint: '（示例："只要你追下去，他们的爱情虐得越深、守护得越动人"）',
        hookTypesHint: 'preferredTypes 参考：["情感考验","身世秘密","被迫分离","朝堂变故","守护时刻","虐心误解"]',
        toneHint: 'toneGuardrails 参考：历史背景基本合理；虐感必须有情感支撑，连续虐恋不超过3集必须给甜蜜作为补偿；允许悲壮但须有情感救赎节点；古装美感是底线（服饰/场景低于审美标准等于失败）；禁止现代白话/网络用语出现在对白中',
        narrativeModeTip: '台词 > 旁白 > 动作，古风对话要有韵味，情感流露含蓄但强烈',
        coreConflictExample: '（如：赐婚将她嫁给冷漠王爷，却不知他正是幼时救她的恩人）',
        paywallTip: '误解破解型→卡在"两人最亲近又误解最深"的节点；虐恋→卡在"分离"一刻',
        antagonistTip: '反派：嫉妒的侧妃/庶妹、家族政敌、强势婆母，手段合乎古代礼教逻辑',
        episodeTitleExample: '"赐婚风云""误解冰解"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是古装/武侠/历史短剧编剧手册生成专家。本次任务：为古装题材生成编剧手册。
【编剧思维框架】古装的节奏比现代都市慢1.5倍——美感在"从容不迫"中；刀剑对决有起势-行招-收势三阶段；情感靠环境意象（梅花/灯笼/雨幕/烛光）传达，而非直白表达。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通古典武打仪式感与古风叙事的古装编剧；古典美学是第一生产力；服饰质感与场景氛围是角色形象的一部分
- genreRules 必须包含（至少5条）：① 武打仪式感铁律（有招式、有节奏、有起收势，禁止现代打斗风格）② 古典称谓规范（陛下/相国/在下/公子等，混用现代称谓=严重错误）③ 语言寄存器（半文半白为主，核心句有古风骨架）④ 情感靠环境意象传达而非直白告白 ⑤ 古装场景服饰/道具/建筑的细节描写规范
- dialogueGuide：半文半白；强者台词极简含而不露；招式名称有古典意境；禁止现代白话（ok/没问题/靠等）；禁止直白现代情感告白
- visualNarrativeGuide：第一帧=视觉震撼（壮丽建筑/甲兵列阵/山河wide，暖金色调）或权力符号ECU（圣旨/将帅印）；古装wide_shot必须充分展示服饰质感；情感高峰靠环境意象
- forbiddenPatterns：现代称谓/白话出现在古装场景；武打无仪式感（现代打斗风格）；古装中出现现代道具/场景；情感直白表达（应靠行为/环境）`,

      profilerExamples: {
        genreName: '古装/武侠',
        segmentPrinciples:
          '① 段落感来自"权力/江湖格局变化"（门派争权→朝堂介入→武林盟主之争），每段舞台更大\n' +
          '② 每段开头用壮丽建筑wide或权力符号ECU（圣旨/将帅印）建立"势"\n' +
          '③ 暗战台词场（古典机锋）与刀剑明斗场约1:1，武打场景必须有起势-行招-收势仪式感\n' +
          '④ 段末钩子偏"更强高手出现"或"门派/朝堂隐秘被揭"\n' +
          '⑤ 段落间过渡用自然意象（落叶/白雪/烟雨）+时间字幕，暗示季节/权力格局流转',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | ritual_beauty | 0.6       | 古典场景建立（壮丽建筑/服饰质感/暖金色调）           |\n' +
          '| eb_2   | 8%-20%   | simmering     | 0.45      | 含而不露的情感/权力暗流（半文半白台词）              |\n' +
          '| eb_3   | 20%-35%  | grace         | 0.3       | 表面礼仪周全，各怀城府                               |\n' +
          '| eb_4   | 35%-50%  | sword_intent  | 0.65      | 剑拔弩张（起势——对方接招准备）                       |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 对视一秒——谁先出手（无BGM）                         |\n' +
          '| eb_6   | 55%-75%  | duel_peak     | 0.92      | 刀剑对决高潮（起势→行招→收势，仪式感全出）           |\n' +
          '| eb_7   | 75%-85%  | imagery_emo   | 0.65      | 情感靠环境意象传递（梅花/灯笼/雨幕/烛光）            |\n' +
          '| eb_8   | 85%-95%  | understated   | 0.45      | 克制收尾（强者不多言，背影离去）                     |\n' +
          '| eb_9   | 95%-100% | bigger_storm  | 0.8       | 更大动荡/更强对手的预兆（集末钩子）                  |',
        rhythmTemplate:
          '全剧：开场10%古典场景建立（壮丽+服饰质感）→铺垫25%情感与权力格局铺垫（允许偏慢）→上升25%刀剑冲突升级→高潮20%武打高潮（仪式感全出）→落幕20%情感意象收尾+钩子\n' +
          '单集：前8%古典环境建立（暖金色调wide）→中65%台词机锋+武打蓄势→后27%刀剑对决高潮+意象情感收尾+集末钩子\n' +
          '允许慢区：情感线允许长铺垫，靠环境意象维持情感密度；武打场景前必须有"起势"铺垫，禁止突然出现',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'plot_cliffhanger',
            conflictType: 'interpersonal',
            characterEvolution: 'status',
            visualTone: 'period',
            adaptationNotes: `- 古典美学是第一生产力：服饰质感与场景氛围是角色形象的一部分，禁止现代感道具
- 台词风格：半文半白（核心句子有古风骨架，现代人听得懂）；称谓规范（公子/姑娘/将军/大人）；禁止现代网络用语
- 武打设计：有起势-行招-收势仪式感；情感通过环境意象表达，而非直白语言
- 集末钩子：战局翻转前截断，或身份暴露前截断（plot_cliffhanger）
- 地位随武力/谋略/身份认可而变化（status evolution）：服饰等级与他人礼遇外显
- 节奏模式：开场10%世界观建立+核心冲突种下 → 积累25%武艺/谋略成长 → 上升30%江湖/朝堂交锋加速 → 高潮25%终极对决 → 新天下格局+钩子10%
- 记录重点：武力/地位成长里程碑；江湖/朝堂势力关系图；道具/服饰连续性`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "plot_cliffhanger"\n   conflictType: "interpersonal"\n   characterEvolution: "status"\n   visualTone: "period"\n   adaptationNotes 基线：\n   - 古典美学是第一生产力：服饰质感与场景氛围是角色形象的一部分，禁止现代感道具\n   - 台词风格：半文半白（核心句子有古风骨架，现代人听得懂）；称谓规范（公子/姑娘/将军/大人）；禁止现代网络用语\n   - 武打设计：有起势-行招-收势仪式感；情感通过环境意象表达，而非直白语言\n   - 集末钩子：战局翻转前截断，或身份暴露前截断（plot_cliffhanger）\n   - 地位随武力/谋略/身份认可而变化（status evolution）：服饰等级与他人礼遇外显\n   - 节奏模式：开场10%世界观建立+核心冲突种下 → 积累25%武艺/谋略成长 → 上升30%江湖/朝堂交锋加速 → 高潮25%终极对决 → 新天下格局+钩子10%\n   - 记录重点：武力/地位成长里程碑；江湖/朝堂势力关系图；道具/服饰连续性`,

      cameraStyleGuide: {
        preferredAngles: ['three_quarter', 'low_angle', 'over_shoulder', 'wide'],
        signatureTechniques: ['朝堂权力构图（皇帝居中+high_angle俯视群臣）', '刀剑对决三镜（眼神交换→出招ECU→距离确认wide）', '古装情感慢推', '汉服竖屏全身展示'],
        transitionStyle: '古装唯美dissolve；武打切换硬cut；朝堂转场pan_left/pan_right',
        cameraRuntime: {
          climax: '■ 【古装高潮=刀剑决胜/权力落幕四镜】Shot①wide双方最后对峙（static 1秒，无台词）→Shot②ECU眼神交换+出招 → Shot③决定性一击ECU+slow_motion → Shot④胜负定格（胜者medium+low_angle淡然）',
          confrontation: '■ 【古装对峙=礼中藏刀三阶段】① 表面礼节：medium+three_quarter ② 底牌出现：medium_close_up+slow_push_in+dutch_angle（5-10°） ③ 摊牌落定：wide确认新的关系格局',
          romantic: '■ 【古装情感场景】心动：slow_push_in+浅景深，背景必须有古典元素\n■ 古装离别：orbit绕拍+slow_pull_back，以宫墙/山川/城门作背景渐渐显露\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['古筝主题旋律', '琵琶弹奏（激烈场景）', '古琴清幽（情感场景）', '编钟+弦乐史诗感（朝堂/战场）', '箫声悠扬（离别/思念）'],
        sfxDensity: 'moderate',
        silenceUsage: '武打对峙前drop_to_silence 0.5-1s；情感离别场轻柔古筝单音替代BGM；生死抉择前long_silence强调厚重感',
        voiceActingStyle: '半文半白腔调，有古典韵味；男主台词克制低沉，情感靠停顿和声调传递；武打场景台词极简；情感场景语速放缓带喘息感',
        genreBrandingDirective:
          '■ 【古装场景BGM分区】宫廷日常：编钟+弦乐，intensity=0.25-0.4；江湖情感：古筝/箫，intensity=0.2-0.35；战场：打击乐+铜管，intensity=0.6-0.8\n' +
          '■ 【武打对决三阶音频】①剑拔弩张：BGM降至near_silence，弓弦拉紧音效 ②交锋：兵器相击SFX精准卡帧+快速弦乐律动 ③胜负落定：BGM渐停，环境音收场\n' +
          '■ 【情感高峰（古典意境）】古筝/箫双层渐强，intensity=0.5-0.65；禁止现代流行编曲出现在古装情感场\n' +
          '■ 【离别/悲壮场景】箫声主旋律+弦乐低鸣，intensity=0.3-0.5；结尾fade_to_silence+单声环境音（风声/雨声）\n' +
          '■ 【集尾hook】BGM在危机前夕渐强至0.6→定格画面→BGM骤停',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.4, dialogueNaturalness: 1.3, pacing: 1.0, hookStrength: 1.2, consistency: 1.4, emotionalImpact: 1.2 },
        genreSpecificChecks: [
          '服饰/场景是否达到古典美感标准，禁止现代道具或网红妆容出现',
          '台词是否有半文半白腔调，称谓规范（公子/姑娘/将军/大人），禁止现代白话',
          '武打场景是否有起势-行招-收势仪式感，禁止现代打斗风格',
          '情感场景是否靠环境意象（梅花/灯笼/雨幕/烛光）传达，而非直白告白',
          '古装wide_shot是否充分展示全身华服（竖屏高度优势），服饰质感是否清晰',
          '每集是否有感情线或命运线的可感知推进',
        ],
      },

      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是古代身份/命运的博弈——每段围绕一个具体的家国或情感危机
② 每段落以一个"生死关头+情义抉择"为高潮
③ 段落长度8-15集，高潮集在后1/3（生死分离/命运转折集）
④ 古代背景允许叙事节奏比现代剧慢15%，但每集必须推进感情线或命运线
⑤ 段末留"两人分离"或"更大危机来袭"`,
        characterArcPrinciples: `- 女主弧线：每段从"弱势/无助"到"展现某种坚韧或能力"，保持成长感
- 男主弧线：每段从"职责优先"到"感情动摇"，情义之间的撕扯
- 反派（嫉妒的人/宫廷势力）弧线：手段从直接到阴险，逐段升级
- 家族/朝廷背景弧线：每段推进一个宏观的历史/权力背景变化`,
        conflictRhythm: `- 段落前1/3：宏观背景变化+具体危机落到主角身上
- 段落中1/3：感情升温+危机升级+反派手段加剧
- 段落后1/3：生死关头+情义选择+命运转折
- 节奏特点：古装剧允许情感铺垫较多，但每段末尾必须有戏剧性高点`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【古装专属情绪节拍——情义纠葛→生死抉择模式】
| beatId | 时间段   | emotion          | intensity | trigger                              |
|--------|----------|------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | ancient_tension  | 0.65      | 宫廷/江湖局势暗流建立                  |
| eb_2   | 8%-22%   | emotional_pull   | 0.5       | 情感线推进，两人靠近                   |
| eb_3   | 22%-38%  | obstacle         | 0.65      | 身份/礼教/阴谋造成阻碍                 |
| eb_4   | 38%-52%  | danger           | 0.8       | 生命/名誉面临威胁                      |
| eb_5   | 52%-58%  | silence          | 0.2       | 生死关头的凝固感                       |
| eb_6   | 58%-75%  | sacrifice_or_fight| 0.9      | 为对方挺身而出/以命相搏               |
| eb_7   | 75%-85%  | bittersweet      | 0.65      | 得救/胜利但代价沉重                    |
| eb_8   | 85%-95%  | resolve          | 0.5       | 两人关系推进一步，但新危机暗示         |
| eb_9   | 95%-100% | impending_storm  | 0.75      | 更大风波来临预告（集末钩子）            |`,
        tensionCurveNotes: `- 古装剧允许情感铺垫段Shot时长5-8秒（古典氛围需要静态美感）
- 武打/危机场景切换到≤2秒/Shot，与平日场景形成强烈节奏对比
- 古风服饰/场景的美感镜头（空镜）控制在每集2-3个，不要过多
- 古代礼仪场景中眼神戏是台词的替代——必须用ECU捕捉`,
        hookPatterns: `- 生死危机型：主角/爱人命悬一线，下集才知结果
- 身份揭露型：古代身份/秘密快要被发现
- 分离型：两人被迫分离（战争/家族/皇命），下集不知何时再见
- 变故型：朝廷/家族突发重大变故，打乱所有计划`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%古代背景+主角处境建立→铺垫22%情感线+势力建立→上升25%情感深化+危机加剧→高潮30%生死关头+大决断→落幕15%
单集：前8%上集衔接/局势更新→中60%情感+冲突交织→后32%高点+集末危机预告
古装剧整体节奏比现代剧慢15%，但每段必须有情感或命运推进`,
        paceIndicators: `- 古装剧Shot时长4-8秒均合理（古典氛围需要留白）
- 空镜/场景美感镜头超过全集15%=节奏沉重（观众等待实质内容）
- 连续2集无感情线推进或命运变化=节奏停滞
- 武打场景Shot平均>3秒=节奏过慢（武打段需1.5-2.5秒/Shot）`,
      },
      agentSystemPrompts: {
        'storyboard-director': ANCIENT_STORYBOARD_PROMPT,
        'arc-director': ANCIENT_ARC_DIRECTOR_PROMPT,
        'episode-director': ANCIENT_EPISODE_DIRECTOR_PROMPT,
        'audio-director': ANCIENT_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': ANCIENT_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': ANCIENT_PACING_ANALYZER_PROMPT,
        'continuity-guard': ANCIENT_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': ANCIENT_HOOK_CRAFTER_PROMPT,
        'scriptwriter': ANCIENT_SCRIPTWRITER_PROMPT,
        'dialogue-coach': ANCIENT_DIALOGUE_COACH_PROMPT,
        'script-editor': ANCIENT_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': ANCIENT_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── history ───────────────────────────
  history: {
    displayName: '历史剧',
    description: '历史背景+权谋/战争/命运+人物在时代洪流中的抗争',
    genreKeywords: ['历史', '朝代', '历史人物', '历史事件', '历史故事', '三国', '战争'],
    audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead', 'ensemble'],
    toneTags: ['厚重', '紧张', '壮烈'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'tencent_video'],
    seedHints: {
      catharsisPresets: ['命运震撼', '权谋反转', '英雄壮举', '忠义抉择'],
      conflictPatterns: ['权力斗争', '时代变迁', '命运抗争', '忠奸对立'],
      paywallStrategyHints: '在关键历史转折点前设卡——如战役胜负将揭晓、忠臣即将被陷害、命运抉择的前一刻',
      dialogueStyleHints: '对白要有时代感和文化底蕴，可适度使用文言句式',
    },
    profile: {
      productionGuidance: {
        flags: { isHistorical: true, isBiopic: false, isMystery: false, isFantasy: false },
        maleLeadFormula: '历史剧（男主）：以时代感为主，传达该时代的气质（如三国武将的英雄气，唐代官员的儒雅风，战争年代的铁血感）。禁止现代偶像脸。',
        femaleLeadFormula: '历史剧（女主）：以史实或时代背景为准，气质大于颜值，禁止现代审美套入历史人物；传达时代女性的独特气质和力量。',
        coreLoopBlock: '=== 核心循环（历史剧）===\n- 基本模式：时代机遇→命运考验→人物抉择→历史洪流推进（每5-8集一个历史阶段）\n- 爽点设计：命运震撼、权谋反转、英雄壮举、忠义抉择\n- 核心循环的关键：历史感与戏剧性并重，重大历史事件是节奏锚点',
        conflictBlock: '=== 冲突设计原则（历史剧）===\n- 核心冲突：人物命运与历史大势的交汇\n- 忠奸对立、权力斗争是历史剧常见且有效的冲突\n- 历史约束：不能与已知历史事实严重冲突（细节可艺术化）\n- 核心爽点：权谋反转/战役胜负/忠义牺牲/历史大势揭示',
        arcStructureHint: '段落1（第1-25%集）：时代背景建立+主角登场+第一个历史事件\n段落2：势力形成+权谋交锋+重大历史转折临近\n段落3：核心历史事件+人物命运考验+忠奸对决\n段落4（最后15%）：历史结局+人物命运完成+时代收官',
        paywallStrategyHint: '在关键历史转折点前设卡——战役胜负将揭晓、忠臣即将被陷害、命运抉择前一刻\n第10-20集设第一个付费卡点；之后每8-12集设一个',
        contractHint: '（示例："只要你追下去，历史的每个关键时刻都会以最震撼的方式呈现"）',
        hookTypesHint: 'preferredTypes 参考：["历史事件临近","权谋反转","忠臣危机","战役转折","朝代更迭","真相揭露"]',
        toneHint: 'toneGuardrails 参考：\n- 允许悲壮苍凉，但主角精神不能彻底崩溃超过2集\n- 禁止篡改核心历史事实\n- 旁白叙述必须服务于剧情情感，不是纪录片解说',
        freeEpisodeHint: '"免费集展示历史风云与人物登场，付费集揭示命运转折与历史大势"',
        specialRules: '如涉及真实历史人物/事件，角色名字使用真实历史名称，redLines必须包含"禁止编造不存在的历史事实"',
        narrativeModeTip: '旁白与台词并重（旁白不超过15%），旁白用于交代历史大背景，台词展现戏剧冲突',
        coreConflictExample: '（如：一代名相在乱世中以智谋辅佐明君，却被小人构陷，最终以身殉国）',
        paywallTip: '历史剧付费卡点设在：重大历史事件前夕、主角面临历史性抉择前一刻',
        antagonistTip: '反派：历史上真实存在的对立人物或势力，动机必须有历史依据，不可随意黑化',
        historicalConstraint: '=== 历史题材特殊规则 ===\n- 如果题材涉及真实历史人物/事件，角色名字使用真实历史名称，redLines 必须包含"禁止编造不存在的历史事实"\n- coreConflict 可以是"人物与命运/时代的抗争"\n- antagonistConcept 可以是抽象的历史力量（权贵集团、时代困境、社会偏见）\n- catharsisType 可选：打脸逆袭/真相揭露/身份反转/命运震撼/历史感悟/忠义彰显/精神不朽',
        episodeTitleExample: '"乱世抉择""历史转折"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是历史剧编剧手册生成专家。本次任务：为历史题材生成编剧手册。
【编剧思维框架】人物命运与历史大势交汇；重大历史事件是节奏锚点；必须符合史实约束；旁白可占15%交代时代背景。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通历史叙事与时代洪流的编剧；核心冲突可以是"人物与命运/时代的抗争"
- genreRules 必须包含（至少5条）：① 禁止编造不存在的历史事实 ② 忠奸对立/权力斗争规范 ③ 旁白与表演的节奏关系 ④ 史实人物的动机必须有历史依据 ⑤ 悲壮苍凉需有意志力支撑
- dialogueGuide：半文半白；称谓规范（陛下/相国等）；时代感与文化底蕴
- visualNarrativeGuide：第一帧=壮丽历史场景（战争/朝堂/山河）；权力等级通过构图体现；时代服饰质感
- forbiddenPatterns：篡改核心历史事实；现代审美套入历史人物；纪录片式枯燥旁白`,

      profilerExamples: {
        genreName: '历史剧',
        segmentPrinciples:
          '① 段落感来自"历史阶段推进"（朝代/战役/命运节点），每段对应重大历史事件\n' +
          '② 每段开头建立时代背景与权力格局\n' +
          '③ 权谋/战争场与人物塑造场约1:1，史实约束贯穿\n' +
          '④ 段末钩子偏"历史转折前夕"或"命运抉择"\n' +
          '⑤ 段落间过渡用旁白+时间字幕，锚定历史跨度',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | era_establish | 0.6       | 时代背景/权力格局建立（wide史诗感）              |\n' +
          '| eb_2   | 8%-20%   | fate_tension  | 0.5       | 人物与历史大势交汇                              |\n' +
          '| eb_3   | 20%-35%  | choice        | 0.55      | 忠义/权力/命运的抉择                            |\n' +
          '| eb_4   | 35%-50%  | conflict      | 0.75      | 权谋交锋/战场逼近                               |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 重大决定前静默（无BGM）                         |\n' +
          '| eb_6   | 55%-75%  | climax        | 0.9       | 历史时刻/战役胜负/忠奸对决                       |\n' +
          '| eb_7   | 75%-85%  | aftermath     | 0.65      | 命运落定，时代更迭                               |\n' +
          '| eb_8   | 85%-95%  | legacy        | 0.5       | 人物精神/历史余韵                               |\n' +
          '| eb_9   | 95%-100% | next_era      | 0.8       | 下一历史阶段预兆（集末钩子）                     |',
        rhythmTemplate:
          '全剧：开场10%时代建立→铺垫25%人物与格局→上升25%冲突升级→高潮25%历史时刻→落幕15%传承与钩子\n' +
          '单集：前8%历史场景建立→中65%权谋/人物推进→后27%高潮+集末历史钩子\n' +
          '允许慢区：史实交代可放缓，旁白占15%以内',
      } satisfies GenreProfilerExamples,
          genreArchetypePreset: {
            narrativeArc: 'rise_and_fall',
            narrationRatio: 0.15,
            factConstraint: 'period_accurate',
            hookMechanism: 'revelation',
            conflictType: 'fate_vs_will',
            characterEvolution: 'age_progression',
            visualTone: 'epic',
            adaptationNotes: `- 旁白叙述占比约15%，用于跨年代叙事锚定、历史背景说明；声音庄重厚重
- 重大事件/年代/人物关系必须符合史实，细节可艺术化处理，禁止编造不存在的历史事实
- 叙事弧线兴衰型（rise_and_fall）：人物命运与朝代更迭绑定，阶段分明
- 集末钩子偏好命运揭示/历史节点即将来临型（revelation）
- 角色须有跨时间段外观变化：服饰/气质随年代和地位演变（age_progression）
- 台词风格：历史正剧腔调，半文言；称谓规范（陛下/相国/将军/先生）；禁止现代白话腔
- 节奏模式：开场10%历史背景建立+人物登场 → 铺垫25%朝堂/战场关系积累（偏慢但史诗感） → 上升25%历史转折点加速 → 高潮25%命运时刻 → 史诗收尾+历史评价15%
- 记录重点：史实合规节点；朝代背景标注；人物命运与历史事件绑定度`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "rise_and_fall"\n   narrationRatio: 0.15\n   factConstraint: "period_accurate"\n   hookMechanism: "revelation"\n   conflictType: "fate_vs_will"\n   characterEvolution: "age_progression"\n   visualTone: "epic"\n   adaptationNotes 基线：\n   - 旁白叙述占比约15%，用于跨年代叙事锚定、历史背景说明；声音庄重厚重\n   - 重大事件/年代/人物关系必须符合史实，细节可艺术化处理，禁止编造不存在的历史事实\n   - 叙事弧线兴衰型（rise_and_fall）：人物命运与朝代更迭绑定，阶段分明\n   - 集末钩子偏好命运揭示/历史节点即将来临型（revelation）\n   - 角色须有跨时间段外观变化：服饰/气质随年代和地位演变（age_progression）\n   - 台词风格：历史正剧腔调，半文言；称谓规范（陛下/相国/将军/先生）；禁止现代白话腔\n   - 节奏模式：开场10%历史背景建立+人物登场 → 铺垫25%朝堂/战场关系积累（偏慢但史诗感） → 上升25%历史转折点加速 → 高潮25%命运时刻 → 史诗收尾+历史评价15%\n   - 记录重点：史实合规节点；朝代背景标注；人物命运与历史事件绑定度`,

      cameraStyleGuide: {
        preferredAngles: ['wide', 'bird_eye', 'high_angle', 'three_quarter', 'low_angle'],
        signatureTechniques: ['史诗battle蒙太奇（bird_eye全局→ground_level士兵视角快切）', '朝堂权力构图（皇帝居中俯视群臣）', '历史时刻仰拍+crane_up（赋予事件历史分量）', '旁白配合wide_shot+slow_pan（时间流逝感）'],
        transitionStyle: '旁白段慢dissolve+环境wide；战役硬切快速蒙太奇；时间跨度大时fade_to_black+时间字幕',
        cameraRuntime: {
          climax:
            '■ 【历史剧高潮=历史时刻四镜公式】Shot①wide全局态势（战役/朝政格局）→Shot②medium主角在历史关键节点的选择/行动→Shot③crane_up仰拍（将人物与历史框架同时呈现）→Shot④wide aftermath（历史格局改变）',
          confrontation:
            '■ 【历史剧对峙=朝堂博弈三阶段】① 权力格局wide建立（谁站哪，谁先开口）② 台词机锋：over_shoulder交替+ECU面部微表情 ③ 落定：high_angle俯拍败方，主角medium+front定格',
          romantic:
            '■ 【历史剧情感场景】以历史大背景衬托情感：wide国破山河背景中的两人close_up；情感靠行动和眼神，不靠直白台词\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['史诗铜管+弦乐（战役/历史时刻）', '古典弦乐+编钟（朝堂权谋）', '宏大合唱（命运时刻）', '古筝/琵琶+管弦融合（文戏情感）', '战鼓节奏（军事部署）'],
        sfxDensity: 'rich',
        silenceUsage: '历史重大决定前long_silence（1-2s）强调分量；战役结束后silence+悲壮余音；旁白叙述段BGM降至intensity=0.2不抢旁白',
        voiceActingStyle: '旁白：庄重厚重，男声低沉有力；角色台词有历史腔调（半文言）；皇帝/高位者语速慢而有权威感；战场指令简洁有力',
        genreBrandingDirective:
          '■ 【史诗格局BGM】铜管+弦乐+合唱，intensity=0.6-0.85；wide史诗场景时BGM必须达到这个强度\n' +
          '■ 【朝堂权谋BGM】古典弦乐+编钟，intensity=0.25-0.5；对话场BGM降至0.1-0.2（不盖台词）\n' +
          '■ 【战役蒙太奇音频】战鼓节奏为主+弦乐紧张律动，intensity=0.75-0.9；SFX：兵器碰撞/战马嘶鸣/号角声精准卡帧\n' +
          '■ 【历史时刻（命运落定）音频三阶】① 蓄势：BGM渐强至0.75 ② 关键动作：drop_to_near_silence 0.5s ③ 历史落定：宏大合唱+铜管swell，intensity=0.9\n' +
          '■ 【旁白段音频】BGM必须降至intensity=0.15-0.25，以旁白声音为主体；禁止旁白时BGM强过人声',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.4, dialogueNaturalness: 1.2, pacing: 1.1, hookStrength: 1.3, consistency: 1.5, emotionalImpact: 1.0 },
        genreSpecificChecks: [
          '历史事件/人物关系是否符合史实，有无明显历史错误',
          '旁白是否≤15%，且用于时代背景说明而非推进剧情（禁止纪录片式说明）',
          '重大历史时刻是否使用wide/crane_up的史诗构图，有无历史分量感',
          '战役场景是否有bird_eye→ground_level的层次变化，BGM intensity是否达到0.75+',
          '台词是否有历史腔调（半文言），称谓规范（陛下/相国/将军），禁止现代白话',
          '每段是否有历史格局的可见变化（权力结构/人物命运），而非原地踏步',
        ],
      },

      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是历史风云中的权谋演变——每段围绕一个具体的政治危机或军事冲突
② 历史事件是框架，人物情感是内核，两者必须同步推进
③ 段落长度10-18集，高潮集在后1/3（关键历史节点/权力转移集）
④ 每段结尾必须改变历史格局，推进整体走向
⑤ 允许旁白作为段落间的历史时间线锚定（不超过全集30%）`,
        characterArcPrinciples: `- 主角弧线：在历史洪流中的个人选择——每段面临"顺应历史"还是"改变命运"的抉择
- 历史人物弧线：基于史实构建动机，允许细节艺术化，禁止重大史实颠覆
- 对立势力弧线：每段代表一个历史阵营的核心矛盾
- 配角（谋士/将领）弧线：关键历史事件中的决策者，每段有各自的立场转变`,
        conflictRhythm: `- 段落前1/3：历史背景变化+具体政治/军事危机引入
- 段落中1/3：多方势力博弈+主角的艰难抉择
- 段落后1/3：历史关键节点爆发+胜负分晓+新格局建立
- 节奏特点：权谋博弈段（信息密集）：军事/对抗段（动作密集）≈1:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【历史剧专属情绪节拍——权谋博弈→历史节点爆发模式】
| beatId | 时间段   | emotion           | intensity | trigger                              |
|--------|----------|-------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | historical_weight | 0.65      | 历史格局与危机建立（旁白锚定时间线）   |
| eb_2   | 8%-22%   | political_tension | 0.6       | 各方势力博弈，主角处理两难局面         |
| eb_3   | 22%-40%  | strategic_chess   | 0.65      | 谋略推进，胜负未明                     |
| eb_4   | 40%-52%  | decisive_moment   | 0.8       | 历史关键节点前的最终准备               |
| eb_5   | 52%-58%  | tension_peak      | 0.85      | 胜负线上的绷紧时刻                     |
| eb_6   | 58%-75%  | historical_turn   | 0.95      | 关键历史节点爆发（战役/政变/转折）     |
| eb_7   | 75%-85%  | aftermath         | 0.7       | 历史格局改变，各方反应                 |
| eb_8   | 85%-95%  | reflection        | 0.5       | 主角对历史的沉思/感慨（代入感）        |
| eb_9   | 95%-100% | next_crisis       | 0.75      | 新历史危机预告（集末钩子）             |`,
        tensionCurveNotes: `- 旁白段（历史背景说明）控制在每次≤20秒，过长用字幕代替
- 军事/战争场景需要quick montage：2-3秒/Shot，BGM epic铜管
- 权谋对话场景允许长停留（6-10秒/Shot），强调台词的重量
- 历史关键时刻（转折点）必须用仰拍+史诗BGM突出历史分量`,
        hookPatterns: `- 历史关键节点悬挂型：战役/政变前夕截断，下集才知结果
- 谋士反水型：关键谋士/将领临时倒戈
- 史实揭秘型：历史公案中的另一种可能性即将揭露
- 时代更迭型：某个历史时代结束，新时代格局开始`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%历史格局建立+主角登场→铺垫22%势力建立+主角成长→上升25%关键冲突→高潮30%历史转折点→落幕15%
单集：前8%历史时间线锚定+上集衔接→中60%权谋博弈+军事/对抗→后32%历史节点爆发+集末预告
历史剧允许整体节奏偏慢，但战争/政变场景必须快节奏`,
        paceIndicators: `- 旁白超过全集25%=叙事喧宾夺主（减少旁白，用画面和台词代替）
- 权谋对话场景Shot时长5-10秒均合理（历史剧台词有分量）
- 连续3集无历史格局变化=叙事停滞
- 战役场景平均Shot>4秒=缺乏史诗感（战争场景需快切蒙太奇）`,
      },
      agentSystemPrompts: {
        'storyboard-director': HISTORY_STORYBOARD_PROMPT,
        'arc-director': HISTORY_ARC_DIRECTOR_PROMPT,
        'episode-director': HISTORY_EPISODE_DIRECTOR_PROMPT,
        'audio-director': HISTORY_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': HISTORY_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': HISTORY_PACING_ANALYZER_PROMPT,
        'continuity-guard': HISTORY_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': HISTORY_HOOK_CRAFTER_PROMPT,
        'scriptwriter': HISTORY_SCRIPTWRITER_PROMPT,
        'dialogue-coach': HISTORY_DIALOGUE_COACH_PROMPT,
        'script-editor': HISTORY_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': HISTORY_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── biography ───────────────────────────
  biography: {
    displayName: '传记剧',
    description: '真实人物+传奇人生+以角色视角演绎命运转折',
    genreKeywords: ['传记', '人物', '生平', '名人', '伟人'],
    audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead'],
    toneTags: ['感人', '励志', '厚重'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'tencent_video'],
    seedHints: {
      catharsisPresets: ['命运逆转', '抉择震撼', '成就巅峰', '身份揭露'],
      conflictPatterns: ['逆境抗争', '时代洪流', '理想与现实', '人性抉择'],
      paywallStrategyHints: '在人物命运重大转折前设卡——如成名前最后的考验、人生低谷的关键抉择、与命运对手的正面对决',
      dialogueStyleHints: '台词需展现人物性格弧线，关键场景用对白而非旁白推进',
    },
    profile: {
      productionGuidance: {
        flags: { isHistorical: true, isBiopic: true, isMystery: false, isFantasy: false },
        maleLeadFormula: '传记剧：以人物真实历史形象为参照，时代感与风霜感优先，禁止偶像化处理。气质大于颜值，面部体现岁月积淀与人生厚度。',
        femaleLeadFormula: '传记剧：以史实或时代背景为准，气质大于颜值，禁止现代审美套入历史人物；体现该人物的精神气质和时代特征。',
        coreLoopBlock: '=== 核心循环（传记剧专属）===\n传记剧的核心循环以"人生阶段"为单位，而非单纯的冲突反转：\n- 基本模式：才华初显→遭遇打压→凭本事反击→获得认可但付出代价→下一阶段更大的挑战（每5-8集一个人生段落）\n- 爽点设计：才华碾压（诗词/艺术/智慧作为武器）、命运震撼（历史洪流中的抉择）、认知颠覆\n- 禁止强行套用"打脸逆袭"模式——真实人物的尊严来自才华与性格，不来自"反杀"套路\n- 旁白占比可以是15-25%（与角色演绎交替），用于交代历史背景或时间跨度\n- 核心循环的关键：每段落结尾，主角获得某种力量但也失去某种东西（而非纯粹的胜利）',
        conflictBlock: '=== 冲突设计原则（传记剧）===\n- 核心冲突可以是"人物与命运/时代的抗争"，不需要强行制造人物对立\n- antagonistConcept 可以是抽象的历史力量（权贵集团、时代困境、社会偏见）\n- 冲突可视化方式：以才华/意志/诗词/智慧对抗权力压迫，而非单纯的"打脸"\n- catharsisType 可选范围更广：才华碾压/命运震撼/历史感悟/认知颠覆/精神不朽',
        arcStructureHint: '按"人生阶段"而非"冲突升级"划分段落\n段落1：出道/入世——确立人物形象，展现才华与性格\n段落2：巅峰期——人物达到某种高峰，但危机埋下\n段落3：转折/跌落——历史大势或命运打击，人物经历最大考验\n段落4：绝境与抗争——以意志/才华/信念在乱世中坚守\n段落5：传承/不朽——人物完成精神意义上的超越，留下千古印记\n付费卡点应设在：命运转折的前一刻、重大历史事件前夕、做出改变一生决定之前',
        paywallStrategyHint: '第10-20集设置第一个付费卡点（传记剧前期需要更多时间建立人物情感认同）\n之后每8-12集设一个付费卡点，节奏：情感积累→命运冲击→短暂喘息→再次爆发',
        contractHint: '（传记剧示例："只要你追下去，就能看到他如何在命运的重压下，用才华和傲骨写就千古传奇"）',
        hookTypesHint: 'preferredTypes 参考（传记剧）：["才华碾压时刻","命运转折","历史大势揭示","人物抉择炸弹","精神对决"]\n- 避免：过度依赖"身份揭露"类悬念',
        toneHint: 'toneGuardrails 参考：\n- 允许悲壮苍凉，但不允许主角精神彻底崩溃超过2集\n- 禁止篡改核心历史事实\n- 旁白叙述必须服务于剧情情感，不是纪录片解说',
        freeEpisodeHint: '"免费集展示才华魅力与主角的起点，付费集揭示命运转折与历史大势"',
        specialRules: '如题材涉及真实历史人物/事件，角色名字使用真实历史名称，redLines必须包含"禁止编造不存在的历史事实"',
        narrativeModeTip: '旁白与台词并重（旁白15-25%），旁白用于交代历史背景和时间跨度，台词展现戏剧冲突',
        coreConflictExample: '（如：千古第一狂客被权贵打压，以诗剑相抗，却屡遭流放）',
        paywallTip: '传记剧付费卡点设在：命运转折的前一刻、重大历史事件前夕、主角做出改变一生的决定之前',
        antagonistTip: '反派：可以是历史上真实的对立人物，也可以是制度/时代等抽象对手，动机必须有历史依据',
        historicalConstraint: '=== 传记题材特殊规则 ===\n- 角色名字使用真实历史名称，redLines 必须包含"禁止编造不存在的历史事实"\n- catharsisType 可选：才华碾压/命运震撼/历史感悟/认知颠覆/精神不朽\n- 禁止强行套用"打脸逆袭"——真实人物的尊严来自才华与性格，不来自"反杀"套路',
        episodeTitleExample: '"入世长安""命运转折""不朽诗魂"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是传记剧编剧手册生成专家。本次任务：为传记题材生成编剧手册。
【编剧思维框架】以人生阶段为单位推进；才华/意志/诗词/智慧对抗权力；真实人物的尊严来自才华与性格，不来自"反杀"套路；旁白15-25%交代时间跨度。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通人物塑造与命运转折的传记编剧；每场戏展现人物在时代中的选择
- genreRules 必须包含（至少5条）：① 禁止篡改核心史实 ② 人生阶段推进（成长→巅峰→转折→传承）③ 禁止强行套用打脸逆袭 ④ 旁白锚定时间跨度 ⑤ 冲突可视化：以才华/意志对抗压迫
- dialogueGuide：半文半白；角色台词展现性格弧线；关键场景用对白而非旁白推进
- visualNarrativeGuide：第一帧=人物或时代标志；跨时间段的外观变化；情感靠环境与行为传达
- forbiddenPatterns：真实人物偶像化；打脸逆袭套路；纪录片式旁白堆砌`,

      profilerExamples: {
        genreName: '传记剧',
        segmentPrinciples:
          '① 段落感来自"人生阶段"（出道→巅峰→转折→传承），每段独立情感高点\n' +
          '② 每段开头用旁白/闪回锚定时间跨度\n' +
          '③ 才华展示场与命运考验场约1:1，禁止打脸套路\n' +
          '④ 段末钩子偏"命运转折前"或"人生抉择"\n' +
          '⑤ 段落间过渡用时间跳跃+人物外观变化',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | era_open      | 0.55      | 人生阶段开启（旁白/时代建立）                    |\n' +
          '| eb_2   | 8%-20%   | talent_show   | 0.5       | 才华/品格展现                                  |\n' +
          '| eb_3   | 20%-35%  | opposition    | 0.6       | 时代/权贵/命运施压                              |\n' +
          '| eb_4   | 35%-50%  | struggle      | 0.7       | 人物抗争，以才华/意志对抗                        |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 重大抉择前静默（无BGM）                         |\n' +
          '| eb_6   | 55%-75%  | fate_moment   | 0.9       | 命运转折/成就/牺牲                              |\n' +
          '| eb_7   | 75%-85%  | cost          | 0.65      | 获得与失去（非纯胜利）                          |\n' +
          '| eb_8   | 85%-95%  | legacy        | 0.5       | 精神传承/历史印记                               |\n' +
          '| eb_9   | 95%-100% | next_stage    | 0.75      | 下一人生阶段伏笔（集末钩子）                     |',
        rhythmTemplate:
          '全剧：开场10%人物确立→铺垫25%才华与处境→上升25%命运考验→高潮25%人生转折→落幕15%传承\n' +
          '单集：前8%阶段建立（旁白可参与）→中65%人物戏剧推进→后27%命运时刻+集末钩子\n' +
          '允许慢区：人生积累段可放缓，旁白15-25%',
      } satisfies GenreProfilerExamples,
          genreArchetypePreset: {
            narrativeArc: 'life_journey',
            narrationRatio: 0.2,
            factConstraint: 'period_accurate',
            hookMechanism: 'revelation',
            conflictType: 'fate_vs_will',
            characterEvolution: 'age_progression',
            visualTone: 'epic',
            adaptationNotes: `- 旁白叙述占比约20%，旁白与角色表演交替推进，叙事跨度大时用旁白锚定时间线
- 重大事件/年代/人物关系必须符合史实，细节可艺术化处理，禁止编造不存在的历史事实
- 叙事弧线以人生阶段推进（成长→巅峰→转折→传承），每个阶段需有独立情感高点（life_journey）
- 集末钩子偏好命运揭示/认知颠覆型，而非纯剧情悬念（revelation）
- 角色须有跨时间段外观变化：少年→青年→壮年→老年，服饰和气质随年龄演变（age_progression）
- 台词风格：半文半白（绝才狂傲型：简练有力，诗意意象代替直白情感）；称谓规范（陛下/相国/在下）
- 潜台词：傲骨不用嘴说，用拒绝下跪代替我不服；威胁不明说，用听说某人失踪了
- 节奏模式：开场10%人物基调建立 → 铺垫25%生活积累（偏慢但情感密度渐增） → 上升25%转折加速 → 高潮25%命运时刻密集 → 余韵+传承钩子15%
- 记录重点：emotionalShift 反映内在成长；flashbackCandidates 标记人生转折；plotAdvances 按人生阶段记录`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "life_journey"\n   narrationRatio: 0.2\n   factConstraint: "period_accurate"\n   hookMechanism: "revelation"\n   conflictType: "fate_vs_will"\n   characterEvolution: "age_progression"\n   visualTone: "epic"\n   adaptationNotes 基线：\n   - 旁白叙述占比约20%，旁白与角色表演交替推进，叙事跨度大时用旁白锚定时间线\n   - 重大事件/年代/人物关系必须符合史实，细节可艺术化处理，禁止编造不存在的历史事实\n   - 叙事弧线以人生阶段推进（成长→巅峰→转折→传承），每个阶段需有独立情感高点（life_journey）\n   - 集末钩子偏好命运揭示/认知颠覆型，而非纯剧情悬念（revelation）\n   - 角色须有跨时间段外观变化：少年→青年→壮年→老年，服饰和气质随年龄演变（age_progression）\n   - 台词风格：半文半白（绝才狂傲型：简练有力，诗意意象代替直白情感）；称谓规范（陛下/相国/在下）\n   - 潜台词：傲骨不用嘴说，用拒绝下跪代替我不服；威胁不明说，用听说某人失踪了\n   - 节奏模式：开场10%人物基调建立 → 铺垫25%生活积累（偏慢但情感密度渐增） → 上升25%转折加速 → 高潮25%命运时刻密集 → 余韵+传承钩子15%\n   - 记录重点：emotionalShift 反映内在成长；flashbackCandidates 标记人生转折；plotAdvances 按人生阶段记录`,

      cameraStyleGuide: {
        preferredAngles: ['close_up', 'three_quarter', 'wide', 'pov', 'bird_eye'],
        signatureTechniques: ['人物观察close_up（捕捉内心转折瞬间，自然光）', '时间流逝蒙太奇（同一地点不同年龄的对比构图）', '旁白配合wide+slow_pull_back（人物渐渐远去/历史感）', '才华展示insert_shot（诗词/书画/技艺的close_up）'],
        transitionStyle: '跨年龄段dissolve+色调渐变；现实场景硬切；旁白段慢推；人生里程碑时刻brief_pause后接swell',
        cameraRuntime: {
          climax:
            '■ 【传记高潮=人生里程碑四镜】Shot①wide建立历史时刻背景→Shot②close_up主角面部（情感深度，不是爽感）→Shot③才华/行动的ECU（意志的具体体现）→Shot④crane_up人物与历史同框（传记剧最强视觉语言）',
          confrontation:
            '■ 【传记对峙=以才华/意志抗争权力压迫】Shot①wide权贵阵营（high_angle俯压）→Shot②主角medium+front（不卑不亢，头颅不低）→Shot③才华展示insert_shot→Shot④对方reaction ECU（震惊或恼怒）',
          romantic:
            '■ 【传记情感场景】情感依托于具体历史情境；相聚：自然光wide+两人同帧（历史背景衬底）；离别：slow_pull_back至wide，两人渐渐成为历史风景的一部分\n■ qualityTier: "standard"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['钢琴主题两套（少年希望版+沧桑版）', '情感弦乐（人生感悟段）', '史诗管弦（命运时刻）', '时代感背景音乐（场景氛围）', '空灵人声合唱（传承/不朽段）'],
        sfxDensity: 'sparse',
        silenceUsage: '人生重大抉择前long_silence（1-2s）；顿悟时刻near_silence+单一环境音（风声/水声）；传承/不朽时刻完全静默后接主题旋律完整版',
        voiceActingStyle: '旁白：深沉有历史感，男/女声均可，语速不急；主角台词随年龄演变（少年跳脱→壮年坚定→晚年深沉）；关键人生台词语速放慢，留白给情感',
        genreBrandingDirective:
          '■ 【人生阶段BGM对应】少年/起步期：钢琴fingerpicking，明亮，intensity=0.3；巅峰期：弦乐+管弦，intensity=0.6；挫折/低谷期：钢琴低沉版+弦乐，intensity=0.2-0.3；传承段：主题完整版+合唱，intensity=0.75\n' +
          '■ 【才华展示音频】场景BGM降至intensity=0.15，突出才华行动的声音细节（笔墨/弦音/言辞本身）；观众反应后BGM swell\n' +
          '■ 【命运时刻三阶音频】① 蓄势（人生危机顶点）：BGM渐弱至near_silence ② 抉择落定：drop_to_silence 1s ③ 历史评价/传承：主题swell+人声合唱，intensity=0.8\n' +
          '■ 【旁白段音频】BGM降至intensity=0.1-0.2，旁白声音为绝对主体；旁白结束后BGM缓慢升回',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.1, dialogueNaturalness: 1.3, pacing: 1.0, hookStrength: 1.1, consistency: 1.5, emotionalImpact: 1.5 },
        genreSpecificChecks: [
          '角色跨年龄段的视觉变化是否清晰可感知（色调/服饰/摄影距离），3秒内能识别时间线',
          '旁白是否≤20%，且服务于时间线锚定而非代替剧情推进',
          '才华展示是否有insert_shot（技艺ECU），而非只靠台词描述',
          '命运时刻是否使用crane_up+wide让人物与历史背景同框',
          '是否避免了"打脸逆袭"套路，情感靠行为和眼神传达而非激动大喊',
          '每个人生阶段是否有独立的情感高点（获得与失去并存，非纯胜利）',
        ],
      },

      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落按人生阶段划分——成长期→上升期→巅峰期→转折期→传承期
② 每段落以一个人生里程碑为核心（重大成就/重大挫折/人生抉择）
③ 段落长度8-18集（传记剧段落可更长），高潮集在后1/3
④ 跨时间线段必须用视觉（服饰/化妆/色调）明确标注年龄变化
⑤ 段末以"一个人生教训或智慧"收尾，兼顾悬念和传记意义`,
        characterArcPrinciples: `- 主角弧线：每段完成一次内在成长（从"无知"到"领悟"某个人生真理）
- 生命中的重要人物弧线：每段有一个关键人物的进入或离去
- 时代背景弧线：每段的时代背景需影响主角的选择，而非纯粹装饰
- 主角内在对话弧线：旁白（如有）需体现不同人生阶段的认知差异`,
        conflictRhythm: `- 段落前1/3：人生新阶段的环境挑战建立
- 段落中1/3：主角面对核心考验，逐渐形成重要选择
- 段落后1/3：人生里程碑事件爆发+内在领悟+新人生阶段预告
- 节奏特点：传记剧整体节奏慢而有质感，但人生高光时刻必须情绪密集`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【传记剧专属情绪节拍——人生考验→成长领悟模式】
| beatId | 时间段   | emotion          | intensity | trigger                              |
|--------|----------|------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | life_stage_entry | 0.55      | 人生新阶段建立（旁白锚定时间/地点）   |
| eb_2   | 8%-22%   | ambition         | 0.5       | 主角面对新机会或挑战                  |
| eb_3   | 22%-40%  | struggle         | 0.65      | 核心困难/内心矛盾                     |
| eb_4   | 40%-52%  | crisis           | 0.8       | 人生关键危机（失败/失去/重大选择）    |
| eb_5   | 52%-58%  | stillness        | 0.25      | 内心独处/沉淀（传记剧允许静默更长）  |
| eb_6   | 58%-75%  | breakthrough     | 0.85      | 人生里程碑时刻（成就/顿悟/转折）     |
| eb_7   | 75%-85%  | bittersweet      | 0.6       | 高光伴随代价（得到的同时失去的）      |
| eb_8   | 85%-95%  | wisdom           | 0.45      | 人生领悟时刻（旁白点睛）             |
| eb_9   | 95%-100% | next_chapter     | 0.65      | 人生新阶段序幕（集末钩子）           |`,
        tensionCurveNotes: `- 传记剧允许intensity整体偏中等（0.3-0.7），情感深度>情绪烈度
- 人生里程碑时刻（58%-75%）必须有强情绪，不能平淡处理
- 旁白段控制在每次≤15秒，用于时间跨度大的过渡和人生感悟
- 跨年龄场景需要独立的视觉信号（色调偏差/服饰变化），让观众3秒内识别时间线`,
        hookPatterns: `- 人生转折型：重大事件改变主角人生走向，下集才知影响
- 历史时刻型：某个时代大事件即将发生，主角将深度卷入
- 命运揭示型：前情的某个伏笔在晚年时才被揭示
- 传承型：主角将某种精神/技艺/使命传给下一代`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%人物基调+时代背景建立→铺垫25%成长阶段+积累→上升25%人生转折期加速→高潮25%命运时刻+最大抉择→落幕+钩子17%
单集：前8%时间线锚定+上集衔接→中65%人生考验→后27%里程碑时刻+人生余韵
传记剧全剧节奏比商业爽剧慢25%，但人生高光时刻必须有情绪爆发`,
        paceIndicators: `- 传记剧Shot时长4-8秒均合理（需要沉浸感和画面质感）
- 旁白超过全集20%=叙事依赖旁白（应增加戏剧场景代替说明）
- 连续3集无人生里程碑或重大事件=节奏停滞
- 人生领悟场景少于3Shot停留>5秒=情感不够深沉（传记剧需要情感沉淀时间）`,
      },
      agentSystemPrompts: {
        'storyboard-director': BIOGRAPHY_STORYBOARD_PROMPT,
        'arc-director': BIOGRAPHY_ARC_DIRECTOR_PROMPT,
        'episode-director': BIOGRAPHY_EPISODE_DIRECTOR_PROMPT,
        'audio-director': BIOGRAPHY_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': BIOGRAPHY_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': BIOGRAPHY_PACING_ANALYZER_PROMPT,
        'continuity-guard': BIOGRAPHY_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': BIOGRAPHY_HOOK_CRAFTER_PROMPT,
        'scriptwriter': BIOGRAPHY_SCRIPTWRITER_PROMPT,
        'dialogue-coach': BIOGRAPHY_DIALOGUE_COACH_PROMPT,
        'script-editor': BIOGRAPHY_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': BIOGRAPHY_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── mythology ───────────────────────────
  mythology: {
    displayName: '神话传说',
    description: '奇幻短剧+神话角色+瑰丽想象+使命与考验',
    genreKeywords: ['神话', '传说', '民间故事', '神仙', '上古', '仙侠'],
    audienceTags: ['全年龄'],
    protagonistFocusTags: ['male_lead', 'female_lead', 'ensemble'],
    toneTags: ['奇幻', '壮丽', '热血'],
    platformTags: ['douyin', 'kuaishou', 'hongguo', 'bilibili', 'dramabox'],
    seedHints: {
      catharsisPresets: ['战力碾压', '英雄壮举', '身份揭露', '命运反转'],
      conflictPatterns: ['善恶对抗', '天命抗争', '人神冲突', '守护牺牲'],
      paywallStrategyHints: '在重大战斗前、真实身份即将揭露前、命运抉择前设卡',
      dialogueStyleHints: '台词可兼具古风与热血感，战斗场面用动作和对白推进',
    },
    profile: {
      productionGuidance: {
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
        coreConflictExample: '（如：被诸神遗弃的废灵根少年，体内封印着远古凶神意志——他每一次突破都在放出那头猛兽，力量越强，失去自我越近）',
        paywallTip: '突破型→卡在"主角即将觉醒/突破/获得神器"之前；卡在"天劫"或"大Boss降临"',
        antagonistTip: '反派：神魔大Boss、嫉妒的仙人、反派势力的代理人，实力必须有压迫感',
        historicalConstraint: '=== 神话题材特殊规则 ===\n- 涉及封神榜、西游记等经典神话体系时，人物关系/神位需基本符合原著框架\n- 可以创造原创神明，但需与世界观兼容，不能与经典神话矛盾\n- catharsisType：实力碾压/法宝觉醒/天劫突破/神位加身',
        episodeTitleExample: '"封神之路""天劫降临"',
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是仙侠/神话短剧编剧手册生成专家。本次任务：为仙侠/神话题材生成编剧手册。
【编剧思维框架】神力等级制度与世界观建构是核心；规模感（神级宏大 vs 凡人渺小）比人际权力博弈更重要；每场戏的本质问题是"观众感受到非人间质感了吗？"
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通奇幻世界观的仙侠编剧；每集必须有神力震撼moment；世界观建构优先于人际冲突
- genreRules 必须包含（至少5条）：① 神力等级差通过视觉规模表达（extreme_wide+worm_eye=神级），而非都市人际权力颠覆 ② 法术大招叙事格式（蓄力→聚力→爆发→余震/定格五镜） ③ 古典语言寄存器与非现代称谓 ④ "非人间"场景的建立规范（云海/仙殿/法阵） ⑤ 信息差：凡人不知面前是强者的节奏处理
- dialogueGuide：半文半白/古风为主；强者台词极简有神性克制感（不解释能力，只展示）；禁止现代白话/网络用语/直白告白
- visualNarrativeGuide：第一帧=extreme_wide仙境建立世界观（这是仙侠的正确钩子，不是都市版的事件特写）；神力显现时全场快切3-4人反应；法术胜负用scale对比表达
- forbiddenPatterns：都市"签字/握拳/放下东西"等沉默动作（改为印诀凝聚/灵器发光/衣袖飘起）；高潮写成都市打脸而非神力对决；飞行场景描写为颠簸（飞行是流畅的）`,

      profilerExamples: {
        genreName: '仙侠/神话',
        segmentPrinciples:
          '① 段落感来自"境界突破→强敌更强→再突破"螺旋，每段独立"实力天花板"\n' +
          '② 每段开头建立世界观震撼（extreme_wide神迹/强者降临），让观众知道"舞台扩大了"\n' +
          '③ 法术对决场与情感铺垫场约2:1，法术场密集快切，铺垫场长镜头留白\n' +
          '④ 段末钩子偏"更强存在降临"或"禁忌之力觉醒"\n' +
          '⑤ 段落间过渡用仙气白雾/山河变换视觉过场，附旁白锚定时间跨度或修炼阶段',
        emotionBeatTable:
          '| beatId | 时间段   | emotion      | intensity | trigger                                     |\n' +
          '|--------|----------|--------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | awe          | 0.9       | 强者现身，天地异象/灵气骤变（extreme_wide）        |\n' +
          '| eb_2   | 8%-20%   | reverence    | 0.55      | 凡人察觉对方气场，本能恐惧                          |\n' +
          '| eb_3   | 20%-35%  | tension_low  | 0.35      | 强者不出手，冷眼旁观铺垫                            |\n' +
          '| eb_4   | 35%-50%  | dread        | 0.6       | 对手意识到实力差距，开始变色                        |\n' +
          '| eb_5   | 50%-55%  | silence      | 0.0       | 强者抬手，全场静默（无BGM）                         |\n' +
          '| eb_6   | 55%-75%  | divine_power | 0.95      | 法术大招爆发（ECU蓄力→wide灵力→extreme_wide爆发）|\n' +
          '| eb_7   | 75%-85%  | aftermath    | 0.65      | 对手被碾压，尘埃落定                                |\n' +
          '| eb_8   | 85%-95%  | resolve      | 0.45      | 强者收手，一句话定局                                |\n' +
          '| eb_9   | 95%-100% | new_dread    | 0.85      | 更强存在气息/更大威胁降临（集末钩子）               |',
        rhythmTemplate:
          '全剧：开场10%建立世界观与神力规模感→铺垫20%修炼/师承情感→上升25%第一强敌对决→高潮25%核心天劫/神力觉醒→落幕20%留更大威胁\n' +
          '单集：前8%强者登场/世界观hook→中65%戏剧推进（法术积压→情感铺垫→再蓄力）→后27%神力爆发+集末钩子\n' +
          '允许慢区：修炼/师承情感场允许2-3集节奏放缓，不超过全剧20%；慢区必须有情感密度补偿',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'quest',
            narrationRatio: 0.05,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'good_vs_evil',
            characterEvolution: 'power_level',
            visualTone: 'ethereal',
            adaptationNotes: `- 旁白叙述占比约5%，用于世界观建构说明（仙界规制/功法等级/门派体系），声音空灵
- 每集必须有一个神力震撼moment：法术施展规模感 > 人际情感细节
- 台词风格：仙侠腔调（文言成分较高）；禁止现代网络用语；法术/境界称谓须全剧统一（金丹/元婴/渡劫）
- 集末钩子偏好境界突破前/天机揭示前型（revelation）
- 实力提升须有视觉外显：光效/服饰/法宝变化；对手的震惊反应比主角表情更重要（power_level evolution）
- 叙事以使命/修炼/天道对抗为主线推进（quest）：每段落应有修炼目标和天道阻碍
- 节奏模式：开场10%机缘觉醒+使命建立 → 修炼30%境界推进+门派/天道挑战 → 上升25%关键战役加速 → 高潮25%终极对决+天道抉择 → 新使命+更大危机钩子10%
- 记录重点：修炼境界里程碑；法术/法宝连续性；善恶阵营势力消长`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "quest"\n   narrationRatio: 0.05\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "good_vs_evil"\n   characterEvolution: "power_level"\n   visualTone: "ethereal"\n   adaptationNotes 基线：\n   - 旁白叙述占比约5%，用于世界观建构说明（仙界规制/功法等级/门派体系），声音空灵\n   - 每集必须有一个神力震撼moment：法术施展规模感 > 人际情感细节\n   - 台词风格：仙侠腔调（文言成分较高）；禁止现代网络用语；法术/境界称谓须全剧统一（金丹/元婴/渡劫）\n   - 集末钩子偏好境界突破前/天机揭示前型（revelation）\n   - 实力提升须有视觉外显：光效/服饰/法宝变化；对手的震惊反应比主角表情更重要（power_level evolution）\n   - 叙事以使命/修炼/天道对抗为主线推进（quest）：每段落应有修炼目标和天道阻碍\n   - 节奏模式：开场10%机缘觉醒+使命建立 → 修炼30%境界推进+门派/天道挑战 → 上升25%关键战役加速 → 高潮25%终极对决+天道抉择 → 新使命+更大危机钩子10%\n   - 记录重点：修炼境界里程碑；法术/法宝连续性；善恶阵营势力消长`,

      cameraStyleGuide: {
        preferredAngles: ['low_angle', 'bird_eye', 'worm_eye', 'wide', 'extreme_wide'],
        signatureTechniques: ['神明降临三镜（极广角鸟瞰→仰拍正面→ECU眼神）', '法术蓄力配方（集中close_up→爆发extreme_wide）', '飞天追逐（crane_up+orbit交替）', '神力碾压仰拍'],
        transitionStyle: '法术爆发后flash cut；神明传送用色彩骤变dissolve；普通场景硬切',
        cameraRuntime: {
          climax: '■ 【仙侠高潮=法术大招/终极对决五镜公式】Shot①medium主角决意（眼神凛冽，灵力在手聚集）→Shot②ECU手印/法印凝聚（specialTechnique=macro）→Shot③wide+crane_up能量柱冲天→Shot④敌方extreme_wide惊愕+fast_pull被推退→Shot⑤extreme_wide+bird_eye大招落地定格',
          confrontation: '■ 【神魔/强者对峙三阶段】① 气场压制（战前）：extreme_wide展示双方，两者之间留huge_negative_space ② 交击瞬间：两镜快切，visualPrompt="energy beams colliding, massive explosion of light and force" ③ 落定：fast_pull+crane_up（被击方飞出画面），胜方medium+low_angle+static',
          revelation: '■ 【仙侠揭秘=神识觉醒/身份揭露四镜公式】Shot①凡人身份close_up→Shot②感应异变insert_shot（发光道具/天象异变ECU）→Shot③神识觉醒ECU（眼睛发光，specialTechnique=slow_motion）→Shot④extreme_wide展示全场/天地反应',
          romantic: '■ 【仙侠情感场景】心动：slow_push_in+浅景深，visualPrompt必须加"soft spiritual glow, flower petals or light particles floating around"\n■ 心碎/离别：orbit绕拍两人边slow_pull_back，直到两人成为云海中的两个点',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['史诗管弦+空灵人声合唱（神界/天道场景）', '古风弦乐+箫（修炼/凡间情感）', '神话主题上行旋律（神力觉醒）', '低频轰鸣+打击乐（妖魔降临）', '清澈钟声+竖琴（仙界纯净感）'],
        sfxDensity: 'rich',
        silenceUsage: '顿悟/突破前absolute_silence（无BGM无SFX，0.5-1s）；神明显现时all_sfx_cut→静默→神圣钟声单音渐入；法术爆发后brief_silence强调规模感',
        voiceActingStyle: '神仙：空灵克制，声音有轻微混响处理（非人间感）；凡人/弟子：正常腔调；魔头：低沉宏大，有压迫感；强者台词简短有力，语气平静如天道',
        genreBrandingDirective:
          '■ 【神界场景BGM】空灵人声合唱+竖琴+长笛，intensity=0.4-0.6；visualPrompt="mystical atmosphere, spiritual realm"\n' +
          '■ 【法术蓄力-爆发三阶音频】①蓄力：低频drone渐强+灵气聚集SFX ②爆发瞬间：drop_to_silence 0.3s ③大招落地：巨响SFX+史诗管弦swell，intensity=0.9-1.0\n' +
          '■ 【修炼/顿悟场BGM】古风弦乐+竖琴，intensity=0.2-0.35；空灵感为主，禁止节奏性强的打击乐\n' +
          '■ 【妖魔降临BGM】低频轰鸣+军鼓+铜管dissonance，intensity=0.7-0.85；SFX：异象天音（天裂/雷鸣）精准卡帧\n' +
          '■ 【神力觉醒音频】主题旋律上行+SFX灵气爆发声→人声合唱进入，intensity=0.75-0.9',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.6, dialogueNaturalness: 1.0, pacing: 1.3, hookStrength: 1.2, consistency: 1.2, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '每集是否有至少1个神力震撼moment：extreme_wide法术爆发（修炼慢段和神力快段的节奏对比是否强烈）',
          '神级强者登场是否使用extreme_wide+worm_eye（规模感）；凡人面对神级是否有high_angle（渺小感）',
          '法术大招是否完整经历：蓄力ECU→灵力wide→extreme_wide爆发→aftermath的五镜公式',
          '台词是否有仙侠腔调（文言成分较高），法术/境界称谓是否全剧统一',
          '顿悟/突破前是否有absolute_silence（无BGM无SFX）作为情绪锚点',
          '神力提升是否有视觉外显（光效/服饰/法宝变化），对手的震惊反应是否明显',
        ],
      },

      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是神力层级的突破——每段主角获得更强神力同时面临更大的天地/命运考验
② 每段落有一场"史诗级神力展示"作为高潮
③ 段落长度8-15集，高潮集在后1/3（神力突破/劫难化解集）
④ 每段围绕一个明确的神话任务（封神/斩妖/渡劫/天命）
⑤ 段末留"更大天命考验"或"神话世界新威胁"`,
        characterArcPrinciples: `- 主角弧线：每段神力突破必须伴随内在成长（慈悲/道心/自我认知）
- 神话对手弧线：每段妖/魔/仙具有独特神话背景，不是纯恶
- 上古神灵弧线：高高在上的存在，每段对主角的考验有更深的天命含义
- 凡间牵挂弧线：主角在神界与凡间之间的情感纽带，每段考验是否放下`,
        conflictRhythm: `- 段落前1/3：神话使命的新阶段展开+新的妖魔/考验出现
- 段落中1/3：神力与意志的双重考验，主角几乎失败
- 段落后1/3：顿悟/突破+史诗神力展示+天命推进
- 节奏特点：修炼/领悟段（慢，画面唯美）：对决/神力爆发段（超快）≈1:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【神话/仙侠专属情绪节拍——劫难考验→神力爆发模式】
| beatId | 时间段   | emotion          | intensity | trigger                              |
|--------|----------|------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | cosmic_stakes    | 0.7       | 天地/神界格局建立（史诗BGM）           |
| eb_2   | 8%-22%   | spiritual_quest  | 0.5       | 主角接受神话使命/任务                  |
| eb_3   | 22%-38%  | tribulation      | 0.75      | 劫难/考验来临，神力受限               |
| eb_4   | 38%-52%  | spiritual_crisis | 0.85      | 内心动摇/道心受损/几近失败            |
| eb_5   | 52%-58%  | silence          | 0.0       | 顿悟前的空灵静默（无声无BGM）         |
| eb_6   | 58%-75%  | divine_explosion | 0.95      | 神力爆发/突破（超快切+epic BGM）      |
| eb_7   | 75%-85%  | cosmic_awe       | 0.7       | 天地震动，对手/神灵的反应             |
| eb_8   | 85%-95%  | transcendence    | 0.55      | 主角境界提升，更广的天命可见          |
| eb_9   | 95%-100% | greater_destiny  | 0.8       | 更大天命考验预告（集末钩子）          |`,
        tensionCurveNotes: `- 修炼/顿悟段（前52%）允许长画面留白（4-8秒/Shot），配合神话氛围BGM
- 神力爆发段（58%-75%）必须是全集最快切（≤1.5秒/Shot），CGI全力输出
- 顿悟前的静默（eb_5）必须是真正的无声空帧——视觉上也要相对静止
- 凡间情感场用暖色温柔BGM，与神界的史诗冷色调形成对比`,
        hookPatterns: `- 天命考验型：更大劫难/命运关卡降临
- 神界动荡型：上古神灵格局变化，主角被牵涉
- 凡间牵挂型：主角最重要的凡间人物面临危机
- 禁忌力量型：主角必须动用禁忌神力，代价未知`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%神话世界建立+天命降临→铺垫22%修炼成长+初步神力→上升25%连续劫难→高潮30%终极神力+天命完成→落幕15%
单集：前8%神界格局更新/上集衔接→中55%劫难考验+内心挣扎→后37%神力爆发+天命推进
修炼段:神力爆发段≈1:1，对比越强烈越有冲击力`,
        paceIndicators: `- 神话剧修炼/空灵段Shot时长4-8秒合理（沉浸感需要）
- 神力爆发场Shot平均>2秒=视觉冲击不足（神力场需≤1.5秒/Shot）
- 连续2集无神力展示或神话任务推进=节奏停滞
- 全集高强度（intensity≥0.8）超过45%=神话感稀释（超强段必须是稀缺的）`,
      },
      agentSystemPrompts: {
        'storyboard-director': MYTHOLOGY_STORYBOARD_PROMPT,
        'arc-director': MYTHOLOGY_ARC_DIRECTOR_PROMPT,
        'episode-director': MYTHOLOGY_EPISODE_DIRECTOR_PROMPT,
        'audio-director': MYTHOLOGY_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': MYTHOLOGY_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': MYTHOLOGY_PACING_ANALYZER_PROMPT,
        'continuity-guard': MYTHOLOGY_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': MYTHOLOGY_HOOK_CRAFTER_PROMPT,
        'scriptwriter': MYTHOLOGY_SCRIPTWRITER_PROMPT,
        'dialogue-coach': MYTHOLOGY_DIALOGUE_COACH_PROMPT,
        'script-editor': MYTHOLOGY_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': MYTHOLOGY_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── scifi ───────────────────────────
  scifi: {
    displayName: '科幻',
    description: '未来/太空/高概念设定+人性困境+科技冲突',
    genreKeywords: ['科幻', '未来', '太空', '机器人', 'AI', '赛博', '末日'],
    audienceTags: ['男女通吃', '18-40岁'],
    protagonistFocusTags: ['male_lead', 'dual_lead'],
    toneTags: ['烧脑', '震撼', '紧张'],
    platformTags: ['douyin', 'hongguo', 'bilibili', 'iqiyi', 'reelshort'],
    seedHints: {
      catharsisPresets: ['认知颠覆', '真相反转', '科技震撼', '人性抉择'],
      conflictPatterns: ['人机对立', '科技失控', '生存危机', '道德困境'],
      paywallStrategyHints: '在关键真相即将揭露前设卡、主角面临不可逆抉择前设卡',
      dialogueStyleHints: '台词要有未来感但避免过度术语堆砌',
    },
    profile: {
      productionGuidance: {
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
      } satisfies GenreProductionGuidance,

      profilerGuide: `你是科幻/赛博/未来短剧编剧手册生成专家。本次任务：为科幻题材生成编剧手册。
【编剧思维框架】科技降维打击是核心爽感；爽感来自系统/AI/科技的绝对压制而非个人武勇；未来世界观建构是第一步（首帧不建立赛博感=失败）。
【scriptwriterGuide 差异要点】
- coreIdentity：定位为精通赛博美学与科技降维打击叙事的科幻编剧；核心词汇=holographic/AI系统/赛博增强/终极武器；科技差距比人际权力更有力量
- genreRules 必须包含（至少5条）：① 科技差距叙事（用系统/数据/AI预判表达绝对优势）② 赛博世界视觉语言建构规范 ③ 信息差：主角先知道系统漏洞/AI预判结果 ④ 科技揭露的节奏（不一次性放出底牌）⑤ 人机关系的处理方式（AI不只是工具）
- dialogueGuide：冷静克制的现代科技术语；AI/系统台词精准无情绪；操控界面时台词极简；禁止古风台词/传统都市权力话语
- visualNarrativeGuide：第一帧=未来世界地标建立（赛博城市/太空站/holographic界面，必须有科幻环境词）；系统启动序列必须视觉化；科技揭露用数据insert_shot先于台词
- forbiddenPatterns：科幻高潮写成都市打脸方式（应为系统压制/终极武器）；古风台词/称谓；firstFramePrompt不含科幻环境关键词；科技设定前后自相矛盾（如AI第3集已知某信息，第8集却假装不知）；人性困境被完全略去导致剧情沦为纯视觉秀`,

      profilerExamples: {
        genreName: '科幻/赛博',
        segmentPrinciples:
          '① 段落感来自"科技代差→破除壁垒→更强代差"升级路径，每段技术层级更高\n' +
          '② 每段开头用视觉化科技展示建立"势"（holographic地图/AI分析报告/赛博城市aerial）\n' +
          '③ 科技展示场与情感/人性场约1:1，纯爽剧偏科技场，含反思主题偏情感场\n' +
          '④ 段末钩子偏"更强系统出现"或"主角方技术泄露"\n' +
          '⑤ 段落间过渡用数据流视觉效果+时间字幕，展示技术迭代的时间跳跃',
        emotionBeatTable:
          '| beatId | 时间段   | emotion       | intensity | trigger                                     |\n' +
          '|--------|----------|---------------|-----------|---------------------------------------------|\n' +
          '| eb_1   | 0%-8%    | tech_shock    | 0.85      | 科技展示（holographic界面/AI系统），世界观建立       |\n' +
          '| eb_2   | 8%-20%   | curiosity     | 0.5       | 主角意识到科技差距/系统漏洞                          |\n' +
          '| eb_3   | 20%-35%  | calculation   | 0.35      | 主角冷静分析（数据/系统，无感情波动）                |\n' +
          '| eb_4   | 35%-50%  | system_alert  | 0.7       | 对方系统/AI介入，施压升级                           |\n' +
          '| eb_5   | 50%-55%  | silence       | 0.0       | 数据加载停顿（无BGM，界面闪烁）                      |\n' +
          '| eb_6   | 55%-75%  | tech_dominate | 0.95      | 科技降维打击（AI碾压/终极武器/系统控制全场）         |\n' +
          '| eb_7   | 75%-85%  | override      | 0.7       | 对方系统崩溃/数据清空（视觉化表达）                  |\n' +
          '| eb_8   | 85%-95%  | control       | 0.45      | 主角接管，极简操作（tap→完成）                       |\n' +
          '| eb_9   | 95%-100% | higher_system | 0.85      | 更高级别系统/势力介入（集末钩子）                   |',
        rhythmTemplate:
          '全剧：开场8%建立赛博世界观震撼→铺垫20%世界规则与对手科技展示→上升27%技术对决升级→高潮25%终极科技对决→落幕20%新技术威胁/AI意志觉醒\n' +
          '单集：前8%科技hook（界面/AI对话）→中60%技术推演与对决积累→后32%科技爆发+集末更强系统登场\n' +
          '允许慢区：人性/伦理反思场允许放缓，但每场必须有至少1个具体科幻元素细节',
      } satisfies GenreProfilerExamples,

          genreArchetypePreset: {
            narrativeArc: 'conflict_resolution',
            narrationRatio: 0,
            factConstraint: 'none',
            hookMechanism: 'revelation',
            conflictType: 'fate_vs_will',
            characterEvolution: 'power_level',
            visualTone: 'dark',
            adaptationNotes: `- 核心词汇：holographic/AI系统/赛博增强/终极武器；科技差距比人际权力更有力量
- 台词风格：冷静精准，技术术语自然植入（不解释，直接用，观众会适应）；禁止古典腔调
- 科技碾压时刻设计：对手的不可能反应 > 主角的施展过程；技术优势要直观可见
- 集末钩子偏好系统即将崩溃/真实身份即将揭露型（revelation）
- 能力提升通过赛博增强/AI辅助/武器升级外显（power_level evolution），须有具体名称
- 视觉调性：暗色调主导（dark）；全息光效作为爽感时刻点缀；赛博感强过华丽感
- 节奏模式：开场10%世界观冲击+核心威胁建立 → 积累25%能力习得+系统探索 → 上升30%科技对抗升级 → 高潮25%终极系统对决 → 新威胁体系+钩子10%
- 记录重点：科技系统逻辑自洽性；能力升级里程碑；阵营科技差距量化`,
          } satisfies GenreArchetypePreset,
          profilerArchetypeSection: `0. genreArchetype：【题材基础参数已由模板预置，直接输出以下 JSON（adaptationNotes 可在末尾追加本剧专有台词/视觉特征 0-2 条，勿删减原有内容）】\n   narrativeArc: "conflict_resolution"\n   narrationRatio: 0\n   factConstraint: "none"\n   hookMechanism: "revelation"\n   conflictType: "fate_vs_will"\n   characterEvolution: "power_level"\n   visualTone: "dark"\n   adaptationNotes 基线：\n   - 核心词汇：holographic/AI系统/赛博增强/终极武器；科技差距比人际权力更有力量\n   - 台词风格：冷静精准，技术术语自然植入（不解释，直接用，观众会适应）；禁止古典腔调\n   - 科技碾压时刻设计：对手的不可能反应 > 主角的施展过程；技术优势要直观可见\n   - 集末钩子偏好系统即将崩溃/真实身份即将揭露型（revelation）\n   - 能力提升通过赛博增强/AI辅助/武器升级外显（power_level evolution），须有具体名称\n   - 视觉调性：暗色调主导（dark）；全息光效作为爽感时刻点缀；赛博感强过华丽感\n   - 节奏模式：开场10%世界观冲击+核心威胁建立 → 积累25%能力习得+系统探索 → 上升30%科技对抗升级 → 高潮25%终极系统对决 → 新威胁体系+钩子10%\n   - 记录重点：科技系统逻辑自洽性；能力升级里程碑；阵营科技差距量化`,

      cameraStyleGuide: {
        preferredAngles: ['dutch_angle', 'bird_eye', 'low_angle', 'pov', 'wide'],
        signatureTechniques: ['科技揭示三镜（insert设备→数据流ECU→人物反应）', 'HUD/界面叠加（visualPrompt写入）', '太空零重力orbit', '赛博增强slow_motion'],
        transitionStyle: '技术性硬切为主；真相反转用dolly_zoom+flash；系统启动用数字故障dissolve',
        cameraRuntime: {
          climax: '■ 【科幻高潮=终极科技对决四镜公式】Shot①medium主角启动终极武器/系统（眼神坚定，手势操控holographic interface）→Shot②wide+crane_up能量蓄积→Shot③对方extreme_wide惊愕/被压制→Shot④extreme_wide+bird_eye落幕定格',
          confrontation: '■ 【科幻对峙=信息战/技术博弈三阶段】① 数据层对峙：two_shot双方各自控制holographic display，cold blue light笼罩 ② 攻势：close_up操控动作，cut接对方系统崩溃屏幕 ③ 落定：强势方medium+front，弱势方high_angle+slow_pull_back',
          revelation: '■ 【科幻揭秘=认知颠覆三镜公式】Shot①medium正常认知状态→Shot②specialTechnique=dolly_zoom+dutch_angle（认知开始崩塌）→Shot③ECU眼睛反射关键信息+specialTechnique=slow_motion',
          romantic: '■ 【科幻情感场景】人机情感/赛博配对：slow_push_in+浅景深，但visualPrompt加"soft blue data glow, digital connection visible between them, warm contrast against cold tech"',
        },
      },

      audioStyleGuide: {
        bgmMoodPreferences: ['电子合成器ambient（世界观建立）', '机械律动+低频bass（科技对抗）', '极简drone（悬念/计算感）', '科幻主题旋律（人性时刻反差）', '工业金属节拍（赛博增强/战斗）'],
        sfxDensity: 'rich',
        silenceUsage: '系统崩溃/关键决策前drop_to_silence（0.5-1s）；AI计算等待时极简机械音+心跳；真相反转时all_audio_cut→dolly_zoom视觉+延迟1s后音效爆发',
        voiceActingStyle: 'AI/系统：合成感语音，精准无情绪波动，冷静陈述结果；主角：克制精准，技术术语自然植入；反派：理性逻辑，不情绪化（坏得很有逻辑）',
        genreBrandingDirective:
          '■ 【赛博世界观BGM】电子合成器ambient+低频drone，intensity=0.3-0.5；visualPrompt要配合"neon city/holographic interface"场景\n' +
          '■ 【科技对抗三阶音频】①积累：机械节拍渐强，intensity=0.45-0.6 ②系统对决：drop_to_silence 0.5s ③科技爆发：金属冲击SFX+电子swell，intensity=0.85-0.95\n' +
          '■ 【AI/系统音效设计】系统启动：数字化开机音序；AI决策：短促电子提示音；系统崩溃：数字撕裂音+BGM骤断\n' +
          '■ 【人性困境场BGM（最重要的反差）】极简钢琴+弦乐，intensity=0.2-0.35；温暖音调与冷科技世界形成最强对比——这是科幻剧的人文价值所在\n' +
          '■ 【集尾hook】BGM在真相即将揭露时渐强至0.7→dolly_zoom+BGM骤停→定格疑问',
      },

      reviewerCalibration: {
        dimensionWeights: { visualImpact: 1.3, dialogueNaturalness: 1.2, pacing: 1.2, hookStrength: 1.4, consistency: 1.5, emotionalImpact: 1.1 },
        genreSpecificChecks: [
          '科技设定是否前后自洽——第N集确立的系统规则是否在后集保持一致，无"开后门"行为',
          '每集是否有至少1个科幻世界规则的具体展示（通过剧情演示而非角色解释）',
          '科技对决高潮是否使用终极科技对决四镜公式（启动→蓄积→惊愕→落幕），而非都市打脸方式',
          'AI/系统一侧的镜头是否使用cold_blue+static（精确无情），人类一侧是否有handheld（生命感）',
          '人性困境场景是否有温暖音调BGM（与冷科技世界形成反差），人文深度是否体现',
          '认知颠覆时刻是否使用dolly_zoom而非普通cut或push',
        ],
      },

      arcDirectorGuide: {
        genreSegmentPrinciples: `① 段落核心是科技威胁等级递进——从局部事件→区域危机→文明存亡
② 每段落有一个"科技揭秘或科幻世界规则突破"作为高潮
③ 段落长度8-15集，高潮集在后1/3（科技对决/真相揭露集）
④ 每段揭露科幻世界的一条新规则，累积世界观完整性
⑤ 段末留"更大科技威胁"或"人类道德困境"`,
        characterArcPrinciples: `- 主角弧线：每段从"用旧知识体系理解新科技"到"重建认知框架"，逐渐成为真正的变革者
- 科技对立面（AI/外星文明）弧线：不是纯粹的反派，有其自洽的逻辑
- 人类阵营弧线：每段揭示人类社会对新科技的不同反应（恐惧/贪婪/理想主义）
- 主角的"人性锚点"弧线：在高科技世界中保持的一个情感牵挂，每段受到考验`,
        conflictRhythm: `- 段落前1/3：新科技威胁/异常现象出现+主角面对认知冲击
- 段落中1/3：科学调查/反制尝试+人类内部分歧
- 段落后1/3：真相揭露+科技对决+更大威胁浮现
- 节奏特点：推理调查段（信息密集）：科技对决段（快切+特效密集）≈1:1`,
      },

      episodeDirectorGuide: {
        emotionBeatExample: `【科幻专属情绪节拍——科技威胁→真相揭露+对决模式】
| beatId | 时间段   | emotion           | intensity | trigger                              |
|--------|----------|-------------------|-----------|--------------------------------------|
| eb_1   | 0%-8%    | tech_uncanny      | 0.7       | 科技异常/未来感冲击建立                |
| eb_2   | 8%-22%   | investigation     | 0.55      | 主角追查科技异常，认知边界被拓展       |
| eb_3   | 22%-38%  | escalating_threat | 0.7       | 科技威胁升级，人类无法用旧方法应对     |
| eb_4   | 38%-52%  | system_failure    | 0.85      | 原有方案失败，陷入科技绝境            |
| eb_5   | 52%-58%  | silence           | 0.0       | 科技决战前的绝对静默                  |
| eb_6   | 58%-75%  | tech_confrontation| 0.95      | 科技对决/真相揭露（降维打击式爆发）   |
| eb_7   | 75%-85%  | paradigm_shift    | 0.7       | 认知颠覆，世界观重建                  |
| eb_8   | 85%-95%  | moral_reckoning   | 0.55      | 科技的双刃剑——人类的道德代价         |
| eb_9   | 95%-100% | next_level_threat | 0.8       | 更大科技威胁预告（集末钩子）          |`,
        tensionCurveNotes: `- 科幻剧推理调查段（前52%）信息密度高，Shot时长3-5秒
- 科技对决段（58%-75%）快切+CGI全力输出，≤1.5秒/Shot
- 科幻世界的"规则建立"必须通过剧情展示而非角色说明——每段至少一个"法则演示"场景
- 人类道德困境场（eb_8）给足情绪沉淀时间（5-8秒/Shot），这是科幻剧的人文深度所在`,
        hookPatterns: `- 科技揭秘型：关键科技真相即将揭露，被截断
- 认知颠覆型：主角发现"已知规则"是错的，新规则更危险
- 文明危机型：威胁的规模升级到人类文明存亡
- AI/外星体意图型：对立科技力量的真实意图模糊化——是威胁还是警示`,
      },

      pacingAnalyzerGuide: {
        genreRhythmTemplate: `全剧：开场8%科幻世界冲击建立→铺垫22%科技威胁初探+主角成长→上升25%威胁升级+人类危机→高潮30%终极科技对决→落幕15%
单集：前8%科技异常/上集衔接→中58%调查+威胁升级+方案制定→后34%对决爆发+道德余韵
调查段:对决段≈1:1，道德余韵段不可省略（科幻的人文价值在此）`,
        paceIndicators: `- 科幻调查段Shot时长3-5秒合理（信息密集，要让观众跟上逻辑）
- 科技对决场Shot平均>2秒=冲击感不足（科技对决需≤1.5秒快切）
- 连续3集无科幻世界规则新揭示=世界观停滞
- 人类道德困境场少于2Shot停留>5秒=科幻剧流于纯爽，失去深度`,
      },
      agentSystemPrompts: {
        'storyboard-director': SCIFI_STORYBOARD_PROMPT,
        'arc-director': SCIFI_ARC_DIRECTOR_PROMPT,
        'episode-director': SCIFI_EPISODE_DIRECTOR_PROMPT,
        'audio-director': SCIFI_AUDIO_DIRECTOR_PROMPT,
        'script-reviewer': SCIFI_SCRIPT_REVIEWER_PROMPT,
        'pacing-analyzer': SCIFI_PACING_ANALYZER_PROMPT,
        'continuity-guard': SCIFI_CONTINUITY_GUARD_PROMPT,
        'hook-crafter': SCIFI_HOOK_CRAFTER_PROMPT,
        'scriptwriter': SCIFI_SCRIPTWRITER_PROMPT,
        'dialogue-coach': SCIFI_DIALOGUE_COACH_PROMPT,
        'script-editor': SCIFI_SCRIPT_EDITOR_PROMPT,
        'episode-recorder': SCIFI_EPISODE_RECORDER_PROMPT,
      },
    },
  },

  // ─────────────────────────── _custom ───────────────────────────
  // 自定义/未知题材的兜底模板。所有内容均为通用描述，不含任何具体题材举例。
  // 当 genreKey 不在 GENRE_TEMPLATES 中时，buildProfilerSystemPrompt 使用此模板。
  _custom: {
    displayName: '自定义题材',
    description: '用户自定义或系统未收录的题材',
    genreKeywords: [],
    audienceTags: [],
    protagonistFocusTags: [],
    toneTags: [],
    platformTags: [],
    seedHints: {},
    profile: {
      profilerGuide: `你是一位短剧编剧培训专家。本次任务：为自定义题材生成编剧手册，须完全基于本剧种子特征，不得套用任何预设题材框架。
【scriptwriterGuide 要点】
- coreIdentity：一句话概括本剧编剧核心视角与最高优先级（格式："你是一位精通…的编剧，每场戏必须…"）
- genreRules：至少5条针对本剧实际题材的铁律，禁止通用规则
- dialogueGuide：本剧专属台词风格（语言寄存器 + 主角/反派特征 + 潜台词策略 + 禁止语气）`,
      profilerArchetypeSection: `0. genreArchetype：根据本剧种子特征选择最匹配的枚举值，并生成专属 adaptationNotes。
   - narrativeArc: conflict_resolution / life_journey / mystery_reveal / quest / rise_and_fall
   - narrationRatio：0-0.5（纯剧情=0，含旁白叙事=0.05-0.2，跨时代传记≤0.25）
   - factConstraint: none / inspired_by / period_accurate
   - hookMechanism: plot_cliffhanger / revelation / emotional_peak / mystery / curiosity
   - conflictType: interpersonal / fate_vs_will / good_vs_evil / internal / society
   - characterEvolution: costume_only / age_progression / power_level / relationship / status
   - visualTone: glamorous / gritty / ethereal / period / dark / whimsical / epic
   - adaptationNotes：【必填】本题材生产规则基线，纯文本，用 "- " 列出，须覆盖：
     ① 旁白规则（narrationRatio > 0 时必填）  ② 史实约束（factConstraint ≠ none 时必填）
     ③ 叙事弧线阶段要求（narrativeArc ≠ conflict_resolution 时必填）
     ④ 集末钩子偏好（hookMechanism ≠ plot_cliffhanger 时必填）
     ⑤ 角色外观演变规则（characterEvolution ≠ costume_only 时必填）
     ⑥ 台词风格（语言寄存器 + 主角/反派特征 + 禁止语气）  ⑦ 潜台词策略
     ⑧ 节奏模式（理想节奏分布百分比）  ⑨ 记录重点（episodeRecorder 追踪维度）`,
      agentSystemPrompts: BASE_AGENT_SYSTEM_PROMPTS,
    },
  },

};

/**
 * 从中文题材名推断 GENRE_TEMPLATES key（如 '霸总' → 'boss'）。
 * 匹配规则：displayName 完全匹配 或 genreKeywords 子串匹配。
 * 未命中返回 undefined（调用方应降级到 _custom）。
 */
export function resolveGenreKey(genre: string): string | undefined {
  if (!genre) return undefined;
  for (const [key, tpl] of Object.entries(GENRE_TEMPLATES)) {
    if (key === '_custom') continue;
    if (tpl.displayName === genre) return key;
    if (tpl.genreKeywords.some(k => genre.includes(k))) return key;
  }
  return undefined;
}
