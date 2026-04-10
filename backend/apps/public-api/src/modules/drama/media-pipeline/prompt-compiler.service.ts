import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service';
import { z } from 'zod';

const compilerOutputSchema = z.object({
  compiledPrompt: z.string().describe('The final compiled T2I prompt'),
});

export type CompilerMode = 
  | 'CHARACTER_DOMINANT' 
  | 'ENVIRONMENT_DOMINANT' 
  | 'INSERT_PROP'
  | 'CHARACTER_REFERENCE'
  | 'SCENE_REFERENCE';

export interface CompilerInput {
  mode?: CompilerMode; // If not provided, inferred from shot context
  shotType?: string;
  shotSize?: string;
  cameraAngle?: string;
  
  // Payload for characters/scenes
  identity_frozen?: string;
  costume?: string;
  action_scene?: string; // e.g. firstFramePrompt
  environment?: string; // e.g. sceneVisualPrompt
  lighting?: string; // batchLighting
  atmosphere?: string;
  style?: string; // stylePrefix
  
  // For wide shots
  characters_brief?: string[];
  
  // For props
  object?: string;
  surface?: string;
  
  // For references
  face?: string;
  age?: string;
  hair?: string;
  body?: string;
  architecture?: string;
  color_tone?: string;
  view_angle?: string;
  
  word_budget?: number;
}

const SYSTEM_PROMPTS: Record<CompilerMode, string> = {
  CHARACTER_DOMINANT: `You are a T2I prompt compiler for cinematic portrait/dialogue shots.

COMPILATION RULES:
1. The IDENTITY_FROZEN block must appear VERBATIM in your output — do not rephrase, reorder, or omit any word
2. Weave ACTION into a natural sentence around the frozen identity (e.g., "..., raising his sword with righteous fury")
3. COSTUME goes right after identity
4. ENVIRONMENT appears as a brief subordinate clause ("in a stone-pillared courtyard" not a separate description)
5. LIGHTING as atmospheric modifier ("bathed in warm golden candlelight")
6. STYLE keywords at the end
7. Put the character's most important visual action in the first 20 words
8. Total output ≤ WORD_BUDGET words
9. Output ONLY the prompt string, no explanation, no JSON, no Chinese

ANTI-PATTERNS (NEVER do these):
- Rephrasing identity details (identity drift)
- Adding details not in the input ("scar on cheek", "tattoo")
- Camera/lens terminology ("85mm", "shallow DOF") — handled by downstream system
- Repeating the same concept twice even with different words`,

  ENVIRONMENT_DOMINANT: `You are a T2I prompt compiler for wide/establishing cinematic shots.

COMPILATION RULES:
1. ENVIRONMENT is the PRIMARY subject — it must occupy the first 25 words
2. Characters are TINY in frame — describe them only as "small distant figures" with their costume color/type
3. NEVER include face descriptions, hair details, or close-up features — they are invisible at this scale
4. ACTION should describe spatial relationships ("facing each other across the courtyard")
5. ATMOSPHERE and LIGHTING create the emotional tone — integrate naturally
6. Emphasize SCALE words: vast, towering, sprawling, massive, endless
7. Total output ≤ WORD_BUDGET words
8. Output ONLY the prompt string

ANTI-PATTERNS:
- Any face/hair/expression details (invisible at wide shot scale)
- "looking at camera" (characters are dots in the frame)
- Close-up language ("sharp jawline", "clear iris detail")`,

  INSERT_PROP: `You are a T2I prompt compiler for product/prop close-up shots.

COMPILATION RULES:
1. OBJECT material and texture must be the first 15 words — this is a MACRO shot
2. Describe surface qualities: translucency, reflections, scratches, patina, grain
3. SURFACE/background is always blurred or simplified — mention briefly
4. LIGHTING describes the light setup (direction, quality, shadows)
5. Include "no people, no hands" at the end
6. Use product photography language: "isolated", "centered composition", "material detail"
7. Total output ≤ WORD_BUDGET words
8. Output ONLY the prompt string

ANTI-PATTERNS:
- Any human features or body parts
- Environmental storytelling (this is an object, not a scene)
- Emotional language ("dramatic", "intense")`,

  CHARACTER_REFERENCE: `You are a T2I prompt compiler for character reference sheet portraits.

This is a DEFINITIVE portrait — the generated image will be used as identity anchor for ALL subsequent shots.
Therefore FACE ACCURACY is the #1 priority.

COMPILATION RULES:
1. FACE description must appear EXACTLY as given in the first 20 words — this is the identity anchor
2. AGE integrates naturally ("a middle-aged Tang dynasty emperor")
3. HAIR and COSTUME follow face, creating a complete top-to-bottom description
4. BODY type as brief modifier
5. MUST end with "front-facing, looking at camera, neutral plain background, character reference sheet"
6. Use portrait photography language: "sharp focus on face", "even studio lighting"
7. Do NOT add any environment, weather, or narrative elements
8. Total output ≤ WORD_BUDGET words
9. Output ONLY the prompt string

QUALITY ANCHORS (must include):
- "eyes sharply in focus, clear iris detail"
- "realistic skin texture with visible pores"
- "neutral plain background"`,

  SCENE_REFERENCE: `You are a T2I prompt compiler for architectural/environment reference images.

This image defines the CANONICAL look of a location — all future shots in this location use it as reference.

COMPILATION RULES:
1. ARCHITECTURE structural elements in the first 20 words — materials, dimensions, geometry
2. LIGHTING establishes the default atmosphere of this space
3. For "establishing": emphasize SCALE and DEPTH ("deep perspective", "vanishing point", "layered depth")
4. For "interior_medium": emphasize the CENTRAL FEATURE of the space
5. For "detail_close": emphasize TEXTURES and MATERIALS ("wood grain", "stone patina", "metallic sheen")
6. MUST include "absolutely no people, empty environment, uninhabited space"
7. Use architectural photography language: "leading lines", "symmetrical composition", "structural perspective"
8. Total output ≤ WORD_BUDGET words
9. Output ONLY the prompt string

ANTI-PATTERNS:
- Any people, characters, figures, silhouettes
- Narrative elements ("where the emperor holds court")
- Furniture that implies human presence ("a chair waiting", "a set table")`
};

