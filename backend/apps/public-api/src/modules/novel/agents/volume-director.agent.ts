/** 大卷导演 — 根据全书预计总章数动态规划大卷跨度的宏观叙事弧，管理跨MiniArc的线索和角色成长。 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import {
  StoryState,
  VolumeArc,
  ForeshadowingDeposit,
  volumeArcSchema,
  foreshadowingDepositSchema,
} from '../schemas/novel-state.schemas';
import { buildCompactContext } from '../prompting/novel-playbook';

@Injectable()
export class VolumeDirectorAgent {
  constructor(private readonly llm: LlmService) {}

  /** 规划大卷 + 同时生成伏笔种子。返回 [卷, 伏笔种子列表]。 */
  async planVolumeWithForeshadowing(
    state: StoryState,
    additionalSystemPrompt?: string,
  ): Promise<{ volume: VolumeArc; deposits: ForeshadowingDeposit[] }> {
    const volume = await this.planVolume(state, additionalSystemPrompt);
    const deposits = await this.generateForeshadowingDeposits(state, volume);
    return { volume, deposits };
  }

  async planVolume(
    state: StoryState,
    additionalSystemPrompt?: string,
  ): Promise<VolumeArc> {
    const context = buildCompactContext(state, {
      maxCharacters: 15,
      maxChapterSummaries: 10,
      maxOpenThreads: 12,
    });

    const volumeNumber = (state.completedVolumes?.length ?? 0) + 1;
    const startChapter = state.chapterCursor;
    const completedArcsSummary = (state.completedArcs ?? [])
      .slice(-5)
      .map((a) => `[${a.arcTitle}](ch${a.startChapter}-${a.plannedEndChapter}): ${a.coreTension}`)
      .join('\n');

    const prevVolumeSummary = state.completedVolumes?.slice(-1).map((v) =>
      `上一卷「${v.title}」(ch${v.startChapter}-${v.estimatedEndChapter}): ${v.coreConflict}\n` +
      `  主角：${v.powerProgression.startLevel} → ${v.powerProgression.endLevel}\n` +
      `  主题：${v.thematicFocus}`,
    ).join('\n') || '（首卷）';

    const profile = state.bookPromptProfile;
    const openThreads = (state.plotThreadLedger ?? [])
      .filter((t) => t.status === 'open')
      .slice(0, 10)
      .map((t) => `${t.label}(自ch${t.setupChapter})`)
      .join('、');

    const nr = state.noveltyRegistry ?? { usedArcTypes: [], usedNarrativeTechniques: [], usedCooldownTags: [], usedClimaxPatterns: [], lastArcTypes: [] };
    const usedStructures = state.completedVolumes?.map((v) =>
      `第${v.volumeNumber}卷「${v.title}」：${v.structuralInnovation || '常规线性'}`,
    ).join('\n') || '（首卷）';
    const recentArcTypes = nr.lastArcTypes.length > 0 ? `最近卷类型：${nr.lastArcTypes.join('→')}（禁止连续重复）` : '';
    const usedClimax = nr.usedClimaxPatterns.length > 0 ? `已用高潮模式：${nr.usedClimaxPatterns.join('、')}（本卷须不同）` : '';

    const totalCh = state.roughOutline.estimatedTotalChapters;
    const remaining = Math.max(1, totalCh - startChapter + 1);
    const estVols = state.roughOutline.estimatedVolumes ?? Math.max(1, Math.round(Math.sqrt(totalCh / 25))); // AI设定优先，sqrt兜底
    const avgChPerVol = Math.round(totalCh / estVols);
    const minChPerVol = Math.max(10, Math.round(avgChPerVol * 0.7));
    const maxChPerVol = Math.min(remaining, Math.round(avgChPerVol * 1.3));
    const volRange = maxChPerVol > minChPerVol ? `${minChPerVol}-${maxChPerVol}` : `约${maxChPerVol}`;
    const minChPerArc = Math.max(3, Math.floor(minChPerVol / 6));
    const maxChPerArc = Math.max(minChPerArc + 2, Math.ceil(maxChPerVol / 3));

    return this.llm.generateStructured({
      taskName: 'volume-director',
      schema: volumeArcSchema,
      tags: ['workflow', 'volume', 'planning'],
      metadata: { bookId: state.bookId, volumeNumber },
      systemPrompt: `你是一位${profile.generatedForGenre}网文的宏观架构师，负责规划一个大卷（约${volRange}章，全书预计${totalCh}章）。

=== 大卷的作用 ===
大卷是小说最重要的节奏单元。一个好的大卷像一部独立电影：
- 有自己的核心矛盾（和上一卷不同）
- 有主角的清晰成长弧线（从A到B，不是原地踏步）
- 包含3-6个MiniArc（副本/政治/旅程等），有节奏起伏
- 卷末有标志性高潮（读者会记住的"名场面"）

=== 猫腻式卷结构精髓 ===
1. 开卷：看似平静的新环境，暗藏巨大的结构性矛盾
2. 中段：多条线交织推进，主角在挑战中成长但总差一口气
3. 转折：一个核心信息揭露改变所有人的立场
4. 高潮：积蓄已久的力量爆发，但代价不小
5. 收尾：看似解决但埋下更大伏笔，驱动下一卷

=== 天蚕土豆式卷结构精髓 ===
1. 新地图 + 新的实力阶梯 + 新的社交圈
2. 明确的升级目标 + 时间压力
3. 逐步揭示的更强对手
4. "打脸"高潮 + 更大世界的门打开

=== 新鲜感引擎（本卷核心创新要求）===
每一卷必须在叙事形式上有创新——读者读了几百章后，"新鲜感"比"套路"更重要。
可选叙事技法（至少选1种）：
- **双线叙事**：两条时间线或两个视角交替推进，在高潮交汇
- **悬疑揭露**：卷开头抛出一个谜，每个MiniArc揭示一层真相
- **倒叙高潮**：先展示高潮的震撼结果，再倒叙"怎么走到这一步"
- **群像接力**：不同MiniArc由不同配角视角驱动，拼出全景
- **瓶中剧**：限定空间/时间的高压叙事（如"三天内逃出封印"）
- **暗线反转**：本卷一条看似无关的暗线在卷末颠覆读者认知
- **缓急极端**：前半极度日常温馨 → 后半极度残酷（或反之），形成巨大反差
- **禁区探索**：触及本世界观的禁忌领域，重新定义读者对世界的认知
${recentArcTypes ? '\n' + recentArcTypes : ''}
${usedClimax ? usedClimax : ''}

structuralInnovation 字段必须一句话说清本卷的叙事创新。
narrativeExperiment 字段描述本卷在形式上的实验（不能为空）。

=== MiniArc槽位规划 ===
- 每卷3-6个MiniArc，每个${minChPerArc}-${maxChPerArc}章
- 第一个MiniArc必须建立新卷的基调和矛盾
- 中间MiniArc交替节奏（紧张→缓→更紧张）
- 最后一个MiniArc是卷高潮
- 至少有1个"过渡/日常"型MiniArc（读者休息+角色深化）
- MiniArc之间的arcType必须多样化，不可连续相同

=== 硬规则 ===
- volumeId 格式：vol_序号（如 vol_1）
- 估计章数${volRange}之间
- powerProgression 必须具体（不能是"变强了"）
- subPlots 至少包含1条main线+1条secondary线
- forbiddenElements 继承上一卷的已用梗（防重复）
- characterGoals 至少覆盖主角+1个重要配角
${additionalSystemPrompt ? '\n=== 作者补充指示 ===\n' + additionalSystemPrompt : ''}`,
      userPrompt: `故事上下文：
${JSON.stringify(context, null, 2)}

全书大纲方向：
${state.roughOutline.endingDirection}
预计总章数：${state.roughOutline.estimatedTotalChapters}

上一卷概况：
${prevVolumeSummary}

已用叙事结构（避免重复）：
${usedStructures}

近期完成MiniArc：
${completedArcsSummary || '（暂无）'}

当前活跃伏线：
${openThreads || '（暂无）'}

当前章节：${startChapter}
请规划第${volumeNumber}卷。volumeId=vol_${volumeNumber}，startChapter=${startChapter}。
重要：structuralInnovation和narrativeExperiment必须填写有意义的内容。`,
      temperature: 0.55,
    });
  }

  /** 基于卷规划生成前瞻式伏笔种子。 */
  private async generateForeshadowingDeposits(
    state: StoryState,
    volume: VolumeArc,
  ): Promise<ForeshadowingDeposit[]> {
    const schema = z.object({
      deposits: z.array(foreshadowingDepositSchema).min(3).max(12),
    });
    const volSpan = volume.estimatedEndChapter - volume.startChapter + 1;
    const minPayoffGap = Math.max(3, Math.round(volSpan * 0.15)); // 伏笔回收至少间隔卷跨度的15%

    const result = await this.llm.generateStructured({
      taskName: 'volume-foreshadowing',
      schema,
      tags: ['workflow', 'volume', 'foreshadowing'],
      metadata: { bookId: state.bookId, volumeNumber: volume.volumeNumber },
      systemPrompt: `你是一位伏笔大师。基于刚规划的大卷，为这个卷预埋5-10条前瞻式伏笔。

=== 伏笔设计原则 ===
1. 猫腻式：看似随意的一句话，数十章后读者恍然大悟。不动声色地在日常细节里藏炸弹。
2. 天蚕土豆式：明线伏笔——让读者隐约猜到但不确定，制造期待感。
3. 层次感：每卷至少包含3种不同category的伏笔，避免单一。
4. 可回收性：payoffDescription要具体，不能是"以后有用"。

=== 伏笔窗口规则 ===
- plantWindow: 在哪个章节范围内埋设（越早越好，给足发酵时间）
- payoffWindow: 在哪个章节范围内回收（至少间隔${minPayoffGap}章）
- must_plant：核心剧情必需，不埋会造成plot hole
- should_plant：大幅提升后续剧情冲击力
- nice_to_have：锦上添花，增加重读价值

=== embeddingGuidance ===
描述如何自然嵌入（不能让读者当场察觉是伏笔）：
- 好的："角色无意间注意到墙上一道奇怪的划痕"
- 坏的："这道划痕似乎意味着什么重大的秘密"（太明显）

depositId格式：fsd_vol${volume.volumeNumber}_序号`,
      userPrompt: `卷规划：
- 标题：${volume.title}
- 核心冲突：${volume.coreConflict}
- 章节范围：${volume.startChapter}-${volume.estimatedEndChapter}
- MiniArc：${volume.miniArcSlots.map((s) => `${s.arcType}(${s.estimatedChapters}ch): ${s.objective}`).join('\n  ')}
- 角色成长：${volume.characterGoals.map((g) => `${g.characterName}: ${g.volumeStartState} → ${g.volumeEndState}`).join('；')}
- 主题：${volume.thematicFocus}

请生成5-10条前瞻式伏笔。`,
      temperature: 0.6,
    });

    return result.deposits;
  }
}
