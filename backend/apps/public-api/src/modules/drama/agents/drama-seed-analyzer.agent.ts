/**
 * 短剧种子分析 — 从用户创意中提取短剧种子 + 全剧策略方向。
 * 与小说 SeedAnalyzer 的核心差异：聚焦视觉冲突、打脸节奏、付费卡点、情绪密度。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import { dramaSeedSchema, DramaSeed } from '../schemas/drama-state.schemas';
import { buildSeedAnalyzerSystemPrompt } from '../prompting/drama-playbook';
import { DramaSeedHints } from '../entities/drama-genre-template.entity';

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
  seedHints?: DramaSeedHints; // 来自题材模板的定制提示
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
      systemPrompt: buildSeedAnalyzerSystemPrompt({ epMin, epMax, durSec }),

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