const FEW_SHOTS: Record<CompilerMode, string> = {
  CHARACTER_DOMINANT: `INPUT:
IDENTITY_FROZEN: "young Chinese noblewoman, delicate oval face, bright almond eyes, serene expression"
COSTUME: "flowing white silk hanfu with silver cloud embroidery"
ACTION: "turns her head sharply as she hears a scream from behind the door"
ENVIRONMENT: "dimly lit bedchamber with red silk curtains"
LIGHTING: "single candle flame casting dancing shadows"
WORD_BUDGET: 70

OUTPUT:
Young Chinese noblewoman, delicate oval face, bright almond eyes, serene expression, turning sharply with startled expression hearing a scream, wearing flowing white silk hanfu with silver cloud embroidery, in a dimly lit bedchamber with red curtains, single candle flame casting dancing shadows on her face, cinematic period drama photography, photorealistic`,

  ENVIRONMENT_DOMINANT: `INPUT:
CHARACTERS_BRIEF: ["figure in black leather armor"]
ACTION: "a lone warrior walks toward a burning city gate"
ENVIRONMENT: "massive ancient Chinese city wall, 20-meter tall weathered grey brick, heavy iron-studded gates engulfed in flames"
LIGHTING: "fire glow illuminating the night sky, embers floating upward"
WORD_BUDGET: 80

OUTPUT:
Massive ancient Chinese city wall stretching into darkness, 20-meter tall weathered grey brick wall with heavy iron gates engulfed in roaring flames, a small lone figure in black armor walking toward the inferno, fire glow painting the night sky orange, glowing embers floating upward into smoke, epic cinematic scale, photorealistic period drama`,

  INSERT_PROP: `INPUT:
OBJECT: "jade imperial seal with dragon carving, translucent green stone, golden base with intricate filigree"
SURFACE: "resting on a worn wooden desk with ink stains"
LIGHTING: "single warm spotlight from upper left, strong shadows"
STYLE: "cinematic macro photography, photorealistic"
WORD_BUDGET: 60

OUTPUT:
Translucent green jade imperial seal with intricate dragon carving and golden filigree base, resting on a worn wooden desk with ink stains, single warm studio spotlight from upper left creating strong shadows, cinematic macro detail, material texture, no people, no hands, photorealistic`,

  CHARACTER_REFERENCE: `INPUT:
FACE: "Tang dynasty emperor, commanding face, sharp jawline, intense gaze, front-facing, looking at camera"
AGE: "middle-aged, approximately 40 years old"
HAIR: "long black hair tied in traditional topknot with jade pin"
COSTUME: "imperial dragon robe with meticulous gold thread embroidery, broad shoulders"
BODY: "tall muscular build, broad chest"
STYLE_PREFIX: "cinematic Chinese period drama portrait, photorealistic, film grain"
WORD_BUDGET: 90

OUTPUT:
Middle-aged Tang dynasty emperor, commanding face, sharp jawline, intense gaze, eyes sharply in focus, clear iris detail, realistic skin texture with visible pores, long black hair tied in traditional topknot with jade pin, wearing imperial dragon robe with meticulous gold thread embroidery, tall muscular build, broad chest, cinematic Chinese period drama portrait, photorealistic, even studio lighting, fine film grain, front-facing, looking at camera, neutral plain background, character reference sheet`,

  SCENE_REFERENCE: `INPUT:
ARCHITECTURE: "Tang dynasty imperial palace courtyard, red-lacquered wooden columns, stone-paved floor, dougong bracket system under eaves"
LIGHTING: "warm morning sunlight filtering through lattice windows"
COLOR_TONE: "warm amber and deep red"
VIEW_ANGLE: "establishing"
STYLE_PREFIX: "cinematic Chinese period drama photography, photorealistic"
WORD_BUDGET: 80

OUTPUT:
Massive Tang dynasty imperial palace courtyard, deep perspective vanishing point, towering red-lacquered wooden columns, weathered stone-paved floor, intricate dougong bracket system under deep eaves, warm morning sunlight filtering through lattice windows, rich amber and deep red color tone, cinematic architectural perspective, photorealistic period drama, symmetrical composition, absolutely no people, empty environment, uninhabited space`
};

