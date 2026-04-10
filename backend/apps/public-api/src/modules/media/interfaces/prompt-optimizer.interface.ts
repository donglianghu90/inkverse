/** Prompt 优化器 — 方法契约 */

export interface OptimizeResult {
  prompt: string;
  negativePrompt: string;
  metadata: { addedKeywords: string[]; removedKeywords: string[] };
}

export interface T2IOptimizeOptions {
  provider?: string;
  /**
   * 图像生成层 shotType，决定 negative prompt 选择：
   * - 'character' / 'first_frame' / 'last_frame' → CHARACTER_NEGATIVE_EXTRA
   * - 'location'                                  → LOCATION_NEGATIVE_EXTRA
   * - 'prop'                                      → PROP_NEGATIVE_EXTRA（产品摄影式无人排除）
   * - 'style_guide'                               → 无额外 negative
   */
  shotType?: string;
  /**
   * 剧本层 shotType（短剧分镜的戏剧功能）：
   * 'portrait' | 'dialogue' | 'action' | 'wide' | 'insert'
   * 与 shotSize 联合决定 GOLDEN_EXTRA 选择和景别提示词注入。
   */
  dramaShotType?: string;
  /**
   * 视觉风格桶，决定风格防漂移 negative prompt：
   * - 'two_d'        → 防止模型输出写实/3D 渲染风格
   * - 'three_d'      → 防止模型输出 2D 手绘/动漫风格
   * - 'stop_motion'  → 防止模型输出写实摄影/数字渲染风格
   * - 'live_action'  → 防止模型输出绘画/插图风格（已在 media-orchestrator 单独处理）
   * - 'generic'      → 不添加风格防漂移词
   */
  styleBucket?: string;
  qualityTier?: string;
  /** 景别（原 cameraAngle 中的景别部分），用于注入构图/裁切关键词 */
  shotSize?: string;
  /** 摄影机透视角度，用于注入透视关键词（low_angle/high_angle/dutch_angle 等） */
  cameraAngle?: string;
  /** 构图规则（rule_of_thirds / symmetrical / negative_space / leading_lines 等） */
  composition?: string;
  /** 景深（shallow / deep / split_diopter 等） */
  depthOfField?: string;
  /** 特殊拍摄技法（slow_motion / bullet_time / dolly_zoom 等），转化为静帧视觉暗示 */
  specialTechnique?: string;
  emotionColorHint?: string;
  routeProfile?: string;
  ambientPopulation?: string;
}

export interface T2VOptimizeOptions {
  provider?: string;
  duration?: number;
  hasFirstFrame?: boolean;
  hasLastFrame?: boolean;
  specialTechnique?: string;
  cameraMovement?: string;
  /** 景别（原 cameraAngle 中的景别部分），用于注入 T2V 构图上下文 */
  shotSize?: string;
  /** 摄影机透视角度，用于注入 T2V 角度上下文 */
  cameraAngle?: string;
  emotionColorHint?: string;
  routeProfile?: string;
  /** Avatar 专用：对话情绪标签（如 angry, sad, joyful） */
  dialogueEmotion?: string;
  /** Avatar 专用：语速（very_slow / slow / normal / fast / very_fast） */
  dialoguePace?: string;
  /** Avatar 专用：音量（whisper / low / normal / loud / scream） */
  dialogueVolume?: string;
}
