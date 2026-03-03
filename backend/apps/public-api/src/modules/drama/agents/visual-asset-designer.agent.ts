/**
 * 视觉资产设计师 — 为全剧设计角色视觉身份（锁脸+配音）、场景位置、整体视觉风格。
 * 产出：CharacterIdentity[] + SceneLocation[] + VisualStyleGuide
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  characterIdentitySchema, characterVariationSchema, sceneLocationSchema, visualStyleGuideSchema,
  DramaSeed, SeriesOutline,
} from '../schemas/drama-state.schemas';
import { buildVisualAssetDesignerSystemPrompt } from '../prompting/drama-playbook';

const designerOutputSchema = z.object({
  characters: z.array(characterIdentitySchema),
  locations: z.array(sceneLocationSchema),
  visualStyle: visualStyleGuideSchema,
});

export type VisualAssetDesignOutput = z.infer<typeof designerOutputSchema>;

@Injectable()
export class VisualAssetDesignerAgent {
  constructor(private readonly llm: LlmService) {}

  async design(seed: DramaSeed, outline: SeriesOutline): Promise<VisualAssetDesignOutput> {
    const allCharNames = new Set<string>();
    outline.episodes.forEach(ep => ep.keyCharacterIds.forEach(c => allCharNames.add(c)));
    allCharNames.add(seed.protagonistConcept.name);
    if (seed.antagonistConcept?.name) allCharNames.add(seed.antagonistConcept.name);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-visual-asset-designer',
      schema: designerOutputSchema,
      systemPrompt: buildVisualAssetDesignerSystemPrompt(),

      userPrompt: `请为以下短剧设计全套视觉资产：

剧名：${seed.title}
题材：${seed.genre}
调性：${seed.tone}
主角：${seed.protagonistConcept.name}（${seed.protagonistConcept.personality}）— ${seed.protagonistConcept.situation}
${seed.antagonistConcept ? `反派：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}` : ''}
涉及角色名单：${[...allCharNames].join('、')}
总集数：${outline.totalPlannedEpisodes}

要求：
1. characters 数组包含所有主要角色（按主角→反派→配角排序）
2. 每个角色必须有完整的 faceDescription + faceReferencePrompt + voiceProfile + variations
3. 主角至少2个variations（如"daily"日常+"formal"正式），配角至少1个
4. locations 至少包含5个核心场景，高频场景标记 isRecurring=true
5. visualStyle 定义全剧美学基调
6. characterId 使用角色名的拼音缩写（如"陆子轩"→"lzx"，"林婉清"→"lwq"）
7. locationId 使用场景的简写（如"ceo_office""home_protagonist"）`,
      temperature: 0.5,
    });

    return designerOutputSchema.parse(raw);
  }
}