@Injectable()
export class PromptCompilerService {
  private readonly logger = new Logger(PromptCompilerService.name);

  constructor(private readonly llm: LlmService) {}

  public resolveMode(input: CompilerInput): CompilerMode {
    if (input.mode) return input.mode;
    
    // Asset modes based on shotType
    if (input.shotType === 'character') return 'CHARACTER_REFERENCE';
    if (input.shotType === 'location') return 'SCENE_REFERENCE';
    if (input.shotType === 'prop') return 'INSERT_PROP';
    
    // Frame generation modes based on shotSize and shotType
    if (input.shotType === 'insert') return 'INSERT_PROP';
    
    const isWide = ['wide', 'extreme_wide', 'medium_wide'].includes(input.shotSize || '') || input.cameraAngle === 'bird_eye';
    if (isWide || input.shotType === 'wide') return 'ENVIRONMENT_DOMINANT';
    
    return 'CHARACTER_DOMINANT';
  }

  public async compile(input: CompilerInput): Promise<string> {
    const mode = this.resolveMode(input);
    const systemPrompt = SYSTEM_PROMPTS[mode];
    const fewShot = FEW_SHOTS[mode];
    const userPrompt = this.formatInput(input);
    const frozenTokens = this.extractFrozenTokens(input, mode);
    
    try {
      const response = await this.llm.generateStructured({
        taskName: `prompt-compiler-${mode.toLowerCase()}`,
        schema: compilerOutputSchema,
        systemPrompt: `${systemPrompt}\n\nEXAMPLE:\n${fewShot}`,
        userPrompt: `INPUT:\n${userPrompt}\n\nOUTPUT:`,
        temperature: 0.2, // Low temperature for high determinism
      });
      
      const compiledTxt = response.compiledPrompt.trim();
      
      if (!compiledTxt) {
        throw new Error('LLM returned empty compiled prompt');
      }
      
      // Post-validation: ensure frozen tokens are fully preserved
      const validationPassed = this.validateFrozenTokens(compiledTxt, frozenTokens);
      if (!validationPassed) {
        this.logger.warn(`[PromptCompiler] Identity drift detected in mode ${mode}. Rolling back to fallback assembly.`);
        return this.buildFallback(input, mode);
      }
      
      return compiledTxt;
    } catch (e) {
      const err = e as Error;
      this.logger.error(`Prompt compilation failed: ${err.message}`.substring(0, 200), err.stack);
      return this.buildFallback(input, mode);
    }
  }

