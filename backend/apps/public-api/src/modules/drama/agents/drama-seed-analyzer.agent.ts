/**
 * 短剧种子分析 — 从用户创意中提取短剧种子 + 全剧策略方向。
 * 与小说 SeedAnalyzer 的核心差异：聚焦视觉冲突、打脸节奏、付费卡点、情绪密度。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { dramaSeedSchema, DramaSeed } from '../schemas/drama-state.schemas';

export interface DramaSeedInput {
  mainIdea: string;
  genre: string;
  targetAudience: string;
  protagonistFocus?: 'female_lead' | 'male_lead' | 'dual_lead' | 'ensemble';
  tonePreference?: string;
  audienceTags?: string[];
  titleHint?: string;
  mainStoryGoal?: string;
  targetEpisodeDurationSec?: number;
  plannedTotalEpisodes?: { min: number; max: number };
}

const seedOutputSchema = z.object({ seed: dramaSeedSchema });
type DramaSeedOutput = z.infer<typeof seedOutputSchema>;

@Injectable()
export class DramaSeedAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(input: DramaSeedInput): Promise<DramaSeedOutput> {
    const epMin = input.plannedTotalEpisodes?.min ?? 60;
    const epMax = input.plannedTotalEpisodes?.max ?? 100;
    const durSec = input.targetEpisodeDurationSec ?? 180;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-seed-analyzer',
      schema: seedOutputSchema,
      systemPrompt: `你是一位顶尖短剧编剧策划师，专精竖屏微短剧（2-6分钟/集）。你的目标是从用户创意中提炼出一个让观众"前3集上头、第10集付费、追完全剧"的短剧种子。

=== 短剧铁律 ===
- 总集数 ${epMin}-${epMax} 集，每集约 ${durSec} 秒（${Math.round(durSec / 60)} 分钟）
- 前3集 = 生死线，必须在第1集前15秒抓住观众（强冲突开场，禁止慢热铺垫）
- 每集必须有至少1个"爽点"或"反转"或"悬念钩子"
- 台词 > 动作 > 旁白，禁止大段心理描写（观众看不到你的内心戏）
- 核心矛盾必须清晰、极端、容易共情（如：被抛弃的前妻其实是隐藏富豪）

=== 短剧核心循环 ===
短剧的"核心循环"不同于网文，节奏必须更快更密：
- 霸总类：误解→被虐→身份揭露→打脸反转→更大的误解…（每3-5集一个小循环）
- 战神类：被轻视→展露实力→震惊全场→更强的敌人出现…
- 穿越类：现代知识碾压→被怀疑→化险为夷→更大的危机…
- 复仇类：发现真相碎片→布局→反击→对手更深的阴谋…
- 甜宠类：误会→接近→心动→阻碍→更甜的互动…
- 重生类：利用前世记忆→改变命运→蝴蝶效应→新的危机…
- 核心循环的关键：每3-5集完成一个小循环，每循环结尾必须抬升stakes

=== 冲突设计原则 ===
- 反派必须明确（短剧没时间暗线反派）：是谁？为什么坏？和主角什么关系？
- 冲突要"可视化"——观众能用眼睛看到冲突（打耳光比心理博弈更直接）
- "打脸"是短剧第一生产力：被欺负者反杀，越狠越爽
- 核心爽点类型（catharsisType）明确定义：打脸逆袭/真相揭露/身份反转/甜蜜暴击/复仇成功

=== 付费设计 ===
- 前3-8集免费：快速建立人物+核心冲突+第一个小高潮
- 第8-15集设置第一个付费卡点：必须是"最不能停下来"的悬念位置
- catharsisType 决定付费卡点的设计：身份揭露型→卡在"即将揭露"的前一秒

=== 角色设计原则 ===
- 主角：代入感强，有明确的冤屈/不公/困境，性格特征用行为展示（不是旁白告诉你）
- 反派：动机清晰，最好和主角有私人纠葛（前夫/继母/商业对手）
- 配角：精简！短剧最多4-5个有名字的角色，多了观众记不住
- 角色名字要简短好记，适合对话中反复出现

所有输出简体中文。`,

      userPrompt: `请分析这个创意并生成短剧种子：

核心创意：${input.mainIdea}
题材：${input.genre}
目标观众：${input.targetAudience}
${input.protagonistFocus ? `叙事聚焦：${input.protagonistFocus}` : ''}
${input.tonePreference ? `调性偏好：${input.tonePreference}` : ''}
${input.audienceTags?.length ? `受众标签：${input.audienceTags.join('、')}` : ''}
${input.titleHint ? `剧名灵感：${input.titleHint}` : ''}
${input.mainStoryGoal ? `主线目标：${input.mainStoryGoal}` : ''}
规模：每集约 ${durSec} 秒，计划 ${epMin}-${epMax} 集

要求：
1. seed.title — 短促有力的剧名（2-6个字最佳，如"闪婚后，陆总每天求复合"）
2. seed.logline — 一句话梗概，必须有冲突张力和身份反差
3. seed.protagonistConcept — 简短但有代入感，fatalFlaw 是驱动冲突的关键
4. seed.antagonistConcept — 必须填写，明确反派身份和动机
5. seed.coreConflict — 核心矛盾必须可视化（观众能直接看到的冲突）
6. seed.catharsisType — 明确本剧的核心爽点类型
7. seed.redLines — 3-5条底线（如：不能出现低俗色情、不能虐主角超过3集不反击）
8. seed.targetEpisodeDurationSec = ${durSec}
9. seed.plannedTotalEpisodes = { min: ${epMin}, max: ${epMax} }`,
      temperature: 0.6,
    });

    return this.normalize(raw as Record<string, unknown>, input);
  }

  private normalize(raw: Record<string, unknown>, input: DramaSeedInput): DramaSeedOutput {
    const root = typeof raw === 'object' && raw ? raw : {};
    const seedRaw = (typeof root.seed === 'object' && root.seed ? root.seed : root) as Record<string, unknown>;
    const protag = this.obj(seedRaw.protagonistConcept);
    const antag = this.obj(seedRaw.antagonistConcept);

    const normalized = {
      seed: {
        title: this.str(seedRaw.title) || input.titleHint || '未命名短剧',
        genre: this.str(seedRaw.genre) || input.genre,
        targetAudience: this.str(seedRaw.targetAudience) || input.targetAudience,
        logline: this.str(seedRaw.logline) || input.mainIdea,
        protagonistConcept: {
          name: this.str(protag.name) || '未命名',
          situation: this.str(protag.situation) || input.mainIdea.slice(0, 80),
          coreDesire: this.str(protag.coreDesire) || '逆转命运',
          personality: this.str(protag.personality) || '隐忍但倔强',
          fatalFlaw: this.str(protag.fatalFlaw) || '',
        },
        antagonistConcept: Object.keys(antag).length > 0 ? {
          name: this.str(antag.name) || '反派',
          motivation: this.str(antag.motivation) || '维护既得利益',
          relationship: this.str(antag.relationship) || '与主角有直接利益冲突',
        } : undefined,
        tone: this.str(seedRaw.tone) || input.tonePreference || '紧张、反转、爽快',
        coreConflict: this.str(seedRaw.coreConflict) || input.mainStoryGoal || '在不公命运中绝地反击',
        catharsisType: this.str(seedRaw.catharsisType) || '打脸逆袭',
        redLines: this.strArr(seedRaw.redLines, ['禁止低俗色情', '禁止虐主超过3集不反击', '禁止逻辑硬伤']),
        targetEpisodeDurationSec: input.targetEpisodeDurationSec ?? 180,
        plannedTotalEpisodes: {
          min: input.plannedTotalEpisodes?.min ?? 60,
          max: input.plannedTotalEpisodes?.max ?? 100,
        },
      },
    };
    return seedOutputSchema.parse(normalized);
  }

  private obj(v: unknown): Record<string, unknown> { return typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}; }
  private str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
  private strArr(v: unknown, fb: string[]): string[] {
    if (Array.isArray(v)) { const a = v.map(x => this.str(x)).filter(Boolean); return a.length ? a : fb; }
    return fb;
  }
}
