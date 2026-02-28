/** 默认 RuleAtom 集合 — 从 novel-playbook.ts 7 大文本拆解而来 */
import { RuleAtom } from '../schemas/rule-engine.schemas';
import { createHash, randomUUID } from 'crypto';

const stableId = (category: string, title: string) => createHash('sha1').update(`sys:${category}:${title}`).digest('hex').slice(0, 24);

const a = (p: Omit<RuleAtom, 'id' | 'isEnabled' | 'source'> & { source?: RuleAtom['source'] }): RuleAtom => ({
  id: stableId(p.category, p.title), isEnabled: true, source: 'system', ...p,
});

// ── PROSE_CRAFT_PLAYBOOK（文笔技法）— 9 atoms ──
const PROSE_CRAFT_ATOMS: RuleAtom[] = [
  a({ category: 'prose_craft', title: '展示而非讲述', priority: 95,
    targetAgents: ['creative-writer', 'editor', 'reviewer', 'scene-stitcher'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '每当你想写"他/她感到XX"时，停下来，改成让读者从动作/感官/细节中自己感受到XX。\n- 不要写"他心中一惊"→ 写具体反应（筷子从手中滑落、脚步顿了一下、瞳孔骤缩）\n- 不要写"她很美"→ 写旁人的反应（酒楼掌柜多看了两眼、路人差点撞上柱子）\n- 不要写"气氛很紧张"→ 写感官细节（安静到能听见自己咽口水的声音）' }),
  a({ category: 'prose_craft', title: '对白技法', priority: 90,
    targetAgents: ['creative-writer', 'editor'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '- 潜台词：角色说的和想的不一定一样。越重要的话，越不会直说。\n- 每句对话至少完成两个任务：推进剧情+展示性格，或传递信息+制造冲突。\n- 权力差异影响语气：强者说短句、陈述语气；弱者说长句、试探语气。\n- 沉默也是对话：角色不回应的时刻，往往比说了什么更有力量。\n- 对白标签要变化："说"只占一半，其余用动作代替。\n- 允许打断、省略、跑题——真实对话不是轮流发言。' }),
  a({ category: 'prose_craft', title: '句式节奏', priority: 85,
    targetAgents: ['creative-writer', 'scene-stitcher'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '- 紧张时刻用短句。平静时刻用长句。长短交替像呼吸。\n- 一段之内避免连续三句以同样方式开头。\n- 重要信息出现前，放一个短段单独成段——制造视觉停顿。\n- 战斗场景：短句+断句+画面感。日常场景：长句+细节+氛围。' }),
  a({ category: 'prose_craft', title: '感官叠加', priority: 80,
    targetAgents: ['creative-writer'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '每个重要场景至少调动两种以上感官（视觉+听觉+触觉/嗅觉/味觉）。\n- 坏：他走进山洞，里面很暗。→ 好：脚下踩到什么柔软的东西，潮湿的空气裹着一股甜腐的气味涌来，远处水滴落入积水的声音被洞壁放大成空洞的回声。\n- 气温、风、光线方向、地面质感——这些看似无关的细节是沉浸感的基石。' }),
  a({ category: 'prose_craft', title: '环境映射情绪', priority: 75,
    targetAgents: ['creative-writer'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '景随心动——环境和人物的情绪形成共振。\n- 角色高兴时不要写"他很高兴"→ 写"日光正好，街边的槐花不知什么时候开了"。\n- 角色压抑时不要写"气氛沉重"→ 写"天色暗了下来，巷子里的风比刚才凉了些"。' }),
  a({ category: 'prose_craft', title: '留白术', priority: 70,
    targetAgents: ['creative-writer'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '什么都不说，反而最有力量。\n- "他望着那个方向很久，没有说话。"比200字心理描写更震撼。\n- 关键时刻的停顿、沉默、省略号——给读者想象空间。\n- 坏："他心里充满了悲伤和不舍。"→ 好："他站在原地，直到那道背影消失在雨幕中。然后他低头，擦了擦鞋上的泥。"' }),
  a({ category: 'prose_craft', title: '旁观者烘托', priority: 65,
    targetAgents: ['creative-writer'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    conditions: [{ field: 'chapterType', op: 'in', value: ['climax', 'rising'] }],
    content: '用不同层次的反应衬托关键时刻。\n- 重大事件发生时，按认知层级递进写旁观者反应：不知情者茫然→知情者震动→权威者动容。\n- 每一层的反应都要具体不同：有人手中物品跌落、有人不自觉后退一步、有人站了起来。\n- 旁观者的碎语（"这……怎么可能？"）是读者获得满足感的重要通道。' }),
  a({ category: 'prose_craft', title: '金句意识', priority: 60,
    targetAgents: ['creative-writer', 'editor'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '每隔几章，要有一句让读者想截图的话。\n- 金句不是文艺腔，是浓缩了角色性格和当下处境的一句话。\n- 好的金句特征：简短、有力、有态度、放在特殊语境下才有味道。\n- 金句出现在关键转折点：反转前、誓言时、生死抉择时、多年后重逢时。' }),
  a({ category: 'prose_craft', title: '杀死AI味', priority: 98,
    targetAgents: ['creative-writer', 'editor', 'reviewer'],
    outputKey: 'PROSE_CRAFT_PLAYBOOK',
    content: '以下表达每章每个最多出现一次（超出即扣分）：\n"不由得""心中一凛""眼中闪过""与此同时""值得一提""总而言之""深吸一口气""空气仿佛凝固""嘴角微微上扬""不禁""缓缓开口""微微一笑""目光深邃"\n\n深层AI味（比套话更隐蔽，更致命）：\n- 角色对自己的情绪过于自知（"他意识到自己在嫉妒"——真人不会这么想）\n- 事件发展过于顺滑，没有"卡壳"和意外\n- 所有角色的内心戏都像在写论文（"一方面…另一方面…"）\n- 过于对称工整的结构（"先A再B然后C"的三段式）\n- 缺少"废话"——真实对话中的停顿、重复、词不达意' }),
];

// ── WRITING_SOUL_PLAYBOOK（写作灵魂）— 6 atoms ──
const WRITING_SOUL_ATOMS: RuleAtom[] = [
  a({ category: 'writing_soul', title: '简体中文输出', priority: 100,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '所有正文必须使用简体中文。禁止输出任何元叙述。' }),
  a({ category: 'writing_soul', title: '代入感优先', priority: 95,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '代入感是命根子：写任何场景前先问"读者读到这里会代入谁的视角"，然后用那个人的感官去写。' }),
  a({ category: 'writing_soul', title: '情绪先行', priority: 90,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '先确定"读者读到这里应该是什么心情"，再倒推用什么细节引发那种心情。' }),
  a({ category: 'writing_soul', title: '性格驱动行为', priority: 85,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '角色的行为必须从人物性格中自然流出，不得被剧情强行驱动。' }),
  a({ category: 'writing_soul', title: '不完美原则', priority: 80,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '真实的人有口误、犹豫、前后矛盾。角色不要太理性、太自知——"他意识到自己在害怕"这种话真人不会想。' }),
  a({ category: 'writing_soul', title: '创作自由', priority: 75,
    targetAgents: ['creative-writer'],
    outputKey: 'WRITING_SOUL_PLAYBOOK',
    content: '允许在写作过程中产生计划外的灵感——好的意外比严格执行计划更重要。' }),
];

// ── CHARACTER_ARC_PLAYBOOK（角色弧线）— 6 atoms ──
const CHARACTER_ARC_ATOMS: RuleAtom[] = [
  a({ category: 'character_arc', title: '矛盾内核', priority: 95,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '每个重要角色都有一个不可调和的内在矛盾——想做好人但生在乱世，想保护所有人但力量不够，渴望自由却背负责任。这个矛盾是角色做出所有选择的根源。' }),
  a({ category: 'character_arc', title: '以小见大', priority: 90,
    targetAgents: ['creative-writer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '不要用大段内心独白展示性格——通过一个微小的选择（在街上看到乞丐的反应、独处时的小习惯）来暗示角色的内核。' }),
  a({ category: 'character_arc', title: '非线性成长', priority: 85,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '成长不是线性的。角色可以两步前进一步后退：一个变勇敢的角色也可以突然怯懦，这恰恰真实。' }),
  a({ category: 'character_arc', title: '双向关系', priority: 80,
    targetAgents: ['creative-writer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '关系是双向的。A对B的态度变化，同时应该影响B对A的反应。两个特定角色在一起时应该有独特的互动方式——只属于他们的玩笑、默契或紧张感。' }),
  a({ category: 'character_arc', title: '情绪逻辑', priority: 100,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '情绪逻辑不可违反：角色的情绪反应必须和刚经历的事件匹配。刚失去至亲不能下一段就谈笑风生，除非有明确的压抑/伪装理由。' }),
  a({ category: 'character_arc', title: '扁平化警报', priority: 75,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CHARACTER_ARC_PLAYBOOK',
    content: '如果一个角色连续多章只是功能性出场，需要给他一个展现内心的时刻。重要角色应定期经历"内心考验"——选择、妥协、发现、醒悟。' }),
];

// ── EDITOR_DISCIPLINE_PLAYBOOK（编辑纪律）— 4 atoms ──
const EDITOR_DISCIPLINE_ATOMS: RuleAtom[] = [
  a({ category: 'editor_discipline', title: '修复问题', priority: 95,
    targetAgents: ['editor'],
    outputKey: 'EDITOR_DISCIPLINE_PLAYBOOK',
    content: '优先修复审阅指出的具体问题。保留已验证的事实与因果链。不要为了修改而修改。' }),
  a({ category: 'editor_discipline', title: '保护钩子', priority: 90,
    targetAgents: ['editor'],
    outputKey: 'EDITOR_DISCIPLINE_PLAYBOOK',
    content: '不得削弱已有强钩子，除非替换为更强钩子。不得改动章号与章名，除非明确要求。' }),
  a({ category: 'editor_discipline', title: '主动提升画面感', priority: 80,
    targetAgents: ['editor'],
    outputKey: 'EDITOR_DISCIPLINE_PLAYBOOK',
    content: '找到最平淡的2-3段，用更有画面感/感官更丰富的方式重新表达。检查关键对话是否有"潜台词"层次。' }),
  a({ category: 'editor_discipline', title: '情绪弧线与展示', priority: 75,
    targetAgents: ['editor'],
    outputKey: 'EDITOR_DISCIPLINE_PLAYBOOK',
    content: '确保章内有情绪弧线——从A情绪到B情绪，而非情绪平坦。如果正文中有"告诉"而非"展示"的段落，改为展示。' }),
];

// ── REVIEWER_RUBRIC_PLAYBOOK（评审标尺）— 1 atom ──
const REVIEWER_RUBRIC_ATOMS: RuleAtom[] = [
  a({ category: 'reviewer_rubric', title: '评审打分标尺', priority: 95,
    targetAgents: ['reviewer'],
    outputKey: 'REVIEWER_RUBRIC_PLAYBOOK',
    content: '评审打分标尺（0-10）：\n9-10：强烈追更欲，几乎无缺陷。\n7-8：可追更，有少量可修复缺陷。\n5-6：可读但平庸，影响留存。\n0-4：重大缺陷，建议重修。' }),
];

// ── CONTINUITY_BASELINE_PLAYBOOK（连续性底线）— 5 atoms ──
const CONTINUITY_BASELINE_ATOMS: RuleAtom[] = [
  a({ category: 'continuity_baseline', title: '角色姓名一致', priority: 100,
    targetAgents: ['reviewer', 'editor'],
    outputKey: 'CONTINUITY_BASELINE_PLAYBOOK',
    content: '角色姓名、称呼必须与已有记录一致。' }),
  a({ category: 'continuity_baseline', title: '死亡角色规则', priority: 100,
    targetAgents: ['creative-writer', 'reviewer', 'editor'],
    outputKey: 'CONTINUITY_BASELINE_PLAYBOOK',
    content: '已死亡/退场角色不得现身参与当前动作线。' }),
  a({ category: 'continuity_baseline', title: '休眠角色规则', priority: 95,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CONTINUITY_BASELINE_PLAYBOOK',
    content: '休眠角色不得直接现身。"计划回归但未到章"的角色仅允许伏笔提及。' }),
  a({ category: 'continuity_baseline', title: '空间逻辑', priority: 90,
    targetAgents: ['creative-writer', 'reviewer'],
    outputKey: 'CONTINUITY_BASELINE_PLAYBOOK',
    content: '不得产生不可能的空间位移或战力跳级。' }),
];

// ── THREAD_AWARENESS_PLAYBOOK（伏线意识）— 4 atoms ──
const THREAD_AWARENESS_ATOMS: RuleAtom[] = [
  a({ category: 'thread_awareness', title: '控制开坑', priority: 90,
    targetAgents: ['creative-writer', 'intent', 'scene-planner'],
    outputKey: 'THREAD_AWARENESS_PLAYBOOK',
    content: '不要为了"制造悬念"而无节制开新坑。新伏线必须服务当前冲突。' }),
  a({ category: 'thread_awareness', title: '逾期伏线', priority: 95,
    targetAgents: ['creative-writer', 'intent', 'scene-planner'],
    outputKey: 'THREAD_AWARENESS_PLAYBOOK',
    content: '对逾期伏线优先推进或回收。' }),
  a({ category: 'thread_awareness', title: '兑现铺垫', priority: 85,
    targetAgents: ['creative-writer', 'intent'],
    outputKey: 'THREAD_AWARENESS_PLAYBOOK',
    content: '回收伏线时必须兑现前置铺垫，不得硬回收。' }),
];

/** 全部系统默认 RuleAtom */
export const DEFAULT_SYSTEM_ATOMS: RuleAtom[] = [
  ...PROSE_CRAFT_ATOMS, ...WRITING_SOUL_ATOMS, ...CHARACTER_ARC_ATOMS,
  ...EDITOR_DISCIPLINE_ATOMS, ...REVIEWER_RUBRIC_ATOMS,
  ...CONTINUITY_BASELINE_ATOMS, ...THREAD_AWARENESS_ATOMS,
];

/** 合并默认 atoms 和题材 atoms：同 id 覆盖，不同 id 追加 */
export function mergeRuleAtoms(base: RuleAtom[], overrides: RuleAtom[]): RuleAtom[] {
  const map = new Map(base.map((a) => [a.id, a]));
  for (const atom of overrides) map.set(atom.id, atom);
  return [...map.values()];
}

/** 为 AI 生成的 playbook 文本按段落解析为 RuleAtom[] */
export function parsePlaybookTextToAtoms(
  text: string, category: RuleAtom['category'], outputKey: string,
  targetAgents: string[], source: RuleAtom['source'] = 'genre',
): RuleAtom[] {
  const normalizeTitle = (raw: string): string => raw
    .replace(/^[零一二三四五六七八九十百千万两\d]+[、.．:：)）]\s*/, '')
    .replace(/^[（(][零一二三四五六七八九十百千万两\d]+[)）]\s*/, '')
    .replace(/^第[零一二三四五六七八九十百千万两\d]+[条章节部分]\s*/, '')
    .trim();
  const sections = text.split(/(?=【[^】]+】|\n\d+[)）]\s)/).filter((s) => s.trim());
  let priority = 95;
  return sections.map((section) => {
    const titleMatch = section.match(/^【([^】]+)】/) || section.match(/^\d+[)）]\s*(.+?)[:：\n]/);
    const rawTitle = titleMatch?.[1]?.trim() ?? section.slice(0, 20).trim();
    const title = normalizeTitle(rawTitle) || rawTitle;
    const content = section.replace(/^【[^】]+】\n?/, '').replace(/^\d+[)）]\s*.+?[:：\n]/, '').trim();
    const atom = a({ category, title, content: content || section.trim(), priority, targetAgents, outputKey, source });
    priority = Math.max(priority - 5, 30);
    return atom;
  });
}