  private formatInput(input: CompilerInput): string {
    const lines: string[] = [];
    if (input.identity_frozen) lines.push(`IDENTITY_FROZEN: "${input.identity_frozen}"`);
    if (input.face) lines.push(`FACE: "${input.face}"`);
    if (input.age) lines.push(`AGE: "${input.age}"`);
    if (input.hair) lines.push(`HAIR: "${input.hair}"`);
    if (input.body) lines.push(`BODY: "${input.body}"`);
    if (input.costume) lines.push(`COSTUME: "${input.costume}"`);
    if (input.characters_brief?.length) lines.push(`CHARACTERS_BRIEF: ${JSON.stringify(input.characters_brief)}`);
    if (input.action_scene) lines.push(`ACTION: "${input.action_scene}"`);
    if (input.environment) lines.push(`ENVIRONMENT: "${input.environment}"`);
    if (input.architecture) lines.push(`ARCHITECTURE: "${input.architecture}"`);
    if (input.color_tone) lines.push(`COLOR_TONE: "${input.color_tone}"`);
    if (input.object) lines.push(`OBJECT: "${input.object}"`);
    if (input.surface) lines.push(`SURFACE: "${input.surface}"`);
    if (input.lighting) lines.push(`LIGHTING: "${input.lighting}"`);
    if (input.atmosphere) lines.push(`ATMOSPHERE: "${input.atmosphere}"`);
    if (input.view_angle) lines.push(`VIEW_ANGLE: "${input.view_angle}"`);
    if (input.style) lines.push(`STYLE: "${input.style}"`);

    // 动态 WORD_BUDGET：IDENTITY_FROZEN 块可能超过 150 词（含面部、发型、服装描述），
    // 固定 80 词预算会导致编译器在"保留完整 identity"和"遵守预算"之间矛盾。
    // 计算方式：identity 词数 + 50 词余量(用于环境/光影/风格)，最低保底 80 词。
    const identityWords = (input.identity_frozen ?? '').split(/\s+/).filter(Boolean).length;
    const faceWords = (input.face ?? '').split(/\s+/).filter(Boolean).length;
    const frozenWords = Math.max(identityWords, faceWords);
    const dynamicBudget = Math.max(80, frozenWords + 50);
    lines.push(`WORD_BUDGET: ${input.word_budget || dynamicBudget}`);
    return lines.join('\n');
  }

  private extractFrozenTokens(input: CompilerInput, mode: CompilerMode): string[] {
    const tokens: string[] = [];
    if (mode === 'CHARACTER_DOMINANT' && input.identity_frozen) {
      tokens.push(input.identity_frozen);
    } else if (mode === 'CHARACTER_REFERENCE' && input.face) {
      tokens.push(input.face);
    }
    // Convert to lowercase array of words/short phrases to allow minor spacing differences
    // For extreme strictness we can just require the exact substring
    return tokens.filter(t => t.trim().length > 0);
  }

  private validateFrozenTokens(result: string, frozenTokens: string[]): boolean {
    const resultLower = result.toLowerCase().replace(/\s+/g, ' ');
    for (const token of frozenTokens) {
      const cleanToken = token.toLowerCase().replace(/\s+/g, ' ');
      // Allow minor omissions like punctuation differences
      const alphanumericToken = cleanToken.replace(/[^a-z0-9]/g, '');
      const alphanumericResult = resultLower.replace(/[^a-z0-9]/g, '');
      
      if (!alphanumericResult.includes(alphanumericToken)) {
        return false; // Identity drift detected
      }
    }
    return true;
  }

  /** Fallback: if LLM fails or hallucinates, just concatenate carefully */
  private buildFallback(input: CompilerInput, mode: CompilerMode): string {
    let parts: (string | undefined)[] = [];
    switch (mode) {
      case 'CHARACTER_DOMINANT':
        parts = [input.identity_frozen, input.costume, input.action_scene, input.environment, input.lighting, input.atmosphere, input.style];
        break;
      case 'ENVIRONMENT_DOMINANT':
        parts = [input.environment, input.action_scene, input.characters_brief?.join(' and '), input.lighting, input.atmosphere, input.style];
        break;
      case 'INSERT_PROP':
        parts = [input.object, input.surface, input.lighting, 'no people, no hands', input.style];
        break;
      case 'CHARACTER_REFERENCE':
        parts = [input.age, input.face, input.hair, input.costume, input.body, 'front-facing, looking at camera, neutral plain background, character reference sheet', input.style];
        break;
      case 'SCENE_REFERENCE':
        parts = [input.view_angle, input.architecture, input.lighting, input.color_tone, 'absolutely no people, empty environment', input.style];
        break;
    }
    return parts.filter(Boolean).join(', ').replace(/,\s*,/g, ',').replace(/^,\s*/, '').trim();
  }
}
