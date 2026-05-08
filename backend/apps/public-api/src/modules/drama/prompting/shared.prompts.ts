export const PURPOSE_OVERRIDE_FORMAT = '【本题材专属{{purposeLabel}}场景规则（来自编剧手册，完全替代通用规则）】\n{{genrePurposeOverride}}\n- qualityTier: "{{qualityTier}}"';

export const PURPOSE_DIRECTIVE_TEMPLATES: Record<string, string> = {
  climax: `【高潮场景通用规则】
- 镜头节奏：密集切换（每Shot 1.5-3秒），最高情绪点用 slow_motion 特写
- 必须有至少1个 shotSize=extreme_close_up 捕捉人物表情崩溃/爆发瞬间
- 高光/情绪反转 moment 四步法：wide+bird_eye → medium+low_angle+slow_push_in → close_up+front+fast_push → extreme_close_up+slow_motion 反应脸
- 最后一个Shot必须有强烈的情绪落点（胜利/崩溃），不能停在动作中间
- qualityTier: "golden"`,

  confrontation: `【对峙场景通用规则】
- 经典三角切法：A的 close_up+three_quarter → B的 close_up+three_quarter → 双人 medium+over_shoulder 交替
- 张力积累：每次切镜景别递进（shotSize: wide → medium → close_up → extreme_close_up）
- 权力关系用 cameraAngle 表达：强势方 low_angle（仰拍），弱势方 high_angle（俯拍），张力顶点 dutch_angle
- qualityTier: "golden"`,

  revelation: `【揭秘场景通用规则】
- 揭秘前：shotSize=medium + cameraAngle=three_quarter 建立"无知状态"（平淡）
- 揭秘瞬间：movement=slow_push_in + depthOfField=shallow + shotSize推进到close_up → shotSizeEnd=extreme_close_up 反应脸
- 揭秘后：shotSize=wide + cameraAngle=bird_eye + movement=crane_up 重建新的关系格局
- 信息炸弹落地那一帧：transitionToNext 用 fade_black 或 flash，制造留白
- qualityTier: "golden"`,

  cliffhanger: `【悬念收尾场景专属规则】
- 最后一个Shot必须是 shotSize=extreme_close_up（眼睛/手/关键道具），duration 1-2秒
- 最后一个Shot的 transitionToNext 用 fade_black（黑屏结束，给观众窒息感）
- 不要在对话中结束，要在画面/动作/表情中结束
- 整场节奏逐渐放慢，movement 从 slow_push_in 最终停到 static
- qualityTier: "golden"`,

  romantic: `【情感场景通用规则】
- 用慢镜头和长停留（3-6秒/Shot）体现情感深度
- 细节特写：手的触碰用 shotSize=close_up / extreme_close_up，眼神交汇用 close_up + three_quarter
- 情感高峰拥抱/亲近：movement=orbit（绕着两人缓慢环绕），depthOfField=shallow
- 避免对称构图，用 composition=rule_of_thirds + negative_space 营造暧昧感
- qualityTier: "standard"`,

  action: `【动作场景通用规则】
- 追逐铁律：movement=tracking + handheld 为主，禁止 static
- 打斗切镜：每个击打动作 1-2秒/Shot，使用 movement=handheld 模拟冲击感
- 慢动作强调关键打击：specialTechnique=slow_motion + shotSize=close_up/extreme_close_up
- 节奏控制：动作密集时（1-2秒/Shot）→ 击倒后用 static + extreme_close_up 定格表情（2-3秒）
- qualityTier: "golden"`,

  transition: `【过场场景专属规则】
- 镜头数量最少（2-3个），快速切换，不停留
- 用环境/时间变化镜头（空镜）交代场景转换，shotSize=wide/extreme_wide 为主
- 遮挡转场：transitionToNext=occlusion_cut，在前景物体遮挡瞬间无缝切换下一场
- qualityTier: "filler"`,

  _default: `【常规场景规则】
- 均衡使用 shotSize=close_up 和 medium，对话场景遵循标准切换节奏
- qualityTier: "standard"`,
};

export const SCENE_CONTEXT_CONSTRAINTS = `=== 本场景约束 ===
- 最多 {{maxShots}} 个Shot，目标时长 {{targetDur}}s
- 每个 Shot 建议 5-8 秒，每 Shot 只包含一个清晰动作（AI 视频模型的实际能力限制）
- Shot 越少连贯性越好 —— 每个切镜点都是身份漂移风险
- 字幕只在有对话/旁白时添加
- 暂不填 audio 字段（交给AudioDirector）
- 所有 firstFramePrompt 和 lastFramePrompt 必须填写`;

export const SCENE_CONTEXT_HOOK = `=== 集末悬念视觉指令（本场为全集结尾，Hook方向：{{hookDirection}}）===
- 最后一个Shot必须视觉化"Hook方向"中的核心悬念
- 使用停顿式构图（静止 + extreme_close_up），给观众留白思考
- transitionToNext 强制使用 fade_black`;

export const SCENE_CONTEXT_EMOTION_DIRECTION = `=== 本集情绪方向（全集视角参考）===
{{intentEmotionDirection}}
（注意：当前场景的情绪处理要符合以上全集弧线，而非孤立设计）`;

export const AUDIO_CONTEXT_HEADER = '=== 本集情绪节拍图（音频必须与此同步）===';
export const AUDIO_CONTEXT_FOOTER = '⚠️ BGM的intensity曲线必须追踪emotionBeat的intensity曲线，静默点必须对齐intensity=0的beat。';

export const HOOK_CONSTRAINT_TEMPLATE = `=== ⚠️ previewShots 角色ID铁律 ===
previewShots 中 characters 数组的 characterId【只能】使用以下已注册 ID：
[{{characterIds}}]
禁止使用中文角色名、拼音全拼、或未在上述列表中的任何 ID。路人/群演只能写在 visualPrompt 文字描述中。`;
