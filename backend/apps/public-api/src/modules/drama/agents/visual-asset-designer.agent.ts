/**
 * 视觉资产设计师 — 为全剧设计角色视觉身份（锁脸+配音）、场景位置、整体视觉风格。
 * 产出：CharacterIdentity[] + SceneLocation[] + VisualStyleGuide
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  characterIdentitySchema, characterVariationSchema, sceneLocationSchema, visualStyleGuideSchema,
  DramaSeed, SeriesOutline, ContentMode,
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

  async design(seed: DramaSeed, outline: SeriesOutline, visualStyleHint?: string, contentMode: ContentMode = 'drama'): Promise<VisualAssetDesignOutput> {
    const allCharNames = new Set<string>();
    outline.episodes.forEach(ep => ep.keyCharacterIds.forEach(c => allCharNames.add(c)));
    allCharNames.add(seed.protagonistConcept.name);
    if (seed.antagonistConcept?.name) allCharNames.add(seed.antagonistConcept.name);

    const raw = await this.llm.generateStructured({
      taskName: 'drama-visual-asset-designer',
      schema: designerOutputSchema,
      systemPrompt: buildVisualAssetDesignerSystemPrompt({ contentMode }),

      userPrompt: `请为以下${contentMode === 'knowledge' ? '知识类短视频' : '短剧'}设计全套视觉资产：

剧名：${seed.title}
题材：${seed.genre}
调性：${seed.tone}
主角：${seed.protagonistConcept.name}（${seed.protagonistConcept.personality}）— ${seed.protagonistConcept.situation}
${seed.antagonistConcept ? `${contentMode === 'knowledge' ? '命运对手' : '反派'}：${seed.antagonistConcept.name} — ${seed.antagonistConcept.motivation}` : ''}
涉及角色名单：${[...allCharNames].join('、')}
总集数：${outline.totalPlannedEpisodes}
${visualStyleHint ? `\n【用户指定视觉风格】：${visualStyleHint}
请确保 visualStyle 完全体现此风格（overallAesthetic/colorGrading/lightingStyle 均需贴合），角色 faceReferencePrompt 也须用符合该风格的英文描述。` : ''}

要求：
1. characters 数组包含所有主要角色（${contentMode === 'knowledge' ? '按主角→旁白者(narrator)→配角排序，必须包含一个 role=narrator 的旁白者角色' : '按主角→反派→配角排序'}）
2. 每个角色必须有完整的 faceDescription + faceReferencePrompt + voiceProfile + variations
3. 主角至少2个variations（${contentMode === 'knowledge' ? '如不同人生阶段"young"少年+"prime"壮年' : '如"daily"日常+"formal"正式'}），配角至少1个
4. locations 至少包含5个核心场景，高频场景标记 isRecurring=true
5. visualStyle 定义全剧美学基调
6. characterId 使用角色名的拼音缩写（如"李白"→"lb"，"杜甫"→"df"）
7. locationId 使用场景的简写（如"tavern""palace""study_room"）`,
      temperature: 0.5,
    });

    return designerOutputSchema.parse(raw);
  }
}
