/**
 * 短剧种子分析 — 从用户创意中提取短剧种子 + 全剧策略方向。
 * 与小说 SeedAnalyzer 的核心差异：聚焦视觉冲突、打脸节奏、付费卡点、情绪密度。
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../../novel/llm/llm.service';
import { z } from 'zod';
import { dramaSeedSchema, DramaSeed } from '../../schemas/drama-state.schemas';
import { buildSeedAnalyzerSystemPrompt } from '../../prompting/drama-playbook';
import { DramaSeedHints, GenreProductionGuidance } from '../../entities/drama-genre-template.entity';

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
  seedHints?: DramaSeedHints;
  /** 来自题材模板的生产引导数据，用于精确化 system prompt */
  genreGuidance?: GenreProductionGuidance;
  dramaId?: string;
  userId?: string;
}

const seedOutputSchema = z.object({ seed: dramaSeedSchema });
type DramaSeedOutput = z.infer<typeof seedOutputSchema>;

@Injectable()
export class DramaSeedAnalyzerAgent {
  constructor(private readonly llm: LlmService) {}

  async analyze(input: DramaSeedInput, additionalSystemPrompt?: string): Promise<DramaSeedOutput> {
    const epMin = input.plannedTotalEpisodes?.min ?? 60;
    const epMax = input.plannedTotalEpisodes?.max ?? 100;
    const durSec = input.targetEpisodeDurationSec ?? 180;

    const hintBlock = this.buildSeedHintBlock(input.seedHints);

    let sysPrompt = buildSeedAnalyzerSystemPrompt({ epMin, epMax, durSec, genre: input.genre, genreGuidance: input.genreGuidance });
    if (additionalSystemPrompt?.trim()) sysPrompt += `\n\n=== 补充指令 ===\n${additionalSystemPrompt.trim()}`;

    const raw = await this.llm.generateStructured({
      taskName: 'drama-seed-analyzer',
      schema: seedOutputSchema,
      systemPrompt: sysPrompt,
      metadata: { dramaId: input.dramaId, userId: input.userId },
      userPrompt: `请分析这个创意并生成短剧种子：

核心创意：${input.mainIdea}
题材：${input.genre}
目标观众：${input.targetAudience}
${input.protagonistFocus ? `叙事聚焦：${input.protagonistFocus}` : ''}
${input.tonePreference ? `调性偏好：${input.tonePreference}` : ''}
${input.audienceTags?.length ? `受众标签：${input.audienceTags.join('、')}` : ''}
${input.titleHint ? `剧名灵感：${input.titleHint}` : ''}
${input.mainStoryGoal ? `主线目标：${input.mainStoryGoal}` : ''}
${hintBlock}
规模：每集约 ${durSec} 秒，计划 ${epMin}-${epMax} 集

要求：
1. seed.title — 短促有力的剧名（2-8字，根据题材调整风格）
2. seed.logline — 一句话梗概，必须有冲突张力
3. seed.protagonistConcept — 简短但有代入感，fatalFlaw 是驱动冲突的关键
4. seed.antagonistConcept — 根据题材决定：商业剧必须有明确反派，传记/历史/神话可用"命运对手"
5. seed.coreConflict — 核心矛盾（对于传记/历史题材可以是"人物与命运/时代的抗争"）
6. seed.catharsisType — 明确本剧核心体验类型
7. seed.redLines — 3-5条底线
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
        redLines: this.strArr(seedRaw.redLines, ['禁止低俗色情', '禁止逻辑硬伤', '禁止角色智商下线']),
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

  private buildSeedHintBlock(hints?: DramaSeedHints): string {
    if (!hints) return '';
    const lines: string[] = [];
    if (hints.catharsisPresets?.length) lines.push(`模板爽点偏好：${hints.catharsisPresets.join('、')}`);
    if (hints.conflictPatterns?.length) lines.push(`模板冲突模式：${hints.conflictPatterns.join('、')}`);
    if (hints.paywallStrategyHints) lines.push(`模板卡点建议：${hints.paywallStrategyHints}`);
    if (hints.dialogueStyleHints) lines.push(`模板台词风格：${hints.dialogueStyleHints}`);
    return lines.length ? `\n模板提示：\n${lines.map(l => `- ${l}`).join('\n')}` : '';
  }
}
