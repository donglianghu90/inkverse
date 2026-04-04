/**
 * DramaIdeaService — 创意辅助（增强创意、推荐题材/受众、生成故事目标）。
 * 从 DramaService 提取，仅依赖 LlmService，完全解耦。
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service';
import { DramaIdeaPrompts, IDEA_GENRE_OPTS, IDEA_PLATFORM_OPTS, IDEA_AUDIENCE_OPTS, IDEA_FOCUS_OPTS, IDEA_VISUAL_STYLE_OPTS, IDEA_ASPECT_RATIO_OPTS } from './prompting/ideation/drama-idea.prompts';

@Injectable()
export class DramaIdeaService {
  constructor(private readonly llm: LlmService) {}

  async enhanceIdea(rawIdea: string, genre?: string, userId?: string) {
    const promptDef = DramaIdeaPrompts.enhanceIdea();
    return this.llm.generateStructured({
      taskName: 'drama-idea-enhancer',
      schema: z.object({ enhanced: z.string(), highlights: z.array(z.string()).min(2).max(5) }),
      tags: ['setup', 'drama-idea'],
      metadata: { userId },
      systemPrompt: promptDef.systemPrompt,
      userPrompt: promptDef.buildUserPrompt(rawIdea, genre),
      temperature: 0.75,
    });
  }

  async recommendGenreAndAudience(mainIdea: string, userId?: string) {
    const promptDef = DramaIdeaPrompts.recommendGenreAndAudience();
    return this.llm.generateStructured({
      taskName: 'drama-genre-audience-recommender',
      metadata: { userId },
      schema: z.object({
        genreDisplayName: z.enum(IDEA_GENRE_OPTS),
        platformTarget: z.enum(IDEA_PLATFORM_OPTS),
        targetAudience: z.enum(IDEA_AUDIENCE_OPTS),
        protagonistFocus: z.enum(IDEA_FOCUS_OPTS),
        suggestedVisualStyle: z.enum(IDEA_VISUAL_STYLE_OPTS),
        aspectRatio: z.enum(IDEA_ASPECT_RATIO_OPTS),
        targetEpisodeDurationSec: z.number().int(),
        plannedEpisodes: z.object({ min: z.number().int(), max: z.number().int() }),
        reason: z.string().optional().nullable(),
      }),
      tags: ['setup', 'drama-recommend'],
      systemPrompt: promptDef.systemPrompt,
      userPrompt: promptDef.buildUserPrompt(mainIdea),
      temperature: 0.3,
    });
  }

  async generateStoryGoal(input: { mainIdea: string; genre: string; targetAudience: string }, userId?: string) {
    const promptDef = DramaIdeaPrompts.generateStoryGoal();
    return this.llm.generateStructured({
      taskName: 'drama-goal-generator',
      schema: z.object({ goal: z.string(), alternatives: z.array(z.string()).min(2).max(3) }),
      tags: ['setup', 'drama-goal'],
      metadata: { userId },
      systemPrompt: promptDef.systemPrompt,
      userPrompt: promptDef.buildUserPrompt(input),
      temperature: 0.8,
    });
  }
}

