/**
 * 视觉资产设计师 — 为全剧设计角色视觉身份（锁脸+配音）、场景位置、整体视觉风格。
 * 产出：CharacterIdentity[] + SceneLocation[] + VisualStyleGuide
 */
import { Injectable } from '@nestjs/common';
import { LlmService } from '../../novel/llm/llm.service';
import { z } from 'zod';
import {
  characterIdentitySchema, sceneLocationSchema, visualStyleGuideSchema,
  DramaSeed, SeriesOutline,
} from '../schemas/drama-state.schemas';

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
      systemPrompt: `你是一位短剧视觉总监，专精角色设计、场景美术和影像风格。你的任务是为整部短剧建立视觉资产系统——每个角色的面部、体型、标志性特征在全剧中保持一致。

=== 角色视觉设计原则 ===
1. 面部描述（faceDescription）= 角色的"锁脸模板"，全剧恒定不变，必须足够具体以让AI生图保持一致
   - 包含：面型、眼型、鼻型、唇型、肤色、标志性特征
   - 示例："鹅蛋脸，双眼皮大眼（瞳色深棕），挺直鼻梁，饱满唇形（淡粉色），肤色白皙偏冷白调，左眼角有一颗小痣"
2. faceReferencePrompt = 英文T2I提示词，精确对应中文面部描述
3. voiceProfile = TTS配音参考：音色(timbre)、语速(speed)、说话风格(speakingStyle)、口癖(catchphrase)
   - 说话风格要和角色性格匹配：霸总→"简短有力，不解释"，白莲花→"柔声细语暗藏锋芒"
4. defaultCostume = 默认服饰（后续每集可覆盖）
5. 短剧角色不超过6个主要角色（protagonist + antagonist + 3-4 supporting）

=== 场景设计原则 ===
1. 高频场景标记 isRecurring=true（如：主角家、公司、咖啡厅）
2. visualPrompt = 英文场景T2I提示词，含风格/光影/色调
3. ambientSoundDefault = 默认环境音（后续音频导演可覆盖）
4. keyProps = 标志性道具，帮助观众快速识别场景

=== 视觉风格指南 ===
1. overallAesthetic = 整体美学（如"电影质感偏暖""韩剧唯美滤镜""高饱和度网感"）
2. colorGrading = 调色风格（如"暖金调、高对比""冷青调、低饱和"）
3. lightingStyle = 光影风格（如"柔光为主，逆光用于情绪高潮""硬光强阴影"）

所有中文描述使用简体中文。faceReferencePrompt 和 visualPrompt 使用英文。`,

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
2. 每个角色必须有完整的 faceDescription + faceReferencePrompt + voiceProfile
3. locations 至少包含5个核心场景，高频场景标记 isRecurring=true
4. visualStyle 定义全剧美学基调
5. characterId 使用角色名的拼音缩写（如"陆子轩"→"lzx"，"林婉清"→"lwq"）
6. locationId 使用场景的简写（如"ceo_office""home_protagonist"）`,
      temperature: 0.5,
    });

    return designerOutputSchema.parse(raw);
  }
}
